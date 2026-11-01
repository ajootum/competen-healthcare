import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import {
  EXPORT_FOOTER, EXPORT_PROVENANCE, buildLearningExportPdf, exportBlocks, exportFilename, markdownBlocks,
  type ExportLesson, type ExportTeaching, type LearningExportInput,
} from "./learning-export";
import { composeTeachAnswer } from "./teach-format";

const teaching = (over: Partial<ExportTeaching> = {}): ExportTeaching => ({
  actionLabel: "Teach me", depth: "standard", savedAt: "2026-10-30T10:00:00Z", model: "m-1", promptVersion: "learnTeach.v4", background: null, flags: [],
  content: composeTeachAnswer({ overview: "Sepsis is a dysregulated response to infection [S1].", points: ["Recognise early [S1]", "Escalate promptly [S2]"], example: "A patient with a fever and low blood pressure [S1].", questions: ["What is the first sign? [S1]"] }),
  citations: [{ tag: "S1", text: "Sepsis notes, page 4" }, { tag: "S2", text: "Sepsis notes, slide 7" }],
  governed: [], external: [], ...over,
});
const lesson = (over: Partial<ExportLesson> = {}): ExportLesson => ({
  title: "Recognising sepsis", objective: "Explain how sepsis is recognised.", step: 0, sessionTitle: "Sepsis notes",
  material: [{ title: "Sepsis notes", uploadedAt: "2026-10-01T08:00:00Z" }], sections: ["Sepsis notes, page 4"], teachings: [teaching()], notes: [], ...over,
});
const input = (lessons: ExportLesson[], over: Partial<LearningExportInput> = {}): LearningExportInput => ({
  scope: "lesson", title: "Saved lesson: Recognising sepsis", learner: "Ada Learner", generatedAt: "2026-11-01T09:00:00Z", lessons, ...over,
});
const textOf = async (bytes: Uint8Array) => {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text, totalPages } = await extractText(pdf, { mergePages: false });
  return { pages: text as string[], totalPages };
};
const flat = (b: ReturnType<typeof exportBlocks>) => b.map(x => ("text" in x ? x.text : x.t === "kv" ? `${x.k}: ${x.v}` : "")).join("\n");

describe("provenance labels", () => {
  it("each kind of content sits under its own label, in order: material, AI teaching, external research, your notes", () => {
    const l = lesson({
      teachings: [teaching({
        external: [{ title: "Early sepsis recognition", journal: "Lancet", year: 2024, authors: ["A. Author", "B. Author"], doi: "10.1000/xyz", pmid: "12345", url: "https://pubmed.ncbi.nlm.nih.gov/12345/", excerpt: "A short stored excerpt." }],
        background: "General background about lactate.",
      })],
      notes: [{ kind: "flashcard", text: "Qsofa criteria — RR, SBP, GCS", savedAt: "2026-10-31T00:00:00Z" }, { kind: "note", text: "Ask the tutor about lactate", savedAt: null }],
    });
    const labels = exportBlocks(input([l])).filter(b => b.t === "label").map(b => (b as { kind: string }).kind);
    expect(labels).toEqual(["material", "ai", "beyond", "material", "external", "notes"]);
    const text = flat(exportBlocks(input([l])));
    for (const s of [EXPORT_PROVENANCE.material, EXPORT_PROVENANCE.ai, EXPORT_PROVENANCE.external, EXPORT_PROVENANCE.notes]) expect(text).toContain(s);
    expect(EXPORT_PROVENANCE.ai).toBe("AI-generated teaching (private, formative — not clinically reviewed)");
    expect(text).toContain("[S1] Sepsis notes, page 4");
    expect(text).toContain("[S2] Sepsis notes, slide 7");
    expect(text).toContain("DOI 10.1000/xyz");
    expect(text).toContain("PMID 12345");
    expect(text).toContain("Stored excerpt");
    expect(text).toContain("Flashcard you wrote");
    expect(text).toContain("Ask the tutor about lactate");
  });
  it("external research is metadata plus a clipped stored excerpt, never long text", () => {
    const long = "word ".repeat(400);
    const text = flat(exportBlocks(input([lesson({ teachings: [teaching({ external: [{ title: "T", journal: null, year: null, authors: [], doi: null, pmid: null, url: null, excerpt: long }] })] })])));
    const ex = text.split("\n").find(l => l.startsWith("Stored excerpt"))!;
    expect(ex.length).toBeLessThan(340);
  });
  it("the structured Teach me parts are laid out as overview, key points, example and check questions", () => {
    const text = flat(exportBlocks(input([lesson()])));
    expect(text).toMatch(/Overview: Sepsis is a dysregulated/);
    expect(text).toContain("Key points");
    expect(text).toContain("Escalate promptly [S2]");
    expect(text).toMatch(/Example: A patient/);
    expect(text).toContain("Check your understanding");
  });
  it("an older, unstructured answer is shown from its markdown subset as plain text", () => {
    const b = markdownBlocks("## Heading\n\nSome **bold** and `code` text\ncontinues here.\n\n- one\n* two\n1. three");
    expect(b).toEqual([
      { t: "h3", text: "Heading" }, { t: "p", text: "Some bold and code text continues here." },
      { t: "bullet", text: "one" }, { t: "bullet", text: "two" }, { t: "bullet", text: "three" },
    ]);
  });
});

