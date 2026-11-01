// Pure rules for drag-to-resize panes (see resizable.tsx). No DOM: callers pass measurements in, so the limits are unit-tested.

export const RESIZE_STEP = 16;
export const RESIZE_STEP_SHIFT = 64;

const finite = (n: number, fallback: number) => (Number.isFinite(n) ? n : fallback);

/** Keep `size` between `min` and `max` (rounded to a whole pixel). A max under the min yields the min. */
export function clampSize(size: number, min: number, max: number): number {
  const hi = Math.max(min, finite(max, min));
  return Math.min(hi, Math.max(min, Math.round(finite(size, min))));
}

/** The largest size a pane may take beside a sibling: `fraction` of the container, but leaving `minOther` px (plus `gutter`) to the sibling; never under `min`. */
export function maxBesideSibling(containerPx: number, opts: { min: number; fraction?: number; minOther?: number; gutter?: number }): number {
  const c = finite(containerPx, 0);
  const byFraction = Math.floor(c * (opts.fraction ?? 0.6));
  const bySibling = Math.floor(c - (opts.gutter ?? 0) - (opts.minOther ?? 0));
  return Math.max(opts.min, Math.min(byFraction, bySibling));
}

/** A stored value back to a whole number of pixels, or null when absent, malformed or not positive. */
export function parseStoredSize(raw: string | null | undefined): number | null {
  if (raw == null || !/^\d{1,5}(\.\d+)?$/.test(raw.trim())) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * The next size for a key pressed on a separator, or null when the key is not one it handles.
 * axis "x": ArrowRight grows, ArrowLeft shrinks. axis "y": ArrowDown grows, ArrowUp shrinks.
 * Shift = a bigger step. Home = min, End = max.
 */
export function keyboardSize(key: string, shift: boolean, axis: "x" | "y", now: number, min: number, max: number): number | null {
  const step = shift ? RESIZE_STEP_SHIFT : RESIZE_STEP;
  const grow = axis === "x" ? "ArrowRight" : "ArrowDown";
  const shrink = axis === "x" ? "ArrowLeft" : "ArrowUp";
  if (key === grow) return clampSize(now + step, min, max);
  if (key === shrink) return clampSize(now - step, min, max);
  if (key === "Home") return clampSize(min, min, max);
  if (key === "End") return clampSize(max, min, max);
  return null;
}
