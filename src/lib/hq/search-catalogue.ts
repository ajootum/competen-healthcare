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

/** One destination the launcher may offer. `group` is the sidebar's own heading, kept for context. */
export type HqDestination = { label: string; href: string; icon: string; group: string };

type Section = { group: string; items: { label: string; href: string; icon: string }[] };

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
      for (const item of section.items) {
        if (seen.has(item.href)) continue;
        // The filter, not a re-spelling of it. An unmapped href is hidden by its own default.
        if (!canSeeHqLink(item.href, viewer)) continue;
        seen.add(item.href);
        out.push({ label: item.label, href: item.href, icon: item.icon, group: section.group });
      }
    }
  }
  return out;
}

/**
 * s15's matching: every whitespace-separated term must appear somewhere in the destination's own
 * words, so "practice incidents" finds a Practice > Incidents entry without the two needing to be
 * adjacent, and "recruitment analytics" behaves the same.
 *
 * ⚠ THE GROUP IS SEARCHABLE, THE HREF IS NOT. A route fragment is not something a person types on
 * purpose, and matching it would make "/super-admin/ai" answer a search for "ai" with every page
 * beneath it -- a launcher answering with a hundred rows is a launcher nobody uses twice.
 */
export function matchHqDestinations(catalogue: HqDestination[], query: string, limit = 8): HqDestination[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return catalogue
    .filter(d => {
      const haystack = `${d.label} ${d.group}`.toLowerCase();
      return terms.every(t => haystack.includes(t));
    })
    .slice(0, limit);
}
