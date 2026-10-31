import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sm2 } from "@/lib/delivery/reinforcement";
import {
  LEARNER_CARD, ORIGIN_LABEL, RECALL, buildDecks, cardsOfDecks, checkCardNote, checkPersonalCard, filterCards, flashcardDraftProblem, flashcardView,
  gapFocus, libraryRecallFits, originOf, parseDeckFields, recallCardOf, recallOf, reviewStateOf, scheduleRecall, selectCards, spacedViews, topicGaps,
  type CardRowExtras, type FlashcardView, type PersonalDeck,
} from "./flashcards";
import { SRS_DEFAULTS, checkRevisionDraft, scheduleReview } from "./revision";
import { revisionItemView } from "./revision-view";
import { stemKey } from "./question-intel";
import { pickLibraryQuestions, type LibraryQuestion } from "./library-questions";
import type { QuestionRow } from "./store";
import type { Passage } from "./generation";

// SCHOLAR-FLASHCARDS-01: the pure rules of flashcards. The store, routes and pages run them; migration 730 is verified on
// staging (docs/evidence/SCHOLAR-FLASHCARDS/VERIFY-730.sql).

const TODAY = "2026-10-31";
const row = (over: Partial<QuestionRow> = {}): QuestionRow => ({
  id: "q1", materialId: "m1", chunkId: "c1", kind: "flashcard", stem: "What does the loop of Henle set up?", options: [], correctIndex: null,
  rationale: "It sets up the medullary concentration gradient.", sourceQuote: "the loop of Henle sets up a concentration gradient", model: "claude", promptVersion: "revision-flashcard-v3",
  createdAt: "2026-10-20T10:00:00Z", answer: { back: "A concentration gradient in the medulla", rubric: { level: "recall", objective: "Recall the loop's role", keyPoints: ["countercurrent multiplier"], misconceptions: ["it filters blood"], source: "notes" } },
  difficulty: 2, materialTitle: "Renal system notes", ordinal: 3, pageFrom: 4, pageTo: 4, unit: "page", latest: null, competencyId: null, caseId: null, caseStep: null, caseTitle: null,
  library: null, ...over,
});
const extras = (over: Partial<CardRowExtras> = {}): CardRowExtras => ({ card: null, history: [], topics: ["Renal physiology"], competencyTitle: null, mark: null, deckIds: [], contentVersion: 1, updatedAt: null, ...over });
const card = (n: number, q: number | null, next = "2026-11-05", reviews = 1) => ({ id: `k${n}`, nextReviewAt: next, lastReviewedAt: reviews ? "2026-10-30T09:00:00Z" : null, lastQuality: q, reviews, intervalDays: 6, ease: 2.5, status: "active" as const });

