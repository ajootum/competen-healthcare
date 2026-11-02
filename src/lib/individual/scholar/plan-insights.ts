import type { Occurrence } from "../learning-plan/types";
import { activeWeeksIn, assessmentPerformance, localDay, shiftDay, studyDaysInWindow, type SelfReported } from "./learning-definitions";

// ── STUDY INSIGHTS ── PLP-01..04 (owner GO 2 Nov 2026), design "Insights" ─────────────────────────────────────────────
//
// Pure, no AI, no clock of its own. Three measures, each from RECORDED learning and each either measured or "not measured yet" with
// the reason. Missing evidence is NEVER shown as zero: a zero reads as a measurement.
//
//   consistency   how many of the last 28 days (the learner's local days) hold recorded learning, and how many of the last 4 weeks.
//                 Not measured until any learning has been recorded at all.
//   practice      the share of recent answers MARKED BY CODE that were right (AI-evaluated and self-marked answers are not in it).
//                 Not measured with no code-marked answer.
//   retention     the share of recent spaced-review ratings that were "remembered" (3 or more of 5). Not measured with no review.
//
// SELF-REPORTED study (personal study sessions the learner marked completed in their calendar) is shown APART and labelled. It is never
// merged into consistency: a planned session the learner says they did is their word, not a record.
//
// ⚠ INSIGHTS DESCRIBE STUDY. They are not an assessment of competence and nothing here is written to the Passport.

export const INSIGHT_WINDOW_DAYS = 28;
export const PRACTICE_RECENT = 50;
export const PRACTICE_MIN = 5;
export const RETENTION_WINDOW_DAYS = 90;
export const REMEMBERED_QUALITY = 3;
export const SELF_REPORTED_LABEL = "Self-reported: personal study sessions you marked completed in your calendar. They are your word, not recorded learning, and are not counted above.";

export type NotMeasured = { state: "not_measured"; reason: string };
export type Consistency = { state: "measured"; windowDays: number; studyDays: number; activeWeeks: number; weeks: number; lastStudied: string | null } | NotMeasured;
export type PracticePerformance = { state: "measured"; percent: number; answered: number; /** Fewer answers than PRACTICE_MIN: shown with that caution. */ lowEvidence: boolean } | NotMeasured;
export type Retention = { state: "measured"; rememberedPercent: number; reviews: number; windowDays: number } | NotMeasured;
export type InsightRecommendation = { id: string; text: string; basis: string };
export type Insights = {
  consistency: Consistency; practice: PracticePerformance; retention: Retention;
  selfReported: (SelfReported & { label: string }) | null;
  recommendations: InsightRecommendation[];
};

