import { describe, expect, it } from "vitest";
import { PAPER_PARSER, isCurrentParser, judgeLegacyPaper, linesFromChunks, parsePaper, revisionFront, type LegacyRow } from "./exam-paper";
import { judgeOpenedPaper } from "./exam-service";
import type { ExamQuestionRow } from "./exam-store";
import type { IndividualContext } from "../guard";

// SCHOLAR-SQIE-CLOSE-01 P0: a paper kept by paper-parser-v1 is judged again with today's rules when it is opened, in the
// response only. Its paper, question and answer rows are never written; a redirect is recorded as a codes-only audit.

const V1 = "paper-parser-v1";
const NOTES = [
  "Urinary tract infections",
  "1. Pyelonephritis (kidney infection): This infection spreads from the bladder to one or both kidneys.",
  "2. Cystitis (bladder infection): The most common lower urinary tract infection.",
  "3. Urethritis: Inflammation of the urethra, often sexually transmitted.",
  "4. Risk factors include female anatomy, catheters and diabetes.",
].join("\n");
const PAPER = [
  "1. Describe the pathophysiology of pyelonephritis. (5 marks)",
  "2. Which organism most commonly causes cystitis?",
  "3. List three risk factors for urinary tract infection.",
].join("\n");
const MIXED = [
  "1. Pyelonephritis (kidney infection): This infection spreads from the bladder to one or both kidneys.",
  "2. Explain why catheters raise the risk of infection.",
  "3. Cystitis (bladder infection): The most common lower urinary tract infection.",
  "4. Which antibiotic is first line for uncomplicated cystitis?",
].join("\n");

/** What v1 stored: every numbered item (v2 is the same reader with the statement filter, so: its items, all kept). */
function v1Rows(text: string, materialId = "m1"): ExamQuestionRow[] {
  const lines = linesFromChunks([{ id: "c1", content: text, pageFrom: 1 }]);
  return text.split("\n").flatMap(l => {
    const m = /^(\d+)\.\s*(.*)$/.exec(l);
    if (!m) return [];
    const marks = /\((\d+) marks\)/.exec(m[2]);
    return [{
      id: `q${m[1]}`, materialId, ordinal: Number(m[1]), number: m[1], section: null, instructions: null, stem: m[2].replace(/\s*\(\d+ marks\)/, ""),
      options: [], marks: marks ? Number(marks[1]) : null, pageFrom: 1, pageTo: 1, chunkId: lines[0]?.chunkId ?? null, source: "text_layer" as const, flags: [],
    }];
  });
}

/** A recording admin: chunk reads answer `text`; every table touched and every write is logged. */
function fakeAdmin(text: string | null) {
  const log: string[] = [];
  const audits: Record<string, unknown>[] = [];
  const admin = {
    from(table: string) {
      log.push(`from:${table}`);
      const q: Record<string, unknown> = {};
      const chain = (name: string) => () => { log.push(`${table}.${name}`); return q; };
      for (const m of ["select", "eq", "order", "in", "maybeSingle"]) q[m] = chain(m);
      q.limit = async () => (table === "individual_scholar_chunk"
        ? text === null ? { data: null, error: { code: "XX000", message: "down" } } : { data: [{ id: "c1", ordinal: 1, page_from: 1, page_to: 1, content: text }], error: null }
        : { data: [], error: null });
      for (const w of ["update", "delete", "upsert"]) q[w] = () => { log.push(`WRITE:${table}.${w}`); return q; };
      q.insert = (row: Record<string, unknown>) => { log.push(`WRITE:${table}.insert`); if (table === "audit_log") audits.push(row); return Promise.resolve({ error: null }); };
      return q;
    },
  };
  const ctx = { admin, userId: "u1", profile: { fullName: "Student" } } as unknown as IndividualContext;
  return { ctx, log, audits };
}
const writes = (log: string[]) => log.filter(l => l.startsWith("WRITE:"));

