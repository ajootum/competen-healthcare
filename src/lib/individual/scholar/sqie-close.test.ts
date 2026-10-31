/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkRevisionDraft, codeMarkParts, keyOf, markResponse, parseResponse, partMarks, practiceMarks, structuredParts, type RevisionQuestion,
} from "./revision";
import type { Passage } from "./generation";
import { formatPromptVersion, revisionPromptVersion } from "./generation";
import { LIBRARY_QUESTION_LABEL, PROMPT_VERSIONS, REVISION_FORMATS } from "./config";
import { insertLibraryCopies, insertQuestions, insertRevisionQuestions, markSqieAbsent, resetSqieSchema, revisionPool, sqieSchema, type QuestionRow } from "./store";
import { libraryContent, loadLibraryQuestions, namesTopic, pickLibraryQuestions, type LibraryQuestion } from "./library-questions";
import { feedbackView, revisionItemView } from "./revision-view";
import { resolvePolicy } from "../policy";
import { stemKey } from "./question-intel";

// SCHOLAR-SQIE-CLOSE-01 (owner, 30 Oct 2026), over migration 710: structured questions, mcq and case rubrics stored,
// governed library questions reused before any are written, and Scholar working as before where 710 is absent.

const passage: Passage = {
  chunkId: "c1", materialId: "m1", materialTitle: "Respiratory notes", ordinal: 1, pageFrom: 1, pageTo: 1,
  content: "The trachea divides into the right and left main bronchi. The bronchi divide into bronchioles. Bronchioles end in alveoli, where gas exchange happens. Oxygen is prescribed to a target saturation range.",
};
const quote = "Bronchioles end in alveoli, where gas exchange happens.";
const draft = (over: Record<string, unknown> = {}) => ({
  stem: "The airways branch from the trachea down to the alveoli.",
  parts: [
    { prompt: "What does the trachea divide into?", marks: 1, accepted: ["the right and left main bronchi", "main bronchi"], keyPoints: ["right and left main bronchi"], misconceptions: [] },
    { prompt: "Where does gas exchange happen?", marks: 2, accepted: ["alveoli", "in the alveoli"], keyPoints: ["alveoli", "made-up point about 5 litres"], misconceptions: [] },
  ],
  rationale: "The trachea divides into the right and left main bronchi. Bronchioles end in alveoli, where gas exchange happens.",
  sourceQuote: quote, difficulty: 2, level: "understanding", objective: "Trace the airways to where gas exchange happens.",
  ...over,
});

describe("structured questions: validation", () => {
  it("accepts a lead-in with genuine parts, whole marks and what each accepts, each part with its own grounded rubric", () => {
    const r = checkRevisionDraft("structured", draft(), passage);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.options).toEqual([]);
    const parts = r.draft.answer.parts as any[];
    expect(parts.map(p => p.marks)).toEqual([1, 2]);
    expect(parts[0].rubric.expectedAnswer).toBe("the right and left main bronchi");
    // The ungrounded key point (a figure the notes do not hold) is left out of the part's rubric, never the question.
    expect(parts[1].rubric.keyPoints).toEqual(["alveoli"]);
    expect((r.draft.answer.rubric as any).level).toBe("understanding");
  });

  it("refuses a part that does not ask, marks that are not whole numbers from 1 to 5, too few parts, repeated parts", () => {
    const p = draft().parts as any[];
    expect(checkRevisionDraft("structured", draft({ parts: [p[0], { ...p[1], prompt: "Gas exchange happens in the alveoli" }] }), passage)).toEqual({ ok: false, reason: "not_a_question" });
    for (const marks of [0, 1.5, 6, "2", null]) expect(checkRevisionDraft("structured", draft({ parts: [p[0], { ...p[1], marks }] }), passage)).toEqual({ ok: false, reason: "malformed" });
    expect(checkRevisionDraft("structured", draft({ parts: [p[0]] }), passage)).toEqual({ ok: false, reason: "malformed" });
    expect(checkRevisionDraft("structured", draft({ parts: [p[0], p[1], p[0], p[1], p[0]] }), passage)).toEqual({ ok: false, reason: "malformed" });
    expect(checkRevisionDraft("structured", draft({ parts: [p[0], { ...p[1], prompt: p[0].prompt }] }), passage)).toEqual({ ok: false, reason: "duplicate" });
    expect(checkRevisionDraft("structured", draft({ parts: [p[0], { ...p[1], accepted: [] }] }), passage)).toEqual({ ok: false, reason: "malformed" });
  });

  it("holds every part to the notes: an answer the passage does not support, or a quote not in it, is not stored", () => {
    const p = draft().parts as any[];
    expect(checkRevisionDraft("structured", draft({ parts: [p[0], { ...p[1], prompt: "What range is targeted?", accepted: ["94 to 98 percent"] }] }), passage)).toMatchObject({ ok: false, reason: "ungrounded" });
    expect(checkRevisionDraft("structured", draft({ sourceQuote: "Not in the notes at all." }), passage)).toEqual({ ok: false, reason: "quote_not_in_passage" });
    expect(checkRevisionDraft("structured", draft(), passage, { existing: new Set([stemKey(draft().stem as string)]) })).toEqual({ ok: false, reason: "repeat" });
  });

  it("is a revision format with its own prompt version, and policy offers it by default (710 decides whether it is stored)", () => {
    expect(REVISION_FORMATS).toContain("structured");
    expect(revisionPromptVersion("structured")).toBe(PROMPT_VERSIONS.structured);
    expect(formatPromptVersion("structured")).toBe(PROMPT_VERSIONS.structured);
    expect(formatPromptVersion("mcq")).toBe(PROMPT_VERSIONS.mcq);
    expect(formatPromptVersion("short")).toBe(`${PROMPT_VERSIONS.revision}:short`);
    expect(resolvePolicy([]).scholarRevisionFormats).toContain("structured");
  });
});

