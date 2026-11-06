import { buildVisuals, isRepeated, type DeckScan, type Visual } from "./material-visuals";
import type { SlideFacts } from "./slide-classify";

// ── WHOLE SLIDES: WHICH ONES, IN WHAT ORDER, AND WHEN ── SCHOLAR-VISUAL-001 phase 2 ──────────────────────────────────────
//
// Pure. No I/O and no AI. A slide whose meaning sits in its layout is drawn whole, once, from the learner's own file:
//
//   * which slides: those holding a picture that counts as content, a picture a browser cannot show, a chart, a diagram, a table,
//     a group, a connector or two or more drawn shapes. A slide of plain text is not drawn: its text is already the lesson.
//   * which page of the drawing is which slide. The rest of Scholar numbers a slide by its place among the part names, in number order
//     (extract.slidePartNames). A drawing follows the order of the deck (presentation.xml), which differs once a slide has been moved.
//     A drawn page is only ever stored under the slide it shows: if the order cannot be read, nothing is drawn.
//   * when: at most once. The row is the claim. A job that died may be claimed again after RENDER_STALE_MS, RENDER_MAX_ATTEMPTS times in all.
//
// The drawing is never presented as the original picture: the original bytes stay one tap away (material-visuals-io.ts).

/** Written on the row, so a later engine can tell what drew what. */
export const RENDER_ENGINE = "libreoffice-wasm-2.7.2+pdfium-3.0.0-lossless";
/** A PDF needs no LibreOffice: PDFium draws its own pages. */
export const PDF_RENDER_ENGINE = "pdfium-3.0.0-lossless";
/** The most stored for one file. A scanned page can be far larger than a slide; the rest keep their original pages. */
export const RENDER_MAX_BYTES = 60 * 1024 * 1024;
/** The width of a drawn slide. Wide enough for a phone at 3x and a desktop dialog; the original pictures keep their own size. */
export const RENDER_WIDTH = 1920;
/** The whole job, against the route's 300 s. */
export const RENDER_BUDGET_MS = 280_000;
/** A row still "running" after this long died with its function. */
export const RENDER_STALE_MS = 10 * 60_000;
export const RENDER_MAX_ATTEMPTS = 2;
/** The most slide parts a deck is taken to number; matches the upload's own slide cap. */
const MAX_NUMBER = 99_999;

export type RenderStatus = "running" | "done" | "partial" | "failed";
export type RenderUnit = { n: number; path: string; sha: string; width: number; height: number; bytes: number };
export type RenderRow = { materialId: string; userId: string; status: RenderStatus; attempts: number; claimedAt: string; finishedAt: string | null; units: RenderUnit[]; notDrawn: number[]; reason: string | null };
/** What the visuals list tells the page: nothing to ask for, ask once, being drawn, or finished. */
export type RenderState = "off" | "not_needed" | "not_started" | "running" | "finished";

/** The stored image of one drawn slide. Flat under the learner's own folder, so the bucket's per-person listing sees it. */
export const renderPath = (userId: string, materialId: string, n: number, sha: string) => `${userId}/render-${materialId}-${n}-${sha}.webp`;

/**
 * Pure. The drawing's page for each slide number, or null when the deck's order cannot be trusted. `parts` are the slide parts in
 * Scholar's numbering (slidePartNames): the slide numbered n is parts[n - 1]. A part the deck does not list has no page.
 */
