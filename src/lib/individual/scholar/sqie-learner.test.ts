/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import {
  checkRevisionDraft, effectiveKind, existingObjectives, keyOf, learnerItem, markResponse, objectiveKey, parseResponse, pickQuestions, planGeneration, storedKind,
  type PoolItem, type RevisionQuestion,
} from "./revision";
import {
  EVALUATE_EXTENDED_SYSTEM, REVISION_SYSTEM, formatPromptVersion, parseEvaluation, revisionPromptVersion, runCase, runQuestions, runRevisionQuestions, type Passage,
} from "./generation";
import { PROMPT_VERSIONS, REVISION_FORMATS, VERIFY_FORMATS, VERIFY_FORMATS_DEFAULT } from "./config";
import { balanceTrueFalse, extendedMarks, extendedSpecOf, markTrueFalse, storedMatched } from "./formats";
import { BLIND_SOLVE_SYSTEM, answerAgrees, applyBlindVerification, blindItemOf, blindSolvePrompt, type BlindItem } from "./blind-verify";
import { rubricOf } from "./question-intel";
import { feedbackView, keptAttemptView } from "./revision-view";
import { applySnapshot, rubricChanged, rubricHash, rubricSnapshotOf, snapshotOf, withRubricSnapshot, SNAPSHOT_MAX_BYTES } from "./rubric-snapshot";
import { RESPONSE_BUDGET, withFormative, formativeFeedback } from "./written-feedback";
import { resolvePolicy } from "../policy";
import type { QuestionRow } from "./store";

// SCHOLAR-SQIE-LEARNER-01 (owner GO 31 Oct 2026): true/false, extended response, the rubric snapshot on attempts, the
// per-format blind check, and the objective repeat check. No migration: every item is a `short` row told apart by answer.format.

const NOTE = [
  "Pyelonephritis (kidney infection) spreads from the bladder to one or both kidneys.",
  "Symptoms include fever, loin pain and dysuria.",
  "Escherichia coli is the commonest cause.",
  "Treatment is with antibiotics and fluids.",
  "Urinary retention raises the risk because urine stays in the bladder.",
].join("\n");
const passage: Passage = { chunkId: "c1", materialId: "m1", materialTitle: "Renal notes", ordinal: 1, pageFrom: 1, pageTo: 1, content: NOTE };

const TF_TRUE = {
  statement: "Escherichia coli is the commonest cause of pyelonephritis.", answer: true, explanation: "The notes say Escherichia coli is the commonest cause.",
  sourceQuote: "Escherichia coli is the commonest cause.", difficulty: 1, level: "recall", objective: "Recall the commonest cause of pyelonephritis.", keyPoints: ["Escherichia coli is the commonest cause"], misconceptions: [],
};
const TF_FALSE = {
  statement: "Pyelonephritis spreads from the kidneys to the bladder.", answer: false, explanation: "The notes say it spreads from the bladder to one or both kidneys.",
  sourceQuote: "Pyelonephritis (kidney infection) spreads from the bladder to one or both kidneys.", difficulty: 1, level: "recall", objective: "Recall how pyelonephritis spreads.", keyPoints: ["It spreads from the bladder to the kidneys"], misconceptions: [],
};
const EXT = {
  stem: "Describe pyelonephritis, its symptoms and its commonest cause?", modelAnswer: "Pyelonephritis is a kidney infection that spreads from the bladder. Symptoms include fever, loin pain and dysuria. Escherichia coli is the commonest cause.",
  keyPoints: ["It spreads from the bladder to the kidneys", "Symptoms include fever", "Symptoms include loin pain", "Escherichia coli is the commonest cause"], marks: 4,
  rationale: "The notes describe the infection, its symptoms and its cause.", sourceQuote: "Symptoms include fever, loin pain and dysuria.", difficulty: 2, level: "understanding",
  objective: "Describe pyelonephritis.", misconceptions: [],
};

/** A fake metered runner: replies in order, and records the parts and the systems it was called with. */
function fakeRun(replies: string[]) {
  const parts: string[] = [], systems: string[] = [];
  const run = async (g: any, part?: string) => { parts.push(part ?? "main"); systems.push(g.system); return { ok: true as const, text: replies.shift() ?? "[]", model: "fake", provider: "fake" } as never; };
  return { run, parts, systems };
}
const row = (over: Partial<QuestionRow> & Record<string, unknown>): QuestionRow => ({
  id: "q1", materialId: "m1", chunkId: "c1", kind: "short", stem: "Stem?", options: [], correctIndex: null, rationale: "r", sourceQuote: "q", model: "m", promptVersion: "v", createdAt: "2026-10-01T00:00:00Z",
  answer: null, difficulty: 2, materialTitle: "M", ordinal: 1, pageFrom: 1, pageTo: 1, unit: "page", latest: null, competencyId: null, caseId: null, caseStep: null, caseTitle: null, ...over,
}) as QuestionRow;