export type InsightInput = {
  /** Learner-local days with recorded learning (studyActivityDays), any age. */
  studyDays: readonly string[];
  today: string;
  attempts: readonly { marking: string; correct: boolean | null; answeredAt: string }[];
  reviews: readonly { quality: number; reviewedAt: string }[];
  selfReported: SelfReported | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Pure. The three measures and at most three plain recommendations, each with the figure it rests on. */
export function buildInsights(i: InsightInput): Insights {
  // consistency
  let consistency: Consistency;
  if (i.studyDays.length === 0) consistency = { state: "not_measured", reason: "No learning has been recorded yet. Study days appear once you have had a lesson, answered a question or reviewed a card." };
  else {
    const last = [...i.studyDays].filter(d => d <= i.today).sort().pop() ?? null;
    consistency = { state: "measured", windowDays: INSIGHT_WINDOW_DAYS, studyDays: studyDaysInWindow(i.studyDays, i.today, INSIGHT_WINDOW_DAYS), activeWeeks: activeWeeksIn(i.studyDays, i.today, 4), weeks: 4, lastStudied: last };
  }
  // practice performance: the most recent code-marked answers
  const coded = i.attempts.filter(a => a.marking === "deterministic" && a.correct !== null).sort((a, b) => b.answeredAt.localeCompare(a.answeredAt)).slice(0, PRACTICE_RECENT);
  const perf = assessmentPerformance(coded);
  const practice: PracticePerformance = perf
    ? { state: "measured", percent: perf.percent, answered: perf.answered, lowEvidence: perf.answered < PRACTICE_MIN }
    : { state: "not_measured", reason: "No practice question marked by the app has been answered yet." };
  // retention
  const since = shiftDay(i.today, -(RETENTION_WINDOW_DAYS - 1));
  const recent = i.reviews.filter(r => r.reviewedAt.slice(0, 10) >= since);
  const retention: Retention = recent.length
    ? { state: "measured", rememberedPercent: Math.round((recent.filter(r => r.quality >= REMEMBERED_QUALITY).length * 100) / recent.length), reviews: recent.length, windowDays: RETENTION_WINDOW_DAYS }
    : { state: "not_measured", reason: "No spaced review has been rated in the last 90 days." };

  const selfReported = i.selfReported && i.selfReported.sessions > 0 ? { ...i.selfReported, label: SELF_REPORTED_LABEL } : null;

  // recommendations: deterministic, each with its basis
  const recs: InsightRecommendation[] = [];
  if (consistency.state === "measured") {
    const gap = consistency.lastStudied ? Math.max(0, Math.round((Date.parse(`${i.today}T00:00:00Z`) - Date.parse(`${consistency.lastStudied}T00:00:00Z`)) / 86_400_000)) : null;
    if (gap !== null && gap >= 7) recs.push({ id: "restart", text: "Start again with one short session this week.", basis: `Your last recorded study was ${plural(gap, "day")} ago.` });
    else if (consistency.studyDays < 8) recs.push({ id: "rhythm", text: "A short session on more days would build a steadier rhythm.", basis: `You studied on ${consistency.studyDays} of the last ${consistency.windowDays} days.` });
  }
  if (practice.state === "measured" && !practice.lowEvidence && practice.percent < 60)
    recs.push({ id: "practice", text: "Go back over the explanations of the questions you missed, then try them again.", basis: `You answered ${practice.percent}% of your last ${practice.answered} app-marked questions correctly.` });
  if (retention.state === "measured" && retention.reviews >= PRACTICE_MIN && retention.rememberedPercent < 60)
    recs.push({ id: "retention", text: "Review cards on the day they are due, in shorter and more frequent sittings.", basis: `You rated ${retention.rememberedPercent}% of your last ${retention.reviews} reviews as remembered.` });
  if (practice.state === "not_measured" && consistency.state === "measured")
    recs.push({ id: "measure_practice", text: "Answer some practice questions so this page can show how they are going.", basis: "No question marked by the app has been answered yet." });
  return { consistency, practice, retention, selfReported, recommendations: recs.slice(0, 3) };
}

// ── THE FOUR TILES AND THE SUGGESTED ADJUSTMENTS ── My Plan correction (CE-03), design "Insights" ─────────────────────────
//
// Study days, flashcards due, practice answered and plan completed over the last 28 days, then a short list of adjustments the learner can
// act on. Pure, no AI. A tile is a COUNT or a ratio of what was recorded or planned. "Practice answered" is a count of answers, not a score,
// so 0 is honest there (captioned "Not measured yet"). "Plan completed" is a ratio and has no figure at all when nothing was planned.

export type PlanCompletion = {
  /** The learner's own planned study sessions dated in the window, up to today (cancelled ones are not planned). */
  planned: number;
  /** Planned sessions the learner marked completed, or that fell on a day with recorded study. */
  completed: number;
  /** Of those completed: marked by the learner (self-reported), and shown by a recorded study day. */
  selfReported: number;
  recorded: number;
  /** completed / planned, whole percent. Null when nothing was planned: no figure, never zero. */
  percent: number | null;
};

/**
 * Pure. Planned versus completed over the window ending today. PLANNED = the learner's own study-session entries in the window (the Scholar
 * plan is computed per request and is not stored, so a past day has no stored plan to count). COMPLETED = such a session the learner marked
 * completed (their word, counted as self-reported) or one that falls on a study-activity day (recorded). Busy times, placements, exams and
 * deadlines are never planned study.
 */
export function planCompletion(occurrences: readonly Occurrence[], studyDays: readonly string[], today: string, windowDays = INSIGHT_WINDOW_DAYS): PlanCompletion {
  const from = shiftDay(today, -(Math.max(1, windowDays) - 1));
  const days = new Set(studyDays);
  const planned = occurrences.filter(o => o.entryType === "study_session" && o.status !== "cancelled" && o.date >= from && o.date <= today);
  let selfReported = 0, recorded = 0;
  for (const o of planned) {
    if (o.status === "completed" && o.selfReported) selfReported++;
    else if (days.has(o.date)) recorded++;
  }
  const completed = selfReported + recorded;
  return { planned: planned.length, completed, selfReported, recorded, percent: planned.length ? Math.round((completed * 100) / planned.length) : null };
}

export type InsightTiles = { windowDays: number; studyDays: number; flashcardsDue: number; practiceAnswered: number; plan: PlanCompletion };
/** Pure. The four tiles. `studyDays` are the shared study-activity days; practice answered counts every recorded answer in the window. */
export function buildTiles(i: {
  studyDays: readonly string[]; today: string; tz?: string; dueCards: number; attempts: readonly { answeredAt: string }[]; occurrences: readonly Occurrence[];
}): InsightTiles {
  const from = shiftDay(i.today, -(INSIGHT_WINDOW_DAYS - 1));
  const inWindow = i.attempts.filter(a => { const d = localDay(a.answeredAt, i.tz ?? "UTC"); return d >= from && d <= i.today; }).length;
  return {
    windowDays: INSIGHT_WINDOW_DAYS, studyDays: studyDaysInWindow(i.studyDays, i.today, INSIGHT_WINDOW_DAYS), flashcardsDue: Math.max(0, Math.floor(i.dueCards)),
    practiceAnswered: inWindow, plan: planCompletion(i.occurrences, i.studyDays, i.today),
  };
}

/** The figure and the caption of the Plan completed tile ("—" with no planned session). */
export function planTile(p: PlanCompletion): { value: string; caption: string } {
  if (p.planned === 0 || p.percent === null) return { value: "—", caption: "No completed sessions recorded" };
  return { value: `${p.completed} of ${p.planned}`, caption: `${p.percent}% of planned sessions completed` };
}
/** The caption under Practice answered: a count, so 0 stays 0, said as not measured. */
export const practiceCaption = (n: number) => (n === 0 ? "Not measured yet" : n === 1 ? "Answer recorded" : "Answers recorded");

export type AdjustmentIcon = "cards" | "check" | "calendar" | "restart" | "practice";
export type AddToPlan =
  /** Opens the add-activity editor with this filled in. The learner confirms, so nothing is written until they save. */
  | { kind: "entry"; title: string; date: string; minutes: number }
  /** Opens the plan settings with this number of days. The learner confirms by saving. */
  | { kind: "settings"; daysPerWeek: number };
export type Adjustment = {
  id: string; icon: AdjustmentIcon; title: string; text: string;
  /** Changes with the evidence, so a "Not now" holds only until it does. */
  fingerprint: string;
  doNow: { href: string } | null;
  addToPlan: AddToPlan | null;
};
export const ADJUSTMENT_DECLINE_PREFIX = "insight:";
export const adjustmentRef = (id: string) => `${ADJUSTMENT_DECLINE_PREFIX}${id}`;
export const MAX_ADJUSTMENTS = 4;

/**
 * Pure. The adjustments worth offering, each with where to do it now and, where it is meaningful, how to add it to the plan: due flashcards go on today,
 * a knowledge check or a short session is scheduled, a change of frequency opens the settings (the learner saves it). One the learner said "Not now" to
 * stays hidden until its fingerprint changes. Never more than MAX_ADJUSTMENTS.
 */
export function buildAdjustments(i: {
  insights: Insights; dueCards: number; today: string;
  hrefs: { flashcards: string; revise: string; mistakes: string; learn: string };
  settings: { daysPerWeek: number } | null;
  /** The learner's own calendar (migration 840) exists, so an activity can be added. */
  canAddEntry: boolean;
  /** `insight:<id>` -> the fingerprint the learner declined. */
  declined: ReadonlyMap<string, string | null>;
}): Adjustment[] {
  const out: Adjustment[] = [];
  const tomorrow = shiftDay(i.today, 1);
  const entry = (title: string, date: string, minutes: number): AddToPlan | null => (i.canAddEntry ? { kind: "entry", title, date, minutes } : null);
  if (i.dueCards > 0) {
    out.push({
      id: "flashcards_due", icon: "cards", title: "Start with your due flashcards", text: `${plural(i.dueCards, "card is", "cards are")} ready for spaced review.`,
      fingerprint: `due:${i.dueCards}`, doNow: { href: i.hrefs.flashcards }, addToPlan: entry("Review due flashcards", i.today, 10),
    });
  }
  for (const r of i.insights.recommendations) {
    const fingerprint = `${r.id}|${r.basis}`.slice(0, 200);
    if (r.id === "restart") out.push({ id: r.id, icon: "restart", title: "Start again with one short session", text: r.basis, fingerprint, doNow: { href: i.hrefs.learn }, addToPlan: entry("Short study session", tomorrow, 15) });
    else if (r.id === "rhythm") {
      const days = i.settings ? Math.min(7, i.settings.daysPerWeek + 1) : null;
      out.push({
        id: r.id, icon: "calendar", title: "Study on more days", text: `${r.basis} A short session on more days would build a steadier rhythm.`, fingerprint, doNow: { href: i.hrefs.learn },
        addToPlan: i.settings && days !== null && days > i.settings.daysPerWeek ? { kind: "settings", daysPerWeek: days } : null,
      });
    } else if (r.id === "practice") out.push({ id: r.id, icon: "practice", title: "Go over the questions you missed", text: r.basis, fingerprint, doNow: { href: i.hrefs.mistakes }, addToPlan: entry("Go over missed questions", tomorrow, 20) });
    else if (r.id === "retention") out.push({ id: r.id, icon: "cards", title: "Review cards on the day they are due", text: r.basis, fingerprint, doNow: { href: i.hrefs.flashcards }, addToPlan: null });
    else if (r.id === "measure_practice") out.push({ id: r.id, icon: "check", title: "Try a knowledge check", text: "There is not enough answered practice to evaluate understanding.", fingerprint, doNow: { href: i.hrefs.revise }, addToPlan: entry("Knowledge check", tomorrow, 20) });
  }
  return out.filter(a => i.declined.get(adjustmentRef(a.id)) !== a.fingerprint).slice(0, MAX_ADJUSTMENTS);
}
