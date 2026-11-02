// ── PROGRESS: THE SMALL DECISIONS OF THE SIMPLER PAGE ── My Plan correction (CE-03) ────────────────────────────────────
//
// Pure, no I/O, no AI, no calculation of its own. Progress used to say the same thing several times: engagement in two places, "Not measured" on
// every card, a table for every list, a chart for one week. These helpers decide what is said once: one activity summary from the shared definition of
// a study day, one line for what is not measured yet, a summary line for each list that folds away, and whether there are enough weeks to draw a trend.
// Nothing here changes a figure; it only chooses how many times and how loudly the page says it.

export type ActivityIn = { windowDays: number; studyDays: number; answers: number; reviews: number | null; decisions: number | null; checks: number | null; lastStudied: string | null };
export type ActivityExtra = { activeWeeks: number; weeks: number } | null;
export type ActivitySummary = ActivityIn & { activeWeeks: number | null; weeks: number | null; /** "5 study days in the last 28 · 2 of 4 weeks active · ..." */ line: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Pure. ONE learning-activity summary from the progress workspace's engagement (which carries every kind of activity) and, when it measured,
 * Learning Intelligence's active weeks. Both count study days with the shared definition over the same window, so they cannot disagree.
 */
export function activitySummary(eng: ActivityIn, extra: ActivityExtra): ActivitySummary {
  const parts = [`${plural(eng.studyDays, "study day")} in the last ${eng.windowDays}`];
  if (extra) parts.push(`${extra.activeWeeks} of the last ${extra.weeks} weeks active`);
  parts.push(plural(eng.answers, "answer"));
  if (eng.reviews !== null) parts.push(plural(eng.reviews, "review"));
  if (eng.decisions) parts.push(plural(eng.decisions, "case decision"));
  if (eng.checks) parts.push(plural(eng.checks, "Teach Me check"));
  return { ...eng, activeWeeks: extra?.activeWeeks ?? null, weeks: extra?.weeks ?? null, line: parts.join(" · ") };
}

export type MeasureIn = { id: string; title: string; state: string };
/**
 * Pure. Which measures have a figure and which have not yet. The page draws a card for each measured one and ONE concise line for the rest (or ONE
 * empty state when none is measured), instead of a "Not measured" card each.
 */
export function measureGroups(items: readonly MeasureIn[]): { measured: string[]; notMeasured: string[]; none: boolean; line: string | null } {
  const measured = items.filter(i => i.state === "measured").map(i => i.id);
  const notMeasured = items.filter(i => i.state !== "measured").map(i => i.title);
  const none = measured.length === 0 && items.length > 0;
  const list = notMeasured.length <= 1 ? notMeasured.join("") : `${notMeasured.slice(0, -1).join(", ")} and ${notMeasured[notMeasured.length - 1]}`;
  return { measured, notMeasured, none, line: notMeasured.length && !none ? `Not measured yet: ${list}. They appear once there is enough practice to say.` : null };
}
/** The one empty state of a section where nothing is measured yet. */
export const noMeasureLine = (what: string) => `Nothing is measured yet for ${what}. Answer practice questions or review cards and it appears here.`;

/** Pure. A trend is drawn only when at least `min` weeks (or periods) hold data: one or two points are not a trend. */
export function enoughForTrend(counts: readonly number[], min = 3): boolean {
  return counts.filter(n => n > 0).length >= min;
}
export const TREND_NEEDS = "A trend appears once you have answers in at least 3 different weeks. Your answers so far are in the figures above.";

/** Pure. The summary line shown on a fold-away list. */
export function listSummary(noun: { one: string; many?: string }, total: number, detail: string | null = null): string {
  return `${plural(total, noun.one, noun.many)}${detail ? ` · ${detail}` : ""}`;
}
/** Pure. "3 of 5 practised" style detail for topics and materials. */
export function practisedDetail(practised: number, total: number): string | null {
  return total > 0 ? `${practised} of ${total} practised` : null;
}

/** Pure. Learning Intelligence's own sentences without the engagement one ("You studied on 5 of the last 28 days ..."): the learning-activity block says it once. */
export function withoutEngagementInsight(insights: readonly string[]): string[] {
  return insights.filter(s => !/^You (studied on \d+ of the last|have not studied in the last)/.test(s));
}
