// The selection model behind "move several domains to an Area" in the Framework Design Studio explorer. Pure: sets of
// domain ids in, sets out (never mutated).

export type SelState = "none" | "some" | "all";

export function toggleId(sel: ReadonlySet<string>, id: string): Set<string> {
  const n = new Set(sel);
  if (n.has(id)) n.delete(id); else n.add(id);
  return n;
}

/** "Select all in this Area": adds every id of the group, keeps the rest of the selection. */
export function selectAllIn(sel: ReadonlySet<string>, groupIds: readonly string[]): Set<string> {
  return new Set([...sel, ...groupIds]);
}

/** "Clear". */
export const clearSelection = (): Set<string> => new Set();

/** Only ids still shown: a filtered list (or a domain that no longer exists) keeps no hidden selection. */
export function keepVisible(sel: ReadonlySet<string>, visibleIds: readonly string[]): Set<string> {
  const v = new Set(visibleIds);
  return new Set([...sel].filter(id => v.has(id)));
}

export function groupState(sel: ReadonlySet<string>, groupIds: readonly string[]): SelState {
  const n = groupIds.filter(id => sel.has(id)).length;
  return n === 0 ? "none" : n === groupIds.length ? "all" : "some";
}

/** The selected domains that actually change Area, in display order (a domain already in the target is skipped). */
export function toMove(sel: ReadonlySet<string>, domains: readonly { id: string; areaId?: string | null }[], targetAreaId: string | null): string[] {
  return domains.filter(d => sel.has(d.id) && (d.areaId ?? null) !== targetAreaId).map(d => d.id);
}

export const bulkProgress = (done: number, total: number) => `Moving ${Math.min(done + 1, total)} of ${total}…`;
export const announceBulkDone = (moved: number, area: string | null) => `Moved ${moved} ${moved === 1 ? "domain" : "domains"} ${area ? `to the Area ${area}` : "out of their Areas. They are now unassigned"}.`;
export const announceBulkStopped = (moved: number, total: number, domain: string, why: string) => `Moved ${moved} of ${total}. Stopped at ${domain}: ${why}`;
