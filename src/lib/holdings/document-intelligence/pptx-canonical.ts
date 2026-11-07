import { createHash } from "node:crypto";
import type { Block, CanonicalUnit, SourceRef, TableCell } from "./canonical";

// ── A POWERPOINT, READ AS STRUCTURE ── COMPETEN-DIG-001 s2.2, PHASE 1 ─────────────────────────────────────────────────────
//
// Pure, deterministic and cheap: no AI, no engine, no rendering. The slide's own XML says what it holds, in what order, and where, so
// this is the lowest-resource way to a structured document. It adds what today's reader (extract.drawingText) does not keep: table
// rows and columns, chart values, SmartArt text, figures with their alt text and crop, placeholder roles and positions.
//
// A malformed part is reported, never guessed at: parseXml answers null, and the slide becomes a failed unit that a targeted recovery
// can fill. Its neighbours are unaffected.

export type XmlNode = { name: string; attrs: Record<string, string>; children: (XmlNode | string)[] };

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi, (_, e, d, h) =>
  e ? ENTITY[e.toLowerCase()] : String.fromCodePoint(d ? Number(d) : parseInt(h, 16)));

/** Pure. A small strict XML reader, enough for Office parts. Null when tags do not balance. No entity expansion beyond the five standard ones and numeric ones, so a crafted part cannot grow. */
export function parseXml(xml: string): XmlNode | null {
  const root: XmlNode = { name: "#root", attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  const tag = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let at = 0;
  for (const m of xml.matchAll(tag)) {
    const between = xml.slice(at, m.index);
    if (between.includes("<")) return null;
    if (between.trim()) stack[stack.length - 1].children.push(decode(between));
    at = m.index + m[0].length;
    if (m[5] !== undefined) { stack[stack.length - 1].children.push(m[5]); continue; }
    if (!m[2]) continue;
    if (m[1]) {
      if (stack.length < 2 || stack[stack.length - 1].name !== m[2]) return null;
      stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of (m[3] ?? "").matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3] ?? "");
    const node: XmlNode = { name: m[2], attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!m[4]) stack.push(node);
  }
  const tail = xml.slice(at);
  if (stack.length !== 1 || tail.includes("<") || !root.children.some(c => typeof c !== "string")) return null;
  return root;
}

const kids = (n: XmlNode) => n.children.filter((c): c is XmlNode => typeof c !== "string");
const child = (n: XmlNode | undefined, name: string) => n ? kids(n).find(k => k.name === name) : undefined;
const all = (n: XmlNode | undefined, name: string): XmlNode[] => {
  if (!n) return [];
  const out: XmlNode[] = [];
  for (const k of kids(n)) { if (k.name === name) out.push(k); else out.push(...all(k, name)); }
  return out;
};
const textOf = (n: XmlNode | undefined): string => !n ? "" : n.children.map(c => typeof c === "string" ? c : textOf(c)).join("");

/** One paragraph's text: its runs and fields in order, a line break as a space. */
function paragraphText(p: XmlNode): string {
  return kids(p).map(k => k.name === "a:r" || k.name === "a:fld" ? textOf(child(k, "a:t")) : k.name === "a:br" ? " " : "").join("").trim();
}

type Xform = { offX: number; offY: number; scaleX: number; scaleY: number };
const IDENTITY: Xform = { offX: 0, offY: 0, scaleX: 1, scaleY: 1 };
const numberOf = (v: string | undefined) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Pure. A shape's box on the slide, through any groups it sits in. */
function boxOf(xfrm: XmlNode | undefined, t: Xform): SourceRef["box"] {
  const off = child(xfrm, "a:off"), ext = child(xfrm, "a:ext");
  if (!off || !ext) return null;
  return { x: t.offX + numberOf(off.attrs.x) * t.scaleX, y: t.offY + numberOf(off.attrs.y) * t.scaleY, w: numberOf(ext.attrs.cx) * t.scaleX, h: numberOf(ext.attrs.cy) * t.scaleY };
}

