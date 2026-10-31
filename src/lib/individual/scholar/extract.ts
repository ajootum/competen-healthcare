import type JSZip from "jszip";
import type { ImageKind } from "./slide-images";
import { CHUNK_MAX, CHUNK_TARGET, DOCX_MIME, MAX_MATERIAL_CHARS, MAX_PDF_PAGES, MAX_PPTX_SLIDES, PDF_MIME, PPTX_MIME, TEXT_MIME, type MaterialMime } from "./config";

// ── UPLOAD → TEXT → PAGE-REFERENCED CHUNKS ── COMPETEN-IND-004 s1, COMPETEN-IND-002 s3.2(2) ──────────────
//
// Two extractors and one chunker. The DOCX path is the staff CPU importer's mammoth reader
// (src/lib/import/docx-text.ts), reused as it is. The PDF path is unpdf, the serverless build of Mozilla's
// pdf.js, read page by page so every chunk can cite the page it came from.
//
// ⚠ A CHUNK NEVER SPANS TWO PDF PAGES. A citation that says "page 4" must mean the passage is on page 4.
// A DOCX has no reliable page numbers (pagination is the renderer's, not the file's), so its chunks are
// cited by section number and carry no page at all -- never a guessed one.
//
// ⚠ NOTHING HERE IS SENT ANYWHERE. Extraction runs on this server. AI processing is a separate step that
// needs the person's consent (individual_scholar_consent).

export type ExtractedPage = { page: number | null; text: string };
export type Chunk = { ordinal: number; pageFrom: number | null; pageTo: number | null; content: string };

export type Extraction =
  | { ok: true; pages: ExtractedPage[]; pageCount: number | null; extractor: string }
  | { ok: false; reason: "unreadable" | "too_many_pages" | "no_text" | "too_long" | "unsafe"; detail?: string };

/** Whitespace tidied, paragraph breaks kept. Hyphenation across a PDF line break is joined. */
export function normaliseText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/(\w)-\n(\w)/g, "$1$2")
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLong(paragraph: string): string[] {
  if (paragraph.length <= CHUNK_MAX) return [paragraph];
  const sentences = paragraph.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [paragraph];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (s.length > CHUNK_MAX) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      for (let i = 0; i < s.length; i += CHUNK_TARGET) out.push(s.slice(i, i + CHUNK_TARGET).trim());
      continue;
    }
    if ((cur + s).length > CHUNK_TARGET && cur.trim()) { out.push(cur.trim()); cur = ""; }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

/** Pure. Pages in order → chunks in order, ordinals from 1, each inside one page. */
export function chunkPages(pages: ExtractedPage[]): Chunk[] {
  const chunks: Chunk[] = [];
  for (const p of pages) {
    const text = normaliseText(p.text);
    if (!text) continue;
    const paragraphs = text.split(/\n{1,}/).map(s => s.trim()).filter(Boolean).flatMap(splitLong);
    let cur = "";
    const flush = () => {
      if (!cur.trim()) return;
      chunks.push({ ordinal: chunks.length + 1, pageFrom: p.page, pageTo: p.page, content: cur.trim() });
      cur = "";
    };
    for (const para of paragraphs) {
      if (cur && (cur.length + 1 + para.length) > CHUNK_TARGET) flush();
      cur = cur ? `${cur}\n${para}` : para;
    }
    flush();
  }
  return chunks;
}

/** "page 4", "pages 4-5", "slide 4" or "section 3" -- the citation a person reads. A PowerPoint's unit is the slide. */
export function citeChunk(c: { ordinal: number; pageFrom: number | null; pageTo: number | null }, unit: "page" | "slide" | "section" = "page"): string {
  if (c.pageFrom === null) return `section ${c.ordinal}`;
  const word = unit === "slide" ? "slide" : "page";
  return c.pageTo !== null && c.pageTo !== c.pageFrom ? `${word}s ${c.pageFrom}-${c.pageTo}` : `${word} ${c.pageFrom}`;
}

