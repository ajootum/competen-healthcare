import { describe, expect, it } from "vitest";
import type { Occurrence } from "../learning-plan/types";
import type { CalendarItem } from "./study-calendar";
import type { AgendaDay } from "./plan-view";
import {
  calendarHref, cellLabel, dayChip, dayUnits, doneAtOfKey, dotSlice, emptyDayActions, groupCompleted, groupTitle, hasPlansOn, itemStatus, longDayLabel,
  mergeDueRevision, monthGridDates, planStudyPrefill, resolveCalendarState, rowKeys, rowSubtitle, rowWhen, shiftMonth, stepDate, weekStartOf,
} from "./plan-workspace";

// CE-03 (mobile-first): the month grid, a day's dots, the folded completed rows, the single revision row, the empty-day actions and the remembered day.

const TODAY = "2026-11-02"; // a Monday
const item = (o: Partial<CalendarItem> & { key: string; kind: CalendarItem["kind"] }): CalendarItem => ({
  title: o.key, detail: null, href: `/h/${o.key}`, minutes: null, count: null, space: null, movable: false, movedFrom: null, entry: null, ...o,
});
const occ = (o: Partial<Occurrence> = {}): Occurrence => ({
  key: "e1@2026-11-02", entryId: "e1", experience: "scholar", entryType: "study_session", title: "Revise deterioration", description: null, date: TODAY, occurrenceDate: TODAY,
  startTime: "19:00", endTime: null, allDay: false, durationMinutes: 30, link: null, status: "planned", selfReported: false, moved: false, edited: false, recurring: false, ...o,
});
const mine = (key: string, o: Partial<Occurrence> = {}) => item({ key, kind: "personal", occurrence: occ(o), title: o.title ?? key });
const done = (kind: string, at: string, title: string, href = "/learn") => item({ key: `done:${kind}:${at}:${href}`, kind: "completed", title, href, detail: "Lesson studied" });