describe("header and empty / partial cases", () => {
  it("the header says whose document it is, when it was made, the source material and the teaching versions", () => {
    const text = flat(exportBlocks(input([lesson()])));
    expect(text).toContain("Made for Ada Learner, for your own study");
    expect(text).toContain("Generated: 1 November 2026");
    expect(text).toContain("Sepsis notes (uploaded 1 October 2026)");
    expect(text).toContain("Teaching versions: learnTeach.v4");
    expect(text).toContain("Nothing in it is an assessment");
  });
  it("nothing saved at all is said, not left blank", () => {
    const text = flat(exportBlocks(input([], { scope: "material", learner: null })));
    expect(text).toContain("Nothing has been saved here yet");
    expect(text).toContain("Made for you");
    expect(text).toContain("0 lessons");
  });
  it("a lesson with no saved teaching, no citations, no material and no notes still reads honestly", () => {
    const l = lesson({ teachings: [], material: [], sections: [], objective: null, sessionTitle: null });
    const blocks = exportBlocks(input([l]));
    const text = flat(blocks);
    expect(text).toContain("No teaching has been saved for this lesson yet");
    expect(text).toContain("no longer in your library");
    expect(text).toContain("nothing saved for this lesson yet");
    expect(blocks.some(b => b.t === "label" && b.kind === "ai")).toBe(false);
    expect(blocks.some(b => b.t === "label" && b.kind === "notes")).toBe(false);
  });
  it("teaching with no recorded sources says so", () => {
    expect(flat(exportBlocks(input([lesson({ teachings: [teaching({ citations: [] })] })])))).toContain("No source sections are recorded");
  });
  it("flags are listed as marked for checking, and a repeated external work is listed once", () => {
    const ext = { title: "Same", journal: null, year: 2020, authors: [], doi: "10.1/a", pmid: null, url: null, excerpt: null };
    const text = flat(exportBlocks(input([lesson({ teachings: [teaching({ flags: ["Claim not in your material"], external: [ext, ext] })] })])));
    expect(text).toContain("Marked for checking");
    expect(text).toContain("Claim not in your material");
    expect(text.match(/DOI 10\.1\/a/g)).toHaveLength(1);
  });
  it("the file name is plain ASCII with the date", () => {
    expect(exportFilename("Saved lesson: Création état", "2026-11-01T09:00:00Z")).toBe("scholar-Saved-lesson-Creation-etat-2026-11-01.pdf");
    expect(exportFilename("中文", "2026-11-01T09:00:00Z")).toBe("scholar-saved-learning-2026-11-01.pdf");
  });
});

