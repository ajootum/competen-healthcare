import { mediaPart, parseRels, slidePictures, type ImageKind } from "./slide-images";

// ── THE STUDENT'S OWN PICTURES, BESIDE THE LESSON THAT CITES THEM ── SCHOLAR-LESSON-VISUALS-01 ─────────────────────────
//
// Pure. A lesson taught from a PowerPoint slide or a PDF page can show what that slide or page shows. This file decides,
// without I/O and without AI, WHICH of the file's pictures count as content:
//
//   * PowerPoint: every picture a slide embeds (slide-images.slidePictures, through the slide's own .rels), minus the
//     decorative ones -- icons and bullets (too small), thin banners and rules (extreme aspect), logos and backgrounds (the
//     same picture on three or more slides AND on at least 40% of them), and pictures that cannot be shown in a browser
//     (EMF, WMF, SVG, linked: counted as `notShown`, never guessed at). At most `maxPerSlide` per slide, largest first.
//   * PDF: nothing is extracted. A page recorded as image-only (no text, or text read by AI from the page picture) is itself
//     the visual. A PDF's text pages carry no extracted pictures: that is a limit, said in the interface, not invented.
//
// The picture is always the ORIGINAL bytes of the learner's file (the image route never resizes, crops or redraws it).
// `key` carries the first 16 hex characters of the picture's SHA-256, so a key names exactly one picture and its URL can be
// cached for good. The sizes and digests are measured by material-visuals-io.ts (sharp / crypto); this file only judges them.

/** Policy defaults (scholar_lesson_visuals_min_px, scholar_lesson_visuals_max_per_section). */
export const VISUAL_DEFAULTS = { minPx: 120, maxPerSlide: 3 } as const;
/** A picture smaller than this many bytes is an icon or a bullet. */
export const MIN_VISUAL_BYTES = 4096;
/** A picture longer than this many times its shorter side is a banner or a rule. */
export const MAX_ASPECT_RATIO = 8;
/** A picture on at least this many slides AND this share of the slides is a logo or a background. */
export const REPEAT_MIN_SLIDES = 3;
export const REPEAT_MIN_SHARE = 0.4;
/** The most pages a lesson section is taken to span when looking for its pictures. */
const MAX_SPAN = 60;

export type VisualKind = ImageKind | "pdf_page";
export type Visual = {
  key: string;
  unit: "slide" | "page";
  /** The slide or page number (1-based), the same numbering as a section's pageFrom. */
  n: number;
  /** The picture's part inside the file (ppt/media/...); null for a PDF page. */
  media: string | null;
  kind: VisualKind;
  width: number | null;
  height: number | null;
  bytes: number;
  /** First 16 hex characters of the SHA-256 of the picture's bytes ("" for a PDF page). */
  sha: string;
  decorative: false;
  /** The slide's / page's text was read from its picture by AI (extraction_quality.ai_read_units). */
  aiRead: boolean;
};

/** One picture on one slide, as measured: `kind` is null when its bytes are not an image a browser can show. */
export type PictureFact = { n: number; media: string; kind: ImageKind | null; width: number | null; height: number | null; bytes: number; sha: string };
/** What a presentation holds: its slide count, its measured pictures, and the pictures that cannot be shown. */
export type DeckScan = {
  slides: number;
  pictures: PictureFact[];
  /** A slide's picture that is not a displayable format: its part (null for a linked picture outside the file). */
  undisplayable: { n: number; media: string | null }[];
};

