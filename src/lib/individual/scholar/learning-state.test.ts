import { describe, expect, it } from "vitest";
import { buildLearningState, topicLearningState, type StateEvidence } from "./learning-state";

// SALE-2026-11 R1 / SALE-04: word states, "not enough evidence", different questions, delayed recall, never a number.

const T = { key: "fluid balance", label: "Fluid balance", materialId: "m", chunkIds: ["c1"] };
const NOW = "2026-11-04T12:00:00Z";
const ev = (o: Partial<StateEvidence>): StateEvidence => ({ itemId: "q1", attemptId: null, topicKey: T.key, chunkId: "c1", materialId: "m", source: "check", level: "unknown", outcome: 1, marking: "ai_evaluation", at: "2026-11-04T10:00:00Z", confidence: null, misconceptions: [], ...o });
const dim = (s: ReturnType<typeof topicLearningState>, k: string) => s.dimensions.find(d => d.key === k)!;

describe("SALE-04 learning state", () => {
  it("no evidence: no conclusion, every dimension says so", () => {
    const s = topicLearningState(T, [], [], NOW);
    expect(s.enough).toBe(false);
    expect(s.headline).toMatch(/draws no conclusion/);
    expect(dim(s, "understanding").word).toBe("none");
  });
  it("one right answer is not enough evidence; a right answer on a DIFFERENT question adds to it", () => {
    const one = topicLearningState(T, [ev({ marking: "code" }), ev({ marking: "code", at: "2026-11-04T10:05:00Z" })], [], NOW);
    expect(dim(one, "understanding").word).toBe("thin");
    expect(dim(one, "understanding").summary).toMatch(/limited evidence/);
    const two = topicLearningState(T, [ev({ marking: "code" }), ev({ itemId: "q2", marking: "code" })], [], NOW);
    expect(dim(two, "understanding").word).toBe("some");
    expect(two.enough).toBe(true);
  });
  it("AI-evaluated and self-rated answers count less; unmarked ones not at all", () => {
    const ai = topicLearningState(T, [ev({}), ev({ itemId: "q2" }), ev({ itemId: "q3", marking: "unmarked", outcome: null })], [], NOW);
    expect(ai.enough).toBe(false); // 0.5 + 0.5 + 0 = 1, below the default minEvidence of 2
    expect(ai.headline).toMatch(/Not enough evidence/);
    expect(topicLearningState(T, [ev({ marking: "code" }), ev({ itemId: "q2", marking: "code" })], [], NOW).enough).toBe(true);
  });
  it("is never a percentage, never competence", () => {
    const s = topicLearningState(T, [ev({ marking: "code" }), ev({ itemId: "q2", marking: "code", outcome: 0 })], [], NOW);
    const text = JSON.stringify(s);
    expect(text).not.toMatch(/\d+%/);
    expect(text).not.toMatch(/competent|mastery|mastered/i);
  });
  it("delayed recall needs a right answer days after first meeting the topic", () => {
    const early = topicLearningState(T, [ev({ at: "2026-11-01T10:00:00Z", outcome: 0, marking: "code" }), ev({ at: "2026-11-04T10:00:00Z", marking: "code" })], [], NOW);
    expect(dim(early, "delayed").summary).toMatch(/answered well 3 or more days/);
    const sameDay = topicLearningState(T, [ev({ marking: "code" })], [], NOW);
    expect(dim(sameDay, "delayed").summary).toMatch(/No right answer yet/);
  });
  it("a misconception repeated on different questions is called likely; stated confidence never counts", () => {
    const s = topicLearningState(T, [
      ev({ outcome: 0, misconceptions: ["Thinks X"], confidence: "sure" }), ev({ itemId: "q2", outcome: 0, misconceptions: ["Thinks X"] }),
    ], [], NOW);
    expect(dim(s, "misconceptions").word).toBe("stronger");
    expect(dim(s, "confidence").summary).toMatch(/1 you were sure of was not fully right/);
    expect(dim(s, "understanding").word).toBe("thin");
  });
  it("exposure is shown apart from understanding", () => {
    const s = topicLearningState(T, [], [{ topicKey: T.key, chunkId: "c1", action: "teach", at: "2026-11-03T10:00:00Z" }], NOW);
    expect(dim(s, "exposure").word).toBe("some");
    expect(dim(s, "understanding").word).toBe("none");
    expect(s.enough).toBe(false);
  });
  it("groups by topic, the most recent first", () => {
    const out = buildLearningState({ topics: [T, { key: "b", label: "B", materialId: "m", chunkIds: [] }], evidence: [ev({}), ev({ topicKey: "b", at: "2026-11-04T11:00:00Z" })], exposure: [], now: NOW });
    expect(out.map(o => o.key)).toEqual(["b", "fluid balance"]);
  });
});