describe("the month grid", () => {
  it("starts on a Monday, ends on a Sunday and fills the weeks with the days of the months either side", () => {
    const weeks = monthGridDates("2026-11"); // 1 Nov 2026 is a Sunday
    expect(weeks[0]).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(weeks).toHaveLength(6); // the 30th is a Monday: a sixth row
    expect(weeks[5]).toEqual(["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"]);
    expect(weeks.every(w => w.length === 7)).toBe(true);
    expect(weeks.flat().filter(d => d.startsWith("2026-11"))).toHaveLength(30);
  });
  it("needs no leading days when the month starts on a Monday, and six rows when it spans six weeks", () => {
    expect(monthGridDates("2026-06")[0][0]).toBe("2026-06-01"); // a Monday
    expect(monthGridDates("2026-08")).toHaveLength(6); // Sat 1 Aug to Mon 31 Aug
    expect(monthGridDates("2027-02")).toHaveLength(4); // 28 days from a Monday: exactly four rows
  });
  it("counts weeks from Monday and months across the year end", () => {
    expect(weekStartOf("2026-11-08")).toBe("2026-11-02");
    expect(weekStartOf("2026-11-02")).toBe("2026-11-02");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});

describe("the selected day in the address", () => {
  it("defaults to today and the month grid", () => {
    const s = resolveCalendarState({}, TODAY);
    expect(s).toMatchObject({ span: "month", date: TODAY, month: "2026-11", months: ["2026-11"] });
    expect(s.gridDates).toHaveLength(42);
  });
  it("reads ?date= and ?span=week, loading both months of a week that crosses a month end", () => {
    const s = resolveCalendarState({ date: "2026-11-30", span: "week" }, TODAY);
    expect(s).toMatchObject({ span: "week", date: "2026-11-30", weekStart: "2026-11-30", months: ["2026-11", "2026-12"] });
    expect(s.gridDates).toEqual(["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"]);
    expect(resolveCalendarState({ date: "2026-11-04", span: "week" }, TODAY).months).toEqual(["2026-11"]);
  });
  it("falls back to today for nonsense, keeps within three years, and honours the older ?from= and ?month=", () => {
    expect(resolveCalendarState({ date: "nope" }, TODAY).date).toBe(TODAY);
    expect(resolveCalendarState({ date: "2099-01-01" }, TODAY).date).toBe("2029-11-02");
    expect(resolveCalendarState({ from: "2026-11-09" }, TODAY).date).toBe("2026-11-09");
    expect(resolveCalendarState({ month: "2026-12" }, TODAY).date).toBe("2026-12-01");
    expect(resolveCalendarState({ month: "2026-11" }, TODAY).date).toBe(TODAY);
    expect(resolveCalendarState({ span: "year" }, TODAY).span).toBe("month");
  });
  it("steps a week by seven days and a month to its first day (today in this month), and keeps only what differs from the default in the address", () => {
    expect(stepDate({ span: "week", date: "2026-11-04" }, 1, TODAY)).toBe("2026-11-11");
    expect(stepDate({ span: "month", date: "2026-11-20" }, 1, TODAY)).toBe("2026-12-01");
    expect(stepDate({ span: "month", date: "2026-12-20" }, -1, TODAY)).toBe(TODAY);
    expect(calendarHref("/p", { span: "month", date: TODAY, today: TODAY })).toBe("/p?view=calendar");
    expect(calendarHref("/p", { span: "week", date: "2026-11-04", today: TODAY, extra: { study: "s1", add: "1" } })).toBe("/p?view=calendar&study=s1&add=1&span=week&date=2026-11-04");
  });
  it("names a day in full", () => {
    expect(longDayLabel("2026-11-02")).toBe("Monday 2 November");
  });
});

describe("a day's dots", () => {
  it("shows one dot per own entry and Scholar item, own entries first, and all completed records as ONE green dot", () => {
    const items = [
      done("lesson", "2026-11-02T09:00:00.000Z", "Patient safety"), done("lesson", "2026-11-02T10:00:00.000Z", "Patient safety"), done("lesson", "2026-11-02T11:00:00.000Z", "Renal"),
      item({ key: "plan:learn:renal|0", kind: "planned" }), mine("m1", { entryType: "exam" }),
    ];
    const { units } = dayUnits(items);
    expect(units.map(u => u.dot)).toEqual(["mine", "planned", "done"]);
    expect(units[2]).toMatchObject({ label: "3 completed", count: 3 });
  });
  it("adds '+n' past three dots", () => {
    const items = [mine("a"), mine("b"), item({ key: "p1", kind: "planned" }), item({ key: "p2", kind: "planned" }), done("lesson", "2026-11-02T09:00:00.000Z", "X")];
    const { units } = dayUnits(items);
    expect(units).toHaveLength(5);
    const s = dotSlice(units);
    expect(s.shown).toHaveLength(3);
    expect(s.more).toBe(2);
    expect(dotSlice(units.slice(0, 3)).more).toBe(0);
  });
  it("marks busy time and placements as an unavailable (hatched) day: busy has no dot, a placement is also one of my entries", () => {
    const busy = dayUnits([mine("b", { entryType: "busy" })]);
    expect(busy).toEqual({ units: [], unavailable: true });
    const placement = dayUnits([mine("p", { entryType: "placement" })]);
    expect(placement.unavailable).toBe(true);
    expect(placement.units.map(u => u.dot)).toEqual(["mine"]);
  });
  it("leaves an empty day with nothing: plain, and said so to a screen reader", () => {
    expect(dayUnits([])).toEqual({ units: [], unavailable: false });
    expect(cellLabel("Monday 2 November", true, [])).toBe("Monday 2 November, today: nothing planned");
    expect(cellLabel("Tuesday 3 November", false, [mine("a", { title: "Exam" }), mine("b", { entryType: "busy" })])).toBe("Tuesday 3 November: Exam. Unavailable or busy");
  });
});

describe("completed records, folded for display only", () => {
  const a = done("lesson", "2026-11-02T09:00:00.000Z", "Patient safety");
  const b = done("lesson", "2026-11-02T14:30:00.000Z", "Patient safety");
  const c = done("lesson", "2026-11-02T15:00:00.000Z", "Renal");
  const d = done("revision", "2026-11-02T16:00:00.000Z", "Patient safety");
  it("folds the same material and kind into one row and keeps every record key", () => {
    const rows = groupCompleted([a, b, c, d]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ type: "group", title: "Patient safety", kind: "lesson", count: 2 });
    expect(rows[1]).toMatchObject({ type: "single" });
    expect(rowKeys(rows)).toEqual([a.key, b.key, c.key, d.key]);
    expect(rows[0].type === "group" && rows[0].items).toEqual([a, b]);
  });
  it("says 'Patient safety — 2 learning sessions completed', and a lone record stays as it is", () => {
    expect(groupTitle("Patient safety", "lesson", 2)).toBe("Patient safety — 2 learning sessions completed");
    expect(groupTitle("Patient safety", "lesson", 5)).toBe("Patient safety — 5 learning sessions completed");
    expect(groupCompleted([a])).toEqual([{ type: "single", item: a }]);
  });
  it("folds the repeated 'Patient safety · Lesson studied' of one day into one row listing both", () => {
    const rows = groupCompleted([a, b]);
    expect(rows).toHaveLength(1);
    expect(rowKeys(rows)).toHaveLength(2);
  });
  it("leaves a learner's own entry (a different key space) alone, and reads the time out of a key", () => {
    const own = mine("m");
    expect(groupCompleted([own, own])).toHaveLength(2);
    expect(doneAtOfKey(a.key)).toBe("2026-11-02T09:00:00.000Z");
    expect(doneAtOfKey("done:cards:2026-11-02")).toBeNull();
  });
});

describe("one revision row, not two", () => {
  const plan = item({ key: "plan:revise:due|0", kind: "planned", title: "Review your due cards", minutes: 25, space: "revise", href: "/revise", movable: true, entry: { kind: "plan_activity", ref: "revise:due|0", originalDate: TODAY } });
  const duec = item({ key: `due:${TODAY}`, kind: "due_revision", title: "3 cards due for review", count: 3, href: "/flashcards", space: "revise" });
  it("shows ONE row 'Review 3 flashcards' with the plan's minutes when the plan has a revision item and cards are due", () => {
    const m = mergeDueRevision([plan, duec]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kind: "planned", title: "Review 3 flashcards", minutes: 25, count: 3, href: "/flashcards", movable: true });
    expect(m[0].entry).toEqual(plan.entry);
    expect(rowSubtitle(m[0], TODAY)).toBe("Due for revision");
    expect(rowWhen(m[0])).toBe("25 min");
    expect(dayUnits(m).units).toHaveLength(1);
    expect(dayChip(m)).toBe("1 activity • 25 min");
  });
  it("says 'Review 1 flashcard' for one card", () => {
    expect(mergeDueRevision([plan, { ...duec, count: 1 }])[0].title).toBe("Review 1 flashcard");
  });
  it("keeps the single cards-due row on a day with no plan revision item, and the plan item alone when no card is due", () => {
    expect(mergeDueRevision([duec])).toEqual([duec]);
    expect(mergeDueRevision([plan])).toEqual([plan]);
    const other = item({ key: "plan:learn:renal|0", kind: "planned" });
    expect(mergeDueRevision([other, duec])).toEqual([other, duec]);
    expect(rowSubtitle(duec, TODAY)).toBe("Due for revision");
  });
});

