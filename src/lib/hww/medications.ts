// Medication Coordination engine (HWW-MED-001, migration 154) — operational
// medication coordination, NOT an EMR and NOT prescribing. The engine owns:
// the derived due/overdue status windows, administration recording with
// five-rights capture + double-check witness enforcement, delay escalation
// thresholds (auto-raising REAL op_escalations), and the timeliness
// intelligence. Route, pages and harness all run this same shipped code.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const MED_ROUTES = ["oral", "iv", "im", "sc", "topical", "inhaled", "nebulised", "pr", "sl", "ng", "peg", "other"] as const;

export const FIVE_RIGHTS = [
  { key: "right_patient", label: "Right patient" },
  { key: "right_medication", label: "Right medication" },
  { key: "right_dose", label: "Right dose (as displayed)" },
  { key: "right_route", label: "Right route" },
  { key: "right_time", label: "Right time" },
] as const;

// Operational windows (documented convention): a scheduled dose becomes DUE
// 60 min before its time and OVERDUE 30 min after it. Delay escalation:
// high-risk > 60 min, any medication > 120 min → auto op_escalation.
export const DUE_WINDOW_MIN = 60;
export const OVERDUE_GRACE_MIN = 30;
export const ESCALATE_HIGH_RISK_MIN = 60;
export const ESCALATE_ANY_MIN = 120;
export const ON_TIME_MIN = 15;

const TERMINAL = ["administered", "escalated", "cancelled"];

// The stored status changes only on real actions; due/overdue are derived
// from the clock so no cron is needed (spec S5 status model).
export function effectiveStatus(row: { status: string; scheduled_at: string }, now = Date.now()): string {
  if (TERMINAL.includes(row.status) || row.status === "in_progress" || row.status === "delayed") return row.status;
  const t = new Date(row.scheduled_at).getTime();
  if (now > t + OVERDUE_GRACE_MIN * 60e3) return "overdue";
  if (now >= t - DUE_WINDOW_MIN * 60e3) return "due";
  return "scheduled";
}

export function validateScheduleEntry(b: any): string[] {
  const errs: string[] = [];
  if (!b?.patient_id) errs.push("patient_id required");
  if (!String(b?.drug_name ?? "").trim()) errs.push("drug_name required");
  if (!MED_ROUTES.includes(b?.route)) errs.push(`route must be one of: ${MED_ROUTES.join(", ")}`);
  if (!b?.scheduled_at || isNaN(new Date(b.scheduled_at).getTime())) errs.push("scheduled_at must be a valid time");
  return errs;
}

const migrationMissingErr = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));

type RecordInput = {
  scheduleId: string;
  outcome: "administered" | "delayed" | "omitted";
  reason?: string | null;
  safetyChecks?: any;
  witnessId?: string | null;
  shiftId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
};
type RecordResult =
  | { ok: true; event: any; schedule: any; escalated: boolean; escalationId: string | null; delayMinutes: number }
  | { ok: false; status: number; error: string };

export async function recordAdministration(admin: any, input: RecordInput, now = Date.now()): Promise<RecordResult> {
  if (!["administered", "delayed", "omitted"].includes(input.outcome)) return { ok: false, status: 400, error: "outcome must be administered | delayed | omitted" };
  const reason = String(input.reason ?? "").trim();
  if (["delayed", "omitted"].includes(input.outcome) && !reason) return { ok: false, status: 400, error: `A reason is required when a medication is ${input.outcome}` };

  const { data: sched, error: se } = await admin.from("op_med_schedule")
    .select("*, op_patients!patient_id(id, label, hospital_id)").eq("id", input.scheduleId).maybeSingle();
  if (se) return { ok: false, status: migrationMissingErr(se) ? 503 : 500, error: migrationMissingErr(se) ? "Apply migration 154 to enable medications." : se.message };
  if (!sched) return { ok: false, status: 404, error: "Schedule entry not found" };
  if (TERMINAL.includes(sched.status)) return { ok: false, status: 400, error: `This dose is already ${sched.status}` };

  // Configured independent double-check: a witness is mandatory to ADMINISTER.
  let witnessName: string | null = null;
  if (input.outcome === "administered" && sched.requires_double_check) {
    if (!input.witnessId) return { ok: false, status: 400, error: "This medication requires an independent double-check — select a witness" };
    if (input.witnessId === input.actorId) return { ok: false, status: 400, error: "The double-check witness must be a second clinician" };
  }
  if (input.witnessId) {
    const { data: w } = await admin.from("profiles").select("full_name").eq("id", input.witnessId).maybeSingle();
    if (!w) return { ok: false, status: 400, error: "Witness not found" };
    witnessName = w.full_name ?? null;
  }

  const delayMinutes = Math.max(0, Math.round((now - new Date(sched.scheduled_at).getTime()) / 60e3));

  // Delay escalation thresholds — a REAL op_escalation, linked on the event.
  let escalationId: string | null = null;
  const breach = input.outcome === "delayed" &&
    ((sched.high_risk && delayMinutes > ESCALATE_HIGH_RISK_MIN) || delayMinutes > ESCALATE_ANY_MIN);
  if (breach) {
    const level = sched.high_risk ? 3 : 2;
    const deadline = new Date(now); deadline.setMinutes(deadline.getMinutes() + (level === 3 ? 60 : 240));
    const { data: esc, error: ee } = await admin.from("op_escalations").insert({
      hospital_id: sched.op_patients?.hospital_id ?? sched.hospital_id, patient_id: sched.patient_id, shift_id: input.shiftId ?? null,
      escalation_type: "medication_delay", level, severity: level === 3 ? "high" : "urgent",
      summary: `${sched.high_risk ? "HIGH-RISK medication" : "Medication"} delayed ${delayMinutes} min — ${sched.drug_name} (${sched.route}) for ${sched.op_patients?.label ?? "patient"}: ${reason}`,
      raised_by: input.actorId ?? null, response_deadline: deadline.toISOString(), status: "open",
    }).select("id").single();
    if (ee || !esc?.id) return { ok: false, status: 500, error: `Delay recorded needs escalation but it could not be raised (${ee?.message ?? "no id"}) — escalate manually now` };
    escalationId = esc.id;
  }

  const { data: event, error } = await admin.from("op_med_administrations").insert({
    hospital_id: sched.op_patients?.hospital_id ?? sched.hospital_id, schedule_id: sched.id, patient_id: sched.patient_id,
    shift_id: input.shiftId ?? null, outcome: input.outcome,
    administered_by: input.actorId ?? null, administered_by_name: input.actorName ?? null,
    administered_at: new Date(now).toISOString(), delay_minutes: delayMinutes, reason: reason || null,
    safety_checks: input.safetyChecks && typeof input.safetyChecks === "object" ? input.safetyChecks : {},
    witness_id: input.witnessId ?? null, witness_name: witnessName, escalation_id: escalationId,
  }).select().single();
  if (error) return { ok: false, status: migrationMissingErr(error) ? 503 : 500, error: migrationMissingErr(error) ? "Apply migration 154 to enable medications." : error.message };

  // Status transition: administered | delayed | escalated; omitted closes as cancelled.
  const newStatus = escalationId ? "escalated" : input.outcome === "administered" ? "administered" : input.outcome === "delayed" ? "delayed" : "cancelled";
  const { data: schedule } = await admin.from("op_med_schedule").update({ status: newStatus }).eq("id", sched.id).select().single();

  return { ok: true, event, schedule: schedule ?? { ...sched, status: newStatus }, escalated: !!escalationId, escalationId, delayMinutes };
}