describe("the PDF", () => {
  it("is a real PDF: header, learner's own document, provenance labels, footer and page numbers on every page", async () => {
    const lessons = Array.from({ length: 4 }, (_, i) => lesson({ title: `Lesson topic ${i + 1}`, teachings: [teaching(), teaching({ actionLabel: "Explain this", savedAt: "2026-10-31T10:00:00Z" })], notes: [{ kind: "note", text: "my note", savedAt: null }] }));
    const bytes = await buildLearningExportPdf(input(lessons, { scope: "study", title: "Study session: Sepsis" }));
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    const { pages, totalPages } = await textOf(bytes);
    expect(totalPages).toBeGreaterThan(1);
    pages.forEach((p, i) => {
      expect(p).toContain("Private learning record");
      expect(p).toContain("not an assessment of competence");
      expect(p).toContain(`Page ${i + 1} of ${totalPages}`);
    });
    const all = pages.join("\n");
    expect(all).toContain("Made for Ada Learner");
    expect(all).toContain(EXPORT_PROVENANCE.material);
    expect(all).toContain("AI-generated teaching (private, formative");
    expect(all).toContain(EXPORT_PROVENANCE.notes);
    expect(all).toContain("Lesson 4: Lesson topic 4");
    expect(EXPORT_FOOTER).toContain("not an assessment of competence");
  });
  it("an empty export is still a valid, labelled PDF", async () => {
    const { pages, totalPages } = await textOf(await buildLearningExportPdf(input([], { scope: "material" })));
    expect(totalPages).toBe(1);
    expect(pages[0]).toContain("Nothing has been saved here yet");
  });
  it("prints text outside Windows-1252 (Unicode font path) and long unbroken strings without throwing", async () => {
    const l = lesson({ title: "Ελληνικά → sepsis", teachings: [teaching({ content: `Plain note ≥ 5 mmol ${"x".repeat(300)}` })] });
    const bytes = await buildLearningExportPdf(input([l]));
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await textOf(bytes)).pages.join("\n")).toContain("≥");
  });
  it("the same input gives the same bytes", async () => {
    const a = await buildLearningExportPdf(input([lesson()]));
    const b = await buildLearningExportPdf(input([lesson()]));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

// ── NO AI ──

const resolveSpec = (from: string, spec: string) => {
  const base = spec.startsWith("@/") ? resolve("src", spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  return base ? [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(existsSync) ?? null : null;
};
const valueImports = (file: string) => [...readFileSync(file, "utf8").matchAll(/^import\s+(type\s+)?(?:([^;"]*?)\s+from\s+)?"([^"]+)"/gm)].filter(m => !m[1]).map(m => ({ names: m[2] ?? "", spec: m[3] }));
function closure(file: string, seen = new Set<string>()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const i of valueImports(file)) { const r = resolveSpec(file, i.spec); if (r) closure(r, seen); }
  return seen;
}
const MODULE = "src/lib/individual/scholar/learning-export.ts";
const SERVICE = "src/lib/individual/scholar/learning-export-service.ts";
const ROUTE = "src/app/api/individual/scholar/learn/export/route.ts";

describe("no AI anywhere in an export", () => {
  it("the export module reaches nothing from src/lib/ai, generation or a Scholar AI runner, at any depth", () => {
    const files = [...closure(resolve(MODULE))].map(f => f.replace(/\\/g, "/"));
    expect(files.filter(f => /\/lib\/ai\//.test(f))).toEqual([]);
    expect(files.some(f => /\/scholar\/(generation|http|edu-ai)\.ts$/.test(f))).toBe(false);
    expect(readFileSync(MODULE, "utf8")).not.toMatch(/from "[^"]*\/ai\//);
  });
  it("the service and the route import no AI module and call no AI function", () => {
    for (const f of [SERVICE, ROUTE]) {
      for (const i of valueImports(resolve(f))) {
        expect(i.spec).not.toMatch(/\/ai\/|generation|scholar\/http|edu-ai/);
        expect(i.names).not.toMatch(/\b(generate|runMeteredAi|scholarAiRunner|aiPreflight)\b/);
      }
      expect(readFileSync(f, "utf8").replace(/\/\/.*$/gm, "")).not.toMatch(/\b(generate|runMeteredAi|scholarAiRunner|aiPreflight)\s*\(/);
    }
  });
});
