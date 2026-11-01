"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { clampSize, keyboardSize, maxBesideSibling, parseStoredSize } from "./resizable-math";

// Drag-to-resize panes, for any screen (owner request 1 Nov 2026). Three exports:
//
//   useResizable({ storageKey, axis, defaultPx?, minPx, maxPx, container? })
//       -> { size, min, max, handleProps, reset, bindTarget }   (bindTarget is a callback ref)
//     One size in px along `axis` ("x" = a width, "y" = a height). With `defaultPx` null/omitted `size` is null until
//     the user (or localStorage) sets one: let CSS size the pane and attach `bindTarget` to it so the handle starts
//     from its real size. `defaultPx` and `maxPx` may be numbers or functions of the container size in px (the
//     `container` element, else the window; get the element with a callback ref held in state). The size persists per browser under `storageKey` (try/catch, read
//     after mount so server and client render the same first paint). `reset()` forgets it.
//
//   <ResizeHandle {...handleProps} label="Resize the ..." className="hidden md:block" />
//     A WAI-ARIA separator (role="separator", aria-valuemin/max/now in px, tabIndex 0). Pointer drag (pointer capture),
//     arrow keys +-16px (Shift +-64; x: Left/Right, y: Up/Down), Home/End = min/max, double-click = reset.
//     Hit area grows to var(--cmp-touch-min) on pointer-coarse. Place it at the END edge of the pane it sizes.
//
//   <ResizableColumns storageKey left right defaultLeft? minLeft? maxLeft? minRight? label? className? />
//     Two panes side by side with a draggable divider from the `md` breakpoint up; below `md` the children simply
//     stack as before (no handle, CPR-MOB-001). The left pane is the resizable one (default range 240px to 60% of the
//     container, always leaving the right pane minRight = 420px).
//
// Below `md` the caller decides what to do with a size: hide the handle with `hidden md:block` and apply the size
// only in an `md:` class (for example md:[height:var(--x)]).

const HANDLE_GUTTER_PX = 44;   // the widest the divider column gets (pointer-coarse), kept out of the left pane's maximum

export type ResizeAxis = "x" | "y";
type Px = number | ((containerPx: number) => number);

export type ResizeHandleProps = { axis: ResizeAxis; value: number; min: number; max: number; onChange: (px: number, commit: boolean) => void; onReset: () => void };

export function useResizable<T extends HTMLElement = HTMLElement>({ storageKey, axis, defaultPx = null, minPx, maxPx, container }: {
  storageKey: string; axis: ResizeAxis; defaultPx?: Px | null; minPx: number; maxPx: Px; container?: HTMLElement | null;
}) {
  const dim = axis === "x" ? "width" : "height";
  const [chosen, setChosen] = useState<number | null>(null);        // set by the user or read from storage
  const [box, setBox] = useState({ container: 0, target: 0 });
  const [target, bindTarget] = useState<T | null>(null);       // a callback ref: attach it as ref={bindTarget}

  useEffect(() => {
    // Read after mount on purpose: the server and the first client render both show the default.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { const v = parseStoredSize(window.localStorage.getItem(storageKey)); if (v != null) setChosen(v); } catch { /* storage unavailable: this session only */ }
  }, [storageKey]);

  useEffect(() => {
    const read = () => {
      const c = container ? container.getBoundingClientRect()[dim] : axis === "x" ? window.innerWidth : window.innerHeight;
      const t = target ? target.getBoundingClientRect()[dim] : 0;
      setBox(b => (b.container === Math.round(c) && b.target === Math.round(t) ? b : { container: Math.round(c), target: Math.round(t) }));
    };
    read();
    window.addEventListener("resize", read);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(read);
      if (container) ro.observe(container);
      if (target) ro.observe(target);
    }
    return () => { window.removeEventListener("resize", read); ro?.disconnect(); };
  }, [axis, dim, container, target]);

  const measured = box.container > 0;
  const max = typeof maxPx === "function" ? (measured ? maxPx(box.container) : Number.MAX_SAFE_INTEGER) : maxPx;
  const fallback = defaultPx == null ? null : typeof defaultPx === "function" ? (measured ? defaultPx(box.container) : null) : defaultPx;
  const raw = chosen ?? fallback;
  const size = raw == null ? null : clampSize(raw, minPx, max);
  const value = size ?? clampSize(box.target || minPx, minPx, max);

  const onChange = useCallback((px: number, commit: boolean) => {
    const next = clampSize(px, minPx, max);
    setChosen(next);
    if (commit) { try { window.localStorage.setItem(storageKey, String(next)); } catch { /* ignore */ } }
  }, [minPx, max, storageKey]);
  const reset = useCallback(() => {
    setChosen(null);
    try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
  }, [storageKey]);

  const handleProps: ResizeHandleProps = { axis, value, min: minPx, max, onChange, onReset: reset };
  return { size, min: minPx, max, handleProps, reset, bindTarget };
}

