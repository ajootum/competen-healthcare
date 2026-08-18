/**
 * The sidebar active-state rule, in ONE place.
 *
 * ⚠ THIS MODULE EXISTS SO A HARNESS CAN TEST THE REAL RULE. Both halves of this used to be inline: the
 * prefix match in NavLink, the parent set in WorkspaceSidebar. A harness written against them could only
 * re-implement them, and a harness that re-implements the thing it is testing passes every break applied to
 * the real code -- which is exactly what happened when the derivation was first proven. Both functions below
 * are imported by the component AND by scripts/sidebar-active-harness.ts, so breaking one turns the other red.
 *
 * These are pure and free of next/navigation, so a node script can call them.
 */

/**
 * Which hrefs in a nav are PARENTS, derived rather than remembered.
 *
 * An href that is a strict prefix of another entry is a parent, and a parent must match exactly or it stays
 * highlighted on every one of its children -- two rows lit, and a sidebar that no longer says where you are.
 *
 * ⚠ THE BOUNDARY IS `+ "/"`, NOT A BARE startsWith. /super-admin/ai is not the parent of
 * /super-admin/ai-gateway, and a bare prefix test would say it was.
 */
export function parentHrefs(items: { href: string }[]): Set<string> {
  const all = items.map(i => i.href.split("?")[0]);
  return new Set(all.filter(h => all.some(other => other !== h && other.startsWith(h + "/"))));
}

/**
 * Does `href` describe the page at `pathname`?
 *
 * A leaf matches its own sub-tree, so /settings stays lit on /settings/profile. A parent (`exact`) matches
 * only itself. Query matching is NavLink's own concern -- this is the path half.
 */
export function pathMatches(href: string, pathname: string, exact: boolean): boolean {
  const path = href.split("?")[0];
  return exact ? pathname === path : pathname === path || pathname.startsWith(path + "/");
}

export type RowTone = "active" | "section" | "idle";

/**
 * What treatment a PARENT row takes, given where the reader is.
 *
 * ⚠ THE CASE THIS EXISTS FOR: every expandable group in the Product Director sidebar repeats its own href
 * as its first child -- "Configuration Overview" IS /pd/configuration. On that page the parent matches
 * exactly AND a child matches, so a rule of "self wins" paints the parent and the child with the SAME
 * full fill: two identical pills on eight screens, which is precisely the ambiguity the `section` tone
 * was introduced to prevent. The owner read it off the screen before any harness did.
 *
 * Expanded, the child row is the one that represents the page and the parent yields to it. Collapsed to
 * the rail the child is not rendered at all, so the parent keeps the full treatment: it is then the only
 * row that could carry it, and yielding would leave the workspace showing nothing at all.
 */
export function parentTone(a: {
  selfActive: boolean;
  childActive: boolean;
  /** does one of this item's children point at the item's own href? */
  selfIsAChild: boolean;
  rail: boolean;
  expanded: boolean;
}): RowTone {
  if (a.rail) return a.selfActive || a.childActive ? "active" : "idle";
  if (a.expanded && a.selfIsAChild && a.selfActive) return "section";
  if (a.selfActive) return "active";
  return a.childActive ? "section" : "idle";
}
