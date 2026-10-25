/* eslint-disable @typescript-eslint/no-explicit-any */
import { isNotProvisioned } from "../access";
import type { CatalogueCompetency } from "../catalogue";
import { loadLearningRecords } from "@/lib/learning/products";
import type { ActivityColumns, GoalColumns, GoalSourceRefs, ReviewInput } from "./plan-form";
import type { GoalStatus } from "./plan-vocabulary";
import { linkGoal, versionOf } from "./needs-store";
import { ORIGIN } from "./vocabulary";

// ── THE DEVELOPMENT PLAN, READ AND WRITTEN ── COMPETEN-PROFESSIONAL-PLAN-01, migration 480 ─────────────────────────
//
// THE ONE WRITER of 480's tables and of the Stage 3 goal columns, by the person's own id. The 373 goal is still the
// goal record: this widens what is written to it. Goal and activity history are 480's TRIGGERS', never written here.
// A goal's link to a need is the 470 table, written through needs-store (its one writer), not here.
//
// ⚠ THE STAGE 3/4 CONTRACT (agreed with COMPETEN-IND-007, Stage 4 Learning & CPD, 25 Oct). The CPD entry (373, extended
// by Stage 4) and the Holdings learning record (462) are THE records of what happened. An activity here is planned or
// intended work that REFERENCES one of them. Nothing here writes a CPD entry or a learning record, and nothing here
// stores completion, hours, credits, evidence or actual dates. Stage 4 calls linkCpdToGoal, attachRecordToActivity and
// goalsForRecord, and never writes these tables itself.
//
// ⚠ NOT PROVISIONED IS NOT UNREADABLE. Before 480 is applied, `provisioned` is false and the page shows the MVP plan
// exactly as before. A failed read is null, and the page says it could not be checked.

const GOAL_COLUMNS = "id, need_id, title, detail, target_date, status, completed_at, created_at, updated_at, goal_type_code, goal_type_label, motivation, "
  + "intended_outcome, priority_code, priority_label, expected_evidence, start_date, review_date, template_code, template_label, template_answers, "
  + "created_from, source_framework_competency_id, source_learning_offering_id, aspiration_item_id, reflection_id, reviewed_at";
const ACTIVITY_COLUMNS = "id, activity_type_code, activity_type_label, title, detail, status, planned_start, planned_end, provider, external_url, "
  + "learning_offering_id, learning_record_id, cpd_id, depends_on_activity_id, created_at, updated_at";

export type PlanGoal = {
  id: string; need_id: string | null; title: string; detail: string | null; target_date: string | null; status: GoalStatus; completed_at: string | null;
  created_at: string; updated_at: string; goal_type_code: string | null; goal_type_label: string | null; motivation: string | null; intended_outcome: string | null;
  priority_code: string | null; priority_label: string | null; expected_evidence: string | null; start_date: string | null; review_date: string | null;
  template_code: string | null; template_label: string | null; template_answers: Record<string, string> | null; created_from: string;
  source_framework_competency_id: string | null; source_learning_offering_id: string | null; aspiration_item_id: string | null; reflection_id: string | null;
  reviewed_at: string | null;
};
export type GoalHistoryRow = {
  goal_id: string; title: string; detail: string | null; status: string | null; priority_label: string | null; intended_outcome: string | null;
  target_date: string | null; review_date: string | null; recorded_at: string;
};
export type PlanActivity = {
  id: string; activity_type_code: string | null; activity_type_label: string | null; title: string; detail: string | null; status: string;
  planned_start: string | null; planned_end: string | null; provider: string | null; external_url: string | null;
  learning_offering_id: string | null; learning_record_id: string | null; cpd_id: string | null; depends_on_activity_id: string | null;
  created_at: string; updated_at: string;
};
export type ActivityGoalLink = { activity_id: string; goal_id: string; position: number };
export type Milestone = { id: string; goal_id: string; title: string; milestone_type_label: string | null; due_on: string | null; achieved_on: string | null; position: number };
export type PlanCompetencyLink = {
  id: string; goal_id: string | null; activity_id: string | null; framework_id: string; framework_competency_id: string; framework_version: string | null;
  learning_outcome: string | null; linked_at: string; unlinked_at: string | null;
};
export type GoalEvidenceLink = { id: string; goal_id: string; evidence_id: string | null; reflection_id: string | null; linked_at: string; unlinked_at: string | null };
export type GoalReview = {
  id: string; goal_id: string; undertaken: string | null; learned: string | null; evidence_note: string | null; changed: string | null; next_steps: string | null;
  decision: string; status_before: string | null; reviewed_at: string;
};

