// ── THE STUDY CALENDAR: THE READS ── SCHOLAR-MONTHLY-REVIEW-01 ───────────────────────────────────────────────────
//
// Assembles the pure calendar (study-calendar.ts) from records that already exist. Every read is the caller own rows. The
// plan inputs (the settings and the topic evidence) are handed in by the Progress page, which already read them for the study
// plan card, so nothing is read twice. Unreadable is null: the page says so, it never draws an empty month.

import type { IndividualPolicy } from "../policy";
import { experienceHref } from "../experiences";
import type { MasteryEntry } from "./mastery";
import type { Admin } from "./store";
import type { StudyPlanSettings, UnstartedSection } from "./study-plan";
import { buildCalendar, type CalendarView } from "./study-calendar";
import { calendarSchema, listCalendarEntries } from "./store";
import { listMonthlyReviews, loadDueByDate, loadMonthRaw, monthlyReviewOn } from "./monthly-review-data";
import { isMonth, monthActivity, monthOf, monthStanding, nextMonth, optedOutOf, prevMonth } from "./monthly-review";

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

export async function loadStudyCalendar(o: {
  admin: Admin; userId: string; policy: IndividualPolicy; month: string; today: string;
  plan: { settings: StudyPlanSettings; entries: readonly MasteryEntry[]; unstarted: readonly UnstartedSection[]; studyId?: string | null } | null;
}): Promise<CalendarLoad | null> {
  const { admin, userId, policy, month, today } = o;
  const [raw, due, reviews, store] = await Promise.all([
    loadMonthRaw(admin, userId, month, month), loadDueByDate(admin, userId), listMonthlyReviews(admin, userId), calendarSchema(admin, userId),
  ]);
  if (!raw || !due || !reviews) return null;
  const entries = store ? await listCalendarEntries(admin, userId) : null;
  const stored = entries?.ok ? entries.data : [];
  const optedOut = policy.scholarMonthlyReviewOptout === "allowed" && optedOutOf(stored);
  const original = monthStanding(reviews, month).original;
  const reviewOn = monthlyReviewOn(policy);
  const view = buildCalendar({
    month, today, plan: o.plan, dueByDate: due, completed: raw.completed, entries: stored, canMove: store,
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