/** Pure. How a group's children map onto the slide. */
function groupXform(grp: XmlNode, t: Xform): Xform {
  const x = child(child(grp, "p:grpSpPr"), "a:xfrm");
  const off = child(x, "a:off"), ext = child(x, "a:ext"), chOff = child(x, "a:chOff"), chExt = child(x, "a:chExt");
  if (!off || !ext || !chOff || !chExt) return t;
  const sx = numberOf(chExt.attrs.cx) ? numberOf(ext.attrs.cx) / numberOf(chExt.attrs.cx) : 1;
  const sy = numberOf(chExt.attrs.cy) ? numberOf(ext.attrs.cy) / numberOf(chExt.attrs.cy) : 1;
  return {
    offX: t.offX + (numberOf(off.attrs.x) - numberOf(chOff.attrs.x) * sx) * t.scaleX,
    offY: t.offY + (numberOf(off.attrs.y) - numberOf(chOff.attrs.y) * sy) * t.scaleY,
    scaleX: t.scaleX * sx, scaleY: t.scaleY * sy,
  };
}

/** The parts a slide refers to, by relationship id. */
export type SlideParts = {
  /** The chart or diagram data part, already read, by relationship id. Absent: not in the file. */
  related: ReadonlyMap<string, string>;
  /** Relationship id to package part, for pictures. */
  media: ReadonlyMap<string, { part: string | null; external: boolean }>;
};

/** A picture as it appears on the slide, handed back so its bytes can be measured and classified by the caller. */
export type FigureSeen = { rel: string; part: string | null; external: boolean };

type Placed = { block: Block; order: number };

function nvOf(shape: XmlNode): { id: string | null; name: string | null; descr: string; ph: string | null; hasPh: boolean } {
  const nv = kids(shape).find(k => /^p:nv\w+Pr$/.test(k.name));
  const c = child(nv, "p:cNvPr");
  const ph = child(child(nv, "p:nvPr"), "p:ph");
  return { id: c?.attrs.id ?? null, name: c?.attrs.name ?? null, descr: c?.attrs.descr ?? "", ph: ph ? ph.attrs.type ?? "body" : null, hasPh: !!ph };
}

function textBlocks(body: XmlNode, ph: string | null, source: SourceRef): Block[] {
  const paragraphs = kids(body).filter(k => k.name === "a:p");
  const lines = paragraphs.map(p => ({ text: paragraphText(p), level: numberOf(child(p, "a:pPr")?.attrs.lvl), bulleted: !child(child(p, "a:pPr"), "a:buNone") && (ph === "body" || ph === "obj" || !!child(child(p, "a:pPr"), "a:buChar") || !!child(child(p, "a:pPr"), "a:buAutoNum")) })).filter(l => l.text);
  if (!lines.length) return [];
  if (ph === "title" || ph === "ctrTitle") return [{ type: "heading", level: 1, text: lines.map(l => l.text).join(" "), source }];
  if (ph === "subTitle") return [{ type: "heading", level: 2, text: lines.map(l => l.text).join(" "), source }];
  const out: Block[] = [];
  let list: { level: number; text: string }[] = [];
  const flush = () => { if (list.length) out.push({ type: "list", items: list, source }); list = []; };
  for (const l of lines) {
    if (l.bulleted) { list.push({ level: l.level, text: l.text }); continue; }
    flush();
    out.push({ type: "paragraph", text: l.text, source });
  }
  flush();
  return out;
}

function tableBlock(tbl: XmlNode, source: SourceRef): Block {
  const rows: TableCell[][] = all(tbl, "a:tr").map(tr => kids(tr).filter(k => k.name === "a:tc").map(tc => ({
    text: all(tc, "a:p").map(paragraphText).filter(Boolean).join("\n"),
    rowSpan: numberOf(tc.attrs.rowSpan) || 1, colSpan: numberOf(tc.attrs.gridSpan) || 1,
    merged: tc.attrs.hMerge === "1" || tc.attrs.vMerge === "1",
  })));
  return { type: "table", rows, source };
}

/**
 * Pure. A number as the program that wrote it meant it. A chart's cache holds binary floating point at full length (8.2 is stored as 8.1999999999999993), and a value on
 * a clinical chart must not reach a learner like that. 15 significant digits is what Excel itself keeps. Anything not a plain number is left exactly as it is.
 */
export function chartValue(raw: string): string {
  const t = raw.trim();
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return raw;
  return String(Number(Number(t).toPrecision(15)));
}

