import { describe, expect, it } from "vitest";
import type { Occurrence } from "../learning-plan/types";
import type { CalendarDay, CalendarItem } from "./study-calendar";
import { buildAdjustments, buildInsights, buildTiles, planCompletion, planTile, practiceCaption, adjustmentRef, MAX_ADJUSTMENTS } from "./plan-insights";
import { STARTING_PLAN, effectiveSettings } from "./plan-settings";
import { agendaTone, clock12, dayParts, isAvailableDay, rangeLabel, setupFormFrom, weekAgenda, whenLabel } from "./plan-view";
import { buildComingUp, buildDoneToday, dayWord, planRefOfKey, relatesTo, startHref, startLabel, todaySchedule } from "./plan-today-view";
import { chooseToday, type RecommendInput } from "./plan-recommend";
import type { MasteryEntry } from "./mastery";

// My Plan correction (CE-03): the starting plan, the agenda with its empty days, the Insights tiles and adjustments, and what Today shows below its main card.

const TODAY = "2026-11-02";
const occ = (o: Partial<Occurrence> = {}): Occurrence => ({
  key: "e1@2026-11-02", entryId: "e1", experience: "scholar", entryType: "study_session", title: "Revise deterioration", description: null, date: TODAY, occurrenceDate: TODAY,
  startTime: "19:00", endTime: null, allDay: false, durationMinutes: 30, link: null, status: "planned", selfReported: false, moved: false, edited: false, recurring: false, ...o,
});
const item = (o: Partial<CalendarItem> & { key: string; kind: CalendarItem["kind"] }): CalendarItem => ({
  title: o.key, detail: null, href: `/h/${o.key}`, minutes: null, count: null, space: null, movable: false, movedFrom: null, entry: null, ...o,
});
const day = (date: string, items: CalendarItem[]): CalendarDay => ({ date, inMonth: true, today: date === TODAY, past: date < TODAY, items });

describe("the starting plan", () => {
  it("is learn consistently, 30 minutes a session, 5 days a week (150 a week), with no exam and no priorities", () => {
    expect(STARTING_PLAN).toMatchObject({ goalType: "learn", sessionMinutes: 30, daysPerWeek: 5, weeklyMinutes: 150, examDate: null, examLabel: null, goal: null });
    expect(STARTING_PLAN.priorities).toEqual([]);
    expect(STARTING_PLAN.weeklyMinutes).toBe(STARTING_PLAN.sessionMinutes! * STARTING_PLAN.daysPerWeek);
  });
  it("stands in only when nothing is saved, and a saved plan replaces it", () => {
    expect(effectiveSettings(null)).toEqual({ settings: STARTING_PLAN, starting: true });
    const saved = { ...STARTING_PLAN, daysPerWeek: 3, weeklyMinutes: 90 };
    expect(effectiveSettings(saved)).toEqual({ settings: saved, starting: false });
  });
  it("opens the setup form at its numbers, so personalising starts from what the plan already does", () => {
    expect(setupFormFrom(STARTING_PLAN)).toMatchObject({ goalType: "learn", sessionMinutes: "30", daysPerWeek: "5" });
  });
});

