import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  QUESTION_CHANGED_NOTE, SNAPSHOT_TOTAL_MAX_BYTES, applyAssessedSnapshot, buildAttemptSnapshot, contentHashOf, effectiveResult, fitSnapshot, outcomeOf,
  questionChanged, snapshotFromRow, snapshotInsertRow, type CorrectionRow,
} from "./attempt-snapshot";
import { parseCorrection } from "./attempt-integrity";
import { rubricHash } from "./rubric-snapshot";
import { feedbackView, keptAttemptView } from "./revision-view";
import type { QuestionRow } from "./store";

// SCHOLAR-CONTINUITY-01 item 2: what an attempt was assessed against (791), and its corrections. The immutability triggers
// are exercised on staging (VERIFY-791).

const Q = (over: Partial<QuestionRow> = {}): QuestionRow => ({
  id: "11111111-1111-4111-8111-111111111111", materialId: "m1", chunkId: "c1", kind: "mcq", stem: "Where does gas exchange happen?",
  options: ["Trachea", "Bronchi", "Alveoli", "Larynx"], correctIndex: 2, rationale: "Alveoli are where gas exchange happens.", sourceQuote: "Bronchioles end in alveoli",
  model: "m", promptVersion: "v", createdAt: "2026-10-01T00:00:00Z", answer: null, difficulty: 2, materialTitle: "Notes", ordinal: 1, pageFrom: 1, pageTo: 1,
  unit: "page", latest: null, competencyId: "22222222-2222-4222-8222-222222222222", caseId: null, caseStep: null, caseTitle: null, library: null, ...over,
});
const at = { attemptId: "33333333-3333-4333-8333-333333333333", answeredAt: "2026-10-31T10:00:00.000Z" };

describe("the snapshot of a choice attempt (the 416 CHECK is untouched: chosen_index stays on the attempt)", () => {
  const s = buildAttemptSnapshot(Q(), { ...at, chosenIndex: 1, response: null, correct: false, score: null, marking: "deterministic", contentVersion: 3 })!;
  it("keeps the stem, the options in the order shown with their original indexes, the answer and the key", () => {
    expect(s.presented.stem).toBe("Where does gas exchange happen?");
    expect(s.presented.options).toEqual([{ i: 0, text: "Trachea" }, { i: 1, text: "Bronchi" }, { i: 2, text: "Alveoli" }, { i: 3, text: "Larynx" }]);
    expect(s.response).toEqual({ kind: "choice", original: 1, presented: 1 });
    expect(s.answerKey).toMatchObject({ kind: "choice", original: 2, presented: 2, rationale: "Alveoli are where gas exchange happens." });
    expect(s).toMatchObject({ questionVersion: "own:3", outcome: "incorrect", marking: "deterministic", competencyIds: ["22222222-2222-4222-8222-222222222222"], assessedAt: at.answeredAt, rubric: null, rubricHash: null });
  });
  it("a governed library copy is versioned by its pinned library version", () => {
    const lib = buildAttemptSnapshot(Q({ library: { resourceId: "r", versionId: "44444444-4444-4444-8444-444444444444", versionNo: 2, approval: "clinically_approved" } }), { ...at, chosenIndex: 2, response: null, correct: true, score: null, marking: "deterministic" })!;
    expect(lib.questionVersion).toBe("lib:44444444-4444-4444-8444-444444444444");
    expect(lib.questionVersion).toMatch(/^(lib:[0-9a-f-]{36}|own:[0-9]{1,6})$/); // the 791 CHECK
  });
  it("the row the store inserts carries every 791 column but user_id (the store adds the caller's)", () => {
    expect(Object.keys(snapshotInsertRow(s)).sort()).toEqual(["answer_key", "assessed_at", "attempt_id", "competency_ids", "content_hash", "feedback", "marking", "outcome", "presented", "question_id", "question_version", "response", "rubric", "rubric_hash", "score"]);
    expect(snapshotFromRow({ ...snapshotInsertRow(s), user_id: "u" })).toEqual(s);
  });
});

describe("a shuffled order is reconstructable", () => {
  const match = Q({ kind: "match", options: ["trachea", "bronchioles", "alveoli"], correctIndex: null, answer: { matches: ["divides into main bronchi", "end in alveoli", "gas exchange"] } });
  const s = buildAttemptSnapshot(match, { ...at, chosenIndex: null, response: { kind: "matches", matches: ["gas exchange", "end in alveoli", "divides into main bronchi"] }, correct: false, score: 0, marking: "deterministic" })!;
  it("the choices are kept in the order shown, each with its index in the key", () => {
    expect(s.presented.choices!.map(c => c.text).sort()).toEqual([...(match.answer as { matches: string[] }).matches].sort());
    for (const c of s.presented.choices!) expect((match.answer as { matches: string[] }).matches[c.i]).toBe(c.text);
  });
  it("the stored answer, without its rubric or feedback copies", () => {
    expect(s.response).toEqual({ kind: "matches", matches: ["gas exchange", "end in alveoli", "divides into main bronchi"] });
  });
});