export type PlanWorkspace = {
  provisioned: boolean;
  goals: PlanGoal[] | null; history: GoalHistoryRow[] | null; activities: PlanActivity[] | null; activityGoals: ActivityGoalLink[] | null;
  milestones: Milestone[] | null; competencies: PlanCompetencyLink[] | null; evidence: GoalEvidenceLink[] | null; reviews: GoalReview[] | null;
};

export async function loadPlanWorkspace(admin: any, userId: string): Promise<PlanWorkspace> {
  let provisioned = true;
  const settle = async (p: PromiseLike<any>): Promise<any[] | null> => {
    try {
      const r = await p;
      if (r?.error && isNotProvisioned(r.error)) { provisioned = false; return []; }
      return r?.error ? null : (r?.data ?? []);
    } catch { return null; }
  };
  const [goals, history, activities, activityGoals, milestones, competencies, evidence, reviews] = await Promise.all([
    settle(admin.from("individual_professional_goal").select(GOAL_COLUMNS).eq("user_id", userId).order("created_at", { ascending: false }).limit(500)),
    settle(admin.from("individual_professional_goal_history").select("goal_id, title, detail, status, priority_label, intended_outcome, target_date, review_date, recorded_at")
      .eq("user_id", userId).order("recorded_at", { ascending: false }).limit(3000)),
    settle(admin.from("individual_professional_activity").select(ACTIVITY_COLUMNS).eq("user_id", userId).order("created_at", { ascending: true }).limit(1000)),
    settle(admin.from("individual_professional_activity_goal").select("activity_id, goal_id, position").eq("user_id", userId).order("position").limit(3000)),
    settle(admin.from("individual_professional_milestone").select("id, goal_id, title, milestone_type_label, due_on, achieved_on, position").eq("user_id", userId).order("position").limit(2000)),
    settle(admin.from("individual_professional_plan_competency").select("id, goal_id, activity_id, framework_id, framework_competency_id, framework_version, learning_outcome, linked_at, unlinked_at")
      .eq("user_id", userId).order("linked_at").limit(3000)),
    settle(admin.from("individual_professional_goal_evidence").select("id, goal_id, evidence_id, reflection_id, linked_at, unlinked_at").eq("user_id", userId).order("linked_at").limit(3000)),
    settle(admin.from("individual_professional_goal_review").select("id, goal_id, undertaken, learned, evidence_note, changed, next_steps, decision, status_before, reviewed_at")
      .eq("user_id", userId).order("reviewed_at", { ascending: false }).limit(2000)),
  ]);
  if (!provisioned) return { provisioned, goals: [], history: [], activities: [], activityGoals: [], milestones: [], competencies: [], evidence: [], reviews: [] };
  return { provisioned, goals, history, activities, activityGoals, milestones, competencies, evidence, reviews };
}

export type Write = { ok: true; id: string | null } | { ok: false; status: number; error: string };
const failed = (what: string, error?: any): Write => isNotProvisioned(error)
  ? { ok: false, status: 409, error: "Development planning is not set up on this environment yet." }
  : String(error?.code) === "23503" ? { ok: false, status: 404, error: "That is not on your record." }
  : { ok: false, status: 500, error: `Your ${what} could not be saved just now. Try again shortly.` };
const notMine = (what: string): Write => ({ ok: false, status: 404, error: `That ${what} is not on your record.` });

// ── GOALS (P1, P4) ───────────────────────────────────────────────────────────────────────────────────────────