describe("the formats and the policy", () => {
  it("true_false and extended are formats; extended is off in the policy fallback, true_false on", () => {
    expect(REVISION_FORMATS).toContain("true_false");
    expect(REVISION_FORMATS).toContain("extended");
    const p = resolvePolicy([]);
    expect(p.scholarRevisionFormats).toContain("true_false");
    expect(p.scholarRevisionFormats).not.toContain("extended");
  });
  it("scholar_verify_formats lists every format a blind check can run on, and its fallback is the behaviour from before", () => {
    expect(VERIFY_FORMATS).toEqual(expect.arrayContaining(["mcq", "case", "mrq", "short", "structured", "match", "sequence", "flashcard", "true_false", "extended"]));
    expect(resolvePolicy([]).scholarVerifyFormats).toEqual([...VERIFY_FORMATS_DEFAULT]);
    expect(VERIFY_FORMATS_DEFAULT).toEqual(["mcq", "case", "mrq", "short"]);
  });
  it("cloze, true_false and extended are stored as short", () => {
    for (const f of ["cloze", "true_false", "extended"] as const) expect(storedKind(f)).toBe("short");
    expect(storedKind("mrq")).toBe("mrq");
  });
});

describe("true/false", () => {
  it("is written from the passage, stored as a short item with answer.format, and kept with its explanation and rubric", () => {
    const c = checkRevisionDraft("true_false", TF_TRUE, passage);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.draft.options).toEqual([]);
    expect(c.draft.answer).toMatchObject({ format: "true_false", accepted: ["true"], statement: TF_TRUE.statement, explanation: TF_TRUE.explanation });
    expect(rubricOf(c.draft.answer)).toMatchObject({ level: "recall", objective: "Recall the commonest cause of pyelonephritis." });
    const f = checkRevisionDraft("true_false", TF_FALSE, passage);
    expect(f.ok && f.draft.answer.accepted).toEqual(["false"]);
  });

  it("refuses a question as a statement, an ungrounded statement, an unfinished item, a quote not in the passage, a true statement its quote does not support", () => {
    expect(checkRevisionDraft("true_false", { ...TF_TRUE, statement: "Is Escherichia coli the commonest cause?" }, passage)).toEqual({ ok: false, reason: "not_a_question" });
    expect(checkRevisionDraft("true_false", { ...TF_TRUE, statement: "Surgery is the commonest cause of pyelonephritis." }, passage)).toMatchObject({ ok: false, reason: "ungrounded" });
    expect(checkRevisionDraft("true_false", { ...TF_TRUE, answer: "maybe" }, passage)).toEqual({ ok: false, reason: "malformed" });
    expect(checkRevisionDraft("true_false", { ...TF_TRUE, sourceQuote: "Not in the notes at all." }, passage)).toEqual({ ok: false, reason: "quote_not_in_passage" });
    expect(checkRevisionDraft("true_false", { ...TF_TRUE, statement: "Escherichia coli is the commonest cause of fever, loin pain and dysuria.", sourceQuote: "Treatment is with antibiotics and fluids." }, passage)).toEqual({ ok: false, reason: "inconsistent" });
    expect(checkRevisionDraft("true_false", { ...TF_TRUE, statement: "Escherichia coli is the commonest cause. Call Jane Smith on 07700 900123." }, passage).ok).toBe(false);
  });

  it("is marked by code, the two buttons are the whole answer, and nothing else is accepted", () => {
    const c = checkRevisionDraft("true_false", TF_FALSE, passage);
    if (!c.ok) throw new Error("draft");
    const q: RevisionQuestion = { id: "q", kind: "short", stem: c.draft.stem, options: [], correctIndex: null, answer: c.draft.answer, rationale: c.draft.rationale, difficulty: 1 };
    expect(effectiveKind(q)).toBe("true_false");
    expect(learnerItem(q)).toMatchObject({ kind: "true_false", options: [] });
    expect(JSON.stringify(learnerItem(q))).not.toMatch(/accepted|explanation|antibiotics and fluids/);
    expect(parseResponse(q, { text: "False" })).toEqual({ kind: "text", text: "false" });
    expect(parseResponse(q, { text: "perhaps" })).toBeNull();
    expect(markResponse(q, { kind: "text", text: "false" })).toEqual({ correct: true, score: 1, marking: "deterministic" });
    expect(markResponse(q, { kind: "text", text: "true" })).toEqual({ correct: false, score: 0, marking: "deterministic" });
    expect(markTrueFalse("TRUE", ["true"])).toBe(true);
    expect(markTrueFalse("yes", ["true"])).toBe(false);
  });

  it("is kept balanced: neither truth leads by more than one, and an all-one-truth batch keeps at most two", () => {
    const d = (t: string, i: number) => ({ answer: { accepted: [t] }, i });
    expect(balanceTrueFalse([d("true", 0), d("true", 1), d("true", 2), d("false", 3)], 3).map(x => x.answer.accepted[0])).toEqual(["true", "false", "true"]);
    expect(balanceTrueFalse([d("true", 0), d("true", 1), d("true", 2)], 3)).toHaveLength(2);
    expect(balanceTrueFalse([d("false", 0), d("true", 1)], 1)).toHaveLength(1);
  });

  it("its prompt asks for a balance and a statement (not a question), and the version names the check that ran", () => {
    expect(REVISION_SYSTEM.true_false).toMatch(/about half should be false/);
    expect(REVISION_SYSTEM.true_false).toMatch(/never a question/);
    expect(revisionPromptVersion("true_false")).toBe(`${PROMPT_VERSIONS.revision}:true_false`);
    expect(revisionPromptVersion("true_false", "blind")).toBe(`${PROMPT_VERSIONS.revision}:true_false+${PROMPT_VERSIONS.verifyBlind}`);
    expect(formatPromptVersion("true_false")).toBe(`${PROMPT_VERSIONS.revision}:true_false`);
  });
});

