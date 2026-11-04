import { describe, expect, it } from "vitest";
import {
  TEACHING_RULES, adaptiveForStorage, decideNext, identifyNeed, parseAdaptiveRecord, parseFollowUp, pickDifferentQuestion, priorRounds,
  type ApproachAvailability, type CheckOutcome, type PriorCheckOutcome,
} from "./learning-need";

// SALE-2026-11 R1: SALE-05 identification, SALE-06 rule table, SALE-07 loop. Pure, no AI.

const ALL: ApproachAvailability = { actions: ["teach", "explain", "simplify", "deeper", "examples", "summary", "ask", "ask_me", "guide", "challenge", "mistake", "teach_back", "high_yield"], aiAvailable: true, hasFoundation: false, applyAvailable: false };
const cur = (o: Partial<CheckOutcome> = {}): CheckOutcome => ({ questionId: "q1", stem: "What is X?", verdict: "not_yet", selfGrade: null, feedback: { right: [], missing: ["fact A"], misconceptions: [] }, level: null, ...o });
let n = 0;
const prior = (o: Partial<PriorCheckOutcome> = {}): PriorCheckOutcome => ({ attemptId: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, questionId: `p${n}`, stem: `Prior ${n}?`, at: "2026-11-01T10:00:00Z", step: 0, sessionId: "s", outcome: "wrong", misconceptions: [], adaptive: null, ...o });

describe("SALE-05 identifyNeed", () => {
  it("understood when judged understood or the learner covered the key points", () => {
    expect(identifyNeed(cur({ verdict: "understood" }), [], { hasFoundation: false }).need).toBe("understood");
    expect(identifyNeed(cur({ verdict: null, selfGrade: "covered" }), [], { hasFoundation: false }).need).toBe("understood");
  });
  it("unclear when kept without a mark", () => {
    expect(identifyNeed(cur({ verdict: null, selfGrade: null }), [], { hasFoundation: false })).toMatchObject({ need: "unclear", rule: "N2" });
  });
  it("factual gap when key points were missing and nothing was right", () => {
    expect(identifyNeed(cur(), [], { hasFoundation: false })).toMatchObject({ need: "factual_gap", rule: "N6" });
  });
  it("reasoning error when partly right with some points right, or on an application question", () => {
    expect(identifyNeed(cur({ verdict: "partly", feedback: { right: ["a"], missing: ["b"], misconceptions: [] } }), [], { hasFoundation: false }).need).toBe("reasoning_error");
    expect(identifyNeed(cur({ level: "application" }), [], { hasFoundation: false }).need).toBe("reasoning_error");
    expect(identifyNeed(cur({ verdict: null, selfGrade: "partly", feedback: null }), [], { hasFoundation: false }).need).toBe("reasoning_error");
  });
  it("misconception when the feedback names one, or a known tag repeats on a DIFFERENT question", () => {
    const named = identifyNeed(cur({ feedback: { right: [], missing: [], misconceptions: ["Thinks oxygen lowers the respiratory drive in every patient"] } }), [], { hasFoundation: false });
    expect(named).toMatchObject({ need: "misconception", rule: "N4" });
    expect(named.misconception).toMatch(/oxygen/);
    const tagged = identifyNeed(cur({ tags: ["confuses preload with afterload"] }), [prior({ misconceptions: ["Confuses preload with afterload"] })], { hasFoundation: false });
    expect(tagged.need).toBe("misconception");
    // the same question missed before is not a repeat
    expect(identifyNeed(cur({ tags: ["confuses preload with afterload"] }), [prior({ questionId: "q1", misconceptions: ["confuses preload with afterload"] })], { hasFoundation: false }).need).toBe("factual_gap");
  });
  it("prerequisite gap only with an earlier lesson AND several different questions missed, never from one miss", () => {
    const two = [prior(), prior()];
    expect(identifyNeed(cur(), two, { hasFoundation: true }).need).toBe("prerequisite_gap");
    expect(identifyNeed(cur(), two, { hasFoundation: false }).need).not.toBe("prerequisite_gap");
    expect(identifyNeed(cur(), [prior()], { hasFoundation: true }).need).not.toBe("prerequisite_gap");
    // the same question missed three times is one question
    expect(identifyNeed(cur(), [prior({ questionId: "q1" }), prior({ questionId: "q1" })], { hasFoundation: true }).need).not.toBe("prerequisite_gap");
  });
});

