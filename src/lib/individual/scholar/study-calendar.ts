import type { MasteryEntry } from "./mastery";
import { addDays, dayNum, daysInMonth, isDay, monthEnd, monthLabel, monthOf, monthStart, nextMonth, prevMonth, recommendedDate } from "./monthly-review";
import { CALENDAR_KIND, CALENDAR_REACH_DAYS, type CalendarKind } from "./study-calendar-kinds";
import { buildStudyPlan, type PlanSpace, type StudyPlanSettings, type UnstartedSection } from "./study-plan";

// ── THE STUDY CALENDAR ── SCHOLAR-MONTHLY-REVIEW-01 (owner GO, 1 Nov 2026), extending the study plan ───────────────
//
// Pure: no I/O, no clock of its own (`today` is passed in), NO AI. One calendar month, as a grid, from records that already
// exist. Four kinds of mark, each with its own word, glyph and token colour (never colour alone):
//
//   planned          the study plan's activities. The existing pure planner (buildStudyPlan) is run for each week from today
//                    out to 60 days, from the learner's saved settings. Days BEFORE today show only what really happened.
//   due_revision     cards that reach their review date. Counted, and linked to Flashcards. A card due before today is
//                    counted on today (it is overdue), never on a past day.
//   completed        what the learner did, on the date they did it: lessons, revision and case sessions, evaluations, the
//                    cards they reviewed. Each links to the lesson, session or result.
//   monthly_review   the review of the month: its recommended date (policy N days before month end), or when it was taken.
//
// ⚠ RESCHEDULING MOVES THE PLAN ONLY. A planned activity and the monthly review can be moved (migration 830 keeps the move).
//   A card's spaced-repetition date is NEVER touched: moving "Review your due cards" moves that planned activity, not any card.
// ⚠ A CALENDAR IS A VIEW. Nothing here is an assessment, evidence of competence or a Passport record.

export { CALENDAR_KIND, CALENDAR_REACH_DAYS, type CalendarKind };

export type CompletedRecord = { at: string; kind: "lesson" | "revision" | "case" | "evaluation" | "cards"; title: string; detail?: string | null; href: string };
export type CalendarEntryRow = { kind: "plan_activity" | "monthly_review" | "preference"; ref: string; originalDate: string | null; scheduledDate: string | null };

export type CalendarItem = {
  kind: CalendarKind;
  /** Stable within the calendar. */
  key: string;
  title: string;
  detail: string | null;
  href: string | null;
  minutes: number | null;
  count: number | null;
  space: PlanSpace | null;
  /** Whether it can be moved (a planned activity or an untaken monthly review, with 830 present). */
  movable: boolean;
  /** Set when the learner moved it: the date the plan had. */
  movedFrom: string | null;
  /** What a move is saved against. */
  entry: { kind: "plan_activity" | "monthly_review"; ref: string; originalDate: string } | null;
};
export type CalendarDay = { date: string; inMonth: boolean; today: boolean; past: boolean; items: CalendarItem[] };
export type CalendarView = {
  month: string; label: string; prev: string; next: string; today: string;
  weeks: CalendarDay[][];
  /** The days of the month only, in order (the phone agenda). */
  days: CalendarDay[];
  counts: Record<CalendarKind, number>;
  notes: string[];
  canMove: boolean;
};

export type CalendarInput = {
  month: string;
  today: string;
  /** The saved plan settings and the evidence the planner reads, or null: no plan, so nothing is planned. */
  plan: { settings: StudyPlanSettings; entries: readonly MasteryEntry[]; unstarted: readonly UnstartedSection[]; studyId?: string | null } | null;
  /** Cards by the day their review is due (YYYY-MM-DD -> count). Overdue days are folded onto today here. */
  dueByDate: Readonly<Record<string, number>>;
  completed: readonly CompletedRecord[];
  review: {
    recommendDays: number; reminders: boolean; optedOut: boolean;
    /** Whether the learner did anything in the month (a past month with none is not marked). */
    hasActivity: boolean;
    /** The month's original review once taken: when, where its results are, and whether it was late. */
    taken: { at: string; href: string; late: boolean } | null;
    /** Where to start or resume it. */
    startHref: string;
  };
  entries: readonly CalendarEntryRow[];
  canMove: boolean;
  flashcardsHref: string;
};

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Monday = 0. */
const weekday = (iso: string) => ((dayNum(iso) % 7) + 3 + 7) % 7;