describe("the hashes", () => {
  it("the same content hashes the same, any change does not", () => {
    expect(contentHashOf(Q())).toBe(contentHashOf(Q({ materialTitle: "renamed", latest: { correct: true, chosenIndex: 2, answeredAt: "x" } })));
    expect(contentHashOf(Q())).not.toBe(contentHashOf(Q({ options: ["Trachea", "Bronchi", "Alveolus", "Larynx"] })));
    expect(contentHashOf(Q())).not.toBe(contentHashOf(Q({ rationale: "changed" })));
    expect(contentHashOf(Q())).toMatch(/^[0-9a-f]{16}$/);
  });
  it("the rubric hash is rubric-snapshot.ts's own (the 416 snapshot hash)", () => {
    const short = Q({ kind: "short", options: [], correctIndex: null, answer: { accepted: ["alveoli"], rubric: { keyPoints: ["alveoli"] } } });
    const s = buildAttemptSnapshot(short, { ...at, chosenIndex: null, response: { kind: "text", text: "the alveoli", rubric: { v: 1, hash: "x" }, formative: { v: 1, items: [] } }, correct: true, score: 1, marking: "deterministic" })!;
    expect(s.rubricHash).toBe(rubricHash(short.answer));
    expect(s.rubric?.hash).toBe(rubricHash(short.answer));
    expect(s.response).toEqual({ kind: "text", text: "the alveoli" });
    expect(s.feedback).toEqual({ v: 1, items: [] });
  });
});

describe("the size bound (791 CHECK, 16384 bytes)", () => {
  it("a huge answer is cut back in order, never dropped while it can fit", () => {
    const long = Q({ kind: "short", options: [], correctIndex: null, answer: { accepted: ["a"] }, rationale: "r".repeat(2000), stem: "s".repeat(2000) });
    const s = buildAttemptSnapshot(long, { ...at, chosenIndex: null, response: { kind: "text", text: "é".repeat(4000), formative: { v: 1, text: "f".repeat(9000) } }, correct: false, score: 0, marking: "ai_evaluation" })!;
    expect(s).not.toBeNull();
    const total = ["presented", "response", "answerKey", "rubric", "feedback"].reduce((n, k) => n + new TextEncoder().encode(JSON.stringify((s as Record<string, unknown>)[k] ?? null)).length, 0);
    expect(total).toBeLessThanOrEqual(SNAPSHOT_TOTAL_MAX_BYTES);
    expect(s.feedback).toBeNull(); // the feedback goes first
  });
  it("fitSnapshot leaves a small one alone", () => {
    const s = buildAttemptSnapshot(Q(), { ...at, chosenIndex: 0, response: null, correct: false, score: null, marking: "deterministic" })!;
    expect(fitSnapshot(s)).toEqual(s);
  });
});

describe("the result: original, corrections, effective", () => {
  const c = (over: Partial<CorrectionRow>): CorrectionRow => ({ id: "a", attemptId: at.attemptId, previousScore: null, previousOutcome: "incorrect", correctedScore: 1, correctedOutcome: "correct", reason: "The key named the wrong option.", basis: "key_error", correctedByKind: "hq_actor", createdAt: "2026-11-01T00:00:00Z", ...over });
  it("outcome words follow the 791 trigger's rule", () => {
    expect([outcomeOf(true, null), outcomeOf(false, 0.4), outcomeOf(false, 0), outcomeOf(false, null)]).toEqual(["correct", "partial", "incorrect", "incorrect"]);
  });
  it("the latest correction is the effective result; with none, the original", () => {
    const original = { score: 0, outcome: "incorrect" as const };
    expect(effectiveResult(original, [])).toMatchObject({ outcome: "incorrect", correct: false, corrected: null });
    const later = c({ id: "b", correctedOutcome: "partial", correctedScore: 0.5, createdAt: "2026-11-02T00:00:00Z" });
    expect(effectiveResult(original, [later, c({})])).toMatchObject({ outcome: "partial", score: 0.5, correct: false, corrected: later });
  });
  it("a correction request is bounded: reason 10..500, a known basis and outcome, score 0..1", () => {
    expect(parseCorrection({ correctedScore: 1, correctedOutcome: "correct", reason: "  The key was   wrong here. ", basis: "key_error" })).toEqual({ ok: true, value: { correctedScore: 1, correctedOutcome: "correct", reason: "The key was wrong here.", basis: "key_error" } });
    expect(parseCorrection({ correctedScore: 1, correctedOutcome: "correct", reason: "short", basis: "key_error" })).toEqual({ ok: false, error: "reason" });
    expect(parseCorrection({ correctedScore: 2, correctedOutcome: "correct", reason: "long enough reason", basis: "key_error" })).toEqual({ ok: false, error: "score" });
    expect(parseCorrection({ correctedScore: null, correctedOutcome: "right", reason: "long enough reason", basis: "key_error" })).toEqual({ ok: false, error: "outcome" });
    expect(parseCorrection({ correctedScore: null, correctedOutcome: "correct", reason: "long enough reason", basis: "typo" })).toEqual({ ok: false, error: "basis" });
  });
});

