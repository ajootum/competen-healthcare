/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { checkRevisionDraft, effectiveKind, keyOf, learnerItem, parseResponse } from "./revision";
import { REVISION_SYSTEM, formatPromptVersion, revisionPromptVersion, runRevisionQuestions } from "./generation";
import {
  answerSummary, learnerView, markStageByCode, parseScenarioRaw, parseStageAnswer, readProgress, scenarioMarking, scenarioMarks, scenarioSpecOf, signProgress, stageKeyText, stageView,
  storedStageResults, storedStages, tokenKey, verdictScore, type StageResult,
} from "./scenario";
import { feedbackView, keptAttemptView, revisionItemView } from "./revision-view";
import { rubricSnapshotOf, snapshotOf, withRubricSnapshot } from "./rubric-snapshot";
import { buildAttemptSnapshot, applyAssessedSnapshot } from "./attempt-snapshot";
import { isScenarioQuestion } from "./formats";
import type { Passage } from "./generation";
import type { QuestionRow } from "./store";

// SCHOLAR-CE-2026 CE-05: the evolving scenario. Pure rules: the stored shape, what a browser sees (the first stage only), per-stage marking,
// the weighted sum, the progress token, the generated draft's checks, and the snapshots that record each stage as marked.

const NOTE = [
  "Pyelonephritis (kidney infection) spreads from the bladder to one or both kidneys.",
  "Symptoms include fever, loin pain and dysuria.",
  "Escherichia coli is the commonest cause.",
  "Treatment is with antibiotics and fluids.",
  "Urinary retention raises the risk because urine stays in the bladder.",
].join("\n");
const passage: Passage = { chunkId: "c1", materialId: "m1", materialTitle: "Renal notes", ordinal: 1, pageFrom: 1, pageTo: 1, content: NOTE };

const RAW = {
  situation: "Pyelonephritis spreads from the bladder to one or both kidneys. Symptoms include fever, loin pain and dysuria.",
  stages: [
    { reveal: "", prompt: "What is the commonest cause?", kind: "mcq", options: ["Escherichia coli", "Fever", "Dysuria", "Antibiotics"], correct: [0], weight: 1, keyPoint: "Escherichia coli is the commonest cause.", source: "Escherichia coli is the commonest cause." },
    { reveal: "Urine stays in the bladder.", prompt: "What does urinary retention raise?", kind: "short", accepted: ["the risk"], weight: 2, keyPoint: "Urinary retention raises the risk because urine stays in the bladder.", source: "Urinary retention raises the risk because urine stays in the bladder." },
    { reveal: "Treatment is needed.", prompt: "Which treatment is given?", kind: "mrq", options: ["Antibiotics", "Fluids", "Dysuria", "Fever"], correct: [0, 1], weight: 2, keyPoint: "Treatment is with antibiotics and fluids.", source: "Treatment is with antibiotics and fluids." },
  ],
  rationale: "The notes describe the infection, its cause and its treatment.", sourceQuote: "Escherichia coli is the commonest cause.", difficulty: 2, level: "application",
  objective: "Follow pyelonephritis as it develops.", keyPoints: ["Escherichia coli is the commonest cause"], misconceptions: [],
};
const drafted = () => { const c = checkRevisionDraft("scenario", RAW, passage); if (!c.ok) throw new Error(`draft refused: ${c.reason}`); return c.draft; };

const row = (over: Partial<QuestionRow> & Record<string, unknown> = {}): QuestionRow => {
  const d = drafted();
  return {
    id: "q1", materialId: "m1", chunkId: "c1", kind: "short", stem: d.stem, options: [], correctIndex: null, rationale: d.rationale, sourceQuote: d.sourceQuote, model: "m", promptVersion: "v", createdAt: "2026-10-01T00:00:00Z",
    answer: d.answer, difficulty: 2, materialTitle: "Renal notes", ordinal: 1, pageFrom: 1, pageTo: 1, unit: "page", latest: null, competencyId: null, caseId: null, caseStep: null, caseTitle: null, ...over,
  } as QuestionRow;
};

