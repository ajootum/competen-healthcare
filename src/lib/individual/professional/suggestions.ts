/* eslint-disable @typescript-eslint/no-explicit-any */

// ── SUGGESTIONS FOR THE PERSON'S OWN WORDS ── COMPETEN-CONFIG-002 item 8, migration 013 ─────────────────
//
// The profession and registration-body fields stay FREE TEXT: what the person types is what is recorded,
// and nothing here validates, rewrites or restricts it. The platform's controlled vocabularies
// (`taxonomies` and `taxonomy_terms`, migration 013) are only OFFERED, as a list the browser shows while
// they type.
//
// ⚠ REUSED, NOT COPIED. `profession` is migration 013's own kind. `registration_body` is read the same way
// and is simply absent until a row with that kind exists: taxonomies.kind is free text with a unique
// constraint and no check, so the kind is DATA. Absent, unreadable or empty, the field is plain free text.
//
// ⚠ A SHARED VOCABULARY, NOT AN ORGANISATION'S. Neither table carries a hospital or tenant column, so
// reading them crosses no tenancy boundary, and nothing is ever written to them from here.

export const SUGGESTION_KINDS = { profession: "profession", registrationBody: "registration_body" } as const;
export const SUGGESTIONS_MAX = 200;

export type Suggestions = { profession: string[]; registrationBody: string[] };
export const NO_SUGGESTIONS: Suggestions = { profession: [], registrationBody: [] };

/** Pure: terms grouped by kind, trimmed, de-duplicated, in the vocabulary's own order. */
export function groupSuggestions(taxonomies: readonly { id: string; kind: string }[], terms: readonly { taxonomy_id: string; value: string | null }[]): Suggestions {
  const kindOf = new Map(taxonomies.map(t => [t.id, t.kind]));
  const out: Suggestions = { profession: [], registrationBody: [] };
  const seen = { profession: new Set<string>(), registrationBody: new Set<string>() };
  for (const term of terms) {
    const kind = kindOf.get(term.taxonomy_id);
    const key = kind === SUGGESTION_KINDS.profession ? "profession" : kind === SUGGESTION_KINDS.registrationBody ? "registrationBody" : null;
    const value = (term.value ?? "").replace(/\s+/g, " ").trim();
    if (!key || !value || seen[key].has(value.toLowerCase())) continue;
    seen[key].add(value.toLowerCase());
    out[key].push(value);
  }
  return out;
}

/** The suggestions now. Fail-soft: anything unreadable is no suggestions, and the fields stay free text. */
export async function loadSuggestions(admin: any): Promise<Suggestions> {
  try {
    const { data: tax, error } = await admin.from("taxonomies").select("id, kind").in("kind", Object.values(SUGGESTION_KINDS));
    if (error || !tax?.length) return NO_SUGGESTIONS;
    const { data: terms, error: termErr } = await admin.from("taxonomy_terms").select("taxonomy_id, value")
      .in("taxonomy_id", tax.map((t: any) => t.id)).order("sort_order").order("value").limit(SUGGESTIONS_MAX * 2);
    return termErr ? NO_SUGGESTIONS : groupSuggestions(tax, terms ?? []);
  } catch { return NO_SUGGESTIONS; }
}
