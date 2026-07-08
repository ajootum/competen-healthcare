import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;
type Edge = { source_type: string; source_id: string; target_type: string; target_id: string; relationship: string };

/**
 * Book IV Ch.2–5 — Enterprise Knowledge Graph.
 * Deterministically rebuilds knowledge_edges from the governed hierarchy and
 * cross-links (no AI required). This is the substrate the AI layer retrieves over.
 *
 * Edges built:
 *   framework  --contains--> domain
 *   domain     --contains--> practice
 *   practice   --contains--> cpu
 *   cpu        --contains--> competency        (via framework_competencies.cpu_id)
 *   competency --contains--> skill
 *   cpu        --assesses--> assessment_blueprint
 *   resource   --supports--> competency         (resource_competencies)
 *   curriculum --develops--> competency         (curriculum_competencies)
 */
export async function rebuildKnowledgeGraph(admin: Admin): Promise<{ edges: number }> {
  const edges: Edge[] = [];
  const push = (st: string, si: string, tt: string, ti: string, rel: string) =>
    edges.push({ source_type: st, source_id: si, target_type: tt, target_id: ti, relationship: rel });

  // Framework → Domain
  const { data: domains } = await admin.from("framework_domains").select("id, framework_id");
  for (const d of domains ?? []) push("framework", d.framework_id, "domain", d.id, "contains");

  // Domain → Practice
  const { data: practices } = await admin.from("practices").select("id, domain_id");
  for (const p of practices ?? []) push("domain", p.domain_id, "practice", p.id, "contains");

  // Practice → CPU
  const { data: cpus } = await admin.from("clinical_practice_units").select("id, practice_id");
  for (const c of cpus ?? []) push("practice", c.practice_id, "cpu", c.id, "contains");

  // CPU → Competency, and Domain → Competency (for ungrouped)
  const { data: comps } = await admin.from("framework_competencies").select("id, domain_id, cpu_id");
  for (const c of comps ?? []) {
    if (c.cpu_id) push("cpu", c.cpu_id, "competency", c.id, "contains");
    else if (c.domain_id) push("domain", c.domain_id, "competency", c.id, "contains");
  }

  // Competency → Skill
  const { data: skills } = await admin.from("competency_skills").select("id, competency_id");
  for (const s of skills ?? []) if (s.competency_id) push("competency", s.competency_id, "skill", s.id, "contains");

  // CPU → Assessment Blueprint
  const { data: blueprints } = await admin.from("assessment_blueprints").select("id, cpu_id");
  for (const b of blueprints ?? []) push("cpu", b.cpu_id, "assessment_blueprint", b.id, "assesses");

  // Resource → Competency (supports)
  const { data: resComp } = await admin.from("resource_competencies").select("resource_id, competency_id");
  for (const r of resComp ?? []) push("resource", r.resource_id, "competency", r.competency_id, "supports");

  // Curriculum → Competency (develops → modelled as 'supports')
  const { data: currComp } = await admin.from("curriculum_competencies").select("curriculum_id, competency_id");
  for (const c of currComp ?? []) push("curriculum", c.curriculum_id, "competency", c.competency_id, "supports");

  // Replace the derived graph. (Manually-authored edges of other relationships are
  // preserved by only clearing the relationships we regenerate.)
  const regenRels = ["contains", "assesses", "supports"];
  await admin.from("knowledge_edges").delete().in("relationship", regenRels);

  // Insert in chunks to stay within payload limits
  const chunk = 500;
  for (let i = 0; i < edges.length; i += chunk) {
    await admin.from("knowledge_edges").upsert(edges.slice(i, i + chunk), {
      onConflict: "source_type,source_id,target_type,target_id,relationship",
      ignoreDuplicates: true,
    });
  }

  return { edges: edges.length };
}

/** Graph statistics for the dashboard. */
export async function graphStats(admin: Admin) {
  const { data: edges } = await admin.from("knowledge_edges").select("relationship, source_type, target_type");
  const byRel: Record<string, number> = {};
  const nodeTypes = new Set<string>();
  for (const e of edges ?? []) {
    byRel[e.relationship] = (byRel[e.relationship] ?? 0) + 1;
    nodeTypes.add(e.source_type); nodeTypes.add(e.target_type);
  }
  const { count: embeddingTotal } = await admin.from("knowledge_embeddings").select("id", { count: "exact", head: true });
  const { count: embeddingDone } = await admin.from("knowledge_embeddings").select("id", { count: "exact", head: true }).not("embedding", "is", null);

  return {
    totalEdges: (edges ?? []).length,
    byRelationship: byRel,
    nodeTypes: [...nodeTypes],
    embeddingTotal: embeddingTotal ?? 0,
    embeddingDone: embeddingDone ?? 0,
  };
}
