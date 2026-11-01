"use client";

import { Children, useState, type CSSProperties, type ReactNode } from "react";
import { ResizeHandle, useResizable, type ResizeHandleProps } from "./resizable";
import { maxBesideSibling } from "./resizable-math";

// ONE shared helper for drag-to-resize side panes beside a main column (owner request 1 Nov 2026, "a capability throughout
// Competen"; one resize API, no parallel infrastructure). It sits on useResizable/ResizeHandle (resizable.tsx), where a
// pane BEFORE its handle is side "start" and a pane AFTER it is side "end"; aria-valuenow is always the pane's real px.
//
//   usePaneGrid({ container?, minMain?, start?: PaneOpt, end?: PaneOpt })
//       -> [bind, { style, ready, start: { size, handleProps }, end: { size, handleProps } }]
//     For screens that keep their own grid markup (a client component, or a handle deep in the tree). Attach `bind` (a tuple, so the lint rule for refs sees a plain callback ref) to the
//     grid element (or pass your own `container` element held in state), spread `style` on it (CSS variables --rz-s / --rz-e
//     = the start / end pane px, --rz-m = the main track, minmax(0,1fr) once measured) and render a <ResizeHandle
//     {...g.end.handleProps} label=... /> where the divider belongs. A PaneOpt is { storageKey, defaultPx (px, or a function
//     of the container width), minPx = 200, fallback? } ; `fallback` is the CSS track used until the container is measured
//     when defaultPx is a function. Limits: a single pane may take at most 60% of the container; with two, each leaves the
//     other at least its minimum; the main column always keeps `minMain` px (default 420) where it can.
//
//   <PaneGrid bp="lg" endBp="xl" gap? start={PaneOpt & {label, node?}} end={...} minMain? fallbackMain? endFirst? display? className?>
//     The multi-column grid itself: [start pane] [handle] main [handle] [end pane], from breakpoint `bp` up (the start pane,
//     else the end pane) and `endBp` (the end pane joins there; default `bp`, never lower). Breakpoints are media
//     "md" | "lg" | "xl" | "2xl", or the container query "@36rem" (@min-[36rem], inside an @container wrapper this adds);
//     below the breakpoint the parts stack in DOM order with no handle, exactly as before (CPR-MOB-001). A pane's `node` is
//     the grid item you render; without it the pane is the first (start) / last (end) child, wrapped in a stretch cell so a
//     sticky child keeps working, and the other children are the main column. The handle takes over the gap (`gap`, default
//     gap-5) so the layout is the same at the default sizes. `fallbackMain` is the main track used until measured (e.g.
//     "minmax(0,3fr)" beside a pane with fallback "minmax(0,2fr)"). `endFirst`: the end pane comes first in the DOM (its own
//     classes place it with <bp>:col-start-N). `display="bp"`: the grid exists only from `bp` (block below it).
//
//   <ResizableList storageKey defaultPx className label>list</ResizableList>
//     A scroll region whose fixed max-height becomes draggable from `md` up (handle underneath; className keeps the old max-h).

type Px = number | ((containerPx: number) => number);
/** `{ ratio, gutter? }`: a share of the measured container (minus gutter px) -- plain data, so a SERVER page can pass it
 *  (a function prop cannot cross the server/client boundary and crashes the page render). */
export type PxRatio = { ratio: number; gutter?: number };
export type PaneOpt = { storageKey: string; defaultPx: Px | PxRatio; minPx?: number; fallback?: string };
const toPx = (v: Px | PxRatio): Px => (typeof v === "object" ? (c: number) => Math.round((c - (v.gutter ?? 20)) * v.ratio) : v);
export type PaneSide = PaneOpt & { label: string; node?: ReactNode };
export type PaneBp = "md" | "lg" | "xl" | "2xl" | "@36rem";

const HANDLE_GUTTER_PX = 44;   // the widest a handle column gets (pointer-coarse), kept out of the pane maximum
const MIN_PANE_PX = 200;
const MIN_MAIN_PX = 420;

