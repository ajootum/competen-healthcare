// The initials shown on a person's avatar (Individual shell header and the profile photo placeholder).
//
// First letter of the given name plus first letter of the family name. Where only a full name is known, that is the
// first letter of the FIRST word plus the first letter of the LAST word, so "Amani Grace Odhiambo-Kamau" is "AO", not
// "AG". A single word gives one letter. Nothing known gives "?".

export function initialsOf(
  name: { givenName?: string | null; familyName?: string | null; fullName?: string | null; email?: string | null },
): string {
  const first = (s: string | null | undefined) => (s ?? "").trim().charAt(0).toUpperCase();
  const given = first(name.givenName);
  const family = first(name.familyName);
  if (given && family) return given + family;
  const words = (name.fullName ?? "").split(/\s+/).filter(Boolean);
  if (words.length >= 2) return first(words[0]) + first(words[words.length - 1]);
  if (words.length === 1) return first(words[0]);
  return first(name.email) || "?";
}
