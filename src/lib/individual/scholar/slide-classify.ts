import type { ExtractionQuality } from "./extract";
import { slideMedia } from "./material-visuals";
import { slidePictures } from "./slide-images";

// ── WHAT EACH SLIDE ACTUALLY HOLDS, AND WHAT BECAME OF IT ── SCHOLAR-PPTX-READING-01 ───────────────────────────────────
//
// Pure. "No text came out" is not the same as "nothing is there". This file reads a slide's own structure (groups at any depth,
// pictures, tables, charts, diagrams, drawn shapes) and says what it holds, and from that and the AI readings on record it gives
// each slide exactly one status, so the counts add up to the slides in the file:
//
//   text      native slide text was read, and nothing else on the slide is waiting
//   image     the content was interpreted from a picture by AI
//   mixed     native text and a picture were both read
//   blank     no content at all: nothing, or only empty placeholders. Never given to a slide holding anything else
//   preserved its original picture is kept and shown, and has not been interpreted (SCHOLAR-VISUAL-001 s3.4). Said, and not a warning
//   review    content is there that was not read, or was not read reliably. Always with the reason
//   processing  a reading is underway now
//
// ⚠ A slide holding an unread chart, diagram, drawing or group is never blank. A blank slide has no section, so it is not taught
// from, counted or offered for an AI reading, and slide numbers are never renumbered. Nothing here calls AI or changes a section.

/** Content on a slide that Scholar does not read. A picture is not here: pictures can be read. */
export type SlideContentKind = "chart" | "diagram" | "embedded" | "media" | "ink" | "drawing" | "unsupported_picture";

/** What one slide part holds. `pictures` are the readable ones that count as content; decorative ones are counted apart. */
export type SlideStructure = { slide: number; grouped: boolean; pictures: number; decorative: number; kinds: SlideContentKind[] };

export const SLIDE_FACTS_VERSION = 1;
/** Sent on the window while an AI reading of some slides is underway, so Reading details can say so. */
export const SLIDE_READING_EVENT = "scholar:slides-reading";
const EXTRACT_CHARS = 700;

/** Stored in extraction_quality (slide_facts). Blank slides are NOT in emptyUnits. */
export type SlideFacts = {
  version: number;
  checkedAt: string;
  blank: number[];
  /** Native text AND a picture that counts as content. */
  mixed: number[];
  /** A group at any depth was looked inside. */
  grouped: number[];
  review: { unit: number; kinds: SlideContentKind[]; picture: boolean }[];
};

export type SlideSkipReason = "no_picture" | "unsupported" | "too_large" | "patient_identifier" | "no_text";
export type SlideStatus = "text" | "image" | "mixed" | "blank" | "preserved" | "review" | "processing";
export type SlideRow = {
  slide: number;
  status: SlideStatus;
  /** Plain reasons, for a slide under review. */
  reasons: string[];
  /** All the ways this slide was read: kept even where the status counts it once. */
  methods: ("slide_text" | "ai_picture")[];
  grouped: boolean;
  /** It holds a picture that can still be asked for. */
  pictureWaiting: boolean;
};

const SHAPE = /<p:sp\b[\s\S]*?<\/p:sp>/g;

/** Pure. Whether a shape with no text can be seen: an outline-less, fill-less box is nothing on the slide. */
function drawnShape(shape: string): boolean {
  if (/<p:ph\b/.test(shape) || /<a:t(?:\s[^>]*)?>\s*[^<\s]/.test(shape) || /<a:blip\b/.test(shape)) return false;
  const props = shape.match(/<p:spPr\b[\s\S]*?<\/p:spPr>/)?.[0] ?? "";
  if (!/<a:(?:prstGeom|custGeom)\b/.test(props)) return false;
  const line = props.match(/<a:ln\b[\s\S]*?<\/a:ln>/)?.[0] ?? "";
  const filled = !/<a:noFill\s*\/>/.test(line ? props.replace(line, "") : props);
  const lined = !!line && !/<a:noFill\s*\/>/.test(line);
  return filled || lined;
}

