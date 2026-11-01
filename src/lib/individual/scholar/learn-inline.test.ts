import { describe, expect, it } from "vitest";
import {
  INLINE_DEFAULTS, RECALL_WAIT_REASON, applicationAfter, applyEligible, blockPending, checkBlocks, cleanMarks, inlineCheckPlacement, isRated, lessonCanContinue, marksFromActivities, mergeMarks, recallContent, wordCount, type InlineLesson,
} from "./learn-inline";
import { createJourney, journeyStep, parseSavedJourney, savedJourney } from "./learn-journey";
import { cleanUnfinished, mergeResume, parsePositionPut } from "./learn-position";

const lesson = (words: number, over: Partial<InlineLesson> = {}): InlineLesson => ({ words, hasRecall: true, taught: true, ...over });
const place = (ls: InlineLesson[], over = {}) => inlineCheckPlacement(ls, { recall: "on", placement: "substantial", minWords: 180, ...over });
const OFF = { prepareNext: false };

describe("inlineCheckPlacement", () => {
  const ls = [lesson(60), lesson(200), lesson(500), lesson(100)];
  it("substantial: only lessons with at least the minimum words", () => {
    expect(place(ls)).toEqual([false, true, true, false]);
    expect(place(ls, { minWords: 250 })).toEqual([false, false, true, false]);
  });
  it("every_lesson: every lesson that has something to ask", () => {
    expect(place(ls, { placement: "every_lesson" })).toEqual([true, true, true, true]);
  });
  it("lesson_end: once, after the last lesson only", () => {
    expect(place(ls, { placement: "lesson_end" })).toEqual([false, false, false, true]);
  });
  it("off shows none, and a lesson with nothing saved to ask or not taught shows none", () => {
    expect(place(ls, { recall: "off" })).toEqual([false, false, false, false]);
    expect(place([lesson(900, { hasRecall: false }), lesson(900, { taught: false }), lesson(900)], { placement: "every_lesson" })).toEqual([false, false, true]);
  });
  it("defaults are lightweight: substantial at 180 words, quick check on, application on, skippable", () => {
    expect(INLINE_DEFAULTS).toEqual({ recall: "on", placement: "substantial", minWords: 180, checks: "on", application: "on", skippable: "on", required: "required", every: "2", saveMissed: "on" });
  });
});

describe("the application check and the Apply rule", () => {
  it("is offered once, after the final lesson, when on and a case can open", () => {
    expect([0, 1, 2].map(i => applicationAfter(i, 3, { application: "on" }, true))).toEqual([false, false, true]);
    expect(applicationAfter(2, 3, { application: "off" }, true)).toBe(false);
    expect(applicationAfter(2, 3, { application: "on" }, false)).toBe(false);
  });
  it("Apply only for a competency session or a section with an accepted competency mapping", () => {
    const mapped = new Set(["c2"]);
    expect(applyEligible("competency", ["c1"], mapped)).toBe(true);
    expect(applyEligible("material", ["c1", "c2"], mapped)).toBe(true);
    expect(applyEligible("material", ["c1"], mapped)).toBe(false);
    expect(applyEligible("material", ["c1"], new Set())).toBe(false);
  });
});

describe("recallContent: from the saved lesson only", () => {
  it("uses the check question, key points as the answer, and strips citation tags", () => {
    const c = recallContent({ title: "Sepsis", question: "What starts the sepsis bundle? [S1]", points: ["Give fluids [S1]", "Take cultures"], overview: "Why it matters [S2]", objective: null });
    expect(c).toEqual({ front: "What starts the sepsis bundle?", back: "- Give fluids\n- Take cultures", why: "Why it matters" });
  });
  it("falls back to a key-points question, and renders nothing when the lesson holds nothing to ask", () => {
    expect(recallContent({ title: "Sepsis", question: null, points: ["a"], overview: null, objective: null })?.front).toBe("What are the key points of Sepsis?");
    expect(recallContent({ title: "Sepsis", question: null, points: [], overview: "text", objective: null })).toBeNull();
    expect(recallContent({ title: "Sepsis", question: "Q?", points: [], overview: null, objective: null })).toBeNull();
  });
  it("counts words without citation tags", () => { expect(wordCount("one two [S1] three")).toBe(3); expect(wordCount(null)).toBe(0); });
});

