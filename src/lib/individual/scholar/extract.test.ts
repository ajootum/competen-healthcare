import { describe, expect, it } from "vitest";
import { uploadRules } from "./config";
import {
  chunkPages, citeChunk, extractMaterial, findPatientIdentifiers, isValidNhsNumber, normaliseText, sniffMime, titleFromFileName,
} from "./extract";
import { CHUNK_MAX, PDF_MIME, DOCX_MIME } from "./config";
import { tinyPdf } from "./test-documents";

// COMPETEN-IND-004 s1. Extraction, page-referenced chunking and the patient-identifier check.

describe("PDF extraction", () => {
  it("reads text page by page, so every chunk can cite its page", async () => {
    const r = await extractMaterial(PDF_MIME, tinyPdf(["Heart failure reduces cardiac output", "Sepsis six within one hour"]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pageCount).toBe(2);
    const chunks = chunkPages(r.pages);
    expect(chunks.map(c => [c.pageFrom, c.content])).toEqual([[1, "Heart failure reduces cardiac output"], [2, "Sepsis six within one hour"]]);
  });

  it("⚠ leaves the caller's bytes intact (pdf.js would otherwise detach them, and the size and hash read zero)", async () => {
    const bytes = tinyPdf(["Renal physiology"]);
    const before = bytes.byteLength;
    await extractMaterial(PDF_MIME, bytes);
    expect(bytes.byteLength).toBe(before);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
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
    // Stage 2: anything else that is valid UTF-8 with no NUL byte is plain text -- a binary file renamed .txt is not.
    expect(sniffMime(new TextEncoder().encode("<html>"))).toBe("text/plain");
    expect(sniffMime(new Uint8Array([0x68, 0x00, 0x69]))).toBeNull();
    expect(sniffMime(new Uint8Array([0xff, 0xfe, 0xfd]))).toBeNull();
  });

  it("titles a material from its file name", () => {
    expect(titleFromFileName("Cardiology_week_3.pdf")).toBe("Cardiology week 3");
    expect(titleFromFileName(".pdf")).toBe("Untitled material");
  });
});

describe("Stage 2: plain text and the upload rules", () => {
  it("reads plain text as one section-cited page, and refuses binary or non-UTF-8 bytes", async () => {
    const r = await extractMaterial("text/plain", new TextEncoder().encode("﻿Respiratory rate is counted for a full minute.\n\nWheeze suggests narrowed airways."));
    expect(r).toMatchObject({ ok: true, pageCount: null, extractor: "utf8-text" });
    expect(r.ok && r.pages[0].page).toBeNull();
    expect(r.ok && r.pages[0].text.startsWith("Respiratory")).toBe(true);
    expect(await extractMaterial("text/plain", new Uint8Array([0x41, 0x00, 0x42]))).toMatchObject({ ok: false, reason: "unreadable" });
    expect(await extractMaterial("text/plain", new Uint8Array([0xc3, 0x28]))).toMatchObject({ ok: false, reason: "unreadable" });
    expect(await extractMaterial("text/plain", new TextEncoder().encode("   \n  "))).toMatchObject({ ok: false, reason: "no_text" });
    const chunks = r.ok ? chunkPages(r.pages) : [];
    expect(chunks[0]).toMatchObject({ pageFrom: null, pageTo: null });
  });

  it("the policy decides the formats and the size, never above what the database allows", () => {
    const off = uploadRules({ scholarUploadFormats: ["pdf", "docx"], scholarUploadMaxMb: 10 });
    expect(off).toMatchObject({ text: false, maxMb: 10, describe: "PDF or Word (.docx)" });
    expect(off.mimes).not.toContain("text/plain");
    const on = uploadRules({ scholarUploadFormats: ["pdf", "docx", "text"], scholarUploadMaxMb: 4 });
    expect(on).toMatchObject({ text: true, maxMb: 4, maxBytes: 4 * 1024 * 1024 });
    expect(on.describe).toBe("PDF, Word (.docx) or Plain text (.txt or pasted)");
    // The ceiling is the database's (25 MB since migration 413, owner GO 2026-10-24): a policy above it is clamped.
    expect(uploadRules({ scholarUploadFormats: ["pdf"], scholarUploadMaxMb: 999 }).maxBytes).toBe(25 * 1024 * 1024);
  });
});