// Tailwind needs whole class names, so each breakpoint x shape is spelled out. S = start pane + main, E = main + end pane,
// SE = all three; --rz-m is the main track (see PaneGrid).
const BP: Record<PaneBp, { S: string; E: string; SE: string; gap: string; show: string; grid: string; place2: string; wrap: string }> = {
  md: { S: "md:grid-cols-[var(--rz-s)_auto_var(--rz-m)]", E: "md:grid-cols-[var(--rz-m)_auto_var(--rz-e)]", SE: "md:grid-cols-[var(--rz-s)_auto_var(--rz-m)_auto_var(--rz-e)]", gap: "md:gap-x-0", show: "hidden md:block", grid: "md:grid", place2: "md:col-start-2 md:row-start-1", wrap: "" },
  lg: { S: "lg:grid-cols-[var(--rz-s)_auto_var(--rz-m)]", E: "lg:grid-cols-[var(--rz-m)_auto_var(--rz-e)]", SE: "lg:grid-cols-[var(--rz-s)_auto_var(--rz-m)_auto_var(--rz-e)]", gap: "lg:gap-x-0", show: "hidden lg:block", grid: "lg:grid", place2: "lg:col-start-2 lg:row-start-1", wrap: "" },
  xl: { S: "xl:grid-cols-[var(--rz-s)_auto_var(--rz-m)]", E: "xl:grid-cols-[var(--rz-m)_auto_var(--rz-e)]", SE: "xl:grid-cols-[var(--rz-s)_auto_var(--rz-m)_auto_var(--rz-e)]", gap: "xl:gap-x-0", show: "hidden xl:block", grid: "xl:grid", place2: "xl:col-start-2 xl:row-start-1", wrap: "" },
  "2xl": { S: "2xl:grid-cols-[var(--rz-s)_auto_var(--rz-m)]", E: "2xl:grid-cols-[var(--rz-m)_auto_var(--rz-e)]", SE: "2xl:grid-cols-[var(--rz-s)_auto_var(--rz-m)_auto_var(--rz-e)]", gap: "2xl:gap-x-0", show: "hidden 2xl:block", grid: "2xl:grid", place2: "2xl:col-start-2 2xl:row-start-1", wrap: "" },
  "@36rem": { S: "@min-[36rem]:grid-cols-[var(--rz-s)_auto_var(--rz-m)]", E: "@min-[36rem]:grid-cols-[var(--rz-m)_auto_var(--rz-e)]", SE: "@min-[36rem]:grid-cols-[var(--rz-s)_auto_var(--rz-m)_auto_var(--rz-e)]", gap: "@min-[36rem]:gap-x-0", show: "hidden @min-[36rem]:block", grid: "@min-[36rem]:grid", place2: "@min-[36rem]:col-start-2 @min-[36rem]:row-start-1", wrap: "@container" },
};

export type PaneGridState = { size: number | null; handleProps: ResizeHandleProps };

export function usePaneGrid({ container, minMain = MIN_MAIN_PX, start, end }: {
  /** The grid element held in state; omit it to use `bind` as the grid's callback ref. */
  container?: HTMLElement | null; minMain?: number; start?: PaneOpt; end?: PaneOpt;
}) {
  const [own, bind] = useState<HTMLElement | null>(null);
  const box = container !== undefined ? container : own;
  const both = !!start && !!end;
  const gutters = (start ? HANDLE_GUTTER_PX : 0) + (end ? HANDLE_GUTTER_PX : 0);
  const sMin = start?.minPx ?? MIN_PANE_PX, eMin = end?.minPx ?? MIN_PANE_PX;
  // One pane: up to 60% of the container. Two: each leaves the other at least its minimum (the end pane leaves the start pane its current size).
  const S = useResizable({
    storageKey: start?.storageKey ?? "", axis: "x", side: "start", defaultPx: start ? toPx(start.defaultPx) : sMin, minPx: sMin, container: box,
    maxPx: c => (both ? Math.max(sMin, c - gutters - minMain - eMin) : maxBesideSibling(c, { min: sMin, minOther: minMain, gutter: HANDLE_GUTTER_PX })),
  });
  const E = useResizable({
    storageKey: end?.storageKey ?? "", axis: "x", side: "end", defaultPx: end ? toPx(end.defaultPx) : eMin, minPx: eMin, container: box,
    maxPx: c => (both ? Math.max(eMin, c - gutters - minMain - (S.size ?? sMin)) : maxBesideSibling(c, { min: eMin, minOther: minMain, gutter: HANDLE_GUTTER_PX })),
  });
  const ready = (!start || S.size != null) && (!end || E.size != null);
  const track = (p: PaneOpt | undefined, size: number | null, min: number) => (size != null ? `${size}px` : p?.fallback ?? `${min}px`);
  const style = { "--rz-s": track(start, S.size, sMin), "--rz-e": track(end, E.size, eMin) } as CSSProperties;
  return [bind, { style, ready, start: { size: S.size, handleProps: S.handleProps } as PaneGridState, end: { size: E.size, handleProps: E.handleProps } as PaneGridState }] as const;
}