/** A new goal. Only the title is required. A need it came from is linked through the 470 join (many to many). */
export async function createGoal(admin: any, userId: string, cols: Partial<GoalColumns>, src: GoalSourceRefs): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_goal").insert({
    ...cols, user_id: userId, experience_code: ORIGIN, status: "planned", created_from: src.createdFrom,
    source_framework_competency_id: src.competencyId, source_learning_offering_id: src.offeringId,
    aspiration_item_id: src.aspirationItemId, reflection_id: src.reflectionId,
  }).select("id").single();
  if (error || !data) return failed("goal", error);
  if (src.needId) {
    const linked = await linkGoal(admin, userId, data.id, src.needId);
    if (!linked.ok) return { ok: false, status: linked.status, error: `The goal was saved, but not linked to the need: ${linked.error}` };
  }
  return { ok: true, id: data.id };
}

/** Revise a goal. The 480 trigger keeps the earlier version as history: nothing is silently overwritten. */
export async function updateGoal(admin: any, userId: string, id: string, patch: Partial<GoalColumns> & { reviewed?: boolean }): Promise<Write> {
  const { reviewed, ...cols } = patch;
  const now = new Date().toISOString();
  const { data, error } = await admin.from("individual_professional_goal")
    .update({ ...cols, ...(reviewed ? { reviewed_at: now } : {}), updated_at: now }).eq("id", id).eq("user_id", userId).select("id").maybeSingle();
  if (error) return failed("goal", error);
  return data ? { ok: true, id } : notMine("goal");
}

/** A status change. Done is the person's judgement that it is addressed (373 requires when), never verification. */
export async function setGoalStatus(admin: any, userId: string, id: string, status: GoalStatus): Promise<Write> {
  const now = new Date().toISOString();
  const { data, error } = await admin.from("individual_professional_goal")
    .update({ status, completed_at: status === "done" ? now : null, reviewed_at: now, updated_at: now }).eq("id", id).eq("user_id", userId).select("id").maybeSingle();
  if (error) return failed("goal", error);
  return data ? { ok: true, id } : notMine("goal");
}

// ── ACTIVITIES (P2) ──────────────────────────────────────────────────────────────────────────────────────────

/** A planned activity, optionally under a goal. No plan is needed first, and none is needed to record learning. */
export async function createActivity(admin: any, userId: string, cols: Partial<ActivityColumns>, goalId: string | null): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_activity").insert({ ...cols, user_id: userId, experience_code: ORIGIN }).select("id").single();
  if (error || !data) return failed("activity", error);
  if (goalId) {
    const linked = await linkActivityGoal(admin, userId, data.id, goalId);
    if (!linked.ok) return { ok: false, status: linked.status, error: `The activity was saved, but not added to the goal: ${linked.error}` };
  }
  return { ok: true, id: data.id };
}

export async function updateActivity(admin: any, userId: string, id: string, patch: Partial<ActivityColumns>): Promise<Write> {
  if (patch.depends_on_activity_id === id) return { ok: false, status: 400, error: "An activity cannot depend on itself." };
  const { data, error } = await admin.from("individual_professional_activity").update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", userId).select("id").maybeSingle();
  if (error) return String(error.code) === "23514" ? { ok: false, status: 400, error: "That change is not possible for this activity." } : failed("activity", error);
  return data ? { ok: true, id } : notMine("activity");
}

/** Remove an activity from the plan. The CPD entry or learning record it pointed at is untouched. */
export async function deleteActivity(admin: any, userId: string, id: string): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_activity").delete().eq("id", id).eq("user_id", userId).select("id").maybeSingle();
  if (error) return failed("change", error);
  return data ? { ok: true, id } : notMine("activity");
}