describe("marks persist and resume without a request", () => {
  it("a mark event records the outcome; a skip never replaces a rating", () => {
    let s = createJourney({ count: 3, current: 0 });
    s = journeyStep(s, { type: "mark", index: 1, recalled: "again" }, OFF).state;
    s = journeyStep(s, { type: "mark", index: 1, recalled: "skipped" }, OFF).state;
    s = journeyStep(s, { type: "mark", index: 1, quickChecked: "wrong" }, OFF).state;
    expect(s.activities[1]).toMatchObject({ recalled: "again", quickChecked: "wrong" });
    expect(journeyStep(s, { type: "mark", index: 9, recalled: "remembered" }, OFF).state).toBe(s);
  });
  it("the device copy keeps and validates them", () => {
    let s = createJourney({ count: 2, current: 0 });
    s = journeyStep(s, { type: "mark", index: 0, recalled: "remembered", quickChecked: "correct" }, OFF).state;
    const back = parseSavedJourney(JSON.stringify(savedJourney(s)), 2)!;
    expect(back.activities[0]).toMatchObject({ recalled: "remembered", quickChecked: "correct" });
    const bad = parseSavedJourney(JSON.stringify({ v: 1, revealedUpTo: 0, anchor: 0, activities: [{ recalled: "banana", quickChecked: "x" }] }), 2)!;
    expect(bad.activities[0]).toEqual({});
  });
  it("the 790 position object carries them as short codes, any device, and nothing else", () => {
    const marks = marksFromActivities([10, 11, 12], [{ recalled: "remembered" }, {}, { recalled: "again", quickChecked: "wrong" }]);
    expect(marks).toEqual({ recall: { "10": "r", "12": "a" }, quick: { "12": "w" } });
    expect(cleanUnfinished({ v: 1, ...marks, text: "never kept" })).toEqual({ v: 1, ...marks });
    expect(cleanUnfinished({ v: 1, recall: { x: "r", "3": "z", "4": "s" } })).toEqual({ v: 1, recall: { "4": "s" } });
    expect(cleanUnfinished({ v: 1 })).toBeNull();
    expect(cleanUnfinished({ practiceOpen: 2 })).toEqual({ v: 1, practiceOpen: 2 });
    const put = parsePositionPut({ deviceId: "deviceBBBB", clientSeq: 1, clientUpdatedAt: new Date().toISOString(), step: 1, cardId: "lesson-1", unfinished: { v: 1, ...marks } }, Date.now());
    expect(put.ok && put.value.unfinished).toEqual({ v: 1, ...marks });
  });
  it("mergeResume hands the server marks back whichever copy wins, and a merge never empties a rated lesson", () => {
    const server = { step: 1, furthestStep: 1, cardId: "lesson-1", sectionChunkId: null, offsetHint: null, lastCompletedActivity: null, lastCompletedAt: null,
      unfinished: { v: 1 as const, recall: { "1": "r" as const } }, deviceId: "deviceAAAA", clientSeq: 1, clientUpdatedAt: "2026-10-31T10:00:00.000Z", revision: 2, updatedAt: "" };
    const r = mergeResume({ steps: [1, 2], fallback: 0, local: { anchor: 0, revealedUpTo: 0, updatedAt: "2026-11-01T10:00:00.000Z" }, server });
    expect(r.from).toBe("device"); expect(r.marks).toEqual({ recall: { "1": "r" } });
    expect(mergeMarks({ recall: { "1": "s" } }, { recall: { "1": "a" }, quick: { "1": "c" } })).toEqual({ recall: { "1": "a" }, quick: { "1": "c" } });
    expect(cleanMarks(null)).toEqual({});
  });
});

describe("checkBlocks: which lessons close a required recall block and what each covers", () => {
  const steps = (n: number) => Array.from({ length: n }, (_, i) => 100 + i);
  const shape = (n: number, every: "1" | "2" | "3" | "journey_end") => checkBlocks(steps(n), every).map(b => [b.closesAt, b.covers]);
  it("5 lessons, every 2: blocks after 2, 4 and 5 (the final lesson closes the incomplete block)", () => {
    expect(shape(5, "2")).toEqual([[1, [0, 1]], [3, [2, 3]], [4, [4]]]);
  });
  it("every 1: a block after each lesson", () => { expect(shape(3, "1")).toEqual([[0, [0]], [1, [1]], [2, [2]]]); });
  it("every 3: after 3 and after the last", () => { expect(shape(7, "3")).toEqual([[2, [0, 1, 2]], [5, [3, 4, 5]], [6, [6]]]); });
  it("an exact multiple does not add an empty block", () => { expect(shape(6, "3")).toEqual([[2, [0, 1, 2]], [5, [3, 4, 5]]]); });
  it("journey_end: one block after the last lesson covering all of them", () => { expect(shape(4, "journey_end")).toEqual([[3, [0, 1, 2, 3]]]); });
  it("carries the step numbers of the lessons covered, and a one-lesson journey is one block", () => {
    expect(checkBlocks(steps(5), "2")[0].steps).toEqual([100, 101]);
    expect(shape(1, "2")).toEqual([[0, [0]]]);
    expect(checkBlocks([], "2")).toEqual([]);
  });
  it("a resumed journey has the same blocks (they depend on the journey, not on where the learner is)", () => {
    expect(shape(5, "2")).toEqual(shape(5, "2"));
    // resuming at lesson 3 (index 2): it sits in the block that closes after lesson 4
    expect(checkBlocks(steps(5), "2").find(b => b.covers.includes(2))?.closesAt).toBe(3);
  });
});

describe("lessonCanContinue: the required recall gate", () => {
  it("required waits until every card is revealed and self-rated (either rating)", () => {
    expect(lessonCanContinue("required", ["remembered", null])).toBe(false);
    expect(lessonCanContinue("required", ["remembered", "again"])).toBe(true);
    expect(lessonCanContinue("required", ["skipped"])).toBe(false);
    expect(lessonCanContinue("required", [null])).toBe(false);
  });
  it("nothing waits when the block has no cards (a lesson with no saved question), or when the check is optional", () => {
    expect(lessonCanContinue("required", [])).toBe(true);
    expect(lessonCanContinue("optional", [null, "skipped"])).toBe(true);
  });
  it("either rating counts: it is not a pass mark", () => {
    expect(isRated("again")).toBe(true); expect(isRated("remembered")).toBe(true); expect(isRated("skipped")).toBe(false); expect(isRated(null)).toBe(false);
    expect(blockPending(["again"])).toBe(false);
  });
  it("the reason is plain", () => { expect(RECALL_WAIT_REASON).toBe("Finish the recall check to continue"); });
});
