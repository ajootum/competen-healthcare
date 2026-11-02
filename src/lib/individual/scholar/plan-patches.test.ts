import { describe, expect, it } from "vitest";
import type { Occurrence } from "../learning-plan/types";
import type { AgendaDay } from "./plan-view";
import { applyPlanPatches, applyPlanPatchesToDay, isPendingItem, pendingOccurrence, type PlanPatch } from "./plan-patches";
import { personalItem, type CalendarItem } from "./study-calendar";

// MY PLAN instant updates: the pure patches laid over the days the server sent. The server still decides everything; these only show a change at once.

const D1 = "2026-11-02", D2 = "2026-11-03", D3 = "2026-11-04";
const day = (date: string, items: CalendarItem[] = []): AgendaDay => ({ date, today: date === D1, past: false, items });
const plan = (key: string, o: Partial<CalendarItem> = {}): CalendarItem => ({
  kind: "planned", key, title: key, detail: null, href: "/x", minutes: 20, count: null, space: "learn", movable: true, movedFrom: null,
  entry: { kind: "plan_activity", ref: "learn:renal|0", originalDate: D1 }, ...o,
});
const occ = (o: Partial<Occurrence> = {}): Occurrence => ({
  key: "e1@2026-11-02", entryId: "e1", experience: "scholar", entryType: "study_session", title: "Revise", description: null, date: D1, occurrenceDate: D1,
  startTime: "19:00", endTime: null, allDay: false, durationMinutes: 30, link: null, status: "planned", selfReported: false, moved: false, edited: false, recurring: false, ...o,
});
const days = () => [day(D1, [plan("plan:a|0"), personalItem(occ())]), day(D2), day(D3)];
const keys = (d: AgendaDay[], date: string) => d.find(x => x.date === date)!.items.map(i => i.key);

describe("applyPlanPatches", () => {
  it("returns the days untouched when there is nothing to show", () => {
    const d = days();
    expect(applyPlanPatches(d, [])).toBe(d);
  });
  it("moves a planned activity to the new day and marks where it was (a postponement)", () => {
    const out = applyPlanPatches(days(), [{ kind: "move", key: "plan:a|0", to: D2 }]);
    expect(keys(out, D1)).toEqual(["entry:e1@2026-11-02"]);
    expect(keys(out, D2)).toEqual(["plan:a|0"]);
    expect(out[1].items[0].movedFrom).toBe(D1);
  });
  it("puts a moved activity back without a moved mark", () => {
    const moved = applyPlanPatches(days(), [{ kind: "move", key: "plan:a|0", to: D2 }]);
    const back = applyPlanPatches(moved, [{ kind: "move", key: "plan:a|0", to: D1, restore: true }]);
    expect(keys(back, D1)).toContain("plan:a|0");
    expect(back[0].items.find(i => i.key === "plan:a|0")!.movedFrom).toBeNull();
  });
  it("moves one of the learner's own entries and shows it on the new date", () => {
    const out = applyPlanPatches(days(), [{ kind: "move", key: "entry:e1@2026-11-02", to: D3 }]);
    expect(keys(out, D3)).toEqual(["entry:e1@2026-11-02"]);
    expect(out[2].items[0].occurrence).toMatchObject({ date: D3, occurrenceDate: D1, moved: true });
  });
  it("removes one item by key, or every item of an entry series", () => {
    expect(keys(applyPlanPatches(days(), [{ kind: "remove", key: "plan:a|0" }]), D1)).toEqual(["entry:e1@2026-11-02"]);
    expect(keys(applyPlanPatches(days(), [{ kind: "remove", entryId: "e1" }]), D1)).toEqual(["plan:a|0"]);
  });
  it("adds a pending entry, once however often it is applied, and shows it as pending", () => {
    const pending = personalItem(pendingOccurrence("t1", { entryType: "exam", title: "Exam", description: null, date: D2, startTime: null, endTime: null, durationMinutes: null, recurring: false }));
    const patch: PlanPatch = { kind: "add", date: D2, item: pending };
    const once = applyPlanPatches(days(), [patch]);
    const twice = applyPlanPatches(once, [patch]);
    expect(keys(once, D2)).toEqual(keys(twice, D2));
    expect(keys(once, D2)).toHaveLength(1);
    expect(isPendingItem(once[1].items[0])).toBe(true);
    expect(once[1].items[0].occurrence?.allDay).toBe(true);
  });
  it("ignores an item added to a day that is not shown, and a move of something that is not there", () => {
    const pending = personalItem(pendingOccurrence("t2", { entryType: "exam", title: "Far", description: null, date: "2027-01-01", startTime: null, endTime: null, durationMinutes: null, recurring: false }));
    const out = applyPlanPatches(days(), [{ kind: "add", date: "2027-01-01", item: pending }, { kind: "move", key: "nope", to: D2 }]);
    expect(out.flatMap(d => d.items)).toHaveLength(2);
  });
  it("replaces an item in place (marked done, edited)", () => {
    const done = personalItem(occ({ status: "completed", selfReported: true }));
    const out = applyPlanPatches(days(), [{ kind: "replace", key: "entry:e1@2026-11-02", item: done }]);
    expect(out[0].items.find(i => i.key === done.key)!.detail).toMatch(/self-reported/);
  });
  it("does not change the days it was given", () => {
    const d = days();
    applyPlanPatches(d, [{ kind: "remove", entryId: "e1" }, { kind: "move", key: "plan:a|0", to: D2 }]);
    expect(keys(d, D1)).toEqual(["plan:a|0", "entry:e1@2026-11-02"]);
  });
});

describe("applyPlanPatchesToDay (the Today list)", () => {
  const items = [plan("plan:a|0"), plan("plan:b|0")];
  it("takes a postponed activity off today's list", () => {
    expect(applyPlanPatchesToDay(D1, items, [{ kind: "move", key: "plan:a|0", to: D2 }]).map(i => i.key)).toEqual(["plan:b|0"]);
  });
  it("takes a set-aside activity off and shows an added one", () => {
    const pending = personalItem(pendingOccurrence("t3", { entryType: "study_session", title: "Mine", description: null, date: D1, startTime: "09:00", endTime: null, durationMinutes: 20, recurring: false }));
    const out = applyPlanPatchesToDay(D1, items, [{ kind: "remove", key: "plan:b|0" }, { kind: "add", date: D1, item: pending }]);
    expect(out.map(i => i.key)).toEqual([pending.key, "plan:a|0"]);
  });
  it("leaves the list alone when there are no patches", () => {
    expect(applyPlanPatchesToDay(D1, items, [])).toBe(items);
  });
});
