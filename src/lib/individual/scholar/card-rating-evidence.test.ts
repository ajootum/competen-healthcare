// A rating is stored as an attempt AND a review (391), and the review is the one record of it. A governed library question
// studied as a card keeps its stored kind `mcq`, which is how the same rating came to be counted twice.
import { describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ evidence: [] as { kind: string; itemId: string }[] }));
vi.mock("./store", () => ({
  masteryEvidence: async () => ({
    ok: true,
    data: {
      questions: [
        { id: "lib", kind: "mcq", materialId: "m", chunkId: "c", topic: "T", level: null, difficulty: null, competencyId: null },
        { id: "own", kind: "flashcard", materialId: "m", chunkId: "c", topic: "T", level: null, difficulty: null, competencyId: null },
      ],
      attempts: [
        { questionId: "lib", correct: true, score: 1, marking: "self_graded", answeredAt: "2026-11-01T10:00:00Z" },
        { questionId: "lib", correct: true, score: 1, marking: "deterministic", answeredAt: "2026-11-02T10:00:00Z" },
        { questionId: "own", correct: true, score: 1, marking: "self_graded", answeredAt: "2026-11-01T10:00:00Z" },
      ],
      reviews: [{ cardId: "k1", quality: 4, reviewedAt: "2026-11-01T10:00:00Z" }, { cardId: "k2", quality: 4, reviewedAt: "2026-11-01T10:00:00Z" }],
      cards: [{ id: "k1", questionId: "lib", materialId: "m", status: "active", nextReviewAt: "2026-12-01" }, { id: "k2", questionId: "own", materialId: "m", status: "active", nextReviewAt: "2026-12-01" }],
      osce: [], stations: [], truncated: false,
    },
  }),
}));
vi.mock("./mastery", () => ({ buildMastery: (i: { evidence: { kind: string; itemId: string }[] }) => { seen.evidence = i.evidence; return {}; } }));

import { isCardRating } from "./flashcards";
import { loadMastery } from "./mastery-data";

describe("a card rating counts once", () => {
  it("names a rating, and never a multiple-choice answer marked by code", () => {
    expect(isCardRating("flashcard", "self_graded")).toBe(true);
    expect(isCardRating("mcq", "self_graded")).toBe(true);
    expect(isCardRating("mcq", "deterministic")).toBe(false);
    expect(isCardRating("mcq", undefined)).toBe(false);
    expect(isCardRating("short", "self_graded")).toBe(false);
  });
  it("a library question studied as a card gives one review, and its real answer still counts", async () => {
    await loadMastery({}, "u1", { scholarEvaluationBandStrong: 80, scholarEvaluationBandDeveloping: 50 } as never, "2026-11-05T10:00:00Z", { materials: [], linked: null, competencies: null });
    const of = (id: string, kind: string) => seen.evidence.filter(e => e.itemId === id && e.kind === kind).length;
    expect(of("lib", "review")).toBe(1);
    expect(of("lib", "question")).toBe(1);
    expect(of("own", "review")).toBe(1);
    expect(of("own", "question")).toBe(0);
  });
});
