import { GOAL_TYPES, type GoalType, type ScholarPlanSettings } from "../learning-plan/types";
import { cleanStudyPlanInput, STUDY_PLAN_LIMITS, type CleanStudyPlan } from "./study-plan-input";

// ── THE SIMPLIFIED PLAN SETTINGS ── PLP-01..04 (owner GO 2 Nov 2026), migration 840 ───────────────────────────────
//
// Pure. Three questions: what are you aiming for (goalType: learn | exam | revise), how long is one session (sessionMinutes,
// 10 to 240) and how many days a week (daysPerWeek, 1 to 7). The exam date is asked only for an exam. Advanced, all optional:
// priority topics, exam name, a free-text goal. weekly_minutes (the 780 column the planner reads) is sessionMinutes x daysPerWeek.
//
// The OLD shape (weeklyMinutes, daysPerWeek, examDate, ...) is still accepted, so nothing that saves a plan today breaks.
//
// APPROVAL RULE (design section 7). The plan never raises the learner's workload by itself. A change to the workload beyond
// `scholar_plan_max_weekly_minutes` that is also an INCREASE needs the learner's explicit confirmation (confirmIncrease: true);
// without it the route answers 409 with the explanation. Goal, priority and exam-date changes are only ever made by the learner's
// own Save (they are recorded as a settings change with before and after).

export const SESSION_LIMITS = { minMinutes: 10, maxMinutes: 240 } as const;
export type CleanPlanSettings = CleanStudyPlan & { goalType: GoalType | null; sessionMinutes: number | null };
export type CleanPlanSettingsResult =
  | { ok: true; value: CleanPlanSettings; shape: "new" | "old" }
  | { ok: false; message: string; identifier?: boolean };

const whole = (x: unknown): number | null => {
  if (typeof x === "number") return Number.isInteger(x) ? x : null;
  if (typeof x === "string" && /^\d{1,5}$/.test(x.trim())) return Number(x.trim());
  return null;
};

/** Pure. Checks what the learner sent. `today` is the learner's local day (YYYY-MM-DD). */
export function cleanPlanSettings(body: unknown, today: string): CleanPlanSettingsResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const isNew = b.goalType !== undefined || b.sessionMinutes !== undefined;
  if (!isNew) {
    const old = cleanStudyPlanInput(body, today);
    return old.ok ? { ok: true, value: { ...old.value, goalType: null, sessionMinutes: null }, shape: "old" } : old;
  }
  const goalType = b.goalType;
  if (typeof goalType !== "string" || !(GOAL_TYPES as readonly string[]).includes(goalType)) return { ok: false, message: "Choose what you are aiming for: learn consistently, prepare for an exam, or revise." };
  const sessionMinutes = whole(b.sessionMinutes);
  if (sessionMinutes === null || sessionMinutes < SESSION_LIMITS.minMinutes || sessionMinutes > SESSION_LIMITS.maxMinutes)
    return { ok: false, message: `Enter how many minutes one study session lasts, between ${SESSION_LIMITS.minMinutes} and ${SESSION_LIMITS.maxMinutes}.` };
  const daysPerWeek = whole(b.daysPerWeek);
  if (daysPerWeek === null || daysPerWeek < STUDY_PLAN_LIMITS.minDays || daysPerWeek > STUDY_PLAN_LIMITS.maxDays)
    return { ok: false, message: `Choose how many days a week you will study, from ${STUDY_PLAN_LIMITS.minDays} to ${STUDY_PLAN_LIMITS.maxDays}.` };
  const weeklyMinutes = sessionMinutes * daysPerWeek;
  if (weeklyMinutes < STUDY_PLAN_LIMITS.minMinutes) return { ok: false, message: `That is only ${weeklyMinutes} minutes a week. Plan at least ${STUDY_PLAN_LIMITS.minMinutes}.` };
  const exam = goalType === "exam";
  const rawDate = typeof b.examDate === "string" ? b.examDate.trim() : b.examDate;
  if (exam && (rawDate === null || rawDate === undefined || rawDate === "")) return { ok: false, message: "Enter the date of your exam, or choose another aim." };
  const checked = cleanStudyPlanInput({ examDate: exam ? rawDate : null, examLabel: b.examLabel, weeklyMinutes, daysPerWeek, goal: b.goal, priorities: b.priorities }, today);
  if (!checked.ok) return checked;
  return { ok: true, value: { ...checked.value, goalType: goalType as GoalType, sessionMinutes }, shape: "new" };
}

