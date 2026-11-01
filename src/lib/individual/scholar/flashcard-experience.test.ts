import { describe, expect, it } from "vitest";
import { cardsOfMaterial, experienceOf, testScopeOf, unfinishedFlashcardSession, withoutFlashcards } from "./flashcard-experience";

describe("experienceOf: which of the three experiences a view belongs to", () => {
  it("Study is the default and holds Revision History", () => {
    expect(experienceOf(undefined)).toBe("study");
    expect(experienceOf(null)).toBe("study");
    expect(experienceOf("history")).toBe("study");
    expect(experienceOf("nonsense")).toBe("study");
  });
  it("Test is ?view=test; Create & manage holds manage, All cards and My Decks", () => {
    expect(experienceOf("test")).toBe("test");
    for (const v of ["manage", "cards", "decks"]) expect(experienceOf(v)).toBe("manage");
  });
});

describe("withoutFlashcards: a test never touches a flashcard", () => {
  it("removes every id that is one of the learner's cards and keeps the order of the rest", () => {
    expect(withoutFlashcards(["a", "b", "c", "d"], ["b", "d", "zzz"])).toEqual(["a", "c"]);
  });
  it("accepts any iterable of card ids and leaves the pool alone when there are no cards", () => {
    expect(withoutFlashcards(["a", "b"], new Set(["a"]))).toEqual(["b"]);
    expect(withoutFlashcards(["a", "b"], [])).toEqual(["a", "b"]);
  });
  it("does not change its input", () => {
    const pool = ["a", "b"];
    withoutFlashcards(pool, ["a"]);
    expect(pool).toEqual(["a", "b"]);
  });
});

describe("cardsOfMaterial", () => {
  const cards = [
    { id: "1", chunkId: "s1", material: { id: "m1" } }, { id: "2", chunkId: "s2", material: { id: "m1" } }, { id: "3", chunkId: "s1", material: { id: "m2" } },
  ];
  it("keeps the cards of the material, and of one section when given", () => {
    expect(cardsOfMaterial(cards, "m1").map(c => c.id)).toEqual(["1", "2"]);
    expect(cardsOfMaterial(cards, "m1", "s2").map(c => c.id)).toEqual(["2"]);
    expect(cardsOfMaterial(cards, "m3")).toEqual([]);
  });
});

describe("testScopeOf: the existing sources scope covering a deck's topics", () => {
  const card = (n: number, m: number) => ({ id: `c${n}`, chunkId: `s${n}`, material: { id: `m${m}` } });
  it("is null with no cards, and the sections otherwise", () => {
    expect(testScopeOf([])).toBeNull();
    expect(testScopeOf([card(1, 1), card(2, 1), { ...card(3, 1), chunkId: "s1" }])).toEqual({ kind: "sources", materialIds: [], chunkIds: ["s1", "s2"] });
  });
  it("falls back to the materials when there are more sections than a scope may name", () => {
    const many = Array.from({ length: 30 }, (_, i) => card(i, i % 3));
    expect(testScopeOf(many)).toEqual({ kind: "sources", materialIds: ["m0", "m1", "m2"], chunkIds: [] });
  });
  it("is capped when both are too many", () => {
    const many = Array.from({ length: 40 }, (_, i) => card(i, i));
    const s = testScopeOf(many)!;
    expect(s.chunkIds).toHaveLength(24);
    expect(s.materialIds).toEqual([]);
  });
});

describe("unfinishedFlashcardSession: cross-device resume", () => {
  const s = (id: string, mode: string, status: string, at: string) => ({ id, mode, status, lastActiveAt: at });
  it("is the newest active flashcards session, ignoring other modes and finished ones", () => {
    expect(unfinishedFlashcardSession([
      s("q", "quick", "active", "2026-11-01T10:00:00Z"), s("done", "flashcards", "completed", "2026-11-01T09:00:00Z"),
      s("old", "flashcards", "active", "2026-10-30T09:00:00Z"), s("new", "flashcards", "active", "2026-11-01T08:00:00Z"),
    ])?.id).toBe("new");
  });
  it("is null when nothing is unfinished", () => {
    expect(unfinishedFlashcardSession([s("done", "flashcards", "completed", "2026-11-01T09:00:00Z")])).toBeNull();
    expect(unfinishedFlashcardSession([])).toBeNull();
  });
});
