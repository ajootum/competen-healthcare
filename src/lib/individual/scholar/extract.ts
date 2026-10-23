import { CHUNK_MAX, CHUNK_TARGET, DOCX_MIME, MAX_MATERIAL_CHARS, MAX_PDF_PAGES, PDF_MIME, type MaterialMime } from "./config";

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

// ── PATIENT-IDENTIFIABLE DATA CHECK ── COMPETEN-IND-002 s3.3: "Uploads must not hold patient-identifiable
// data, so this needs a notice and a check." The notice is PII_WARNING plus a required attestation. This is
// the check. It looks for identifiers that have a recognisable SHAPE, and it is not exhaustive: a name next
// to a diagnosis has no shape a pattern can find, which is why the attestation is required as well.
// It reports the KIND of identifier found, never the value.

export type PiiKind = "nhs_number" | "date_of_birth" | "hospital_number";

/**
 * The NHS number modulus-11 check (NHS Data Dictionary). Ten digits, the last is the check digit. A
 * leading 0 is refused: UK telephone numbers start with 0 and about one in eleven would pass the check,
 * while NHS numbers in issue do not start with 0.
 */
export function isValidNhsNumber(digits: string): boolean {
  if (!/^[1-9]\d{9}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i);
  const check = 11 - (sum % 11);
  if (check === 10) return false;
  return (check === 11 ? 0 : check) === Number(digits[9]);
}

export function findPatientIdentifiers(text: string): PiiKind[] {
  const found = new Set<PiiKind>();
  for (const m of text.matchAll(/(?<!\d)(\d{3})[ -]?(\d{3})[ -]?(\d{4})(?!\d)/g)) {
    if (isValidNhsNumber(m[1] + m[2] + m[3])) { found.add("nhs_number"); break; }
  }
  if (/\b(?:dob|d\.o\.b\.?|date of birth)\s*[:\-]?\s*\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/i.test(text)) found.add("date_of_birth");
  if (/\b(?:mrn|hospital\s+(?:no|number)|patient\s+(?:id|number)|unit\s+number)\s*[:#.]?\s*[A-Z]{0,3}\d{5,}\b/i.test(text)) found.add("hospital_number");
  return [...found];
}

export const PII_LABEL: Record<PiiKind, string> = {
  nhs_number: "an NHS number",
  date_of_birth: "a labelled date of birth",
  hospital_number: "a hospital or patient number",
};

// ── THE EXTRACTORS ─────────────────────────────────────────────────────────────────────────────────

async function extractPdf(buffer: Uint8Array): Promise<Extraction> {
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
    if (doc.numPages > MAX_PDF_PAGES) return { ok: false, reason: "too_many_pages", detail: String(doc.numPages) };
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

/** File bytes → pages. Refuses (never truncates) a file with no text layer or with too much text. */
export async function extractMaterial(mime: MaterialMime, buffer: Uint8Array): Promise<Extraction> {
  const r = mime === PDF_MIME ? await extractPdf(buffer) : mime === DOCX_MIME ? await extractDocx(buffer) : null;
  if (!r) return { ok: false, reason: "unreadable" };
  if (!r.ok) return r;
  const chars = r.pages.reduce((n, p) => n + normaliseText(p.text).length, 0);
  if (chars === 0) return { ok: false, reason: "no_text" };
  if (chars > MAX_MATERIAL_CHARS) return { ok: false, reason: "too_long", detail: String(chars) };
  return r;
}

/** Magic bytes, not the browser's word for it: %PDF for a PDF, a ZIP header for a DOCX. */
export function sniffMime(bytes: Uint8Array): MaterialMime | null {
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return PDF_MIME;
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return DOCX_MIME;
  return null;
}

export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return (base || "Untitled material").slice(0, 120);
}

export const EXTRACTION_MESSAGE: Record<Exclude<Extraction, { ok: true }>["reason"], string> = {
  unreadable: "That file could not be read. It may be damaged or password-protected.",
  too_many_pages: `That PDF has more than ${MAX_PDF_PAGES} pages. Split it into smaller files and upload them separately.`,
  no_text: "No text could be found in that file. A scanned PDF has no text layer, and reading scanned pages (OCR) is not available yet.",
  too_long: "That file holds more text than one material can. Split it into smaller files and upload them separately.",
};
