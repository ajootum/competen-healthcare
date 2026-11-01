import { describe, expect, it } from "vitest";
import { buildCalendar, CALENDAR_KIND, planKey, validateMove, type CalendarEntryRow, type CalendarInput } from "./study-calendar";

const SETTINGS = { examDate: null, examLabel: null, weeklyMinutes: 240, daysPerWeek: 4, goal: null, priorities: ["Preload", "Afterload"] };
const base = (over: Partial<CalendarInput> = {}): CalendarInput => ({
  month: "2026-10", today: "2026-10-14",
  plan: { settings: SETTINGS, entries: [], unstarted: [] },
  dueByDate: {}, completed: [], entries: [], canMove: true, flashcardsHref: "/f",
  review: { recommendDays: 5, reminders: true, optedOut: false, hasActivity: true, taken: null, startHref: "/evaluate" },
  ...over,
});
const items = (v: ReturnType<typeof buildCalendar>, kind?: string) => v.days.flatMap(d => d.items.map(i => ({ date: d.date, ...i }))).filter(i => !kind || i.kind === kind);

describe("the month grid", () => {
  const v = buildCalendar(base());
  it("lays out whole Monday-first weeks around the month", () => {
    expect(v.weeks.length).toBe(5);
    expect(v.weeks.every(w => w.length === 7)).toBe(true);
    expect(v.weeks[0][0].date).toBe("2026-09-28");   // 1 October 2026 is a Thursday
    expect(v.weeks[4][6].date).toBe("2026-11-01");
    expect(v.days.length).toBe(31);
    expect(v.weeks[0].filter(d => d.inMonth).length).toBe(4);
    expect(v.weeks[0][0].items).toEqual([]);   // outside the month: empty
  });
  it("names the neighbouring months and marks today and the past", () => {
    expect([v.prev, v.next, v.label]).toEqual(["2026-09", "2026-11", "October 2026"]);
    expect(v.days.find(d => d.today)?.date).toBe("2026-10-14");
    expect(v.days.filter(d => d.past).length).toBe(13);
  });
  it("gives every kind its own word and glyph", () => {
    const words = Object.values(CALENDAR_KIND).map(k => k.word), glyphs = Object.values(CALENDAR_KIND).map(k => k.glyph);
    expect(new Set(words).size).toBe(4);
    expect(new Set(glyphs).size).toBe(4);
  });
});