const structuredQ = (): RevisionQuestion => {
  const r = checkRevisionDraft("structured", draft(), passage);
  if (!r.ok) throw new Error("fixture");
  return { id: "s1", kind: "structured", stem: r.draft.stem, options: [], correctIndex: null, answer: r.draft.answer, rationale: r.draft.rationale, difficulty: 2 };
};
const row = (q: RevisionQuestion, over: Partial<QuestionRow> = {}): QuestionRow => ({
  ...q, materialId: "m1", chunkId: "c1", sourceQuote: quote, model: "m", promptVersion: "p", createdAt: "2026-10-30", materialTitle: "Respiratory notes",
  ordinal: 1, pageFrom: 1, pageTo: 1, unit: "page", latest: null, competencyId: null, caseId: null, caseStep: null, caseTitle: null, ...over,
});

describe("structured questions: what the learner sees, and practice marks", () => {
  it("before answering, only each part's prompt and marks -- never what it accepts or its rubric", () => {
    const q = structuredQ();
    expect(keyOf(q)?.kind).toBe("parts");
    const v = revisionItemView(row(q));
    expect(v.parts).toEqual([{ prompt: "What does the trachea divide into?", marks: 1 }, { prompt: "Where does gas exchange happen?", marks: 2 }]);
    expect(JSON.stringify(v)).not.toMatch(/accepted|rubric|keyPoints|main bronchi"|alveoli"/);
  });

  it("an answer is one text per part, at least one written; code marks blank parts and matches", () => {
    const q = structuredQ();
    expect(parseResponse(q, { texts: ["", ""] })).toBeNull();
    expect(parseResponse(q, { texts: ["main bronchi"] })).toBeNull();
    expect(parseResponse(q, { texts: ["main bronchi", ""] })).toEqual({ kind: "parts", texts: ["main bronchi", ""] });
    expect(markResponse(q, { kind: "parts", texts: ["main bronchi", ""] })).toEqual({ correct: false, score: 1 / 3, marking: "deterministic" });
    expect(markResponse(q, { kind: "parts", texts: ["main bronchi", "in the alveoli"] })).toEqual({ correct: true, score: 1, marking: "deterministic" });
    expect(markResponse(q, { kind: "parts", texts: ["main bronchi", "the tiny air sacs"] })).toEqual({ needsJudgement: true });
    expect(codeMarkParts(structuredParts(q), ["main bronchi", "air sacs"])).toEqual([{ awarded: 1, by: "code" }, null]);
  });

  it("an evaluation verdict gives all, half (rounded down) or none of a part's marks, and the total is formative practice marks", () => {
    expect([partMarks(3, "correct"), partMarks(3, "partly"), partMarks(1, "partly"), partMarks(3, "incorrect")]).toEqual([3, 1, 0, 0]);
    const q = structuredQ();
    const results = [{ awarded: 1, by: "code" as const }, { awarded: 1, by: "ai" as const, feedback: "Alveoli is right.", parts: null }];
    expect(practiceMarks(structuredParts(q), results)).toEqual({ awarded: 2, total: 3, score: 2 / 3, correct: false });
    const f = feedbackView(row(q), { correct: false, score: 2 / 3, marking: "ai_evaluation", structured: results });
    expect(f.structured?.practiceMarks).toMatchObject({ awarded: 2, total: 3 });
    expect(f.structured?.practiceMarks.label).toMatch(/formative/i);
    expect(f.structured?.parts[1]).toMatchObject({ awarded: 1, by: "ai", accepted: "alveoli; in the alveoli", evaluation: { feedback: "Alveoli is right." } });
    // Resumed later, the stored share gives the marks.
    expect(feedbackView(row(q), { correct: false, score: 2 / 3, marking: "ai_evaluation" }).structured?.practiceMarks.awarded).toBe(2);
  });
});

