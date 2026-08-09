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
