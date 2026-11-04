/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from "vitest";
import { buildAttemptSnapshot, provenanceOf, snapshotFromRow, snapshotInsertRow, snapshotOutcomeOf, SNAPSHOT_TOTAL_MAX_BYTES } from "./attempt-snapshot";
import { checkResponse, asFeedbackParts } from "./learn-check-record";
import { compactSnapshot, rubricHash, rubricSnapshotOf, snapshotOf, withRubricSnapshot, SNAPSHOT_COMPACT_BYTES, SNAPSHOT_MAX_BYTES } from "./rubric-snapshot";
import { formativeFeedback, withFormative, RESPONSE_BUDGET } from "./written-feedback";
import { readProgress, signProgress, tokenKey, TOKEN_MAX_CHARS, type StageResult } from "./scenario";
import { insertAttemptSnapshot, resetContinuitySchema, snapshotProvenanceAbsent, type QuestionRow } from "./store";

// SQIE-CLOSE-2026-11 WS-D (SQIE-04, SQIE-07, SQIE-08): attempt-record completeness. A kept understanding check keeps a 791
// snapshot, a snapshot pins what its competency said (990), a scenario keeps its five-part feedback per stage, and a normal
// rubric survives whole. The 990 CHECK itself is exercised on staging (docs/evidence/SQIE-WS-D/VERIFY-990.sql).

const COMP = "22222222-2222-4222-8222-222222222222", FW = "55555555-5555-4555-8555-555555555555";
const at = { attemptId: "33333333-3333-4333-8333-333333333333", answeredAt: "2026-11-04T10:00:00.000Z" };
const points = ["Retained urine lets bacteria multiply in the bladder", "An indwelling catheter is a route for infection", "Early mobilisation helps the bladder empty"];
/** A check question exactly as store.ts ensureCheckQuestion writes one with three key points (the extended format). */
const checkQ = (over: Partial<QuestionRow> = {}): QuestionRow => ({
  id: "11111111-1111-4111-8111-111111111111", materialId: "m1", chunkId: "c1", kind: "short", stem: "Why does urinary retention raise infection risk?",
  options: [], correctIndex: null, rationale: points.join(" "), sourceQuote: "Urinary retention raises the risk.", model: "m", promptVersion: "v", createdAt: "2026-11-04T09:00:00Z",
  answer: { format: "extended", accepted: [points.join(" ")], modelAnswer: points.join(" "), marks: 3, partialCredit: { rule: "per_key_point", marksPerPoint: 1 }, rubric: { keyPoints: points }, check: { source: "lesson" } },
  difficulty: 2, materialTitle: "Notes", ordinal: 1, pageFrom: 1, pageTo: 1, unit: "page", latest: null, competencyId: COMP, caseId: null, caseStep: null, caseTitle: null, library: null, ...over,
});
const fb = { right: ["names bacterial growth"], missing: ["the catheter route"], misconceptions: [], keyPoints: points, next: "Say how a catheter adds risk." };
const evaluator = { model: "claude-sonnet-4-6", promptVersion: "evaluate:v4" };