// ── a small in-memory stand-in for the service-role client: eq / in / not-null filters, inserts, one rpc ──
type Table = Record<string, any>[];
function fakeAdmin(tables: Record<string, Table>, opts: { failInsert?: (table: string, row: any) => any; rpc?: (name: string, args: any) => any; missingColumn?: string } = {}) {
  let n = 0;
  const calls: { table: string; op: string; rows?: any[] }[] = [];
  const from = (table: string) => {
    const filters: ((r: any) => boolean)[] = [];
    let op: "select" | "insert" = "select", inserted: any[] = [], cols = "", single = false;
    const run = () => {
      if (opts.missingColumn && cols.includes(opts.missingColumn)) return { data: null, error: { code: "42703", message: `column ${opts.missingColumn} does not exist` } };
      if (op === "insert") {
        calls.push({ table, op, rows: inserted });
        for (const r of inserted) { const e = opts.failInsert?.(table, r); if (e) return { data: null, error: e }; }
        const made = inserted.map(r => ({ id: `id-${++n}`, ...r }));
        (tables[table] ??= []).push(...made);
        return { data: single ? made[0] : made.map(r => ({ id: r.id })), error: null };
      }
      const rows = (tables[table] ?? []).filter(r => filters.every(f => f(r)));
      return { data: single ? rows[0] ?? null : rows, error: null };
    };
    const b: any = {
      select: (c = "") => { cols = c; return b; },
      insert: (r: any) => { op = "insert"; inserted = Array.isArray(r) ? r : [r]; return b; },
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return b; },
      in: (k: string, vs: unknown[]) => { filters.push(r => vs.includes(r[k])); return b; },
      not: (k: string) => { filters.push(r => r[k] !== null && r[k] !== undefined); return b; },
      or: () => b, order: () => b, limit: () => b,
      single: () => { single = true; return b; }, maybeSingle: () => { single = true; return b; },
      then: (ok: any, bad: any) => Promise.resolve(run()).then(ok, bad),
    };
    return b;
  };
  return { from, rpc: async (name: string, args: any) => ({ data: opts.rpc ? opts.rpc(name, args) : null, error: null }), calls, tables };
}

const mcqDraft = { stem: "Where does gas exchange happen?", options: ["alveoli", "trachea", "bronchi", "bronchioles"] as [string, string, string, string], correctIndex: 0, rationale: "r", sourceQuote: quote,
  difficulty: 1 as const, rubric: { objective: "o", level: "recall" as const, expectedAnswer: "alveoli", keyPoints: ["alveoli"], acceptedAlternatives: [], misconceptions: [], source: "notes" as const, referenceIds: [] } };