describe("extended response", () => {
  it("is stored as a short item with a model answer, 3 to 8 key points and whole marks a point", () => {
    const c = checkRevisionDraft("extended", EXT, passage);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.draft.answer).toMatchObject({ format: "extended", modelAnswer: EXT.modelAnswer, marks: 4, partialCredit: { rule: "per_key_point", marksPerPoint: 1 } });
    expect(rubricOf(c.draft.answer)!.keyPoints).toHaveLength(4);
    const spec = extendedSpecOf(c.draft.answer)!;
    expect(spec).toMatchObject({ marksPerPoint: 1, marks: 4 });
  });

  it("refuses fewer than 3 or more than 8 key points, an ungrounded point, and a question that does not ask", () => {
    expect(checkRevisionDraft("extended", { ...EXT, keyPoints: ["a b c d", "e f g h"] }, passage)).toEqual({ ok: false, reason: "malformed" });
    expect(checkRevisionDraft("extended", { ...EXT, keyPoints: Array.from({ length: 9 }, (_, i) => `Symptoms include fever ${"x".repeat(i)}`) }, passage)).toEqual({ ok: false, reason: "malformed" });
    expect(checkRevisionDraft("extended", { ...EXT, keyPoints: [...EXT.keyPoints.slice(0, 3), "Give 500 mg twice daily"] }, passage)).toMatchObject({ ok: false, reason: "ungrounded" });
    expect(checkRevisionDraft("extended", { ...EXT, stem: "Pyelonephritis is a kidney infection." }, passage)).toEqual({ ok: false, reason: "not_a_question" });
  });

  it("the marks are whole marks a point, capped at ten, and the score is the share of key points matched", () => {
    const spec = { keyPoints: ["a", "b", "c", "d"], marksPerPoint: 2 };
    expect(extendedMarks(spec, [0, 2, 2, 9, -1])).toEqual({ matched: [0, 2], awarded: 4, total: 8, score: 0.5, correct: false });
    expect(extendedMarks(spec, [0, 1, 2, 3]).correct).toBe(true);
    expect(extendedMarks(spec, [])).toMatchObject({ awarded: 0, score: 0 });
    const c = checkRevisionDraft("extended", { ...EXT, marks: 10 }, passage);
    expect(c.ok && (c.draft.answer.marks as number)).toBeLessThanOrEqual(10);
  });

  it("is never marked by code, is offered as its own format, and keeps its key points off the browser until it is answered", () => {
    const c = checkRevisionDraft("extended", EXT, passage);
    if (!c.ok) throw new Error("draft");
    const q: RevisionQuestion = { id: "q", kind: "short", stem: c.draft.stem, options: [], correctIndex: null, answer: c.draft.answer, rationale: c.draft.rationale, difficulty: 2 };
    expect(effectiveKind(q)).toBe("extended");
    expect(markResponse(q, { kind: "text", text: "Pyelonephritis is a kidney infection." })).toEqual({ needsJudgement: true });
    const item = learnerItem(q);
    expect(item).toMatchObject({ kind: "extended", extended: { marks: 4, points: 4, maxChars: 3000 } });
    expect(JSON.stringify(item)).not.toMatch(/modelAnswer|Symptoms include|keyPoints|accepted/);
    expect(parseResponse(q, { text: "x".repeat(2500) })).toMatchObject({ kind: "text" });
    expect(parseResponse(q, { text: "x".repeat(3001) })).toBeNull();
    // A short answer keeps its 1000-character bound.
    expect(parseResponse({ ...q, answer: { accepted: ["a"] } }, { text: "x".repeat(1001) })).toBeNull();
  });

  it("an extended row without a sound marking key is not offered", () => {
    expect(keyOf({ id: "q", kind: "short", stem: "s?", options: [], correctIndex: null, rationale: "r", difficulty: 2, answer: { format: "extended", accepted: ["m"], modelAnswer: "m", rubric: { level: "recall", keyPoints: ["only one"] } } })).toBeNull();
  });

  it("the evaluator also says which numbered key points the answer makes, and that is required for an extended answer", () => {
    expect(EVALUATE_EXTENDED_SYSTEM).toMatch(/MATCHED/);
    const g = [NOTE, "Pyelonephritis is a kidney infection."];
    const ok = parseEvaluation("VERDICT: partly\nMATCHED: 1, 3\nRIGHT: kidney infection\nMISSING: the cause\nMISCONCEPTIONS: none\nWHY: the notes say it spreads from the bladder\nNEXT: revise the causes", g, { keyPoints: 4 });
    expect(ok.ok && ok.matched).toEqual([0, 2]);
    expect(ok.ok && ok.feedback).not.toMatch(/MATCHED/);
    const none = parseEvaluation("VERDICT: incorrect\nMATCHED: none\nRIGHT: none\nMISSING: the points\nMISCONCEPTIONS: none\nWHY: the notes say it spreads\nNEXT: revise", g, { keyPoints: 4 });
    expect(none.ok && none.matched).toEqual([]);
    expect(parseEvaluation("VERDICT: correct\nRIGHT: kidney infection", g, { keyPoints: 4 })).toEqual({ ok: false, reason: "malformed" });
    expect(parseEvaluation("VERDICT: correct\nMATCHED: 7\nRIGHT: kidney infection", g, { keyPoints: 4 })).toEqual({ ok: false, reason: "malformed" });
    // Without key points the reply is read exactly as before.
    expect(parseEvaluation("VERDICT: correct\nRIGHT: kidney infection", g).ok).toBe(true);
  });

  it("feedback shows the points made, the marks, the label; a self-marked answer ticks no point", () => {
    const c = checkRevisionDraft("extended", EXT, passage);
    if (!c.ok) throw new Error("draft");
    const q = row({ answer: c.draft.answer, stem: c.draft.stem, rationale: c.draft.rationale });
    const f = feedbackView(q, { correct: false, score: 0.5, marking: "ai_evaluation", extendedMatched: [0, 3] });
    expect(f.extended).toMatchObject({ marks: { awarded: 2, total: 4 }, points: [{ matched: true }, { matched: false }, { matched: false }, { matched: true }] });
    expect(f.extended!.label).toMatch(/Formative/);
    expect(feedbackView(q, { correct: false, score: 0.5, marking: "self_graded" }).extended!.points.every(p => p.matched === null)).toBe(true);
    expect(storedMatched({ matched: [0, 3] }, "ai_evaluation", 4)).toEqual([0, 3]);
    expect(storedMatched({ matched: [0, 3] }, "self_graded", 4)).toBeNull();
    expect(storedMatched({ matched: [0, 9] }, "ai_evaluation", 4)).toBeNull();
  });
});