const cell = (n: ReactNode) => <div className="min-w-0 self-stretch">{n}</div>;

export function PaneGrid({ bp = "lg", endBp, start, end, minMain = MIN_MAIN_PX, fallbackMain, endFirst = false, display = "grid", gap = "gap-5", className = "", children }: {
  bp?: PaneBp; endBp?: PaneBp; start?: PaneSide; end?: PaneSide; minMain?: number; fallbackMain?: string; endFirst?: boolean;
  /** "bp": the grid exists only from `bp` up (below it the parts are plain blocks). */
  display?: "grid" | "bp"; gap?: string; className?: string; children: ReactNode;
}) {
  const [bindGrid, g] = usePaneGrid({ minMain, start, end });
  const bs = BP[bp], be = BP[endBp ?? bp];
  // The start pane alone from `bp`, the end pane joining at `endBp`; with no start pane the end one starts at its own breakpoint.
  const shape = !start ? be.E : !end ? bs.S : be === bs ? bs.SE : `${bs.S} ${be.SE}`;
  const lead = start ? bs : be;
  const wrap = lead.wrap || be.wrap;

  let main: ReactNode = children, sNode = start?.node, eNode = end?.node;
  if ((start && sNode == null) || (end && eNode == null)) {
    let kids = Children.toArray(children);
    if (start && sNode == null) { sNode = cell(kids[0]); kids = kids.slice(1); }
    if (end && eNode == null) { eNode = cell(kids[kids.length - 1]); kids = kids.slice(0, -1); }
    main = kids;
  }
  const startHandle = start && <ResizeHandle {...g.start.handleProps} label={start.label} className={`${bs.show} self-stretch`} />;
  const endHandle = end && <ResizeHandle {...g.end.handleProps} label={end.label} className={`${be.show} self-stretch ${endFirst ? be.place2 : ""}`} />;
  const grid = (
    <div ref={bindGrid} className={`${display === "grid" ? "grid grid-cols-1" : lead.grid} ${gap} ${shape} ${lead.gap} ${className}`}
      style={{ ...g.style, "--rz-m": g.ready ? "minmax(0,1fr)" : fallbackMain ?? "minmax(0,1fr)" } as CSSProperties}>
      {endFirst ? <>{eNode}{endHandle}{main}</> : <>{sNode}{startHandle}{main}{endHandle}{eNode}</>}
    </div>
  );
  return wrap ? <div className={wrap}>{grid}</div> : grid;
}

export function ResizableList({ storageKey, defaultPx, minPx = 160, maxPx = 960, label, className = "", children }: {
  storageKey: string; defaultPx: number; minPx?: number; maxPx?: number; label: string; className?: string; children: ReactNode;
}) {
  const H = useResizable({ storageKey, axis: "y", defaultPx, minPx, maxPx });
  return (
    <>
      <div className={`${className} md:max-h-[var(--rz-h)]`} style={{ "--rz-h": `${H.size}px` } as CSSProperties}>{children}</div>
      <ResizeHandle {...H.handleProps} label={label} className="hidden md:block" />
    </>
  );
}
