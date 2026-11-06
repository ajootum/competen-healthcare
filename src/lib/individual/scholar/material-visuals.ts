import { mediaPart, parseRels, slidePictures, type ImageKind } from "./slide-images";

// ── THE STUDENT'S OWN PICTURES, BESIDE THE LESSON THAT CITES THEM ── SCHOLAR-LESSON-VISUALS-01 / VISUAL-CLASSIFY-01 ──────
//
// Pure. A lesson taught from a PowerPoint slide or a PDF page can show what that slide or page shows. This file decides,
// without I/O and without AI, WHICH of the file's pictures count as content and WHAT KIND of page each is:
//
//   * PowerPoint: every picture a slide embeds (slide-images.slidePictures, through the slide's own .rels), minus the
//     decorative ones -- icons and bullets (too small), thin banners and rules (extreme aspect), logos and backgrounds (the
//     same picture on three or more slides AND on at least 40% of them), and pictures that cannot be shown in a browser
//     (EMF, WMF, SVG, linked: counted as `notShown`, never guessed at). At most `maxPerSlide` per slide, largest first.
//   * PDF: the image XObjects of each page (material-visuals-pdf.ts measures them), with the same filter. An image the browser
//     cannot be handed as it is (JPX, CMYK, a mask...) is stood for by its single page. A page with no text layer that yields
//     no picture is itself a visual.
//   * Classification (classifyPage): from the page's own text layer or the EXISTING AI reading of it -- a picture of prose,
//     a chart/table with figures, or a title-only page with a picture. It never reads the picture and never explains it.
//
// The picture is always the ORIGINAL bytes of the learner's file (the image route never resizes, crops or redraws it; a
// lossless PNG is made only where a browser cannot show the stored form). `key` carries the first 16 hex characters of the
// picture's SHA-256, so a key names exactly one picture and its URL can be cached for good.

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
/** What the page or slide is, judged from its own text layer and any existing AI reading of it (never from the picture). */
export type VisualCategory = "text_picture" | "mixed" | "visual";
/** What the lesson does with it: show the picture, let the section text teach, or both. */
export type VisualBehaviour = "image" | "text" | "both";
export const LABEL_SCORING = "Observation chart or scoring tool";
export const LABEL_TABLE = "Table";
export const LABEL_CHART = "Chart or graph";
export const LABEL_CLINICAL = "Clinical image";
export const LABEL_DIAGRAM = "Diagram or picture";

export type Visual = {
  key: string;
  unit: "slide" | "page" | "section";
  /** The slide or page number (1-based), the same numbering as a section's pageFrom. A Word file: the section's ordinal. */
  n: number;
  /** The picture's part inside the file (ppt/media/... or a PDF image object "x12"); null for a whole PDF page. */
  media: string | null;
  kind: VisualKind;
  width: number | null;
  height: number | null;
  bytes: number;
  /** First 16 hex characters of the SHA-256 of the picture's bytes ("" for a whole PDF page). */
  sha: string;
  decorative: false;
  /** The slide's / page's text was read from its picture by AI (extraction_quality.ai_read_units). */
  aiRead: boolean;
  /** SCHOLAR-VISUAL-CLASSIFY-01: deterministic, from the page's text layer and any existing reading (classifyPage). */
  category: VisualCategory;
  behaviour: VisualBehaviour;
  /** A fixed label from keywords in the page's own title; never a description of the picture. */
  label: string;
  /** The page's own title, or null. */
  title: string | null;
  /** The caption: "<the page's own title> · page 23", else "Page 23 · original page". */
  caption: string;
  /** Readable text exists for this page (a text layer of 150 characters or more, or an AI reading). */
  hasText: boolean;
  /** The AI-read text of a chart or table page, shown only behind a warning (never for scores or thresholds). */
  safeText: string | null;
  /** SCHOLAR-VISUAL-001 phase 2: the whole slide, drawn once from the learner's file. Not the original bytes: said so wherever it is shown. */
  whole?: boolean;
};

/** One picture on one slide / page, as measured: `kind` is null when its bytes are not an image a browser can show. */
export type PictureFact = {
  n: number; media: string; kind: ImageKind | null; width: number | null; height: number | null; bytes: number; sha: string;
  /** PDF only: "page" = an image the browser cannot be handed as it is (JPX, CMYK, mask...): the single page stands for it. */
  via?: "direct" | "converted" | "page";
};
/** What a presentation / PDF holds: its slide / page count, its measured pictures, and the pictures that cannot be shown. */
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