describe("SQIE-08: a kept understanding check keeps its 791 snapshot", () => {
  it("an AI-judged check: the question as shown, the typed answer, the key points as key and rubric, the hash, the result and the five-part feedback", () => {
    const q = checkQ();
    const response = withFormative(checkResponse({ text: "Bacteria grow in urine that stays.", question: q.stem, verdict: "partly", feedback: fb }),
      formativeFeedback([{ part: null, feedback: null, parts: asFeedbackParts(fb) }], evaluator))!;
    const s = buildAttemptSnapshot(q, { ...at, chosenIndex: null, response, correct: false, score: 0.5, marking: "ai_evaluation", contentVersion: 1 })!;
    expect(s.presented.stem).toBe(q.stem);
    expect(s.response).toMatchObject({ kind: "check", text: "Bacteria grow in urine that stays.", question: q.stem, verdict: "partly" });
    expect(s.response.formative).toBeUndefined(); // moved to its own field
    expect(s.rubric?.keyPoints).toEqual(points);
    expect(s.rubricHash).toBe(rubricHash(q.answer));
    expect(s.answerKey.rationale).toBe(points.join(" "));
    expect(s).toMatchObject({ outcome: "partial", score: 0.5, marking: "ai_evaluation", competencyIds: [COMP], assessedAt: at.answeredAt, questionVersion: "own:1" });
    const item = (s.feedback as any).items[0];
    expect(item.parts).toEqual({ right: fb.right, missing: fb.missing, misconceptions: [], why: points.join(" "), next: fb.next });
  });
  it("a self-graded check keeps the learner's own grade, and no AI feedback", () => {
    const s = buildAttemptSnapshot(checkQ(), { ...at, chosenIndex: null, response: checkResponse({ text: "Bacteria grow.", question: "Q", selfGrade: "partly" }), correct: false, score: 0.5, marking: "self_graded" })!;
    expect(s).toMatchObject({ outcome: "partial", marking: "self_graded", feedback: null });
    expect(s.response.selfGrade).toBe("partly");
  });
  it("an unmarked check is unmarked, with no score: never incorrect (990 binds marking and outcome)", () => {
    const s = buildAttemptSnapshot(checkQ(), { ...at, chosenIndex: null, response: checkResponse({ text: "Not sure.", question: "Q" }), correct: false, score: 0, marking: "unmarked" })!;
    expect(s).toMatchObject({ outcome: "unmarked", marking: "unmarked", score: null });
    expect(snapshotOutcomeOf("unmarked", false, null)).toBe("unmarked");
    expect(snapshotOutcomeOf("deterministic", false, null)).toBe("incorrect");
    expect(snapshotFromRow({ ...snapshotInsertRow(s), user_id: "u" })!.outcome).toBe("unmarked");
  });
  it("a long typed check answer with full feedback still fits the 791 budget", () => {
    const big = { ...fb, right: Array(6).fill("r".repeat(300)), missing: Array(6).fill("m".repeat(300)) };
    const response = withFormative(checkResponse({ text: "x".repeat(3000), question: "Q", verdict: "partly", feedback: big }), formativeFeedback([{ part: null, feedback: null, parts: asFeedbackParts(big) }], evaluator))!;
    const s = buildAttemptSnapshot(checkQ(), { ...at, chosenIndex: null, response, correct: false, score: 0.5, marking: "ai_evaluation" })!;
    const total = ["presented", "response", "answerKey", "rubric", "feedback"].reduce((n, k) => n + new TextEncoder().encode(JSON.stringify((s as any)[k] ?? null)).length, 0);
    expect(total).toBeLessThanOrEqual(SNAPSHOT_TOTAL_MAX_BYTES);
  });
});