/**
 * Pure. What one slide part holds, from its XML and .rels. Nested groups need no walking: every element in a group is in the same
 * XML, so each test below already looks inside them. `hasText` decides only whether stray drawn shapes matter (a labelled slide's
 * arrows and boxes are not content waiting to be read; a slide of nothing but shapes may be a diagram).
 */
export function slideContent(slide: number, xml: string, rels: string | null, hasText: boolean): SlideStructure {
  const pictures = slidePictures(xml, rels);
  const media = slideMedia(xml, rels);
  const kinds = new Set<SlideContentKind>();
  if (/<a:graphicData\b[^>]*uri="[^"]*\/chart"/.test(xml)) kinds.add("chart");
  if (/<a:graphicData\b[^>]*uri="[^"]*\/diagram"/.test(xml)) kinds.add("diagram");
  if (/<p:oleObj\b/.test(xml)) kinds.add("embedded");
  if (/<a:(?:videoFile|audioFile|quickTimeFile|wavAudioFile)\b/.test(xml) || /<p14:media\b/.test(xml)) kinds.add("media");
  if (/<p:contentPart\b/.test(xml)) kinds.add("ink");
  if (!hasText && (/<p:cxnSp\b/.test(xml) || (xml.match(SHAPE) ?? []).some(drawnShape))) kinds.add("drawing");
  if (!pictures.images.length && (pictures.unsupported.length || media.undisplayable.length || media.linked)) kinds.add("unsupported_picture");
  return { slide, grouped: /<p:grpSp\b/.test(xml), pictures: pictures.images.length, decorative: 0, kinds: [...kinds] };
}

const ordered = (ns: Iterable<number>): number[] => [...new Set(ns)].filter(n => Number.isInteger(n) && n > 0).sort((a, b) => a - b);

/** Pure. The record for a file, from each slide's structure and which slides gave native text. */
export function buildSlideFacts(structures: readonly SlideStructure[], withText: ReadonlySet<number>, checkedAt: string): SlideFacts {
  const has = (s: SlideStructure) => withText.has(s.slide);
  return {
    version: SLIDE_FACTS_VERSION, checkedAt,
    blank: ordered(structures.filter(s => !has(s) && !s.pictures && !s.decorative && !s.kinds.length).map(s => s.slide)),
    mixed: ordered(structures.filter(s => has(s) && s.pictures > 0).map(s => s.slide)),
    grouped: ordered(structures.filter(s => s.grouped).map(s => s.slide)),
    review: structures.filter(s => s.kinds.length).map(s => ({ unit: s.slide, kinds: s.kinds, picture: s.pictures + s.decorative > 0 })),
  };
}

/**
 * Pure. A material's quality record with this reading of its slides. Sections, AI readings and their provenance are not touched, so
 * this can run on a stored material as often as wanted. A slide that holds a section is never blank, whatever its structure says.
 */
export function applySlideFacts<Q extends ExtractionQuality>(q: Q, facts: SlideFacts, unitsWithSections: Iterable<number> = []): Q {
  const kept = new Set([...unitsWithSections, ...(q.aiReadUnits ?? [])]);
  const blank = facts.blank.filter(n => !kept.has(n));
  const isBlank = new Set(blank);
  return {
    ...q,
    emptyUnits: q.emptyUnits.filter(n => !isBlank.has(n)),
    ...(q.aiTriedUnits ? { aiTriedUnits: q.aiTriedUnits.filter(n => !isBlank.has(n)) } : {}),
    ...(q.aiSkipped ? { aiSkipped: q.aiSkipped.filter(s => !isBlank.has(s.unit)) } : {}),
    slideFacts: { ...facts, blank },
  };
}

/** Pure. Whether this material's slides have had this reading (null facts: uploaded before it, so only emptyUnits is known). */
export const hasSlideFacts = (q: ExtractionQuality | null): q is ExtractionQuality & { slideFacts: SlideFacts } => !!q && q.unit === "slide" && !!q.slideFacts;