describe("the rubric snapshot on attempts", () => {
  const shortRow = (answer: unknown) => row({ answer });
  const base = { accepted: ["Escherichia coli", "E. coli"], rubric: { level: "recall", objective: "Recall the cause.", keyPoints: ["Escherichia coli is the commonest cause"], misconceptions: [], source: "notes", referenceIds: [] } };

  it("is { v: 1, hash, keyPoints, accepted } with a 16-character canonical hash, the same for the same guide whatever the key order", () => {
    const s = rubricSnapshotOf(shortRow(base))!;
    expect(s).toMatchObject({ v: 1, keyPoints: ["Escherichia coli is the commonest cause"], accepted: ["Escherichia coli", "E. coli"] });
    expect(s.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(rubricHash({ b: 1, a: { d: 2, c: 3 } })).toBe(rubricHash({ a: { c: 3, d: 2 }, b: 1 }));
    expect(rubricSnapshotOf(shortRow({ ...base, accepted: ["Different"] }))!.hash).not.toBe(s.hash);
    expect(rubricSnapshotOf(row({ answer: null }))).toBeNull();
  });

  it("changing the question's rubric afterwards does not change the stored snapshot, the score, or what that attempt's feedback shows", () => {
    const before = shortRow(base);
    const snap = rubricSnapshotOf(before)!;
    const stored = withRubricSnapshot({ kind: "text", text: "E. coli" }, snap)!;
    // The question is edited later: different accepted answer, different key points.
    const after = shortRow({ ...base, accepted: ["Staphylococcus"], rubric: { ...base.rubric, keyPoints: ["Staphylococcus is the commonest cause"] } });
    const kept = snapshotOf(stored)!;
    expect(kept).toEqual(snap);
    expect(snapshotOf(JSON.parse(JSON.stringify(stored)))).toEqual(snap);
    const f = feedbackView(after, { correct: true, score: 1, marking: "deterministic", snapshot: kept });
    expect(f.score).toBe(1);
    expect(f.answer).toBe("Escherichia coli (also accepted: E. coli)");
    expect(f.rubric!.keyPoints).toEqual(["Escherichia coli is the commonest cause"]);
    expect(f.rubricNote).toMatch(/updated since you answered/);
    // Unchanged question: no note. No snapshot (an older attempt): the question as it is now.
    expect(feedbackView(before, { correct: true, score: 1, marking: "deterministic", snapshot: kept }).rubricNote).toBeUndefined();
    expect(feedbackView(after, { correct: true, score: 1, marking: "deterministic" }).answer).toMatch(/Staphylococcus/);
    expect(rubricChanged(after, kept)).toBe(true);
    // The row itself is not changed by reading the snapshot over it.
    expect((applySnapshot(after, kept).answer as any).accepted).toEqual(["Escherichia coli", "E. coli"]);
    expect((after.answer as any).accepted).toEqual(["Staphylococcus"]);
  });

  it("a structured attempt's practice marks are read against the parts' marks at the time", () => {
    const parts = (m2: number) => [
      { prompt: "A?", marks: 1, accepted: ["alpha"] }, { prompt: "B?", marks: m2, accepted: ["beta"] },
    ];
    const q1 = row({ kind: "structured", answer: { parts: parts(2), rubric: { level: "recall", keyPoints: [], misconceptions: [], source: "notes", referenceIds: [] } } });
    const snap = rubricSnapshotOf(q1)!;
    expect(snap.parts).toEqual([{ marks: 1, accepted: ["alpha"] }, { marks: 2, accepted: ["beta"] }]);
    expect(snap.marks).toBe(3);
    const q2 = row({ kind: "structured", answer: { parts: parts(5), rubric: { level: "recall", keyPoints: [], misconceptions: [], source: "notes", referenceIds: [] } } });
    const f = feedbackView(q2, { correct: false, score: 1 / 3, marking: "deterministic", snapshot: snapshotOf({ rubric: snap }) });
    expect(f.structured!.practiceMarks).toMatchObject({ awarded: 1, total: 3 });
    expect(f.structured!.parts.map(p => p.marks)).toEqual([1, 2]);
    expect(feedbackView(q2, { correct: false, score: 1 / 3, marking: "deterministic" }).structured!.practiceMarks.total).toBe(6);
  });

  it("history reads the snapshot of that attempt through keptAttemptView", () => {
    const q = shortRow(base);
    const snap = rubricSnapshotOf(q)!;
    expect(keptAttemptView(q, { response: { kind: "text", text: "x", rubric: snap }, marking: "deterministic" }).snapshot).toEqual(snap);
    expect(keptAttemptView(q, { response: { kind: "text", text: "x" }, marking: "deterministic" }).snapshot).toBeNull();
  });

  it("is compact: long guides are cut back to fit, and never fail the attempt", () => {
    const long = shortRow({ accepted: Array.from({ length: 8 }, (_, i) => `${"accepted answer ".repeat(20)}${i}`), rubric: { level: "recall", keyPoints: Array.from({ length: 8 }, (_, i) => `${"a key point ".repeat(30)}${i}`) } });
    const s = rubricSnapshotOf(long)!;
    expect(new TextEncoder().encode(JSON.stringify(s)).length).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES);
    expect(s.hash).toBe(rubricHash(long.answer));
    // A response already near the budget: the snapshot is cut to { v, hash } and, failing that, left out -- the answer is kept.
    const near = { kind: "text", text: "x".repeat(RESPONSE_BUDGET - 120) };
    const withHash = withRubricSnapshot(near, s)!;
    expect(withHash.rubric).toEqual({ v: 1, hash: s.hash });
    const full = { kind: "text", text: "x".repeat(RESPONSE_BUDGET - 10) };
    expect(withRubricSnapshot(full, s)).toEqual(full);
    for (const r of [near, { kind: "text", text: "short" }]) expect(new TextEncoder().encode(JSON.stringify(withRubricSnapshot(r, s))).length).toBeLessThanOrEqual(RESPONSE_BUDGET);
    // A choice has no response to carry one (migration 416): returned as it came. No snapshot: unchanged.
    expect(withRubricSnapshot(null, s)).toBeNull();
    expect(withRubricSnapshot({ kind: "text", text: "x" }, null)).toEqual({ kind: "text", text: "x" });
  });

  it("formative feedback yields before the snapshot does", () => {
    const s = rubricSnapshotOf(shortRow(base))!;
    const resp = withRubricSnapshot({ kind: "text", text: "x".repeat(RESPONSE_BUDGET - 700) }, s)!;
    const fb = formativeFeedback([{ part: null, feedback: "y".repeat(600), parts: null }], { model: "m", promptVersion: "p" });
    const out = withFormative(resp, fb)!;
    expect((out.rubric as any).hash).toBe(s.hash);
    expect(new TextEncoder().encode(JSON.stringify(out)).length).toBeLessThanOrEqual(RESPONSE_BUDGET);
  });

  it("rejects a malformed snapshot when read back", () => {
    for (const bad of [null, {}, { rubric: null }, { rubric: { v: 2, hash: "0123456789abcdef" } }, { rubric: { v: 1, hash: "xyz" } }]) expect(snapshotOf(bad)).toBeNull();
    expect(snapshotOf({ rubric: { v: 1, hash: "0123456789abcdef", keyPoints: [1, "ok"], parts: [{ marks: 9, accepted: ["x"] }] } })).toEqual({ v: 1, hash: "0123456789abcdef", keyPoints: ["ok"] });
  });
});