/** Pure. A chart part's title, categories and values, as the file caches them. Null when the part cannot be read. */
export function chartBlock(chartXml: string, source: SourceRef): Block | null {
  const root = parseXml(chartXml);
  if (!root) return null;
  const title = all(child(root, "c:chartSpace"), "c:title").slice(0, 1).flatMap(t => all(t, "a:p").map(paragraphText)).filter(Boolean).join(" ");
  const series = all(root, "c:ser");
  const pts = (n: XmlNode | undefined) => {
    const out: string[] = [];
    for (const p of all(n, "c:pt")) out[numberOf(p.attrs.idx)] = textOf(child(p, "c:v"));
    return Array.from(out, v => v ?? "");
  };
  const categories = series.length ? pts(child(series[0], "c:cat")) : [];
  return {
    type: "chart", title, categories,
    series: series.map(s => ({ name: pts(child(s, "c:tx")).join(" "), values: pts(child(s, "c:val") ?? child(s, "c:yVal")).map(chartValue) })),
    source,
  };
}

/** Pure. A SmartArt data part's node text, in the order the file holds. Null when the part cannot be read. */
export function diagramBlock(dataXml: string, source: SourceRef): Block | null {
  const root = parseXml(dataXml);
  if (!root) return null;
  const nodes = all(root, "dgm:pt").filter(p => !p.attrs.type || p.attrs.type === "node").map(p => all(p, "a:p").map(paragraphText).filter(Boolean).join(" ")).filter(Boolean);
  return { type: "diagram", nodes, source };
}

/** Pure. A stable id for a figure's asset: the digest of the part name inside this one file. The caller re-keys it on the picture's bytes. */
const figureId = (part: string | null, rel: string) => createHash("sha256").update(part ?? `linked:${rel}`).digest("hex").slice(0, 16);

function walk(nodes: readonly XmlNode[], unit: number, partName: string, parts: SlideParts, t: Xform, groupPath: string[], out: Placed[], figures: FigureSeen[]): void {
  for (const shape of nodes) {
    if (shape.name === "mc:AlternateContent") {
      // The alternatives say one thing twice. Choice is the richer form an up-to-date reader uses; Fallback is its picture.
      const pick = child(shape, "mc:Choice") ?? child(shape, "mc:Fallback");
      if (pick) walk(kids(pick), unit, partName, parts, t, groupPath, out, figures);
      continue;
    }
    if (!["p:sp", "p:pic", "p:grpSp", "p:graphicFrame", "p:cxnSp", "p:contentPart"].includes(shape.name)) continue;
    const nv = nvOf(shape);
    const xfrm = shape.name === "p:graphicFrame" ? child(shape, "p:xfrm") : child(child(shape, "p:spPr"), "a:xfrm");
    const source: SourceRef = { unit, part: partName, shapeId: nv.id, shapeName: nv.name, box: boxOf(xfrm, t), groupPath };
    const push = (block: Block) => out.push({ block, order: out.length });
    if (shape.name === "p:grpSp") {
      walk(kids(shape), unit, partName, parts, groupXform(shape, t), [...groupPath, nv.id ?? "?"], out, figures);
    } else if (shape.name === "p:sp") {
      const body = child(shape, "p:txBody");
      if (body) textBlocks(body, nv.ph, source).forEach(push);
      if (nv.descr && !body) push({ type: "paragraph", text: nv.descr, source });
    } else if (shape.name === "p:pic") {
      const blip = all(shape, "a:blip")[0];
      const rel = blip?.attrs["r:embed"] ?? blip?.attrs["r:link"] ?? "";
      const media = parts.media.get(rel);
      if (!media) { push({ type: "unread", what: "linked_picture", source }); continue; }
      figures.push({ rel, part: media.part, external: media.external });
      const crop = child(child(shape, "p:blipFill"), "a:srcRect");
      push({
        type: "figure", assetId: figureId(media.part, rel), alt: nv.descr,
        crop: crop ? { l: numberOf(crop.attrs.l) / 100000, t: numberOf(crop.attrs.t) / 100000, r: numberOf(crop.attrs.r) / 100000, b: numberOf(crop.attrs.b) / 100000 } : null,
        source,
      });
    } else if (shape.name === "p:graphicFrame") {
      const data = child(child(shape, "a:graphic"), "a:graphicData");
      const tbl = child(data, "a:tbl");
      if (tbl) { push(tableBlock(tbl, source)); continue; }
      const uri = data?.attrs.uri ?? "";
      if (/\/chart$/.test(uri)) {
        const id = child(data, "c:chart")?.attrs["r:id"];
        const xml = id ? parts.related.get(id) : undefined;
        const b = xml ? chartBlock(xml, source) : null;
        push(b ?? { type: "unread", what: "other", source });
      } else if (/\/diagram$/.test(uri)) {
        const id = child(data, "dgm:relIds")?.attrs["r:dm"];
        const xml = id ? parts.related.get(id) : undefined;
        const b = xml ? diagramBlock(xml, source) : null;
        push(b ?? { type: "unread", what: "other", source });
      } else if (uri) {
        push({ type: "unread", what: "embedded", source });
      }
    } else if (shape.name === "p:contentPart") {
      push({ type: "unread", what: "ink", source });
    }
    // A connector (p:cxnSp) holds no words. What it means is the arrangement, which the drawn slide keeps.
  }
}

