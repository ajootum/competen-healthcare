import { describe, expect, it } from "vitest";
import {
  createJourney, journeyFacts, journeyStep, lessonStatus, parseSavedJourney, readCount, savedJourney, startJourney,
  type JourneyEffect, type JourneyEvent, type JourneyState,
} from "./learn-journey";

const ON = { prepareNext: true }, OFF = { prepareNext: false };
const run = (s: JourneyState, events: JourneyEvent[], o = OFF) => {
  const effects: JourneyEffect[] = [];
  for (const e of events) { const r = journeyStep(s, e, o); s = r.state; effects.push(...r.effects); }
  return { state: s, effects };
};
const kinds = (fx: JourneyEffect[]) => fx.map(f => f.kind);

describe("createJourney", () => {
  it("reveals up to the current lesson and the furthest recorded one", () => {
    const s = createJourney({ count: 6, current: 1, progress: [{ actions: ["teach"], verdict: null }, undefined, undefined, { actions: ["teach"], verdict: "partly" }] });
    expect(s.revealedUpTo).toBe(3);
    expect(s.lessons[3]).toBe("checked");
    expect(s.activities[3].verdict).toBe("partly");
  });
  it("clamps out-of-range numbers", () => {
    const s = createJourney({ count: 3, current: 9, revealedUpTo: -4 });
    expect(s.current).toBe(2); expect(s.revealedUpTo).toBe(2);
  });
});

