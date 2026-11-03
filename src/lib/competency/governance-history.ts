/* eslint-disable @typescript-eslint/no-explicit-any */
// UNIFIED-GOVERNANCE-V1 section 7 -- server readers for the Governance History page. Read only, service role, called from a page that
// has already passed requireHqCapability. Each returns null when its source could not be read, so the page says so rather than
// showing a silent empty list. The pure merge lives in src/app/super-admin/governance/unified.ts.
import { contributorsOf } from "./framework-publication";

export interface ClinicalDecisionRow { versionId: string; reviewerId: string; decision: string; comment: string | null; at: string; competency: string | null; frameworkId: string | null }
export interface FrameworkPublicationRow { frameworkId: string; frameworkName: string; versionNum: number; label: string | null; at: string; by: string | null }
export interface OrganisationChangeRow { id: string; at: string; actor: string | null; action: string; entity: string | null }

/** Clinical review decisions, newest first, with the competency (and the framework that owns it) each one was about. */
export async function loadClinicalDecisions(admin: any, limit = 200): Promise<ClinicalDecisionRow[] | null> {
  try {
    const { data: decisions, error } = await admin.from("clinical_review_decision").select("version_id, reviewer_id, decision, comment, created_at").order("created_at", { ascending: false }).limit(limit);
    if (error) return null;
    const ds = (decisions ?? []) as any[];
    if (!ds.length) return [];
    const versionIds = [...new Set(ds.map((d) => d.version_id as string))];
    const { data: versions, error: vErr } = await admin.from("clinical_content_version").select("id, competency_id").in("id", versionIds);
    if (vErr) return null;
    const compOf = new Map<string, string | null>(((versions ?? []) as any[]).map((v) => [v.id, v.competency_id ?? null]));
    const compIds = [...new Set([...compOf.values()].filter((x): x is string => !!x))];
    const comps = new Map<string, { name: string; domainId: string | null }>();
    const domainFramework = new Map<string, string>();
    if (compIds.length) {
      const { data: cs, error: cErr } = await admin.from("framework_competencies").select("id, name, domain_id").in("id", compIds);
      if (cErr) return null;
      for (const c of (cs ?? []) as any[]) comps.set(c.id, { name: c.name, domainId: c.domain_id ?? null });
      const domainIds = [...new Set([...comps.values()].map((c) => c.domainId).filter((x): x is string => !!x))];
      if (domainIds.length) {
        const { data: dm } = await admin.from("framework_domains").select("id, framework_id").in("id", domainIds);
        for (const d of (dm ?? []) as any[]) domainFramework.set(d.id, d.framework_id);
      }
    }
    return ds.map((d) => {
      const comp = comps.get(compOf.get(d.version_id) ?? "") ?? null;
      return {
        versionId: d.version_id, reviewerId: d.reviewer_id, decision: d.decision, comment: d.comment ?? null, at: d.created_at,
        competency: comp?.name ?? null, frameworkId: comp?.domainId ? domainFramework.get(comp.domainId) ?? null : null,
      };
    });
  } catch { return null; }
}

/** Framework publications (one row per published version), newest first. */
export async function loadFrameworkPublications(admin: any, limit = 200): Promise<FrameworkPublicationRow[] | null> {
  try {
    const { data, error } = await admin.from("framework_versions").select("framework_id, version_num, published_at, published_by_name").order("published_at", { ascending: false }).limit(limit);
    if (error) return null;
    const vs = ((data ?? []) as any[]).filter((v) => v.published_at);
    if (!vs.length) return [];
    const { data: fws, error: fErr } = await admin.from("frameworks").select("id, name").in("id", [...new Set(vs.map((v) => v.framework_id as string))]);
    if (fErr) return null;
    const nameOf = new Map(((fws ?? []) as any[]).map((f) => [f.id, f.name as string]));
    return vs.map((v) => ({ frameworkId: v.framework_id, frameworkName: nameOf.get(v.framework_id) ?? "A framework", versionNum: Number(v.version_num), label: null, at: v.published_at, by: v.published_by_name ?? null }));
  } catch { return null; }
}

/** Organisation changes: positions and appointments, from the audit trail, newest first. */
export async function loadOrganisationChanges(admin: any, limit = 200): Promise<OrganisationChangeRow[] | null> {
  try {
    const { data, error } = await admin.from("audit_log").select("id, actor_name, action, entity_name, created_at")
      .or("action.like.hq_position_%,action.like.hq_appointment%").order("created_at", { ascending: false }).limit(limit);
    if (error) return null;
    return ((data ?? []) as any[]).map((a) => ({ id: a.id, at: a.created_at, actor: a.actor_name ?? null, action: a.action ?? "", entity: a.entity_name ?? null }));
  } catch { return null; }
}

/** Who authored or curated each framework, by name, from its audit trail (governance acts are not authorship). null = unreadable. */
export async function loadFrameworkAuthors(admin: any, frameworkIds: string[]): Promise<Record<string, string[]> | null> {
  if (!frameworkIds.length) return {};
  try {
    const { data, error } = await admin.from("audit_log").select("entity_id, actor_id, actor_name, action").eq("entity_type", "framework").in("entity_id", frameworkIds).limit(10000);
    if (error) return null;
    const out: Record<string, string[]> = {};
    for (const id of frameworkIds) {
      const rows = ((data ?? []) as any[]).filter((r) => r.entity_id === id);
      const nameOf = new Map(rows.filter((r) => r.actor_id).map((r) => [r.actor_id as string, (r.actor_name as string | null) ?? "Unnamed person"]));
      out[id] = contributorsOf(rows).map((a) => nameOf.get(a) ?? "Unnamed person");
    }
    return out;
  } catch { return null; }
}
