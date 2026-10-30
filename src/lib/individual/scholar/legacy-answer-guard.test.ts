import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamQuestionRow } from "./exam-store";
import type { IndividualContext } from "../guard";

// SCHOLAR-SQIE-CLOSE-01 P0, the answer route: a statement kept by an earlier parser is never answered, even when the
// answer endpoint is called directly. Read-only; an unreadable paper is refused, never answered as a question.

const reads = vi.hoisted(() => ({ paper: null as unknown, questions: null as unknown, chunks: null as unknown }));
vi.mock("./exam-store", async orig => ({ ...(await orig<typeof import("./exam-store")>()), getExamPaper: async () => reads.paper, listExamQuestions: async () => reads.questions }));
vi.mock("./store", async orig => ({ ...(await orig<typeof import("./store")>()), listChunks: async () => reads.chunks }));
const { legacyStatementRefusal } = await import("./exam-service");
const { PAPER_PARSER, NOTES_VERDICT } = await import("./exam-paper");

const MIXED = [
  "1. Pyelonephritis (kidney infection): This infection spreads from the bladder to one or both kidneys.",
  "2. Explain why catheters raise the risk of infection.",
].join("\n");
const row = (n: number, stem: string): ExamQuestionRow => ({
  id: `q${n}`, materialId: "m1", ordinal: n, number: String(n), section: null, instructions: null, stem, options: [], marks: null,
  pageFrom: 1, pageTo: 1, chunkId: "c1", source: "text_layer", flags: [],
});
const ROWS = [row(1, "Pyelonephritis (kidney infection): This infection spreads from the bladder to one or both kidneys."), row(2, "Explain why catheters raise the risk of infection.")];
const ctx = { admin: {}, userId: "u1" } as unknown as IndividualContext;
const paper = (extractor: string) => ({ ok: true, data: { materialId: "m1", extractor, instructions: null } });

beforeEach(() => {
  reads.paper = paper("paper-parser-v1");
  reads.questions = { ok: true, data: ROWS };
  reads.chunks = { ok: true, data: [{ id: "c1", content: MIXED, pageFrom: 1 }] };
});

describe("legacyStatementRefusal", () => {
  it("refuses a v1 statement with the notes verdict (409)", async () => {
    const r = await legacyStatementRefusal(ctx, ROWS[0]);
    expect(r?.status).toBe(409);
    expect(r?.body).toMatchObject({ error: NOTES_VERDICT, notesLike: true, materialId: "m1" });
  });
  it("lets a real question on the same v1 paper through", async () => {
    expect(await legacyStatementRefusal(ctx, ROWS[1])).toBeNull();
  });
  it("leaves current-parser papers alone", async () => {
    reads.paper = paper(PAPER_PARSER);
    expect(await legacyStatementRefusal(ctx, ROWS[0])).toBeNull();
  });
  it("fails closed when the paper or its questions cannot be read", async () => {
    reads.paper = { ok: false };
    expect((await legacyStatementRefusal(ctx, ROWS[1]))?.status).toBe(503);
    reads.paper = paper("paper-parser-v1");
    reads.questions = { ok: false };
    expect((await legacyStatementRefusal(ctx, ROWS[1]))?.status).toBe(503);
  });
  it("still judges from the stored rows when the material text is unreadable", async () => {
    reads.chunks = { ok: false };
    expect((await legacyStatementRefusal(ctx, ROWS[0]))?.status).toBe(409);
  });
});

describe("answerQuestion is wired to the guard", () => {
  it("refuses before the question text is built or any AI runs", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./exam-service.ts", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("export async function answerQuestion"), src.indexOf("export async function followUp"));
    const guard = body.indexOf("legacyStatementRefusal(ctx, q)"), text = body.indexOf("questionWithContext(ctx, q)"), ai = body.indexOf("scholarAiRunner(");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(text);
    expect(guard).toBeLessThan(ai);
  });
});
