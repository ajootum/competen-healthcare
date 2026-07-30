// Nurse Concerns engine (HWW-ADD-001 / HWW-ADD-001B) — the structured bedside
// concern record: category + priority against an operational patient, flagged
// for ward-round discussion or supervisor review, routed via the minimal CCE,
// carried forward across shifts until resolved. Operational records, NOT
// medical notes (diagnoses/prescriptions stay in the EMR).
// Engine logic lives here so the route, the HWW/SSW pages and harness scripts
// exercise the SAME shipped code.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const CONCERN_CATEGORIES = [
  "clinical_deterioration", "pain", "wound", "medication", "nutrition", "family",
  "equipment", "discharge", "doctor_review", "allied_health", "infection_prevention", "other",
] as const;

export const CONCERN_PRIORITIES = ["routine", "today", "urgent", "immediate"] as const;

export const ACTIVE_CONCERN_STATUSES = ["open", "in_progress", "carried_forward"];

// ADD-001B routing destinations (the CCE enum — matches migration 152).
export const ROUTE_DESTINATIONS = [
  "doctor", "medical_team", "specialty", "subspecialty", "on_call", "shift_supervisor", "allied_health", "quality",
] as const;

// A concern is OVERDUE when still active beyond its priority's response window.
// Windows are an operational convention (documented, not spec-mandated):
// immediate 1h · urgent 4h · today 8h · routine 24h.
export const OVERDUE_HOURS: Record<string, number> = { immediate: 1, urgent: 4, today: 8, routine: 24 };
export function isOverdue(c: { priority: string; raised_at: string | null; status: string }, now = Date.now()): boolean {
  if (!ACTIVE_CONCERN_STATUSES.includes(c.status) || !c.raised_at) return false;
  const hours = OVERDUE_HOURS[c.priority] ?? 24;
  return now - new Date(c.raised_at).getTime() > hours * 3.6e6;
}

// Concern → op_task priority when a ward-round action is spawned as a real task.
export const TASK_PRIORITY_BY_CONCERN: Record<string, string> = {
  immediate: "urgent", urgent: "high", today: "normal", routine: "low",
};

// Validation for the raise path (negative-testable).
export function validateConcern(b: any): string[] {
  const errs: string[] = [];
  if (!b?.patient_id) errs.push("patient_id required");
  if (!CONCERN_CATEGORIES.includes(b?.category)) errs.push(`category must be one of: ${CONCERN_CATEGORIES.join(", ")}`);
  if (!CONCERN_PRIORITIES.includes(b?.priority)) errs.push(`priority must be one of: ${CONCERN_PRIORITIES.join(", ")}`);
  if (!String(b?.description ?? "").trim()) errs.push("description required");
  return errs;
}

const CONCERN_SELECT = "*, op_patients!patient_id(label, op_beds!bed_id(label)), op_concern_actions(id, action, owner_id, owner_name, due_at, status, task_id, created_at, completed_at)";

// The nurse's own lens: concerns I raised, concerns others raised on my
// assigned patients, and ward-round actions assigned back to me.
export async function loadMyConcerns(admin: any, userId: string) {
  const { data: asg } = await admin.from("op_patient_assignments").select("patient_id")
    .eq("staff_id", userId).eq("status", "active").limit(100);
  const myPatients = ((asg ?? []) as any[]).map(r => r.patient_id).filter(Boolean);

  const [raisedRes, othersRes, actionsRes] = await Promise.all([
    admin.from("op_concerns").select(CONCERN_SELECT)
      .eq("raised_by", userId).order("raised_at", { ascending: false }).limit(100),
    myPatients.length
      ? admin.from("op_concerns").select(CONCERN_SELECT)
          .in("patient_id", myPatients).neq("raised_by", userId)
          .in("status", ACTIVE_CONCERN_STATUSES).order("raised_at", { ascending: false }).limit(100)
      : Promise.resolve({ data: [], error: null }),
    admin.from("op_concern_actions").select("*, op_concerns!concern_id(id, category, priority, status, description, op_patients!patient_id(label))")
      .eq("owner_id", userId).in("status", ["open", "in_progress"]).order("due_at", { ascending: true }).limit(100),
  ]);

  const err = raisedRes.error ?? (othersRes as any).error ?? actionsRes.error ?? null;
  return {
    migrationMissing: !!err && /does not exist|schema cache/i.test(String(err.message ?? "")),
    raised: raisedRes.data ?? [],
    onMyPatients: (othersRes as any).data ?? [],
    actionsForMe: actionsRes.data ?? [],
    myPatients,
  };
}

// The supervisor's queue lens (HWW-ADD-001 §SSW Integration): active concerns
// tenant-wide with per-patient counts, priority/overdue highlighting and the
// review flags. Resolved concerns leave the queue but stay auditable.
export async function loadConcernQueue(admin: any, hospitalId: string | null, isSuperUser: boolean) {
  let q = admin.from("op_concerns")
    .select("*, op_patients!patient_id(id, label, acuity_level, op_beds!bed_id(label)), raiser:profiles!raised_by(full_name), op_concern_actions(id, action, owner_id, owner_name, due_at, status, task_id)")
    .in("status", ACTIVE_CONCERN_STATUSES)
    .order("raised_at", { ascending: false }).limit(300);
  if (!isSuperUser) q = q.eq("hospital_id", hospitalId ?? "00000000-0000-0000-0000-000000000000");
  const { data, error } = await q;
  const concerns = (data ?? []) as any[];
  const now = Date.now();
  const PRI_RANK: Record<string, number> = { immediate: 3, urgent: 2, today: 1, routine: 0 };
  concerns.sort((a, b) => (PRI_RANK[b.priority] ?? 0) - (PRI_RANK[a.priority] ?? 0) || +new Date(a.raised_at) - +new Date(b.raised_at));

  const perPatient = new Map<string, { label: string; count: number }>();
  for (const c of concerns) {
    const pid = c.op_patients?.id ?? c.patient_id;
    const cur = perPatient.get(pid) ?? { label: c.op_patients?.label ?? "patient", count: 0 };
    cur.count++;
    perPatient.set(pid, cur);
  }

  return {
    migrationMissing: !!error && /does not exist|schema cache/i.test(String(error.message ?? "")),
    concerns,
    kpis: {
      active: concerns.length,
      immediate: concerns.filter(c => c.priority === "immediate").length,
      urgent: concerns.filter(c => c.priority === "urgent").length,
      wardRound: concerns.filter(c => c.ward_round).length,
      ssReview: concerns.filter(c => c.ss_review).length,
      overdue: concerns.filter(c => isOverdue(c, now)).length,
      carried: concerns.filter(c => c.status === "carried_forward").length,
    },
    perPatient: [...perPatient.entries()].map(([id, v]) => ({ patient_id: id, ...v })).sort((a, b) => b.count - a.count),
  };
}