export function slidePageMap(presentationXml: string, relsXml: string, parts: readonly string[]): Map<number, number> | null {
  const list = /<p:sldIdLst\b[^>]*>([\s\S]*?)<\/p:sldIdLst>/.exec(presentationXml)?.[1];
  if (!list) return null;
  const targets = new Map<string, string>();
  for (const m of relsXml.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1])?.[1], target = /\bTarget="([^"]+)"/.exec(m[1])?.[1];
    if (id && target) targets.set(id, target);
  }
  const ids = [...list.matchAll(/<p:sldId\b[^>]*?\br:id="([^"]+)"/g)].map(m => m[1]);
  if (!ids.length) return null;
  const numberOf = new Map(parts.map((name, i) => [name, i + 1]));
  const out = new Map<number, number>();
  for (const [i, id] of ids.entries()) {
    const target = targets.get(id);
    if (!target) return null;
    const part = target.startsWith("/") ? target.slice(1) : `ppt/${target.replace(/^\.\//, "")}`;
    const n = numberOf.get(part);
    if (n === undefined || out.has(n)) return null;
    out.set(n, i + 1);
  }
  return out;
}

/** Pure. How many pages the drawing must have: one per slide the deck lists. */
export const pagesExpected = (map: ReadonlyMap<number, number>) => map.size;

/** Pure. Whether a slide's own arrangement carries meaning beyond its text: a table, a connector, or two or more drawn shapes. */
export function layoutMatters(xml: string): boolean {
  if (/<p:cxnSp\b/.test(xml)) return true;
  if (/<a:graphicData\b[^>]*\buri="[^"]*\/table"/.test(xml)) return true;
  let drawn = 0;
  for (const m of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
    const s = m[0];
    if (/<p:ph\b/.test(s) || /\btxBox="1"/.test(s)) continue;
    if (/<a:(?:prstGeom|custGeom)\b/.test(s) && ++drawn >= 2) return true;
  }
  return false;
}

/**
 * Pure. The slides to draw and those left for being over the cap, each once and in order. Blank and logo-only slides are never drawn.
 * `layout` holds the slides layoutMatters said yes to.
 */
export function slidesToDraw(input: {
  scan: DeckScan; facts: SlideFacts | undefined; layout: ReadonlySet<number>; pages: ReadonlyMap<number, number>; minPx: number; max: number;
}): { draw: number[]; notDrawn: number[] } {
  const { scan, facts, layout, pages, minPx } = input;
  const wanted = new Set<number>(layout);
  for (const v of buildVisuals(scan, { unit: "slide", minPx, maxPerSlide: 99, classify: false }).visuals) wanted.add(v.n);
  // A picture a browser cannot show (EMF, WMF, SVG, linked), unless it is the logo repeated across the deck.
  const slidesWith = new Map<string, Set<number>>();
  for (const u of scan.undisplayable) if (u.media) slidesWith.set(u.media, (slidesWith.get(u.media) ?? new Set<number>()).add(u.n));
  for (const u of scan.undisplayable) if (!u.media || !isRepeated(slidesWith.get(u.media)?.size ?? 0, scan.slides)) wanted.add(u.n);
  for (const n of facts?.mixed ?? []) wanted.add(n);
  for (const n of facts?.grouped ?? []) wanted.add(n);
  for (const r of facts?.review ?? []) wanted.add(r.unit);
  // A slide with only a logo is not worth drawing, unless the same slide also holds a chart, a diagram or a drawn layout.
  const holdsMore = new Set([...layout, ...(facts?.review ?? []).map(r => r.unit)]);
  const never = new Set([...(facts?.blank ?? []), ...(facts?.decorativeOnly ?? []).filter(n => !holdsMore.has(n))]);
  const ordered = [...wanted].filter(n => Number.isInteger(n) && n > 0 && n <= MAX_NUMBER && !never.has(n) && pages.has(n)).sort((a, b) => a - b);
  const max = Math.max(1, input.max);
  return { draw: ordered.slice(0, max), notDrawn: ordered.slice(max) };
}

/**
 * Pure. The pages of a PDF to draw, in order. A page is drawn when nothing else can show it inline: an image the browser cannot be handed (kind
 * pdf_page), a page with no text layer and no picture, and a page with no text layer holding two or more pictures, whose layout is its meaning. A
 * page of one ordinary picture is not drawn: that picture already shows, in its original bytes, and a scan drawn again would only cost storage.
 */
