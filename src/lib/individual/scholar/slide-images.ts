// ── PICTURE-ONLY SLIDES: WHICH SLIDES, WHICH PICTURES, AND WHERE THEIR SECTIONS GO ── SCHOLAR-UPLOAD-FIX ──────────
//
// Pure. A PowerPoint slide that held no text (extraction_quality.empty_units) may hold a picture of text -- a
// screenshot, a scanned handout. On the learner's request, and only where policy scholar_material_image_slides allows
// it, those slides' pictures are put one slide per page into a PDF and read by the EXISTING transcription runner
// (exam-answer.ts runTranscription). This file decides, without I/O:
//
//   * which slides may be read: only slides recorded as empty, never one already attempted, never one that already has
//     a section, and at most MAX_AI_SLIDES_PER_MATERIAL attempted per material, ever;
//   * which pictures a slide shows: the relationships its own XML embeds (r:embed / r:link), resolved through the
//     slide's .rels into ppt/media. Only PNG and JPEG can be put in the PDF; anything else (EMF, WMF, SVG, GIF, TIFF, a
//     linked picture) is reported as such, never guessed at;
//   * where the new sections go: in slide order among the existing ones, WITHOUT changing any existing id. Ordinals of
//     later sections are only ever raised, and the moves are listed in an order that never collides with the unique
//     (material_id, ordinal) index.

/** The most slides of one material that may ever be sent for an AI reading. */
export const MAX_AI_SLIDES_PER_MATERIAL = 10;
/** Pictures per slide, and their combined size: two slides go in one call, as a PDF, well inside the provider's limit. */
export const SLIDE_IMAGE_LIMITS = { imagesPerSlide: 6, bytesPerSlide: 8 * 1024 * 1024 } as const;

const SUPPORTED = new Set(["png", "jpg", "jpeg"]);
const IMAGE_REL = /\/relationships\/image$/;

export type SlideRel = { target: string; image: boolean; external: boolean };

/** Pure. A .rels part → its relationships by id. */
export function parseRels(xml: string): Map<string, SlideRel> {
  const out = new Map<string, SlideRel>();
  for (const m of xml.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/g)) {
    const attrs = new Map([...m[1].matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)].map(a => [a[1], a[2]]));
    const id = attrs.get("Id");
    if (!id) continue;
    out.set(id, { target: attrs.get("Target") ?? "", image: IMAGE_REL.test(attrs.get("Type") ?? ""), external: (attrs.get("TargetMode") ?? "") === "External" });
  }
  return out;
}

/**
 * Pure. A relationship target, relative to ppt/slides/, as a part name. Null unless it lands inside ppt/media/ -- a
 * target that climbs out of the package, or points anywhere else, is never opened.
 */
export function mediaPart(target: string): string | null {
  const t = target.replace(/\\/g, "/");
  const parts = t.startsWith("/") ? t.slice(1).split("/") : ["ppt", "slides", ...t.split("/")];
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") { if (!out.length) return null; out.pop(); continue; }
    out.push(p);
  }
  const name = out.join("/");
  return out.length === 3 && out[0] === "ppt" && out[1] === "media" ? name : null;
}