describe("the blind check for the other formats", () => {
  const draftOf = (kind: any, raw: any) => { const c = checkRevisionDraft(kind, raw, passage); if (!c.ok) throw new Error(`${kind}: ${c.reason}`); return c.draft; };
  const verdict = (extra: Record<string, unknown>, over: Record<string, unknown> = {}) => JSON.stringify([{ q: 1, answerable: true, stemAddsFacts: false, ambiguous: false, ...extra, ...over }]);

  it("true/false: kept when the reader reaches the keyed truth, dropped when it disagrees or cannot tell", () => {
    const item = blindItemOf("true_false", draftOf("true_false", TF_FALSE));
    expect(item).toMatchObject({ kind: "true_false", truth: false });
    expect(applyBlindVerification([item], verdict({ truth: "false" })).kept).toEqual([0]);
    expect(applyBlindVerification([item], verdict({ truth: "true" })).rejected[0].detail).toMatch(/solved true, keyed false/);
    expect(applyBlindVerification([item], verdict({ truth: "not_stated" })).kept).toEqual([]);
    expect(applyBlindVerification([item], verdict({ truth: "false" }, { ambiguous: true })).kept).toEqual([]);
    expect(applyBlindVerification([item], verdict({ truth: "false" }, { answerable: false })).kept).toEqual([]);
    expect(applyBlindVerification([item], verdict({ truth: "false" }, { stemAddsFacts: true })).kept).toEqual([]);
    expect(applyBlindVerification([item], "not json").rejected[0].detail).toBe("no verdict");
  });

  it("matching and sequencing: the reader's letters must give the key, and the prompt hides the key", () => {
    const match = draftOf("match", { stem: "Match each term to its meaning", pairs: [{ left: "Cause", right: "Escherichia coli" }, { left: "Treatment", right: "antibiotics and fluids" }, { left: "Symptoms", right: "fever, loin pain and dysuria" }], rationale: "The notes list them.", sourceQuote: "Treatment is with antibiotics and fluids.", difficulty: 1 });
    const mi = blindItemOf("match", match) as Extract<BlindItem, { kind: "match" }>;
    const right = ["Escherichia coli", "antibiotics and fluids", "fever, loin pain and dysuria"];
    const letters = mi.keyed.map(i => "ABCDEF"[i]);
    expect(mi.choices.slice().sort()).toEqual(right.slice().sort());
    expect(applyBlindVerification([mi], verdict({ matches: letters })).kept).toEqual([0]);
    expect(applyBlindVerification([mi], verdict({ matches: [...letters].reverse() })).kept).toEqual(letters.join("") === [...letters].reverse().join("") ? [0] : []);
    expect(applyBlindVerification([mi], verdict({ matches: letters.slice(0, 2) })).kept).toEqual([]);
    const seq = draftOf("sequence", { stem: "Put the steps in the order the notes give?", steps: ["Symptoms include fever", "Escherichia coli is the commonest cause", "Treatment is with antibiotics and fluids"], rationale: "The notes give this order.", sourceQuote: "Treatment is with antibiotics and fluids.", difficulty: 1 });
    const si = blindItemOf("sequence", seq) as Extract<BlindItem, { kind: "sequence" }>;
    expect(applyBlindVerification([si], verdict({ order: si.keyed.map(i => "ABCDEF"[i]) })).kept).toEqual([0]);
    expect(applyBlindVerification([si], verdict({ order: ["A", "B", "C"].reverse() })).kept).toEqual(si.keyed.map(i => "ABCDEF"[i]).join("") === "CBA" ? [0] : []);
    const prompt = blindSolvePrompt(NOTE, [mi, si]);
    expect(prompt).toMatch(/MATCHING/);
    expect(prompt).toMatch(/SEQUENCING/);
    expect(BLIND_SOLVE_SYSTEM).toMatch(/NOT told the intended answers/);
  });

  it("flashcard and structured: the reader's answer must say what the key says; extended needs no comparison", () => {
    expect(answerAgrees("It is a kidney infection", "kidney infection")).toBe(true);
    expect(answerAgrees("A broken leg", "kidney infection")).toBe(false);
    expect(answerAgrees("", "kidney infection")).toBe(false);
    expect(answerAgrees("Escherichia", ["Staphylococcus", "Escherichia coli"])).toBe(true);
    const card = { kind: "flashcard", stem: "What is pyelonephritis?", back: "kidney infection" } as BlindItem;
    expect(applyBlindVerification([card], verdict({ answer: "a kidney infection" })).kept).toEqual([0]);
    expect(applyBlindVerification([card], verdict({ answer: "a lung disease" })).kept).toEqual([]);
    const structured = { kind: "structured", stem: "Pyelonephritis.", parts: [{ prompt: "Cause?", accepted: ["Escherichia coli"] }, { prompt: "Treatment?", accepted: ["antibiotics and fluids"] }] } as BlindItem;
    expect(applyBlindVerification([structured], verdict({ answers: ["Escherichia coli", "antibiotics"] })).kept).toEqual([0]);
    expect(applyBlindVerification([structured], verdict({ answers: ["Escherichia coli", "surgery"] })).kept).toEqual([]);
    expect(applyBlindVerification([structured], verdict({ answers: ["Escherichia coli"] })).kept).toEqual([]);
    expect(applyBlindVerification([{ kind: "extended", stem: "Describe it?" }], verdict({})).kept).toEqual([0]);
  });

  it("runRevisionQuestions: a format ticked in scholar_verify_formats gets one blind call and a failed check drops the draft with the existing reason", async () => {
    const good = fakeRun([JSON.stringify([TF_TRUE]), verdict({ truth: "true" })]);
    const r = await runRevisionQuestions("u1", "true_false", passage, 3, good.run, { verifyFormats: ["true_false"] });
    expect(r.ok && r.kept).toHaveLength(1);
    expect(r.ok && r.calls).toBe(2);
    expect(good.parts).toEqual(["main", "verify"]);
    expect(good.systems[1]).toBe(BLIND_SOLVE_SYSTEM);
    expect(r.ok && r.promptVersion).toBe(`${PROMPT_VERSIONS.revision}:true_false+${PROMPT_VERSIONS.verifyBlind}`);

    const bad = fakeRun([JSON.stringify([TF_TRUE]), verdict({ truth: "false" }), JSON.stringify([TF_TRUE]), verdict({ truth: "false" })]);
    const r2 = await runRevisionQuestions("u1", "true_false", passage, 3, bad.run, { verifyFormats: ["true_false"] });
    expect(r2.ok && r2.kept).toEqual([]);
    expect(r2.ok && r2.dropped).toEqual(["failed_verification", "failed_verification"]);
  });

  it("an unreadable reply drops everything as verification_unavailable would, and a failed call does the same", async () => {
    const run = async (_g: unknown, part?: string) => (part === "main" || part === "retry" ? { ok: true, text: JSON.stringify([TF_TRUE]), model: "m", provider: "p" } : { ok: false, error: "failed" }) as never;
    const r = await runRevisionQuestions("u1", "true_false", passage, 3, run, { verifyFormats: ["true_false"] });
    expect(r.ok && r.kept).toEqual([]);
    expect(r.ok && r.dropped).toContain("verification_unavailable");
  });

  it("a format NOT in the policy is stored without the extra call; the default is exactly mrq and short as before", async () => {
    const off = fakeRun([JSON.stringify([TF_TRUE])]);
    const r = await runRevisionQuestions("u1", "true_false", passage, 3, off.run);
    expect(r.ok && r.kept).toHaveLength(1);
    expect(off.parts).toEqual(["main"]);
    expect(r.ok && r.promptVersion).toBe(`${PROMPT_VERSIONS.revision}:true_false`);
    // short stays verified by default, and is not when the policy leaves it out
    const SHORT = { stem: "Which organism is the commonest cause of pyelonephritis?", accepted: ["Escherichia coli"], rationale: "The notes say Escherichia coli is the commonest cause.", sourceQuote: "Escherichia coli is the commonest cause.", difficulty: 1 };
    const dflt = fakeRun([JSON.stringify([SHORT]), verdict({ supported: [] })]);
    const d = await runRevisionQuestions("u1", "short", passage, 3, dflt.run);
    expect(dflt.parts).toEqual(["main", "verify"]);
    expect(d.ok && d.promptVersion).toBe(`${PROMPT_VERSIONS.revision}:short+${PROMPT_VERSIONS.verifyRevision}`);
    const none = fakeRun([JSON.stringify([SHORT])]);
    const n = await runRevisionQuestions("u1", "short", passage, 3, none.run, { verifyFormats: ["mcq"] });
    expect(none.parts).toEqual(["main"]);
    expect(n.ok && n.kept).toHaveLength(1);
    expect(n.ok && n.promptVersion).toBe(`${PROMPT_VERSIONS.revision}:short`);
    expect(formatPromptVersion("short")).toBe(`${PROMPT_VERSIONS.revision}:short`);
  });

  it("multiple choice and case follow the policy too (mcq always was, and still is by default)", async () => {
    const MCQ = {
      stem: "Which organism is the commonest cause of pyelonephritis?", options: ["Escherichia coli", "fever", "antibiotics", "loin pain"], correctIndex: 0, rationale: "The notes say Escherichia coli is the commonest cause.",
      sourceQuote: "Escherichia coli is the commonest cause.", difficulty: 1, level: "recall", objective: "Recall the cause.", keyPoints: [], misconceptions: [], references: [],
    };
    const on = fakeRun([JSON.stringify([MCQ]), JSON.stringify([{ q: 1, supported: ["A"], answerable: true, stemAddsFacts: false, ambiguous: false }])]);
    const a = await runQuestions("u1", "mcq", passage, 3, on.run);
    expect(on.parts).toEqual(["main", "verify"]);
    expect(a.ok && (a as any).check.kept).toHaveLength(1);
    const off = fakeRun([JSON.stringify([MCQ])]);
    const b = await runQuestions("u1", "mcq", passage, 3, off.run, { verifyFormats: ["short"] });
    expect(off.parts).toEqual(["main"]);
    expect(b.ok && (b as any).check.kept).toHaveLength(1);
    // the lookup version of a stored mcq does not depend on the policy
    expect(a.ok && (a as any).promptVersion).toBe(b.ok && (b as any).promptVersion);
    expect(typeof runCase).toBe("function");
  });
});