const KIND_REASON: Record<SlideContentKind, string> = {
  chart: "a chart Scholar cannot read yet",
  diagram: "a diagram Scholar cannot read yet",
  embedded: "an embedded object Scholar cannot open",
  media: "a video or sound clip Scholar cannot listen to or watch",
  ink: "handwriting or ink Scholar cannot read yet",
  drawing: "shapes or a drawing Scholar cannot read yet",
  unsupported_picture: "a picture in a format Scholar cannot read",
};
const SKIP_REASON: Record<SlideSkipReason, string> = {
  no_picture: "no picture Scholar could open",
  unsupported: "a picture in a format Scholar cannot read",
  too_large: "a picture too large to read",
  patient_identifier: "what looked like patient details, so the reading was not kept",
  no_text: "a picture with no words Scholar could read reliably",
};
const TRIED_UNKNOWN = "a picture Scholar could not read reliably";

/** Pure. Every slide with its one status, in slide order. Null when this material has not had this reading. */
export function slideRows(q: ExtractionQuality | null, opts: { processing?: readonly number[] } = {}): SlideRow[] | null {
  if (!hasSlideFacts(q)) return null;
  const f = q.slideFacts;
  const blank = new Set(f.blank), mixed = new Set(f.mixed), grouped = new Set(f.grouped), empty = new Set(q.emptyUnits);
  const read = new Set(q.aiReadUnits ?? []), tried = new Set(q.aiTriedUnits ?? []), processing = new Set(opts.processing ?? []);
  const review = new Map(f.review.map(r => [r.unit, r]));
  const skipped = new Map((q.aiSkipped ?? []).map(s => [s.unit, s.reason]));
  const rows: SlideRow[] = [];
  for (let slide = 1; slide <= q.units; slide++) {
    const native = !empty.has(slide) && !blank.has(slide) && (!read.has(slide) || mixed.has(slide));
    const methods: SlideRow["methods"] = [...(native ? ["slide_text" as const] : []), ...(read.has(slide) ? ["ai_picture" as const] : [])];
    const reasons = (review.get(slide)?.kinds ?? []).map(k => KIND_REASON[k]);
    const wantsReading = (empty.has(slide) && (review.get(slide)?.picture ?? true)) || mixed.has(slide);
    let pictureWaiting = false;
    if (wantsReading && !read.has(slide)) {
      if (tried.has(slide)) reasons.push(skipped.has(slide) ? SKIP_REASON[skipped.get(slide)!] : TRIED_UNKNOWN);
      else pictureWaiting = true;
    }
    const status: SlideStatus = processing.has(slide) ? "processing"
      : blank.has(slide) ? "blank"
      : reasons.length ? "review"
      : pictureWaiting ? "preserved"
      : read.has(slide) ? (mixed.has(slide) ? "mixed" : "image")
      : "text";
    rows.push({ slide, status, reasons: [...new Set(reasons)], methods, grouped: grouped.has(slide), pictureWaiting });
  }
  return rows;
}

export type SlideCounts = Record<SlideStatus, number> & { total: number };

/** Pure. How many slides hold each status. Each slide is counted once, so these add up to the total. */
export function slideCounts(rows: readonly SlideRow[]): SlideCounts {
  const c: SlideCounts = { total: rows.length, text: 0, image: 0, mixed: 0, blank: 0, preserved: 0, review: 0, processing: 0 };
  for (const r of rows) c[r.status]++;
  return c;
}

/** Pure. What Scholar took from each slide a learner can choose in Reading details, from the sections already stored. No text slide is listed. */
export function slideExtracts(rows: readonly SlideRow[], chunks: readonly { pageFrom: number | null; pageTo: number | null; content: string }[]): Record<number, string> {
  const out: Record<number, string> = {};
  for (const r of rows) {
    if (r.status === "text" || r.status === "blank") continue;
    const text = chunks.filter(c => c.pageFrom !== null && c.pageFrom <= r.slide && r.slide <= (c.pageTo ?? c.pageFrom)).map(c => c.content).join("\n\n").trim();
    if (text) out[r.slide] = text.length > EXTRACT_CHARS ? `${text.slice(0, EXTRACT_CHARS).trimEnd()}…` : text;
  }
  return out;
}

