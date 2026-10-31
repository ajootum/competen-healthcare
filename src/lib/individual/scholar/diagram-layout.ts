// SCHOLAR-COMPANION-01 P2: the deterministic layout behind the Scholar answer diagrams. Pure and client-safe: no React, no
// DOM, no randomness, no measuring. Text width is approximated from a fixed character width, so the same data always gives
// the same coordinates (server render, client render and tests agree).
//
//   layoutFlow  layered layout: longest-path layering from the sources, a back edge (a loop) is reversed for layering, long
//               edges are routed through per-layer slots so they never cross a node, nodes are ordered inside a layer by
//               a barycentre sweep, edges are orthogonal polylines that end at a node's edge (the arrowhead goes there).
//   layoutMap   the centre node in the middle, the other nodes on an ellipse around it, grouped by `group`, with the ring
//               grown until no two boxes touch. Edges are straight lines clipped to the boxes.
//   flowOutline / mapOutline  the text alternative: the words of the diagram as plain structure, the source of truth.
//
// Coordinates are SVG user units. Nothing here throws on data that parseFlow / parseMap accepted.

import type { DiagramEdge, FlowData, FlowKind, MapData, MapGroup } from "./answer-format";
import { MAP_CENTER_ID } from "./answer-format";

export const LAYOUT = { charW: 6.9, lineH: 17, tagH: 14, margin: 16, edgeLabelCharW: 6.4, edgeLabelH: 18 } as const;
const FLOW_LAYER_GAP = 52;
const RIGHT_MIN_GAP = 52;

export type Pt = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

/** Greedy word wrap on an approximate character budget. Over-long words are cut; past maxLines the last line ends in an ellipsis. */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (let w of words) {
    while (w.length > maxChars) {
      if (cur) { lines.push(cur); cur = ""; }
      lines.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (!lines.length) return [""];
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] = (last.length >= maxChars ? last.slice(0, maxChars - 1) : last) + "…";
    return kept;
  }
  return lines;
}

const edgeLabelWidth = (t: string) => Math.min(230, Math.round(t.length * LAYOUT.edgeLabelCharW + 14));

// ------------------------------------------------------------------------------------------------------------- flow

export type FlowLayoutNode = Box & { id: string; label: string; kind: FlowKind; lines: string[]; lineY: number[] };
export type FlowLayoutEdge = { from: string; to: string; label?: string; points: Pt[]; labelBox?: Box };
export type FlowLayout = { width: number; height: number; direction: "down" | "right"; nodes: FlowLayoutNode[]; edges: FlowLayoutEdge[] };

function flowBox(kind: FlowKind, label: string): { w: number; h: number; lines: string[] } {
  if (kind === "decision") {
    const lines = wrapText(label, 14, 5);
    return { w: 200, h: Math.max(72, lines.length * LAYOUT.lineH + 44), lines };
  }
  if (kind === "start" || kind === "end") {
    const lines = wrapText(label, 20, 3);
    return { w: 164, h: Math.max(38, lines.length * LAYOUT.lineH + 16), lines };
  }
  const lines = wrapText(label, 22, 4);
  return { w: 164, h: Math.max(40, lines.length * LAYOUT.lineH + 18), lines };
}

/** Layer of every node (0 = sources) and the edges that close a loop (they are drawn reversed through the layers). */
export function flowLayers(data: Pick<FlowData, "nodes" | "edges">): { layerOf: Map<string, number>; back: Set<number> } {
  const ids = data.nodes.map(n => n.id);
  const out = new Map<string, number[]>(ids.map(id => [id, []]));
  const hasIn = new Set<string>();
  data.edges.forEach((e, i) => { out.get(e.from)?.push(i); hasIn.add(e.to); });
  // Depth-first search in input order, sources first: an edge into a node still on the stack closes a loop.
  const state = new Map<string, 0 | 1 | 2>(ids.map(id => [id, 0]));
  const back = new Set<number>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const ei of out.get(id) ?? []) {
      const to = data.edges[ei].to, st = state.get(to);
      if (st === 1) back.add(ei);
      else if (st === 0) visit(to);
    }
    state.set(id, 2);
  };
  for (const id of ids) if (!hasIn.has(id) && state.get(id) === 0) visit(id);
  for (const id of ids) if (state.get(id) === 0) visit(id);
  // Longest path over the forward edges: relax until stable (the forward edges are acyclic, so n rounds is enough).
  const layerOf = new Map<string, number>(ids.map(id => [id, 0]));
  for (let round = 0; round <= ids.length; round++) {
    let changed = false;
    data.edges.forEach((e, i) => {
      if (back.has(i)) return;
      const want = (layerOf.get(e.from) ?? 0) + 1;
      if (want > (layerOf.get(e.to) ?? 0)) { layerOf.set(e.to, want); changed = true; }
    });
    if (!changed) break;
  }
  return { layerOf, back };
}

