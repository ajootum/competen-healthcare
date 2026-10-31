import { findPatientIdentifiers } from "@/lib/privacy/patient-identifiers";

// ── THE STUDY PLAN FORM: VALIDATION ── SCHOLAR-COMPANION-01, migration 780 ──────────────────────────────────────
//
// Pure. What the learner types into the study plan form, checked before it is saved. The limits are the 780 table's own
// CHECKs (so a value this accepts the table accepts): 30 to 3000 minutes a week, 1 to 7 days, an exam name of up to 120
// characters, a goal of up to 300, up to 10 priority topics. The exam date is optional, must not be in the past and is
// at most three years ahead. Free text is refused when it looks like it identifies a patient (as topics and notes are).

export const STUDY_PLAN_LIMITS = { minMinutes: 30, maxMinutes: 3000, minDays: 1, maxDays: 7, labelMax: 120, goalMax: 300, priorities: 10, priorityMax: 120, maxYearsAhead: 3 } as const;

export type CleanStudyPlan = { examDate: string | null; examLabel: string | null; weeklyMinutes: number; daysPerWeek: number; goal: string | null; priorities: string[] };
export type CleanStudyPlanResult = { ok: true; value: CleanStudyPlan } | { ok: false; message: string; identifier?: boolean };

const squash = (x: unknown) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim() : "");
const wholeNumber = (x: unknown): number | null => {
  if (typeof x === "number") return Number.isInteger(x) ? x : null;
  if (typeof x === "string" && /^\d{1,5}$/.test(x.trim())) return Number(x.trim());
  return null;
};

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(x: unknown): x is string {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const d = new Date(`${x}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === x;
}

/** Pure. `today` is YYYY-MM-DD. */
export function cleanStudyPlanInput(body: unknown, today: string): CleanStudyPlanResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const L = STUDY_PLAN_LIMITS;

  const weeklyMinutes = wholeNumber(b.weeklyMinutes);
  if (weeklyMinutes === null || weeklyMinutes < L.minMinutes || weeklyMinutes > L.maxMinutes) return { ok: false, message: `Enter the minutes you can study each week, between ${L.minMinutes} and ${L.maxMinutes}.` };
  const daysPerWeek = wholeNumber(b.daysPerWeek);
  if (daysPerWeek === null || daysPerWeek < L.minDays || daysPerWeek > L.maxDays) return { ok: false, message: `Choose how many days a week you will study, from ${L.minDays} to ${L.maxDays}.` };

  let examDate: string | null = null;
  const rawDate = typeof b.examDate === "string" ? b.examDate.trim() : b.examDate;
  if (rawDate !== null && rawDate !== undefined && rawDate !== "") {
    if (!isIsoDate(rawDate)) return { ok: false, message: "Enter the exam date as a real date, or leave it empty." };
    if (rawDate < today) return { ok: false, message: "The exam date has already passed. Choose a later date, or leave it empty for a rolling weekly plan." };
    const limit = new Date(`${today}T00:00:00Z`); limit.setUTCFullYear(limit.getUTCFullYear() + L.maxYearsAhead);
    if (rawDate > limit.toISOString().slice(0, 10)) return { ok: false, message: `Choose an exam date within the next ${L.maxYearsAhead} years, or leave it empty.` };
    examDate = rawDate;
  }

  const examLabel = squash(b.examLabel);
  if (examLabel.length > L.labelMax) return { ok: false, message: `Keep the exam name to ${L.labelMax} characters.` };
  const goal = squash(b.goal);
  if (goal.length > L.goalMax) return { ok: false, message: `Keep your goal to ${L.goalMax} characters.` };

  const priorities: string[] = [];
  if (b.priorities !== undefined && b.priorities !== null && !Array.isArray(b.priorities)) return { ok: false, message: "Choose your priority topics from the list." };
  for (const raw of (b.priorities as unknown[] | undefined) ?? []) {
    const t = squash(raw);
    if (!t) continue;
    if (t.length > L.priorityMax) return { ok: false, message: `A priority topic is limited to ${L.priorityMax} characters.` };
    if (!priorities.some(p => p.toLowerCase() === t.toLowerCase())) priorities.push(t);
  }
  if (priorities.length > L.priorities) return { ok: false, message: `Choose at most ${L.priorities} priority topics.` };

  for (const text of [examLabel, goal, ...priorities]) {
    if (text && findPatientIdentifiers(text).length) return { ok: false, message: "That looks like it identifies a patient. Remove it and save again.", identifier: true };
  }
  return { ok: true, value: { examDate, examLabel: examLabel || null, weeklyMinutes, daysPerWeek, goal: goal || null, priorities } };
}