// ── CLASSIFICATION ── SCHOLAR-VISUAL-CLASSIFY-01 ─────────────────────────────────────────────────────────────────────────
//
// Pure and deterministic; it reads the page's text (its own text layer, or the existing AI reading of it -- never a new one)
// and never the picture. A page with no text layer whose existing reading is prose is a picture OF TEXT (a screenshot of a
// paper): the section text teaches it. A reading that is numbers, short lines or a table is not prose: the picture comes
// first and the text only beside it. A title-only page with a big picture IS the picture. Nothing here describes, scores
// or interprets a picture; a label is a fixed phrase chosen by keywords in the page's own title.

/** Page text of this many characters or more (with a meaningful picture) makes a page "mixed". */
export const TITLE_ONLY_CHARS = 150;
export const DEFAULT_TEXT_WORDS = 40;
const MAX_TITLE_CHARS = 80;
const MAX_SAFE_TEXT = 2000;

/** What the index knows about one page's text: whether it has a text layer, whether AI read it, and the text itself. */
export type PageInfo = { text: string; textLayer: boolean; aiRead: boolean };

/** Pure. Pages' info from the stored sections (each inside one page) and the quality record's empty / AI-read units. */
export function pageInfoOf(chunks: readonly { pageFrom: number | null; content: string }[], emptyUnits: readonly number[], aiReadUnits: readonly number[]): Map<number, PageInfo> {
  const out = new Map<number, PageInfo>();
  const ai = new Set(aiReadUnits), empty = new Set(emptyUnits);
  for (const c of chunks) {
    if (c.pageFrom === null) continue;
    const have = out.get(c.pageFrom);
    out.set(c.pageFrom, { text: have ? `${have.text}\n${c.content}` : c.content, textLayer: !ai.has(c.pageFrom) && !empty.has(c.pageFrom), aiRead: ai.has(c.pageFrom) });
  }
  for (const n of empty) if (!out.has(n)) out.set(n, { text: "", textLayer: false, aiRead: ai.has(n) });
  return out;
}