describe("the stored scenario", () => {
  it("is a short item told apart by answer.format, with the key points as its accepted answers (the 416/710 CHECK shapes: no migration)", () => {
    const d = drafted();
    expect(d.options).toEqual([]);
    expect((d.answer as any).format).toBe("scenario");
    expect((d.answer as any).accepted.length).toBeGreaterThanOrEqual(1);
    expect((d.answer as any).accepted.length).toBeLessThanOrEqual(8);
    expect(isScenarioQuestion({ kind: "short", answer: d.answer })).toBe(true);
    expect(effectiveKind(row() as any)).toBe("scenario");
    expect(scenarioSpecOf(d.answer)?.stages).toHaveLength(3);
    expect(scenarioSpecOf(d.answer)?.totalWeight).toBe(5);
  });
  it("a draft is refused when a stage after the first reveals nothing, a stage is unsound, or there are too few or too many stages", () => {
    const no = (mut: (r: any) => void) => { const r = JSON.parse(JSON.stringify(RAW)); mut(r); return parseScenarioRaw(r); };
    expect(no(() => {})).not.toBeNull();
    expect(no(r => { r.stages[1].reveal = ""; })).toBeNull();
    expect(no(r => { r.stages = r.stages.slice(0, 1); })).toBeNull();
    expect(no(r => { r.stages = [...r.stages, ...r.stages].slice(0, 5); })).toBeNull();
    expect(no(r => { r.stages[0].options = ["a", "b", "c"]; })).toBeNull();
    expect(no(r => { r.stages[2].correct = [0, 1, 2, 3]; })).toBeNull();
    expect(no(r => { r.stages[1].kind = "essay"; })).toBeNull();
    expect(no(r => { r.stages[1].weight = 9; })).toBeNull();
    expect(no(r => { r.stages[1].prompt = r.stages[0].prompt; })).toBeNull();
  });
  it("mcq and mrq options are stored shuffled with the key remapped, so it is never always first", () => {
    const p = parseScenarioRaw(RAW)!;
    for (const [i, st] of p.stages.entries()) if (st.kind === "mcq" || st.kind === "mrq") {
      const was = RAW.stages[i] as any;
      expect(st.correct.map(k => st.options[k]).sort()).toEqual(was.correct.map((k: number) => was.options[k]).sort());
    }
  });
  it("a cloze stage's prompt must hold the blank", () => {
    const cz = (prompt: string) => parseScenarioRaw({ ...RAW, stages: [RAW.stages[0], { reveal: "More.", prompt, kind: "cloze", accepted: ["antibiotics"], weight: 1, keyPoint: "Treatment is with antibiotics." }] });
    expect(cz("Treatment is with _____ and fluids.")).not.toBeNull();
    expect(cz("Treatment is with what?")).toBeNull();
  });
  it("is grounded like every revision item: a stage with a term the notes lack is refused", () => {
    const bad = JSON.parse(JSON.stringify(RAW)); bad.stages[2].options[0] = "Amoxicillin 500 mg";
    expect(checkRevisionDraft("scenario", bad, passage)).toEqual({ ok: false, reason: "ungrounded_number" });
    const ident = JSON.parse(JSON.stringify(RAW)); ident.situation = "Pyelonephritis spreads from the bladder. NHS number 943 476 5919.";
    expect(checkRevisionDraft("scenario", ident, passage).ok).toBe(false);
  });
  it("carries the rubric and the prompt version of its own", () => {
    const d = drafted();
    expect((d.answer as any).rubric.keyPoints.length).toBeGreaterThan(0);
    expect(revisionPromptVersion("scenario")).toBe("scholar-scenario-v2");
    expect(formatPromptVersion("scenario")).toBe("scholar-scenario-v2");
    expect(REVISION_SYSTEM.scenario).toMatch(/MUST reveal NEW clinical information/);
  });
  it("is generated through the same runner as the other formats: one call, one item, the scenario prompt", async () => {
    const systems: string[] = [], tokens: number[] = [];
    const run = async (g: any) => { systems.push(g.system); tokens.push(g.maxTokens); return { ok: true as const, text: JSON.stringify([RAW]), model: "fake", provider: "fake" } as never; };
    const r = await runRevisionQuestions("u1", "scenario", passage, 3, run as any, {});
    expect(r.ok && r.kept).toHaveLength(1);
    expect(systems).toEqual([REVISION_SYSTEM.scenario]);
    expect(tokens[0]).toBeGreaterThan(1800);
    // the blind check is not run on a scenario (no format of the verify list), so exactly one model call
    expect(r.ok && r.calls).toBe(1);
  });
});

