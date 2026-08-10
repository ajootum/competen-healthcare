// CP-HQ-NAV-001 — showing an HQ viewer only the links their position can actually open.
//
// Pure module: no I/O, no React, no Supabase. The sidebar renders the answer, the harness asserts it, and
// neither re-implements it. (The last sidebar harness re-implemented its rules and stayed green under every
// deliberate break, which is why the matching logic now lives in src/lib/nav/active.ts and this lives here.)
//
// ── WHY THIS IS A NAV FILTER AND NOT A GATE ──────────────────────────────────────────────────────────
// This decides what is DRAWN. It is not what decides what is REACHABLE — requireHqContext() on each page
// does that, and it is the only thing that does. Hiding a link the page would still serve is decoration,
// so this file must never be cited as the reason a route is safe.
//
// Today that gap is wide and measured: of the 205 /super-admin pages, 167 still test the `super_admin`
// role directly and 38 call requireHqContext. For the 167, hiding the link is ALL that happens — an
// appointee typing the URL is refused by the role test, and a super_admin is admitted exactly as before.
// The filter is therefore honest for both: it removes links that would refuse the person who clicked them.
// Converting those 167 is the substantive half of CP-HQ-NAV-001 and it is deliberately not in this file.

import { capabilityForRoute } from "./spaces";

/** The viewer, resolved once by the layout. */
export type HqViewer = {
  /**
   * ⚠ REQUIRED, AND THE WHOLE FILE TURNS ON IT. The layout resolves `hqCapabilities` ONLY for non-owners
   * — an owner short-circuits before any HQ table is read, so an owner arrives here with capabilities: [].
   * If this flag were optional, dropped, or inferred from a non-empty capability list, every platform
   * owner would be handed an EMPTY SIDEBAR by a filter that thought it was being careful. The owner branch
   * is first, it is unconditional, and it reads nothing else.
   */
  isOwner: boolean;
  /** Capability codes granted by the viewer's live HQ positions. Empty for owners — see above. */
  capabilities: string[];
};

/**
 * Should this viewer be offered this href?
 *
 * ⚠ AN UNMAPPED HREF IS HIDDEN, NOT SHOWN, and that is the same default the rest of the HQ programme uses:
 * capabilityForRoute() returns null for anything nobody has declared, and null denies (spaces.ts:140).
 *
 * It also — deliberately — hides every link that LEAVES /super-admin. The sidebar carries several:
 * /platform-admin, /admin/approvals, /competency-office/*, /competency-studio. Those are other workspaces
 * behind their own gates, and an HQ appointment grants nothing in any of them. Offering the link would
 * promise a destination the destination's own layout then refuses.
 */
export function canSeeHqLink(href: string, viewer: HqViewer): boolean {
  if (viewer.isOwner) return true;
  const capability = capabilityForRoute(href);
  if (!capability) return false;
  return viewer.capabilities.includes(capability);
}

export type HqNavSection<T> = { group: string; items: T[] };

/**
 * The sidebar a viewer should see.
 *
 * Owners get the input back untouched — same object, same order, same counts — so this can never become a
 * new way to lose a section from the owner console.
 *
 * ⚠ EMPTY GROUPS ARE DROPPED. A group header with nothing under it reads as "this section is broken",
 * which is worse than the section simply not being there for someone who cannot enter it.
 */
export function filterHqNav<T extends { href: string }>(
  sections: HqNavSection<T>[],
  viewer: HqViewer,
): HqNavSection<T>[] {
  // ⚠ REDUNDANT WITH canSeeHqLink's OWNER BRANCH, AND KEPT DELIBERATELY. Deliberate-break testing found
  // that removing EITHER owner branch alone changes no answer -- the other one catches it -- and that the
  // owner's sidebar only empties when BOTH are gone (harness A1 goes 42/42 -> 0/42). That is defence in
  // depth on the one failure that locks out the accounts able to fix it, so both stay. It also means A1 is
  // green for two independent reasons: do not read a green A1 as proof that either branch is present.
  if (viewer.isOwner) return sections;
  return sections
    .map(s => ({ ...s, items: s.items.filter(i => canSeeHqLink(i.href, viewer)) }))
    .filter(s => s.items.length > 0);
}
