/* eslint-disable @typescript-eslint/no-explicit-any */
import { attachRecordToActivity, linkCpdToGoal, type PlanWorkspace } from "./plan-store";

// ── WHAT HAPPENED, AND THE GOALS IT SERVED ── LCPD-01 with PLAN-01 (migration 480), the Stage 3/4 contract ──────────
//
// A CPD entry (373) or a Competen Learning record (462) is the record of what happened. Stage 3's development activity
// REFERENCES it, and a goal is served through that activity. Stage 4 NEVER writes 480's tables: it links through
// Stage 3's own writers in plan-store (attachRecordToActivity, linkCpdToGoal) and reads through its reader
// (loadPlanWorkspace), once per page, rather than three queries per record.
//
// ⚠ BEFORE 480, AS BEFORE. Without 480 the CPD entry's own 373 goal_id is the link, written by the CPD route exactly as
// it always was. With 480 that column is no longer written (an entry's earlier goal_id is kept and still shown), so a
// goal link has one home.

/** Server gate: migration 480 is on this environment. A zero-row read of its activity table (never HEAD). */
export async function planReady(admin: any): Promise<boolean> {
  try { const { error } = await admin.from("individual_professional_activity").select("id").limit(0); return !error; } catch { return false; }
}

export type RecordGoal = { goalId: string; title: string };

/**
 * Pure: per record, the goals it serves through the activity that references it. Keyed like the reflections on learning
 * (learning-reflections subjectKey): "cpd:<id>" and "rec:<learning record id>".
 */
export function goalsByRecord(ws: Pick<PlanWorkspace, "goals" | "activities" | "activityGoals">): Map<string, RecordGoal[]> {
  const title = new Map((ws.goals ?? []).map(g => [g.id, g.title]));
  const goalsOf = new Map<string, string[]>();
  for (const l of ws.activityGoals ?? []) goalsOf.set(l.activity_id, [...(goalsOf.get(l.activity_id) ?? []), l.goal_id]);
  const out = new Map<string, RecordGoal[]>();
  for (const a of ws.activities ?? []) {
    const key = a.cpd_id ? `cpd:${a.cpd_id}` : a.learning_record_id ? `rec:${a.learning_record_id}` : null;
    if (!key) continue;
    const goals = (goalsOf.get(a.id) ?? []).filter(id => title.has(id)).map(id => ({ goalId: id, title: title.get(id)! }));
    if (goals.length) out.set(key, goals);
  }
  return out;
}

/** Pure: planned work a new CPD entry can complete -- open activities that reference no record yet. */
export const openActivities = (ws: Pick<PlanWorkspace, "activities">) =>
  (ws.activities ?? []).filter(a => (a.status === "planned" || a.status === "active") && !a.cpd_id && !a.learning_record_id).map(a => ({ id: a.id, title: a.title }));

/**
 * After a CPD entry is saved, with 480 present: the planned activity it completes, then the goal it served, both through
 * Stage 3's writers. The entry is already the record, so a link that fails is reported and never undoes it.
 * null = linked as asked (or nothing asked).
 */
export async function linkSavedCpd(admin: any, userId: string, cpdId: string, ask: { goalId: string | null; activityId: string | null }): Promise<string | null> {
  if (ask.activityId) {
    const a = await attachRecordToActivity(admin, userId, ask.activityId, { cpdId });
    if (!a.ok) return `It is saved, but it could not be marked as your planned activity: ${a.error}`;
  }
  if (ask.goalId) {
    const g = await linkCpdToGoal(admin, userId, ask.goalId, { cpdId });
    if (!g.ok) return `It is saved, but it could not be linked to your goal: ${g.error}`;
  }
  return null;
}
