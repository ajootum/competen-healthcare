import { describe, expect, it } from "vitest";
import { CHECK_RESPONSE_BUDGET, asFeedbackParts, checkOutcomeLabel, checkResponse, historyToPriorChecks, parseCheckResponse, placeChecks } from "./learn-check-record";

const para = "The nurse watches the breathing rate and the level of alertness because a change in either is the earliest sign that a child is deteriorating and needs help [S1].";
const long = Array(6).fill(para) as string[];

describe("CYU-01 placeChecks: the checks follow the teaching sequence and never interrupt it", () => {
  it("two questions on a substantial lesson: the first after the teaching, the second at the end", () => {
    expect(placeChecks({ understanding: long, questions: ["q1 [S1]", "q2 [S2]"] }, { placement: "distributed" })).toEqual({ mid: [0], end: [1] });
  });
  it("a single question, a short or older lesson, or the lesson_end policy keeps the checks at the end", () => {
    expect(placeChecks({ understanding: long, questions: ["q1"] }, { placement: "distributed" })).toEqual({ mid: [], end: [0] });
    expect(placeChecks({ understanding: [para], questions: ["q1", "q2"] }, { placement: "distributed" })).toEqual({ mid: [], end: [0, 1] });
    expect(placeChecks({ understanding: undefined, questions: ["q1", "q2"] }, { placement: "distributed" })).toEqual({ mid: [], end: [0, 1] });
    expect(placeChecks({ understanding: long, questions: ["q1", "q2"] }, { placement: "lesson_end" })).toEqual({ mid: [], end: [0, 1] });
    expect(placeChecks({ understanding: long, questions: [] }, { placement: "distributed" })).toEqual({ mid: [], end: [] });
  });
});

describe("CYU-03 the kept answer (416 response)", () => {
  it("round-trips with its verdict and parts, and an unjudged one with the learner's own grade", () => {
    const fb = { right: ["escalates [S1]"], missing: ["the signs [S1]"], misconceptions: [], keyPoints: ["a [S1]", "b [S2]"], next: "re-read [S1]" };
    const stored = checkResponse({ text: "  the nurse escalates ", question: "How is a deteriorating child recognised?", verdict: "partly", feedback: fb });
    const back = parseCheckResponse(stored)!;
    expect(back.text).toBe("the nurse escalates");
    expect(back.verdict).toBe("partly");
    expect(back.feedback).toEqual(fb);
    expect(back.selfGrade).toBeNull();
    const self = parseCheckResponse(checkResponse({ text: "x", question: "q", selfGrade: "partly" }))!;
    expect(self.selfGrade).toBe("partly");
    expect(self.feedback).toBeNull();
    expect(parseCheckResponse({ kind: "other", text: "x" })).toBeNull();
    expect(parseCheckResponse(null)).toBeNull();
  });
  it("an oversized judgement is cut to the budget, the answer always kept", () => {
    const big = Array(40).fill("a key point that goes on at some length to fill the budget of the stored response [S1]") as string[];
    const stored = checkResponse({ text: "my answer", question: "q", verdict: "not_yet", feedback: { right: big, missing: big, misconceptions: big, keyPoints: big, next: "n" } });
    expect(new TextEncoder().encode(JSON.stringify(stored)).length).toBeLessThanOrEqual(CHECK_RESPONSE_BUDGET);
    expect(parseCheckResponse(stored)!.text).toBe("my answer");
    const summary = checkResponse({ text: "t", question: "q", summary: "s".repeat(9000) });
    expect(new TextEncoder().encode(JSON.stringify(summary)).length).toBeLessThanOrEqual(CHECK_RESPONSE_BUDGET);
  });
  it("the five written-feedback parts: key points become why the answer holds", () => {
    expect(asFeedbackParts({ right: ["r"], missing: [], misconceptions: [], keyPoints: ["k1", "k2"], next: null })).toEqual({ right: ["r"], missing: [], misconceptions: [], why: "k1 k2", next: null });
  });
});

describe("CYU-04 the history", () => {
  const item = (id: string, at: string, verdict: "understood" | "not_yet" | null, marking: "ai_evaluation" | "self_graded" | "unmarked") => ({
    attemptId: id, questionId: "q", answeredAt: at, question: "Q?", marking, correct: verdict === "understood", score: null, model: null, promptVersion: null, contentVersion: 1,
    sessionId: "s", step: 2, chunkId: "c", materialId: "m",
    response: { kind: "check" as const, text: `answer ${id}`, question: "Q?", verdict, selfGrade: marking === "self_graded" ? ("partly" as const) : null, feedback: null, summary: verdict ? "fb" : null },
  });
  const items = [item("b", "2026-11-04T10:00:00Z", "not_yet", "ai_evaluation"), item("a", "2026-11-03T10:00:00Z", "understood", "ai_evaluation"), item("c", "2026-11-04T11:00:00Z", null, "self_graded")];
  it("becomes prior checks oldest first, bounded to the newest", () => {
    const prior = historyToPriorChecks(items, 2);
    expect(prior.map(p => p.answer)).toEqual(["answer b", "answer c"]);
    expect(prior[0]).toMatchObject({ verdict: "not_yet", feedback: "fb" });
  });
  it("each kept check names its outcome honestly", () => {
    const L = { understood: "Understood", partly: "Partly", not_yet: "Not yet" };
    expect(checkOutcomeLabel(items[0], L)).toBe("Not yet");
    expect(checkOutcomeLabel(items[2], L)).toMatch(/some of the key points/);
    expect(checkOutcomeLabel(item("d", "2026-11-04T12:00:00Z", null, "unmarked"), L)).toBe("Not marked");
  });
});
