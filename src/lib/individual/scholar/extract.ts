import { CHUNK_MAX, CHUNK_TARGET, DOCX_MIME, MAX_MATERIAL_CHARS, MAX_PDF_PAGES, PDF_MIME, TEXT_MIME, type MaterialMime } from "./config";

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
  | { ok: false; reason: "unreadable" | "too_many_pages" | "no_text" | "too_long"; detail?: string };

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

/** "page 4", "pages 4-5" or "section 3" -- the citation a person reads. */
export function citeChunk(c: { ordinal: number; pageFrom: number | null; pageTo: number | null }): string {
  if (c.pageFrom === null) return `section ${c.ordinal}`;
  return c.pageTo !== null && c.pageTo !== c.pageFrom ? `pages ${c.pageFrom}-${c.pageTo}` : `page ${c.pageFrom}`;
}

// The patient-identifier screen moved to Holdings (src/lib/privacy/patient-identifiers.ts,
// COMPETEN-HOLDINGS-SHARED-ENGINES-01), verbatim. Re-exported here so every Scholar import is unchanged.
export { findPatientIdentifiers, isValidNhsNumber, PII_LABEL, type PiiKind } from "@/lib/privacy/patient-identifiers";

// ── THE EXTRACTORS ─────────────────────────────────────────────────────────────────────────────────

async function extractPdf(buffer: Uint8Array, maxPages: number = MAX_PDF_PAGES): Promise<Extraction> {
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
export async function extractMaterial(mime: MaterialMime, buffer: Uint8Array, maxPages: number = MAX_PDF_PAGES): Promise<Extraction> {
  const r = mime === PDF_MIME ? await extractPdf(buffer, Math.min(maxPages, MAX_PDF_PAGES)) : mime === DOCX_MIME ? await extractDocx(buffer) : mime === TEXT_MIME ? extractText(buffer) : null;
  if (!r) return { ok: false, reason: "unreadable" };
  if (!r.ok) return r;
  const chars = r.pages.reduce((n, p) => n + normaliseText(p.text).length, 0);
  if (chars === 0) return { ok: false, reason: "no_text" };
  if (chars > MAX_MATERIAL_CHARS) return { ok: false, reason: "too_long", detail: String(chars) };
  return r;
}

/** Magic bytes, not the browser's word for it: %PDF for a PDF, a ZIP header for a DOCX, otherwise valid UTF-8 with no NUL for text. */
export function sniffMime(bytes: Uint8Array): MaterialMime | null {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return PDF_MIME;
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return DOCX_MIME;
  if (bytes.length && !bytes.includes(0)) {
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return TEXT_MIME; } catch { /* not text */ }
  }
  return null;
}

export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return (base || "Untitled material").slice(0, 120);
}

export const EXTRACTION_MESSAGE: Record<Exclude<Extraction, { ok: true }>["reason"], string> = {
  unreadable: "That file could not be read. It may be damaged or password-protected.",
  too_many_pages: "That PDF has more pages than one material can hold. Split it into smaller files and upload them separately.",
  no_text: "No text could be found in that file. A scanned PDF has no text layer, and reading scanned pages (OCR) is not available yet.",
  too_long: "That file holds more text than one material can. Split it into smaller files and upload them separately.",
};
