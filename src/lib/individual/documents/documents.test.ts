import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { DEFAULT_DOCUMENTS, DEFAULT_LABELS, checkDocumentsDraft, labelHonest, templatesFor, type DocType } from "../documents-config";
import { buildDocModel, emptyDraft, modelHash, modelLines, parseDraft, type DraftContent } from "./model";
import { renderDocx } from "./docx";
import { pdfSafe, pdfUndrawable, renderPdf } from "./pdf";
import { SAMPLE_PERSON, SAMPLE_RECORDS } from "./sample";

// COMPETEN-PROFESSIONAL-PROGRESS-01 PR7: one model, two exports with the same content; only chosen records; owner meaning.

const cv = DEFAULT_DOCUMENTS.types.find(t => t.code === "professional-cv")!;
const records = new Map(SAMPLE_RECORDS.map(r => [r.key, r]));
const draft = (over: Partial<DraftContent> = {}): DraftContent => ({
  ...emptyDraft(cv), summary: "A clinician focused on acute care.\n\nI teach new starters.",
  sections: emptyDraft(cv).sections.map(s => s.code === "employment" ? { ...s, records: [{ key: "sample:job" }] }
    : s.code === "registrations" ? { ...s, records: [{ key: "sample:reg", show: ["jurisdiction"] }] }
    : s.code === "learning_cpd" ? { ...s, visible: true, records: [{ key: "sample:course", hide: ["hours"] }, { key: "sample:cpd" }] } : s),
  ...over,
});
const model = (d = draft(), type: DocType = cv) => buildDocModel({ type, template: templatesFor(DEFAULT_DOCUMENTS, type)[0], title: "My CV", draft: d, records, person: SAMPLE_PERSON, today: "2026-10-26" });
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

async function docxText(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const parts = await Promise.all(Object.keys(zip.files).filter(f => /^word\/(document|footer\d*)\.xml$/.test(f)).map(f => zip.file(f)!.async("string")));
  return parts.map(x => x.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")).join("\n");
}
async function pdfText(buf: Buffer) {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: true });
  return text as unknown as string;
}

describe("PR7: the document model", () => {
  it("only chosen records appear; a chosen section never pulls in its other records", () => {
    const m = model();
    const keys = m.sections.flatMap(s => s.entries.map(e => e.key));
    expect(keys).toEqual(["sample:reg", "sample:job", "sample:course", "sample:cpd"]);
    expect(keys).not.toContain("sample:qual"); // education is on by default, but nothing was chosen in it
    expect(m.sections.map(s => s.code)).toEqual(["summary", "registrations", "employment", "learning_cpd"]);
  });

  it("facts follow the person's choices: a default-hidden fact only when shown, any fact can be hidden", () => {
    const m = model();
    const reg = m.sections.flatMap(s => s.entries).find(e => e.key === "sample:reg")!;
    const course = m.sections.flatMap(s => s.entries).find(e => e.key === "sample:course")!;
    expect(reg.facts).toEqual(["Jurisdiction: Sample jurisdiction"]);
    expect(course.facts).toEqual(["Outcome: Assessed knowledge"]);
  });

  it("status wording comes from the owner's meaning; lapsed states are always said", () => {
    const portfolio = DEFAULT_DOCUMENTS.types.find(t => t.code === "passport-export")!;
    const d: DraftContent = { ...emptyDraft(portfolio), sections: emptyDraft(portfolio).sections.map(s => s.code === "qualifications" ? { ...s, visible: true, records: [{ key: "sample:old" }] } : s) };
    const e = model(d, portfolio).sections.flatMap(s => s.entries)[0];
    expect(e.status).toBe(`${DEFAULT_LABELS.institution} · ${DEFAULT_LABELS.expired}`);
    // A CV does not offer lapsed records at all: it is reported missing, never shown.
    const d2 = { ...draft(), sections: draft().sections.map(s => s.code === "qualifications" ? { ...s, visible: true, records: [{ key: "sample:old" }] } : s) };
    expect(model(d2).missing).toEqual(["sample:old"]);
  });

  it("a record key that is not the person's is refused in a draft", () => {
    expect(parseDraft(draft(), cv, new Set(records.keys())).ok).toBe(true);
    expect(parseDraft({ ...draft(), sections: [{ code: "employment", visible: true, records: [{ key: "someone-else:1" }] }] }, cv, new Set(records.keys())).ok).toBe(false);
    expect(parseDraft({ sections: [{ code: "not-a-section", visible: true, records: [] }] }, cv, new Set()).ok).toBe(false);
  });

  it("the hash is of the content: same choices hash the same, a change hashes differently", () => {
    expect(modelHash(model())).toBe(modelHash(model()));
    expect(modelHash(model(draft({ summary: "Changed." })))).not.toBe(modelHash(model()));
  });
});