describe("what a browser sees: the opening and the first stage only", () => {
  const SECRETS = ["Urine stays in the bladder.", "Treatment is needed.", "Which treatment is given?", "What does urinary retention raise?", "the risk", "Escherichia coli is the commonest cause.", "Treatment is with antibiotics and fluids.", "keyPoint", "\"correct\"", "\"accepted\""];
  it("learnerItem carries the stem and stage 1 -- never a later stage, a key, a key point or accepted answers", () => {
    const item = learnerItem(row() as any);
    expect(item.kind).toBe("scenario");
    expect(item.scenario?.count).toBe(3);
    expect(item.scenario?.stage.index).toBe(0);
    const json = JSON.stringify(item);
    for (const s of SECRETS.filter(x => x !== "Escherichia coli is the commonest cause.")) expect(json, s).not.toContain(s);
    expect(json).not.toContain("Which treatment is given?");
    expect(json).not.toContain("rationale");
  });
  it("the session view (revisionItemView) is the same: stage 1 only", () => {
    const json = JSON.stringify(revisionItemView(row()));
    expect(json).toContain("What is the commonest cause?");
    expect(json).not.toContain("What does urinary retention raise?");
    expect(json).not.toContain("Urine stays in the bladder.");
  });
  it("a stage view is the new information, the question, the options and the weight", () => {
    const spec = scenarioSpecOf(drafted().answer)!;
    expect(Object.keys(stageView(spec, 1)!).sort()).toEqual(["index", "kind", "options", "prompt", "reveal", "weight"]);
    expect(stageView(spec, 3)).toBeNull();
    expect(learnerView(null)).toBeNull();
  });
  it("it cannot be answered as one response", () => {
    expect(parseResponse(row() as any, { text: "anything" })).toBeNull();
    expect(keyOf({ ...(row() as any), kind: "short" })).not.toBeNull();
    expect(keyOf({ ...(row() as any), answer: { format: "scenario", accepted: ["x"], stages: [] } })).toBeNull();
  });
});

describe("marking: each stage by its own kind's marker, then summed with the stage weights", () => {
  const spec = () => scenarioSpecOf(drafted().answer)!;
  const stageOf = (k: string) => spec().stages.find(s => s.kind === k)!;
  it("mcq right or wrong; mrq fractional with a penalty; cloze normalised; a short answer by code only on a match", () => {
    const mcq = stageOf("mcq"), mrq = stageOf("mrq"), short = stageOf("short");
    expect(markStageByCode(mcq, { kind: "choice", index: mcq.correct[0] })).toEqual({ score: 1 });
    expect(markStageByCode(mcq, { kind: "choice", index: (mcq.correct[0] + 1) % 4 })).toEqual({ score: 0 });
    const [r0, r1] = mrq.correct;
    expect(markStageByCode(mrq, { kind: "set", indexes: [r0, r1] })).toEqual({ score: 1 });
    expect(markStageByCode(mrq, { kind: "set", indexes: [r0] })).toEqual({ score: 0.5 });
    const wrong = mrq.options.findIndex((_, i) => !mrq.correct.includes(i));
    expect(markStageByCode(mrq, { kind: "set", indexes: [r0, wrong] })?.score).toBe(0);
    expect(markStageByCode(short, { kind: "text", text: "The Risk." })).toEqual({ score: 1 });
    expect(markStageByCode(short, { kind: "text", text: "something else" })).toBeNull();
    const cloze = { ...short, kind: "cloze" as const };
    expect(markStageByCode(cloze, { kind: "text", text: "risk" })).toEqual({ score: 1 });
    expect(markStageByCode(cloze, { kind: "text", text: "nothing" })).toEqual({ score: 0 });
  });
  it("an evaluation verdict is worth all, half or none of the stage", () => {
    expect([verdictScore("correct"), verdictScore("partly"), verdictScore("incorrect")]).toEqual([1, 0.5, 0]);
  });
  it("the practice marks are the weighted sum of the stage scores out of the total weight", () => {
    const s = spec();
    expect(scenarioMarks(s, [{ score: 1 }, { score: 0.5 }, { score: 0 }])).toEqual({ awarded: 2, total: 5, score: 0.4, correct: false });
    expect(scenarioMarks(s, [{ score: 1 }, { score: 1 }, { score: 1 }])).toEqual({ awarded: 5, total: 5, score: 1, correct: true });
    expect(scenarioMarks(s, [{ score: 0 }, { score: 0 }, { score: 0 }])).toMatchObject({ awarded: 0, score: 0, correct: false });
    // a heavy stage counts for more than a light one
    expect(scenarioMarks(s, [{ score: 0 }, { score: 1 }, { score: 1 }]).awarded).toBe(4);
    expect(scenarioMarks(s, [{ score: 1 }, { score: 0 }, { score: 0 }]).awarded).toBe(1);
    // fewer results than stages is never full marks
    expect(scenarioMarks(s, [{ score: 1 }, { score: 1 }]).correct).toBe(false);
  });
  it("how the whole attempt was marked: the learner's own judgement outranks AI, which outranks code", () => {
    expect(scenarioMarking([{ by: "code" }, { by: "code" }])).toBe("deterministic");
    expect(scenarioMarking([{ by: "code" }, { by: "ai" }])).toBe("ai_evaluation");
    expect(scenarioMarking([{ by: "ai" }, { by: "self" }])).toBe("self_graded");
  });
  it("a stage answer is bounded by its kind", () => {
    const s = spec();
    expect(parseStageAnswer(stageOf("mcq"), { index: 9 })).toBeNull();
    expect(parseStageAnswer(stageOf("mrq"), { indexes: [] })).toBeNull();
    expect(parseStageAnswer(stageOf("short"), { text: "   " })).toBeNull();
    expect(parseStageAnswer(stageOf("short"), { text: "x".repeat(1001) })).toBeNull();
    expect(parseStageAnswer(stageOf("short"), { text: "ok" })).toEqual({ kind: "text", text: "ok" });
    expect(answerSummary(s.stages[0], { kind: "choice", index: 1 })).toBe(s.stages[0].options[1]);
    expect(stageKeyText(stageOf("mrq")).split("; ")).toHaveLength(2);
  });
});

