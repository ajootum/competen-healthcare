import type { GlobalGroup } from "../scholar/global-search-types";

// COMPETEN UNIVERSAL SEARCH STANDARD: where Enter goes in Professional's Global Search when no result is highlighted. Pure, so the panel and
// its tests agree. A module whose page has no search box has no morePath and is never a target.

/** The first area that has a search box of its own; failing that, the first record found; otherwise nowhere. */
export function professionalEnterTarget(found: readonly Pick<GlobalGroup, "morePath">[], firstResultPath: string | null): string | null {
  return found.find(g => g.morePath)?.morePath ?? firstResultPath ?? null;
}
