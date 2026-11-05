import { describe, expect, it } from "vitest";
import { CASE_REASONING_SYSTEM, EVALUATE_EXTENDED_SYSTEM, EVALUATE_SYSTEM, UNSAFE_UNQUOTED, parseEvaluation, runCaseReasoning, runEvaluate, unsafeQuotes, type Passage } from "./generation";
import { feedbackPartsFrom, feedbackText, UNSAFE_RULE } from "./question-intel";
import { formativeFeedback } from "./written-feedback";
import { PROMPT_VERSIONS } from "./config";
import { extendedMarks } from "./formats";

// SQIE-CLOSE-2026-11 WS-B (owner GO SALE-2026-11, 4 Nov 2026): explicit handling of clinically unsafe written answers. The AI
// evaluator of a written answer (short, extended, each structured part, each scenario stage, a case's written decision) must say
// whether the answer contains a statement that would be unsafe if done in practice, QUOTING the answer. An unsafe answer is marked
// incorrect and earns nothing; the statement is shown first, in the learner's own words, and kept with the attempt. Formative only.

const SEPSIS = "Give oxygen, take blood cultures and give intravenous antibiotics within one hour. Escalate to the medical team if the early warning score rises.";
const passage: Passage = { chunkId: "c", materialId: "m", materialTitle: "Sepsis notes", ordinal: 1, pageFrom: 1, pageTo: 1, content: SEPSIS };
const ANSWER = "Wait until tomorrow before giving antibiotics, and give oxygen.";
const grounding = [SEPSIS, ANSWER, "What is done within one hour?"];
const PARTS = "RIGHT: give oxygen\nMISSING: give intravenous antibiotics within one hour\nMISCONCEPTIONS: none\nWHY: Give intravenous antibiotics within one hour.\nNEXT: Revise when to give intravenous antibiotics.";

describe("the prompts ask for it, and the versions say so", () => {
  it("evaluate, extended and case reasoning carry the UNSAFE rule; the versions are bumped", () => {
    for (const s of [EVALUATE_SYSTEM, EVALUATE_EXTENDED_SYSTEM, CASE_REASONING_SYSTEM]) expect(s).toContain(UNSAFE_RULE);
    expect(PROMPT_VERSIONS.evaluate).toBe("scholar-evaluate-v4");
    expect(PROMPT_VERSIONS.caseReasoning).toBe("scholar-case-reasoning-v3");
  });
});

describe("unsafeQuotes: only the answer's own words", () => {
  it("none is none", () => {
    expect(unsafeQuotes("none", ANSWER)).toEqual([]);
    expect(unsafeQuotes(" None. ", ANSWER)).toEqual([]);
  });
  it("keeps quotes found in the answer (normalised), at most three", () => {
    expect(unsafeQuotes('"Wait until tomorrow before giving antibiotics"', ANSWER)).toEqual(["Wait until tomorrow before giving antibiotics"]);
    expect(unsafeQuotes("wait until TOMORROW; before giving antibiotics", ANSWER)).toEqual(["wait until TOMORROW", "before giving antibiotics"]);
  });
  it("a flag whose words are not in the answer stays a flag, without the invented words", () => {
    expect(unsafeQuotes("Withhold all fluids", ANSWER)).toEqual([UNSAFE_UNQUOTED]);
  });
});