// ── UPLOAD-01 U2: PROCESSING QUALITY ── never present an incomplete extraction as a clean success ─────────
//
// A PDF whose some pages are scanned images, or a PowerPoint with picture-only slides, extracts text from the
// rest and is kept -- but the material says which pages or slides held no readable text, so a student is not
// told it was read in full. A Word or text file has no fixed units: one unit, which either held text or the
// whole upload was refused.

export type ExtractionQuality = {
  unit: "page" | "slide" | "section";
  /** Pages or slides in the file (1 for a Word or text file). */
  units: number;
  /** The pages or slides that held no readable text, in order. Empty when every one did. */
  emptyUnits: number[];
  chars: number;
  sections: number;
  /**
   * SCHOLAR-UPLOAD-FIX: slides that held no text and were later read by AI from their pictures, on the learner's
   * request (no longer in emptyUnits), and every slide an AI reading was attempted for (read or not), so none is
   * offered twice. Absent on a material never read this way. Stored as ai_read_units / ai_tried_units.
   */
  aiReadUnits?: number[];
  aiTriedUnits?: number[];
};

/** Pure. The quality record stored with a material (migration 406), from what extraction and chunking produced. */
export function extractionQuality(mime: MaterialMime, pages: readonly ExtractedPage[], chunks: readonly Chunk[]): ExtractionQuality {
  const unit = mime === PDF_MIME ? "page" : mime === PPTX_MIME ? "slide" : "section";
  const emptyUnits = unit === "section" ? [] : pages.filter(p => !normaliseText(p.text)).map(p => p.page ?? 0).filter(n => n > 0);
  return { unit, units: unit === "section" ? 1 : pages.length, emptyUnits, chars: chunks.reduce((n, c) => n + c.content.length, 0), sections: chunks.length };
}

/** Pure. "Partial" when some pages or slides held no readable text. The sentence the material shows. */
export function qualitySummary(q: ExtractionQuality | null): { partial: boolean; text: string } {
  if (!q) return { partial: false, text: "How completely this file was read was not recorded: it was uploaded before Scholar measured it." };
  const listOf = (u: readonly number[]) => u.length > 8 ? `${u.slice(0, 8).join(", ")} and ${u.length - 8} more` : u.join(", ");
  // SCHOLAR-UPLOAD-FIX: slides read by AI from their pictures are said, every time, never folded into "read".
  const ai = q.aiReadUnits?.length ? ` ${q.aiReadUnits.length === 1 ? "Slide" : "Slides"} ${listOf(q.aiReadUnits)} ${q.aiReadUnits.length === 1 ? "was" : "were"} read by AI from a picture: check ${q.aiReadUnits.length === 1 ? "it" : "them"} against the slide${q.aiReadUnits.length === 1 ? "" : "s"}.` : "";
  if (!q.emptyUnits.length) return { partial: false, text: (q.unit === "section" ? `Read in full: ${q.sections} section${q.sections === 1 ? "" : "s"}.` : `Every ${q.unit} was read: ${q.units} ${q.unit}${q.units === 1 ? "" : "s"}, ${q.sections} section${q.sections === 1 ? "" : "s"}.`) + ai };
  const list = listOf(q.emptyUnits);
  return { partial: true, text: `Partly read: ${q.emptyUnits.length} of ${q.units} ${q.unit}s held no readable text (${q.unit}${q.emptyUnits.length === 1 ? "" : "s"} ${list}). A scanned page or a picture-only slide cannot be read yet, so Scholar cannot teach from ${q.emptyUnits.length === 1 ? "it" : "them"}.${ai}` };
}

/** Pure. SCHOLAR-UPLOAD-FIX: the slides whose sections were read by AI from a picture -- labelled on every section. */
export function aiReadSlides(q: ExtractionQuality | null): Set<number> {
  // A section on a slide still recorded as empty can only have come from an AI reading (one whose record update
  // failed): it is labelled too, never shown as text the file itself held.
  return new Set(q && q.unit === "slide" ? [...(q.aiReadUnits ?? []), ...q.emptyUnits] : []);
}