const extOf = (part: string) => (part.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();

export type SlidePictures = {
  /** The PNG / JPEG parts, in the order the slide shows them, at most SLIDE_IMAGE_LIMITS.imagesPerSlide. */
  images: string[];
  /** What could not be used: a file extension ("emf", "svg"...), "linked" for a picture outside the file. */
  unsupported: string[];
};

/** Pure. The pictures one slide embeds, from its XML and its .rels (null when it has none). */
export function slidePictures(slideXml: string, relsXml: string | null): SlidePictures {
  const rels = relsXml ? parseRels(relsXml) : new Map<string, SlideRel>();
  const ids = [...new Set([...slideXml.matchAll(/\b(?:\w+:)?(?:embed|link)\s*=\s*"([^"]+)"/g)].map(m => m[1]))];
  const images: string[] = [];
  const unsupported: string[] = [];
  for (const id of ids) {
    const rel = rels.get(id);
    if (!rel || !rel.image) continue;
    if (rel.external) { unsupported.push("linked"); continue; }
    const part = mediaPart(rel.target);
    if (!part) continue;
    const ext = extOf(part);
    if (!SUPPORTED.has(ext)) { unsupported.push(ext || "unknown"); continue; }
    if (!images.includes(part)) images.push(part);
  }
  return { images: images.slice(0, SLIDE_IMAGE_LIMITS.imagesPerSlide), unsupported: [...new Set(unsupported)] };
}

/** Pure. What a picture's bytes really are -- the extension is the file's claim, the magic bytes are the fact. */
export function imageKind(bytes: Uint8Array): "png" | "jpeg" | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  return null;
}

/**
 * Pure. The slides that may be read now, in slide order: recorded as empty, not attempted before, with no section yet,
 * within the per-material cap. `beyondCap`: empty slides left that the cap will never allow.
 */
export function planPictureSlides(input: {
  emptyUnits: readonly number[]; triedUnits?: readonly number[]; slidesWithSections?: Iterable<number>; cap?: number;
}): { slides: number[]; beyondCap: number } {
  const tried = new Set(input.triedUnits ?? []);
  const have = new Set(input.slidesWithSections ?? []);
  const cap = input.cap ?? MAX_AI_SLIDES_PER_MATERIAL;
  const open = [...new Set(input.emptyUnits)].filter(n => Number.isInteger(n) && n > 0 && !tried.has(n) && !have.has(n)).sort((a, b) => a - b);
  const allowed = Math.max(0, cap - tried.size);
  return { slides: open.slice(0, allowed), beyondCap: Math.max(0, open.length - allowed) };
}

/** Pure. A transcription that is nothing but figure or unreadable markers holds no text to teach from. */
export function hasReadableText(text: string): boolean {
  return text.replace(/\[(?:FIGURE:[^\]]*|UNREADABLE)\]/gi, "").replace(/^\s*PAGE\s+\d+\s*$/gim, "").replace(/\s+/g, "").length > 0;
}

export type ExistingChunk = { id: string; ordinal: number; pageFrom: number | null };
export type NewChunk = { pageFrom: number; pageTo: number; content: string };

/**
 * Pure. Where new sections (each on one slide) go among the existing ones: after every section of an earlier or the
 * same slide, before the first section of a later slide. Existing ids never change, and an existing ordinal is only
 * ever RAISED (to make room), so `moves` -- listed from the last section back to the first -- can be applied one row at a
 * time without two rows ever holding the same ordinal. `inserts` are then free.
 */
export function planChunkInsertion(existing: readonly ExistingChunk[], additions: readonly NewChunk[]): {
  moves: { id: string; from: number; to: number }[]; inserts: (NewChunk & { ordinal: number })[];
} {
  const old = [...existing].sort((a, b) => a.ordinal - b.ordinal);
  const adds = [...additions].map((a, i) => ({ a, i })).sort((x, y) => x.a.pageFrom - y.a.pageFrom || x.i - y.i).map(x => x.a);
  const merged: ({ kind: "old"; c: ExistingChunk } | { kind: "new"; c: NewChunk })[] = [];
  let j = 0;
  for (const c of old) {
    while (j < adds.length && c.pageFrom !== null && c.pageFrom > adds[j].pageFrom) merged.push({ kind: "new", c: adds[j++] });
    merged.push({ kind: "old", c });
  }
  while (j < adds.length) merged.push({ kind: "new", c: adds[j++] });
  const moves: { id: string; from: number; to: number }[] = [];
  const inserts: (NewChunk & { ordinal: number })[] = [];
  let prev = 0;
  for (const m of merged) {
    if (m.kind === "old") {
      const to = Math.max(m.c.ordinal, prev + 1);
      if (to !== m.c.ordinal) moves.push({ id: m.c.id, from: m.c.ordinal, to });
      prev = to;
    } else {
      prev += 1;
      inserts.push({ ...m.c, ordinal: prev });
    }
  }
  return { moves: moves.reverse(), inserts };
}