/** Put an activity under a goal (many to many, ordered). Linking it again is a no-op. */
export async function linkActivityGoal(admin: any, userId: string, activityId: string, goalId: string, position?: number): Promise<Write> {
  let pos = position;
  if (pos === undefined) {
    const { data: last } = await admin.from("individual_professional_activity_goal").select("position").eq("goal_id", goalId).eq("user_id", userId).order("position", { ascending: false }).limit(1);
    pos = Math.min(10000, ((last ?? [])[0]?.position ?? 0) + 1);
  }
  const { error } = await admin.from("individual_professional_activity_goal").insert({ activity_id: activityId, goal_id: goalId, user_id: userId, position: pos });
  if (error && String(error.code) === "23505") return { ok: true, id: null };
  return error ? failed("link", error) : { ok: true, id: null };
}
export async function unlinkActivityGoal(admin: any, userId: string, activityId: string, goalId: string): Promise<Write> {
  const { error } = await admin.from("individual_professional_activity_goal").delete().eq("activity_id", activityId).eq("goal_id", goalId).eq("user_id", userId);
  return error ? failed("change", error) : { ok: true, id: null };
}
/** Move an activity up or down within one goal: swaps its position with its neighbour. */
export async function moveActivity(admin: any, userId: string, goalId: string, activityId: string, dir: "up" | "down"): Promise<Write> {
  const { data } = await admin.from("individual_professional_activity_goal").select("activity_id, position").eq("goal_id", goalId).eq("user_id", userId).order("position");
  const rows: { activity_id: string; position: number }[] = data ?? [];
  const i = rows.findIndex(r => r.activity_id === activityId), j = dir === "up" ? i - 1 : i + 1;
  if (i < 0) return notMine("activity");
  if (j < 0 || j >= rows.length) return { ok: true, id: null };
  const [a, b] = [rows[i], rows[j]];
  const pa = a.position === b.position ? (dir === "up" ? b.position - 1 : b.position + 1) : b.position;
  for (const [id, p] of [[a.activity_id, Math.max(0, pa)], [b.activity_id, a.position]] as const) {
    const { error } = await admin.from("individual_professional_activity_goal").update({ position: p }).eq("activity_id", id).eq("goal_id", goalId).eq("user_id", userId);
    if (error) return failed("order", error);
  }
  return { ok: true, id: null };
}

// ── THE STAGE 3/4 CONTRACT: REFERENCES TO WHAT HAPPENED ───────────────────────────────────────────────────────

export type RecordRef = { cpdId: string } | { learningRecordId: string };
const refColumn = (ref: RecordRef) => ("cpdId" in ref ? { col: "cpd_id", id: ref.cpdId } : { col: "learning_record_id", id: ref.learningRecordId });

/** The title of the person's own record: a label for the activity, nothing more is copied. null = not theirs. */
async function recordTitle(admin: any, userId: string, ref: RecordRef): Promise<string | null> {
  if ("cpdId" in ref) {
    const { data } = await admin.from("individual_professional_cpd").select("title").eq("id", ref.cpdId).eq("user_id", userId).maybeSingle();
    return data?.title ?? null;
  }
  return (await loadLearningRecords(admin, userId))?.find(r => r.recordId === ref.learningRecordId)?.title ?? null;
}

/**
 * Stage 4 export. A planned activity HAPPENED: point it at the person's own CPD entry or learning record and mark it
 * completed (480 allows completed only with such a reference). One record backs at most one activity.
 */
export async function attachRecordToActivity(admin: any, userId: string, activityId: string, ref: RecordRef): Promise<Write> {
  const { col, id } = refColumn(ref);
  const { data, error } = await admin.from("individual_professional_activity").update({ [col]: id, status: "completed", updated_at: new Date().toISOString() })
    .eq("id", activityId).eq("user_id", userId).select("id").maybeSingle();
  if (error) {
    if (String(error.code) === "23505") return { ok: false, status: 409, error: "That record already belongs to another activity in your plan." };
    return failed("activity", error);
  }
  return data ? { ok: true, id: activityId } : notMine("activity");
}

/** The record is no longer this activity's. 480's trigger returns a completed activity to planned. */
export async function detachRecordFromActivity(admin: any, userId: string, activityId: string, which: "cpd" | "learning"): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_activity").update({ [which === "cpd" ? "cpd_id" : "learning_record_id"]: null, updated_at: new Date().toISOString() })
    .eq("id", activityId).eq("user_id", userId).select("id").maybeSingle();
  if (error) return failed("activity", error);
  return data ? { ok: true, id: activityId } : notMine("activity");
}

