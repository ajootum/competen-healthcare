import { describe, expect, it } from "vitest";
import {
  chunkPages, citeChunk, extractMaterial, findPatientIdentifiers, isValidNhsNumber, normaliseText, sniffMime, titleFromFileName,
} from "./extract";
import { CHUNK_MAX, PDF_MIME, DOCX_MIME } from "./config";

// COMPETEN-IND-004 s1. Extraction, page-referenced chunking and the patient-identifier check.

/** A minimal, valid PDF with one line of text per page -- built here so the test needs no fixture file. */
export function tinyPdf(pages: string[]): Uint8Array {
  const objs: string[] = [];
  const add = (s: string) => { objs.push(s); return objs.length; };
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pagesId = 2 + pages.length * 2;
  const pageIds: number[] = [];
  for (const t of pages) {
    const stream = `BT /F1 12 Tf 72 720 Td (${t}) Tj ET`;
    const c = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${c} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  add(`<< /Type /Pages /Kids [${pageIds.map(i => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const cat = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((s, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${s}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${x}\n%%EOF`;
  return new TextEncoder().encode(out);
}

describe("PDF extraction", () => {
  it("reads text page by page, so every chunk can cite its page", async () => {
    const r = await extractMaterial(PDF_MIME, tinyPdf(["Heart failure reduces cardiac output", "Sepsis six within one hour"]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pageCount).toBe(2);
    const chunks = chunkPages(r.pages);
    expect(chunks.map(c => [c.pageFrom, c.content])).toEqual([[1, "Heart failure reduces cardiac output"], [2, "Sepsis six within one hour"]]);
  });

  it("refuses a PDF with no text layer rather than storing an empty material", async () => {
    const r = await extractMaterial(PDF_MIME, tinyPdf([""]));
    expect(r).toEqual({ ok: false, reason: "no_text" });
  });

  it("refuses bytes that are not a PDF", async () => {
    const r = await extractMaterial(PDF_MIME, new TextEncoder().encode("%PDF-1.4 not really"));
    expect(r.ok).toBe(false);
  });
});

describe("chunking", () => {
  it("never lets a chunk span two pages, and numbers them in order from 1", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence ${i} about renal physiology and fluid balance.`).join(" ");
    const chunks = chunkPages([{ page: 1, text: long }, { page: 2, text: "Short page." }]);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every(c => c.pageFrom === c.pageTo)).toBe(true);
    expect(chunks.map(c => c.ordinal)).toEqual(chunks.map((_, i) => i + 1));
    expect(chunks.every(c => c.content.length <= CHUNK_MAX)).toBe(true);
    expect(chunks.at(-1)).toMatchObject({ pageFrom: 2, content: "Short page." });
  });

  it("gives a Word document's chunks no page at all, never a guessed one", () => {
    const chunks = chunkPages([{ page: null, text: "Heading\nParagraph one.\nParagraph two." }]);
    expect(chunks.every(c => c.pageFrom === null && c.pageTo === null)).toBe(true);
    expect(citeChunk(chunks[0])).toBe("section 1");
  });

  it("cites a page, and a page range only when a chunk has one", () => {
    expect(citeChunk({ ordinal: 3, pageFrom: 4, pageTo: 4 })).toBe("page 4");
    expect(citeChunk({ ordinal: 3, pageFrom: 4, pageTo: 5 })).toBe("pages 4-5");
  });

  it("joins words hyphenated across a line break and keeps paragraphs", () => {
    expect(normaliseText("cardio-\nvascular   system\n\n\n\nNext")).toBe("cardiovascular system\n\nNext");
  });

  it("splits an over-long sentence rather than dropping it", () => {
    const run = "x".repeat(CHUNK_MAX * 2);
    const chunks = chunkPages([{ page: 1, text: run }]);
    expect(chunks.map(c => c.content).join("")).toBe(run);
  });
});

describe("patient-identifier check", () => {
  it("recognises a valid NHS number by its modulus-11 check digit, spaced or not", () => {
    expect(isValidNhsNumber("9434765919")).toBe(true);
    expect(isValidNhsNumber("9434765918")).toBe(false);
    expect(findPatientIdentifiers("Patient NHS no 943 476 5919 admitted")).toContain("nhs_number");
    expect(findPatientIdentifiers("Call 0123456789 for the ward")).not.toContain("nhs_number");
  });

  it("finds a labelled date of birth and a hospital number, and reports kinds, not values", () => {
    expect(findPatientIdentifiers("DOB: 12/03/1961")).toEqual(["date_of_birth"]);
    expect(findPatientIdentifiers("MRN 00482913 on the drug chart")).toEqual(["hospital_number"]);
  });

  it("does not flag ordinary study notes", () => {
    expect(findPatientIdentifiers("Give 500 ml over 15 minutes. Reassess at 1 hour. Normal range 3.5-5.3 mmol/L.")).toEqual([]);
  });
});

describe("file type", () => {
  it("is read from the bytes, not the browser's label", () => {
    expect(sniffMime(new TextEncoder().encode("%PDF-1.7\n"))).toBe(PDF_MIME);
    expect(sniffMime(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toBe(DOCX_MIME);
    expect(sniffMime(new TextEncoder().encode("<html>"))).toBeNull();
  });

  it("titles a material from its file name", () => {
    expect(titleFromFileName("Cardiology_week_3.pdf")).toBe("Cardiology week 3");
    expect(titleFromFileName(".pdf")).toBe("Untitled material");
  });
});