/** Pure. The slides or pages a learner must be warned about: never a blank slide, nor a picture that is kept and shown. */
export function readingAttention(q: ExtractionQuality | null): number {
  const rows = slideRows(q);
  return rows ? rows.filter(r => r.status === "review").length : q?.emptyUnits.length ?? 0;
}

/** Pure. Whether any picture here can still be asked for. */
export function picturesCanBeRead(q: ExtractionQuality | null): boolean {
  const rows = slideRows(q);
  return rows ? rows.some(r => r.pictureWaiting) : (q?.emptyUnits.length ?? 0) > 0;
}

/** Pure. What an AI reading may be asked for: picture-only slides first, then the pictures on slides that also have text. */
export function pictureReadingInput(q: ExtractionQuality): { emptyUnits: number[]; mixedUnits: number[]; triedUnits?: number[] } {
  const noPicture = new Set((q.slideFacts?.review ?? []).filter(r => !r.picture).map(r => r.unit));
  return { emptyUnits: q.emptyUnits.filter(n => !noPicture.has(n)), mixedUnits: q.slideFacts?.mixed ?? [], triedUnits: q.aiTriedUnits };
}

const listSlides = (u: readonly number[]): string => `Slide${u.length === 1 ? "" : "s"} ${u.length > 8 ? `${u.slice(0, 8).join(", ")} and ${u.length - 8} more` : u.join(", ")}`;

/** Pure. The sentences a learner reads about a presentation that has had this reading. */
export function slideSummary(rows: readonly SlideRow[], opts: { recoverable?: boolean; picturesShown?: boolean } = {}): { partial: boolean; heading: string; text: string } {
  const c = slideCounts(rows);
  const blank = c.blank ? ` ${c.blank} blank slide${c.blank === 1 ? " was" : "s were"} skipped because ${c.blank === 1 ? "it" : "they"} contained no learning content.` : "";
  const interpreted = c.image + c.mixed ? " Some slides were interpreted from pictures. You can review these against your original slides." : "";
  const kept = rows.filter(r => r.status === "preserved").map(r => r.slide);
  const shown = opts.picturesShown !== false;
  const ask = opts.recoverable ? " To have Scholar read them, choose Read the pictures." : "";
  const preserved = !kept.length ? "" : shown
    ? ` ${listSlides(kept)}: the original picture${kept.length === 1 ? " is" : "s are"} kept in your notes and lessons, and Scholar has not interpreted ${kept.length === 1 ? "it" : "them"} yet.${ask}`
    : "";
  const attention = rows.filter(r => r.status === "review");
  const hidden = kept.length > 0 && !shown;
  if (!attention.length && !hidden) {
    if (c.processing) return { partial: false, heading: "Still reading", text: `Scholar is still reading ${listSlides(rows.filter(r => r.status === "processing").map(r => r.slide)).toLowerCase()}.${preserved}${blank}${interpreted}` };
    return { partial: false, heading: "Ready to learn", text: `Your presentation has been processed.${preserved}${blank}${interpreted}` };
  }
  const byReason = new Map<string, number[]>();
  for (const r of attention) for (const why of r.reasons) byReason.set(why, [...(byReason.get(why) ?? []), r.slide]);
  const reasons = [...byReason].map(([why, slides]) => `${listSlides(slides)}: ${why}.`);
  if (hidden) reasons.push(`${listSlides(kept)}: a picture Scholar has not read yet, so it cannot teach from ${kept.length === 1 ? "it" : "them"}.${ask}`);
  const n = attention.length + (hidden ? kept.length : 0);
  return { partial: true, heading: "Partly read", text: `Partly read: ${n} of ${c.total} slides need${n === 1 ? "s" : ""} attention. ${reasons.join(" ")}${preserved}${blank}${interpreted}` };
}