describe("SALE-06 rule table", () => {
  it("maps every need to an existing approach, with the owner's examples", () => {
    const by = Object.fromEntries(TEACHING_RULES.map(r => [r.need, r.approach]));
    expect(by).toMatchObject({ factual_gap: "simplify", reasoning_error: "guide", prerequisite_gap: "foundation", understood: "challenge", misconception: "mistake" });
    for (const r of TEACHING_RULES) expect(r.why.length).toBeGreaterThan(20);
  });
  it("a wrong answer changes the next action, and the decision says why", () => {
    const wrong = decideNext({ current: cur(), lesson: [], section: [], availability: ALL });
    const right = decideNext({ current: cur({ verdict: "understood" }), lesson: [], section: [], availability: ALL });
    expect(wrong).toMatchObject({ need: "factual_gap", approach: "simplify", rule: "T3", round: 1, differentQuestion: true });
    expect(right).toMatchObject({ need: "understood", approach: "challenge", round: 0, differentQuestion: false });
    expect(wrong.reason).toMatch(/simpler explanation/);
  });
  it("falls back, and says so, when an approach is not offered or AI is unavailable", () => {
    const noGuide = decideNext({ current: cur({ level: "reasoning" }), lesson: [], section: [], availability: { ...ALL, actions: ALL.actions.filter(a => a !== "guide") } });
    expect(noGuide.approach).toBe("examples");
    expect(noGuide.reason).toMatch(/Guide me is not offered here/);
    const noAi = decideNext({ current: cur(), lesson: [], section: [], availability: { ...ALL, aiAvailable: false, hasFoundation: true } });
    expect(noAi.approach).toBe("foundation");
    expect(noAi.reason).toMatch(/AI help is not available/);
    expect(decideNext({ current: cur(), lesson: [], section: [], availability: { ...ALL, aiAvailable: false } }).approach).toBe("review");
  });
  it("understood on an application question with a case available applies it", () => {
    expect(decideNext({ current: cur({ verdict: "understood", level: "application" }), lesson: [], section: [], availability: { ...ALL, applyAvailable: true } }).approach).toBe("apply");
  });
});

describe("SALE-07 loop", () => {
  it("caps corrective rounds by policy, then suggests review", () => {
    const r1 = decideNext({ current: cur(), lesson: [], section: [], availability: ALL, thresholds: { reteachMax: 2 } });
    const after1 = [prior({ adaptive: r1 })];
    const r2 = decideNext({ current: cur(), lesson: after1, section: [], availability: ALL, thresholds: { reteachMax: 2 } });
    expect(r2.round).toBe(2);
    const r3 = decideNext({ current: cur(), lesson: [prior({ adaptive: r2 })], section: [], availability: ALL, thresholds: { reteachMax: 2 } });
    expect(r3).toMatchObject({ round: 3, capped: true, approach: "review", differentQuestion: false });
    expect(r3.rule).toBe("T3/cap");
    // an understood answer resets the count
    expect(priorRounds([prior({ outcome: "right" }), prior({ adaptive: r2 })])).toBe(0);
  });
  it("a right answer on a different question after a correction says it is stronger evidence", () => {
    const d = decideNext({ current: cur({ verdict: "understood" }), lesson: [], section: [], availability: ALL, follows: { attemptId: "a", approach: "simplify", differentQuestion: true } });
    expect(d.reason).toMatch(/After simplify, you answered a different question well/);
    const same = decideNext({ current: cur({ verdict: "understood" }), lesson: [], section: [], availability: ALL, follows: { attemptId: "a", approach: "simplify", differentQuestion: false } });
    expect(same.reason).toMatch(/same question/);
  });
  it("prefers the lesson's own unanswered question, then an earlier one, else none (Ask me)", () => {
    expect(pickDifferentQuestion({ lessonQuestions: ["What is X? [S1]", "Why does Y happen? [S2]"], answered: ["What is X?"], earlier: ["Old?"] })).toEqual({ stem: "Why does Y happen? [S2]", source: "lesson" });
    expect(pickDifferentQuestion({ lessonQuestions: ["What is X?"], answered: ["what is x"], earlier: ["Old one?"] })).toEqual({ stem: "Old one?", source: "earlier" });
    expect(pickDifferentQuestion({ lessonQuestions: ["What is X?"], answered: ["What is X?"], earlier: [] })).toBeNull();
  });
  it("stores a bounded record and reads it back; malformed input is null", () => {
    const d = decideNext({ current: cur(), lesson: [], section: [], availability: ALL });
    const stored = adaptiveForStorage({ ...d, reason: "x".repeat(2000) });
    expect(JSON.stringify(stored).length).toBeLessThan(1500);
    expect(parseAdaptiveRecord(JSON.parse(JSON.stringify(stored)))).toMatchObject({ need: "factual_gap", approach: "simplify" });
    expect(parseAdaptiveRecord({ v: 2 })).toBeNull();
    expect(parseAdaptiveRecord({ v: 1, need: "x", approach: "simplify", reason: "r" })).toBeNull();
    expect(parseFollowUp({ afterAttemptId: "not-a-uuid" })).toBeNull();
    expect(parseFollowUp({ afterAttemptId: "00000000-0000-4000-8000-000000000001", approach: "simplify" })).toEqual({ attemptId: "00000000-0000-4000-8000-000000000001", approach: "simplify" });
  });
});
