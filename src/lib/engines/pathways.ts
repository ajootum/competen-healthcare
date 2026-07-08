import { createAdminClient } from "@/lib/supabase/server";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Book II Ch.17 — Learning Pathway generation.
 * Reads a nurse's latest competency decisions, finds the gaps (non-passing or
 * expired outcomes), and builds a personalised pathway linking each gapped
 * competency to the governed learning resources that develop it.
 */
export async function generatePathwayForNurse(
  admin: Admin,
  nurseId: string,
): Promise<{ items: number }> {
  // Latest decision per competency
  const { data: decisions } = await admin
    .from("competency_decisions")
    .select("competency_id, outcome, expiry_date, created_at")
    .eq("nurse_id", nurseId)
    .order("created_at", { ascending: false });

  const seen = new Set<string>();
  const gaps: { competency_id: string; reason: string }[] = [];
  for (const d of decisions ?? []) {
    if (seen.has(d.competency_id)) continue;
    seen.add(d.competency_id);
    const passing = OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing ?? false;
    const expired = d.expiry_date && new Date(d.expiry_date).getTime() < Date.now();
    if (!passing) {
      gaps.push({ competency_id: d.competency_id, reason: OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.label ?? "Gap" });
    } else if (expired) {
      gaps.push({ competency_id: d.competency_id, reason: "Expired — reassessment due" });
    }
  }

  // Fresh pathway each generation
  await admin.from("learning_pathways").delete().eq("nurse_id", nurseId);
  if (!gaps.length) return { items: 0 };

  const { data: pathway } = await admin
    .from("learning_pathways")
    .insert({ nurse_id: nurseId, status: "active" })
    .select("id").single();
  if (!pathway) return { items: 0 };

  // Competency names + linked resources
  const compIds = gaps.map(g => g.competency_id);
  const [{ data: comps }, { data: links }] = await Promise.all([
    admin.from("framework_competencies").select("id, name").in("id", compIds).returns<{ id: string; name: string }[]>(),
    admin.from("resource_competencies")
      .select("competency_id, learning_resources(id, title, resource_type, is_active)")
      .in("competency_id", compIds),
  ]);
  const nameById = new Map((comps ?? []).map(c => [c.id, c.name]));
  const resByComp = new Map<string, { id: string; title: string; resource_type: string }[]>();
  for (const l of links ?? []) {
    const r = l.learning_resources as unknown as { id: string; title: string; resource_type: string; is_active: boolean } | null;
    if (!r || !r.is_active) continue;
    const arr = resByComp.get(l.competency_id) ?? [];
    arr.push({ id: r.id, title: r.title, resource_type: r.resource_type });
    resByComp.set(l.competency_id, arr);
  }

  let sort = 0;
  const rows: Record<string, unknown>[] = [];
  for (const gap of gaps) {
    const compName = nameById.get(gap.competency_id) ?? "Competency";
    const resources = resByComp.get(gap.competency_id) ?? [];
    if (resources.length) {
      for (const r of resources) {
        rows.push({
          pathway_id: pathway.id,
          competency_id: gap.competency_id,
          competency_name: compName,
          reason: gap.reason,
          resource_id: r.id,
          resource_title: r.title,
          resource_type: r.resource_type,
          sort_order: sort++,
        });
      }
    } else {
      // Gap with no linked resource — still surface it so it isn't invisible
      rows.push({
        pathway_id: pathway.id,
        competency_id: gap.competency_id,
        competency_name: compName,
        reason: gap.reason,
        resource_title: null,
        sort_order: sort++,
      });
    }
  }

  await admin.from("pathway_items").insert(rows);
  return { items: rows.length };
}
