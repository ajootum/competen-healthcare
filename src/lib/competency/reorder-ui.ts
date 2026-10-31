// ── FRAMEWORK-DESIGN-STUDIO-01 slice C: the pure parts of the Studio's reorder controls ─────────────────────────
// Client-safe and profession-agnostic: positions, steps and the words a screen reader hears. The order itself is
// decided by the server (framework-layout.ts); these helpers only compute the list the editor asked for.

/** Pure: a copy of `list` with the item at `from` moved to `to`. Out-of-range or equal indexes return an unchanged copy. */
export function moveInArray<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from === to || from < 0 || to < 0 || from >= out.length || to >= out.length) return out;
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

/** Pure: the index a Move up (-1) or Move down (+1) button leads to, or null at either end. */
export function stepTarget(index: number, dir: -1 | 1, length: number): number | null {
  const to = index + dir;
  return index < 0 || index >= length || to < 0 || to >= length ? null : to;
}

/** Pure: a short, single-line label for a long item (a criterion's wording) in a spoken message. */
export function shortName(name: string, max = 60): string {
  const t = name.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Pure: what the polite live region says after a move. `to` is zero-based. */
export function announceMove(name: string, to: number, total: number): string {
  return `Moved ${shortName(name)} to position ${to + 1} of ${total}.`;
}