describe("the agenda", () => {
  it("lays all seven days, empty ones included, and says which are open (Available)", () => {
    const days = [day("2026-11-03", [item({ key: "a", kind: "personal", occurrence: occ() })]), day("2026-11-05", [item({ key: "b", kind: "planned" })])];
    const w = weekAgenda(days, TODAY, TODAY);
    expect(w).toHaveLength(7);
    expect(w.map(isAvailableDay)).toEqual([true, false, true, false, true, true, true]);
  });
  it("tones a row by whose it is: the learner's, Scholar's, unavailable, or done", () => {
    expect(agendaTone(item({ key: "p", kind: "personal", occurrence: occ() }))).toBe("mine");
    expect(agendaTone(item({ key: "x", kind: "personal", occurrence: occ({ entryType: "placement" }) }))).toBe("unavailable");
    expect(agendaTone(item({ key: "y", kind: "personal", occurrence: occ({ entryType: "busy" }) }))).toBe("unavailable");
    expect(agendaTone(item({ key: "z", kind: "personal", occurrence: occ({ entryType: "exam" }) }))).toBe("mine");
    for (const k of ["planned", "due_revision", "monthly_review"] as const) expect(agendaTone(item({ key: k, kind: k }))).toBe("scholar");
    expect(agendaTone(item({ key: "d", kind: "completed" }))).toBe("done");
  });
  it("says a time the way a learner does, with its length", () => {
    expect(clock12("19:00")).toBe("7:00 PM");
    expect(clock12("00:15")).toBe("12:15 AM");
    expect(clock12("12:00")).toBe("12:00 PM");
    expect(whenLabel(occ())).toBe("7:00 PM · 30 min");
    expect(whenLabel(occ({ startTime: "08:00", endTime: "16:00", durationMinutes: null }))).toBe("8:00 AM–4:00 PM");
    expect(whenLabel(occ({ allDay: true, startTime: null, durationMinutes: null }))).toBe("All day");
    expect(whenLabel({ minutes: 10 })).toBe("10 min");
    expect(whenLabel({ minutes: null })).toBe("");
  });
  it("names the date column and the range", () => {
    expect(dayParts("2026-11-03")).toEqual({ num: "3", weekday: "Tue" });
    expect(rangeLabel("2026-11-02", "2026-11-08")).toBe("2 to 8 Nov 2026");
    expect(rangeLabel("2026-10-30", "2026-11-05")).toBe("30 Oct to 5 Nov 2026");
  });
});

describe("what Today shows below its main card", () => {
  const week = weekAgenda([
    day(TODAY, [item({ key: "plan:learn:renal|0", kind: "planned", title: "Learn Renal", minutes: 25 }), item({ key: "due:2026-11-02", kind: "due_revision" }), item({ key: "done:1", kind: "completed", title: "Renal lesson" })]),
    day("2026-11-03", [item({ key: "entry:e1@2026-11-03", kind: "personal", title: "Clinical placement", occurrence: occ({ entryType: "placement", date: "2026-11-03" }) }),
      item({ key: "entry:e2@2026-11-03", kind: "personal", title: "Revise deterioration", occurrence: occ({ key: "e2@2026-11-03", date: "2026-11-03" }) })]),
    day("2026-11-04", [item({ key: "plan:revise:due|0", kind: "planned", title: "Review your due cards", minutes: 10 }), item({ key: "due:2026-11-04", kind: "due_revision", title: "3 cards due for review" })]),
  ], TODAY, TODAY);

  it("lists the next planned and personal items, Scholar and personal apart, without the one in the main card, unavailable times or what is done", () => {
    const up = buildComingUp(week, { today: TODAY, nextRef: "learn:renal" });
    expect(up.map(i => [i.source, i.label, i.title])).toEqual([
      ["personal", "Your activity", "Revise deterioration"],
      ["scholar", "Scholar plan", "Review your due cards"],
      ["scholar", "Cards due", "3 cards due for review"],
    ]);
    expect(up[0].when).toBe("7:00 PM · 30 min");
    expect(buildComingUp(week, { today: TODAY, nextRef: null }).map(i => i.title)[0]).toBe("Learn Renal");
  });
  it("with today's schedule on the page, Coming up starts tomorrow", () => {
    expect(buildComingUp(week, { today: TODAY, nextRef: null, fromTomorrow: true }).map(i => i.title)[0]).toBe("Revise deterioration");
  });
  it("today's schedule leaves out the next study session (and its cards-due row), never anything else", () => {
    const items = week[0].items;
    expect(todaySchedule(items, "learn:renal").map(i => i.key)).toEqual(["due:2026-11-02", "done:1"]);
    expect(todaySchedule(items, "revise:due").map(i => i.key)).toEqual(["plan:learn:renal|0", "done:1"]);
    expect(todaySchedule(items, null)).toHaveLength(3);
  });
  it("is capped at five", () => {
    const many = weekAgenda([day(TODAY, Array.from({ length: 9 }, (_, i) => item({ key: `plan:learn:t${i}|0`, kind: "planned" })))], TODAY, TODAY);
    expect(buildComingUp(many, { today: TODAY, nextRef: null })).toHaveLength(5);
  });
  it("lists what was done today: recorded learning, and the learner's own word apart", () => {
    const d = weekAgenda([day(TODAY, [item({ key: "done:1", kind: "completed", title: "Renal lesson", detail: "x" }),
      item({ key: "entry:e9@2026-11-02", kind: "personal", title: "My session", occurrence: occ({ status: "completed", selfReported: true }) }),
      item({ key: "entry:e8@2026-11-02", kind: "personal", title: "Planned only", occurrence: occ() })])], TODAY, TODAY);
    expect(buildDoneToday(d, TODAY).map(i => [i.title, i.basis])).toEqual([["Renal lesson", "recorded"], ["My session", "self_reported"]]);
    expect(buildDoneToday([], TODAY)).toEqual([]);
  });
  it("says Resume for an open lesson or revision session, else Start, and keeps the connected study session on the link", () => {
    expect(startLabel({ rule: "unfinished" })).toBe("Resume");
    expect(startLabel({ rule: "gaps" })).toBe("Start");
    expect(startHref("/individual/scholar/study/learn?topic=Renal", "11111111-1111-4111-8111-111111111111")).toContain("study=11111111-1111-4111-8111-111111111111");
    expect(startHref("/x", null)).toBe("/x");
    expect(startHref(null, "11111111-1111-4111-8111-111111111111")).toBeNull();
  });
  it("names the topic and the material an activity is about", () => {
    const e = { kind: "topic", key: "renal", label: "Renal", materialId: "m1" } as unknown as MasteryEntry;
    expect(relatesTo({ topics: ["renal"] }, [e], [{ id: "m1", title: "Renal notes" }])).toBe("Renal · from Renal notes");
    expect(relatesTo({ topics: [] }, [e], [])).toBeNull();
    expect(relatesTo({ topics: ["zzz"] }, [e], [])).toBeNull();
  });
  it("reads the activity ref out of a calendar key, and words a day", () => {
    expect(planRefOfKey("plan:learn:renal|2")).toBe("learn:renal");
    expect(planRefOfKey("due:2026-11-02")).toBeNull();
    expect(dayWord(TODAY, TODAY)).toBe("Today");
    expect(dayWord("2026-11-03", TODAY)).toBe("Tomorrow");
    expect(dayWord("2026-11-06", TODAY)).toBe("Fri 6 Nov");
  });
});