describe("judgeLegacyPaper (pure)", () => {
  it("the current parser is not judged again; an earlier one is", () => {
    expect(isCurrentParser(PAPER_PARSER)).toBe(true);
    expect(isCurrentParser(`${PAPER_PARSER}+ai-transcription`)).toBe(true);
    expect(isCurrentParser(V1)).toBe(false);
    expect(isCurrentParser(`${V1}+ai-transcription`)).toBe(false);
  });
  it("a v1 paper of numbered statements: notes-like, every row a statement, judged from the material text", () => {
    const j = judgeLegacyPaper({ extractor: V1, instructions: "Urinary tract infections" }, v1Rows(NOTES), parsePaper(linesFromChunks([{ id: "c1", content: NOTES, pageFrom: 1 }])));
    expect(j).toEqual({ notesLike: true, statementIds: ["q1", "q2", "q3", "q4"], statements: 4, questions: 0, basis: "material_text" });
  });
  it("the same paper with its text unreadable is judged from the stored rows, to the same verdict", () => {
    const j = judgeLegacyPaper({ extractor: V1, instructions: "Urinary tract infections" }, v1Rows(NOTES), null);
    expect(j).toMatchObject({ notesLike: true, statements: 4, questions: 0, basis: "stored_questions" });
  });
  it("a v1 paper of real questions: nothing hidden", () => {
    const j = judgeLegacyPaper({ extractor: V1, instructions: null }, v1Rows(PAPER), parsePaper(linesFromChunks([{ id: "c1", content: PAPER, pageFrom: 1 }])));
    expect(j).toMatchObject({ notesLike: false, statementIds: [], statements: 0, questions: 3 });
  });
  it("mixed: only the statements are set apart; the real questions stay questions", () => {
    const j = judgeLegacyPaper({ extractor: V1, instructions: null }, v1Rows(MIXED), parsePaper(linesFromChunks([{ id: "c1", content: MIXED, pageFrom: 1 }])));
    expect(j).toMatchObject({ notesLike: false, statementIds: ["q1", "q3"], statements: 2, questions: 2 });
  });
  it("fewer than three statements and no real question is still notes, never an empty paper", () => {
    const two = v1Rows(NOTES).slice(0, 2);
    expect(judgeLegacyPaper({ extractor: V1, instructions: null }, two, null)).toMatchObject({ notesLike: true, statements: 2, questions: 0 });
  });
  it("the material text sees what the rows lost: a paper's 'Answer all questions' makes its numbered lines questions", () => {
    const text = ["Answer ALL questions", ...NOTES.split("\n").slice(1)].join("\n");
    const j = judgeLegacyPaper({ extractor: V1, instructions: "Answer ALL questions" }, v1Rows(text), parsePaper(linesFromChunks([{ id: "c1", content: text, pageFrom: 1 }])));
    expect(j).toMatchObject({ notesLike: false, statements: 0 });
  });
  it("an AI-transcribed paper is judged from its rows: its transcribed lines were never kept as text", () => {
    const rows = v1Rows(MIXED).map(r => ({ ...r, source: "ai_transcription" as const }));
    const decoy = parsePaper(linesFromChunks([{ id: "c1", content: PAPER, pageFrom: 1 }])); // would call every row a question
    expect(judgeLegacyPaper({ extractor: `${V1}+ai-transcription`, instructions: null }, rows, decoy)).toMatchObject({ statementIds: ["q1", "q3"], basis: "stored_questions" });
  });
  it("a part of a question that asks, and the lead-in of parts that ask, are questions (stored-row basis)", () => {
    const rows: LegacyRow[] = [
      { id: "a", number: "1", section: null, instructions: null, stem: "A 60-year-old has a fever and loin pain.", options: [], marks: null, flags: [{ kind: "lead_in" }] },
      { id: "b", number: "1(a)", section: null, instructions: null, stem: "What is the likely diagnosis?", options: [], marks: null, flags: [] },
      { id: "c", number: "1(a)(i)", section: null, instructions: null, stem: "at rest", options: [], marks: null, flags: [] },
    ];
    expect(judgeLegacyPaper({ extractor: V1, instructions: null }, rows, null)).toMatchObject({ statements: 0, questions: 3 });
  });
  it("a statement is still never a revision card front (revisionFront guard kept)", () => {
    const [row] = v1Rows(NOTES);
    expect(revisionFront(row, null)).toBeNull();
  });
});

describe("judgeOpenedPaper: read-only, audited by codes", () => {
  it("v1 numbered statements: redirected, nothing written but one codes-only audit", async () => {
    const { ctx, log, audits } = fakeAdmin(NOTES);
    const j = await judgeOpenedPaper(ctx, { materialId: "m1", extractor: V1, instructions: "Urinary tract infections" }, v1Rows(NOTES));
    expect(j?.notesLike).toBe(true);
    expect(writes(log)).toEqual(["WRITE:audit_log.insert"]);
    expect(log.filter(l => l.startsWith("from:"))).toEqual(["from:individual_scholar_chunk", "from:audit_log"]);
    expect(audits[0]).toMatchObject({ action: "individual_scholar_exam_paper_legacy_redirected", entity_type: "individual_scholar_exam_paper", entity_id: "m1" });
    expect(audits[0].new_value).toEqual({ outcome: "notes_like", statements: 4, questions: 0, parser: V1, judged_with: PAPER_PARSER, basis: "material_text" });
    // Codes and counts only: no stem, no material text.
    expect(JSON.stringify(audits[0].new_value)).not.toMatch(/Pyelonephritis|bladder/);
  });
  it("v1 real questions: shown normally, nothing written, nothing audited", async () => {
    const { ctx, log } = fakeAdmin(PAPER);
    const j = await judgeOpenedPaper(ctx, { materialId: "m1", extractor: V1, instructions: null }, v1Rows(PAPER));
    expect(j).toMatchObject({ notesLike: false, statementIds: [] });
    expect(writes(log)).toEqual([]);
  });
  it("mixed: only the real questions remain questions; the redirect is audited as statements hidden", async () => {
    const { ctx, log, audits } = fakeAdmin(MIXED);
    const j = await judgeOpenedPaper(ctx, { materialId: "m1", extractor: V1, instructions: null }, v1Rows(MIXED));
    expect(j).toMatchObject({ notesLike: false, statementIds: ["q1", "q3"] });
    expect(writes(log)).toEqual(["WRITE:audit_log.insert"]);
    expect(audits[0].new_value).toMatchObject({ outcome: "statements_hidden", statements: 2, questions: 2 });
  });
  it("material text unreadable: judged from the stored rows, still nothing written to the paper", async () => {
    const { ctx, log, audits } = fakeAdmin(null);
    const j = await judgeOpenedPaper(ctx, { materialId: "m1", extractor: V1, instructions: null }, v1Rows(NOTES));
    expect(j).toMatchObject({ notesLike: true, basis: "stored_questions" });
    expect(writes(log)).toEqual(["WRITE:audit_log.insert"]);
    expect(audits).toHaveLength(1);
  });
  it("a current-parser paper is unchanged: no read, no judgement, no write", async () => {
    const { ctx, log } = fakeAdmin(NOTES);
    expect(await judgeOpenedPaper(ctx, { materialId: "m1", extractor: PAPER_PARSER, instructions: null }, v1Rows(PAPER))).toBeNull();
    expect(await judgeOpenedPaper(ctx, { materialId: "m1", extractor: `${PAPER_PARSER}+ai-transcription`, instructions: null }, v1Rows(PAPER))).toBeNull();
    expect(log).toEqual([]);
  });
});
