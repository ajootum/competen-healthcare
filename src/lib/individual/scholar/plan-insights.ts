import { activeWeeksIn, assessmentPerformance, shiftDay, studyDaysInWindow, type SelfReported } from "./learning-definitions";

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
