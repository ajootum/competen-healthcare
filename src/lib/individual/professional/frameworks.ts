/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadIndividualPolicy } from "../policy";

// ── SHARED COMPETENCY FRAMEWORKS, FOR A PERSON WITH NO ORGANISATION ── migrations 003, 004, 127 ─────────
//
// A development need or a piece of evidence may name a competency from a framework. Only SHARED
// frameworks qualify: `frameworks.hospital_id IS NULL` (COMPETEN-IND-002 s1.3). A hospital's own
// framework is that organisation's content, and listing it to a person outside it would be a cross-tenant
// read. Migration 373 cannot express "the referenced framework has a null hospital_id" without a trigger,
// so the rule is HERE, on every read and every write, and scripts/individual-professional-harness.ts pins
// that every framework read in Professional code carries the null-hospital filter.
//
// ⚠ AND PUBLISHED ONLY (COMPETEN-CONFIG-002 P0). A framework a person may choose, or link a new record to,
// must be `pub_status = 'published'` (migration 127's lifecycle: draft, in_review, approved, published,
// archived). A draft or archived framework is not offered and is refused on write. referenceNames() still
// names a framework an EXISTING record already points at, whatever its status now -- hiding the name of a
// link the person made would rewrite their record.
export const PUBLISHED = "published";
//
// ⚠ AND ALLOWLISTED (COMPETEN-SCHOLAR-01 S1). Published is no longer enough: a framework is offered, and
// accepted on write, only when HQ has put it in the Professional catalogue allowlist (Individual policy
// professional_catalogues, set under hq.individual.config.manage). The allowlist starts EMPTY, so by
// default Professional offers NO framework -- the shared library does not reach a person by existing.

export type SharedFramework = { id: string; name: string; library: string };
export type SharedCompetency = { id: string; name: string; domain: string };

/** The Professional allowlist (framework ids). Empty -- the default, and what an unreadable policy gives -- offers nothing. */
export const professionalAllowlist = async (admin: any): Promise<string[]> => (await loadIndividualPolicy(admin)).professionalCatalogues;

export async function loadSharedFrameworks(admin: any): Promise<SharedFramework[] | null> {
  try {
    const allowed = await professionalAllowlist(admin);
    if (!allowed.length) return [];
    const { data, error } = await admin.from("frameworks").select("id, name, library")
      .is("hospital_id", null).eq("is_active", true).eq("pub_status", PUBLISHED).in("id", allowed).order("sort_order").order("name").limit(200);
    return error ? null : (data ?? []);
  } catch { return null; }
}

/** The competencies of one SHARED, ACTIVE, PUBLISHED, ALLOWLISTED framework, or null when it is not one or could not be read. */
export async function loadSharedCompetencies(admin: any, frameworkId: string): Promise<SharedCompetency[] | null> {
  try {
    if (!(await professionalAllowlist(admin)).includes(String(frameworkId).toLowerCase())) return null;
    const { data: fw, error: fwErr } = await admin.from("frameworks").select("id")
      .eq("id", frameworkId).is("hospital_id", null).eq("is_active", true).eq("pub_status", PUBLISHED).maybeSingle();
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
  if (comps === null) return "That framework is not one Competen Professional offers, or it could not be checked just now.";
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