// ── UPLOAD-01 U1: OFFICE FILES ARE ZIP ARCHIVES -- SCREENED BEFORE ANYTHING IS DECOMPRESSED ────────────────
//
// A .docx and a .pptx are both ZIP files, so the magic bytes cannot tell them apart and a crafted one can
// expand to gigabytes. Before any part is read, the archive's own directory is checked: how many entries,
// how large they claim to be once expanded, and the compression ratio. A macro-enabled file (a VBA project
// part) is refused outright. Then the parts present decide the kind: word/document.xml or
// ppt/presentation.xml.

export const ZIP_LIMITS = { entries: 2000, uncompressedBytes: 120 * 1024 * 1024, ratio: 150 } as const;

type ZipEntryInfo = { name: string; compressed: number; uncompressed: number };

/** Pure. The screening verdict for an Office archive's directory. Null when it is safe to open. */
export function screenZipEntries(entries: readonly ZipEntryInfo[]): string | null {
  if (entries.length > ZIP_LIMITS.entries) return "too_many_entries";
  const total = entries.reduce((n, e) => n + e.uncompressed, 0);
  if (total > ZIP_LIMITS.uncompressedBytes) return "expands_too_far";
  const packed = entries.reduce((n, e) => n + e.compressed, 0);
  if (packed > 0 && total / packed > ZIP_LIMITS.ratio) return "compression_ratio";
  if (entries.some(e => /(^|\/)vbaProject\.bin$/i.test(e.name) || /\.(bin)$/i.test(e.name) && /activeX/i.test(e.name))) return "macros";
  return null;
}

export async function openOfficeZip(buffer: Uint8Array): Promise<{ ok: true; zip: JSZip } | { ok: false; reason: "unreadable" | "unsafe"; detail: string }> {
  let zip: JSZip;
  // Loaded on demand, like unpdf and mammoth: this file is also imported (for citeChunk) by browser code.
  const { default: Zip } = await import("jszip");
  try { zip = await Zip.loadAsync(buffer.slice()); } catch (e) { return { ok: false, reason: "unreadable", detail: e instanceof Error ? e.message : String(e) }; }
  // jszip reads only the central directory here; each entry's sizes come from it, before any inflation.
  // `_data` is jszip's record of the entry as read from the archive (not yet inflated): its two sizes.
  type Sized = { _data?: { compressedSize?: number; uncompressedSize?: number } };
  const entries: ZipEntryInfo[] = Object.values(zip.files).filter(f => !f.dir).map(f => ({
    name: f.name, compressed: Number((f as Sized)._data?.compressedSize ?? 0), uncompressed: Number((f as Sized)._data?.uncompressedSize ?? 0),
  }));
  const verdict = screenZipEntries(entries);
  if (verdict) return { ok: false, reason: "unsafe", detail: verdict };
  return { ok: true, zip };
}

/**
 * The Office kind of a ZIP upload, from the parts it holds: a Word document or a PowerPoint presentation.
 * Null for any other ZIP or an unreadable one. `unsafe` carries the screening verdict, so the person is told the
 * file was not opened and why -- not that it is the wrong kind.
 */
export async function officeKind(buffer: Uint8Array): Promise<typeof DOCX_MIME | typeof PPTX_MIME | { unsafe: string } | null> {
  const z = await openOfficeZip(buffer);
  if (!z.ok) return z.reason === "unsafe" ? { unsafe: z.detail } : null;
  if (z.zip.file("word/document.xml")) return DOCX_MIME;
  if (z.zip.file("ppt/presentation.xml")) return PPTX_MIME;
  return null;
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const xmlText = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => XML_ENTITIES[e]).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));

/** Pure. The text of one DrawingML part: each paragraph (a:p) on its own line, its runs (a:t) joined. */
export function drawingText(xml: string): string {
  const paras = xml.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? [];
  return paras.map(p => (p.match(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g) ?? []).map(t => xmlText(t.replace(/<\/?a:t[^>]*>/g, ""))).join(""))
    .map(l => l.trim()).filter(Boolean).join("\n");
}

/**
 * Pure. The slide parts of a presentation in the order Scholar numbers them: slide N is the Nth of these. The one
 * numbering the extractor and the picture-slide reader (slide-reading.ts) share, so "slide 33" means the same part.
 */
