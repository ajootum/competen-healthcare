// The ONE place a full name is composed from its typed parts: given, then middle names, then family, joined by single
// spaces; null when there are none. Shared by the HQ edit of a person's details (src/lib/hq) and the person's own
// profile (own-profile.ts), so the two cannot compose differently. Nothing ever splits a full name into parts.

export type NameParts = { givenName: string | null; middleNames: string | null; familyName: string | null };

export function composeFullName(p: NameParts): string | null {
  const joined = [p.givenName, p.middleNames, p.familyName].filter((x): x is string => !!x && !!x.trim()).join(" ").replace(/\s+/g, " ").trim();
  return joined || null;
}