/** The settings as the planner and the UI read them, from a stored row (older rows have no goal type or session minutes). */
export function settingsFromRow(r: { examDate: string | null; examLabel: string | null; weeklyMinutes: number; daysPerWeek: number; goal: string | null; priorities: readonly string[]; goalType?: GoalType | null; sessionMinutes?: number | null }): ScholarPlanSettings {
  return {
    goalType: r.goalType ?? null, sessionMinutes: r.sessionMinutes ?? null, daysPerWeek: r.daysPerWeek, weeklyMinutes: r.weeklyMinutes,
    examDate: r.examDate, examLabel: r.examLabel, goal: r.goal, priorities: [...r.priorities],
  };
}

// ── THE STARTING PLAN ── My Plan correction (CE-03) ──────────────────────────────────────────────────────────────────
// With no saved settings My Plan is still useful from the first visit: it works from this implicit starting plan (learn consistently, 30 minutes a
// session, 5 days a week). It is NEVER written. Saving the three-question setup replaces it, and nothing is stored until the learner does.
export const STARTING_PLAN: ScholarPlanSettings = Object.freeze({
  goalType: "learn", sessionMinutes: 30, daysPerWeek: 5, weeklyMinutes: 150, examDate: null, examLabel: null, goal: null, priorities: Object.freeze([] as string[]) as readonly string[],
}) as ScholarPlanSettings;
/** Pure. The settings the planner runs on: the saved ones, else the starting plan (`starting: true`). */
export function effectiveSettings(saved: ScholarPlanSettings | null): { settings: ScholarPlanSettings; starting: boolean } {
  return saved ? { settings: saved, starting: false } : { settings: STARTING_PLAN, starting: true };
}

/** What one session lasts: the stated minutes, else the weekly total over the days. */
export const sessionMinutesOf = (s: Pick<ScholarPlanSettings, "sessionMinutes" | "weeklyMinutes" | "daysPerWeek">) =>
  s.sessionMinutes ?? Math.max(1, Math.round(s.weeklyMinutes / Math.max(1, s.daysPerWeek)));

export type IncreaseCheck = { needsConfirmation: false } | { needsConfirmation: true; message: string; from: number; to: number; max: number };
/**
 * Pure. Whether a save needs the learner's confirmation of a workload increase: the new weekly minutes are above
 * the configured maximum AND above what the plan had (a plan already above it, saved earlier, is not asked again).
 */
export function increaseNeedsConfirmation(current: Pick<ScholarPlanSettings, "weeklyMinutes"> | null, next: { weeklyMinutes: number }, maxWeeklyMinutes: number): IncreaseCheck {
  const from = current?.weeklyMinutes ?? 0;
  if (next.weeklyMinutes > maxWeeklyMinutes && next.weeklyMinutes > from)
    return { needsConfirmation: true, from, to: next.weeklyMinutes, max: maxWeeklyMinutes,
      message: `${next.weeklyMinutes} minutes a week is more than ${maxWeeklyMinutes}, the most Scholar plans without asking you. Confirm to raise your study time${from ? ` from ${from} minutes` : ""}.` };
  return { needsConfirmation: false };
}

/** Pure. The plain-words difference between two saved settings, for the settings-change record. Values only, no free text beyond what the learner set. */
export function settingsDiff(before: ScholarPlanSettings | null, after: CleanPlanSettings): { before: Record<string, unknown> | null; after: Record<string, unknown>; changed: string[] } {
  const pick = (s: { goalType: GoalType | null; sessionMinutes: number | null; daysPerWeek: number; weeklyMinutes: number; examDate: string | null; priorities: readonly string[] }) =>
    ({ goalType: s.goalType, sessionMinutes: s.sessionMinutes, daysPerWeek: s.daysPerWeek, weeklyMinutes: s.weeklyMinutes, examDate: s.examDate, priorities: s.priorities.length });
  const a = pick(after), bef = before ? pick(before) : null;
  const changed = (Object.keys(a) as (keyof typeof a)[]).filter(k => !bef || bef[k] !== a[k]);
  return { before: bef, after: a, changed };
}