describe("the next activity respects what the Calendar moved", () => {
  const base: RecommendInput = {
    today: TODAY, ruleOrder: ["due_revision", "gaps"], settings: STARTING_PLAN, plan: null, entries: [], dueCards: 3, unfinished: [], monthlyWeak: null, coverage: [], calendar: [], events: [],
    postponed: new Set(), fallbackMinutes: 20,
  };
  it("leaves out an activity moved off today, without counting it as declined", () => {
    expect(chooseToday(base).next?.ref).toBe("revise:due");
    const r = chooseToday({ ...base, moved: new Set(["revise:due"]) });
    expect(r.next).toBeNull();
    expect(r.declined).toBe(0);
  });
});

describe("plan completed", () => {
  it("is completed planned sessions over planned sessions in the last 28 days, from the learner's calendar plus records or their own word", () => {
    const planned = [occ({ date: "2026-11-01", key: "a" }), occ({ date: "2026-10-30", key: "b", status: "completed", selfReported: true }), occ({ date: "2026-10-25", key: "c" }), occ({ date: "2026-10-01", key: "old" })];
    const p = planCompletion(planned, ["2026-11-01"], TODAY);
    expect(p).toEqual({ planned: 3, completed: 2, selfReported: 1, recorded: 1, percent: 67 });
  });
  it("has no figure at all when nothing was planned, never zero", () => {
    const none = planCompletion([occ({ entryType: "busy" }), occ({ entryType: "exam" }), occ({ status: "cancelled" })], ["2026-11-01"], TODAY);
    expect(none).toMatchObject({ planned: 0, completed: 0, percent: null });
    expect(planTile(none)).toEqual({ value: "—", caption: "No completed sessions recorded" });
  });
  it("is 0 of n (a real zero) when sessions were planned and none done", () => {
    const p = planCompletion([occ({ date: "2026-10-30" })], [], TODAY);
    expect(p).toMatchObject({ planned: 1, completed: 0, percent: 0 });
    expect(planTile(p)).toEqual({ value: "0 of 1", caption: "0% of planned sessions completed" });
  });
  it("does not count a day after today, and counts the learner's completion once", () => {
    const p = planCompletion([occ({ date: "2026-11-05" }), occ({ date: "2026-11-01", status: "completed", selfReported: true })], ["2026-11-01"], TODAY);
    expect(p).toMatchObject({ planned: 1, completed: 1, selfReported: 1, recorded: 0 });
  });
});