describe("the progress token: a stage is sent only against a valid answer to the stage before", () => {
  const K = tokenKey("test-secret"), who = () => ({ userId: "u1", questionId: "q1", answer: drafted().answer });
  const done: StageResult[] = [{ score: 1, by: "code", answer: "Escherichia coli" }];
  const now = 1_800_000_000_000;
  it("round-trips the stage and the results so far", () => {
    const t = signProgress(K, who(), { next: 1, results: done, evaluator: null }, now);
    expect(readProgress(K, t, who(), now + 1000)).toMatchObject({ next: 1, results: [{ score: 1, by: "code", answer: "Escherichia coli" }] });
  });
  it("refuses a token that was altered (a raised score, a skipped stage), another learner's, another question's, an edited guide's, an old one, or one signed with another key", () => {
    const t = signProgress(K, who(), { next: 1, results: done, evaluator: null }, now);
    const [body, sig] = t.split(".");
    const forge = (patch: (c: any) => void) => { const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); patch(c); return `${Buffer.from(JSON.stringify(c)).toString("base64url")}.${sig}`; };
    expect(readProgress(K, forge(c => { c.r[0].s = 1; c.n = 2; }), who(), now)).toBeNull();
    expect(readProgress(K, forge(c => { c.u = "u2"; }), who(), now)).toBeNull();
    expect(readProgress(K, t, { ...who(), userId: "u2" }, now)).toBeNull();
    expect(readProgress(K, t, { ...who(), questionId: "q2" }, now)).toBeNull();
    expect(readProgress(K, t, { ...who(), answer: { ...(who().answer as any), accepted: ["changed"] } }, now)).toBeNull();
    expect(readProgress(K, t, who(), now + 7 * 60 * 60 * 1000)).toBeNull();
    expect(readProgress(tokenKey("other"), t, who(), now)).toBeNull();
    expect(readProgress(K, `${body}.${sig}x`, who(), now)).toBeNull();
    expect(readProgress(K, undefined, who(), now)).toBeNull();
    expect(readProgress(K, "not a token", who(), now)).toBeNull();
  });
  it("a token whose results do not match its stage is refused", () => {
    const t = signProgress(K, who(), { next: 2, results: done, evaluator: null }, now);
    expect(readProgress(K, t, who(), now)).toBeNull();
  });
});