describe("a card the learner writes: checked, labelled as theirs, never clinically reviewed", () => {
  const none = new Set<string>();
  it("accepts a short recall prompt and its answer", () => {
    expect(checkPersonalCard({ front: "  What does ADH act on? ", back: "The collecting ducts" }, none)).toEqual({ ok: true, front: "What does ADH act on?", back: "The collecting ducts" });
    expect(checkPersonalCard({ front: "Nephron", back: "The functional unit of the kidney" }, none).ok).toBe(true);
  });
  it("refuses a front or back out of bounds", () => {
    expect(checkPersonalCard({ front: "a?", back: "x" }, none)).toMatchObject({ ok: false, reason: "front" });
    expect(checkPersonalCard({ front: `${"Why ".repeat(80)}?`, back: "x" }, none)).toMatchObject({ ok: false, reason: "front" });
    expect(checkPersonalCard({ front: "What is renin?", back: "" }, none)).toMatchObject({ ok: false, reason: "back" });
    expect(checkPersonalCard({ front: "What is renin?", back: "x".repeat(601) }, none)).toMatchObject({ ok: false, reason: "back" });
  });
  it("refuses anything that identifies a patient", () => {
    const r = checkPersonalCard({ front: "What did Mr John Smith, NHS number 943 476 5919, present with?", back: "Oliguria" }, none);
    expect(r).toMatchObject({ ok: false, reason: "identifier" });
    expect(checkCardNote("Ask about NHS number 943 476 5919")).toMatchObject({ ok: false });
    expect(checkCardNote("  ask in the tutorial ")).toEqual({ ok: true, note: "ask in the tutorial" });
    expect(checkCardNote("")).toEqual({ ok: true, note: null });
  });
  it("refuses a statement copied as a front, and a repeat of a card they already have", () => {
    expect(checkPersonalCard({ front: "The kidney filters blood and makes urine every day.", back: "x" }, none)).toMatchObject({ ok: false, reason: "not_a_prompt" });
    expect(checkPersonalCard({ front: "What does the loop of Henle set up?", back: "x" }, new Set([stemKey("what does THE loop of henle set up")]))).toMatchObject({ ok: false, reason: "duplicate" });
  });
  it("is labelled as the learner's own card, not clinically reviewed, wherever it is shown", () => {
    const mine = row({ model: LEARNER_CARD.model, promptVersion: LEARNER_CARD.promptVersion, sourceQuote: "", rationale: "" });
    expect(originOf(mine)).toBe("learner");
    expect(ORIGIN_LABEL.learner).toMatch(/not clinically reviewed/);
    expect(ORIGIN_LABEL.learner).not.toMatch(/clinically reviewed\)/);
    expect(revisionItemView(mine).grounding).toBe(ORIGIN_LABEL.learner);
    const v = flashcardView(mine, extras(), TODAY);
    expect(v).toMatchObject({ origin: "learner", editable: true, sources: [], explanation: null, version: "Your card, version 1" });
    // An AI-written card from the notes is never editable, and carries its notes source with its quote.
    const ai = flashcardView(row(), extras(), TODAY);
    expect(ai).toMatchObject({ origin: "notes", editable: false, topic: "Renal physiology", objective: "Recall the loop's role", difficulty: 2 });
    expect(ai.sources[0]).toMatchObject({ origin: "notes", quote: "the loop of Henle sets up a concentration gradient", materialId: "m1", chunkId: "c1" });
  });
});

describe("generated cards: one concept, a recall prompt, grounded, never repeated", () => {
  const passage: Passage = {
    chunkId: "c1", materialId: "m1", materialTitle: "Renal notes", ordinal: 1, pageFrom: 1, pageTo: 1,
    content: "The loop of Henle sets up a concentration gradient in the medulla. Antidiuretic hormone acts on the collecting ducts to increase water reabsorption.",
  };
  const quote = "Antidiuretic hormone acts on the collecting ducts";
  it("keeps a good card", () => {
    expect(checkRevisionDraft("flashcard", { front: "Where does antidiuretic hormone act?", back: "On the collecting ducts", sourceQuote: quote }, passage).ok).toBe(true);
  });
  it("refuses a front copied from the notes, and a back of more than one concept", () => {
    expect(flashcardDraftProblem("Antidiuretic hormone acts on the collecting ducts to increase water reabsorption", "x", passage.content)).toBe("copied");
    expect(flashcardDraftProblem("Where does ADH act?", "One. Two. Three.", passage.content)).toBe("multi_concept");
    expect(flashcardDraftProblem("Where does ADH act?", "x".repeat(301), passage.content)).toBe("multi_concept");
    expect(checkRevisionDraft("flashcard", { front: "Where does antidiuretic hormone act?", back: "On the collecting ducts. It increases water reabsorption. It acts on the ducts.", sourceQuote: quote }, passage)).toEqual({ ok: false, reason: "multi_concept" });
  });
  it("does not store a card that repeats one already held (dedupe)", () => {
    const existing = new Set([stemKey("Where does antidiuretic hormone act?")]);
    expect(checkRevisionDraft("flashcard", { front: "Where does the antidiuretic hormone act?", back: "On the collecting ducts", sourceQuote: quote }, passage, { existing })).toEqual({ ok: false, reason: "repeat" });
  });
  it("refuses a card the notes do not support", () => {
    expect(checkRevisionDraft("flashcard", { front: "Where does antidiuretic hormone act?", back: "On the collecting ducts, within 30 minutes of a 40 mg dose", sourceQuote: quote }, passage)).toMatchObject({ ok: false });
  });
});