describe("planned activities", () => {
  const v = buildCalendar(base());
  it("come from the existing planner, from today on, and never on a past day", () => {
    const planned = items(v, "planned");
    expect(planned.length).toBeGreaterThan(8);   // about two weeks of 4 days
    expect(planned.every(i => i.date >= "2026-10-14")).toBe(true);
    expect(planned[0]).toMatchObject({ kind: "planned", movable: true, movedFrom: null });
    expect(planned.some(i => i.title === "Learn Preload")).toBe(true);
    expect(planned.every(i => i.entry?.kind === "plan_activity" && !!i.entry.ref)).toBe(true);
  });
  it("is deterministic, and keys repeated titles apart", () => {
    expect(buildCalendar(base())).toEqual(v);
    const keys = items(v, "planned").map(i => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("shows nothing planned without a plan, and says so", () => {
    const n = buildCalendar(base({ plan: null }));
    expect(items(n, "planned")).toEqual([]);
    expect(n.notes.join(" ")).toMatch(/Set up your study plan/);
  });
  it("shows nothing planned in a past month", () => {
    expect(items(buildCalendar(base({ month: "2026-09" })), "planned")).toEqual([]);
  });
  it("moves one activity to the date the learner chose, and says where it was", () => {
    const first = items(v, "planned")[0];
    const entry: CalendarEntryRow = { kind: "plan_activity", ref: first.entry!.ref, originalDate: first.entry!.originalDate, scheduledDate: "2026-10-30" };
    const moved = buildCalendar(base({ entries: [entry] }));
    const m = items(moved, "planned").find(i => i.key === first.key)!;
    expect(m.date).toBe("2026-10-30");
    expect(m.movedFrom).toBe(first.entry!.originalDate);
    expect(items(moved, "planned").length).toBe(items(v, "planned").length);
  });
  it("ignores a move to a day already past or beyond sixty days", () => {
    const first = items(v, "planned")[0];
    const stale = buildCalendar(base({ entries: [{ kind: "plan_activity", ref: first.entry!.ref, originalDate: first.date, scheduledDate: "2026-10-02" }] }));
    expect(items(stale, "planned").find(i => i.key === first.key)?.date).toBe(first.date);
    const far = buildCalendar(base({ entries: [{ kind: "plan_activity", ref: first.entry!.ref, originalDate: first.date, scheduledDate: "2027-03-01" }] }));
    expect(items(far, "planned").find(i => i.key === first.key)?.date).toBe(first.date);
  });
  it("offers no Move without migration 830", () => {
    expect(items(buildCalendar(base({ canMove: false })), "planned").every(i => !i.movable)).toBe(true);
    expect(buildCalendar(base({ canMove: false })).canMove).toBe(false);
  });
  it("planKey is stable", () => {
    expect(planKey("learn", "Learn Preload!", 1)).toBe("learn|learn-preload|1");
  });
});

describe("cards due for revision", () => {
  it("counts cards by their review day, and folds overdue cards onto today, never a past day", () => {
    const v = buildCalendar(base({ dueByDate: { "2026-10-05": 3, "2026-10-14": 2, "2026-10-20": 4, "2026-11-03": 9 } }));
    const due = items(v, "due_revision");
    expect(due.map(i => [i.date, i.count])).toEqual([["2026-10-14", 5], ["2026-10-20", 4]]);
    expect(due[0].detail).toMatch(/Including 3/);
    expect(due.every(i => i.href === "/f")).toBe(true);
  });
  it("marks today when only overdue cards remain", () => {
    const due = items(buildCalendar(base({ dueByDate: { "2026-10-01": 2 } })), "due_revision");
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ date: "2026-10-14", count: 2 });
  });
});

describe("completed work", () => {
  it("sits on the real date, links to where it is, and sums card reviews into one line a day", () => {
    const v = buildCalendar(base({
      completed: [
        { at: "2026-10-03T09:00:00Z", kind: "lesson", title: "Haemodynamics", href: "/learn?session=s#lesson-1" },
        { at: "2026-10-03T10:00:00Z", kind: "cards", title: "1", href: "/f" }, { at: "2026-10-03T10:01:00Z", kind: "cards", title: "1", href: "/f" },
        { at: "2026-10-09T12:00:00Z", kind: "evaluation", title: "Evaluation", href: "/evaluate/e1" },
        { at: "2026-09-30T12:00:00Z", kind: "revision", title: "September", href: "/r" },
      ],
    }));
    const done = items(v, "completed");
    expect(done.map(i => [i.date, i.title])).toEqual([["2026-10-03", "Haemodynamics"], ["2026-10-03", "Reviewed 2 cards"], ["2026-10-09", "Evaluation"]]);
    expect(done[0].href).toBe("/learn?session=s#lesson-1");
  });
});

describe("the monthly review", () => {
  it("is recommended five days before month end", () => {
    const r = items(buildCalendar(base()), "monthly_review");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ date: "2026-10-26", movable: true, href: "/evaluate", entry: { kind: "monthly_review", ref: "2026-10", originalDate: "2026-10-26" } });
  });
  it("moves to the learner's date, and keeps the recommended one as where it was", () => {
    const r = items(buildCalendar(base({ entries: [{ kind: "monthly_review", ref: "2026-10", originalDate: "2026-10-26", scheduledDate: "2026-10-20" }] })), "monthly_review");
    expect(r[0]).toMatchObject({ date: "2026-10-20", movedFrom: "2026-10-26" });
  });
  it("shows the real date once it is taken, late or not, and nothing to move", () => {
    const r = items(buildCalendar(base({ review: { ...base().review, taken: { at: "2026-10-27T10:00:00Z", href: "/evaluate/e9", late: false } } })), "monthly_review");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ date: "2026-10-27", movable: false, href: "/evaluate/e9" });
    const late = items(buildCalendar(base({ month: "2026-09", review: { ...base().review, taken: { at: "2026-10-02T10:00:00Z", href: "/evaluate/e8", late: true } } })), "monthly_review");
    expect(late).toEqual([]);   // taken in October: it shows on October, not September
    expect(items(buildCalendar(base({ review: { ...base().review, taken: { at: "2026-10-02T10:00:00Z", href: "/e", late: true } } })), "monthly_review")[0].title).toMatch(/late/);
  });
  it("is not marked when reminders are off or the learner opted out, and a past month with no activity is left alone", () => {
    expect(items(buildCalendar(base({ review: { ...base().review, reminders: false } })), "monthly_review")).toEqual([]);
    expect(items(buildCalendar(base({ review: { ...base().review, optedOut: true } })), "monthly_review")).toEqual([]);
    expect(items(buildCalendar(base({ month: "2026-08", review: { ...base().review, hasActivity: false } })), "monthly_review")).toEqual([]);
    expect(items(buildCalendar(base({ month: "2026-08", review: { ...base().review, hasActivity: true } })), "monthly_review")).toHaveLength(1);
  });
  it("a moved date that is already past or too far is ignored", () => {
    const r = items(buildCalendar(base({ entries: [{ kind: "monthly_review", ref: "2026-10", originalDate: "2026-10-26", scheduledDate: "2026-10-01" }] })), "monthly_review");
    expect(r[0].date).toBe("2026-10-26");
  });
});

describe("validateMove", () => {
  it("allows today to sixty days on, real dates only", () => {
    expect(validateMove("2026-10-14", "2026-10-14")).toEqual({ ok: true, date: "2026-10-14" });
    expect(validateMove("2026-12-13", "2026-10-14")).toEqual({ ok: true, date: "2026-12-13" });
    expect(validateMove("2026-12-14", "2026-10-14").ok).toBe(false);
    expect(validateMove("2026-10-13", "2026-10-14").ok).toBe(false);
    expect(validateMove("2026-02-30", "2026-01-01").ok).toBe(false);
    expect(validateMove(null, "2026-10-14").ok).toBe(false);
  });
});
