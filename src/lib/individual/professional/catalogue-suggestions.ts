/* eslint-disable @typescript-eslint/no-explicit-any */
import { PUBLISHED, professionalAllowlist } from "./frameworks";

// ── COMPETENCY CATALOGUES SUGGESTED FROM THE PROFILE ── COMPETEN-PROFESSIONAL-PROFILE-01 Stage 1, GO s6 ───────
//
// The person's profession, specialties and interests are matched against the catalogues Competen
// Professional OFFERS -- the Holdings CFCA library (frameworks: competency_layer, profession_term_id from
// migration 384, specialty_term_id from 395), filtered by the SAME rule as every Professional framework read:
// shared (hospital_id null), active, published AND in the Professional allowlist (frameworks.ts).
//
// ⚠ A SUGGESTION, NEVER A REQUIREMENT AND NEVER AN EXPOSURE. Nothing outside the allowlist is suggested, so an
// unfinished or unapproved framework cannot reach a person through their profile. The allowlist is empty by
// default, and then nothing is suggested and registration is unaffected: no catalogue is ever required.
//
// ⚠ NO SECOND ENGINE. This only ranks catalogues the existing library already describes. Linking a need or
// evidence to a competency stays on the existing pickers and their write checks.

export type CatalogueSuggestion = { frameworkId: string; name: string; layer: string | null; reasons: string[] };

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
/** Pure: two labels name the same thing -- equal, or one contains the other as whole words. */
export function sameTerm(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  return x === y || ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `);
}

/** Pure: rank the offered catalogues for a person's profile. Unmatched catalogues are not suggested. */
export function rankCatalogues(
  frameworks: readonly { id: string; name: string; competency_layer: string | null; profession_term_id: string | null; specialty_term_id: string | null }[],
  terms: ReadonlyMap<string, string>,
  person: { profession: string | null; specialties: readonly string[] },
): CatalogueSuggestion[] {
  const out: (CatalogueSuggestion & { score: number })[] = [];
  for (const f of frameworks) {
    const reasons: string[] = []; let score = 0;
    const prof = f.profession_term_id ? terms.get(f.profession_term_id) : null;
    const spec = f.specialty_term_id ? terms.get(f.specialty_term_id) : null;
    if (prof && sameTerm(prof, person.profession)) { reasons.push(`Matches your profession (${prof})`); score += 2; }
    const s = spec ? person.specialties.find(p => sameTerm(spec, p)) : undefined;
    if (spec && s) { reasons.push(`Matches your specialty (${spec})`); score += 3; }
    if (f.competency_layer === "foundational" && !reasons.length) { reasons.push("Foundational: applies across professions"); score += 1; }
    if (reasons.length) out.push({ frameworkId: f.id, name: f.name, layer: f.competency_layer, reasons, score });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).map(c => ({ frameworkId: c.frameworkId, name: c.name, layer: c.layer, reasons: c.reasons }));
}

/** The suggestions now. null: could not be read. [] : nothing offered or nothing matches. */
export async function loadCatalogueSuggestions(admin: any, person: { profession: string | null; specialties: readonly string[] }): Promise<CatalogueSuggestion[] | null> {
  try {
    const allowed = await professionalAllowlist(admin);
    if (!allowed.length) return [];
    const { data: fws, error } = await admin.from("frameworks").select("id, name, competency_layer, profession_term_id, specialty_term_id")
      .is("hospital_id", null).eq("is_active", true).eq("pub_status", PUBLISHED).in("id", allowed).limit(200);
    if (error) return null;
    const termIds = [...new Set((fws ?? []).flatMap((f: any) => [f.profession_term_id, f.specialty_term_id]).filter(Boolean))];
    const { data: rows, error: termErr } = termIds.length ? await admin.from("taxonomy_terms").select("id, value").in("id", termIds) : { data: [], error: null };
    if (termErr) return null;
    return rankCatalogues(fws ?? [], new Map((rows ?? []).map((t: any) => [t.id, String(t.value ?? "")])), person);
  } catch { return null; }
}