export function pdfPagesToDraw(input: { visuals: readonly Pick<Visual, "n" | "kind">[]; textless: readonly number[]; max: number }): { draw: number[]; notDrawn: number[] } {
  const none = new Set(input.textless);
  const counts = new Map<number, number>();
  const wanted = new Set<number>();
  for (const v of input.visuals) {
    if (v.kind === "pdf_page") wanted.add(v.n);
    else counts.set(v.n, (counts.get(v.n) ?? 0) + 1);
  }
  for (const [n, c] of counts) if (c >= 2 && none.has(n)) wanted.add(n);
  const ordered = [...wanted].filter(n => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  const max = Math.max(1, input.max);
  return { draw: ordered.slice(0, max), notDrawn: ordered.slice(max) };
}

/** Pure. What may happen for this material now. "claim" and "reclaim" start a job; the rest do not. */
export function claimDecision(row: Pick<RenderRow, "status" | "attempts" | "claimedAt"> | null, nowMs: number): "claim" | "reclaim" | "running" | "finished" {
  if (!row) return "claim";
  if (row.status === "done" || row.status === "partial") return "finished";
  const age = nowMs - Date.parse(row.claimedAt);
  const stale = !Number.isFinite(age) || age >= RENDER_STALE_MS;
  if (row.attempts >= RENDER_MAX_ATTEMPTS) return row.status === "running" && !stale ? "running" : "finished";
  if (!stale) return row.status === "running" ? "running" : "finished";
  return "reclaim";
}

/** Pure. The state the page is told, from the policy, whether drawing is possible, and the row. */
export function renderState(on: boolean, row: Pick<RenderRow, "status" | "attempts" | "claimedAt"> | null, nowMs: number): RenderState {
  if (!on) return "off";
  const d = claimDecision(row, nowMs);
  return d === "running" ? "running" : d === "finished" ? "finished" : "not_started";
}

/**
 * The fonts a deck commonly names and those with the same metrics the engine carries, so a line breaks where PowerPoint breaks it.
 * Only the name in a working copy changes: the learner's stored file is never written to.
 */
const FONT_ALIAS: Readonly<Record<string, string>> = {
  "Calibri": "Carlito", "Calibri Light": "Carlito",
  "Cambria": "Caladea", "Cambria Math": "Caladea",
  "Arial": "Liberation Sans", "Times New Roman": "Liberation Serif",
};
export const FONT_PARTS = /^ppt\/(?:slides|slideLayouts|slideMasters|theme|charts|diagrams)\/[^/]+\.xml$/;
/** Pure. One part's XML with its fonts named by their metric-compatible equivalents. */
export const aliasFonts = (xml: string) => xml.replace(/\btypeface="([^"]+)"/g, (whole, name: string) => (FONT_ALIAS[name] ? `typeface="${FONT_ALIAS[name]}"` : whole));

/** Pure. A row from the database, with anything malformed in `units` left out rather than shown. */
export function renderRowOf(raw: unknown): RenderRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const isUnit = (u: unknown): u is RenderUnit => {
    const x = u as Partial<RenderUnit> | null;
    return !!x && Number.isInteger(x.n) && typeof x.path === "string" && /^[0-9a-f]{16}$/.test(String(x.sha)) && Number.isInteger(x.width) && Number.isInteger(x.height);
  };
  return {
    materialId: String(r.material_id), userId: String(r.user_id), status: r.status as RenderStatus, attempts: Number(r.attempts) || 1,
    claimedAt: String(r.claimed_at), finishedAt: (r.finished_at as string | null) ?? null, units: Array.isArray(r.units) ? r.units.filter(isUnit) : [],
    notDrawn: Array.isArray(r.not_drawn) ? (r.not_drawn as unknown[]).filter((n): n is number => Number.isInteger(n)) : [], reason: (r.reason as string | null) ?? null,
  };
}
