import { describe, expect, it } from "vitest";
import { cleanTopic, isTransferOutside, lessonContext, outsideOf, pickTransfer, transferOffered, type TransferCandidate } from "./transfer";
import { topicLearningState, type StateEvidence } from "./learning-state";

const ev = (o: Partial<StateEvidence> & { itemId: string }): StateEvidence => ({
  attemptId: null, topicKey: "oxygen therapy", chunkId: "c1", materialId: "m1", source: "check", level: "understanding",
  outcome: 1, marking: "code", at: "2026-11-01T09:00:00Z", confidence: null, misconceptions: [], ...o,
});
const cand = (o: Partial<TransferCandidate> & { id: string }): TransferCandidate => ({ chunkId: "c1", materialId: "m1", level: null, difficulty: 2, check: false, library: false, answered: false, ...o });

describe("SALE-10 transfer of learning", () => {
  const rows = [ev({ itemId: "k1" }), ev({ itemId: "k2", chunkId: "c2" }), ev({ itemId: "p1", source: "practice", chunkId: "c3" })];
  const ctx = lessonContext(rows, [{ topicKey: "oxygen therapy", chunkId: "c4", action: "teach", at: "2026-11-01T08:00:00Z" }, { topicKey: "oxygen therapy", chunkId: "c9", action: "ask_me", at: "2026-11-01T08:00:00Z" }]);

  it("the lesson context: taught sections and lesson-check sections, not practice-only or non-teaching actions", () => {
    expect(ctx.contextChunkIds.sort()).toEqual(["c1", "c2", "c4"]);
    expect(ctx.materialIds).toEqual(["m1"]);
    expect(ctx.answeredIds).toEqual(["k1", "k2", "p1"]);
  });
  it("outsideOf: answered or a lesson check is inside; library, other notes, other sections, a new question are outside", () => {
    expect(outsideOf(cand({ id: "k1" }), ctx)).toBeNull();
    expect(outsideOf(cand({ id: "x", answered: true }), ctx)).toBeNull();
    expect(outsideOf(cand({ id: "x", check: true, chunkId: "c7" }), ctx)).toBeNull();
    expect(outsideOf(cand({ id: "x", library: true }), ctx)).toBe("library");
    expect(outsideOf(cand({ id: "x", chunkId: "c8", materialId: "m2" }), ctx)).toBe("other_material");
    expect(outsideOf(cand({ id: "x", chunkId: "c8" }), ctx)).toBe("other_section");
    expect(outsideOf(cand({ id: "x", chunkId: "c1" }), ctx)).toBe("new_question");
  });
  it("pickTransfer: the most outside first, application and reasoning first within each, at most n", () => {
    const pool = [cand({ id: "new" }), cand({ id: "sec", chunkId: "c8" }), cand({ id: "sec-app", chunkId: "c8", level: "application" }), cand({ id: "lib", library: true }), cand({ id: "seen", answered: true, library: true })];
    expect(pickTransfer(pool, ctx, 3)).toEqual([{ questionId: "lib", outside: "library" }, { questionId: "sec-app", outside: "other_section" }, { questionId: "sec", outside: "other_section" }]);
    expect(pickTransfer([cand({ id: "k1" })], ctx, 2)).toEqual([]);
    expect(pickTransfer([cand({ id: "d3", difficulty: 3, chunkId: "c8" }), cand({ id: "d1", difficulty: 1, chunkId: "c8" })], ctx, 1)).toEqual([{ questionId: "d3", outside: "other_section" }]);
  });
  it("X1: offered only once some understanding is shown, and not again after a transfer answer went well", () => {
    expect(transferOffered([ev({ itemId: "k1" })], 2).offered).toBe(false);
    expect(transferOffered([ev({ itemId: "k1" }), ev({ itemId: "k2", outcome: 0 })], 2).offered).toBe(false);
    expect(transferOffered([ev({ itemId: "k1" }), ev({ itemId: "k2" })], 2)).toMatchObject({ offered: true });
    expect(transferOffered([ev({ itemId: "k1" }), ev({ itemId: "k2" }), ev({ itemId: "t1", transfer: "library" })], 2).offered).toBe(false);
    // a missed transfer answer leaves it on offer
    expect(transferOffered([ev({ itemId: "k1" }), ev({ itemId: "k2" }), ev({ itemId: "t1", transfer: "library", outcome: 0 })], 2).offered).toBe(true);
    // card reviews are not understanding of a question
    expect(transferOffered([ev({ itemId: "k1", source: "review", marking: "self" }), ev({ itemId: "k2", source: "review", marking: "self" })], 2).offered).toBe(false);
  });
  it("A2: a transfer answer is application evidence in the learning state, said apart, whatever its level", () => {
    const t = topicLearningState({ key: "oxygen therapy", label: "Oxygen therapy", materialId: "m1", chunkIds: ["c1"] },
      [ev({ itemId: "k1" }), ev({ itemId: "k2" }), ev({ itemId: "t1", source: "practice", level: "recall", transfer: "other_section", at: "2026-11-03T09:00:00Z" })], [], "2026-11-04T00:00:00Z");
    const app = t.dimensions.find(d => d.key === "application")!;
    expect(app.rule).toBe("A1/A2");
    expect(app.summary).toMatch(/Transfer checks .*1 of 1 answered well/);
    expect(t.evidence[0]).toMatchObject({ itemId: "t1", transfer: "other_section" });
  });
  it("A2 absent without a transfer answer (R1 behaviour unchanged)", () => {
    const t = topicLearningState({ key: "x", label: "X", materialId: "m1", chunkIds: [] }, [ev({ itemId: "k1", level: "application" })], [], "2026-11-04T00:00:00Z");
    const app = t.dimensions.find(d => d.key === "application")!;
    expect(app.rule).toBe("A1");
    expect(app.summary).not.toMatch(/Transfer/);
  });
  it("cleanTopic and isTransferOutside validate what is stored", () => {
    expect(cleanTopic("  Oxygen   therapy ")).toBe("Oxygen therapy");
    expect(cleanTopic("x")).toBeNull();
    expect(cleanTopic("a".repeat(121))).toBeNull();
    expect(cleanTopic(5)).toBeNull();
    expect(isTransferOutside("library")).toBe(true);
    expect(isTransferOutside("elsewhere")).toBe(false);
  });
});
