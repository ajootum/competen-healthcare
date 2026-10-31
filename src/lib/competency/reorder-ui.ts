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

// ── FRAMEWORK-DESIGN-STUDIO-02 S2: pointer drag (touch and mouse), replacing native HTML5 drag ─────────────────────
// Native drag-and-drop does not start on touch screens. A drag now starts on pointerdown on a row's grip, becomes a drag
// only after the pointer has moved a small distance (so a tap or a scroll is never a drag), and ends on pointerup.
// A drop counts only inside the list the drag started in (the same `key` as today): never across parents.

/** Pixels the pointer must travel before a press on a grip becomes a drag. */
export const DRAG_THRESHOLD = 6;

export type PointerDrag = { key: string; index: number; x0: number; y0: number; active: boolean; over: number | null };

/** Pure: a press on the grip of item `index` of list `key`. */
export const startPointerDrag = (key: string, index: number, x: number, y: number): PointerDrag => ({ key, index, x0: x, y0: y, active: false, over: null });

/** Pure: the drag after the pointer moved to (x, y), over the row `hit` (its list key and index) if any. Becomes active once the threshold is passed. */
export function movePointerDrag(s: PointerDrag, x: number, y: number, hit: { key: string; index: number } | null, threshold = DRAG_THRESHOLD): PointerDrag {
  const active = s.active || Math.hypot(x - s.x0, y - s.y0) >= threshold;
  if (!active) return s;
  return { ...s, active, over: hit && hit.key === s.key ? hit.index : null };
}

/** Pure: where a finished drag lands: null for a tap, a drag that never became active, or a drop outside the list or on the starting row. */
export function dropOf(s: PointerDrag): { from: number; to: number } | null {
  return s.active && s.over !== null && s.over !== s.index ? { from: s.index, to: s.over } : null;
}

/** Pure: reads a row's list key and index from its data attributes (strings from the DOM). */
export function readDropTarget(key: string | undefined, index: string | undefined): { key: string; index: number } | null {
  const i = Number(index);
  return key && index !== undefined && index !== "" && Number.isInteger(i) && i >= 0 ? { key, index: i } : null;
}
