// COMPETEN UNIVERSAL SEARCH STANDARD: the words in a page address, tidied. Pure, so a page and its tests agree.

/** The first value of a search parameter, trimmed and capped, or null where there is nothing to search for. */
export function pageQuery(v: string | string[] | undefined | null): string | null {
  const first = Array.isArray(v) ? v[0] : v;
  const q = typeof first === "string" ? first.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  return q || null;
}

/** The page's own address with its filters kept and the words dropped: what "Clear search" links to. */
export function clearSearchHref(base: string, keep: Readonly<Record<string, string | null | undefined>>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(keep)) if (v) params.set(k, v);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