/**
 * Pure. Reading order: the title first, then the rest top to bottom and, in a row, left to right. Shapes whose tops are within `band` count
 * as one row, so two columns read as columns of a row, not by a few EMU of difference. A block with no box keeps its place at the end.
 */
export function readingOrder(placed: readonly { block: Block; order: number }[], band: number): Block[] {
  const heading = placed.filter(p => p.block.type === "heading");
  const rest = placed.filter(p => p.block.type !== "heading");
  const boxed = rest.filter(p => p.block.source.box).sort((a, b) => a.block.source.box!.y - b.block.source.box!.y || a.order - b.order);
  const rows: (typeof boxed)[] = [];
  for (const p of boxed) {
    const row = rows[rows.length - 1];
    if (row && p.block.source.box!.y - row[0].block.source.box!.y <= band) row.push(p); else rows.push([p]);
  }
  const ordered = rows.flatMap(r => [...r].sort((a, b) => a.block.source.box!.x - b.block.source.box!.x || a.order - b.order));
  return [...heading, ...ordered, ...rest.filter(p => !p.block.source.box)].map(p => p.block);
}

/** EMU: half an inch. Two shapes whose tops are this close sit in one row. */
const ROW_BAND = 457200;

export type SlideInput = { n: number; part: string; xml: string; notesXml?: string | null; parts: SlideParts; position: number | null };

/**
 * Pure. One slide as a canonical unit, plus the pictures it shows. Malformed XML gives a failed unit with no blocks, so a recovery can
 * target this slide alone. `engine` is the name the caller's registry knows.
 */
export function slideToUnit(input: SlideInput, engine: string): { unit: CanonicalUnit; figures: FigureSeen[] } {
  const root = parseXml(input.xml);
  const sld = root ? child(root, "p:sld") : undefined;
  const tree = child(child(sld, "p:cSld"), "p:spTree");
  if (!root || !sld || !tree) return { unit: { n: input.n, position: input.position, hidden: false, status: "failed", engine, blocks: [] }, figures: [] };
  const placed: Placed[] = [];
  const figures: FigureSeen[] = [];
  walk(kids(tree), input.n, input.part, input.parts, IDENTITY, [], placed, figures);
  const blocks = readingOrder(placed, ROW_BAND);
  if (input.notesXml) {
    const notes = parseXml(input.notesXml);
    const body = notes ? all(notes, "p:sp").filter(s => nvOf(s).ph === "body").flatMap(s => all(s, "a:p").map(paragraphText)).filter(Boolean).join("\n") : "";
    if (body) blocks.push({ type: "notes", text: body, source: { unit: input.n, part: null, shapeId: null, shapeName: null, box: null, groupPath: [] } });
  }
  const unread = blocks.some(b => b.type === "unread");
  return {
    unit: { n: input.n, position: input.position, hidden: sld.attrs.show === "0", status: !blocks.length ? "blank" : unread ? "partial" : "complete", engine, blocks },
    figures,
  };
}