describe("mcq and case keep their rubric where 710 is applied, and are stored as before where it is not", () => {
  beforeEach(() => resetSqieSchema());

  it("710 present: the rubric is stored in answer, alone", async () => {
    const a = fakeAdmin({ individual_scholar_question: [] });
    const r = await insertQuestions(a, "u1", { passage, kind: "mcq", drafts: [mcqDraft], model: "m", provider: "p", promptVersion: "v" });
    expect(r.ok).toBe(true);
    const stored = a.calls.find(c => c.op === "insert")!.rows![0];
    expect(stored.answer).toEqual({ rubric: mcqDraft.rubric });
    expect(stored.correct_index).toBe(0);
  });

  it("710 absent (the column read fails): no rubric is written, and nothing else changes", async () => {
    const a = fakeAdmin({ individual_scholar_question: [] }, { missingColumn: "library_version_id" });
    expect(await sqieSchema(a, "u1")).toBe(false);
    const r = await insertQuestions(a, "u1", { passage, kind: "case", drafts: [mcqDraft], model: "m", provider: "p", promptVersion: "v" });
    expect(r.ok).toBe(true);
    const inserts = a.calls.filter(c => c.op === "insert");
    expect(inserts).toHaveLength(1);
    expect("answer" in inserts[0].rows![0]).toBe(false);
  });

  it("the 416 CHECK refuses the rubric after all: stored without it, and 710 is treated as absent from then on", async () => {
    const a = fakeAdmin({ individual_scholar_question: [] }, {
      failInsert: (_t, r) => (r.answer ? { code: "23514", message: "new row violates check constraint \"individual_scholar_question_options_check\"" } : null),
    });
    const r = await insertQuestions(a, "u1", { passage, kind: "mcq", drafts: [mcqDraft], model: "m", provider: "p", promptVersion: "v" });
    expect(r.ok).toBe(true);
    expect(a.calls.filter(c => c.op === "insert").map(c => "answer" in c.rows![0])).toEqual([true, false]);
    expect(await sqieSchema(a, "u1")).toBe(false);
  });

  it("a structured question refused by the schema marks 710 absent, and no library copy is attempted without it", async () => {
    const a = fakeAdmin({ individual_scholar_question: [] }, { failInsert: () => ({ code: "23514", message: "violates check constraint individual_scholar_question_kind_check" }) });
    const r = await insertRevisionQuestions(a, "u1", { passage, kind: "structured", drafts: [{ stem: "s", options: [], answer: { parts: [] }, rationale: "r", sourceQuote: quote, difficulty: 2 }], model: "m", provider: "p", promptVersion: "v" });
    expect(r).toMatchObject({ ok: false, notProvisioned: true });
    expect(await sqieSchema(a, "u1")).toBe(false);
    const lib = await insertLibraryCopies(a, "u1", [{ question: libQ(), chunkId: "c1", competencyId: "k1" }]);
    expect(lib).toEqual({ ok: false, ids: [], copied: 0 });
    markSqieAbsent();
  });
});

// ── C: the governed library ──
const libQ = (over: Partial<LibraryQuestion> = {}): LibraryQuestion => ({
  versionId: "v1", resourceId: "r1", versionNo: 1, title: "Gas exchange", stem: "Where does gas exchange happen?", options: ["alveoli", "trachea", "bronchi", "bronchioles"],
  correctIndex: 0, rationale: "Bronchioles end in alveoli.", competencyIds: ["k1"], publishedAt: "2026-10-01", ...over,
});

