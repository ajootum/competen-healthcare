// COMPETEN UNIVERSAL SEARCH STANDARD: the words in a page address, tidied. Pure, so a page and its tests agree.

/** The first value of a search parameter, trimmed and capped, or null where there is nothing to search for. */
export function pageQuery(v: string | string[] | undefined | null): string | null {
  const first = Array.isArray(v) ? v[0] : v;
  const q = typeof first === "string" ? first.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  return q || null;
}