// Timeliness intelligence over administration events (spec S8).
export function computeTimeliness(events: { outcome: string; delay_minutes: number }[]): { administered: number; onTimePct: number | null; medianDelay: number | null; delayed: number; omitted: number } {
  const admins = events.filter(e => e.outcome === "administered");
  const delays = admins.map(e => e.delay_minutes).sort((a, b) => a - b);
  const median = delays.length ? delays[Math.floor(delays.length / 2)] : null;
  return {
    administered: admins.length,
    onTimePct: admins.length ? Math.round((admins.filter(e => e.delay_minutes <= ON_TIME_MIN).length / admins.length) * 100) : null,
    medianDelay: median,
    delayed: events.filter(e => e.outcome === "delayed").length,
    omitted: events.filter(e => e.outcome === "omitted").length,
  };
}

// The nurse's medication lens: schedule + events for MY assigned patients,
// derived statuses applied, due queue sorted soonest-first.
export async function loadMyMedications(admin: any, userId: string, now = Date.now()) {
  const { data: asg } = await admin.from("op_patient_assignments")
    .select("op_patients!patient_id(id, label, op_beds!bed_id(label))")
    .eq("staff_id", userId).eq("status", "active").limit(50);
  const patients = ((asg ?? []) as any[]).filter(a => a.op_patients).map(a => ({
    id: a.op_patients.id, label: a.op_patients.label, bed: a.op_patients.op_beds?.label ?? null,
  }));
  const ids = patients.map(p => p.id);

  let schedule: any[] = [], events: any[] = [];
  let migrationMissing = false;
  const dayBack = new Date(now - 24 * 3.6e6).toISOString();
  const dayAhead = new Date(now + 24 * 3.6e6).toISOString();
  if (ids.length) {
    const [sRes, eRes] = await Promise.all([
      admin.from("op_med_schedule").select("*, op_patients!patient_id(label)")
        .in("patient_id", ids).gte("scheduled_at", dayBack).lte("scheduled_at", dayAhead)
        .order("scheduled_at", { ascending: true }).limit(300),
      admin.from("op_med_administrations").select("*, op_med_schedule!schedule_id(drug_name, route, high_risk), op_patients!patient_id(label)")
        .in("patient_id", ids).gte("administered_at", dayBack)
        .order("administered_at", { ascending: false }).limit(200),
    ]);
    migrationMissing = migrationMissingErr(sRes.error) || migrationMissingErr(eRes.error);
    schedule = (sRes.data ?? []).map((r: any) => ({ ...r, effective_status: effectiveStatus(r, now) }));
    events = eRes.data ?? [];
  } else {
    const probe = await admin.from("op_med_schedule").select("id").limit(1);
    migrationMissing = migrationMissingErr(probe.error);
  }

  const open = schedule.filter(r => ["scheduled", "due", "overdue", "in_progress", "delayed"].includes(r.effective_status));
  const queue = open.filter(r => r.effective_status !== "scheduled")
    .sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at));

  return {
    migrationMissing,
    patients,
    schedule,
    queue,
    events,
    kpis: {
      dueNow: queue.filter(r => r.effective_status === "due").length,
      overdue: queue.filter(r => r.effective_status === "overdue").length,
      delayed: queue.filter(r => r.effective_status === "delayed").length,
      upcoming: open.filter(r => r.effective_status === "scheduled").length,
      highRiskPending: open.filter(r => r.high_risk).length,
      administered24h: events.filter((e: any) => e.outcome === "administered").length,
    },
    timeliness: computeTimeliness(events),
  };
}