type Item = { key: string; node: number; sa: number; sc: number; layer: number };

export function layoutFlow(data: FlowData, direction: "down" | "right" = data.direction): FlowLayout {
  const { layerOf, back } = flowLayers(data);
  const down = direction === "down";
  const boxes = data.nodes.map(n => flowBox(n.kind, n.label));

  // Items: one per node, plus a slot per layer an edge passes through.
  const items = new Map<string, Item>();
  data.nodes.forEach((n, i) => {
    const b = boxes[i];
    items.set(n.id, { key: n.id, node: i, sa: down ? b.h : b.w, sc: down ? b.w : b.h, layer: layerOf.get(n.id) ?? 0 });
  });
  const chains: string[][] = [];
  data.edges.forEach((e, ei) => {
    const lo = back.has(ei) ? e.to : e.from, hi = back.has(ei) ? e.from : e.to;
    const chain = [lo];
    for (let l = (layerOf.get(lo) ?? 0) + 1; l < (layerOf.get(hi) ?? 0); l++) {
      const key = `~${ei}.${l}`;
      items.set(key, { key, node: -1, sa: 0, sc: 12, layer: l });
      chain.push(key);
    }
    chain.push(hi);
    chains.push(chain);
  });
  const layerCount = Math.max(0, ...[...items.values()].map(it => it.layer)) + 1;

  // Neighbour tables from the chains (the hops between consecutive layers).
  const below = new Map<string, string[]>(), above = new Map<string, string[]>();
  for (const k of items.keys()) { below.set(k, []); above.set(k, []); }
  for (const chain of chains) for (let i = 0; i + 1 < chain.length; i++) { below.get(chain[i])!.push(chain[i + 1]); above.get(chain[i + 1])!.push(chain[i]); }

  // Starting order: layer 0 in node order; each next layer in the order its parents reach it (so yes/no keeps its edge order).
  const layers: string[][] = Array.from({ length: layerCount }, () => []);
  for (const n of data.nodes) if ((items.get(n.id)!.layer) === 0) layers[0].push(n.id);
  for (let l = 1; l < layerCount; l++) {
    const seen = new Set<string>();
    for (const k of layers[l - 1]) for (const nx of below.get(k)!) if (!seen.has(nx)) { seen.add(nx); layers[l].push(nx); }
    for (const it of items.values()) if (it.layer === l && !seen.has(it.key)) { seen.add(it.key); layers[l].push(it.key); }
  }
  // Barycentre sweeps, stable: ties and neighbourless items keep their place.
  const sweep = (l: number, nbr: Map<string, string[]>, ref: string[]) => {
    const pos = new Map(ref.map((k, i) => [k, i]));
    const score = new Map(layers[l].map((k, i) => {
      const ns = nbr.get(k)!.map(x => pos.get(x)).filter((x): x is number => x !== undefined);
      return [k, ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : i] as const;
    }));
    const cur = new Map(layers[l].map((k, i) => [k, i]));
    layers[l] = [...layers[l]].sort((a, b) => (score.get(a)! - score.get(b)!) || (cur.get(a)! - cur.get(b)!));
  };
  for (let round = 0; round < 6; round++) {
    for (let l = 1; l < layerCount; l++) sweep(l, above, layers[l - 1]);
    for (let l = layerCount - 2; l >= 0; l--) sweep(l, below, layers[l + 1]);
  }

  // Layer axis (a): thickness of a layer is its tallest item; the gap holds the edge routing and, to the right, the labels.
  const maxLabelW = Math.max(0, ...data.edges.map(e => (e.label ? edgeLabelWidth(e.label) : 0)));
  const gap = down ? FLOW_LAYER_GAP : Math.max(RIGHT_MIN_GAP, maxLabelW + 28);
  const thickness = layers.map(ks => Math.max(0, ...ks.map(k => items.get(k)!.sa)));
  const aStart: number[] = [];
  let a = LAYOUT.margin;
  for (let l = 0; l < layerCount; l++) { aStart.push(a); a += thickness[l] + gap; }
  const aEnd = a - gap + LAYOUT.margin;
  const aCenter = (l: number) => aStart[l] + thickness[l] / 2;
  const gapMid = (l: number) => aStart[l] + thickness[l] + gap / 2; // the middle of the gap below layer l

  // Cross axis (c): each layer is centred in the widest one.
  const spacing = (x: Item, y: Item) => (x.node >= 0 && y.node >= 0 ? 30 : 18);
  const extent = layers.map(ks => ks.reduce((sum, k, i) => sum + items.get(k)!.sc + (i ? spacing(items.get(ks[i - 1])!, items.get(k)!) : 0), 0));
  const width = Math.max(0, ...extent);
  const cCenter = new Map<string, number>();
  layers.forEach((ks, l) => {
    let c = LAYOUT.margin + (width - extent[l]) / 2;
    ks.forEach((k, i) => {
      const it = items.get(k)!;
      if (i) c += spacing(items.get(ks[i - 1])!, it);
      cCenter.set(k, c + it.sc / 2);
      c += it.sc;
    });
  });
  const cEnd = width + 2 * LAYOUT.margin;
  const at = (av: number, cv: number): Pt => (down ? { x: cv, y: av } : { x: av, y: cv });

  const nodes: FlowLayoutNode[] = data.nodes.map((n, i) => {
    const it = items.get(n.id)!, b = boxes[i];
    const cx = at(aCenter(it.layer), cCenter.get(n.id)!);
    const lineY = b.lines.map((_, li) => cx.y - ((b.lines.length - 1) * LAYOUT.lineH) / 2 + li * LAYOUT.lineH);
    return { id: n.id, label: n.label, kind: n.kind, lines: b.lines, lineY, x: cx.x - b.w / 2, y: cx.y - b.h / 2, w: b.w, h: b.h };
  });

  const edges: FlowLayoutEdge[] = data.edges.map((e, ei) => {
    const chain = chains[ei];
    const raw: Pt[] = [];
    let labelBox: Box | undefined;
    for (let i = 0; i + 1 < chain.length; i++) {
      const u = items.get(chain[i])!, v = items.get(chain[i + 1])!;
      const cu = cCenter.get(u.key)!, cv = cCenter.get(v.key)!;
      const exit = aCenter(u.layer) + (u.node >= 0 ? u.sa / 2 : 0), enter = aCenter(v.layer) - (v.node >= 0 ? v.sa / 2 : 0);
      const mid = gapMid(u.layer);
      raw.push(at(exit, cu), at(mid, cu), at(mid, cv), at(enter, cv));
      if (i === 0 && e.label) {
        const lw = edgeLabelWidth(e.label), straight = cu === cv;
        const centre = at(straight ? mid : mid + gap / 4, cv);
        labelBox = { x: centre.x - lw / 2, y: centre.y - LAYOUT.edgeLabelH / 2, w: lw, h: LAYOUT.edgeLabelH };
      }
    }
    const pts = simplify(raw);
    // A loop edge was laid out from low layer to high; the arrowhead belongs at the original target.
    return { from: e.from, to: e.to, ...(e.label ? { label: e.label } : {}), points: back.has(ei) ? pts.reverse() : pts, ...(labelBox ? { labelBox } : {}) };
  });

  const size = at(aEnd, cEnd);
  return { width: Math.ceil(size.x), height: Math.ceil(size.y), direction, nodes, edges };
}

