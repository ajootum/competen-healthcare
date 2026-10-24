import { describe, expect, it } from "vitest";
import { DOCX_MIME, PDF_MIME, PPTX_MIME, TEXT_MIME, UNIT_OF, uploadRules } from "./config";
import { chunkPages, citeChunk, drawingText, extractMaterial, extractionQuality, officeKind, qualitySummary, screenPdfBytes, screenZipEntries, sniffUpload, ZIP_LIMITS } from "./extract";
import { cleanCollectionName, cleanTitle, cleanTopics, materialTopics, relatedMaterials } from "./library";
import { spreadAcrossMaterials } from "./retrieval";
import { competencyAbsence } from "./competency-view";
import { tinyDocx, tinyPdf, tinyPptx } from "./test-documents";
import { checkMappingReply, mappingSystem, mappingUserPrompt, MAPPING_PROMPT_VERSION, MAPPING_PROMPT_VERSION_OUTCOMES } from "@/lib/competency/mapping";

// COMPETEN-SCHOLAR-UPLOAD-01 (owner GO 2026-10-24): U1 secure upload and formats, U2 extraction quality,
// U3 outcome-level mapping and R1, U4 the library's retrieval, U5 organising. Pure pieces only: the routes and
// the database are covered by scripts/scholar-upload-harness.ts on staging.

