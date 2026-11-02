import { describe, expect, it } from "vitest";
import type { CalendarDay, CalendarItem } from "./study-calendar";
import type { Occurrence } from "../learning-plan/types";
import {
  addDay, agendaItemOrder, agendaStart, buildEntryBody, buildSettingsBody, emptyEntryForm, linkOptions, minutesWords, monthsOfWeek, parsePlanView, parsePriorities,
  planViewHref, sequencePreview, timeChoices, setupFormFrom, settingsWithSessionMinutes, weekAgenda, weekdayIndex, DEFAULT_SETUP,
} from "./plan-view";

const TODAY = "2026-11-02"; // a Monday

const item = (over: Partial<CalendarItem> & { key: string; kind: CalendarItem["kind"] }): CalendarItem => ({
  title: over.key, detail: null, href: null, minutes: null, count: null, space: null, movable: false, movedFrom: null, entry: null, ...over,
});
const occ = (startTime: string | null): Occurrence => ({
  key: "k", entryId: "e", experience: "scholar", entryType: "study_session", title: "t", description: null, date: TODAY, occurrenceDate: TODAY,
  startTime, endTime: null, allDay: startTime === null, durationMinutes: null, link: null, status: "planned", selfReported: false, moved: false, edited: false, recurring: false,
});
const day = (date: string, items: CalendarItem[]): CalendarDay => ({ date, inMonth: true, today: date === TODAY, past: date < TODAY, items });

describe("My Plan view parsing", () => {
  it("defaults to Today and accepts only the three views", () => {
    expect(parsePlanView(undefined)).toBe("today");
    expect(parsePlanView("calendar")).toBe("calendar");
    expect(parsePlanView(["insights", "x"])).toBe("insights");
    expect(parsePlanView("admin")).toBe("today");
    expect(parsePlanView("")).toBe("today");
  });
  it("builds addresses: Today is the bare address, extras only when given", () => {
    expect(planViewHref("/p", "today")).toBe("/p");
    expect(planViewHref("/p", "calendar", { from: "2026-11-09", study: null })).toBe("/p?view=calendar&from=2026-11-09");
  });
});

describe("the agenda window", () => {
  it("keeps the start within reach and falls back to today", () => {
    expect(agendaStart(undefined, TODAY)).toBe(TODAY);
    expect(agendaStart("not-a-date", TODAY)).toBe(TODAY);
    expect(agendaStart("2026-02-30", TODAY)).toBe(TODAY);
    expect(agendaStart("2026-11-09", TODAY)).toBe("2026-11-09");
    expect(agendaStart("2020-01-01", TODAY)).toBe(addDay(TODAY, -28));
    expect(agendaStart("2030-01-01", TODAY)).toBe(addDay(TODAY, 56));
  });
  it("names one month, or two when the week crosses a month end", () => {
    expect(monthsOfWeek("2026-11-02")).toEqual(["2026-11"]);
    expect(monthsOfWeek("2026-10-28")).toEqual(["2026-10", "2026-11"]);
  });
});

describe("agenda grouping of mixed items", () => {
  it("orders a day: own entries (all-day first, then by time), plan, review, cards due, done", () => {
    const items = [
      item({ key: "done", kind: "completed" }),
      item({ key: "due", kind: "due_revision" }),
      item({ key: "plan", kind: "planned" }),
      item({ key: "late", kind: "personal", occurrence: occ("16:00") }),
      item({ key: "review", kind: "monthly_review" }),
      item({ key: "allday", kind: "personal", occurrence: occ(null) }),
      item({ key: "early", kind: "personal", occurrence: occ("08:30") }),
    ];
    expect(agendaItemOrder(items).map(i => i.key)).toEqual(["allday", "early", "late", "plan", "review", "due", "done"]);
  });

  it("lays seven days from the start out of the loaded months, with empty days where nothing is loaded", () => {
    const days = [day("2026-11-02", [item({ key: "a", kind: "planned" })]), day("2026-11-04", [item({ key: "b", kind: "personal", occurrence: occ("09:00") }), item({ key: "c", kind: "planned" })])];
    const w = weekAgenda(days, "2026-11-02", TODAY);
    expect(w).toHaveLength(7);
    expect(w.map(d => d.date)[6]).toBe("2026-11-08");
    expect(w[0]).toMatchObject({ today: true, past: false });
    expect(w[0].items.map(i => i.key)).toEqual(["a"]);
    expect(w[1].items).toEqual([]);
    expect(w[2].items.map(i => i.key)).toEqual(["b", "c"]);
  });

  it("joins two months for a week that crosses the month end, and marks past days", () => {
    const oct = [day("2026-10-30", [item({ key: "o", kind: "completed" })]), day("2026-10-31", [])];
    const nov = [day("2026-11-01", [item({ key: "n", kind: "planned" })])];
    const w = weekAgenda([...oct, ...nov], "2026-10-30", TODAY);
    expect(w.map(d => d.items.map(i => i.key))).toEqual([["o"], [], ["n"], [], [], [], []]);
    expect(w[0].past).toBe(true);
    expect(w[3].today).toBe(true);
  });
});