describe("the generate rule", () => {
  it("scrolling never asks for a teach: viewed and scrollReachedEnd open saved only", () => {
    const s = createJourney({ count: 5, current: 0, revealedUpTo: 3 });
    const r = run(s, [{ type: "viewed", index: 1 }, { type: "viewed", index: 2 }, { type: "scrollReachedEnd" }, { type: "viewed", index: 1 }, { type: "viewed", index: 3 }]);
    expect(kinds(r.effects).every(k => k === "open")).toBe(true);
    expect(r.effects.map(f => ("index" in f ? f.index : -1))).toEqual([1, 2, 3]); // each lesson opened once
    expect(r.state.endVisible).toBe(true);
    expect(r.state.revealedUpTo).toBe(3); // the end card is shown; nothing is revealed by scrolling
  });
  it("nearView loads saved without moving Current", () => {
    const r = run(createJourney({ count: 4, current: 0, revealedUpTo: 2 }), [{ type: "nearView", index: 2 }, { type: "nearView", index: 2 }]);
    expect(r.effects).toEqual([{ kind: "open", index: 2 }]); expect(r.state.current).toBe(0);
  });
  it("a viewed lesson beyond what is revealed is ignored", () => {
    const r = run(createJourney({ count: 5, current: 0 }), [{ type: "viewed", index: 4 }]);
    expect(r.effects).toEqual([]); expect(r.state.current).toBe(0);
  });
  it("jumpTo reveals as outline and loads saved only", () => {
    const r = run(createJourney({ count: 6, current: 0 }), [{ type: "jumpTo", index: 4 }]);
    expect(r.state.revealedUpTo).toBe(4);
    expect(r.state.current).toBe(4);
    expect(kinds(r.effects)).toEqual(["scrollTo", "open"]);
  });
  it("chooseContinue reveals the next lesson and teaches it (guided) or opens it saved-only (manual)", () => {
    const g = run(createJourney({ count: 3, current: 0 }), [{ type: "chooseContinue", guided: true }]);
    expect(g.state.revealedUpTo).toBe(1);
    expect(g.effects).toEqual([{ kind: "scrollTo", index: 1 }, { kind: "teach", index: 1, auto: false }]);
    const m = run(createJourney({ count: 3, current: 0 }), [{ type: "chooseContinue", guided: false }]);
    expect(kinds(m.effects)).toEqual(["scrollTo", "open"]);
  });
  it("chooseContinue at the last lesson does nothing", () => {
    expect(run(createJourney({ count: 2, current: 1 }), [{ type: "chooseContinue", guided: true }]).effects).toEqual([]);
  });
  it("startJourney: guided teaches the current lesson only; manual opens it saved-only", () => {
    const s = createJourney({ count: 4, current: 2 });
    expect(startJourney(s, true).effects).toEqual([{ kind: "teach", index: 2, auto: true }]);
    expect(startJourney(s, false).effects).toEqual([{ kind: "open", index: 2 }]);
  });
  it("at most one teach is in flight: a new one aborts the old; the same one is never asked twice", () => {
    let s = startJourney(createJourney({ count: 4, current: 0 }), true).state;
    const again = journeyStep(s, { type: "requestTeach", index: 0 }, OFF);
    expect(again.effects).toEqual([]);
    const r = journeyStep(s, { type: "chooseContinue", guided: true }, OFF);
    expect(r.effects).toEqual([{ kind: "scrollTo", index: 1 }, { kind: "abort", index: 0 }, { kind: "teach", index: 1, auto: false }]);
    s = r.state;
    expect(s.generating).toBe(1);
    // the aborted lesson may still be saved by the route: viewing it again opens it (saved only), never a teach
    expect(journeyStep(s, { type: "viewed", index: 0 }, OFF).effects).toEqual([{ kind: "open", index: 0 }]);
  });
  it("PROPERTY: over random event sequences, only a learner's choice emits a teach, never for a saved lesson, and in flight <= 1", () => {
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let trial = 0; trial < 300; trial++) {
      const count = 1 + rnd(8);
      let s = createJourney({ count, current: rnd(count), revealedUpTo: rnd(count), saved: Array.from({ length: count }, () => rnd(3) === 0) });
      let inFlight = new Set<number>(), prefetches = 0;
      for (let k = 0; k < 40; k++) {
        const i = rnd(count + 1) - (rnd(5) === 0 ? 1 : 0);
        const pool: JourneyEvent[] = [
          { type: "viewed", index: i }, { type: "nearView", index: i }, { type: "scrollReachedEnd" }, { type: "scrollLeftEnd" }, { type: "chooseContinue", guided: rnd(2) === 0 },
          { type: "select", index: i, guided: rnd(2) === 0 }, { type: "next", guided: rnd(2) === 0 },
          { type: "jumpTo", index: i }, { type: "requestTeach", index: i }, { type: "savedLoaded", index: i, found: rnd(2) === 0 },
          { type: "taught", index: i }, { type: "teachEnded", index: i }, { type: "verdict", index: i, value: "partly" },
          { type: "activity", index: i, kind: "practised" }, { type: "prefetchEnded" },
        ];
        const e = pool[rnd(pool.length)];
        const r = journeyStep(s, e, rnd(2) ? ON : OFF);
        for (const f of r.effects) {
          if (f.kind === "teach") {
            expect(["chooseContinue", "next", "select", "requestTeach"]).toContain(e.type); expect(f.auto).toBe(false); inFlight.add(f.index);
            if (e.type !== "requestTeach") { expect("guided" in e && e.guided).toBe(true); expect(s.hasSaved[f.index]).toBe(false); } // never for a saved lesson
          }
          if (f.kind === "abort") inFlight.delete(f.index);
          if (f.kind === "prefetch") { expect(e.type).toBe("taught"); prefetches++; }
          if (f.kind === "open") expect(["viewed", "nearView", "jumpTo", "chooseContinue", "next", "select"]).toContain(e.type);
          if (e.type === "viewed" || e.type === "nearView") expect(r.state.current).toBe(s.current); // scrolling never moves the active lesson
        }
        if (r.state.generating === null) inFlight = new Set();
        expect(inFlight.size).toBeLessThanOrEqual(1);
        expect(r.state.revealedUpTo).toBeLessThan(Math.max(1, count));
        s = r.state;
      }
      expect(prefetches).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("prefetch", () => {
  it("only after the frontier lesson is taught, one ahead, never when off", () => {
    const s = createJourney({ count: 4, current: 0, revealedUpTo: 1 });
    expect(journeyStep(s, { type: "taught", index: 0 }, ON).effects).toEqual([]); // not the frontier
    const r = journeyStep(s, { type: "taught", index: 1 }, ON);
    expect(r.effects).toEqual([{ kind: "prefetch", index: 1 }]);
    expect(r.state.prefetching).toBe(2);
    expect(journeyStep(s, { type: "taught", index: 1 }, OFF).effects).toEqual([]);
    expect(journeyStep(createJourney({ count: 2, current: 1 }), { type: "taught", index: 1 }, ON).effects).toEqual([]); // no next
  });
  it("is aborted by a jump elsewhere and kept by a Continue to it", () => {
    const s = journeyStep(createJourney({ count: 5, current: 1, revealedUpTo: 1 }), { type: "taught", index: 1 }, ON).state;
    expect(kinds(journeyStep(s, { type: "jumpTo", index: 0 }, ON).effects)).toContain("abortPrefetch");
    expect(kinds(journeyStep(s, { type: "chooseContinue", guided: true }, ON).effects)).not.toContain("abortPrefetch");
  });
});

describe("navigator status", () => {
  it("says it in words, not colour", () => {
    let s = createJourney({ count: 3, current: 0 });
    const f = (i: number, progress?: { actions: string[]; verdict: string | null }) => journeyFacts(s, i, { progress, check: "offer" });
    expect(lessonStatus(s, 1, f(1)).label).toBe("Not started");
    s = run(s, [{ type: "taught", index: 0 }, { type: "verdict", index: 0, value: "not_yet" }]).state;
    expect(lessonStatus(s, 0, f(0))).toEqual({ label: "Current · Completed · Checked: not yet", icon: "current", current: true });
    expect(lessonStatus(s, 2, f(2, { actions: ["teach"], verdict: null }))).toEqual({ label: "Completed", icon: "completed", current: false });
    expect(lessonStatus(s, 2, f(2, { actions: ["resume"], verdict: null })).label).toBe("Read");
    expect(readCount([f(0), f(1), f(2, { actions: ["skip"], verdict: null })])).toBe(1); // a skip is not reading
  });
});

describe("continue where I stopped (device copy)", () => {
  it("round-trips and clamps to the session as it is now", () => {
    const s = run(createJourney({ count: 6, current: 0 }), [{ type: "jumpTo", index: 4 }, { type: "activity", index: 4, kind: "applied" }]).state;
    const raw = JSON.stringify(savedJourney(s, new Date("2026-10-31T00:00:00Z")));
    expect(parseSavedJourney(raw, 6)).toMatchObject({ revealedUpTo: 4, anchor: 4, updatedAt: "2026-10-31T00:00:00.000Z" });
    expect(parseSavedJourney(raw, 3)).toMatchObject({ revealedUpTo: 2, anchor: 2 });
    expect(parseSavedJourney(raw, 6)?.activities[4]).toEqual({ applied: true });
  });
  it("rejects anything odd", () => {
    expect(parseSavedJourney("{", 3)).toBeNull();
    expect(parseSavedJourney(JSON.stringify({ v: 2, revealedUpTo: 1, anchor: 1 }), 3)).toBeNull();
    expect(parseSavedJourney(null, 3)).toBeNull();
    expect(parseSavedJourney(JSON.stringify({ v: 1, revealedUpTo: 1, anchor: 0, activities: [{ verdict: "<b>", read: "yes" }] }), 3)?.activities[0]).toEqual({});
  });
  it("THE POSITION RULE: scrolling back never moves the active lesson; only the learner's choice does", () => {
    let s = run(createJourney({ count: 7, current: 6, revealedUpTo: 6 }), [{ type: "viewed", index: 0 }, { type: "nearView", index: 1 }, { type: "viewed", index: 2 }]).state;
    expect(s.current).toBe(6); expect(s.revealedUpTo).toBe(6);
    s = journeyStep(s, { type: "select", index: 2, guided: true }, OFF).state;
    expect(s.current).toBe(2); expect(s.revealedUpTo).toBe(6); // revisiting never shrinks what was reached
  });
});
