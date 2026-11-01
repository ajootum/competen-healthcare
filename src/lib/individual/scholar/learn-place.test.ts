import { describe, expect, it } from "vitest";
import { PLACE_DEBOUNCE_MS, PLACE_MIN_GAP_MS, PlaceScheduler, cardIdFor, choosePlace, lessonAnchorId, offsetPercent, parseCardId, parseLocalPlaces, pickAnchor, placeScrollTop, withLocalPlace } from "./learn-place";

/** A manual clock and timer, so the scheduler is proved without waiting. */
function rig() {
  let now = 1_000_000;
  let timer: { at: number; fn: () => void } | null = null;
  const commits: boolean[] = [];
  const s = new PlaceScheduler({
    commit: k => commits.push(k), now: () => now,
    setTimer: (fn, ms) => { timer = { at: now + ms, fn }; return timer; },
    clearTimer: () => { timer = null; },
  });
  const advance = (ms: number) => {
    const end = now + ms;
    while (timer && (timer as { at: number }).at <= end) { const t = timer as { at: number; fn: () => void }; now = t.at; timer = null; t.fn(); }
    now = end;
  };
  return { s, commits, advance, hasTimer: () => timer !== null };
}

describe("PlaceScheduler", () => {
  it("never commits on a scroll event itself", () => {
    const r = rig();
    r.s.note(); r.s.note(); r.s.note();
    expect(r.commits).toEqual([]);
  });
  it("commits once, DEBOUNCE after the last scroll", () => {
    const r = rig();
    r.s.note(); r.advance(1500); r.s.note(); r.advance(1500); r.s.note();
    expect(r.commits).toEqual([]);
    r.advance(PLACE_DEBOUNCE_MS - 1); expect(r.commits).toEqual([]);
    r.advance(1); expect(r.commits).toEqual([false]);
  });
  it("a burst of 200 scrolls is one commit", () => {
    const r = rig();
    for (let i = 0; i < 200; i++) { r.s.note(); r.advance(50); }
    r.advance(PLACE_DEBOUNCE_MS); expect(r.commits).toEqual([false]);
  });
  it("at most one commit per minimum gap", () => {
    const r = rig();
    r.s.note(); r.advance(PLACE_DEBOUNCE_MS); expect(r.commits.length).toBe(1);
    r.s.note(); r.advance(PLACE_DEBOUNCE_MS + 100); expect(r.commits.length).toBe(1);
    r.advance(PLACE_MIN_GAP_MS); expect(r.commits.length).toBe(2);
  });
  it("hide commits what is pending at once with keepalive, whatever the gap, and only if pending", () => {
    const r = rig();
    r.s.hide(); expect(r.commits).toEqual([]);
    r.s.note(); r.advance(PLACE_DEBOUNCE_MS);
    r.s.note(); r.s.hide();
    expect(r.commits).toEqual([false, true]);
    expect(r.hasTimer()).toBe(false);
    r.s.hide(); expect(r.commits.length).toBe(2);
  });
  it("cancel and stop drop anything pending", () => {
    const r = rig();
    r.s.note(); r.s.cancel(); r.advance(60_000); expect(r.commits).toEqual([]);
    r.s.stop(); r.s.note(); r.advance(60_000); expect(r.commits).toEqual([]);
  });
});

describe("card ids and anchors", () => {
  it("round-trips and always yields a 790-valid id", () => {
    expect(cardIdFor(3, "a0-points")).toBe("lesson-3:a0-points");
    expect(cardIdFor(3, null)).toBe("lesson-3");
    expect(cardIdFor(3, "Bad Anchor!")).toBe("lesson-3");
    expect(cardIdFor(3, "x".repeat(80))).toBe("lesson-3");
    expect(parseCardId("lesson-3:a0-points")).toEqual({ step: 3, anchor: "a0-points" });
    expect(parseCardId("lesson-12")).toEqual({ step: 12, anchor: null });
    expect(parseCardId("lesson-3:practice")).toEqual({ step: 3, anchor: "practice" });
    expect(parseCardId("other")).toBeNull();
    expect(lessonAnchorId(3, "a0-points")).toBe("lesson-3-a0-points");
  });
  it("picks the section the reading band is in", () => {
    const tops = [{ anchor: "b", top: 300 }, { anchor: "a", top: -400 }, { anchor: "c", top: 900 }];
    expect(pickAnchor(tops, 250)).toBe("a");
    expect(pickAnchor(tops, 300)).toBe("b");
    expect(pickAnchor(tops, 5000)).toBe("c");
    expect(pickAnchor(tops, -1000)).toBe("a");
    expect(pickAnchor([], 10)).toBeNull();
    expect(pickAnchor([{ anchor: "Bad Id", top: 0 }], 10)).toBeNull();
  });
  it("offset percent is clamped and null without a height", () => {
    expect(offsetPercent({ top: 100, height: 1000 }, 600)).toBe(50);
    expect(offsetPercent({ top: 100, height: 1000 }, 50)).toBe(0);
    expect(offsetPercent({ top: 100, height: 1000 }, 5000)).toBe(100);
    expect(offsetPercent({ top: 0, height: 0 }, 5)).toBeNull();
  });
  it("scroll target puts the saved percentage at the band", () => {
    expect(placeScrollTop({ cardTop: 200, cardHeight: 1000, offset: 50, viewportHeight: 800, scrollY: 100 })).toBe(100 + 200 + 500 - 280);
    expect(placeScrollTop({ cardTop: -5000, cardHeight: 100, offset: 0, viewportHeight: 800, scrollY: 0 })).toBe(0);
  });
});

describe("choosePlace", () => {
  const server = { step: 4, cardId: "lesson-4:a0-kp", offsetHint: 40, clientUpdatedAt: "2026-11-01T10:00:00.000Z" };
  const local = { cardId: "lesson-4:a0-ov", offset: 10, at: "2026-11-01T09:00:00.000Z" };
  it("the server value when it is newer", () => { expect(choosePlace({ step: 4, local, server })).toMatchObject({ from: "server", cardId: "lesson-4:a0-kp", offset: 40 }); });
  it("this device when its copy is newer or the server has none", () => {
    expect(choosePlace({ step: 4, local: { ...local, at: "2026-11-01T11:00:00.000Z" }, server })).toMatchObject({ from: "device", cardId: "lesson-4:a0-ov" });
    expect(choosePlace({ step: 4, local, server: null })).toMatchObject({ from: "device" });
  });
  it("never a place in another lesson", () => {
    expect(choosePlace({ step: 5, local, server })).toBeNull();
    expect(choosePlace({ step: 4, local: { ...local, cardId: "lesson-9" }, server: null })).toBeNull();
  });
});

describe("local copy", () => {
  it("parses only valid entries and bounds the map", () => {
    expect(parseLocalPlaces("not json")).toEqual({});
    expect(parseLocalPlaces(JSON.stringify({ "3": { cardId: "lesson-3", offset: 20, at: "x" }, bad: { cardId: "lesson-3", offset: 1, at: "x" }, "4": { cardId: "BAD", offset: 1, at: "x" } }))).toEqual({ "3": { cardId: "lesson-3", offset: 20, at: "x" } });
    let m = {};
    for (let i = 0; i < 60; i++) m = withLocalPlace(m, i, { cardId: `lesson-${i}`, offset: 1, at: new Date(2026, 10, 1, 0, i).toISOString() });
    expect(Object.keys(m).length).toBe(40);
    expect((m as Record<string, unknown>)["0"]).toBeUndefined();
  });
});
