// Competency Evidence Generator (HWW-TSK-001 / HWW-001 scope: "competency
// evidence generation") — the bridge nobody else has: bedside operational work
// becoming ASSESSABLE evidence automatically. A completed procedural task or an
// administered medication writes a PENDING skill_log_entries row for the
// performing nurse — the same store the logbook/verification pipeline already
// consumes, so verifiers see auto-generated entries exactly like manual ones.
//
// Honesty rules: only clearly-procedural work bridges (no noise from "restock
// supplies"); entries are ALWAYS status 'pending' (a human verifier confirms —
// automation never self-verifies); a marker in notes makes each source event
// idempotent (re-completions never duplicate). Fail-soft: evidence generation
// never breaks the originating operational request.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const EVIDENCE_TASK_TYPES = ["procedure", "clinical_procedure", "ward_round_action"];

const marker = (kind: string, id: string) => `[auto:${kind}:${id}]`;

async function alreadyBridged(admin: any, kind: string, id: string): Promise<boolean> {
  const { data } = await admin.from("skill_log_entries").select("id").ilike("notes", `%${marker(kind, id)}%`).limit(1).maybeSingle();
  return !!data;
}

async function unitName(admin: any, unitId: string | null | undefined): Promise<string | null> {
  if (!unitId) return null;
  const { data } = await admin.from("units").select("name").eq("id", unitId).maybeSingle();
  return data?.name ?? null;
}

export type BridgeResult = { created: boolean; id?: string; reason?: string };

// A completed op_task with a procedural task_type and a patient context.
export async function evidenceFromTask(admin: any, task: any): Promise<BridgeResult> {
  try {
    if (!task?.assigned_to || !task?.patient_id) return { created: false, reason: "no performer/patient" };
    if (!EVIDENCE_TASK_TYPES.includes(task.task_type)) return { created: false, reason: "not a procedural task type" };
    if (await alreadyBridged(admin, "op_task", task.id)) return { created: false, reason: "already bridged" };

    const loc = await unitName(admin, task.unit_id);
    const { data, error } = await admin.from("skill_log_entries").insert({
      nurse_id: task.assigned_to,
      skill_name: String(task.description ?? task.task_type).slice(0, 200),
      performed_at: (task.completed_at ?? new Date().toISOString()).slice(0, 10),
      location: loc,
      supervision_level: "independent",
      status: "pending",
      notes: `Auto-generated from a completed operational task (${String(task.task_type).replace(/_/g, " ")}). Verify against the operational record. ${marker("op_task", task.id)}`,
    }).select("id").single();
    if (error) return { created: false, reason: error.message };
    return { created: true, id: data.id };
  } catch (e: any) {
    return { created: false, reason: String(e?.message ?? e) };
  }
}

// An ADMINISTERED medication event (op_med_administrations) — witnessed
// double-checks record as 'supervised', otherwise 'independent'.
export async function evidenceFromMedication(admin: any, event: any, sched: any): Promise<BridgeResult> {
  try {
    if (event?.outcome !== "administered" || !event?.administered_by) return { created: false, reason: "not an administration" };
    if (await alreadyBridged(admin, "op_med_admin", event.id)) return { created: false, reason: "already bridged" };

    const loc = await unitName(admin, sched?.unit_id);
    const { data, error } = await admin.from("skill_log_entries").insert({
      nurse_id: event.administered_by,
      skill_name: `Medication administration — ${sched?.drug_name ?? "medication"} (${String(sched?.route ?? "").toUpperCase()})`.slice(0, 200),
      performed_at: (event.administered_at ?? new Date().toISOString()).slice(0, 10),
      location: loc,
      supervision_level: event.witness_id ? "supervised" : "independent",
      status: "pending",
      notes: `Auto-generated from a recorded administration event${event.witness_id ? ` (double-checked by ${event.witness_name ?? "a second clinician"})` : ""}${sched?.high_risk ? " — HIGH-RISK medication" : ""}. Five-rights checks captured on the operational record. ${marker("op_med_admin", event.id)}`,
    }).select("id").single();
    if (error) return { created: false, reason: error.message };
    return { created: true, id: data.id };
  } catch (e: any) {
    return { created: false, reason: String(e?.message ?? e) };
  }
}