describe("U1: PowerPoint, and telling the Office files apart", () => {
  it("reads a PowerPoint slide by slide, with its speaker notes, each section citing its slide", async () => {
    const bytes = await tinyPptx([
      { text: ["Community-acquired pneumonia", "Typical organisms include Streptococcus pneumoniae."], notes: ["Ask about recent travel and contacts."] },
      { text: ["Oxygen is prescribed to a target saturation range."] },
    ]);
    expect(await sniffUpload(bytes)).toEqual({ mime: PPTX_MIME });
    const r = await extractMaterial(PPTX_MIME, bytes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pageCount).toBe(2);
    expect(r.pages[0].text).toContain("Speaker notes:\nAsk about recent travel and contacts.");
    expect(r.pages[0].text).not.toMatch(/\n1$/); // the notes part's slide number is not text
    const chunks = chunkPages(r.pages);
    expect(chunks.map(c => c.pageFrom)).toEqual([1, 2]);
    expect(citeChunk(chunks[1], UNIT_OF(PPTX_MIME))).toBe("slide 2");
    expect(citeChunk(chunks[1])).toBe("page 2"); // the default stays the PDF wording
  });

  it("knows a Word file from a PowerPoint by its parts, not its ZIP header", async () => {
    expect(await sniffUpload(await tinyDocx(["Oxygen therapy notes."]))).toEqual({ mime: DOCX_MIME });
    expect(await officeKind(await tinyPptx([{ text: ["x"] }]))).toBe(PPTX_MIME);
    expect(await sniffUpload(tinyPdf(["p"]))).toEqual({ mime: PDF_MIME });
    expect(await sniffUpload(new TextEncoder().encode("plain notes"))).toEqual({ mime: TEXT_MIME });
  });

  it("⚠ refuses a macro-enabled Office file before reading it -- and the upload's first look already says why", async () => {
    const bytes = await tinyPptx([{ text: ["Slide"] }], { "ppt/vbaProject.bin": "macro" });
    expect(await sniffUpload(bytes)).toEqual({ mime: null, unsafe: "macros" });
    const r = await extractMaterial(PPTX_MIME, bytes);
    expect(r).toMatchObject({ ok: false, reason: "unsafe", detail: "macros" });
    const d = await extractMaterial(DOCX_MIME, await tinyDocx(["x"]).then(async b => {
      const { default: JSZip } = await import("jszip");
      const z = await JSZip.loadAsync(b); z.file("word/vbaProject.bin", "macro");
      return new Uint8Array(await z.generateAsync({ type: "uint8array" }));
    }));
    expect(d).toMatchObject({ ok: false, reason: "unsafe" });
  });

  it("⚠ screens an archive's directory: too many entries, too large expanded, too compressed", () => {
    const e = (n: number, c: number, u: number) => Array.from({ length: n }, (_, i) => ({ name: `p${i}.xml`, compressed: c, uncompressed: u }));
    expect(screenZipEntries(e(3, 100, 1000))).toBeNull();
    expect(screenZipEntries(e(ZIP_LIMITS.entries + 1, 1, 1))).toBe("too_many_entries");
    expect(screenZipEntries(e(2, 60 * 1024 * 1024, 61 * 1024 * 1024))).toBe("expands_too_far");
    expect(screenZipEntries(e(1, 1000, 1000 * (ZIP_LIMITS.ratio + 1)))).toBe("compression_ratio");
  });

  it("⚠ refuses a PDF that carries a script or a launch action, before reading it", async () => {
    const clean = tinyPdf(["Respiratory assessment"]);
    expect(screenPdfBytes(clean)).toBeNull();
    const withJs = new TextEncoder().encode(new TextDecoder("latin1").decode(clean).replace("/Type /Catalog", "/Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >>"));
    const withLaunch = new TextEncoder().encode(new TextDecoder("latin1").decode(clean).replace("/Type /Catalog", "/Type /Catalog /OpenAction << /S /Launch /F (calc.exe) >>"));
    expect(screenPdfBytes(withJs)).toBe("pdf_javascript");
    expect(screenPdfBytes(withLaunch)).toBe("pdf_launch");
    expect(await extractMaterial(PDF_MIME, withJs)).toMatchObject({ ok: false, reason: "unsafe", detail: "pdf_javascript" });
    // A name that merely starts the same way is not a script.
    expect(screenPdfBytes(new TextEncoder().encode("%PDF-1.4 /JSmith /Launcher"))).toBeNull();
    // Image data that happens to hold "/JS " is stream content, not a dictionary: never a false refusal.
    expect(screenPdfBytes(new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Length 9 >>\nstream\n\x89/JS (x)\x00\nendstream\nendobj"))).toBeNull();
    expect(screenPdfBytes(new TextEncoder().encode("%PDF-1.4\n1 0 obj << /S /JavaScript >>\nendobj\n2 0 obj << /Length 4 >>\nstream\nabcd\nendstream"))).toBe("pdf_javascript");
  });

  it("caps slides at the policy's limit, refusing (never truncating) a longer deck", async () => {
    const r = await extractMaterial(PPTX_MIME, await tinyPptx(Array.from({ length: 6 }, (_, i) => ({ text: [`Slide ${i + 1}`] }))), 300, 5);
    expect(r).toMatchObject({ ok: false, reason: "too_many_pages" });
  });

  it("offers PowerPoint only when the policy turns it on", () => {
    expect(uploadRules({ scholarUploadFormats: ["pdf", "docx"], scholarUploadMaxMb: 10 }).mimes).not.toContain(PPTX_MIME);
    const on = uploadRules({ scholarUploadFormats: ["pdf", "docx", "pptx"], scholarUploadMaxMb: 10 });
    expect(on.mimes).toContain(PPTX_MIME);
    expect(on.describe).toContain("PowerPoint (.pptx)");
  });

  it("reads DrawingML paragraphs and runs, entities decoded", () => {
    expect(drawingText('<a:p><a:r><a:t>SpO</a:t></a:r><a:r><a:t>2 &amp; FiO2</a:t></a:r></a:p><a:p><a:r><a:t xml:space="preserve"> Second </a:t></a:r></a:p>'))
      .toBe("SpO2 & FiO2\nSecond");
  });
});

describe("U2: how completely a file was read", () => {
  it("names the pages or slides with no readable text, and calls it partial -- never a clean success", () => {
    const pages = [{ page: 1, text: "Airway anatomy" }, { page: 2, text: "   " }, { page: 3, text: "Gas exchange" }];
    const q = extractionQuality(PDF_MIME, pages, chunkPages(pages));
    expect(q).toMatchObject({ unit: "page", units: 3, emptyUnits: [2], sections: 2 });
    const s = qualitySummary(q);
    expect(s.partial).toBe(true);
    expect(s.text).toMatch(/^Partly read: 1 of 3 pages held no readable text \(page 2\)/);
    const slides = extractionQuality(PPTX_MIME, [{ page: 1, text: "x" }, { page: 2, text: "" }], []);
    expect(qualitySummary(slides).text).toContain("slide 2");
  });

  it("says read in full only when every unit held text, and 'not recorded' when it was never measured", () => {
    const pages = [{ page: 1, text: "a" }, { page: 2, text: "b" }];
    expect(qualitySummary(extractionQuality(PDF_MIME, pages, chunkPages(pages)))).toEqual({ partial: false, text: "Every page was read: 2 pages, 2 sections." });
    expect(qualitySummary(extractionQuality(DOCX_MIME, [{ page: null, text: "a" }], chunkPages([{ page: null, text: "a" }]))).text).toBe("Read in full: 1 section.");
    expect(qualitySummary(null)).toEqual({ partial: false, text: expect.stringMatching(/not recorded/) });
  });
});

describe("U3: outcome-level mapping (opt-in on the Holdings engine) and R1", () => {
  const SUBJECT = [{ ref: "k1", text: "Oxygen is prescribed with a target saturation range and titrated to it." }];
  const COMP = [{ competencyId: "c-oxy", layer: "profession" as const, code: null, title: "Oxygen therapy", outcomes: ["Prescribe oxygen to a target range", "Monitor saturation"] }];

  it("keeps the v2 prompt and version byte for byte for a caller that has not opted in", () => {
    expect(mappingUserPrompt(SUBJECT, COMP)).toContain("Oxygen therapy -- Prescribe oxygen to a target range; Monitor saturation");
    expect(mappingSystem({ person: "a student", subjects: "notes" })).not.toContain("outcome");
    expect(MAPPING_PROMPT_VERSION).toBe("competency-map-v2");
    expect(MAPPING_PROMPT_VERSION_OUTCOMES).toBe("competency-map-v3-outcomes");
  });

  it("numbers the outcomes under each competency when asked, and never shows an id", () => {
    const p = mappingUserPrompt(SUBJECT, COMP, { outcomes: true });
    expect(p).toContain("[C1.1] Prescribe oxygen to a target range");
    expect(p).toContain("[C1.2] Monitor saturation");
    expect(p).not.toContain("c-oxy");
  });

  it("returns the outcome's own text for a tag of THAT competency, and drops any other outcome tag", () => {
    const ok = checkMappingReply(JSON.stringify([{ section: "S1", concepts: [], competencies: [{ tag: "C1", confidence: 0.9, outcome: "C1.1" }] }]), SUBJECT, COMP);
    expect(ok.subjects[0].proposals[0]).toMatchObject({ competencyId: "c-oxy", outcome: "Prescribe oxygen to a target range" });
    const bad = checkMappingReply(JSON.stringify([{ section: "S1", concepts: [], competencies: [{ tag: "C1", confidence: 0.9, outcome: "C2.1" }, ] }]), SUBJECT, COMP);
    expect(bad.subjects[0].proposals[0].outcome).toBeUndefined();
    expect(bad.dropped.map(d => d.reason)).toEqual(["unknown_outcome"]);
    const none = checkMappingReply(JSON.stringify([{ section: "S1", concepts: [], competencies: [{ tag: "C1", confidence: 0.9 }] }]), SUBJECT, COMP);
    expect(none.subjects[0].proposals[0]).toEqual({ competencyId: "c-oxy", layer: "profession", confidence: 0.9, rationale: null });
  });

  it("R1: a programme with no usable catalogue is said, as is no programme -- and neither blocks study", () => {
    const programme = { code: "zz", label: "ZZ Nursing", profession: "Nursing", country: null, level: null, frameworks: [] };
    expect(competencyAbsence({ provisioned: true, programme, competencies: [], belowFloor: 0 })).toMatch(/^ZZ Nursing has no competency catalogue Scholar can use yet.*You can still study them/);
    expect(competencyAbsence({ provisioned: true, programme: null, competencies: [], belowFloor: 0 })).toMatch(/No programme is chosen.*You can study them either way/);
    // Held back by the content floor is a different, already-labelled state; unreadable is said by the page.
    expect(competencyAbsence({ provisioned: true, programme, competencies: [], belowFloor: 3 })).toBeNull();
    expect(competencyAbsence({ provisioned: true, programme, competencies: null, belowFloor: 0 })).toBeNull();
    expect(competencyAbsence({ provisioned: false, programme: null, competencies: [], belowFloor: 0 })).toBeNull();
  });
});

describe("U4: the library's retrieval and topics", () => {
  it("spreads the best passages over the materials that matched, best of each first", () => {
    const r = [{ id: "a1", materialId: "A" }, { id: "a2", materialId: "A" }, { id: "a3", materialId: "A" }, { id: "b1", materialId: "B" }, { id: "c1", materialId: "C" }];
    expect(spreadAcrossMaterials(r, 4).map(x => x.id)).toEqual(["a1", "b1", "c1", "a2"]);
    expect(spreadAcrossMaterials(r, 10).map(x => x.id)).toEqual(["a1", "b1", "c1", "a2", "a3"]);
    expect(spreadAcrossMaterials([], 5)).toEqual([]);
  });

  it("summarises a material's topics by how many sections name them, case and punctuation aside", () => {
    expect(materialTopics([["Oxygen therapy", "Hypoxaemia"], ["oxygen therapy."], ["Hypoxaemia", "Target saturation"]]))
      .toEqual([{ topic: "Hypoxaemia", sections: 2 }, { topic: "Oxygen therapy", sections: 2 }, { topic: "Target saturation", sections: 1 }]);
  });

  it("relates materials only by a topic they share, and says which", () => {
    const rel = relatedMaterials({ materialId: "pn", topics: ["Hypoxaemia", "Pneumonia", "Oxygen therapy"] }, [
      { materialId: "oxy", title: "Oxygen therapy notes", topics: ["oxygen therapy", "hypoxaemia", "Venturi mask"] },
      { materialId: "anat", title: "Respiratory anatomy", topics: ["Alveoli", "Pneumonia"] },
      { materialId: "x", title: "Wound care", topics: ["Dressings"] },
      { materialId: "pn", title: "Self", topics: ["Pneumonia"] },
    ]);
    expect(rel).toEqual([
      { materialId: "oxy", title: "Oxygen therapy notes", shared: ["Hypoxaemia", "Oxygen therapy"] },
      { materialId: "anat", title: "Respiratory anatomy", shared: ["Pneumonia"] },
    ]);
  });
});

describe("U5: organising checks", () => {
  it("topics: trimmed, deduplicated, bounded", () => {
    expect(cleanTopics([" Oxygen  therapy ", "oxygen therapy", "", "Hypoxaemia"])).toEqual({ ok: true, value: ["Oxygen therapy", "Hypoxaemia"] });
    expect(cleanTopics(["x"])).toMatchObject({ ok: false });
    expect(cleanTopics(Array.from({ length: 13 }, (_, i) => `Topic ${i}`))).toMatchObject({ ok: false });
    expect(cleanTopics("not a list")).toMatchObject({ ok: false });
    expect(cleanTopics([])).toEqual({ ok: true, value: [] });
  });

  it("a name and a collection name must be real and bounded", () => {
    expect(cleanTitle("  Pneumonia   lecture ")).toEqual({ ok: true, value: "Pneumonia lecture" });
    expect(cleanTitle("   ")).toMatchObject({ ok: false });
    expect(cleanTitle("x".repeat(121))).toMatchObject({ ok: false });
    expect(cleanCollectionName("Respiratory module")).toEqual({ ok: true, value: "Respiratory module" });
    expect(cleanCollectionName("x".repeat(81))).toMatchObject({ ok: false });
  });
});