describe("SQIE-07: framework provenance (990)", () => {
  const read = {
    hashes: new Map([[COMP, "0123456789ABCDEF0123456789abcdef"]]), frameworkOf: new Map([[COMP, FW]]),
    versionOf: new Map([[FW, { major: 2, minor: 1, revision: 0 }]]),
  };
  it("pins each competency's content hash, framework and version at answer time", () => {
    expect(provenanceOf([COMP], read)).toEqual([{ id: COMP, content_hash: "0123456789abcdef0123456789abcdef", framework_id: FW, framework_version: "2.1.0" }]);
  });
  it("what could not be read is null, never guessed; a non-uuid id is left out", () => {
    const other = "66666666-6666-4666-8666-666666666666";
    expect(provenanceOf([other, "nope"], read)).toEqual([{ id: other, content_hash: null, framework_id: null, framework_version: null }]);
    expect(provenanceOf([COMP], { ...read, hashes: new Map([[COMP, "short"]]), versionOf: new Map([[FW, { major: 1.5, minor: 0, revision: 0 }]]) }))
      .toEqual([{ id: COMP, content_hash: null, framework_id: FW, framework_version: null }]);
  });
  it("the snapshot carries it aligned with competency_ids, and the row round-trips", () => {
    const s = buildAttemptSnapshot(checkQ(), { ...at, chosenIndex: null, response: { kind: "text", text: "x" }, correct: true, score: 1, marking: "deterministic", provenance: provenanceOf([COMP], read) })!;
    expect(s.competencyProvenance).toEqual(provenanceOf([COMP], read));
    const row = snapshotInsertRow(s);
    expect(row.competency_provenance).toEqual(s.competencyProvenance);
    expect(snapshotFromRow({ ...row, user_id: "u" })).toEqual(s);
    // No competency: an empty array (990 requires the same length as competency_ids). Not recorded: no column at all.
    expect(buildAttemptSnapshot(checkQ({ competencyId: null }), { ...at, chosenIndex: null, response: { kind: "text", text: "x" }, correct: true, score: 1, marking: "deterministic", provenance: [] })!.competencyProvenance).toEqual([]);
    expect("competency_provenance" in snapshotInsertRow(buildAttemptSnapshot(checkQ(), { ...at, chosenIndex: null, response: { kind: "text", text: "x" }, correct: true, score: 1, marking: "deterministic" })!)).toBe(false);
  });
  it("a provenance for another id is not attached to this competency", () => {
    const s = buildAttemptSnapshot(checkQ(), { ...at, chosenIndex: null, response: { kind: "text", text: "x" }, correct: true, score: 1, marking: "deterministic", provenance: [{ id: FW, content_hash: null, framework_id: null, framework_version: null }] })!;
    expect(s.competencyProvenance).toEqual([{ id: COMP, content_hash: null, framework_id: null, framework_version: null }]);
  });
});

describe("fail closed while 990 is absent: exactly as before", () => {
  const snap = () => buildAttemptSnapshot(checkQ(), { ...at, chosenIndex: null, response: { kind: "text", text: "x" }, correct: true, score: 1, marking: "deterministic", provenance: [] })!;
  const admin = (errors: (unknown | null)[]) => {
    const inserts: Record<string, unknown>[] = [];
    return { inserts, from: () => ({ insert: async (row: Record<string, unknown>) => { inserts.push(row); return { error: errors[inserts.length - 1] ?? null }; } }) } as any;
  };
  const missingColumn = { code: "PGRST204", message: "Could not find the 'competency_provenance' column of 'individual_scholar_attempt_snapshot' in the schema cache" };
  beforeEach(() => resetContinuitySchema());
  it("a check snapshot (needs990) is not kept, and nothing is retried or reported", async () => {
    const a = admin([missingColumn]);
    expect(await insertAttemptSnapshot(a, "u", snap(), { needs990: true })).toBe("absent");
    expect(a.inserts).toHaveLength(1);
    expect(snapshotProvenanceAbsent()).toBe(true);
    // Known absent: the next check snapshot makes no call at all.
    expect(await insertAttemptSnapshot(a, "u", snap(), { needs990: true })).toBe("absent");
    expect(a.inserts).toHaveLength(1);
  });
  it("a revision snapshot is kept as before, without the provenance", async () => {
    const a = admin([missingColumn, null]);
    expect(await insertAttemptSnapshot(a, "u", snap())).toBe("ok");
    expect(a.inserts).toHaveLength(2);
    expect("competency_provenance" in a.inserts[0]).toBe(true);
    expect("competency_provenance" in a.inserts[1]).toBe(false);
    expect(await insertAttemptSnapshot(a, "u", snap())).toBe("ok");
    expect("competency_provenance" in a.inserts[2]).toBe(false); // remembered: one try only
  });
  it("990 present: one insert, with the provenance", async () => {
    const a = admin([null]);
    expect(await insertAttemptSnapshot(a, "u", snap(), { needs990: true })).toBe("ok");
    expect(a.inserts[0].competency_provenance).toEqual([{ id: COMP, content_hash: null, framework_id: null, framework_version: null }]);
    expect(snapshotProvenanceAbsent()).toBe(false);
  });
  it("any other refusal is a failure (reported by keepAttemptSnapshot), never a silent drop", async () => {
    expect(await insertAttemptSnapshot(admin([{ code: "23514", message: "violates check constraint" }]), "u", snap(), { needs990: true })).toBe("failed");
  });
});