describe("PR7: DOCX and PDF carry the same selected information", () => {
  it("every line of the model appears in both files, and neither carries an unselected record", async () => {
    const m = model();
    const t = templatesFor(DEFAULT_DOCUMENTS, cv)[0];
    const [docx, pdf] = await Promise.all([renderDocx(m, t), renderPdf(m, t, new Date("2026-10-26T00:00:00Z"))]);
    expect(docx.subarray(0, 2).toString()).toBe("PK");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const [dt, pt] = [norm(await docxText(docx)), norm(await pdfText(pdf))];
    for (const line of modelLines(m)) {
      expect(dt).toContain(norm(line));
      expect(pt.replace(/\s/g, "")).toContain(pdfSafe(line).replace(/\s/g, ""));
    }
    for (const absent of ["Degree in a health profession", "Life support certificate", "Hours: 6"]) {
      expect(dt).not.toContain(absent);
      expect(pt).not.toContain(absent);
    }
  });

  it("every default template renders both formats", async () => {
    for (const type of DEFAULT_DOCUMENTS.types) for (const t of templatesFor(DEFAULT_DOCUMENTS, type)) {
      const m = buildDocModel({ type, template: t, title: type.label, draft: { ...emptyDraft(type), sections: emptyDraft(type).sections.map(s => ({ ...s, visible: true, records: SAMPLE_RECORDS.filter(r => r.sections.includes(s.code)).map(r => ({ key: r.key })) })) }, records, person: SAMPLE_PERSON, today: "2026-10-26" });
      const [d, p] = await Promise.all([renderDocx(m, t), renderPdf(m, t)]);
      expect(d.length).toBeGreaterThan(1000);
      expect(p.length).toBeGreaterThan(1000);
    }
  }, 30000);
});

describe("PR7 s10.3: governed templates", () => {
  it("defaults are valid, and a changed template gets the next version on publish", () => {
    const ok = checkDocumentsDraft(DEFAULT_DOCUMENTS, DEFAULT_DOCUMENTS);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.settings.templates.every(t => t.version === 1)).toBe(true);
    const changed = { ...DEFAULT_DOCUMENTS, templates: DEFAULT_DOCUMENTS.templates.map(t => t.code === "modern-minimal" ? { ...t, colours: { ...t.colours, accent: "#0E7490" } } : t) };
    const v = checkDocumentsDraft(changed, DEFAULT_DOCUMENTS);
    expect(v.ok && v.settings.templates.find(t => t.code === "modern-minimal")!.version).toBe(2);
    expect(v.ok && v.settings.templates.find(t => t.code === "classic-professional")!.version).toBe(1);
  });

  it("no template can claim verification for what is not an independent decision, or fetch a photograph", () => {
    expect(labelHonest("self_declared", "Verified by me")).toBe(false);
    expect(labelHonest("self_declared", "Self-declared, not verified")).toBe(true);
    const bad = { ...DEFAULT_DOCUMENTS, templates: [{ ...DEFAULT_DOCUMENTS.templates[0], labels: { ...DEFAULT_LABELS, formative: "Verified knowledge" } }] };
    expect(checkDocumentsDraft(bad).ok).toBe(false);
    const photo = { ...DEFAULT_DOCUMENTS, templates: [{ ...DEFAULT_DOCUMENTS.templates[0], photo: "on" }] };
    expect(checkDocumentsDraft(photo).ok).toBe(false);
    const unknownTemplate = { ...DEFAULT_DOCUMENTS, types: [{ ...cv, templates: ["nope"] }] };
    expect(checkDocumentsDraft(unknownTemplate).ok).toBe(false);
  });
});

describe("PR7 s10.6: characters outside Windows-1252 print in the PDF", () => {
  const embedsFont = async (buf: Buffer) => (await PDFDocument.load(buf)).context.enumerateIndirectObjects().some(([, o]) => o instanceof PDFDict && o.has(PDFName.of("FontFile2")));
  const person = { ...SAMPLE_PERSON, name: "Zoë Łukasz Ńkósí-Οδυσσέας" };
  const SUMMARY = "Анна Ковальчук trains ward staff. SpO₂ ≥ 94% → escalate. Ψ and μg doses. 中文 notes.";
  const uni = (face: "sans" | "serif") => {
    const t0 = templatesFor(DEFAULT_DOCUMENTS, cv)[0];
    const t = { ...t0, type: { ...t0.type, face } };
    return { t, m: buildDocModel({ type: cv, template: t, title: "Мой CV", draft: draft({ summary: SUMMARY }), records, person, today: "2026-10-26" }) };
  };

  for (const face of ["sans", "serif"] as const) it(`${face}: names, Greek, Cyrillic and symbols print; only what DejaVu lacks is "?"`, async () => {
    const { t, m } = uni(face);
    const pdf = await renderPdf(m, t, new Date("2026-10-26T00:00:00Z"));
    const pt = norm(await pdfText(pdf)).replace(/\s/g, "");
    for (const s of ["Zoë", "Łukasz", "Ńkósí-Οδυσσέας", "АннаКовальчук", "SpO₂≥94%→escalate", "Ψ", "μg"]) expect(pt).toContain(s.replace(/\s/g, ""));
    expect(pt).toContain("??notes"); // 中文: no glyph in DejaVu
    expect(await embedsFont(pdf)).toBe(true);
    expect(await pdfUndrawable(modelLines(m), t)).toEqual(["中", "文"]);
  }, 30000);

  it("a Windows-1252 document keeps the standard fonts: nothing embedded, nothing to warn about", async () => {
    const m = model(), t = templatesFor(DEFAULT_DOCUMENTS, cv)[0];
    const pdf = await renderPdf(m, t);
    expect(await embedsFont(pdf)).toBe(false);
    expect(pdf.length).toBeLessThan(20000);
    expect(await pdfUndrawable(modelLines(m), t)).toEqual([]);
  });

  it("the embedded fonts are subset, not whole", async () => {
    const { t, m } = uni("sans");
    expect((await renderPdf(m, t)).length).toBeLessThan(250000); // DejaVu Sans alone is 757 KB
  }, 30000);
});
