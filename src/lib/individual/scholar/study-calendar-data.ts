// ── THE STUDY CALENDAR: THE READS ── SCHOLAR-MONTHLY-REVIEW-01 ───────────────────────────────────────────────────
//
// Assembles the pure calendar (study-calendar.ts) from records that already exist. Every read is the caller own rows. The
// plan inputs (the settings and the topic evidence) are handed in by the Progress page, which already read them for the study
// plan card, so nothing is read twice. Unreadable is null: the page says so, it never draws an empty month.

import type { IndividualPolicy } from "../policy";
import { experienceHref } from "../experiences";
import type { MasteryEntry } from "./mastery";
import type { Admin } from "./store";
import type { PlanCalendar, StudyPlanSettings, UnstartedSection } from "./study-plan";
import { buildCalendar, type CalendarView } from "./study-calendar";
import { calendarSchema, listCalendarEntries } from "./store";
import { listMonthlyReviews, loadDueByDate, loadMonthRaw, monthlyReviewOn } from "./monthly-review-data";
import { isMonth, monthActivity, monthEnd, monthOf, monthStanding, monthStart, nextMonth, optedOutOf, prevMonth } from "./monthly-review";
import { learningPlanSchema, listPlanEvents } from "../learning-plan/event-store";
import { learnerCalendarSchema, listEntries } from "../learning-plan/entry-store";
import { expandEntries, plusDays } from "../learning-plan/recurrence";
import { planCalendarFrom } from "./plan-calendar";
import { postponedTopics } from "./plan-proposal";
import { CALENDAR_REACH_DAYS } from "./study-calendar-kinds";

const studyHref = (seg: string) => experienceHref("scholar", `study/${seg}`);

/** The month asked for in the address: a real month from three years back to a year ahead, else this month. */
export function monthFromQuery(q: unknown, today: string): string {
  const cur = monthOf(today);
  if (!isMonth(q)) return cur;
  let lo = cur, hi = cur;
  for (let i = 0; i < 36; i++) lo = prevMonth(lo);
  for (let i = 0; i < 12; i++) hi = nextMonth(hi);
  return q < lo || q > hi ? cur : q;
}

export type CalendarLoad = { view: CalendarView; moveOn: boolean; optOut: { available: boolean; optedOut: boolean } };
type PlanIn = { settings: StudyPlanSettings; entries: readonly MasteryEntry[]; unstarted: readonly UnstartedSection[]; studyId?: string | null; postponed?: ReadonlySet<string>; calendar?: PlanCalendar | null } | null;

/** The last date the learner's own entries are read to for this month (the month's end, or the calendar's reach, whichever is later). */
export const entriesHorizon = (month: string, today: string): string => [monthEnd(month), plusDays(today, CALENDAR_REACH_DAYS)].sort().pop()!;

/** Everything one month of the calendar reads, none of which depends on the plan: so it can be read while the plan itself is still being read. */
export type CalendarReads = {
  month: string;
  raw: NonNullable<Awaited<ReturnType<typeof loadMonthRaw>>>;
  due: NonNullable<Awaited<ReturnType<typeof loadDueByDate>>>;
  reviews: NonNullable<Awaited<ReturnType<typeof listMonthlyReviews>>>;
  store: boolean;
  entries: Awaited<ReturnType<typeof listCalendarEntries>> | null;
  personal: import("../learning-plan/types").Occurrence[];
  postponed: ReadonlySet<string>;
};

/**
 * MY PLAN PERF: the reads of one month, all started together (they used to run in four sequential steps). null when a core source is unreadable.
 * `needPostponed` is false when the caller hands the plan's own postponed set to buildStudyCalendar.
 */
export async function readStudyCalendar(o: { admin: Admin; userId: string; month: string; today: string; needPostponed: boolean }): Promise<CalendarReads | null> {
  const { admin, userId, month, today } = o;
  const store = calendarSchema(admin, userId);
  // PLP: the learner's own calendar entries (840) are shown, and the plan reads them. Absent 840: none, and the plan is as before.
  const hi = entriesHorizon(month, today);
  const personalP = learnerCalendarSchema(admin, userId).then(async has => {
    if (!has) return [] as import("../learning-plan/types").Occurrence[];
    const le = await listEntries(admin, userId, "scholar", hi);
    return le.ok ? expandEntries(le.data.entries, le.data.exceptions, [monthStart(month), today].sort()[0], hi) : [];
  });
  const postponedP = o.needPostponed
    ? learningPlanSchema(admin, userId).then(async has => {
      const events = has ? await listPlanEvents(admin, userId, "scholar", ["topic_postponed"]) : null;
      return events?.ok ? postponedTopics(events.data, today) : new Set<string>();
    })
    : Promise.resolve(new Set<string>());
  const [raw, due, reviews, hasStore, entries, personal, postponed] = await Promise.all([
    loadMonthRaw(admin, userId, month, month), loadDueByDate(admin, userId), listMonthlyReviews(admin, userId), store,
    store.then(s => (s ? listCalendarEntries(admin, userId) : null)), personalP, postponedP,
  ]);
  if (!raw || !due || !reviews) return null;
  return { month, raw, due, reviews, store: hasStore, entries, personal, postponed };
}

export async function loadStudyCalendar(o: {
  admin: Admin; userId: string; policy: IndividualPolicy; month: string; today: string;
  plan: PlanIn;
}): Promise<CalendarLoad | null> {
  const reads = await readStudyCalendar({ admin: o.admin, userId: o.userId, month: o.month, today: o.today, needPostponed: !o.plan?.postponed });
  return reads ? buildStudyCalendar(reads, o) : null;
}

/** Pure. The month's calendar from what was read and the plan. */
export function buildStudyCalendar(reads: CalendarReads, o: { policy: IndividualPolicy; month: string; today: string; plan: PlanIn }): CalendarLoad {
  const { policy, month, today } = o;
  const { raw, due, reviews, store, entries, personal, postponed } = reads;
  const stored = entries?.ok ? entries.data : [];
  const optedOut = policy.scholarMonthlyReviewOptout === "allowed" && optedOutOf(stored);
  const original = monthStanding(reviews, month).original;
  const reviewOn = monthlyReviewOn(policy);
  const view = buildCalendar({
    month, today, plan: o.plan ? { ...o.plan, postponed: o.plan.postponed ?? postponed, calendar: o.plan.calendar ?? planCalendarFrom(personal) } : null, personal, dueByDate: due, completed: raw.completed, entries: stored, canMove: store,
    flashcardsHref: `${studyHref("revise/flashcards")}?view=history`,
    review: {
      recommendDays: policy.scholarMonthlyReviewRecommendDays, reminders: reviewOn && policy.scholarMonthlyReviewReminders === "on", optedOut,
      hasActivity: monthActivity(raw.records, month).sections.length > 0,
      taken: original ? { at: original.createdAt, href: studyHref(`evaluate/${original.id}`), late: original.late } : null,
      startHref: studyHref("evaluate"),
    },
  });
  return { view, moveOn: store, optOut: { available: store && reviewOn && policy.scholarMonthlyReviewOptout === "allowed", optedOut } };
}