describe("SQIE-04: the rubric cap (full text for normal items, hash only for genuinely oversized ones)", () => {
  const long = Array.from({ length: 8 }, (_, i) => `${"a key point of three hundred characters ".repeat(7)}${i}`.slice(0, 300));
  const q = { kind: "short", answer: { accepted: Array.from({ length: 4 }, (_, i) => `accepted answer ${i}`), rubric: { keyPoints: long } } };
  it("eight 300-character key points survive whole in the full snapshot (was cut at 160 characters and 1500 bytes)", () => {
    const s = rubricSnapshotOf(q)!;
    expect(s.keyPoints).toEqual(long);
    expect(s.accepted).toHaveLength(4);
    expect(new TextEncoder().encode(JSON.stringify(s)).length).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES);
    expect(snapshotOf({ rubric: s })).toEqual(s); // read back whole
  });
  it("the 416 response copy falls back to the compact form, then to { v, hash }", () => {
    const s = rubricSnapshotOf(q)!;
    const mid = withRubricSnapshot({ kind: "text", text: "x".repeat(RESPONSE_BUDGET - 1600) }, s)!;
    expect(mid.rubric).toEqual(compactSnapshot(s));
    expect(new TextEncoder().encode(JSON.stringify(compactSnapshot(s))).length).toBeLessThanOrEqual(SNAPSHOT_COMPACT_BYTES);
    expect(withRubricSnapshot({ kind: "text", text: "x".repeat(RESPONSE_BUDGET - 120) }, s)!.rubric).toEqual({ v: 1, hash: s.hash });
  });
  it("a genuinely oversized guide keeps only its hash", () => {
    const huge = { kind: "short", answer: { accepted: Array(8).fill("y".repeat(300)), rubric: { keyPoints: Array(8).fill("z".repeat(300)) }, parts: Array(4).fill({ marks: 1, accepted: Array(4).fill("w".repeat(300)) }) } };
    const s = rubricSnapshotOf(huge)!;
    expect(new TextEncoder().encode(JSON.stringify(s)).length).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES);
    expect(s.hash).toBe(rubricHash(huge.answer));
  });
});

describe("SQIE C-04: a scenario keeps the five parts per stage across the progress token", () => {
  const K = tokenKey("test-secret");
  const who = { userId: "u1", questionId: "q1", answer: { format: "scenario" } };
  const parts = { right: ["r"], missing: ["m"], misconceptions: ["x"], why: "because", next: "then" };
  it("an AI-judged stage's parts survive signing and reading; a code-marked stage carries none", () => {
    const results: StageResult[] = [{ score: 1, by: "code", answer: "a", parts }, { score: 0.5, by: "ai", answer: "b", feedback: "Partly.", parts }];
    const p = readProgress(K, signProgress(K, who, { next: 2, results, evaluator }, 1000), who, 2000)!;
    expect(p.results[0].parts).toBeNull();
    expect(p.results[1]).toMatchObject({ feedback: "Partly.", parts });
  });
  it("the token stays readable: the oldest stages' parts go first when it would be too long (their summary stays)", () => {
    const big = { right: Array(4).fill("r".repeat(300)), missing: Array(4).fill("m".repeat(300)), misconceptions: Array(3).fill("x".repeat(300)), why: "w".repeat(400), next: "n".repeat(400) };
    const results: StageResult[] = [0, 1, 2].map(i => ({ score: 0.5, by: "ai" as const, answer: `a${i}`, feedback: "f".repeat(600), parts: big }));
    const t = signProgress(K, who, { next: 3, results, evaluator }, 1000);
    expect(t.length).toBeLessThanOrEqual(TOKEN_MAX_CHARS);
    const p = readProgress(K, t, who, 2000)!;
    expect(p.results[0].parts).toBeNull();
    expect(p.results[0].feedback).toBe("f".repeat(600));
    expect(p.results[2].parts).toEqual(big);
  });
});