describe("recall: two buttons on the EXISTING SM-2, never a second scheduler", () => {
  const prev = { ease: 2.5, interval: 6, reps: 2 };
  it("Didn't remember is quality 1 (a lapse), Remembered is quality 4 (a recall)", () => {
    expect(RECALL.again.quality).toBe(1);
    expect(RECALL.remembered.quality).toBe(4);
    expect(RECALL.again).toMatchObject({ label: "Didn't remember", sub: "Review sooner" });
    expect(RECALL.remembered).toMatchObject({ label: "Remembered", sub: "Review later" });
  });
  it("schedules through scheduleReview over the shared sm2, with the policy bounds", () => {
    expect(scheduleRecall(prev, "again", 2, SRS_DEFAULTS)).toEqual(scheduleReview(prev, 1, 2, SRS_DEFAULTS));
    expect(scheduleRecall(prev, "remembered", 2, SRS_DEFAULTS)).toEqual(scheduleReview(prev, 4, 2, SRS_DEFAULTS));
    expect(scheduleRecall(prev, "again", 2, SRS_DEFAULTS)).toMatchObject({ interval: sm2(prev, 1).interval, reps: 0 });
    expect(scheduleRecall(prev, "remembered", 2, SRS_DEFAULTS)).toMatchObject({ interval: sm2(prev, 4).interval, reps: 3 });
    expect(scheduleRecall({ ease: 2.5, interval: 0, reps: 0 }, "remembered", null, SRS_DEFAULTS).interval).toBe(1);
  });
  it("a stored grade reads back as the button it was", () => {
    expect([0, 1, 2].map(recallOf)).toEqual(["again", "again", "again"]);
    expect([3, 4, 5].map(recallOf)).toEqual(["remembered", "remembered", "remembered"]);
  });
  it("defines no scheduler of its own (the source has no sm2 and no interval arithmetic)", () => {
    const src = readFileSync("src/lib/individual/scholar/flashcards.ts", "utf8");
    expect(src).not.toMatch(/function sm2|ease_factor|ease \+|interval \*/);
    expect(src).toMatch(/scheduleReview\(prev, RECALL\[choice\]\.quality/);
  });
});

describe("where a card stands", () => {
  it("new, due, needs more practice, remembered", () => {
    expect(reviewStateOf(null, TODAY)).toBe("new");
    expect(reviewStateOf(card(1, null, TODAY, 0), TODAY)).toBe("new");
    expect(reviewStateOf(card(1, 4, TODAY), TODAY)).toBe("due");
    expect(reviewStateOf(card(1, 1, "2026-11-01"), TODAY)).toBe("needs_practice");
    expect(reviewStateOf(card(1, 4, "2026-11-06"), TODAY)).toBe("remembered");
  });
});

describe("decks: derived from the cards, and the learner's own, by reference", () => {
  const views: FlashcardView[] = [
    flashcardView(row({ id: "a", competencyId: "comp1" }), extras({ card: card(1, 4, TODAY), competencyTitle: "Renal assessment" }), TODAY),
    flashcardView(row({ id: "b", materialId: "m2", materialTitle: "Cardiac notes", chunkId: "c9" }), extras({ topics: ["Cardiac output"], mark: { bookmarked: true, note: null, issue: null } }), TODAY),
    flashcardView(row({ id: "c" }), extras({ card: card(3, 1, "2026-11-01") }), TODAY),
  ];
  const mine: PersonalDeck = { id: "d1", title: "Exam week", organiseBy: "module", organiseRef: "NUR201", createdAt: "x", updatedAt: "x", lastStudiedAt: "2026-10-29T08:00:00Z", cardIds: ["c", "a", "gone"] };
  const decks = buildDecks(views, [mine]);
  it("all cards first, then the learner's decks, then by document, topic, competency, and bookmarks", () => {
    expect(decks.map(d => d.key)).toEqual(["all", "deck:d1", "doc:m2", "doc:m1", "topic:Cardiac output", "topic:Renal physiology", "comp:comp1", "bookmarked"]);
    expect(decks[0]).toMatchObject({ total: 3, due: 1, fresh: 1, needsPractice: 1, remembered: 0 });
    // A deck holds what it references, in its order; a card no longer stored is simply not there.
    expect(decks[1]).toMatchObject({ title: "Exam week", subtitle: "Module: NUR201", cardIds: ["c", "a"], total: 2, lastStudiedAt: "2026-10-30T09:00:00Z" });
    expect(decks.find(d => d.key === "doc:m1")).toMatchObject({ title: "Renal system notes", cardIds: ["a", "c"] });
    expect(decks.find(d => d.key === "comp:comp1")).toMatchObject({ title: "Renal assessment", cardIds: ["a"] });
    expect(decks.find(d => d.key === "bookmarked")?.cardIds).toEqual(["b"]);
  });
  it("a card in two decks is one card: its schedule is never copied", () => {
    const all = cardsOfDecks(decks, ["deck:d1", "doc:m1", "d1"]);
    expect(all).toEqual(["c", "a"]);
  });
  it("searches and filters", () => {
    expect(filterCards(views, decks, { q: "cardiac" }).map(c => c.id)).toEqual(["b"]);
    expect(filterCards(views, decks, { state: "needs_practice" }).map(c => c.id)).toEqual(["c"]);
    expect(filterCards(views, decks, { bookmarked: true }).map(c => c.id)).toEqual(["b"]);
    expect(filterCards(views, decks, { deck: "deck:d1", state: "due" }).map(c => c.id)).toEqual(["a"]);
  });
  it("a selection (for study and for the downloads) is the learner's own cards only", () => {
    expect(selectCards(views, decks, { deckIds: ["d1"] }).map(c => c.id)).toEqual(["c", "a"]);
    expect(selectCards(views, decks, { cardIds: ["b", "someone-else"] }).map(c => c.id)).toEqual(["b"]);
    expect(selectCards(views, decks, { deckIds: ["all"], materialId: "m1" }).map(c => c.id)).toEqual(["a", "c"]);
    expect(selectCards(views, decks, { competencyId: "comp1" }).map(c => c.id)).toEqual(["a"]);
    expect(selectCards(views, decks, { topic: "renal PHYSIOLOGY" }).map(c => c.id)).toEqual(["a", "c"]);
    expect(selectCards(views, decks, { deckIds: ["unknown"] })).toEqual([]);
  });
  it("spaced views: due today, needs practice, remembered, new, next review", () => {
    const v = spacedViews(views, TODAY);
    expect([v.due.length, v.needsPractice.length, v.remembered.length, v.fresh.length]).toEqual([1, 1, 0, 1]);
    expect(v.nextReview).toBe("2026-11-01");
  });
  it("a deck name and organisation are checked", () => {
    expect(parseDeckFields({ title: " Renal  week " }, true)).toEqual({ ok: true, title: "Renal week" });
    expect(parseDeckFields({}, true)).toMatchObject({ ok: false });
    expect(parseDeckFields({ title: "x", organiseBy: "module" }, true)).toMatchObject({ ok: false });
    expect(parseDeckFields({ title: "x", organiseBy: "module", organiseRef: "NUR201" }, true)).toEqual({ ok: true, title: "x", organiseBy: "module", organiseRef: "NUR201" });
    expect(parseDeckFields({ title: "Mr John Smith NHS 943 476 5919" }, true)).toMatchObject({ ok: false, identifier: true });
  });
});

describe("learning gaps: where to write cards, and what they focus on", () => {
  const missed = (id: string, chunkId: string, misses: number, answer: unknown = null) => ({ q: row({ id, chunkId, kind: "short", answer }), misses });
  it("groups what was missed by topic, most missed first, with key points and misconceptions", () => {
    const topics = new Map([["c1", ["Loop of Henle"]], ["c2", ["ADH"]]]);
    const gaps = topicGaps([
      missed("x", "c1", 1, { accepted: ["x"], rubric: { level: "recall", keyPoints: ["countercurrent multiplier"], misconceptions: ["it filters blood"], source: "notes" } }),
      missed("y", "c2", 3), missed("z", "c3", 0),
    ], topics);
    expect(gaps.map(g => [g.label, g.missed])).toEqual([["ADH", 3], ["Loop of Henle", 1]]);
    expect(gaps[1]).toMatchObject({ keyPoints: ["countercurrent multiplier"], misconceptions: ["it filters blood"], chunkIds: ["c1"] });
    // No rubric: the question itself is what to recall.
    expect(gaps[0].keyPoints).toEqual(["What does the loop of Henle set up?"]);
    const focus = gapFocus(gaps);
    expect(focus.chunkIds).toEqual(["c2", "c1"]);
    expect(focus.concepts.get("c1")).toEqual(["countercurrent multiplier", "correct the misconception: it filters blood"]);
  });
  it("nothing missed: no gaps, so nothing is written", () => {
    expect(gapFocus(topicGaps([missed("z", "c3", 0)], new Map())).chunkIds).toEqual([]);
  });
});

describe("library first: a governed question that stands alone is a card, exactly as approved", () => {
  const lib = (stem: string, over: Partial<QuestionRow> = {}) => row({
    id: "L", kind: "mcq", stem, options: ["Collecting ducts", "Glomerulus", "Bladder", "Ureter"], correctIndex: 0, answer: null, model: "competen-library", promptVersion: "library:v2",
    sourceQuote: "", library: { resourceId: "r", versionId: "v", versionNo: 2, approval: "clinically_approved" }, ...over,
  });
  it("offers a stem that asks on its own, with its approved answer as the back", () => {
    const c = recallCardOf(lib("Where does antidiuretic hormone act in the kidney?"))!;
    expect(c).toMatchObject({ kind: "flashcard", options: [], correctIndex: null, answer: { back: "Collecting ducts" } });
    expect(flashcardView(c, extras(), TODAY)).toMatchObject({ origin: "library", editable: false, version: "Competen library version 2" });
    expect(flashcardView(c, extras(), TODAY).sources[0]).toMatchObject({ origin: "library", libraryVersionId: "v", quote: null });
  });
  it("never one that leans on its options, and never a learner's own mcq", () => {
    expect(libraryRecallFits("Which of the following acts on the collecting ducts?")).toBe(false);
    expect(libraryRecallFits("Which is NOT a function of the kidney?")).toBe(false);
    expect(libraryRecallFits("Antidiuretic hormone acts on the collecting ducts.")).toBe(false);
    expect(recallCardOf(lib("Which of the following acts on the collecting ducts?"))).toBeNull();
    expect(recallCardOf(lib("Where does ADH act?", { library: null }))).toBeNull();
  });
  it("the library is read first: only fitting stems are picked, before anything is written", () => {
    const q = (id: string, stem: string): LibraryQuestion => ({ versionId: id, resourceId: `r${id}`, versionNo: 1, title: "Renal", stem, options: ["a", "b", "c", "d"], correctIndex: 0, rationale: "r", competencyIds: ["comp1"], publishedAt: "2026-10-01" });
    const library = [q("1", "Which of the following is a nephron segment?"), q("2", "Where does antidiuretic hormone act?")];
    const picks = pickLibraryQuestions({ questions: library.filter(x => libraryRecallFits(x.stem)), sections: [{ chunkId: "c1", competencyIds: ["comp1"], topics: [] }], exclude: new Set(), limit: 5 });
    expect(picks.map(p => p.question.versionId)).toEqual(["2"]);
  });
});