export function slidePartNames(names: readonly string[]): string[] {
  const slideNo = (name: string) => Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
  return names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => slideNo(a) - slideNo(b));
}

async function extractPptx(buffer: Uint8Array, maxSlides: number): Promise<Extraction> {
  const z = await openOfficeZip(buffer);
  if (!z.ok) return { ok: false, reason: z.reason, detail: z.detail };
  const { zip } = z;
  try {
    const slides = slidePartNames(Object.keys(zip.files));
    if (!slides.length) return { ok: false, reason: "no_text" };
    if (slides.length > maxSlides) return { ok: false, reason: "too_many_pages", detail: String(slides.length) };
    const pages: ExtractedPage[] = [];
    for (const [i, name] of slides.entries()) {
      const body = drawingText(await zip.file(name)!.async("string"));
      // The speaker notes are the lecturer's own words for the slide: read with it, after a marker.
      const rels = zip.file(name.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels");
      const target = rels ? (await rels.async("string")).match(/Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/)?.[1] : undefined;
      const notesXml = target ? await zip.file(`ppt/notesSlides/${target}`)?.async("string") : undefined;
      // A notes part repeats the slide number and the slide image placeholder; only its body text is kept.
      const notes = notesXml ? drawingText(notesXml).split("\n").filter(l => !/^\d+$/.test(l.trim())).join("\n") : "";
      pages.push({ page: i + 1, text: notes ? `${body}\n\nSpeaker notes:\n${notes}` : body });
    }
    return { ok: true, pages, pageCount: slides.length, extractor: "pptx-drawingml@1" };
  } catch (e) {
    return { ok: false, reason: "unreadable", detail: e instanceof Error ? e.message : String(e) };
  }
}

export type SlideImages = { slide: number; images: { bytes: Uint8Array; kind: ImageKind }[]; unsupported: string[]; tooLarge: boolean };

/**
 * SCHOLAR-UPLOAD-FIX: the PNG, JPEG, TIFF, BMP, GIF and WebP pictures of the named slides (numbered as extractPptx
 * numbers them), from the stored file. The archive is screened first, exactly as at upload. A picture whose bytes are
 * not really one of those is reported unsupported. PNG / JPEG count toward SLIDE_IMAGE_LIMITS.bytesPerSlide and are left
 * out beyond it; a picture to be converted (TIFF, BMP, GIF, WebP) is limited to MAX_CONVERT_INPUT_BYTES on its own and its
 * CONVERTED size is counted later (slide-reading.ts). Either way the slide says "too large".
 */
export async function pictureSlideImages(buffer: Uint8Array, slides: readonly number[]): Promise<{ ok: true; slides: SlideImages[] } | { ok: false; reason: "unreadable" | "unsafe"; detail: string }> {
  const z = await openOfficeZip(buffer);
  if (!z.ok) return z;
  const { zip } = z;
  const { slidePictures, imageKind, isConvertibleKind, SLIDE_IMAGE_LIMITS } = await import("./slide-images");
  const { MAX_CONVERT_INPUT_BYTES } = await import("./slide-convert");
  try {
    const parts = slidePartNames(Object.keys(zip.files));
    const out: SlideImages[] = [];
    for (const n of slides) {
      const name = parts[n - 1];
      if (!name) { out.push({ slide: n, images: [], unsupported: [], tooLarge: false }); continue; }
      const xml = await zip.file(name)!.async("string");
      const rels = await zip.file(name.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels")?.async("string");
      const pics = slidePictures(xml, rels ?? null);
      const images: SlideImages["images"] = [];
      const unsupported = [...pics.unsupported];
      let bytes = 0, tooLarge = false;
      for (const part of pics.images) {
        const data = await zip.file(part)?.async("uint8array");
        if (!data) continue;
        const kind = imageKind(data);
        if (!kind) { unsupported.push(part.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "unknown"); continue; }
        if (isConvertibleKind(kind)) {
          if (data.byteLength > MAX_CONVERT_INPUT_BYTES) { tooLarge = true; continue; }
        } else {
          if (bytes + data.byteLength > SLIDE_IMAGE_LIMITS.bytesPerSlide) { tooLarge = true; continue; }
          bytes += data.byteLength;
        }
        images.push({ bytes: data, kind });
      }
      out.push({ slide: n, images, unsupported: [...new Set(unsupported)], tooLarge });
    }
    return { ok: true, slides: out };
  } catch (e) {
    return { ok: false, reason: "unreadable", detail: e instanceof Error ? e.message : String(e) };
  }
}

// The patient-identifier screen moved to Holdings (src/lib/privacy/patient-identifiers.ts,
// COMPETEN-HOLDINGS-SHARED-ENGINES-01), verbatim. Re-exported here so every Scholar import is unchanged.
export { findPatientIdentifiers, isValidNhsNumber, PII_LABEL, type PiiKind } from "@/lib/privacy/patient-identifiers";

// ── THE EXTRACTORS ─────────────────────────────────────────────────────────────────────────────────

/**
 * UPLOAD-01 U1: a PDF that carries a script or a launch action is refused before it is read. Study notes need
 * neither. Pure, over the raw bytes: a /JavaScript, /JS or /Launch name in any UNCOMPRESSED dictionary (an
 * annotation, an open action). Names inside compressed object streams are not visible here -- the document's
 * own script table is asked as well (extractPdf), which pdf.js reads from either.
 * ⚠ STREAM DATA IS NOT SCANNED. An image stream is effectively random bytes, and 16 MB of it holds "/JS" by
 * chance about once: scanning it refused clean, image-heavy PDFs (found measuring the 25 MB limit). Only the
 * text between streams -- the dictionaries -- is scanned.
 */
export function screenPdfBytes(bytes: Uint8Array): string | null {
  const raw = new TextDecoder("latin1").decode(bytes).replace(/stream\r?\n[\s\S]*?endstream/g, "stream endstream");
  if (/\/(JavaScript|JS)(?![A-Za-z0-9])/.test(raw)) return "pdf_javascript";
  if (/\/Launch(?![A-Za-z0-9])/.test(raw)) return "pdf_launch";
  return null;
}

async function extractPdf(buffer: Uint8Array, maxPages: number = MAX_PDF_PAGES): Promise<Extraction> {
  const screened = screenPdfBytes(buffer);
  if (screened) return { ok: false, reason: "unsafe", detail: screened };
  const { getDocumentProxy, extractText } = await import("unpdf");
  let doc;
  try {
    // ⚠ A COPY, NEVER THE CALLER'S BYTES. pdf.js TRANSFERS the ArrayBuffer it is given, which detaches it:
    // afterwards the caller's array has byteLength 0. The upload route stores byte_size and sha256 from
    // those same bytes after extraction, so every PDF was refused by the size CHECK (found on staging).
    doc = await getDocumentProxy(buffer.slice());
  } catch (e) {
    return { ok: false, reason: "unreadable", detail: e instanceof Error ? e.message : String(e) };
  }
  try {
    if (doc.numPages > maxPages) return { ok: false, reason: "too_many_pages", detail: String(doc.numPages) };
    // The document's script table (named scripts, document actions), as pdf.js reads it -- compressed or not.
    const scripts = await doc.getJSActions().catch(() => null);
    if (scripts && Object.keys(scripts).length) return { ok: false, reason: "unsafe", detail: "pdf_javascript" };
    const { text, totalPages } = await extractText(doc, { mergePages: false });
    const pages = (text as string[]).map((t, i) => ({ page: i + 1, text: t ?? "" }));
    return { ok: true, pages, pageCount: totalPages, extractor: "unpdf@1.8.1" };
  } catch (e) {
    return { ok: false, reason: "unreadable", detail: e instanceof Error ? e.message : String(e) };
  } finally {
    await doc.cleanup().catch(() => {});
  }
}

async function extractDocx(buffer: Uint8Array): Promise<Extraction> {
  // UPLOAD-01 U1: the archive is screened before mammoth inflates any of it.
  const z = await openOfficeZip(buffer);
  if (!z.ok) return { ok: false, reason: z.reason, detail: z.detail };
  const { docxToMarkedText } = await import("@/lib/import/docx-text");
  try {
    const text = await docxToMarkedText(Buffer.from(buffer));
    return { ok: true, pages: [{ page: null, text }], pageCount: null, extractor: "mammoth" };
  } catch (e) {
    return { ok: false, reason: "unreadable", detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Stage 2: plain text, UTF-8. Like a Word file it has no pages, so its chunks are cited by section. Text that is
 * not valid UTF-8, or that holds a NUL byte (a binary file renamed .txt), is unreadable, not guessed at.
 */
export function extractText(buffer: Uint8Array): Extraction {
  if (buffer.includes(0)) return { ok: false, reason: "unreadable", detail: "binary" };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
    return { ok: true, pages: [{ page: null, text }], pageCount: null, extractor: "utf8-text" };
  } catch {
    return { ok: false, reason: "unreadable", detail: "not utf-8" };
  }
}

/**
 * File bytes → pages. Refuses (never truncates) a file with no text layer or with too much text. `maxPages` is
 * the Individual policy page limit (scholar_pdf_max_pages), never above MAX_PDF_PAGES.
 */
export async function extractMaterial(mime: MaterialMime, buffer: Uint8Array, maxPages: number = MAX_PDF_PAGES, maxSlides: number = MAX_PPTX_SLIDES): Promise<Extraction> {
  const r = mime === PDF_MIME ? await extractPdf(buffer, Math.min(maxPages, MAX_PDF_PAGES))
    : mime === DOCX_MIME ? await extractDocx(buffer)
    : mime === PPTX_MIME ? await extractPptx(buffer, Math.min(maxSlides, MAX_PPTX_SLIDES))
    : mime === TEXT_MIME ? extractText(buffer) : null;
  if (!r) return { ok: false, reason: "unreadable" };
  if (!r.ok) return r;
  const chars = r.pages.reduce((n, p) => n + normaliseText(p.text).length, 0);
  if (chars === 0) return { ok: false, reason: "no_text" };
  if (chars > MAX_MATERIAL_CHARS) return { ok: false, reason: "too_long", detail: String(chars) };
  return r;
}

/**
 * Magic bytes, not the browser's word for it: %PDF for a PDF, a ZIP header for an Office file, otherwise valid
 * UTF-8 with no NUL for text. A ZIP answers DOCX here; officeKind() then reads which Office file it really is
 * (UPLOAD-01: a .pptx is a ZIP too). Use sniffUpload() for the full answer.
 */
export function sniffMime(bytes: Uint8Array): MaterialMime | null {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return PDF_MIME;
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return DOCX_MIME;
  if (bytes.length && !bytes.includes(0)) {
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return TEXT_MIME; } catch { /* not text */ }
  }
  return null;
}

/** The real kind of an uploaded file: magic bytes, then for a ZIP the Office parts it holds -- or why it was not opened. */
export async function sniffUpload(bytes: Uint8Array): Promise<{ mime: MaterialMime | null; unsafe?: string }> {
  const first = sniffMime(bytes);
  if (first !== DOCX_MIME) return { mime: first };
  const kind = await officeKind(bytes);
  return kind && typeof kind === "object" ? { mime: null, unsafe: kind.unsafe } : { mime: kind };
}

export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return (base || "Untitled material").slice(0, 120);
}

export const EXTRACTION_MESSAGE: Record<Exclude<Extraction, { ok: true }>["reason"], string> = {
  unreadable: "That file could not be read. It may be damaged or password-protected.",
  too_many_pages: "That file has more pages or slides than one material can hold. Split it into smaller files and upload them separately.",
  unsafe: "That file was not read: it is built in a way Scholar does not accept (it holds macros or scripts, or expands far beyond its size). Save it again as an ordinary document, or print it to a new PDF, and upload it.",
  no_text: "No text could be found in that file. A scanned PDF has no text layer, and reading scanned pages (OCR) is not available yet.",
  too_long: "That file holds more text than one material can. Split it into smaller files and upload them separately.",
};