describe("the learner's entry form", () => {
  const links = linkOptions([{ id: "m1", title: "Cardiac notes" }], ["Heart failure", "heart failure", "  Sepsis "]);
  it("needs a title and a real date, and says so in plain words", () => {
    const f = emptyEntryForm(TODAY);
    expect(buildEntryBody(f, TODAY, { links, schedule: true })).toEqual({ ok: false, error: "Give the entry a title." });
    expect(buildEntryBody({ ...f, title: "Read", date: "" }, TODAY, { links, schedule: true })).toMatchObject({ ok: false });
  });
  it("sends a simple all-day entry without times, link or repeat", () => {
    const r = buildEntryBody({ ...emptyEntryForm(TODAY), title: "  Study   cardiac ", entryType: "study_session" }, TODAY, { links, schedule: true });
    expect(r).toEqual({ ok: true, body: { entryType: "study_session", title: "Study cardiac", description: null, startTime: null, endTime: null, durationMinutes: null, link: null, entryDate: TODAY, recurrence: null } });
  });
  it("checks times, length and link", () => {
    const base = { ...emptyEntryForm(TODAY), title: "x" };
    expect(buildEntryBody({ ...base, endTime: "10:00" }, TODAY, { links, schedule: true })).toMatchObject({ ok: false });
    expect(buildEntryBody({ ...base, startTime: "10:00", endTime: "09:00" }, TODAY, { links, schedule: true })).toMatchObject({ ok: false });
    expect(buildEntryBody({ ...base, duration: "3" }, TODAY, { links, schedule: true })).toMatchObject({ ok: false });
    const ok = buildEntryBody({ ...base, startTime: "09:00", endTime: "10:00", duration: "45", link: "material:m1" }, TODAY, { links, schedule: true });
    expect(ok).toMatchObject({ ok: true, body: { startTime: "09:00", endTime: "10:00", durationMinutes: 45, link: { kind: "material", id: "m1", label: "Cardiac notes" } } });
  });
  it("needs a repeat to end, by a date or a count", () => {
    const base = { ...emptyEntryForm(TODAY), title: "x", repeat: "weekly" as const, weekdays: [2, 0, 2] };
    expect(buildEntryBody(base, TODAY, { links, schedule: true })).toMatchObject({ ok: false });
    expect(buildEntryBody({ ...base, until: "2026-11-01" }, TODAY, { links, schedule: true })).toMatchObject({ ok: false });
    expect(buildEntryBody({ ...base, endMode: "count", count: "0" }, TODAY, { links, schedule: true })).toMatchObject({ ok: false });
    expect(buildEntryBody({ ...base, endMode: "count", count: "8" }, TODAY, { links, schedule: true })).toMatchObject({ ok: true, body: { recurrence: { freq: "weekly", interval: 1, byweekday: [0, 2], count: 8 } } });
    expect(buildEntryBody({ ...base, until: "2026-12-20" }, TODAY, { links, schedule: true })).toMatchObject({ ok: true, body: { recurrence: { until: "2026-12-20" } } });
  });
  it("leaves the date and repeat out when a whole series is edited", () => {
    const r = buildEntryBody({ ...emptyEntryForm(TODAY), title: "x" }, TODAY, { links, schedule: false });
    expect(r.ok && "entryDate" in r.body).toBe(false);
    expect(r.ok && "recurrence" in r.body).toBe(false);
  });
  it("offers materials then distinct topics, case aside", () => {
    expect(links.map(l => l.value)).toEqual(["material:m1", "topic:Heart failure", "topic:Sepsis"]);
  });
  it("counts weekdays from Monday", () => {
    expect(weekdayIndex("2026-11-02")).toBe(0);
    expect(weekdayIndex("2026-11-08")).toBe(6);
  });
});

