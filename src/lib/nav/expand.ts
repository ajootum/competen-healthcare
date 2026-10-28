/**
 * HQ-NAV-EXPAND-01 — which sidebar parents are open, in ONE place.
 *
 * A parent with children (a workspace, or an item such as Competency Delivery) is a disclosure, not a
 * link: tapping it opens or closes its submenu and never navigates. Its own landing page, when it has one,
 * becomes the submenu's first row, "Overview". This module holds the two rules that decide it, pure and
 * free of React and next/navigation, so the component and its tests run the same code.
 *
 * Pure. No I/O.
 */

/** What the person last did to one parent, and on which page they did it. */
export type ToggleRecord = { open: boolean; at: string };

/**
 * Is this parent open?
 *
 * - The parent of the page you are on opens by itself when you ARRIVE there (directive s4).
 * - A choice made on THIS page wins, so you can close the active parent and it stays closed.
 * - A choice made elsewhere is kept for every parent that does not hold the page you are on, so what you
 *   opened stays open while you move around (s4, "expanded state is kept during navigation").
 * - Nothing else is open. Several parents may be open at once: there is no accordion.
 */
export function isParentOpen(containsActive: boolean, record: ToggleRecord | undefined, pathname: string): boolean {
  if (record && (record.at === pathname || !containsActive)) return record.open;
  return containsActive;
}

/**
 * The submenu of an item that has children: its own page first, as "Overview", then its children.
 * The Overview row IS the parent's href, so every route stays reachable and none changes (s2).
 */
export function submenuWithOverview<T extends { key?: string; href: string; label: string; icon: string }>(
  parent: T,
  children: T[],
): (T | { key: string; label: string; href: string; icon: string })[] {
  if (children.some(c => c.href === parent.href)) return children;
  return [{ key: `${parent.key ?? parent.href}.overview`, label: "Overview", href: parent.href, icon: "" }, ...children];
}