/**
 * Stage 4 export. Retrospective linking: "this CPD entry or learning I already have served this goal". Reuses the
 * activity that already points at the record, or creates one (completed, titled from the record), then links the goal.
 * Calling it again is a no-op.
 */
export async function linkCpdToGoal(admin: any, userId: string, goalId: string, ref: RecordRef): Promise<{ ok: true; activityId: string } | { ok: false; status: number; error: string }> {
  const { col, id } = refColumn(ref);
  const { data: existing, error: readErr } = await admin.from("individual_professional_activity").select("id").eq(col, id).eq("user_id", userId).maybeSingle();
  if (readErr) { const f = failed("link", readErr) as Extract<Write, { ok: false }>; return f; }
  let activityId: string | null = existing?.id ?? null;
  if (!activityId) {
    const title = await recordTitle(admin, userId, ref);
    if (!title) return { ok: false, status: 404, error: "That record is not on your record." };
    const label = title.length < 3 ? `${title} (record)` : title.slice(0, 200);
    const { data, error } = await admin.from("individual_professional_activity").insert({ user_id: userId, experience_code: ORIGIN, title: label, status: "completed", [col]: id }).select("id").single();
    if (error || !data) {
      if (String(error?.code) === "23505") return linkCpdToGoal(admin, userId, goalId, ref);
      const f = failed("link", error) as Extract<Write, { ok: false }>; return f;
    }
    activityId = data.id;
  }
  const linked = await linkActivityGoal(admin, userId, activityId!, goalId);
  return linked.ok ? { ok: true, activityId: activityId! } : linked;
}

/** Stage 4 export, read-only: the goals a record supports, through its activity. [] when none, null when unreadable. */
export async function goalsForRecord(admin: any, userId: string, ref: RecordRef): Promise<{ goalId: string; title: string }[] | null> {
  const { col, id } = refColumn(ref);
  try {
    const { data: a, error } = await admin.from("individual_professional_activity").select("id").eq(col, id).eq("user_id", userId).maybeSingle();
    if (error) return isNotProvisioned(error) ? [] : null;
    if (!a) return [];
    const { data: links } = await admin.from("individual_professional_activity_goal").select("goal_id").eq("activity_id", a.id).eq("user_id", userId);
    const ids = (links ?? []).map((l: any) => l.goal_id);
    if (!ids.length) return [];
    const { data: goals } = await admin.from("individual_professional_goal").select("id, title").in("id", ids).eq("user_id", userId);
    return (goals ?? []).map((g: any) => ({ goalId: g.id, title: g.title }));
  } catch { return null; }
}

// ── MILESTONES (P4) ──────────────────────────────────────────────────────────────────────────────────────────

export async function addMilestone(admin: any, userId: string, goalId: string, v: { title: string; milestone_type_code: string | null; milestone_type_label: string | null; due_on: string | null }): Promise<Write> {
  const { data: last } = await admin.from("individual_professional_milestone").select("position").eq("goal_id", goalId).eq("user_id", userId).order("position", { ascending: false }).limit(1);
  const { data, error } = await admin.from("individual_professional_milestone")
    .insert({ ...v, goal_id: goalId, user_id: userId, position: Math.min(10000, ((last ?? [])[0]?.position ?? 0) + 1) }).select("id").single();
  return error || !data ? failed("milestone", error) : { ok: true, id: data.id };
}
export async function setMilestoneAchieved(admin: any, userId: string, id: string, on: string | null): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_milestone").update({ achieved_on: on }).eq("id", id).eq("user_id", userId).select("id").maybeSingle();
  if (error) return failed("milestone", error);
  return data ? { ok: true, id } : notMine("milestone");
}
export async function deleteMilestone(admin: any, userId: string, id: string): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_milestone").delete().eq("id", id).eq("user_id", userId).select("id").maybeSingle();
  if (error) return failed("change", error);
  return data ? { ok: true, id } : notMine("milestone");
}

// ── COMPETENCY AND EVIDENCE LINKS (P3, P5) ─────────────────────────────────────────────────────────────────────

