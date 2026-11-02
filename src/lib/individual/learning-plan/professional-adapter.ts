import { experienceHref } from "@/lib/individual/experiences";
import { ACTIVITY_STATUS_TEXT, GOAL_STATUS_TEXT, goalOpen, isActivityStatus, isGoalStatus } from "@/lib/individual/professional/plan-vocabulary";
import type { PlanActivity, PlanGoal } from "@/lib/individual/professional/plan-store";
import type { PlanItem } from "./types";

// ── THE PROFESSIONAL ADAPTER ── PLP-01..04 "Professional ready" ───────────────────────────────────────────────────
//
// Pure. Maps the existing Professional development plan (migration 480: goals and planned activities) to the shared
// PlanItem. NOT SURFACED IN ANY UI, and Scholar code never imports this file. It reads nothing itself: the read is
// loadProfessionalPlanItems in professional/plan-store.ts (the Professional store), which hands the rows here.
//
// ⚠ A Professional plan item states what the PERSON planned. It adds no recommendation, no scoring and no claim of completion:
//   completion is recorded elsewhere (a CPD entry or a learning record), and nothing here infers it.
// ⚠ Items are for the person only. An employer reads none of this, and a Scholar view never reads Professional items (or the
//   other way round) without the learner's own permission.

const PLAN_HREF = experienceHref("professional", "plan");
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

/** Pure. A planned activity that is still open, as a plan item. Completed, cancelled or unknown-status activities are not items. */
export function activityToPlanItem(a: PlanActivity, today: string): PlanItem | null {
  if (!isActivityStatus(a.status) || a.status === "completed" || a.status === "cancelled") return null;
  const due = day(a.planned_end) ?? day(a.planned_start);
  const late = due !== null && due < today;
  return {
    experience: "professional", source: "professional_activity", ref: `activity:${a.id}`, title: a.title, minutes: null, due,
    why: a.detail?.trim() ? `You planned this: ${a.detail.trim().slice(0, 200)}` : "You planned this activity in your development plan.",
    whyNow: due === null ? `It is ${ACTIVITY_STATUS_TEXT[a.status].toLowerCase()} and has no date.` : late ? `It was planned for ${due}.` : `It is planned for ${due}.`,
    ifPostponed: "It stays in your plan. Change its dates when you are ready.", href: PLAN_HREF,
  };
}

/** Pure. A goal that is still open and has a target date, as a plan item. */
export function goalToPlanItem(g: PlanGoal, today: string): PlanItem | null {
  if (!isGoalStatus(g.status) || !goalOpen(g.status) || !g.target_date) return null;
  const due = day(g.target_date)!;
  return {
    experience: "professional", source: "professional_goal", ref: `goal:${g.id}`, title: g.title, minutes: null, due,
    why: g.intended_outcome?.trim() ? `Your intended outcome: ${g.intended_outcome.trim().slice(0, 200)}` : "This is one of your development goals.",
    whyNow: due < today ? `Its target date was ${due}.` : `Its target date is ${due}.`,
    ifPostponed: `It stays ${GOAL_STATUS_TEXT[g.status].toLowerCase()} until you change it or review it.`, href: PLAN_HREF,
  };
}

/** Pure. Open activities and dated open goals as plan items, soonest first, undated last. */
export function professionalPlanItems(rows: { goals: readonly PlanGoal[]; activities: readonly PlanActivity[] }, today: string): PlanItem[] {
  const items = [...rows.activities.map(a => activityToPlanItem(a, today)), ...rows.goals.map(g => goalToPlanItem(g, today))].filter((x): x is PlanItem => x !== null);
  return items.sort((a, b) => (a.due ?? "9999-12-31").localeCompare(b.due ?? "9999-12-31") || a.title.localeCompare(b.title) || a.ref.localeCompare(b.ref));
}
