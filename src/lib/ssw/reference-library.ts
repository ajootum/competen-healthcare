/* eslint-disable @typescript-eslint/no-explicit-any */
// SSW-CONF-001 §3 — what is actually IN the governed knowledge base, for this hospital.
//
// The supervisor Toolkit used to show three dashed tiles reading "content library — next phase". That was
// honest when it was written and is now half true: frameworks, practice units, competencies and skills are
// populated, while policies, knowledge objects and clinical cases are still empty. A search box over a
// corpus that is empty in the categories a supervisor most wants during a shift looks broken rather than
// unbuilt, so the search is paired with a MEASURED inventory: what exists, per type, right now.
//
// THE FILTERS BELOW MUST MATCH search_ckcm() (migration 169) EXACTLY.
// The inventory promises what the search can find. If a filter here drifts from the one in the function --
// counting draft CPUs the search excludes, say -- the page advertises content that no query will ever
// return, and the discrepancy is invisible because both halves "work". scripts/ssw-reference-harness.ts
// asserts each entry against the migration text and against the live function, because that exact drift
// (four missed redefinitions of this very function) is what made migration 169 necessary.
//
// Tenancy follows the function too: `tenant: true` means the table has a hospital_id and the search scopes
// it to (this hospital OR platform-shared); the rest are shared master content with no hospital_id at all.

export type RefType = "framework" | "cpu" | "competency" | "skill" | "resource" | "policy" | "quality_object" | "knowledge" | "case";

export type RefEntry = {
  type: RefType;
  label: string;
  table: string;
  tenant: boolean;
  /** column/value the search filters on, or null where the branch has no status filter */
  filter: { col: string; eq: string | boolean } | null;
};

export const REFERENCE_CATALOGUE: RefEntry[] = [
  { type: "framework",      label: "Frameworks",         table: "frameworks",               tenant: true,  filter: { col: "is_active", eq: true } },
  { type: "cpu",            label: "Practice Units",     table: "clinical_practice_units",  tenant: false, filter: { col: "pub_status", eq: "published" } },
  { type: "competency",     label: "Competencies",       table: "framework_competencies",   tenant: false, filter: null },
  { type: "skill",          label: "Skills",             table: "competency_skills",        tenant: false, filter: { col: "is_active", eq: true } },
  { type: "resource",       label: "Learning Resources", table: "learning_resources",       tenant: true,  filter: { col: "is_active", eq: true } },
  { type: "policy",         label: "Policies",           table: "policies",                 tenant: true,  filter: { col: "is_active", eq: true } },
  { type: "quality_object", label: "Quality Standards",  table: "quality_objects",          tenant: true,  filter: { col: "status", eq: "active" } },
  { type: "knowledge",      label: "Knowledge Objects",  table: "knowledge_objects",        tenant: false, filter: { col: "status", eq: "active" } },
  { type: "case",           label: "Case Studies",       table: "clinical_cases",           tenant: false, filter: { col: "status", eq: "active" } },
];

export type RefCount = RefEntry & { n: number; error: string | null };

const NONE = "00000000-0000-0000-0000-000000000000";

/**
 * Count what this hospital can actually find. Counts are HEAD requests, so nothing is transferred.
 *
 * A table this deployment has not created yet returns an error rather than a zero: "no such table" and
 * "none yet" are different facts, and collapsing them is how a missing migration reads as an empty
 * library. The caller renders them differently.
 */
export async function loadReferenceInventory(admin: any, hospitalId: string | null, isSuper: boolean): Promise<RefCount[]> {
  return Promise.all(REFERENCE_CATALOGUE.map(async (e): Promise<RefCount> => {
    let q = admin.from(e.table).select("id", { count: "exact", head: true });
    if (e.filter) q = q.eq(e.filter.col, e.filter.eq);
    // Same rule as the function: null p_hospital is unrestricted (super), everyone else sees their own
    // hospital plus platform-shared rows. The nil uuid, never null, for a caller with no hospital.
    if (e.tenant && !isSuper) q = q.or(`hospital_id.eq.${hospitalId ?? NONE},hospital_id.is.null`);
    const { count, error } = await q;
    return { ...e, n: count ?? 0, error: error ? (error.message || "unavailable") : null };
  }));
}

/** Total searchable objects, ignoring types this deployment does not have. */
export const totalAvailable = (rows: RefCount[]) => rows.filter(r => !r.error).reduce((s, r) => s + r.n, 0);
