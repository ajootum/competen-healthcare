/* eslint-disable @typescript-eslint/no-explicit-any */

// ── SHARED COMPETENCY FRAMEWORKS, FOR A PERSON WITH NO ORGANISATION ── migrations 003, 004, 127 ─────────
//
// A development need or a piece of evidence may name a competency from a framework. Only SHARED
// frameworks qualify: `frameworks.hospital_id IS NULL` (COMPETEN-IND-002 s1.3). A hospital's own
// framework is that organisation's content, and listing it to a person outside it would be a cross-tenant
// read. Migration 373 cannot express "the referenced framework has a null hospital_id" without a trigger,
// so the rule is HERE, on every read and every write, and scripts/individual-professional-harness.ts pins
// that every framework read in Professional code carries the null-hospital filter.

export type SharedFramework = { id: string; name: string; library: string };
export type SharedCompetency = { id: string; name: string; domain: string };

export async function loadSharedFrameworks(admin: any): Promise<SharedFramework[] | null> {
  try {
    const { data, error } = await admin.from("frameworks").select("id, name, library")
      .is("hospital_id", null).eq("is_active", true).order("sort_order").order("name").limit(200);
    return error ? null : (data ?? []);
  } catch { return null; }
}

/** The competencies of one SHARED framework, or null when it is not shared or could not be read. */
export async function loadSharedCompetencies(admin: any, frameworkId: string): Promise<SharedCompetency[] | null> {
  try {
    const { data: fw, error: fwErr } = await admin.from("frameworks").select("id")
      .eq("id", frameworkId).is("hospital_id", null).maybeSingle();
    if (fwErr || !fw) return null;
    const { data, error } = await admin.from("framework_domains")
      .select("name, sort_order, framework_competencies(id, name, sort_order)")
      .eq("framework_id", frameworkId).order("sort_order").limit(200);
    if (error) return null;
    const out: SharedCompetency[] = [];
    for (const d of data ?? []) {
      const comps = [...(d.framework_competencies ?? [])].sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      for (const c of comps) out.push({ id: c.id, name: c.name, domain: d.name });
    }
    return out;
  } catch { return null; }
}

/**
 * Before a write: the framework is shared, and the competency (when given) belongs to it. Returns an
 * error sentence, or null when the reference is acceptable. "Could not check" refuses -- an unverifiable
 * reference is not written.
 */
export async function checkSharedReference(admin: any, frameworkId: string | null, competencyId: string | null): Promise<string | null> {
  if (!frameworkId) return null;
  const comps = await loadSharedCompetencies(admin, frameworkId);
  if (comps === null) return "That framework is not one of the shared frameworks, or it could not be checked just now.";
  if (competencyId && !comps.some(c => c.id === competencyId)) return "That competency is not part of the framework you chose.";
  return null;
}

/** Names for display: framework and competency ids on the person's own rows, shared frameworks only. */
export async function referenceNames(admin: any, frameworkIds: string[], competencyIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    const [fw, comp] = await Promise.all([
      frameworkIds.length ? admin.from("frameworks").select("id, name").is("hospital_id", null).in("id", frameworkIds) : Promise.resolve({ data: [] }),
      competencyIds.length ? admin.from("framework_competencies").select("id, name, framework_domains!inner(framework_id, frameworks!inner(hospital_id))")
        .is("framework_domains.frameworks.hospital_id", null).in("id", competencyIds) : Promise.resolve({ data: [] }),
    ]);
    for (const r of [...(fw?.data ?? []), ...(comp?.data ?? [])]) if (r?.id && r?.name) names.set(r.id, r.name);
  } catch { /* names are display only -- the ids stay on the record */ }
  return names;
}