describe("parseEvaluation with the safety line", () => {
  const safety = { safety: { answer: ANSWER } };
  it("a reply without the UNSAFE line is not used (fail closed)", () => {
    expect(parseEvaluation(`VERDICT: partly\n${PARTS}`, grounding, safety)).toEqual({ ok: false, reason: "malformed" });
  });
  it("UNSAFE: none leaves the verdict and score as the evaluator gave them", () => {
    const e = parseEvaluation(`VERDICT: partly\nUNSAFE: none\n${PARTS}`, grounding, safety);
    expect(e.ok && [e.verdict, e.score, e.unsafe, e.parts?.unsafe]).toEqual(["partly", 0.5, undefined, undefined]);
  });
  it("an unsafe statement is flagged and shown first in the learner's words; the verdict stands (owner 4 Nov 2026: the cap is the caller's, gated)", () => {
    const e = parseEvaluation(`VERDICT: partly\nUNSAFE: wait until tomorrow before giving antibiotics\n${PARTS}`, grounding, safety);
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect([e.verdict, e.score]).toEqual(["partly", 0.5]);
    expect(e.unsafe).toEqual(["wait until tomorrow before giving antibiotics"]);
    expect(e.parts?.unsafe).toEqual(e.unsafe);
    expect(e.feedback.split("\n")[0]).toMatch(/^Unsafe if done in practice: wait until tomorrow/);
  });
  it("an extended answer flagged unsafe keeps the key points it made; the flag travels with it for the (gated) cap", () => {
    const e = parseEvaluation(`VERDICT: correct\nMATCHED: 1, 2\nUNSAFE: wait until tomorrow before giving antibiotics\n${PARTS}`, grounding, { keyPoints: 2, ...safety });
    expect(e.ok && [e.matched, e.unsafe]).toEqual([[0, 1], ["wait until tomorrow before giving antibiotics"]]);
    expect(extendedMarks({ modelAnswer: "x", keyPoints: ["a", "b"], marks: 2 } as never, []).score).toBe(0);
  });
  it("without the option the parser is exactly as before (paper and other callers)", () => {
    const e = parseEvaluation(`VERDICT: partly\n${PARTS}`, grounding);
    expect(e.ok && [e.verdict, e.score, e.unsafe]).toEqual(["partly", 0.5, undefined]);
  });
});

describe("kept with the attempt and read back", () => {
  it("the formative record keeps the unsafe statements; the text puts them first", () => {
    const parts = { right: ["give oxygen"], missing: [], misconceptions: [], why: null, next: null, unsafe: ["wait until tomorrow"] };
    const fb = formativeFeedback([{ part: null, feedback: feedbackText(parts), parts }], { model: "m", promptVersion: PROMPT_VERSIONS.evaluate });
    expect(fb?.items[0].parts?.unsafe).toEqual(["wait until tomorrow"]);
    expect(feedbackPartsFrom(JSON.parse(JSON.stringify(fb?.items[0].parts)))?.unsafe).toEqual(["wait until tomorrow"]);
    expect(feedbackText(parts).startsWith("Unsafe if done in practice: wait until tomorrow.")).toBe(true);
    expect(feedbackPartsFrom({ right: ["x"] })?.unsafe).toBeUndefined();
  });
});

describe("the runners send the rule and parse with it", () => {
  const fake = (text: string) => async () => ({ ok: true as const, text, model: "claude-test", provider: "anthropic" });
  it("runEvaluate: an unsafe short answer comes back flagged with the quote", async () => {
    const r = await runEvaluate("u", { question: "What is done within one hour?", accepted: ["give intravenous antibiotics"], answer: ANSWER, passage }, fake(`VERDICT: partly\nUNSAFE: Wait until tomorrow before giving antibiotics\n${PARTS}`) as never);
    expect(r.ok && r.evaluation.ok && [r.evaluation.verdict, r.evaluation.unsafe]).toEqual(["partly", ["Wait until tomorrow before giving antibiotics"]]);
    expect(r.ok && r.promptVersion).toBe("scholar-evaluate-v4");
  });
  it("runCaseReasoning: the same for a written case decision", async () => {
    const r = await runCaseReasoning("u", { prompt: "What is done within one hour?", expected: "Give intravenous antibiotics within one hour.", facts: [], answer: ANSWER, passages: [passage] }, fake(`VERDICT: correct\nUNSAFE: wait until tomorrow before giving antibiotics\n${PARTS}`) as never);
    expect(r.ok && r.evaluation.ok && r.evaluation.unsafe).toEqual(["wait until tomorrow before giving antibiotics"]);
    expect(r.ok && r.promptVersion).toBe("scholar-case-reasoning-v3");
  });
  it("a runner reply with no safety line is withheld (the learner compares it themselves)", async () => {
    const r = await runEvaluate("u", { question: "What is done within one hour?", accepted: ["antibiotics"], answer: ANSWER, passage }, fake(`VERDICT: correct\n${PARTS}`) as never);
    expect(r.ok && r.evaluation).toEqual({ ok: false, reason: "malformed" });
  });
});