describe("the three-question setup", () => {
  it("reads settings back, defaulting a plan from before 840", () => {
    expect(setupFormFrom(null)).toEqual(DEFAULT_SETUP);
    expect(setupFormFrom({ goalType: null, sessionMinutes: null, daysPerWeek: 4, weeklyMinutes: 240, examDate: "2026-12-01", examLabel: "OSCE", goal: null, priorities: ["a", "b"] }))
      .toMatchObject({ goalType: "exam", sessionMinutes: "60", daysPerWeek: "4", examDate: "2026-12-01", priorities: "a\nb" });
  });
  it("asks the exam date only for an exam, and sends the new shape with 840", () => {
    expect(buildSettingsBody({ ...DEFAULT_SETUP, goalType: "exam" }, { extras: true, today: TODAY })).toMatchObject({ ok: false });
    expect(buildSettingsBody({ ...DEFAULT_SETUP, goalType: "exam", examDate: "2026-12-01", examLabel: " OSCE " }, { extras: true, today: TODAY }))
      .toEqual({ ok: true, body: { goalType: "exam", sessionMinutes: 25, daysPerWeek: 4, examDate: "2026-12-01", examLabel: "OSCE", goal: null, priorities: [] } });
    const learn = buildSettingsBody({ ...DEFAULT_SETUP, examDate: "2026-12-01", examLabel: "x" }, { extras: true, today: TODAY });
    expect(learn).toMatchObject({ ok: true, body: { goalType: "learn", examDate: null, examLabel: null } });
  });
  it("falls back to the old shape without 840, and carries a confirmed increase", () => {
    expect(buildSettingsBody({ ...DEFAULT_SETUP, sessionMinutes: "30", daysPerWeek: "5" }, { extras: false, today: TODAY, confirmIncrease: true }))
      .toEqual({ ok: true, body: { weeklyMinutes: 150, daysPerWeek: 5, examDate: null, examLabel: null, goal: null, priorities: [], confirmIncrease: true } });
  });
  it("refuses too little time, and bad minutes or days", () => {
    expect(buildSettingsBody({ ...DEFAULT_SETUP, sessionMinutes: "15", daysPerWeek: "1" }, { extras: true, today: TODAY })).toMatchObject({ ok: false });
    expect(buildSettingsBody({ ...DEFAULT_SETUP, sessionMinutes: "5" }, { extras: true, today: TODAY })).toMatchObject({ ok: false });
    expect(buildSettingsBody({ ...DEFAULT_SETUP, daysPerWeek: "8" }, { extras: true, today: TODAY })).toMatchObject({ ok: false });
  });
  it("takes priorities one per line or comma separated, once each, at most ten", () => {
    expect(parsePriorities("Sepsis, sepsis\n Heart failure \n\n")).toEqual(["Sepsis", "Heart failure"]);
    expect(parsePriorities(Array.from({ length: 14 }, (_, i) => `t${i}`).join("\n"))).toHaveLength(10);
  });
  it("applies a reflection offer to the session length only, keeping the old shape for an old plan", () => {
    const s = { goalType: "learn" as const, sessionMinutes: 30, daysPerWeek: 4, weeklyMinutes: 120, examDate: null, examLabel: null, goal: null, priorities: [] };
    expect(settingsWithSessionMinutes(s, 20)).toMatchObject({ goalType: "learn", sessionMinutes: 20, daysPerWeek: 4 });
    expect(settingsWithSessionMinutes({ ...s, goalType: null }, 20)).toMatchObject({ weeklyMinutes: 80, daysPerWeek: 4 });
  });
});

describe("time choices", () => {
  it("are 96 quarter-hours, sorted, plus a saved time that is off the grid", () => {
    const t = timeChoices();
    expect(t).toHaveLength(96);
    expect(t[0]).toBe("00:00");
    expect(t[95]).toBe("23:45");
    const withOdd = timeChoices(["09:10", "09:15", "bad"]);
    expect(withOdd).toHaveLength(97);
    expect(withOdd.indexOf("09:10")).toBe(withOdd.indexOf("09:00") + 1);
  });
});

describe("the Ready page card words", () => {
  it("shows the first steps and how many more", () => {
    expect(sequencePreview([1, 2, 3, 4, 5, 6, 7, 8], 6)).toEqual({ shown: [1, 2, 3, 4, 5, 6], more: 2 });
    expect(sequencePreview([1, 2], 6)).toEqual({ shown: [1, 2], more: 0 });
  });
  it("says a workload in hours and minutes", () => {
    expect(minutesWords(45)).toBe("45 minutes");
    expect(minutesWords(1)).toBe("1 minute");
    expect(minutesWords(60)).toBe("1 hour");
    expect(minutesWords(135)).toBe("2 hours 15 minutes");
  });
});
