import { describe, expect, it } from "vitest";
import { EXPLORE_OFF, LEARNING_HOME, MY_COURSES_NONE, PROGRESS_NONE, completedView, exploreView, myCoursesView, programmeLine, programmesView, type RecordLike } from "./courses-view";

const rec = (over: Partial<RecordLike> = {}): RecordLike =>
  ({ id: "r1", title: "Infection control", code: "IC1", status: "enrolled", delivery: "hosted", enrolledAt: "2026-10-01", ...over });
const prog = (code: string) => ({ code, label: `Programme ${code}`, profession: "Nursing", country: "Uganda", level: "Level 6" });

describe("exploreView", () => {
  it("is the honest empty state while Learning is off, with no link", () => {
    expect(exploreView(false)).toEqual({ kind: "off", text: EXPLORE_OFF });
  });
  it("is ONE handoff to Competen Learning when it is on", () => {
    expect(exploreView(true)).toEqual({ kind: "handoff", href: LEARNING_HOME });
  });
});

describe("myCoursesView", () => {
  it("says none while Learning is off, whatever was passed", () => {
    expect(myCoursesView(false, [rec()])).toEqual({ kind: "empty", text: MY_COURSES_NONE });
  });
  it("says could not be read, never none, when the read failed", () => {
    expect(myCoursesView(true, null)).toEqual({ kind: "unreadable" });
  });
  it("lists only records still open, and says none when only completed or withdrawn ones exist", () => {
    const v = myCoursesView(true, [rec({ id: "a" }), rec({ id: "b", status: "completed" }), rec({ id: "c", status: "withdrawn" }), rec({ id: "d", status: "in_progress", delivery: "external" })]);
    expect(v.kind === "items" && v.items.map(i => i.id)).toEqual(["a", "d"]);
    expect(v.kind === "items" && v.items[1].statusLabel).toBe("In progress");
    expect(v.kind === "items" && v.items[1].deliveryLabel).toBe("With another provider");
    expect(myCoursesView(true, [rec({ status: "completed" }), rec({ status: "withdrawn" })])).toEqual({ kind: "empty", text: MY_COURSES_NONE });
    expect(myCoursesView(true, [])).toEqual({ kind: "empty", text: MY_COURSES_NONE });
  });
});

describe("completedView", () => {
  const done = { recordId: "r1", title: "Sepsis", completedOn: "2026-09-01", outcomeLabel: "Course completion", evidenceLabel: "Recorded by Competen Learning", certificates: [{ no: "C-1", revoked: false }] };
  it("distinguishes off, unreadable, empty and listed", () => {
    expect(completedView(false, [done])).toEqual({ kind: "empty", text: PROGRESS_NONE });
    expect(completedView(true, null)).toEqual({ kind: "unreadable" });
    expect(completedView(true, [])).toEqual({ kind: "empty", text: PROGRESS_NONE });
    const v = completedView(true, [done]);
    expect(v.kind === "items" && v.items[0].certificates).toEqual([{ no: "C-1", revoked: false }]);
  });
});

describe("programmesView", () => {
  it("is unreadable when either read failed for a reason other than the table being absent", () => {
    expect(programmesView({ ok: false, notProvisioned: false }, { ok: true, data: [] })).toEqual({ kind: "unreadable" });
    expect(programmesView({ ok: true, data: null }, { ok: false, notProvisioned: false })).toEqual({ kind: "unreadable" });
  });
  it("says nothing is set up where programmes are absent or none are offered", () => {
    const absent = programmesView({ ok: false, notProvisioned: true }, { ok: false, notProvisioned: true });
    expect(absent.kind).toBe("none");
    const none = programmesView({ ok: true, data: null }, { ok: true, data: [] });
    expect(none.kind === "none" && none.text).toMatch(/has not set up a programme/);
  });
  it("tells the learner to choose in My Learning when some are offered but none is chosen", () => {
    const v = programmesView({ ok: true, data: null }, { ok: true, data: [prog("a"), prog("b")] });
    expect(v.kind === "none" && v.text).toMatch(/Choose your programme/);
    expect(v.kind === "none" && v.offered).toHaveLength(2);
  });
  it("shows the chosen programme with its framework count and the others offered", () => {
    const v = programmesView({ ok: true, data: { ...prog("a"), frameworks: [{}, {}, {}] } }, { ok: true, data: [prog("a"), prog("b")] });
    expect(v.kind === "chosen" && v.programme.frameworkCount).toBe(3);
    expect(v.kind === "chosen" && v.others.map(o => o.code)).toEqual(["b"]);
  });
  it("programmeLine skips what is not recorded", () => {
    expect(programmeLine({ profession: "Nursing", level: null, country: "Uganda" })).toBe("Nursing · Uganda");
  });
});

describe("copy", () => {
  it("never offers to enrol, buy, pay or certify", () => {
    for (const t of [EXPLORE_OFF, MY_COURSES_NONE, PROGRESS_NONE]) expect(t).not.toMatch(/enrol|buy|pay|certif/i);
  });
});