describe("library reuse: which governed questions a section is offered, in what order", () => {
  it("only items teaching an accepted competency of the section and naming its topic; most topics named, then newest", () => {
    const qs = [
      libQ({ versionId: "old", resourceId: "ra", publishedAt: "2026-09-01" }),
      libQ({ versionId: "new", resourceId: "rb", publishedAt: "2026-10-20" }),
      libQ({ versionId: "both", resourceId: "rc", title: "Gas exchange in the alveoli", publishedAt: "2026-08-01" }),
      libQ({ versionId: "offtopic", resourceId: "rd", title: "Hand hygiene", stem: "When are hands washed?" }),
      libQ({ versionId: "othercomp", resourceId: "re", competencyIds: ["k9"] }),
    ];
    const picks = pickLibraryQuestions({ questions: qs, sections: [{ chunkId: "c1", competencyIds: ["k1"], topics: ["gas exchange", "alveoli"] }], exclude: new Set(), limit: 10 });
    expect(picks.map(p => p.question.versionId)).toEqual(["both", "new", "old"]);
    expect(picks[0]).toMatchObject({ chunkId: "c1", competencyId: "k1" });
  });

  it("never more than asked, one per resource, none already held, none for a section with no accepted competency", () => {
    const qs = [libQ({ versionId: "a" }), libQ({ versionId: "b" }), libQ({ versionId: "c", resourceId: "r2" }), libQ({ versionId: "d", resourceId: "r3" })];
    const s = [{ chunkId: "c1", competencyIds: ["k1"], topics: [] }];
    expect(pickLibraryQuestions({ questions: qs, sections: s, exclude: new Set(), limit: 2 })).toHaveLength(2);
    expect(pickLibraryQuestions({ questions: qs, sections: s, exclude: new Set(["c"]), limit: 9 }).map(p => p.question.resourceId).sort()).toEqual(["r1", "r3"]);
    expect(pickLibraryQuestions({ questions: qs, sections: [{ chunkId: "c1", competencyIds: [], topics: [] }], exclude: new Set(), limit: 9 })).toEqual([]);
    expect(pickLibraryQuestions({ questions: qs, sections: s, exclude: new Set(), limit: 0 })).toEqual([]);
    expect(namesTopic("Oxygen therapy for adults", "oxygen therapy")).toBe(true);
    expect(namesTopic("Therapy with oxygen", "oxygen therapy")).toBe(true);
    expect(namesTopic("Gas exchange", "oxygen therapy")).toBe(false);
  });

  it("reads only PUBLISHED versions of ACTIVE revision_question resources whose exact content is clinically approved", async () => {
    const content = { stem: "Where does gas exchange happen?", options: ["alveoli", "trachea", "bronchi", "bronchioles"], correct_index: 0, rationale: "Bronchioles end in alveoli." };
    const a = fakeAdmin({
      ckri_knowledge_version_competency: ["pub", "draft", "submitted", "retired-res", "unapproved", "explanation", "bad"].map(v => ({ version_id: v, competency_id: "k1" })),
      ckri_knowledge_version: [
        { id: "pub", resource_id: "r1", version_no: 2, content, state: "published", published_at: "2026-10-01" },
        { id: "draft", resource_id: "r1", version_no: 3, content, state: "draft", published_at: null },
        { id: "submitted", resource_id: "r1", version_no: 4, content, state: "submitted", published_at: null },
        { id: "retired-res", resource_id: "r2", version_no: 1, content, state: "published", published_at: "2026-10-01" },
        { id: "unapproved", resource_id: "r3", version_no: 1, content, state: "published", published_at: "2026-10-01" },
        { id: "explanation", resource_id: "r4", version_no: 1, content: { body: "x".repeat(40) }, state: "published", published_at: "2026-10-01" },
        { id: "bad", resource_id: "r5", version_no: 1, content: { ...content, options: ["a"] }, state: "published", published_at: "2026-10-01" },
      ],
      ckri_knowledge_resource: [
        { id: "r1", kind: "revision_question", title: "Gas exchange", status: "active" },
        { id: "r2", kind: "revision_question", title: "Retired", status: "retired" },
        { id: "r3", kind: "revision_question", title: "Not approved", status: "active" },
        { id: "r4", kind: "explanation", title: "An explanation", status: "active" },
        { id: "r5", kind: "revision_question", title: "Malformed", status: "active" },
      ],
    }, { rpc: (_n, args) => args.p_version !== "unapproved" });
    const got = await loadLibraryQuestions(a, ["k1"]);
    expect(got.map(q => q.versionId)).toEqual(["pub"]);
    expect(got[0]).toMatchObject({ resourceId: "r1", versionNo: 2, correctIndex: 0, competencyIds: ["k1"] });
    expect(await loadLibraryQuestions(a, [])).toEqual([]);
    expect(libraryContent({ stem: "s", options: ["a", "b", "c", "d"], correct_index: 4, rationale: "r" })).toBeNull();
  });

  it("SQIE-LIBRARY-EXPANSION-01: offers every format, never a retired version (801), and carries the exact learner copy", async () => {
    const mrq = { format: "mrq", stem: "Which happen in the alveoli? Choose all.", options: ["Gas exchange", "Surfactant release", "Digestion", "Filtration"], answerKey: { correct: [0, 1] }, marking: "deterministic", rationale: "Alveoli exchange gas and release surfactant." };
    const legacy = { stem: "Where does gas exchange happen?", options: ["alveoli", "trachea", "bronchi", "bronchioles"], correct_index: 0, rationale: "Bronchioles end in alveoli." };
    const a = fakeAdmin({
      ckri_knowledge_version_competency: ["live-mrq", "retired-v1", "live-v2"].map(v => ({ version_id: v, competency_id: "k1" })),
      ckri_knowledge_version: [
        { id: "live-mrq", resource_id: "r1", version_no: 1, content: mrq, state: "published", published_at: "2026-10-01" },
        { id: "retired-v1", resource_id: "r2", version_no: 1, content: legacy, state: "retired", published_at: "2026-09-01" },
        { id: "live-v2", resource_id: "r2", version_no: 2, content: legacy, state: "published", published_at: "2026-10-02" },
      ],
      ckri_knowledge_resource: [{ id: "r1", kind: "revision_question", title: "Alveoli", status: "active" }, { id: "r2", kind: "revision_question", title: "Gas exchange", status: "active" }],
    }, { rpc: () => true });
    const got = await loadLibraryQuestions(a, ["k1"]);
    expect(got.map(q => q.versionId).sort()).toEqual(["live-mrq", "live-v2"]);
    expect(got.find(q => q.versionId === "live-mrq")?.copy).toMatchObject({ kind: "mrq", correctIndex: null, answer: { correct: [0, 1], marking: "deterministic" } });
    expect(got.find(q => q.versionId === "live-v2")?.copy).toMatchObject({ kind: "mcq", correctIndex: 0, answer: null });
  });

  it("a learner copy names its provenance, is labelled as the library's, and cites no quote from the notes", async () => {
    resetSqieSchema();
    const a = fakeAdmin({ individual_scholar_question: [], individual_scholar_chunk: [{ id: "c1", user_id: "u1", material_id: "m1" }] });
    const r = await insertLibraryCopies(a, "u1", [{ question: libQ(), chunkId: "c1", competencyId: "k1" }]);
    expect(r).toMatchObject({ ok: true, copied: 1 });
    const stored = a.tables.individual_scholar_question[0];
    expect(stored).toMatchObject({ kind: "mcq", review_status: "library_approved", library_version_id: "v1", library_resource_id: "r1", model: "competen-library", source_quote: "", competency_id: "k1", user_id: "u1" });
    // Asked again, the copy already held is reused, not written twice.
    const again = await insertLibraryCopies(a, "u1", [{ question: libQ(), chunkId: "c1", competencyId: "k1" }]);
    expect(again).toMatchObject({ ok: true, copied: 0, ids: [stored.id] });
    const q = row({ id: stored.id, kind: "mcq", stem: stored.stem, options: stored.options, correctIndex: 0, answer: null, rationale: stored.rationale, difficulty: null },
      { sourceQuote: "", library: { resourceId: "r1", versionId: "v1", versionNo: 1, approval: "clinically_approved" } });
    const v = revisionItemView(q);
    expect(v.grounding).toBe(LIBRARY_QUESTION_LABEL);
    expect(v.library).toEqual({ resourceId: "r1", versionId: "v1", versionNo: 1, approval: "clinically_approved" });
    expect(v.citation).toBe("Competen library, version 1");
    const f = feedbackView(q, { correct: true, score: 1, marking: "deterministic" });
    expect(f.source.quote).toBe("");
    expect(f.library?.label).toBe(LIBRARY_QUESTION_LABEL);
  });

  it("a stored copy whose version is no longer published and approved is not offered", async () => {
    resetSqieSchema();
    const base = { user_id: "u1", material_id: "m1", chunk_id: "c1", kind: "mcq", stem: "Where?", options: ["a", "b", "c", "d"], correct_index: 0, rationale: "r", source_quote: "", model: "competen-library", prompt_version: "library:v1", created_at: "2026-10-30" };
    const a = fakeAdmin({
      individual_scholar_question: [
        { ...base, id: "own", model: "m", library_version_id: null, library_resource_id: null },
        { ...base, id: "live", library_version_id: "v-live", library_resource_id: "r1" },
        { ...base, id: "gone", library_version_id: "v-gone", library_resource_id: "r1" },
      ],
      ckri_knowledge_version: [{ id: "v-live", resource_id: "r1", version_no: 1, state: "published" }, { id: "v-gone", resource_id: "r1", version_no: 2, state: "superseded" }],
      ckri_knowledge_resource: [{ id: "r1", kind: "revision_question", status: "active" }],
    }, { rpc: () => true });
    const pool = await revisionPool(a, "u1", { kinds: ["mcq"] });
    expect(pool.ok && pool.data.questions.map(q => q.id).sort()).toEqual(["live", "own"]);
    expect(pool.ok && pool.data.questions.find(q => q.id === "live")?.library?.versionNo).toBe(1);
  });
});
