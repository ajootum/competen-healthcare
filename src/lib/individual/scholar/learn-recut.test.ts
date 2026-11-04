import { describe, expect, it } from "vitest";
import { RECUT_TITLE_MAX, citationSummary, cleanTitle, lessonsFromView, mergeLessons, parseLessonTitles, parseRecutRequest, recutBody, renameLesson, sameCut, splitLesson } from "./learn-recut";

// LEARNING-CLOSE-2026-11 D03 / LE-03: re-cutting a session's lessons is the same sections regrouped, nothing more.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const view = [
  { title: "Eye care", sections: [1, 2, 3].map(n => ({ chunkId: id(n), citation: `slide ${n}` })) },
  { title: "Oral care", sections: [4, 5].map(n => ({ chunkId: id(n), citation: `slide ${n}` })) },
  { title: "Infection control", sections: [6].map(n => ({ chunkId: id(n), citation: `slide ${n}` })) },
];

describe("the panel's moves", () => {
  const ls = lessonsFromView(view, ["My eyes lesson", null, null]);
  it("reads the view with the learner's names where given", () => {
    expect(ls.map(l => [l.title, l.outline, l.sections.length])).toEqual([["My eyes lesson", "Eye care", 3], [null, "Oral care", 2], [null, "Infection control", 1]]);
  });
  it("merge joins a lesson with the next, keeping the first name; the last has no next", () => {
    const m = mergeLessons(ls, 0);
    expect(m).toHaveLength(2);
    expect(m[0].title).toBe("My eyes lesson");
    expect(m[0].sections.map(s => s.citation)).toEqual(["slide 1", "slide 2", "slide 3", "slide 4", "slide 5"]);
    expect(mergeLessons(ls, 2)).toEqual(ls);
    expect(mergeLessons(renameLesson(ls, 1, "Mouth"), 1)[1].title).toBe("Mouth");
  });
  it("split cuts before a section, the first half keeping the name; nothing before the first or past the last", () => {
    const s = splitLesson(ls, 0, 2);
    expect(s).toHaveLength(4);
    expect(s[0]).toMatchObject({ title: "My eyes lesson", outline: "Eye care" });
    expect(s[0].sections.map(x => x.citation)).toEqual(["slide 1", "slide 2"]);
    expect(s[1]).toMatchObject({ title: null, outline: "Eye care" });
    expect(s[1].sections.map(x => x.citation)).toEqual(["slide 3"]);
    expect(splitLesson(ls, 0, 0)).toEqual(ls);
    expect(splitLesson(ls, 0, 3)).toEqual(ls);
    expect(splitLesson(ls, 2, 1)).toEqual(ls);
  });
  it("rename collapses whitespace, caps the length, and an empty name returns to the notes' own", () => {
    expect(renameLesson(ls, 1, "  Oral   care, done  my  way ")[1].title).toBe("Oral care, done my way");
    expect(renameLesson(ls, 1, "x".repeat(300))[1].title).toHaveLength(RECUT_TITLE_MAX);
    expect(renameLesson(ls, 0, "   ")[0].title).toBeNull();
    expect(cleanTitle(42)).toBeNull();
  });
  it("the body is the section ids per lesson and one name or null each, and an unchanged cut is recognised", () => {
    const body = recutBody(ls);
    expect(body.steps).toEqual([[id(1), id(2), id(3)], [id(4), id(5)], [id(6)]]);
    expect(body.titles).toEqual(["My eyes lesson", null, null]);
    expect(sameCut(body, view, ["My eyes lesson", null, null])).toBe(true);
    expect(sameCut(body, view, null)).toBe(false);
    expect(sameCut(recutBody(mergeLessons(ls, 0)), view, ["My eyes lesson", null, null])).toBe(false);
  });
});

describe("a lesson's sections in a few words", () => {
  it("names each material once with its slides as ranges, and lists anything else as it is", () => {
    const cite = (n: number) => ({ citation: `Essential Nursing Care, slide ${n}` });
    expect(citationSummary([14, 15, 16, 17, 19, 20, 25].map(cite))).toBe("Essential Nursing Care, slides 14-17, 19-20, 25");
    expect(citationSummary([cite(3)])).toBe("Essential Nursing Care, slide 3");
    expect(citationSummary([cite(3), { citation: "Renal notes, page 2" }, { citation: "Renal notes, page 3" }, { citation: "Something odd" }]))
      .toBe("Essential Nursing Care, slide 3 · Renal notes, pages 2-3 · Something odd");
    expect(citationSummary([])).toBe("");
  });
});

describe("the route's check", () => {
  it("accepts the same sections regrouped, lower-cased, with clean names", () => {
    const r = parseRecutRequest({ steps: [[id(1).toUpperCase(), id(2)], [id(3), id(4), id(5)], [id(6)]], titles: ["  Eyes ", null, ""] }, view);
    expect(r).toEqual({ ok: true, value: { steps: [[id(1), id(2)], [id(3), id(4), id(5)], [id(6)]], titles: ["Eyes", null, null] } });
    expect(parseRecutRequest({ steps: [[id(1), id(2), id(3), id(4), id(5), id(6)]] }, view)).toMatchObject({ ok: true, value: { titles: [null] } });
  });
  it("refuses a section from elsewhere, a section twice, a section left out, an empty lesson, bad names", () => {
    const err = (b: unknown) => { const r = parseRecutRequest(b, view); return r.ok ? "ok" : r.error; };
    expect(err({ steps: [[id(1), id(2), id(3)], [id(4), id(5)], [id(6), id(7)]] })).toMatch(/not in this session/);
    expect(err({ steps: [[id(1), id(2), id(3), id(1)], [id(4), id(5)], [id(6)]] })).toMatch(/one lesson only/);
    expect(err({ steps: [[id(1), id(2), id(3)], [id(4), id(5)]] })).toMatch(/must stay in a lesson/);
    expect(err({ steps: [[id(1), id(2), id(3)], [], [id(4), id(5), id(6)]] })).toMatch(/at least one section/);
    expect(err({ steps: [[id(1), id(2), id(3)], [id(4), id(5)], ["nope"]] })).toMatch(/named by its id/);
    expect(err({ steps: [] })).toMatch(/which sections/);
    expect(err({ steps: [[id(1), id(2), id(3)], [id(4), id(5)], [id(6)]], titles: ["a"] })).toMatch(/One name/);
    expect(err({ steps: [[id(1), id(2), id(3)], [id(4), id(5)], [id(6)]], titles: [1, null, null] })).toMatch(/is text/);
  });
  it("reads stored titles back, or null when none or the shape is wrong", () => {
    expect(parseLessonTitles(["A", null, " b "], 3)).toEqual(["A", null, "b"]);
    expect(parseLessonTitles([null, null, null], 3)).toBeNull();
    expect(parseLessonTitles(["A"], 3)).toBeNull();
    expect(parseLessonTitles("A", 1)).toBeNull();
  });
});