/** A planned activity's key: stable from one day to the next while the plan holds (its space, title and which of that title in the window). */
export const planKey = (space: string, title: string, nth: number) => `${space}|${slug(title)}|${nth}`;

/** Pure. A move is allowed only to a real date within 60 days of today, either way, and never before today. A message is the reason it is refused. */
export function validateMove(date: unknown, today: string): { ok: true; date: string } | { ok: false; message: string } {
  if (!isDay(date)) return { ok: false, message: "Choose a real date." };
  if (date < today) return { ok: false, message: "Choose today or a later date." };
  if (dayNum(date) - dayNum(today) > CALENDAR_REACH_DAYS) return { ok: false, message: `Choose a date within the next ${CALENDAR_REACH_DAYS} days.` };
  return { ok: true, date };
}

/** Pure. The month, for the learner, from what already exists. Deterministic. */
export function buildCalendar(input: CalendarInput): CalendarView {
  const { month, today } = input;
  const first = monthStart(month), last = monthEnd(month);
  const notes: string[] = [];
  const byDate = new Map<string, CalendarItem[]>();
  const put = (date: string, item: CalendarItem) => { const list = byDate.get(date) ?? []; list.push(item); byDate.set(date, list); };
  const moves = new Map(input.entries.filter(e => e.kind === "plan_activity").map(e => [e.ref, e]));

  // ── planned: the planner, week by week from today, for the dates that fall in this month ──
  if (input.plan && last >= today) {
    const horizon = addDays(today, CALENDAR_REACH_DAYS);
    const dueIn = (from: string, to: string) => Object.entries(input.dueByDate).reduce((n, [d, c]) => (d >= from && d <= to ? n + c : n), 0);
    const seen = new Map<string, number>();
    for (let ws = today; ws <= horizon; ws = addDays(ws, 7)) {
      const dueCards = ws === today ? dueIn("0000-01-01", today) : dueIn(ws, addDays(ws, 6));
      const plan = buildStudyPlan({ plan: input.plan.settings, entries: input.plan.entries, dueCards, unstarted: input.plan.unstarted, today: ws, studyId: input.plan.studyId });
      for (const d of plan.thisWeek) {
        for (const a of d.activities) {
          const base = `${a.space}|${slug(a.title)}`;
          const nth = seen.get(base) ?? 0;
          seen.set(base, nth + 1);
          const ref = planKey(a.space, a.title, nth);
          const move = moves.get(ref);
          const moved = move?.scheduledDate && isDay(move.scheduledDate) && move.scheduledDate >= today && move.scheduledDate <= horizon ? move.scheduledDate : null;
          const date = moved ?? d.day;
          if (date < first || date > last || date < today) continue;
          put(date, {
            kind: "planned", key: `plan:${ref}`, title: a.title, detail: a.reason, href: a.href, minutes: a.minutes, count: null, space: a.space,
            movable: input.canMove, movedFrom: moved && moved !== d.day ? d.day : null, entry: { kind: "plan_activity", ref, originalDate: d.day },
          });
        }
      }
    }
    if (month > monthOf(today) && dayNum(first) > dayNum(horizon)) notes.push(`The plan is laid out for the next ${CALENDAR_REACH_DAYS} days, so nothing is planned yet this far ahead.`);
  } else if (!input.plan && last >= today) {
    notes.push("Set up your study plan to see planned study on the calendar.");
  }

  // ── due_revision: cards by the day their review is due. Overdue cards are counted today. ──
  if (last >= today) {
    const overdue = Object.entries(input.dueByDate).reduce((n, [d, c]) => (d < today ? n + c : n), 0);
    for (const [d, c] of Object.entries(input.dueByDate)) {
      if (d < today || d < first || d > last || c <= 0) continue;
      const extra = d === today ? overdue : 0;
      const n = c + extra;
      put(d, {
        kind: "due_revision", key: `due:${d}`, title: `${plural(n, "card")} due for review`, detail: extra ? `Including ${extra} that passed ${extra === 1 ? "its" : "their"} date.` : null,
        href: input.flashcardsHref, minutes: null, count: n, space: "revise", movable: false, movedFrom: null, entry: null,
      });
    }
    if (overdue > 0 && today >= first && today <= last && !(input.dueByDate[today] > 0)) {
      put(today, {
        kind: "due_revision", key: `due:${today}`, title: `${plural(overdue, "card")} due for review`, detail: `${overdue === 1 ? "It passed its" : "They passed their"} review date.`,
        href: input.flashcardsHref, minutes: null, count: overdue, space: "revise", movable: false, movedFrom: null, entry: null,
      });
    }
  }

  // ── completed: what really happened, on its own date ──
  const cardDays = new Map<string, { n: number; href: string }>();
  for (const r of input.completed) {
    const date = new Date(Date.parse(r.at)).toISOString().slice(0, 10);
    if (date < first || date > last) continue;
    if (r.kind === "cards") { const c = cardDays.get(date) ?? { n: 0, href: r.href }; c.n += Number(r.title) || 1; cardDays.set(date, c); continue; }
    put(date, { kind: "completed", key: `done:${r.kind}:${r.at}:${r.href}`, title: r.title, detail: r.detail ?? null, href: r.href, minutes: null, count: null, space: null, movable: false, movedFrom: null, entry: null });
  }
  for (const [date, c] of cardDays) {
    put(date, { kind: "completed", key: `done:cards:${date}`, title: `Reviewed ${plural(c.n, "card")}`, detail: null, href: c.href, minutes: null, count: c.n, space: "revise", movable: false, movedFrom: null, entry: null });
  }

  // ── monthly_review: when it was taken, else its recommended date (moved if the learner moved it) ──
  const r = input.review;
  if (r.taken) {
    const date = new Date(Date.parse(r.taken.at)).toISOString().slice(0, 10);
    if (date >= first && date <= last) {
      put(date, { kind: "monthly_review", key: `review:taken:${month}`, title: `Monthly review taken${r.taken.late ? " (late)" : ""}`, detail: "Optional formative review · not verified competence", href: r.taken.href, minutes: null, count: null, space: "evaluate", movable: false, movedFrom: null, entry: null });
    }
  } else if (r.reminders && !r.optedOut && (month >= monthOf(today) || r.hasActivity)) {
    const rec = recommendedDate(month, r.recommendDays);
    const move = input.entries.find(e => e.kind === "monthly_review" && e.ref === month);
    const horizon = addDays(today, CALENDAR_REACH_DAYS);
    const moved = move?.scheduledDate && isDay(move.scheduledDate) && move.scheduledDate >= today && move.scheduledDate <= horizon ? move.scheduledDate : null;
    const date = moved ?? rec;
    if (date >= first && date <= last) {
      put(date, {
        kind: "monthly_review", key: `review:rec:${month}`, title: `Monthly review for ${monthLabel(month)}`,
        detail: date < today ? "Recommended earlier this month, and still open. You can take it any time." : moved ? "Moved by you. Optional: nothing waits on it." : "Recommended around now. Optional: nothing waits on it.",
        href: r.startHref, minutes: null, count: null, space: "evaluate", movable: input.canMove, movedFrom: moved && moved !== rec ? rec : null, entry: { kind: "monthly_review", ref: month, originalDate: rec },
      });
    }
  }

  // ── the grid: Monday first, whole weeks ──
  const from = addDays(first, -weekday(first));
  const to = addDays(last, 6 - weekday(last));
  const weeks: CalendarDay[][] = [];
  const kindRank: Record<CalendarKind, number> = { monthly_review: 0, due_revision: 1, planned: 2, completed: 3 };
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (weekday(d) === 0) weeks.push([]);
    const inMonth = d >= first && d <= last;
    const items = inMonth ? (byDate.get(d) ?? []).slice().sort((a, b) => kindRank[a.kind] - kindRank[b.kind] || a.title.localeCompare(b.title)) : [];
    weeks[weeks.length - 1].push({ date: d, inMonth, today: d === today, past: d < today, items });
  }
  const days = weeks.flat().filter(d => d.inMonth);
  const counts: Record<CalendarKind, number> = { planned: 0, due_revision: 0, completed: 0, monthly_review: 0 };
  for (const d of days) for (const i of d.items) counts[i.kind]++;
  if (days.length !== daysInMonth(month)) notes.push("The calendar could not lay out this month.");
  return { month, label: monthLabel(month), prev: prevMonth(month), next: nextMonth(month), today, weeks, days, counts, notes, canMove: input.canMove };
}
