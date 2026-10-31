import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import {
  FLASHCARD_PDF_DISCLAIMER, buildFlashcardPdf, duplexSheets, excerpt, exportFilename, exportTitle, guidePlan, pdfText, singleSheets,
  type FlashcardPdfInput,
} from "./flashcard-pdf";
import { RESP_GENERATED_AT, otherLearnerFront, respiratoryCards } from "./flashcard-pdf.fixture";
import { POLICY_SCOPE, policyPath } from "../policy";
import { resetFlashcardSchema, resetSqieSchema } from "./store";

// SCHOLAR-FLASHCARDS-01 s8-12: the three downloads. Each is a real PDF read back (pdf-lib for pages and size, unpdf for
// the words), from the respiratory fixture deck; the route is exercised with a fake database holding two learners.

const A4 = [595.28, 841.89];
const input = (over: Partial<FlashcardPdfInput> = {}): FlashcardPdfInput => ({ cards: respiratoryCards(), title: "Respiratory Assessment", generatedAt: RESP_GENERATED_AT, ...over });
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
async function read(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: false });
  const pages = (text as string[]).map(norm);
  return { doc, pages, all: pages.join(" ") };
}
const disclaimer = norm(pdfText(FLASHCARD_PDF_DISCLAIMER));

describe("A: the deck", () => {
  it("is an A4 PDF: title, topics, sources, each card's Question and Answer, its topic and source, page numbers, the disclaimer", async () => {
    const { doc, pages, all } = await read(await buildFlashcardPdf("deck", input()));
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    for (const p of doc.getPages()) expect([p.getWidth(), p.getHeight()].map(Math.round)).toEqual(A4.map(Math.round));
    expect(all).toContain("Respiratory Assessment");
    expect(all).toContain("Flashcard deck · 10 cards · Created 31 October 2026");
    expect(all).toMatch(/Topics: Systematic respiratory assessment, Respiratory rate and oxygen saturation, Work of breathing, Escalation/);
    expect(all).toMatch(/Sources: your notes \(Respiratory v2\)/);
    for (const c of respiratoryCards()) { expect(all).toContain(norm(pdfText(c.front))); expect(all).toContain(norm(pdfText(c.back))); }
    expect(all).toContain("Card 1 of 10");
    expect(all.match(/Question/g)!.length).toBeGreaterThanOrEqual(10);
    expect(all.match(/Answer/g)!.length).toBeGreaterThanOrEqual(10);
    expect(all).toContain("Source: Respiratory v2, page 1 · From your notes");
    expect(all).toContain("Competen library, version 3 · From the Competen library (clinically reviewed)");
    expect(all).toContain("Written by you · Your card · written by you, not clinically reviewed");
    pages.forEach((p, i) => { expect(p).toContain(disclaimer); expect(p).toContain(`Page ${i + 1} of ${pages.length}`); });
  });
  it("symbols the standard fonts lack are spelled out, never dropped silently", async () => {
    expect(pdfText("SpO₂ ≥ 94% → escalate")).toBe("SpO2 >= 94% -> escalate");
    const { all } = await read(await buildFlashcardPdf("deck", input()));
    expect(all).toContain("What target SpO2 range is usual for most acutely ill adults?");
    expect(all).toContain("(>= 88%)");
  });
  it("says when the per-download cap left cards out", async () => {
    const { all } = await read(await buildFlashcardPdf("deck", input({ cards: respiratoryCards().slice(0, 4), omitted: 6 })));
    expect(all).toContain("This download holds the first 4 cards of 10");
  });
  it("the same selection gives the same bytes", async () => {
    const [a, b] = await Promise.all([buildFlashcardPdf("deck", input()), buildFlashcardPdf("deck", input())]);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe("B: printable cards", () => {
  it("duplex: each answer sits behind its question after a long-edge flip (mirrored left to right)", () => {
    for (const n of [1, 7, 8, 9, 10, 23]) {
      const sheets = duplexSheets(n);
      expect(sheets.length).toBe(Math.ceil(n / 8));
      const placed: number[] = [];
      for (const s of sheets)
        for (let k = 0; k < 8; k++) {
          const r = Math.floor(k / 2), c = k % 2;
          // Flipping on the long edge turns column c into column 1 - c on the same row.
          expect(s.back[r * 2 + (1 - c)]).toBe(s.front[k]);
          if (s.front[k] !== null) placed.push(s.front[k]!);
        }
      expect(placed).toEqual(Array.from({ length: n }, (_, i) => i));
    }
    expect(duplexSheets(3)[0]).toEqual({ front: [0, 1, 2, null, null, null, null, null], back: [1, 0, null, 2, null, null, null, null] });
  });
  it("duplex PDF: questions on the front page, their answers on the back page, card numbers on both", async () => {
    const cards = respiratoryCards();
    const { doc, pages } = await read(await buildFlashcardPdf("print", input()));
    expect(doc.getPageCount()).toBe(4); // two sheets, front and back
    for (const p of doc.getPages()) expect([p.getWidth(), p.getHeight()].map(Math.round)).toEqual(A4.map(Math.round));
    expect(pages[0]).toContain("Sheet 1 of 2 · Front: questions");
    expect(pages[1]).toContain("Sheet 1 of 2 · Back: answers");
    expect(pages[0]).toMatch(/flipping on the LONG edge/);
    for (let i = 0; i < 8; i++) {
      expect(pages[0]).toContain(norm(pdfText(cards[i].front)).slice(0, 30));
      expect(pages[1]).toContain(norm(pdfText(cards[i].back)).slice(0, 25));
      expect(pages[0]).toContain(`#${i + 1}`);
      expect(pages[1]).toContain(`#${i + 1}`);
    }
    expect(pages[2]).toContain("#9");
    expect(pages[3]).toContain(norm(pdfText(cards[9].back)).slice(0, 25));
    expect(pages[1]).not.toContain(norm(pdfText(cards[0].front)).slice(0, 30));
    pages.forEach(p => expect(p).toContain(disclaimer));
  });
  it("single-sided fallback: question | answer side by side, five to a page", async () => {
    expect(singleSheets(10)).toEqual([[0, 1, 2, 3, 4], [5, 6, 7, 8, 9]]);
    expect(singleSheets(6)).toEqual([[0, 1, 2, 3, 4], [5]]);
    const { doc, pages } = await read(await buildFlashcardPdf("print", input(), { layout: "single" }));
    expect(doc.getPageCount()).toBe(2);
    expect(pages[0]).toContain("Question | Answer");
    expect(pages[0]).toContain(norm(pdfText(respiratoryCards()[0].back)).slice(0, 25));
    pages.forEach(p => expect(p).toContain(disclaimer));
  });
});

describe("C: the revision guide", () => {
  it("cover, contents, then Key Concepts, Questions and Answers, Clinical Application, Checklist, References, numbered", async () => {
    const { doc, pages, all } = await read(await buildFlashcardPdf("guide", input()));
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(6);
    for (const p of doc.getPages()) expect([p.getWidth(), p.getHeight()].map(Math.round)).toEqual(A4.map(Math.round));
    expect(pages[0]).toContain("Competen Scholar");
    expect(pages[0]).toContain("Respiratory Assessment Revision Guide");
    expect(pages[0]).toContain("Created 31 October 2026");
    expect(pages[0]).toContain(disclaimer);
    expect(pages[1]).toMatch(/^Contents/);
    const order = ["1 Key Concepts", "2 Questions and Answers", "3 Clinical Application", "4 Quick Revision Checklist", "5 References"];
    let at = -1;
    for (const h of order) { const i = pages.findIndex((p, k) => k > 1 && p.includes(h)); expect(i, h).toBeGreaterThan(at); at = i; expect(pages[1]).toContain(h); }
    pages.slice(1).forEach((p, i) => { expect(p).toContain(disclaimer); expect(p).toContain(`Page ${i + 2} of ${pages.length}`); });
    // Key concepts are the cards' own objectives and key points.
    expect(all).toContain("Describe the components of a systematic respiratory assessment");
    expect(all).toContain("Tracheal tug and recession");
    // Clinical application holds only the cards whose rubric says application or reasoning, as written.
    const clinical = pages.find((p, k) => k > 1 && p.includes("3 Clinical Application"))!;
    expect(clinical).toContain("A 68-year-old with COPD is drowsy");
    expect(clinical).toContain("respiratory rate rises from 18 to 26");
    expect(clinical).not.toContain("What is the normal respiratory rate for an adult");
  });
  it("Clinical Application is left out (and the rest renumbered) when no card is an application card", async () => {
    const cards = respiratoryCards().map(c => ({ ...c, level: c.level === "application" || c.level === "reasoning" ? ("recall" as const) : c.level }));
    expect(guidePlan(cards).clinical).toEqual([]);
    const { all } = await read(await buildFlashcardPdf("guide", input({ cards })));
    expect(all).not.toContain("Clinical Application");
    expect(all).toContain("3 Quick Revision Checklist");
    expect(all).toContain("4 References");
  });
  it("references are told apart by origin: notes (by document, sections, a short excerpt), library, external, and the learner's own", async () => {
    const plan = guidePlan(respiratoryCards());
    expect(plan.references.notes).toHaveLength(1);
    expect(plan.references.notes[0]).toMatchObject({ citation: "Respiratory v2", cards: 8 });
    expect(plan.references.notes[0].sections).toContain("page 4");
    expect(plan.references.library).toEqual([{ citation: "Competen library, version 3", sections: [], detail: null, cards: 1 }]);
    expect(plan.references.external).toEqual([{ citation: "Clinically approved references linked to your notes", sections: [], detail: "1 approved reference linked to Respiratory v2", cards: 1 }]);
    expect(plan.references.ownCards).toBe(1);
    // Never the whole passage: an excerpt is at most 25 words.
    expect(plan.references.notes[0].detail!.split(" ").length).toBeLessThanOrEqual(26);
    expect(excerpt("one two three", 2)).toBe("one two…");
    const { all } = await read(await buildFlashcardPdf("guide", input()));
    for (const h of ["From your notes", "From the Competen library (clinically reviewed)", "Approved external references", "Cards you wrote"]) expect(all).toContain(h);
  });
  it("checklist from objectives and key points; a topic with neither lists its questions", () => {
    const plan = guidePlan(respiratoryCards());
    expect(plan.checklist.find(c => c.label === "Work of breathing")!.items).toEqual(["Recognise signs of increased work of breathing", "Tachypnoea and nasal flaring", "Tracheal tug and recession", "Accessory muscle use"]);
    const bare = respiratoryCards().map(c => ({ ...c, objective: null, keyPoints: [], explanation: null }));
    const p2 = guidePlan(bare);
    expect(p2.keyConcepts).toEqual([]);
    expect(p2.checklist[0].items[0]).toBe("I can answer: What are the key components of a systematic respiratory assessment?");
  });
  it("a short guide has no contents page, and its sections run on rather than one to a page", async () => {
    const { pages, all } = await read(await buildFlashcardPdf("guide", input({ cards: respiratoryCards().slice(1, 3) })));
    expect(pages.some(p => p.startsWith("Contents"))).toBe(false);
    expect(pages.length).toBeLessThanOrEqual(3);
    for (const h of ["1 Key Concepts", "2 Questions and Answers", "3 Quick Revision Checklist", "4 References"]) expect(all).toContain(h);
  });
});

describe("names and titles", () => {
  it("a safe attachment name", () => {
    expect(exportFilename("Respiratory Assessment", "guide", RESP_GENERATED_AT)).toBe("Competen-Scholar-Respiratory-Assessment-revision-guide-2026-10-31.pdf");
    expect(exportFilename("../\"evil\";\r\nname é", "print", RESP_GENERATED_AT)).toBe("Competen-Scholar-evil-name-e-printable-cards-2026-10-31.pdf");
    expect(exportFilename("✓✓", "deck", "x")).toBe("Competen-Scholar-cards-flashcards-undated.pdf");
  });
  it("the title: the deck named, the decks, the topic, else all cards", () => {
    const cards = respiratoryCards();
    expect(exportTitle({ decks: [{ title: "Exam week" }], cards }, {})).toBe("Exam week");
    expect(exportTitle({ decks: [{ title: "A" }, { title: "B" }], cards }, {})).toBe("A + B");
    expect(exportTitle({ decks: [], cards }, { topic: "Escalation" })).toBe("Escalation");
    expect(exportTitle({ decks: [], cards }, { competencyId: cards[0].competency!.id })).toBe("CFCA: Respiratory Assessment and Monitoring");
    expect(exportTitle({ decks: [], cards }, {})).toBe("All cards");
  });
});

// ── NO AI ON THE EXPORT PATH ──

const ROUTE = "src/app/api/individual/scholar/flashcards/export/route.ts";
const PDF = "src/lib/individual/scholar/flashcard-pdf.ts";
const AI_NAMES = /\b(generate|runMeteredAi|runOwnedAi|scholarAiRunner|aiPreflight|runRevisionQuestions|runQuestions|runExplain\w*|studentAiText)\b/;
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

describe("no AI anywhere in an export", () => {
  it("the PDF assembly reaches no AI module, generation or Scholar AI runner, at any depth", () => {
    const files = [...closure(resolve(PDF))].map(f => f.replace(/\\/g, "/"));
    expect(files.some(f => /\/lib\/ai\/|\/scholar\/(generation|http|edu-ai)\.ts$/.test(f))).toBe(false);
  });
  it("the route imports no AI module and names no AI function", () => {
    for (const i of valueImports(resolve(ROUTE))) {
      expect(i.spec).not.toMatch(/\/ai\/|generation|scholar\/http|edu-ai/);
      expect(i.names).not.toMatch(AI_NAMES);
    }
    for (const f of [ROUTE, PDF, "src/lib/individual/scholar/flashcard-service.ts"]) expect(readFileSync(f, "utf8").replace(/\/\/.*$/gm, "")).not.toMatch(/\b(generate|runMeteredAi|scholarAiRunner|aiPreflight|runRevisionQuestions)\s*\(/);
  });
});

// ── THE ROUTE: the caller's own cards only, policy per format, an attachment ──

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const aiCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/ai/client", async orig => ({ ...(await orig<object>()), generate: async () => { aiCalls.n++; throw new Error("no AI in an export"); } }));
vi.mock("@/lib/trace", () => ({ currentTraceId: async () => "trace-test" }));
const db = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, inserts: [] as { table: string; row: unknown }[] }));
vi.mock("@/lib/individual/guard", () => ({
  requireIndividualContext: async () => ({ admin: fakeAdmin(), userId: ME, profile: { fullName: "Me" } }),
  isGuardRefusal: (x: unknown) => x instanceof Response,
}));

function fakeAdmin() {
  const from = (table: string) => {
    let rows = [...(db.tables[table] ?? [])];
    const q: Record<string, unknown> = {};
    const chain = (fn: () => void) => () => { fn(); return q; };
    q.select = () => q;
    q.eq = (c: string, v: unknown) => chain(() => { rows = rows.filter(r => r[c] === v); })();
    q.in = (c: string, vs: unknown[]) => chain(() => { rows = rows.filter(r => vs.includes(r[c])); })();
    q.is = (c: string, v: unknown) => chain(() => { rows = rows.filter(r => (r[c] ?? null) === v); })();
    q.not = (c: string, op: string, v: unknown) => chain(() => { if (op === "is") rows = rows.filter(r => (r[c] ?? null) !== v); })();
    for (const m of ["or", "like", "order", "limit", "range", "gte", "lte"]) q[m] = () => q;
    q.maybeSingle = () => ({ then: (res: (x: unknown) => unknown) => Promise.resolve({ data: rows[0] ?? null, error: null }).then(res) });
    q.insert = (row: unknown) => { db.inserts.push({ table, row }); return { then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res, rej) }; };
    q.then = (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res, rej);
    return q;
  };
  return { from };
}

const MAT = (user: string, id: string, title: string) => ({ id, user_id: user, title, mime_type: "application/pdf" });
const Q = (user: string, id: string, material: string, stem: string, back: string) => ({
  id, user_id: user, material_id: material, chunk_id: `${material.slice(0, 8)}-c`, kind: "flashcard", stem, options: [], correct_index: null,
  rationale: null, source_quote: null, model: "claude", prompt_version: "revision-flashcard-v3", created_at: "2026-10-30T10:00:00Z",
  answer: { back, rubric: { level: "recall", objective: null, keyPoints: [], misconceptions: [], source: "notes" } }, difficulty: 2,
});
const myCards = respiratoryCards().slice(0, 3);
function seed(policy: Record<string, unknown> = {}) {
  db.inserts = [];
  db.tables = {
    individual_scholar_material: [MAT(ME, "aaaaaaaa-0000-4000-8000-000000000001", "Respiratory v2"), MAT(OTHER, "bbbbbbbb-0000-4000-8000-000000000001", "Their notes")],
    individual_scholar_question: [
      ...myCards.map((c, i) => Q(ME, `aaaaaaaa-0000-4000-8000-00000000010${i}`, "aaaaaaaa-0000-4000-8000-000000000001", c.front, c.back)),
      Q(OTHER, "bbbbbbbb-0000-4000-8000-000000000100", "bbbbbbbb-0000-4000-8000-000000000001", otherLearnerFront, "Their private answer"),
    ],
    individual_scholar_chunk: [{ id: "aaaaaaaa-c", user_id: ME, ordinal: 1, page_from: 2, page_to: 2 }, { id: "bbbbbbbb-c", user_id: OTHER, ordinal: 1, page_from: 1, page_to: 1 }],
    workspace_config_overrides: Object.entries(policy).map(([k, v]) => ({ scope_type: POLICY_SCOPE.scopeType, scope_ref: POLICY_SCOPE.scopeRef, config_path: policyPath(k as never), published: typeof v === "object" ? v : { value: v } })),
  };
}
const route = () => import("@/app/api/individual/scholar/flashcards/export/route");
const get = async (qs: string) => (await route()).GET(new Request(`http://x/api/individual/scholar/flashcards/export?${qs}`));

describe("the export route", () => {
  beforeEach(() => { resetSqieSchema(); resetFlashcardSchema(); aiCalls.n = 0; seed(); });
  it("streams the caller's own cards as a private attachment, and never another learner's", async () => {
    for (const format of ["deck", "print", "guide"]) {
      const r = await get(`format=${format}`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("application/pdf");
      expect(r.headers.get("content-disposition")).toMatch(/^attachment; filename="Competen-Scholar-All-cards-(flashcards|printable-cards|revision-guide)-\d{4}-\d{2}-\d{2}\.pdf"$/);
      expect(r.headers.get("cache-control")).toBe("no-store, private");
      const { all } = await read(new Uint8Array(await r.arrayBuffer()));
      for (const c of myCards) expect(all).toContain(norm(pdfText(c.front)).slice(0, 30));
      expect(all).not.toContain("OTHER LEARNER");
      expect(all).not.toContain("Their private answer");
      expect(all).toContain(disclaimer);
    }
    expect(aiCalls.n).toBe(0);
    // One audit row per download: codes and counts, never a card's words.
    const audits = db.inserts.filter(i => i.table === "audit_log").map(i => i.row as { action: string; new_value: Record<string, unknown> });
    expect(audits.map(a => a.action)).toEqual(Array(3).fill("individual_scholar_flashcard_export"));
    expect(JSON.stringify(audits)).not.toContain(myCards[0].front);
  });
  it("naming another learner's card gets nothing", async () => {
    const r = await get("format=deck&card=bbbbbbbb-0000-4000-8000-000000000100");
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "There are no cards in that selection." });
  });
  it("a format policy does not offer is refused (and HEAD says so without building)", async () => {
    seed({ scholar_flashcard_exports: { enabled: ["deck"] } });
    expect((await get("format=guide")).status).toBe(403);
    expect((await get("format=deck")).status).toBe(200);
    const head = await (await route()).HEAD(new Request("http://x/api/individual/scholar/flashcards/export?format=print"));
    expect(head.status).toBe(403);
    expect(head.headers.get("content-type")).toContain("json");
    expect((await (await route()).HEAD(new Request("http://x/api/individual/scholar/flashcards/export?format=deck"))).status).toBe(204);
    expect((await get("format=pptx")).status).toBe(400);
  });
  it("flashcards off: refused", async () => {
    seed({ scholar_flashcards: "off" });
    expect((await get("format=deck")).status).toBe(403);
  });
  it("more cards than the deck size: the first that many, and the file says so", async () => {
    seed({ scholar_flashcard_deck_max: 10 });
    db.tables.individual_scholar_question.push(...Array.from({ length: 9 }, (_, i) => Q(ME, `aaaaaaaa-0000-4000-8000-00000000020${i}`, "aaaaaaaa-0000-4000-8000-000000000001", `What is extra card number ${i}?`, `Extra ${i}`)));
    const { all } = await read(new Uint8Array(await (await get("format=deck")).arrayBuffer()));
    expect(all).toContain("This download holds the first 10 cards of 12");
  });
});