/** Drop repeated points and the middle point of any three on one line. */
function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    out.push(p);
    while (out.length >= 3) {
      const [p0, p1, p2] = out.slice(-3);
      if ((p0.x === p1.x && p1.x === p2.x) || (p0.y === p1.y && p1.y === p2.y)) out.splice(out.length - 2, 1); else break;
    }
  }
  return out;
}

export type FlowOutlineStep = { n: number; label: string; kind: FlowKind; goes: Array<{ to: number; toLabel: string; label?: string; loop: boolean }> };

/** Text alternative: the steps numbered in layer order, each with where it leads (loops marked). */
export function flowOutline(data: FlowData): FlowOutlineStep[] {
  const { layerOf, back } = flowLayers(data);
  const order = data.nodes.map((n, i) => ({ n, i })).sort((x, y) => ((layerOf.get(x.n.id) ?? 0) - (layerOf.get(y.n.id) ?? 0)) || (x.i - y.i));
  const num = new Map(order.map((o, k) => [o.n.id, k + 1]));
  const label = new Map(data.nodes.map(n => [n.id, n.label]));
  return order.map(({ n }, k) => ({
    n: k + 1, label: n.label, kind: n.kind,
    goes: data.edges.flatMap((e, ei) => e.from === n.id
      ? [{ to: num.get(e.to)!, toLabel: label.get(e.to)!, ...(e.label ? { label: e.label } : {}), loop: back.has(ei) }] : []),
  }));
}