export function ResizeHandle({ axis, value, min, max, onChange, onReset, label, className = "" }: ResizeHandleProps & { label: string; className?: string }) {
  const drag = useRef<{ start: number; from: number; last: number } | null>(null);
  const [active, setActive] = useState(false);
  const x = axis === "x";
  const pos = (e: { clientX: number; clientY: number }) => (x ? e.clientX : e.clientY);
  const finish = () => { const d = drag.current; drag.current = null; setActive(false); if (d) onChange(d.last, true); };
  return (
    <div role="separator" aria-orientation={x ? "vertical" : "horizontal"} aria-label={label} tabIndex={0}
      aria-valuemin={min} aria-valuemax={max < 1_000_000 ? max : undefined} aria-valuenow={value} aria-valuetext={`${value} pixels`}
      title="Drag to resize. Double-click to reset."
      style={{ touchAction: "none", cursor: x ? "col-resize" : "row-resize" } as CSSProperties}
      className={`group relative select-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal-700 ${x ? "w-5 pointer-coarse:w-[var(--cmp-touch-min)]" : "h-3 w-full pointer-coarse:h-[var(--cmp-touch-min)]"} ${className}`}
      onPointerDown={e => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { start: pos(e), from: value, last: value };
        setActive(true);
      }}
      onPointerMove={e => {
        const d = drag.current; if (!d) return;
        d.last = clampSize(d.from + (pos(e) - d.start), min, max);
        onChange(d.last, false);
      }}
      onPointerUp={finish} onPointerCancel={finish}
      onKeyDown={e => {
        const next = keyboardSize(e.key, e.shiftKey, axis, value, min, max);
        if (next == null) return;
        e.preventDefault(); onChange(next, true);
      }}
      onDoubleClick={onReset}>
      <span aria-hidden className={`pointer-events-none absolute ${x ? "inset-y-0 left-1/2 w-0.5 -translate-x-1/2" : "inset-x-0 top-1/2 h-0.5 -translate-y-1/2"} ${active ? "bg-teal-600" : "bg-transparent group-hover:bg-teal-600 group-focus-visible:bg-teal-600"}`} />
      <span aria-hidden className={`pointer-events-none flex items-center justify-center gap-[3px] rounded-full ${x ? "sticky top-[40vh] mx-auto h-8 w-1.5 flex-col" : "absolute left-1/2 top-1/2 h-1.5 w-8 -translate-x-1/2 -translate-y-1/2 flex-row"} ${active ? "bg-teal-600" : "bg-gray-400 group-hover:bg-teal-600 group-focus-visible:bg-teal-600"}`}>
        {[0, 1, 2].map(i => <span key={i} className="h-0.5 w-0.5 rounded-full bg-white" />)}
      </span>
    </div>
  );
}

export function ResizableColumns({ storageKey, left, right, defaultLeft = 320, minLeft = 240, maxLeft, minRight = 420, label = "Resize the panel", className = "" }: {
  storageKey: string; left: ReactNode; right: ReactNode;
  /** px; the left pane's width before the user resizes it. */
  defaultLeft?: number; minLeft?: number;
  /** px, or a function of the container width; default 60% of it, leaving `minRight` px to the right pane. */
  maxLeft?: Px; minRight?: number; label?: string; className?: string;
}) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const { size, handleProps } = useResizable({
    storageKey, axis: "x", defaultPx: defaultLeft, minPx: minLeft, container: box,
    maxPx: maxLeft ?? (c => maxBesideSibling(c, { min: minLeft, minOther: minRight, gutter: HANDLE_GUTTER_PX })),
  });
  return (
    <div ref={setBox} className={`grid gap-5 md:grid-cols-[var(--rz-w)_auto_minmax(0,1fr)] md:gap-0 ${className}`} style={{ "--rz-w": `${size ?? defaultLeft}px` } as CSSProperties}>
      {left}
      <ResizeHandle {...handleProps} label={label} className="hidden md:block" />
      {right}
    </div>
  );
}
