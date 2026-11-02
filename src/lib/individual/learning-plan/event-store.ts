/* eslint-disable @typescript-eslint/no-explicit-any */
import { isNotProvisioned } from "../access";
import { PLAN_EVENT_LIMITS, isPlanEventKind, isPlanEventStatus, type NewPlanEvent, type PlanEvent, type PlanEventKind, type PlanExperience } from "./types";

// ── THE PLAN EVENT LOG: THE STORE ── PLP-01..04, migration 840 ────────────────────────────────────────────────────
//
// The ONE writer of individual_learning_plan_event (append-only: the table refuses UPDATE and DELETE). Shared by the Individual
// experiences, so it lives beside the shared contract and the foundation harness (2a) names this file as its only writer.
// EVERY STATEMENT IS KEYED ON THE CALLER'S OWN user_id (the guard's context, never a request body) AND on the experience asked
// for: a Scholar route reads and writes experience "scholar" only.
//
// FAIL CLOSED. Without 840 the detector says no, writes answer "not_provisioned", reads say so, and the plan runs without
// decisions, reflections, proposal memory, goal type and session minutes.

export type PlanRead<T> = { ok: true; data: T } | { ok: false; notProvisioned: boolean };
const failure = (error: unknown): { ok: false; notProvisioned: boolean } => ({ ok: false, notProvisioned: isNotProvisioned(error) });

let schema840: boolean | null = null;
/**
 * Whether migration 840 is applied here: the event table AND the two study plan columns. A transient read error is "no" for now,
 * and asked again. Keyed on the caller when a user id is given.
 */
export async function learningPlanSchema(admin: any, userId?: string): Promise<boolean> {
  if (schema840 !== null) return schema840;
  try {
    let t = admin.from("individual_learning_plan_event").select("id");
    let c = admin.from("individual_scholar_study_plan").select("goal_type, session_minutes");
    if (userId) { t = t.eq("user_id", userId); c = c.eq("user_id", userId); }
    const [te, ce] = [await t.limit(1), await c.limit(1)];
    if (!te.error && !ce.error) return (schema840 = true);
    if (isNotProvisioned(te.error) || isNotProvisioned(ce.error)) schema840 = false;
    return false;
  } catch { return false; }
}
/** Tests only: forget what was detected. */
export const resetLearningPlanSchema = (value: boolean | null = null) => { schema840 = value; };

const EVENT_COLS = "id, experience, kind, ref, status, value, created_at";
const toEvent = (r: any): PlanEvent => ({
  id: r.id, experience: r.experience, kind: r.kind, ref: r.ref, status: r.status ?? null,
  value: r.value && typeof r.value === "object" && !Array.isArray(r.value) ? r.value : {}, createdAt: r.created_at,
});

/** Append one event for the caller. The table's CHECKs hold the same limits. */
export async function appendPlanEvent(admin: any, userId: string, experience: PlanExperience, e: NewPlanEvent): Promise<"ok" | "not_provisioned" | "failed"> {
  if (schema840 === false) return "not_provisioned";
  const value = e.value ?? {};
  if (!isPlanEventKind(e.kind) || (e.status != null && !isPlanEventStatus(e.status)) || !e.ref || e.ref.length > PLAN_EVENT_LIMITS.refMax) return "failed";
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > PLAN_EVENT_LIMITS.valueBytes) return "failed";
  try {
    const { error } = await admin.from("individual_learning_plan_event").insert({ user_id: userId, experience, kind: e.kind, ref: e.ref, status: e.status ?? null, value });
    if (error) { if (isNotProvisioned(error)) { schema840 = false; return "not_provisioned"; } return "failed"; }
    schema840 = true;
    return "ok";
  } catch { return "failed"; }
}

/** The caller's events of these kinds for one experience, newest first (at most 2000), optionally since an instant. */
export async function listPlanEvents(admin: any, userId: string, experience: PlanExperience, kinds: readonly PlanEventKind[], sinceIso?: string | null): Promise<PlanRead<PlanEvent[]>> {
  if (schema840 === false) return { ok: false, notProvisioned: true };
  try {
    let q = admin.from("individual_learning_plan_event").select(EVENT_COLS).eq("user_id", userId).eq("experience", experience).in("kind", [...kinds]);
    if (sinceIso) q = q.gte("created_at", sinceIso);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(2000);
    if (error) { if (isNotProvisioned(error)) schema840 = false; return failure(error); }
    schema840 = true;
    return { ok: true, data: ((data ?? []) as any[]).map(toEvent) };
  } catch { return { ok: false, notProvisioned: false }; }
}
