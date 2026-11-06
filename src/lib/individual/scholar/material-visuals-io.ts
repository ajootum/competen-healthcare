import { createHash } from "node:crypto";
import type { IndividualContext } from "../guard";
import { loadIndividualPolicy } from "../policy";
import { PDF_MIME } from "./config";
import { openOfficeZip, slidePartNames } from "./extract";
import { getMaterial, listChunks, materialBytes, materialExtras, type MaterialRow } from "./store";
import { readDrawnSlide, readRender } from "./slide-render-read";
import { renderState, type RenderState } from "./slide-render";
import { MAX_CONVERT_INPUT_BYTES, imageKind } from "./slide-images";
import { pdfPagesPdf } from "./slide-reading";
import { pdfImageFile, scanPdfImages } from "./material-visuals-pdf";
import {
  BROWSER_KINDS, CONTENT_TYPE, DEFAULT_TEXT_WORDS, buildVisuals, canServeVisual, pageInfoOf, parseVisualKey, slideMedia, wholeSlideVisual,
  type DeckScan, type PictureFact, type Visual,
} from "./material-visuals";

// ── THE STUDENT'S OWN PICTURES: READING THEM FROM THE STORED FILE ── SCHOLAR-LESSON-VISUALS-01 ──────────────────────
//
// Read-only and owner-only. No AI, no write, no audit per picture. Every read is keyed on the caller's own user id by the
// existing store reads (getMaterial / materialExtras / materialBytes), so another person's material id is "not found".
// The judgement of which pictures count is pure (material-visuals.ts); this file measures them (sharp, crypto) and serves
// the ORIGINAL bytes -- never resized, cropped or re-encoded (a TIFF or BMP is only made lossless PNG so a browser can show it).

type Out = { status: number; body: Record<string, unknown> };
const json = (status: number, body: Record<string, unknown>): Out => ({ status, body });
const sha16 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex").slice(0, 16);

// ── The in-process cache: the measured pictures of a presentation (not its bytes), least recently used out at 50. ──────
const CACHE_MAX = 50;
const cache = new Map<string, DeckScan>();
const cacheKey = (m: MaterialRow) => `${m.id}:${m.createdAt}:${m.byteSize}`;
function cacheGet(k: string): DeckScan | undefined {
  const v = cache.get(k);
  if (v) { cache.delete(k); cache.set(k, v); }
  return v;
}
function cachePut(k: string, v: DeckScan): void {
  cache.delete(k);
  cache.set(k, v);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}
/** For tests: forget every cached presentation. */
export function clearVisualsCache(): void { cache.clear(); }

/** The width and height sharp reads from the picture's header (a multi-frame picture: its first frame), or nulls. */
async function dimensions(bytes: Uint8Array): Promise<{ width: number | null; height: number | null }> {
  try {
    const sharp = (await import("sharp")).default;
    const m = await sharp(bytes, { limitInputPixels: 100_000_000 }).metadata();
    return { width: m.width ?? null, height: (m.pageHeight ?? m.height) ?? null };
  } catch {
    return { width: null, height: null };
  }
}