/** Link a goal or an activity to an OFFERED competency, keeping the framework version. Anything not offered is refused. */
export async function linkPlanCompetency(admin: any, userId: string, subject: { goalId: string } | { activityId: string }, competencyId: string,
  offered: readonly CatalogueCompetency[], outcome: string | null): Promise<Write> {
  const c = offered.find(x => x.competencyId === competencyId);
  if (!c) return { ok: false, status: 400, error: "That competency is not one Competen Professional offers." };
  if (outcome && !c.outcomes.includes(outcome)) return { ok: false, status: 400, error: "Choose a learning outcome of that competency." };
  const [col, sid] = "goalId" in subject ? ["goal_id", subject.goalId] : ["activity_id", subject.activityId];
  const { data: open } = await admin.from("individual_professional_plan_competency").select("id").eq(col, sid).eq("user_id", userId)
    .eq("framework_competency_id", competencyId).is("unlinked_at", null).limit(1);
  if ((open ?? []).length) return { ok: false, status: 409, error: "That competency is already linked." };
  const { data, error } = await admin.from("individual_professional_plan_competency").insert({
    [col]: sid, user_id: userId, framework_id: c.catalogue.id, framework_competency_id: competencyId, framework_version: versionOf(c), learning_outcome: outcome,
  }).select("id").single();
  return error || !data ? failed("link", error) : { ok: true, id: data.id };
}
/** Unlink: kept as history (480 allows setting unlinked_at once, nothing else). */
export async function unlinkPlanCompetency(admin: any, userId: string, linkId: string): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_plan_competency").update({ unlinked_at: new Date().toISOString() })
    .eq("id", linkId).eq("user_id", userId).is("unlinked_at", null).select("id").maybeSingle();
  if (error) return failed("change", error);
  return data ? { ok: true, id: linkId } : { ok: false, status: 404, error: "That link is not current." };
}

/** Reference an evidence item or a private reflection as evidence towards a goal. The source's class is shown as it is. */
export async function linkGoalEvidence(admin: any, userId: string, goalId: string, ref: { evidenceId: string } | { reflectionId: string }): Promise<Write> {
  const [col, id] = "evidenceId" in ref ? ["evidence_id", ref.evidenceId] : ["reflection_id", ref.reflectionId];
  const { data: open } = await admin.from("individual_professional_goal_evidence").select("id").eq("goal_id", goalId).eq("user_id", userId).eq(col, id).is("unlinked_at", null).limit(1);
  if ((open ?? []).length) return { ok: false, status: 409, error: "That is already linked to this goal." };
  const { data, error } = await admin.from("individual_professional_goal_evidence").insert({ goal_id: goalId, user_id: userId, [col]: id }).select("id").single();
  return error || !data ? failed("link", error) : { ok: true, id: data.id };
}
export async function unlinkGoalEvidence(admin: any, userId: string, linkId: string): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_goal_evidence").update({ unlinked_at: new Date().toISOString() })
    .eq("id", linkId).eq("user_id", userId).is("unlinked_at", null).select("id").maybeSingle();
  if (error) return failed("change", error);
  return data ? { ok: true, id: linkId } : { ok: false, status: 404, error: "That link is not current." };
}

// ── REVIEWS (P6) ─────────────────────────────────────────────────────────────────────────────────────────────

/** A private, append-only review, then the decision it records: a status, a priority, or nothing more. */
export async function addReview(admin: any, userId: string, goal: { id: string; status: string }, r: ReviewInput): Promise<Write> {
  const { data, error } = await admin.from("individual_professional_goal_review")
    .insert({ ...r.columns, goal_id: goal.id, user_id: userId, decision: r.decision, status_before: goal.status }).select("id").single();
  if (error || !data) return failed("review", error);
  if (r.status) {
    const s = await setGoalStatus(admin, userId, goal.id, r.status);
    if (!s.ok) return s;
  } else {
    const u = await updateGoal(admin, userId, goal.id, { ...(r.priority ? { priority_code: r.priority[0], priority_label: r.priority[1] } : {}), reviewed: true });
    if (!u.ok) return u;
  }
  return { ok: true, id: data.id };
}