const DISPLAYABLE_EXT = new Set(["png", "jpg", "jpeg", "tif", "tiff", "bmp", "gif", "webp"]);
const extOf = (part: string) => (part.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();

/**
 * Pure. The pictures one slide embeds that a browser cannot show -- EMF, WMF, SVG and the like (their part names), and a
 * count of linked pictures held outside the file. The displayable ones are slide-images.slidePictures.
 */
export function slideMedia(slideXml: string, relsXml: string | null): { images: string[]; undisplayable: string[]; linked: number } {
  const rels = relsXml ? parseRels(relsXml) : new Map();
  const ids = [...new Set([...slideXml.matchAll(/\b(?:\w+:)?(?:embed|link)\s*=\s*"([^"]+)"/g)].map(m => m[1]))];
  const undisplayable: string[] = [];
  let linked = 0;
  for (const id of ids) {
    const rel = rels.get(id);
    if (!rel || !rel.image) continue;
    if (rel.external) { linked += 1; continue; }
    const part = mediaPart(rel.target);
    if (part && !DISPLAYABLE_EXT.has(extOf(part)) && !undisplayable.includes(part)) undisplayable.push(part);
  }
  return { images: slidePictures(slideXml, relsXml).images, undisplayable, linked };
}

const area = (p: PictureFact) => (p.width ?? 0) * (p.height ?? 0);

/** Pure. The slides each media part appears on (displayable or not), for the logo / background rule. */
function slidesPerMedia(scan: DeckScan): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  const add = (media: string | null, n: number) => { if (media) { const s = out.get(media) ?? new Set<number>(); s.add(n); out.set(media, s); } };
  for (const p of scan.pictures) add(p.media, p.n);
  for (const u of scan.undisplayable) add(u.media, u.n);
  return out;
}

/** Pure. Whether a media part is a logo or a background: on REPEAT_MIN_SLIDES or more slides and at least REPEAT_MIN_SHARE of them. */
export function isRepeated(slidesWith: number, slides: number): boolean {
  return slidesWith >= REPEAT_MIN_SLIDES && slidesWith >= REPEAT_MIN_SHARE * Math.max(1, slides);
}

/** Pure. Why one measured picture is decorative, or null when it counts as content. */
export function decorativeReason(p: PictureFact, minPx: number): "tiny" | "small_file" | "banner" | null {
  if (p.bytes < MIN_VISUAL_BYTES) return "small_file";
  if (p.width !== null && p.height !== null) {
    const lo = Math.min(p.width, p.height), hi = Math.max(p.width, p.height);
    if (lo < minPx) return "tiny";
    if (lo > 0 && hi / lo > MAX_ASPECT_RATIO) return "banner";
  }
  return null;
}

/**
 * Pure. The presentation's content pictures, slide by slide (largest first within a slide, at most `maxPerSlide`), and how
 * many pictures it holds that cannot be shown. Deterministic: the same file and settings always give the same list.
 */
export function deckVisuals(scan: DeckScan, opts: { minPx?: number; maxPerSlide?: number; aiRead?: ReadonlySet<number> } = {}): { visuals: Visual[]; notShown: number } {
  const minPx = opts.minPx ?? VISUAL_DEFAULTS.minPx;
  const maxPerSlide = Math.max(1, opts.maxPerSlide ?? VISUAL_DEFAULTS.maxPerSlide);
  const perMedia = slidesPerMedia(scan);
  const repeated = (media: string | null) => !!media && isRepeated(perMedia.get(media)?.size ?? 0, scan.slides);

  let notShown = 0;
  for (const u of scan.undisplayable) if (!repeated(u.media)) notShown += 1;
  const bySlide = new Map<number, PictureFact[]>();
  for (const p of scan.pictures) {
    if (repeated(p.media)) continue;
    if (p.kind === null) { notShown += 1; continue; }
    if (decorativeReason(p, minPx)) continue;
    bySlide.set(p.n, [...(bySlide.get(p.n) ?? []), p]);
  }
  const visuals: Visual[] = [];
  for (const n of [...bySlide.keys()].sort((a, b) => a - b)) {
    const seen = new Set<string>();
    const ranked = (bySlide.get(n) as PictureFact[])
      .sort((a, b) => area(b) - area(a) || b.bytes - a.bytes || (a.media < b.media ? -1 : a.media > b.media ? 1 : 0))
      .filter(p => { const k = `${n}-${p.sha}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, maxPerSlide);
    for (const p of ranked) {
      visuals.push({ key: `${n}-${p.sha}`, unit: "slide", n, media: p.media, kind: p.kind as ImageKind, width: p.width, height: p.height, bytes: p.bytes, sha: p.sha, decorative: false, aiRead: !!opts.aiRead?.has(n) });
    }
  }
  return { visuals, notShown };
}

/**
 * Pure. A PDF's visuals: its image-only pages -- recorded as holding no readable text (emptyUnits) or read by AI from the
 * page picture (aiReadUnits). One page card each; the page is shown by the browser's own PDF viewer, never rasterised here.
 */
export function pdfVisuals(input: { emptyUnits?: readonly number[]; aiReadUnits?: readonly number[] }): Visual[] {
  const ai = new Set(input.aiReadUnits ?? []);
  const pages = [...new Set([...(input.emptyUnits ?? []), ...ai])].filter(n => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  return pages.map(n => ({ key: `p${n}`, unit: "page" as const, n, media: null, kind: "pdf_page" as const, width: null, height: null, bytes: 0, sha: "", decorative: false as const, aiRead: ai.has(n) }));
}

/** Pure. The visuals of a lesson section's slide / page range, in slide order (largest first within a slide). */
export function visualsForPages(visuals: readonly Visual[], from: number | null | undefined, to?: number | null): Visual[] {
  if (from === null || from === undefined || !Number.isInteger(from)) return [];
  let hi = to === null || to === undefined || !Number.isInteger(to) ? from : to;
  if (hi < from) hi = from;
  hi = Math.min(hi, from + MAX_SPAN);
  return visuals.filter(v => v.n >= from && v.n <= hi);
}

/** Pure. A visual key as the URL carries it, or null when it is not one (nothing else is ever looked up). */
export function parseVisualKey(key: string): { kind: "slide"; n: number; sha: string } | { kind: "page"; n: number } | null {
  const slide = /^([1-9]\d{0,4})-([0-9a-f]{16})$/.exec(key);
  if (slide) return { kind: "slide", n: Number(slide[1]), sha: slide[2] };
  const page = /^p([1-9]\d{0,4})$/.exec(key);
  return page ? { kind: "page", n: Number(page[1]) } : null;
}

/** The kinds the browser shows as they are; the rest are converted to PNG without any resizing. */
export const BROWSER_KINDS: readonly ImageKind[] = ["png", "jpeg", "gif", "webp"];
export const CONTENT_TYPE: Record<ImageKind, string> = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", tiff: "image/tiff", bmp: "image/bmp" };

/**
 * Pure. Whether a material's visuals may be served to this person: it must be their own row (the store reads are keyed on the
 * caller; another person's id answers "not_found", as everywhere in Scholar) and a PDF or PowerPoint.
 */
export function canServeVisual(material: { userId?: string; mimeType: string } | null | undefined, userId: string): "ok" | "not_found" | "not_supported" {
  if (!material || (material.userId !== undefined && material.userId !== userId)) return "not_found";
  return material.mimeType === "application/pdf" || material.mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ? "ok" : "not_supported";
}

/** The URL of the visuals list of a material, and of one picture (or PDF page) in it. */
export const visualsListUrl = (materialId: string) => `/api/individual/scholar/materials/${materialId}/visuals`;
export const visualUrl = (materialId: string, key: string) => `${visualsListUrl(materialId)}/${key}`;

/**
 * Pure. The unit and range a citation names ("Deck, slide 12" / "Notes, pages 3-4"), or null for a Word / text "section N"
 * citation (nothing to look up). Used where only the citation is at hand (Flashcards, Revise).
 */
export function pagesOfCitation(citation: string): { unit: "slide" | "page"; from: number; to: number } | null {
  const m = /\b(slide|page)s?\s+(\d{1,5})(?:\s*[-–]\s*(\d{1,5}))?\s*$/i.exec(citation.trim());
  if (!m) return null;
  const from = Number(m[2]);
  const to = m[3] ? Number(m[3]) : from;
  return { unit: m[1].toLowerCase() === "slide" ? "slide" : "page", from, to: Math.max(from, to) };
}

/** Pure. Up to `max` of these visuals for a lesson's sections (each a slide / page range), in order, without repeats. */
export function visualsForSections(visuals: readonly Visual[], ranges: readonly { pageFrom: number | null; pageTo: number | null }[]): Visual[] {
  const seen = new Set<string>();
  const out: Visual[] = [];
  for (const r of ranges) for (const v of visualsForPages(visuals, r.pageFrom, r.pageTo)) if (!seen.has(v.key)) { seen.add(v.key); out.push(v); }
  return out;
}