describe("the four Insights tiles", () => {
  it("counts study days (shared definition), cards due, practice answered in the window, and the plan", () => {
    const t = buildTiles({
      studyDays: ["2026-10-01", "2026-10-20", "2026-11-01"], today: TODAY, dueCards: 3,
      attempts: [{ answeredAt: "2026-11-01T10:00:00Z" }, { answeredAt: "2026-10-10T10:00:00Z" }, { answeredAt: "2026-09-01T10:00:00Z" }], occurrences: [],
    });
    expect(t).toMatchObject({ windowDays: 28, studyDays: 2, flashcardsDue: 3, practiceAnswered: 2 });
    expect(t.plan.percent).toBeNull();
  });
  it("shows 0 practice answered as a count, captioned Not measured yet", () => {
    const t = buildTiles({ studyDays: [], today: TODAY, dueCards: 0, attempts: [], occurrences: [] });
    expect(t.practiceAnswered).toBe(0);
    expect(practiceCaption(0)).toBe("Not measured yet");
    expect(practiceCaption(1)).toBe("Answer recorded");
    expect(practiceCaption(5)).toBe("Answers recorded");
  });
});

describe("the suggested adjustments", () => {
  const hrefs = { flashcards: "/f", revise: "/r", mistakes: "/m", learn: "/l" };
  const insightsWith = (over: Partial<Parameters<typeof buildInsights>[0]>) => buildInsights({ studyDays: ["2026-11-01"], today: TODAY, attempts: [], reviews: [], selfReported: null, ...over });
  const ins = (o: Partial<Parameters<typeof buildAdjustments>[0]> = {}) => buildAdjustments({
    insights: insightsWith({}), dueCards: 3, today: TODAY, hrefs, settings: { daysPerWeek: 4 }, canAddEntry: true, declined: new Map(), ...o,
  });

  it("starts with the due flashcards: Do it now goes to the cards, Add to plan puts a short activity on today", () => {
    const a = ins()[0];
    expect(a).toMatchObject({ id: "flashcards_due", icon: "cards", title: "Start with your due flashcards", text: "3 cards are ready for spaced review.", doNow: { href: "/f" }, addToPlan: { kind: "entry", title: "Review due flashcards", date: TODAY, minutes: 10 } });
  });
  it("offers a knowledge check when there is no answered practice, scheduled for tomorrow", () => {
    const k = ins({ dueCards: 0 }).find(a => a.id === "measure_practice");
    expect(k).toMatchObject({ icon: "check", title: "Try a knowledge check", text: "There is not enough answered practice to evaluate understanding.", doNow: { href: "/r" }, addToPlan: { kind: "entry", date: "2026-11-03", minutes: 20 } });
  });
  it("turns a thin rhythm into a change of frequency that opens the settings, never applied by itself", () => {
    const a = ins({ dueCards: 0, insights: insightsWith({ studyDays: ["2026-11-01", "2026-10-20"] }) }).find(x => x.id === "rhythm");
    expect(a?.addToPlan).toEqual({ kind: "settings", daysPerWeek: 5 });
    const seven = ins({ dueCards: 0, settings: { daysPerWeek: 7 }, insights: insightsWith({ studyDays: ["2026-11-01", "2026-10-20"] }) }).find(x => x.id === "rhythm");
    expect(seven?.addToPlan).toBeNull();
  });
  it("has no Add to plan for an entry when the learner's calendar is not there", () => {
    expect(ins({ canAddEntry: false })[0].addToPlan).toBeNull();
  });
  it("hides one the learner said Not now to until its evidence changes, and never lists more than four", () => {
    const first = ins()[0];
    expect(ins({ declined: new Map([[adjustmentRef("flashcards_due"), first.fingerprint]]) }).some(a => a.id === "flashcards_due")).toBe(false);
    expect(ins({ dueCards: 4, declined: new Map([[adjustmentRef("flashcards_due"), first.fingerprint]]) }).some(a => a.id === "flashcards_due")).toBe(true);
    expect(ins().length).toBeLessThanOrEqual(MAX_ADJUSTMENTS);
  });
});
