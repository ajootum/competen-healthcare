import { describe, expect, it } from "vitest";
import {
  PRIMARY_LABEL, coversLesson, createJourney, journeyFacts, journeyStep, lessonFacts, newestSavedLesson, primaryAction, progressiveSplit, startJourney,
  type JourneyEffect, type JourneyEvent, type JourneyState,
} from "./learn-journey";

// SCHOLAR-PERSISTENT-LEARNING-01 (owner, 1 Nov): the lesson states from server records (no AI), the saved-lesson match
// behind the open:true fallback, the position rule and the one-active-lesson guided flow.

const OFF = { prepareNext: false };
const run = (s: JourneyState, events: JourneyEvent[]) => {
  const effects: JourneyEffect[] = [];
  for (const e of events) { const r = journeyStep(s, e, OFF); s = r.state; effects.push(...r.effects); }
  return { state: s, effects };
};

describe("lesson states (the state rule)", () => {
  it("read: any event but a skip, or the position's lesson", () => {
    expect(lessonFacts({ check: "offer" }).read).toBe(false);
    expect(lessonFacts({ actions: ["skip"], check: "offer" }).read).toBe(false);
    expect(lessonFacts({ actions: ["resume"], check: "offer" }).read).toBe(true);
    expect(lessonFacts({ visited: true, check: "offer" }).read).toBe(true);
  });
  it("taught: a teach-family event, or saved teaching (any version) -- a check alone is not teaching", () => {
    expect(lessonFacts({ actions: ["check"], check: "offer" }).taught).toBe(false);
    expect(lessonFacts({ actions: ["simplify"], check: "offer" }).taught).toBe(true);
    const savedOnly = lessonFacts({ saved: true, check: "offer" });
    expect(savedOnly).toMatchObject({ taught: true, saved: true, read: false, completed: false }); // saved but never opened
  });
  it("completed: taught + read; with check behaviour 'prompt' also a check verdict (any)", () => {
    expect(lessonFacts({ actions: ["teach"], check: "offer" }).completed).toBe(true);
    expect(lessonFacts({ actions: ["teach"], check: "off" }).completed).toBe(true);
    expect(lessonFacts({ actions: ["teach"], check: "prompt" }).completed).toBe(false);
    expect(lessonFacts({ actions: ["teach", "clarify"], verdict: "not_yet", check: "prompt" }).completed).toBe(true);
  });
  it("assessed: the latest verdict, else practised from attempts or this visit -- never invented", () => {
    expect(lessonFacts({ check: "offer" }).assessed).toBeNull();
    expect(lessonFacts({ verdict: "partly", attempts: 3, check: "offer" }).assessed).toBe("partly");
    expect(lessonFacts({ attempts: 2, check: "offer" }).assessed).toBe("practised");
    expect(lessonFacts({ live: { practised: true }, check: "offer" }).assessed).toBe("practised");
    expect(lessonFacts({ verdict: "<b>", check: "offer" }).assessed).toBeNull();
  });
  it("the production case: 7 lessons taught, position regressed to 0 -- all seven still taught and available", () => {
    const j = createJourney({ count: 7, current: 0, saved: [true, true, true, true, true, true, true], progress: Array.from({ length: 7 }, () => ({ actions: ["teach"], verdict: null })) });
    expect(j.revealedUpTo).toBe(6);
    expect([0, 1, 2, 3, 4, 5, 6].map(i => journeyFacts(j, i, { check: "offer" }).taught)).toEqual(Array(7).fill(true));
    expect([0, 6].map(i => primaryAction(journeyFacts(j, i, { check: "offer" }), false))).toEqual(["review", "review"]);
  });
  it("one primary way in per lesson", () => {
    expect(PRIMARY_LABEL[primaryAction(lessonFacts({ saved: true, check: "offer" }), false)]).toBe("Review saved lesson");
    expect(PRIMARY_LABEL[primaryAction(lessonFacts({ actions: ["resume"], check: "offer" }), true)]).toBe("Continue learning");
    expect(PRIMARY_LABEL[primaryAction(lessonFacts({ actions: ["resume"], check: "offer" }), false)]).toBe("Start learning");
    expect(PRIMARY_LABEL[primaryAction(lessonFacts({ check: "offer" }), true)]).toBe("Start learning");
  });
});

