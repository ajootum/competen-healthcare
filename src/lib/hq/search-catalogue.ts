// COMP-HQ-ACCESS-001 s15 -- THE "SEARCH HQ / GO TO..." CORPUS, PERMISSION-FILTERED.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// s15 asks for a launcher that answers queries like "Practice incidents" or "Recruitment analytics",
// "filters inaccessible destinations BEFORE display", and "still re-authorises at destination".
//
// ⚠ IT INVENTS NO CATALOGUE. The destinations are the sidebar's own nav tables -- the same data the
// sidebar renders and hq-nav-filter-harness already asserts against -- passed in by the caller rather
// than imported here, so this module stays pure and the tables stay the single source. A second list
// of HQ destinations would drift from the sidebar the first time somebody added a page to one of them.
//
// ⚠ AND IT INVENTS NO PERMISSION RULE EITHER. canSeeHqLink is the one filter; this composes it. Its
// own header states the boundary this module inherits: it decides what is DRAWN, never what is
// REACHABLE -- requireHqContext on each page does that, and a filtered launcher is not a substitute
// for it. What the filter buys here is s15's LAST line: "do not expose unauthorised object names
// through search". Filtering server-side means an unauthorised destination's NAME never reaches the
// browser at all -- filtering in the client would ship every label to everybody and hide some with
// CSS, which is not hiding.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

import { canSeeHqLink, type HqViewer } from "./nav-filter";
import { matchNavSubject, navSearchTerms } from "./nav-search";

/** One destination the launcher may offer. `group` is the sidebar's own heading, kept for context. */
export type HqDestination = { label: string; href: string; icon: string; group: string; keywords?: string[] };
/** A match: the destination plus, when keywords carried it, the keyword(s) to show ("matches: configuration"). */
export type HqDestinationMatch = HqDestination & { via?: string[] };

type Item = { label: string; href: string; icon: string; kind?: string; keywords?: string[]; children?: Item[] };
type Section = { group: string; items: Item[] };

/**
 * Every destination this viewer may be offered, deduped by href, in table order.
 *
 * ⚠ DEDUPED BECAUSE THE TABLES OVERLAP BY DESIGN. The shell swaps its table by route (general, CKP,
 * studio, AI, governance, system), and several destinations appear in more than one. A launcher
 * listing "Overview" six times would be worse than no launcher.
 */
export function hqSearchCatalogue(
  tables: { name: string; sections: Section[] }[],
  viewer: HqViewer,
): HqDestination[] {
  const seen = new Set<string>();
  const out: HqDestination[] = [];
  for (const table of tables) {
    for (const section of table.sections) {
      // HQ-IA-02: a child is a destination too, filed under its parent so "Product Health errors" finds it.
      const rows = section.items.flatMap(i => [
        { item: i, group: section.group },
        ...(i.children ?? []).map(c => ({ item: c, group: `${section.group} · ${i.label}` })),
      ]);
      for (const { item, group } of rows) {
        // A cross-link is a second door to a page whose home is another workspace: the home row answers.
        if (item.kind === "cross") continue;
        if (seen.has(item.href)) continue;
        // The filter, not a re-spelling of it. An unmapped href is hidden by its own default.
        if (!canSeeHqLink(item.href, viewer)) continue;
        seen.add(item.href);
        out.push({ label: item.label, href: item.href, icon: item.icon, group, ...(item.keywords?.length ? { keywords: item.keywords } : {}) });
      }
    }
  }
  return out;
}

/**
 * s15's matching, now THE shared matcher (nav-search.ts, also used by the sidebar filter): every term of the
 * query must appear in the destination's label, where it lives, its keywords or its route words, so
 * "practice incidents" finds a Practice > Incidents entry, "configuration" finds Individual Policy and
 * "individual/configuration" finds it by route. Best matches first (label, then location, then keywords,
 * then route), table order within a rank.
 *
 * The corpus is already permission-filtered, so a keyword or route of a page the viewer cannot open is never
 * a candidate. (Route words used to be excluded so "ai" would not list every page beneath /super-admin/ai;
 * ranking now keeps label hits first, and the launcher still shows at most `limit` rows.)
 */
export function matchHqDestinations(catalogue: HqDestination[], query: string, limit = 8): HqDestinationMatch[] {
  const terms = navSearchTerms(query);
  if (terms.length === 0) return [];
  const hits: { d: HqDestinationMatch; rank: number }[] = [];
  for (const d of catalogue) {
    const hit = matchNavSubject({ label: d.label, href: d.href, trail: [d.group], keywords: d.keywords }, terms);
    if (hit) hits.push({ d: hit.via.length ? { ...d, via: hit.via } : d, rank: hit.rank });
  }
  return hits.sort((a, b) => a.rank - b.rank).slice(0, limit).map(h => h.d);
}