describe("a row in words", () => {
  it("names status where the data knows it", () => {
    expect(itemStatus(item({ key: "p", kind: "planned" }), TODAY)).toBe("Suggested");
    expect(itemStatus(item({ key: "p", kind: "planned", movedFrom: "2026-11-02" }), "2026-11-03")).toBe("Postponed");
    expect(itemStatus(mine("m"), TODAY)).toBe("Planned");
    expect(itemStatus(mine("m", { status: "completed", selfReported: true }), TODAY)).toBe("Completed");
    expect(itemStatus(item({ key: "d", kind: "completed" }), TODAY)).toBe("Completed");
    expect(rowSubtitle(item({ key: "p", kind: "planned", space: "learn" }), TODAY)).toBe("Suggested · Learn");
    expect(rowSubtitle(mine("m", { entryType: "exam", link: { kind: "topic", id: "Renal", label: "Renal" } }), TODAY)).toBe("Exam or assessment · about Renal");
  });
  it("sums the day for the header chip: activities and minutes, or what was completed", () => {
    expect(dayChip([mine("a", { durationMinutes: 15 }), item({ key: "p", kind: "planned", minutes: 10 })])).toBe("2 activities • 25 min");
    expect(dayChip([mine("a", { durationMinutes: null })])).toBe("1 activity");
    expect(dayChip([done("lesson", "2026-11-01T09:00:00.000Z", "X"), done("lesson", "2026-11-01T10:00:00.000Z", "X")])).toBe("2 completed");
    expect(dayChip([mine("b", { entryType: "busy" })])).toBe("");
    expect(dayChip([])).toBe("");
  });
});

describe("an empty selected day", () => {
  it("offers Add activity, Plan study and Leave free from today on", () => {
    expect(emptyDayActions({ date: TODAY, today: TODAY, canAdd: true })).toEqual(["add", "plan", "free"]);
    expect(emptyDayActions({ date: "2026-11-20", today: TODAY, canAdd: true })).toEqual(["add", "plan", "free"]);
  });
  it("offers only Add on a past day, and only Leave free when entries cannot be added", () => {
    expect(emptyDayActions({ date: "2026-10-30", today: TODAY, canAdd: true })).toEqual(["add"]);
    expect(emptyDayActions({ date: TODAY, today: TODAY, canAdd: false })).toEqual(["free"]);
  });
  it("prefills Plan study from the plan's next suggestion (title, minutes, a topic the title names), else a plain 30 minute session", () => {
    const days: AgendaDay[] = [
      { date: "2026-11-01", today: false, past: true, items: [item({ key: "plan:learn:old|0", kind: "planned", title: "Old" })] },
      { date: TODAY, today: true, past: false, items: [item({ key: "plan:learn:renal|0", kind: "planned", title: "Learn Renal again", minutes: 20 })] },
    ];
    const links = [{ value: "topic:Renal", kind: "topic" as const, id: "Renal", label: "Renal" }, { value: "material:m1", kind: "material" as const, id: "m1", label: "Renal" }];
    expect(planStudyPrefill(days, links, TODAY)).toEqual({ entryType: "study_session", title: "Learn Renal again", duration: "20", link: "topic:Renal" });
    expect(planStudyPrefill([], links, TODAY)).toEqual({ entryType: "study_session", title: "Study session", duration: "30" });
  });
});

describe("what Today shows", () => {
  it("is the action workspace only when something is planned or due", () => {
    expect(hasPlansOn([], 0, true)).toBe(false);
    expect(hasPlansOn([], 3, false)).toBe(true);
    expect(hasPlansOn([mine("a")], 0, false)).toBe(true);
    expect(hasPlansOn([done("lesson", "2026-11-02T09:00:00.000Z", "X"), mine("b", { entryType: "busy" })], 0, true)).toBe(false);
    expect(hasPlansOn(null, 0, true)).toBe(true);
    expect(hasPlansOn(null, 0, false)).toBe(false);
  });
});