/** Measure every picture of a presentation once (a picture shared by slides is read once). Null when the file cannot be opened. */
export async function scanDeck(bytes: Uint8Array): Promise<DeckScan | null> {
  const z = await openOfficeZip(bytes);
  if (!z.ok) return null;
  const { zip } = z;
  try {
    const parts = slidePartNames(Object.keys(zip.files));
    const measured = new Map<string, Omit<PictureFact, "n" | "media"> | null>();
    const measure = async (part: string) => {
      if (measured.has(part)) return measured.get(part) ?? null;
      const data = await zip.file(part)?.async("uint8array");
      let fact: Omit<PictureFact, "n" | "media"> | null = null;
      if (data) {
        const kind = imageKind(data);
        fact = { kind, bytes: data.byteLength, sha: sha16(data), ...(kind ? await dimensions(data) : { width: null, height: null }) };
      }
      measured.set(part, fact);
      return fact;
    };
    const scan: DeckScan = { slides: parts.length, pictures: [], undisplayable: [] };
    for (const [i, name] of parts.entries()) {
      const n = i + 1;
      const xml = await zip.file(name)!.async("string");
      const rels = await zip.file(name.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels")?.async("string");
      const media = slideMedia(xml, rels ?? null);
      for (const part of media.images) {
        const fact = await measure(part);
        if (fact) scan.pictures.push({ n, media: part, ...fact });
      }
      for (const part of media.undisplayable) scan.undisplayable.push({ n, media: part });
      for (let k = 0; k < media.linked; k++) scan.undisplayable.push({ n, media: null });
    }
    return scan;
  } catch {
    return null;
  }
}

type Index = { unit: "slide" | "page"; visuals: Visual[]; notShown: number; noSection: number[]; render: RenderState };
type Indexed = { ok: true; index: Index } | { ok: false; out: Out };

type Settings = { minPx: number; maxPerSlide: number; classify: boolean; textWords: number; whole: boolean };

/** The visuals of one of the caller's own materials, under the current policy. */
async function indexOf(ctx: IndividualContext, material: MaterialRow, policy: Settings): Promise<Indexed> {
  const pdf = material.mimeType === PDF_MIME;
  const [extras, chunks] = await Promise.all([
    materialExtras(ctx.admin, ctx.userId, [material.id]),
    // The sections already stored (a page's own text layer, or its existing AI reading): read, never written or re-transcribed.
    policy.classify ? listChunks(ctx.admin, ctx.userId, material.id) : Promise.resolve(null),
  ]);
  const quality = extras.byId.get(material.id)?.quality ?? null;
  const empty = quality?.emptyUnits ?? [], aiRead = quality?.aiReadUnits ?? [];
  const pages = pageInfoOf(chunks?.ok ? chunks.data : [], empty, aiRead);

  let scan = cacheGet(cacheKey(material)) ?? null;
  if (!scan) {
    const bytes = await materialBytes(ctx.admin, ctx.userId, material.id);
    if (!bytes) return { ok: false, out: json(503, { error: "Your original file could not be read just now. Try again shortly." }) };
    const fresh = pdf ? await scanPdfImages(bytes) : await scanDeck(bytes);
    // A PDF that cannot be opened for its pictures still has its image-only pages; a presentation that cannot be opened has nothing.
    if (!fresh && !pdf) return { ok: false, out: json(422, { error: "The pictures in your file could not be read." }) };
    if (fresh) cachePut(cacheKey(material), fresh);
    scan = fresh;
  }
  const built = buildVisuals(scan, {
    unit: pdf ? "page" : "slide", minPx: policy.minPx, maxPerSlide: policy.maxPerSlide, aiRead: new Set(aiRead), emptyUnits: empty,
    pages, classify: policy.classify, textWords: policy.textWords,
  });
  // SCHOLAR-VISUAL-001 phase 2: a slide drawn whole comes first among its own pictures, which stay in the list for the dialog. Policy off: none.
  const wholeOn = policy.whole && !pdf;
  const drawing = wholeOn ? await readRender(ctx, material.id) : null;
  const whole = (drawing?.units ?? []).map(u => wholeSlideVisual(u, { aiRead: new Set(aiRead), pages, classify: policy.classify, textWords: policy.textWords }));
  const visuals = [...whole, ...built.visuals].sort((a, b) => a.n - b.n || Number(!!b.whole) - Number(!!a.whole));
  const drawnSlides = new Set(whole.map(v => v.n));
  // A picture no browser can show is no longer missing where the whole slide shows it.
  const notShown = wholeOn ? Math.max(0, built.notShown - (scan?.undisplayable ?? []).filter(u => drawnSlides.has(u.n)).length) : built.notShown;
  const render = wholeOn ? renderState(true, drawing, Date.now()) : "off";
  // SCHOLAR-VISUAL-001: the slides or pages with no section of their own, so a picture-only one can be shown where it is in the file.
  const noSection = [...new Set([...empty, ...(quality?.slideFacts?.blank ?? [])])].sort((a, b) => a - b);
  return { ok: true, index: { unit: pdf ? "page" : "slide", visuals, notShown, noSection, render } };
}

const settingsOf = (policy: { scholarLessonVisualsMinPx: number; scholarLessonVisualsMaxPerSection: number; scholarVisualClassify?: string; scholarVisualTextWords?: number; scholarWholeSlides?: string }): Settings => ({
  minPx: policy.scholarLessonVisualsMinPx, maxPerSlide: policy.scholarLessonVisualsMaxPerSection,
  classify: policy.scholarVisualClassify !== "off", textWords: policy.scholarVisualTextWords ?? DEFAULT_TEXT_WORDS,
  whole: policy.scholarWholeSlides === "on",
});

async function openMaterial(ctx: IndividualContext, materialId: string): Promise<{ ok: true; material: MaterialRow; supported: boolean } | { ok: false; out: Out }> {
  const r = await getMaterial(ctx.admin, ctx.userId, materialId);
  if (!r.ok) return { ok: false, out: json(503, { error: "That material could not be read just now." }) };
  const verdict = canServeVisual(r.data, ctx.userId);
  if (verdict === "not_found" || !r.data) return { ok: false, out: json(404, { error: "Not found" }) };
  return { ok: true, material: r.data, supported: verdict === "ok" };
}

/** GET .../materials/[id]/visuals -- the pictures of the caller's own PDF or PowerPoint. */
export async function materialVisuals(ctx: IndividualContext, materialId: string): Promise<Out> {
  const opened = await openMaterial(ctx, materialId);
  if (!opened.ok) return opened.out;
  const policy = await loadIndividualPolicy(ctx.admin);
  if (policy.scholarLessonVisuals !== "on") return json(200, { visuals: [], off: true });
  if (!opened.supported) return json(200, { unit: "section", visuals: [], notShown: 0 });
  const idx = await indexOf(ctx, opened.material, settingsOf(policy));
  if (!idx.ok) return idx.out;
  return json(200, { unit: idx.index.unit, visuals: idx.index.visuals, notShown: idx.index.notShown, noSection: idx.index.noSection, render: idx.index.render });
}

export type VisualFile = { status: number; error?: string; bytes?: Uint8Array; type?: string; maxAge?: "immutable" | "short" };

/** GET .../materials/[id]/visuals/[key] -- one picture, exactly as in the caller's own file (a PDF page: that page as a one-page PDF). */
export async function materialVisualFile(ctx: IndividualContext, materialId: string, key: string): Promise<VisualFile> {
  const parsed = parseVisualKey(key);
  if (!parsed) return { status: 404, error: "Not found" };
  const opened = await openMaterial(ctx, materialId);
  if (!opened.ok) return { status: opened.out.status, error: String(opened.out.body.error ?? "Not found") };
  if (!opened.supported) return { status: 404, error: "Not found" };
  const policy = await loadIndividualPolicy(ctx.admin);
  if (policy.scholarLessonVisuals !== "on") return { status: 404, error: "Not found" };
  // A drawn slide: its image exactly as stored, found by the caller's own record. Its key carries a digest, so it can be cached for good.
  if (parsed.kind === "whole") {
    if (policy.scholarWholeSlides !== "on") return { status: 404, error: "Not found" };
    const drawn = await readDrawnSlide(ctx, materialId, parsed.n, parsed.sha);
    return drawn ? { status: 200, bytes: drawn, type: "image/webp", maxAge: "immutable" } : { status: 404, error: "Not found" };
  }
  const idx = await indexOf(ctx, opened.material, settingsOf(policy));
  if (!idx.ok) return { status: idx.out.status, error: String(idx.out.body.error ?? "") };
  // "p{n}" on a PDF page that holds a picture: the whole page, so a picture taken out of it can be seen in its place.
  const wholePage = /^p(\d+)$/.exec(key);
  const visual = idx.index.visuals.find(v => v.key === key)
    ?? (wholePage && idx.index.unit === "page" ? idx.index.visuals.find(v => v.n === Number(wholePage[1])) : undefined);
  if (!visual) return { status: 404, error: "Not found" };

  const bytes = await materialBytes(ctx.admin, ctx.userId, materialId);
  if (!bytes) return { status: 503, error: "Your original file could not be read just now. Try again shortly." };

  if (visual.kind === "pdf_page" || wholePage) {
    const pdf = await pdfPagesPdf(bytes, [visual.n]);
    if (!pdf) return { status: 404, error: "That page could not be shown." };
    return { status: 200, bytes: new Uint8Array(Buffer.from(pdf.base64, "base64")), type: "application/pdf", maxAge: "short" };
  }

  if (visual.unit === "page") {
    // A picture inside the PDF: its original form (a JPEG as it is, a Flate image as a lossless PNG), else its page.
    const num = Number(/^x(\d+)$/.exec(visual.media ?? "")?.[1]);
    const img = Number.isInteger(num) ? await pdfImageFile(bytes, num, visual.sha) : null;
    if (img === null) return { status: 404, error: "Not found" };
    if (img === "page") {
      const one = await pdfPagesPdf(bytes, [visual.n]);
      return one ? { status: 200, bytes: new Uint8Array(Buffer.from(one.base64, "base64")), type: "application/pdf", maxAge: "short" } : { status: 404, error: "That page could not be shown." };
    }
    return { status: 200, bytes: img.bytes, type: img.type, maxAge: "immutable" };
  }
  const z = await openOfficeZip(bytes);
  if (!z.ok || !visual.media) return { status: 422, error: "The pictures in your file could not be read." };
  const data = await z.zip.file(visual.media)?.async("uint8array");
  // The key names the picture by its digest: a part that no longer matches is never served under it.
  if (!data || sha16(data) !== visual.sha) return { status: 404, error: "Not found" };
  const kind = imageKind(data);
  if (!kind) return { status: 415, error: "This picture is in a format a browser cannot show. Open the original presentation to see it." };
  if ((BROWSER_KINDS as readonly string[]).includes(kind)) return { status: 200, bytes: data, type: CONTENT_TYPE[kind], maxAge: "immutable" };
  // TIFF and BMP: lossless PNG, first frame, no resize, no rotation, no crop -- the same pixels.
  if (data.byteLength > MAX_CONVERT_INPUT_BYTES) return { status: 413, error: "This picture is too large to show here. Open the original presentation to see it." };
  try {
    const sharp = (await import("sharp")).default;
    const png = await sharp(data, { page: 0, pages: 1, limitInputPixels: 100_000_000 }).png().toBuffer();
    return { status: 200, bytes: new Uint8Array(png), type: "image/png", maxAge: "immutable" };
  } catch {
    return { status: 415, error: "This picture could not be shown here. Open the original presentation to see it." };
  }
}

export const VISUAL_HEADERS = (maxAge: VisualFile["maxAge"], type: string): Record<string, string> => ({
  "Content-Type": type,
  "Cache-Control": maxAge === "short" ? "private, max-age=3600" : "private, max-age=31536000, immutable",
  "X-Content-Type-Options": "nosniff",
  "Content-Disposition": "inline",
});