describe("the attempt and its snapshots record each stage as marked", () => {
  const results: StageResult[] = [{ score: 1, by: "code", answer: "Escherichia coli" }, { score: 0.5, by: "ai", answer: "increased risk" }, { score: 0, by: "code", answer: "Fluids" }];
  it("the stored response keeps every stage's answer, score and how it was marked, and reads back", () => {
    const stored = storedStages(results);
    expect(stored).toMatchObject({ kind: "scenario", stages: [{ a: "Escherichia coli", s: 1, by: "code" }, { a: "increased risk", s: 0.5, by: "ai" }, { a: "Fluids", s: 0, by: "code" }] });
    expect(storedStageResults(stored, 3)).toEqual(results.map(r => ({ score: r.score, by: r.by, answer: r.answer })));
    expect(storedStageResults(stored, 2)).toBeNull();
    expect(storedStageResults({ stages: [{ a: "x", s: 2, by: "code" }] }, 1)).toBeNull();
  });
  it("the rubric snapshot holds each stage's weight and key, and its hash tells a changed guide", () => {
    const q = row();
    const snap = rubricSnapshotOf(q)!;
    expect(snap.marks).toBe(5);
    expect(snap.parts?.map(p => p.marks)).toEqual([1, 2, 2]);
    expect(snap.parts?.every(p => p.accepted.length === 1)).toBe(true);
    const kept = withRubricSnapshot(storedStages(results), snap)!;
    expect(snapshotOf(kept)?.parts?.map(p => p.marks)).toEqual([1, 2, 2]);
  });
  it("the 791 attempt snapshot keeps the stages as presented and as keyed, and reads the question back as it was answered", () => {
    const q = row();
    const snap = buildAttemptSnapshot(q, { attemptId: "a1", answeredAt: "2026-11-02T10:00:00Z", chosenIndex: null, response: storedStages(results), correct: false, score: 0.4, marking: "ai_evaluation" })!;
    expect(snap.presented.parts).toHaveLength(3);
    expect(snap.presented.parts![1]).toContain("Urine stays in the bladder.");
    expect(((snap.answerKey as any).stages as any[]).map(s => s.weight)).toEqual([1, 2, 2]);
    expect(snap.response).toMatchObject({ kind: "scenario" });
    // the question is later edited (a stage's key point and weight): the attempt is still read against the stages it was marked on
    const edited = row({ answer: { ...(q.answer as any), stages: (q.answer as any).stages.map((s: any, i: number) => (i === 1 ? { ...s, keyPoint: "Something else.", weight: 5 } : s)) } });
    const asAnswered = applyAssessedSnapshot(edited, snap);
    expect(scenarioSpecOf(asAnswered.answer)?.stages[1]).toMatchObject({ weight: 2, keyPoint: "Urinary retention raises the risk because urine stays in the bladder." });
  });
});

describe("the feedback after a scenario: every stage's key point, the weighted marks, and the provenance line", () => {
  const results: StageResult[] = [{ score: 1, by: "code", answer: "Escherichia coli" }, { score: 0.5, by: "ai", answer: "increased risk", feedback: "Partly right." }, { score: 0, by: "code", answer: "Fluids" }];
  it("shows each stage's new information, key, key point and how it was marked, and the marks summed with the weights", () => {
    const f = feedbackView(row(), { correct: false, score: 0.4, marking: "ai_evaluation", scenario: results, justMarked: true });
    expect(f.scenario?.practiceMarks).toMatchObject({ awarded: 2, total: 5 });
    expect(f.scenario?.stages.map(s => s.keyPoint)).toEqual(["Escherichia coli is the commonest cause.", "Urinary retention raises the risk because urine stays in the bladder.", "Treatment is with antibiotics and fluids."]);
    expect(f.scenario?.stages.map(s => s.awarded)).toEqual([1, 1, 0]);
    expect(f.scenario?.stages[1].evaluation?.feedback).toBe("Partly right.");
    expect(f.scenario?.stages[0].evaluation).toBeNull();
    expect(f.markedAgainst).toMatch(/^Marked stage by stage \(3 stages, weighted 1 \/ 2 \/ 2\)/);
  });
  it("re-shown later it reads the same from what the attempt kept (keptAttemptView)", () => {
    const q = row();
    const kept = withRubricSnapshot(storedStages(results), rubricSnapshotOf(q))!;
    const view = keptAttemptView(q, { response: kept, marking: "deterministic" });
    expect((view as any).scenario).toHaveLength(3);
    const f = feedbackView(q, { correct: false, score: 0.4, marking: "deterministic", ...view });
    expect(f.scenario?.practiceMarks.awarded).toBe(2);
    expect(f.scenario?.stages[2].yourAnswer).toBe("Fluids");
    expect(f.markedAgainst).toContain("guide as saved when you answered");
  });
  it("an attempt that kept no per-stage record shows only the share of the total, never a stage mark it does not have", () => {
    const f = feedbackView(row(), { correct: false, score: 0.4, marking: "deterministic" });
    expect(f.scenario?.practiceMarks.awarded).toBe(2);
    expect(f.scenario?.stages.every(s => s.awarded === null && s.score === null)).toBe(true);
  });
});