describe("saved lesson match (the open:true fallback)", () => {
  const A = "a", B = "b", C = "c", M = "m1";
  const row = (id: string, sources: string[], createdAt: string, extra: Partial<{ action: string; materialId: string }> = {}) => ({ id, action: "teach", materialId: M, sources, createdAt, ...extra });
  it("covers only when the sources BEGIN with exactly the lesson's own sections (order free); related sections may follow", () => {
    expect(coversLesson([A, B, C], [B, A])).toBe(true);
    expect(coversLesson([C, A, B], [A, B])).toBe(false); // another lesson's artefact that merely cites these sections
    expect(coversLesson([A], [A, B])).toBe(false);
    expect(coversLesson([A, B], [])).toBe(false);
  });
  it("the newest of the same action and material, any prompt version / depth / mode", () => {
    const rows = [row("old", [A], "2026-10-20T00:00:00Z"), row("new", [A, C], "2026-10-30T00:00:00Z"), row("other-action", [A], "2026-11-01T00:00:00Z", { action: "summary" }),
      row("other-material", [A], "2026-11-01T00:00:00Z", { materialId: "m2" }), row("other-lesson", [B, A], "2026-11-01T00:00:00Z")];
    expect(newestSavedLesson(rows, { action: "teach", materialId: M, chunkIds: [A] })?.id).toBe("new");
    expect(newestSavedLesson(rows, { action: "teach", materialId: M, chunkIds: [C] })).toBeNull();
  });
});

describe("one active lesson: select / next and the generate rule", () => {
  it("a saved lesson made active opens (no teach), guided or not", () => {
    const s = createJourney({ count: 4, current: 0, saved: [false, false, true, false] });
    expect(journeyStep(s, { type: "select", index: 2, guided: true }, OFF).effects).toEqual([{ kind: "scrollTo", index: 2 }, { kind: "open", index: 2 }]);
  });
  it("a lesson with nothing saved: guided teaches it, manual opens saved-only (then offers Start learning)", () => {
    const s = createJourney({ count: 4, current: 0 });
    expect(journeyStep(s, { type: "select", index: 3, guided: true }, OFF).effects).toEqual([{ kind: "scrollTo", index: 3 }, { kind: "teach", index: 3, auto: false }]);
    expect(journeyStep(s, { type: "select", index: 3, guided: false }, OFF).effects).toEqual([{ kind: "scrollTo", index: 3 }, { kind: "open", index: 3 }]);
  });
  it("Next lesson goes to the lesson after the ACTIVE one (not after the furthest), revealing nothing back", () => {
    const s = createJourney({ count: 6, current: 1, revealedUpTo: 4, saved: [true, true, true, true, true, false] });
    const r = journeyStep(s, { type: "next", guided: true }, OFF);
    expect(r.state.current).toBe(2); expect(r.state.revealedUpTo).toBe(4);
    expect(r.effects).toEqual([{ kind: "scrollTo", index: 2 }, { kind: "open", index: 2 }]);
    expect(journeyStep(createJourney({ count: 2, current: 1 }), { type: "next", guided: true }, OFF).effects).toEqual([]);
  });
  it("a resume never teaches: it opens the active lesson saved-only; a new scope teaches its first unsaved lesson", () => {
    const s = createJourney({ count: 3, current: 1 });
    expect(startJourney(s, true, true).effects).toEqual([{ kind: "open", index: 1 }]);
    expect(startJourney(s, true).effects).toEqual([{ kind: "teach", index: 1, auto: true }]);
    expect(startJourney(createJourney({ count: 3, current: 0, saved: [true] }), true).effects).toEqual([{ kind: "open", index: 0 }]);
  });
  it("the route saying nothing is saved clears the mark (offers Start learning); unreachable keeps it", () => {
    const s = createJourney({ count: 2, current: 0, saved: [true, false] });
    expect(journeyStep(s, { type: "savedLoaded", index: 0, found: false }, OFF).state.hasSaved[0]).toBe(true);
    expect(journeyStep(s, { type: "savedLoaded", index: 0, found: false, missing: true }, OFF).state.hasSaved[0]).toBe(false);
  });
  it("re-selecting a lesson already shown this visit asks for nothing", () => {
    const r = run(createJourney({ count: 3, current: 0 }), [{ type: "taught", index: 0 }, { type: "select", index: 1, guided: false }, { type: "savedLoaded", index: 1, found: true }, { type: "select", index: 0, guided: true }]);
    expect(r.effects.filter(f => f.kind === "teach")).toEqual([]);
    expect(r.effects.filter(f => f.kind === "open")).toEqual([{ kind: "open", index: 1 }]);
  });
});

describe("progressive teaching", () => {
  it("shows whole paragraphs first and the rest behind Show more; a short answer is shown whole", () => {
    const p1 = "First paragraph [S1].".padEnd(400, "x"), p2 = "Second [S2].".padEnd(400, "y"), p3 = "Third [S1].";
    expect(progressiveSplit(`${p1}\n\n${p2}\n\n${p3}`)).toEqual({ lead: p1, more: `${p2}\n\n${p3}` });
    expect(progressiveSplit("One short answer [S1].")).toEqual({ lead: "One short answer [S1].", more: "" });
    expect(progressiveSplit("a\n\nb")).toEqual({ lead: "a\n\nb", more: "" });
  });
});