const MARKERS = /\[(?:FIGURE:[^\]]*|UNREADABLE)\]|^\s*PAGE\s+\d+\s*$/gim;
const cleanText = (t: string) => t.replace(MARKERS, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
/** The first line of text, without a leading bullet or dash. */
const firstLine = (t: string) => cleanText(t).split(/\n/).map(l => l.replace(/^[\s•●▪·*–-]+/, "").trim()).find(Boolean) ?? "";

/** Pure. Prose: at least `minWords` words, under 15% digits, and two or more sentences. */
export function isProse(text: string, minWords: number): boolean {
  const t = cleanText(text);
  const words = t.split(/\s+/).filter(Boolean).length;
  if (words < minWords) return false;
  const chars = t.replace(/\s/g, "");
  const digits = (chars.match(/\d/g) ?? []).length;
  if (chars.length === 0 || digits / chars.length >= 0.15) return false;
  return (t.match(/[.!?](?:\s|$)/g) ?? []).length >= 2;
}

/** Pure. The fixed label for a page, from keywords in its own title / first line. */
export function labelOf(heading: string): string {
  if (/\b(NEWS2?|PEWS|ADDS|MEWS|EWS|early warning|track and trigger|observation chart|scor(?:e|ing))\b/i.test(heading)) return LABEL_SCORING;
  if (/\btable\b/i.test(heading)) return LABEL_TABLE;
  if (/\b(survival|graph|trend|rate)\b|%/i.test(heading)) return LABEL_CHART;
  if (/\b(ECG|x-?ray|radiograph|CT|MRI|ultrasound|wound|rash|photo)\b/i.test(heading)) return LABEL_CLINICAL;
  return LABEL_DIAGRAM;
}

export type PageClass = { category: VisualCategory; behaviour: VisualBehaviour; label: string; title: string | null; hasText: boolean };

/** Pure. One page's class. `info` undefined: nothing is known of its text (no text layer, not read): a picture. */
export function classifyPage(info: PageInfo | undefined, textWords: number = DEFAULT_TEXT_WORDS): PageClass {
  const text = info?.text ?? "";
  const line = firstLine(text);
  const title = line && line.length <= MAX_TITLE_CHARS ? line : null;
  const label = labelOf(line);
  const clean = cleanText(text);
  if (!info || !info.textLayer) {
    if (!info?.aiRead || !clean) return { category: "visual", behaviour: "image", label, title, hasText: false };
    return isProse(text, textWords)
      ? { category: "text_picture", behaviour: "text", label, title, hasText: true }
      : { category: "mixed", behaviour: "both", label, title, hasText: true };
  }
  return clean.length >= TITLE_ONLY_CHARS
    ? { category: "mixed", behaviour: "both", label, title, hasText: true }
    : { category: "visual", behaviour: "image", label, title, hasText: false };
}

export type BuildOptions = {
  unit?: "slide" | "page" | "section"; minPx?: number; maxPerSlide?: number; aiRead?: ReadonlySet<number>;
  /** Pages' text info (pageInfoOf). Absent: no page is known to have text. */
  pages?: ReadonlyMap<number, PageInfo>;
  /** scholar_visual_classify: false = every picture is simply shown (category visual, behaviour image). */
  classify?: boolean; textWords?: number;
  /** A PDF: pages with no text layer; a page of them that yields no picture is itself the visual. */
  emptyUnits?: readonly number[];
};

type Bare = Omit<Visual, "category" | "behaviour" | "label" | "title" | "caption" | "hasText" | "safeText">;
function decorate(v: Bare, o: BuildOptions): Visual {
  const info = o.pages?.get(v.n);
  const cls: PageClass = o.classify === false
    ? { category: "visual", behaviour: "image", label: LABEL_DIAGRAM, title: classifyPage(info).title, hasText: false }
    : classifyPage(info, o.textWords);
  const word = v.unit;
  const caption = cls.title ? `${cls.title} · ${word} ${v.n}`
    : v.kind === "pdf_page" ? `Page ${v.n} · original page`
    : word === "section" ? `Section ${v.n} · original picture from your document`
    : `${word === "slide" ? "Slide" : "Page"} ${v.n} · original picture from your ${word === "slide" ? "presentation" : "pages"}`;
  const chart = cls.label === LABEL_SCORING || cls.label === LABEL_TABLE;
  const safeText = o.classify !== false && v.aiRead && cls.behaviour === "both" && chart && info ? cleanText(info.text).slice(0, MAX_SAFE_TEXT) || null : null;
  return { ...v, category: cls.category, behaviour: cls.behaviour, label: cls.label, title: cls.title, caption, hasText: cls.hasText, safeText };
}

/**
 * Pure. The content pictures, slide / page by slide / page (largest first within one, at most `maxPerSlide`), each classified,
 * and how many pictures cannot be shown. Deterministic: the same file and settings always give the same list.
 * A PDF (`unit: "page"`): a page with no text layer (emptyUnits, or read by AI) whose pictures all fell away is itself a visual.
 */
export function buildVisuals(scan: DeckScan | null, opts: BuildOptions = {}): { visuals: Visual[]; notShown: number } {
  const unit = opts.unit ?? "slide";
  const minPx = opts.minPx ?? VISUAL_DEFAULTS.minPx;
  const maxPerSlide = Math.max(1, opts.maxPerSlide ?? VISUAL_DEFAULTS.maxPerSlide);
  const aiRead = opts.aiRead ?? new Set<number>();
  const perMedia = scan ? slidesPerMedia(scan) : new Map<string, Set<number>>();
  const repeated = (media: string | null) => !!media && !!scan && isRepeated(perMedia.get(media)?.size ?? 0, scan.slides);

  let notShown = 0;
  for (const u of scan?.undisplayable ?? []) if (!repeated(u.media)) notShown += 1;
  const bySlide = new Map<number, PictureFact[]>();
  for (const p of scan?.pictures ?? []) {
    if (repeated(p.media)) continue;
    if (p.kind === null && p.via !== "page") { notShown += 1; continue; }
    if (decorativeReason(p, minPx)) continue;
    bySlide.set(p.n, [...(bySlide.get(p.n) ?? []), p]);
  }
  const visuals: Visual[] = [];
  for (const n of [...bySlide.keys()].sort((a, b) => a - b)) {
    const seen = new Set<string>();
    // A Word file keeps the document's own order. A slide or page has no reading order for its pictures, so the largest comes first.
    const inOrder = bySlide.get(n) as PictureFact[];
    const ranked = (unit === "section" ? inOrder : inOrder.sort((a, b) => area(b) - area(a) || b.bytes - a.bytes || (a.media < b.media ? -1 : a.media > b.media ? 1 : 0)))
      .map(p => ({ p, key: p.via === "page" ? `p${n}` : unit === "page" ? `p${n}-${p.sha}` : unit === "section" ? `s${n}-${p.sha}` : `${n}-${p.sha}` }))
      .filter(x => { if (seen.has(x.key)) return false; seen.add(x.key); return true; })
      .slice(0, maxPerSlide);
    for (const { p, key } of ranked) {
      const whole = p.via === "page";
      visuals.push(decorate({
        key, unit, n, media: whole ? null : p.media, kind: whole ? "pdf_page" : (p.kind as ImageKind), width: p.width, height: p.height,
        bytes: whole ? 0 : p.bytes, sha: whole ? "" : p.sha, decorative: false, aiRead: aiRead.has(n),
      }, opts));
    }
  }
  if (unit === "page") {
    const have = new Set(visuals.map(v => v.n));
    const textless = [...new Set([...(opts.emptyUnits ?? []), ...aiRead])].filter(n => Number.isInteger(n) && n > 0 && !have.has(n));
    for (const n of textless) {
      visuals.push(decorate({ key: `p${n}`, unit: "page", n, media: null, kind: "pdf_page", width: null, height: null, bytes: 0, sha: "", decorative: false, aiRead: aiRead.has(n) }, opts));
    }
    visuals.sort((a, b) => a.n - b.n);
  }
  return { visuals, notShown };
}

/** Pure. A slide drawn whole, classified and captioned like the pictures on it. */
export function wholeSlideVisual(u: { n: number; sha: string; width: number; height: number; bytes: number }, opts: Pick<BuildOptions, "aiRead" | "pages" | "classify" | "textWords" | "unit"> = {}): Visual {
  const unit = opts.unit ?? "slide";
  const v = decorate({
    key: `w${u.n}-${u.sha}`, unit, n: u.n, media: null, kind: "webp", width: u.width, height: u.height, bytes: u.bytes, sha: u.sha, decorative: false,
    aiRead: !!opts.aiRead?.has(u.n),
  }, { ...opts, unit });
  const word = unit === "slide" ? "slide" : "page";
  return { ...v, whole: true, caption: v.title ? `${v.title} · ${word} ${u.n}` : unit === "slide" ? `Slide ${u.n} · the whole slide from your presentation` : `Page ${u.n} · the whole page from your file` };
}

/** Pure. Where a slide is drawn whole, the whole slide stands for its pictures in the notes and the strip. The pictures stay in the list, for the dialog. */
export function preferWhole<V extends Pick<Visual, "n" | "whole">>(visuals: readonly V[]): V[] {
  const drawn = new Set(visuals.filter(v => v.whole).map(v => v.n));
  return visuals.filter(v => v.whole || !drawn.has(v.n));
}

/** Pure. A presentation's content pictures (see buildVisuals). */
export function deckVisuals(scan: DeckScan, opts: BuildOptions = {}): { visuals: Visual[]; notShown: number } {
  return buildVisuals(scan, { ...opts, unit: opts.unit ?? "slide" });
}

/**
 * Pure. A PDF's whole-page visuals alone: its image-only pages -- recorded as holding no readable text (emptyUnits) or read by
 * AI from the page picture (aiReadUnits). The page is shown by the browser's own PDF viewer, never rasterised here.
 */
export function pdfVisuals(input: { emptyUnits?: readonly number[]; aiReadUnits?: readonly number[] } & Pick<BuildOptions, "pages" | "classify" | "textWords">): Visual[] {
  return buildVisuals(null, { unit: "page", emptyUnits: input.emptyUnits, aiRead: new Set(input.aiReadUnits ?? []), pages: input.pages, classify: input.classify, textWords: input.textWords }).visuals;
}

/** Pure. The visuals of a lesson section's slide / page range, in slide order (largest first within a slide). */
export function visualsForPages(visuals: readonly Visual[], from: number | null | undefined, to?: number | null): Visual[] {
  if (from === null || from === undefined || !Number.isInteger(from)) return [];
  let hi = to === null || to === undefined || !Number.isInteger(to) ? from : to;
  if (hi < from) hi = from;
  hi = Math.min(hi, from + MAX_SPAN);
  return visuals.filter(v => v.n >= from && v.n <= hi);
}

/**
 * Pure. SCHOLAR-VISUAL-001 s2 Rule 2: the pictures that belong with one section of the notes, in slide or page order. A section's own
 * slide, shown once where a long slide has several sections (`first`), and after its last section (`last`) the slides that follow with
 * no section of their own: a picture-only slide stays where it is in the file, with the notes before it, not in a gallery. `leading`
 * does the same for picture-only slides before the first section. Nothing is shown twice.
 */
export function visualsForSection(visuals: readonly Visual[], noSection: readonly number[], s: { from: number | null | undefined; to?: number | null; first: boolean; last: boolean; leading?: boolean }): Visual[] {
  if (s.from === null || s.from === undefined || !Number.isInteger(s.from)) return [];
  const none = new Set(noSection);
  const hi = s.to === null || s.to === undefined || !Number.isInteger(s.to) || s.to < s.from ? s.from : s.to;
  const pages: number[] = [];
  if (s.leading) for (let n = 1; n < s.from && none.has(n); n++) pages.push(n);
  if (s.first) for (let n = s.from; n <= hi; n++) pages.push(n);
  if (s.last) for (let n = hi + 1; none.has(n); n++) pages.push(n);
  const wanted = new Set(pages);
  return visuals.filter(v => wanted.has(v.n)).slice().sort((a, b) => a.n - b.n);
}

/** Pure. A lesson's pictures: those its sections cite, and the picture-only slides that follow them. In order, each once. */
export function visualsForLesson(visuals: readonly Visual[], noSection: readonly number[], ranges: readonly { pageFrom: number | null; pageTo: number | null }[]): Visual[] {
  const cited = visualsForSections(visuals, ranges as Parameters<typeof visualsForSections>[1]);
  const following = ranges.flatMap(r => visualsForSection(visuals, noSection, { from: r.pageFrom, to: r.pageTo, first: false, last: true }));
  const seen = new Set<string>();
  return [...cited, ...following].filter(v => (seen.has(v.key) ? false : (seen.add(v.key), true))).sort((a, b) => a.n - b.n);
}

/** Pure. A visual key as the URL carries it, or null when it is not one (nothing else is ever looked up). */
export function parseVisualKey(key: string): { kind: "slide"; n: number; sha: string } | { kind: "page"; n: number; sha: string | null } | { kind: "whole"; n: number; sha: string } | { kind: "section"; n: number; sha: string } | null {
  const section = /^s([1-9]\d{0,4})-([0-9a-f]{16})$/.exec(key);
  if (section) return { kind: "section", n: Number(section[1]), sha: section[2] };
  const whole = /^w([1-9]\d{0,4})-([0-9a-f]{16})$/.exec(key);
  if (whole) return { kind: "whole", n: Number(whole[1]), sha: whole[2] };
  const slide = /^([1-9]\d{0,4})-([0-9a-f]{16})$/.exec(key);
  if (slide) return { kind: "slide", n: Number(slide[1]), sha: slide[2] };
  const page = /^p([1-9]\d{0,4})(?:-([0-9a-f]{16}))?$/.exec(key);
  return page ? { kind: "page", n: Number(page[1]), sha: page[2] ?? null } : null;
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
  return material.mimeType === "application/pdf" || material.mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    || material.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? "ok" : "not_supported";
}

/** The URL of the visuals list of a material, and of one picture (or PDF page) in it. */
export const visualsListUrl = (materialId: string) => `/api/individual/scholar/materials/${materialId}/visuals`;
export const visualUrl = (materialId: string, key: string) => `${visualsListUrl(materialId)}/${key}`;
/** SCHOLAR-VISUAL-001 phase 2: asks for a material's slides to be drawn (at most once, however often it is asked). */
export const wholeSlidesUrl = (materialId: string) => `/api/individual/scholar/materials/${materialId}/whole-slides`;

/**
 * Pure. The unit and range a citation names ("Deck, slide 12" / "Notes, pages 3-4" / "Report, section 4"), or null when it names none.
 * Used where only the citation is at hand (Flashcards, Revise). A section of a Word file holds the pictures placed there; a text file's holds none.
 */
export function pagesOfCitation(citation: string): { unit: "slide" | "page" | "section"; from: number; to: number } | null {
  const m = /\b(slide|page|section)s?\s+(\d{1,5})(?:\s*[-–]\s*(\d{1,5}))?\s*$/i.exec(citation.trim());
  if (!m) return null;
  const from = Number(m[2]);
  const to = m[3] ? Number(m[3]) : from;
  const named = m[1].toLowerCase();
  return { unit: named === "slide" ? "slide" : named === "section" ? "section" : "page", from, to: Math.max(from, to) };
}

/** Pure. The visuals for a lesson's sections (each a slide / page range), in order, without repeats. */
export function visualsForSections(visuals: readonly Visual[], ranges: readonly { pageFrom: number | null; pageTo: number | null }[]): Visual[] {
  const seen = new Set<string>();
  const out: Visual[] = [];
  for (const r of ranges) for (const v of visualsForPages(visuals, r.pageFrom, r.pageTo)) if (!seen.has(v.key)) { seen.add(v.key); out.push(v); }
  return out;
}

/** The learner's override on a strip: show the pictures, let the text teach, or both. `null` = each picture's own behaviour. */
export type VisualMode = VisualBehaviour;
/** Pure. A picture's behaviour under the learner's override (null: its own). */
export const effectiveBehaviour = (v: Pick<Visual, "behaviour">, mode: VisualMode | null): VisualBehaviour => mode ?? v.behaviour;

/**
 * Pure. What a lesson strip shows: the pictures to show (behaviour image or both, in page order, at most `max`) and those the text
 * teaches (kept as a collapsed link to the original, not counted in `max`).
 */
export function arrangeStrip(visuals: readonly Visual[], mode: VisualMode | null, max: number): { shown: Visual[]; more: number; textOnly: Visual[] } {
  const showing = visuals.filter(v => effectiveBehaviour(v, mode) !== "text");
  const textOnly = visuals.filter(v => effectiveBehaviour(v, mode) === "text");
  return { shown: showing.slice(0, max), more: Math.max(0, showing.length - max), textOnly };
}

/** What the recovery card's page picker shows for one planned page. */
export type PlannedPage = { n: number; label: string; caption: string; keep: boolean };
/** Why a chart or table page is not ticked by default. */
export const KEEP_PICTURE_NOTE = "Kept as the original picture: scores and thresholds are not read from charts.";

/**
 * Pure. The recovery card's checklist: each page the plan would read, its label from the index ("Page 26 · Diagram or picture"),
 * and whether it is ticked by default -- a page labelled an observation chart / scoring tool, or a table, is NOT (its numbers are
 * never read by AI). The label comes from the page's own text, which a page with no text layer lacks: such a page is a "Diagram
 * or picture" until something says otherwise.
 */
export function plannedPages(plan: readonly number[], pages: ReadonlyMap<number, PageInfo>, unit: "slide" | "page"): PlannedPage[] {
  const word = unit === "slide" ? "Slide" : "Page";
  const chartLike = (l: string) => l === LABEL_SCORING || l === LABEL_TABLE;
  return plan.map(n => {
    const c = classifyPage(pages.get(n));
    if (chartLike(c.label)) return { n, label: c.label, caption: `${word} ${n} · ${c.label}`, keep: true };
    // A page with no text layer cannot name itself. Next to a chart or scoring-tool page (a deck saved as PDF keeps a chart's
    // continuation pages together), it is LIKELY one too: said as "likely", never named as a specific tool, and kept as the
    // original picture by default -- the learner can still tick it.
    const near = [n - 1, n + 1].find(m => pages.has(m) && chartLike(classifyPage(pages.get(m)).label));
    if (near !== undefined && !pages.get(n)?.textLayer) {
      const label = "Likely an observation chart, scoring tool or table";
      return { n, label, caption: `${word} ${n} · ${label} (next to ${word.toLowerCase()} ${near})`, keep: true };
    }
    return { n, label: c.label, caption: `${word} ${n} · ${c.label}`, keep: false };
  });
}
