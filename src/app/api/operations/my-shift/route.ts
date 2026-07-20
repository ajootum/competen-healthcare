import { NextResponse } from "next/server";
import { getCaller, isResponse } from "@/lib/api-auth";

// Current Shift (HWW-012) — the caller's own operational picture: current shift
// window + supervisor + unit, assigned patients, tasks, observations due, active
// safety alerts, open escalations and personal notifications. Self-scoped: any
// authenticated clinician sees only their own work. Everything here is real
// operational data; the client never fabricates unbacked fields (age, diagnosis,
// allocated break times, supervisor DMs — none of which exist in the op_* schema).
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const admin = c.admin as any;
  const me = c.userId;
  const today = new Date(); today.setDate(today.getDate() - 1);
  const since = today.toISOString().slice(0, 10);

  // Current shift deployment (active/planned, recent) with the full operational
  // context: window, supervisor, department/unit/hospital names.
  const { data: deploy } = await admin.from("op_shift_staff")
    .select("role, status, op_shifts!shift_id(id, shift_type, shift_date, starts_at, ends_at, status, notes, departments!department_id(name), units!unit_id(name), hospitals!hospital_id(name), supervisor:profiles!supervisor_id(full_name))")
    .eq("staff_id", me).limit(20);
  const picked = (deploy ?? [])
    .filter((d: any) => d.op_shifts && ["planned", "active"].includes(d.op_shifts.status) && d.op_shifts.shift_date >= since)
    .sort((a: any, b: any) => (b.op_shifts.status === "active" ? 1 : 0) - (a.op_shifts.status === "active" ? 1 : 0))[0] ?? null;
  const s = picked?.op_shifts ?? null;
  const shift = s ? {
    id: s.id,
    shift_type: s.shift_type,
    shift_date: s.shift_date,
    starts_at: s.starts_at,
    ends_at: s.ends_at,
    status: s.status,
    notes: s.notes,
    duty_status: picked.status,           // op_shift_staff.status — on_duty / off_duty / assigned…
    staff_role: picked.role,
    department: s.departments?.name ?? null,
    unit: s.units?.name ?? null,
    hospital: s.hospitals?.name ?? null,
    supervisor: s.supervisor?.full_name ?? null,
  } : null;

  // Patients I am responsible for.
  const { data: asg } = await admin.from("op_patient_assignments")
    .select("id, assignment_type, competency_validated, op_patients!patient_id(id, label, acuity_level, isolation_status, risk_level, dependency_level, operational_status, op_beds!bed_id(label), departments!department_id(name))")
    .eq("staff_id", me).eq("status", "active").limit(50);
  const patients = (asg ?? []).filter((a: any) => a.op_patients);
  const patientIds = patients.map((p: any) => p.op_patients.id);

  // My tasks (open). Sort by clinical priority rank (not lexicographic text) then due time.
  const { data: taskRows } = await admin.from("op_tasks")
    .select("*, op_patients!patient_id(label)")
    .eq("assigned_to", me).not("status", "in", "(completed,verified,cancelled)")
    .order("due_at", { ascending: true }).limit(100);
  const RANK: Record<string, number> = { urgent: 3, high: 2, normal: 1, low: 0 };
  const tasks = (taskRows ?? []).sort((a: any, b: any) => (RANK[b.priority] ?? 1) - (RANK[a.priority] ?? 1));

  // Observations, active safety alerts and open escalations for my patients.
  let observations: any[] = [];
  let safetyAlerts: any[] = [];
  let escalations: any[] = [];
  if (patientIds.length) {
    const [obs, sa, esc] = await Promise.all([
      admin.from("op_observations")
        .select("*, op_patients!patient_id(label)")
        .in("patient_id", patientIds)
        .order("due_at", { ascending: true }).limit(200),
      admin.from("op_safety_alerts")
        .select("id, patient_id, category, severity, note, created_at, op_patients!patient_id(label)")
        .in("patient_id", patientIds).eq("active", true)
        .order("created_at", { ascending: false }).limit(50),
      admin.from("op_escalations")
        .select("id, patient_id, level, severity, summary, status, created_at, op_patients!patient_id(label)")
        .in("patient_id", patientIds).eq("status", "open")
        .order("created_at", { ascending: false }).limit(50),
    ]);
    observations = obs.data ?? [];
    safetyAlerts = sa.data ?? [];
    escalations = esc.data ?? [];
  }

  // My personal notifications feed (real, per-user) — powers the messages card.
  const { data: notifications } = await admin.from("notifications")
    .select("id, type, title, body, href, read, created_at")
    .eq("user_id", me).order("created_at", { ascending: false }).limit(12);

  return NextResponse.json({
    shift, patients, tasks: tasks ?? [], observations, safetyAlerts, escalations,
    notifications: notifications ?? [],
  });
}