describe("the same learning objective is not stored twice for a section and format", () => {
  const SHORT = {
    stem: "Which organism is the commonest cause of pyelonephritis?", accepted: ["Escherichia coli"], rationale: "The notes say Escherichia coli is the commonest cause.",
    sourceQuote: "Escherichia coli is the commonest cause.", difficulty: 1, level: "recall", objective: "Recall the commonest cause of pyelonephritis.",
  };

  it("objectiveKey ignores case and punctuation", () => {
    expect(objectiveKey("Recall the  COMMONEST cause of pyelonephritis.")).toBe(objectiveKey("recall the commonest cause of pyelonephritis"));
  });

  it("checkRevisionDraft refuses a draft whose objective a stored question of the same section and format already has", () => {
    const stored = [
      { chunkId: "c1", kind: "short" as const, answer: { accepted: ["x"], rubric: { level: "recall", objective: "Recall the commonest cause of pyelonephritis." } } },
      { chunkId: "c2", kind: "short" as const, answer: { accepted: ["x"], rubric: { level: "recall", objective: "Another section's objective." } } },
      { chunkId: "c1", kind: "short" as const, answer: { format: "true_false", accepted: ["true"], rubric: { level: "recall", objective: "A true false objective." } } },
    ];
    expect([...existingObjectives(stored, "c1", "short")]).toEqual([objectiveKey("Recall the commonest cause of pyelonephritis.")]);
    expect([...existingObjectives(stored, "c1", "true_false")]).toEqual([objectiveKey("A true false objective.")]);
    const same = existingObjectives(stored, "c1", "short");
    expect(checkRevisionDraft("short", SHORT, passage, { existingObjectives: same })).toEqual({ ok: false, reason: "repeat" });
    expect(checkRevisionDraft("short", { ...SHORT, objective: "Name the organism behind most kidney infections." }, passage, { existingObjectives: same }).ok).toBe(true);
    // A different format of the same section is not a repeat.
    expect(checkRevisionDraft("true_false", { ...TF_TRUE, objective: "Recall the commonest cause of pyelonephritis." }, passage, { existingObjectives: existingObjectives(stored, "c1", "true_false") }).ok).toBe(true);
    expect(checkRevisionDraft("short", SHORT, passage).ok).toBe(true);
  });

  it("two drafts in one reply with the same objective: only the first is kept", async () => {
    const second = { ...SHORT, stem: "Which bacterium most often causes pyelonephritis?" };
    const { run } = fakeRun([JSON.stringify([SHORT, second]), JSON.stringify([{ q: 1, supported: [], answerable: true, stemAddsFacts: false, ambiguous: false }])]);
    const r = await runRevisionQuestions("u1", "short", passage, 3, run);
    expect(r.ok && r.kept).toHaveLength(1);
    expect(r.ok && r.dropped).toEqual(["repeat"]);
  });

  it("planGeneration still skips a section and format already written (the section|format key uses the format the item is offered as)", () => {
    const existing = new Set(["c1|true_false"]);
    expect(planGeneration({ shortfall: 3, chunkIds: ["c1"], formats: ["true_false", "short"], existing })).toEqual([{ chunkId: "c1", kind: "short", count: 3 }]);
    expect(planGeneration({ shortfall: 3, chunkIds: ["c1"], formats: ["extended"], existing })).toEqual([{ chunkId: "c1", kind: "extended", count: 3 }]);
  });
});

describe("pickQuestions in Weak areas reads the learner's recent misses", () => {
  const item = (id: string, over: Partial<PoolItem> = {}): PoolItem => ({ id, kind: "short", difficulty: 2, chunkId: "c1", createdAt: `2026-10-0${id.length}T00:00:00Z`, latestCorrect: false, misses: 1, lastAnsweredAt: "2026-10-20T00:00:00Z", due: false, ...over });
  it("with no recent misses the order is exactly the old one", () => {
    const pool = [item("a", { misses: 1 }), item("b", { misses: 3 })];
    expect(pickQuestions({ mode: "weak", pool, quantity: 5, formats: ["short"], difficulty: "any", seed: "s" }).ids).toEqual(["b", "a"]);
  });
});