describe("feedback shown again prefers the snapshot", () => {
  const answered = Q();
  const snap = buildAttemptSnapshot(answered, { ...at, chosenIndex: 1, response: null, correct: false, score: null, marking: "deterministic" })!;
  const edited = Q({ stem: "Where is gas exchanged?", options: ["Alveoli", "Bronchi", "Trachea", "Larynx"], correctIndex: 0 });
  it("an unchanged question reads as it is, with no note", () => {
    const f = feedbackView(answered, { correct: false, score: null, marking: "deterministic", ...keptAttemptView(answered, { marking: "deterministic", integrity: { snapshot: snap, corrections: [] } }) });
    expect(f.questionChanged).toBeUndefined();
    expect(f.key).toEqual({ index: 2 });
  });
  it("a changed question is shown as answered, with the note, and its key at the time", () => {
    expect(questionChanged(edited, snap)).toBe(true);
    const f = feedbackView(edited, { correct: false, score: null, marking: "deterministic", ...keptAttemptView(edited, { marking: "deterministic", integrity: { snapshot: snap, corrections: [] } }) });
    expect(f.questionChanged).toEqual({ note: QUESTION_CHANGED_NOTE, asAnswered: { stem: "Where does gas exchange happen?", options: ["Trachea", "Bronchi", "Alveoli", "Larynx"] } });
    expect(f.key).toEqual({ index: 2 });
    expect(f.answer).toBe("Alveoli");
    expect(applyAssessedSnapshot(edited, snap)).not.toBe(edited); // a copy; the live row is not changed
    expect(edited.stem).toBe("Where is gas exchanged?");
  });
  it("a corrected result shows the effective result, each correction with its reason, and the original", () => {
    const corr: CorrectionRow = { id: "a", attemptId: at.attemptId, previousScore: null, previousOutcome: "incorrect", correctedScore: 1, correctedOutcome: "correct", reason: "Two options were both right.", basis: "key_error", correctedByKind: "hq_actor", createdAt: "2026-11-01T00:00:00Z" };
    const f = feedbackView(answered, { correct: false, score: null, marking: "deterministic", ...keptAttemptView(answered, { marking: "deterministic", integrity: { snapshot: snap, corrections: [corr] } }) });
    expect(f.correct).toBe(true);
    expect(f.corrections).toEqual({ original: { correct: false, score: null, outcome: "incorrect" }, entries: [{ at: "2026-11-01T00:00:00Z", reason: "Two options were both right.", basis: "The answer key was wrong", from: "incorrect", to: "correct" }] });
  });
  it("no snapshot (791 absent, or an older attempt): exactly the feedback it always was", () => {
    const plain = feedbackView(edited, { correct: false, score: null, marking: "deterministic" });
    const kept = feedbackView(edited, { correct: false, score: null, marking: "deterministic", ...keptAttemptView(edited, { marking: "deterministic" }) });
    expect(kept).toEqual(plain);
  });
});

describe("the wiring", () => {
  const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
  it("every answer route keeps the snapshot after the attempt is stored, and never fails the answer on it", () => {
    const mcq = read("src/app/api/individual/scholar/attempts/route.ts");
    expect(mcq.indexOf("await keepAttemptSnapshot(ctx, q,")).toBeGreaterThan(mcq.indexOf("if (!r.ok) return"));
    const rev = read("src/app/api/individual/scholar/revision/answer/route.ts");
    expect(rev.match(/await keepAttemptSnapshot\(ctx, q, \{ attempt: saved\.attempt,/g)?.length).toBe(2);
    const integrity = read("src/lib/individual/scholar/attempt-integrity.ts");
    expect(integrity).toContain('if (r === "failed") await auditRow(ctx.admin, actor, SNAPSHOT_FAILED_ACTION');
  });
  it("the three places feedback is shown again read the snapshot and corrections", () => {
    expect(read("src/app/api/individual/scholar/revision/sessions/[id]/route.ts")).toContain("getRevisionSession(ctx.admin, ctx.userId, id, { integrity: true })");
    expect(read("src/app/individual/(app)/[experience]/(scholar)/study/revise/page.tsx")).toContain("getRevisionSession(ctx.admin, ctx.userId, q.session, { integrity: true })");
    expect(read("src/lib/individual/scholar/adaptive-service.ts")).toContain("getRevisionSession(admin, userId, sessionId, { integrity: true })");
  });
  it("the 416 CHECK is not touched by 791", () => {
    expect(read("supabase/migrations/791-individual-scholar-attempt-snapshots.sql")).not.toMatch(/alter table individual_scholar_attempt\b/);
  });
});