// -------------------------------------------------------------------------------------------------------------- map

export const GROUP_LABEL: Record<MapGroup, string> = { cause: "Cause", feature: "Feature", treatment: "Treatment", other: "" };
const GROUP_ORDER: MapGroup[] = ["cause", "feature", "treatment", "other"];

export type MapLayoutNode = Box & { id: string; label: string; group: MapGroup | "center"; tag: string; lines: string[]; lineY: number[]; tagY?: number };
export type MapLayoutEdge = { from: string; to: string; label?: string; points: Pt[]; labelBox?: Box };
export type MapLayout = { width: number; height: number; nodes: MapLayoutNode[]; edges: MapLayoutEdge[] };

const grow = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, w: b.w + 2 * by, h: b.h + 2 * by });
const touches = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Where the line from the box's centre toward `p` leaves the box. */
function leave(b: Box, p: Pt): Pt {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = p.x - cx, dy = p.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const t = Math.min(dx ? b.w / 2 / Math.abs(dx) : Infinity, dy ? b.h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * t, y: cy + dy * t };
}

export function layoutMap(data: MapData): MapLayout {
  const centerLines = wrapText(data.center, 18, 4);
  const centerBox = { w: 176, h: Math.max(56, centerLines.length * LAYOUT.lineH + 22) };
  const ordered = data.nodes.map((n, i) => ({ n, i })).sort((x, y) => (GROUP_ORDER.indexOf(x.n.group) - GROUP_ORDER.indexOf(y.n.group)) || (x.i - y.i)).map(o => o.n);
  const sizes = ordered.map(n => {
    const lines = wrapText(n.label, 16, 5), tag = GROUP_LABEL[n.group];
    return { lines, tag, w: 140, h: Math.max(42, lines.length * LAYOUT.lineH + 18 + (tag ? LAYOUT.tagH : 0)) };
  });

  // Ellipse around the centre, nodes spread evenly starting at the top; grown until nothing touches (centre gets room for labels).
  let rx = 190, ry = 135;
  const place = () => ordered.map((_, i) => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / ordered.length;
    return { x: Math.cos(ang) * rx, y: Math.sin(ang) * ry };
  });
  const rects = (pos: Pt[]): Box[] => pos.map((p, i) => ({ x: p.x - sizes[i].w / 2, y: p.y - sizes[i].h / 2, w: sizes[i].w, h: sizes[i].h }));
  const centerRect: Box = { x: -centerBox.w / 2, y: -centerBox.h / 2, w: centerBox.w, h: centerBox.h };
  for (let guard = 0; guard < 80; guard++) {
    const rs = rects(place());
    const bad = rs.some((r, i) => touches(grow(r, 7), grow(centerRect, 24)) || rs.some((q, j) => j > i && touches(grow(r, 7), grow(q, 7))));
    if (!bad) break;
    rx *= 1.05; ry *= 1.05;
  }
  const pos = place(), rs = rects(pos);
  const all = [centerRect, ...rs];
  const minX = Math.min(...all.map(b => b.x)), minY = Math.min(...all.map(b => b.y));
  const maxX = Math.max(...all.map(b => b.x + b.w)), maxY = Math.max(...all.map(b => b.y + b.h));
  const dx = LAYOUT.margin - minX, dy = LAYOUT.margin - minY;
  const move = (b: Box): Box => ({ ...b, x: b.x + dx, y: b.y + dy });

  const textFor = (b: Box, lines: string[], tag: string) => {
    const block = lines.length * LAYOUT.lineH + (tag ? LAYOUT.tagH : 0);
    const top = b.y + b.h / 2 - block / 2;
    const base = top + (tag ? LAYOUT.tagH : 0);
    return { lineY: lines.map((_, i) => base + LAYOUT.lineH / 2 + i * LAYOUT.lineH), ...(tag ? { tagY: top + LAYOUT.tagH / 2 } : {}) };
  };
  const cBox = move(centerRect);
  const nodes: MapLayoutNode[] = [
    { id: MAP_CENTER_ID, label: data.center, group: "center", tag: "", lines: centerLines, ...cBox, ...textFor(cBox, centerLines, "") },
    ...ordered.map((n, i): MapLayoutNode => {
      const b = move(rs[i]);
      return { id: n.id, label: n.label, group: n.group, tag: sizes[i].tag, lines: sizes[i].lines, ...b, ...textFor(b, sizes[i].lines, sizes[i].tag) };
    }),
  ];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const edges: MapLayoutEdge[] = data.edges.map((e: DiagramEdge) => {
    const f = byId.get(e.from)!, t = byId.get(e.to)!;
    const fc = { x: f.x + f.w / 2, y: f.y + f.h / 2 }, tc = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
    const p0 = leave(f, tc), p1 = leave(t, fc);
    const lw = e.label ? edgeLabelWidth(e.label) : 0;
    return {
      from: e.from, to: e.to, ...(e.label ? { label: e.label } : {}), points: [p0, p1],
      ...(e.label ? { labelBox: { x: (p0.x + p1.x) / 2 - lw / 2, y: (p0.y + p1.y) / 2 - LAYOUT.edgeLabelH / 2, w: lw, h: LAYOUT.edgeLabelH } } : {}),
    };
  });
  return { width: Math.ceil(maxX + dx + LAYOUT.margin), height: Math.ceil(maxY + dy + LAYOUT.margin), nodes, edges };
}

export type MapOutline = {
  center: string;
  relations: Array<{ from: string; to: string; label?: string }>;
  /** Concepts with no relation drawn. */
  alone: string[];
  groups: Array<{ group: MapGroup; label: string; items: string[] }>;
};

/** Text alternative for a concept map: the relations as sentences, and the concepts by group. */
export function mapOutline(data: MapData): MapOutline {
  const name = new Map<string, string>([[MAP_CENTER_ID, data.center], ...data.nodes.map(n => [n.id, n.label] as const)]);
  const used = new Set(data.edges.flatMap(e => [e.from, e.to]));
  return {
    center: data.center,
    relations: data.edges.map(e => ({ from: name.get(e.from)!, to: name.get(e.to)!, ...(e.label ? { label: e.label } : {}) })),
    alone: data.nodes.filter(n => !used.has(n.id)).map(n => n.label),
    groups: GROUP_ORDER.map(g => ({ group: g, label: GROUP_LABEL[g] || "Other", items: data.nodes.filter(n => n.group === g).map(n => n.label) })).filter(g => g.items.length),
  };
}
