// HWW shift context loader (HWW-001 Shift Engine + Patient Context Engine) —
// the caller's own operational picture: current shift deployment, assigned
// patients, open tasks, observations, active safety alerts, open escalations
// and personal notifications. Extracted from /api/operations/my-shift so the
// SAME shipped logic serves both the API route (client refresh) and the
// server-rendered Healthcare Worker Workspace pages.
// Everything here is real op_* data; fields the operational schema does not
// hold are never fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type MyShift = {
  shift: any | null;
  patients: any[];
  tasks: any[];
  observations: any[];
  safetyAlerts: any[];
  escalations: any[];
  notifications: any[];
};

export async function loadMyShift(admin: any, userId: string): Promise<MyShift> {
  const me = userId;
  const today = new Date(); today.setDate(today.getDate() - 1);
  const since = today.toISOString().slice(0, 10);

  // Current shift deployment (active/planned, recent) with the full operational
  // context: window, supervisor, department/unit/hospital names AND ids (the
  // ids feed the ward-context queries below).
  const { data: deploy } = await admin.from("op_shift_staff")
    .select("role, status, op_shifts!shift_id(id, shift_type, shift_date, starts_at, ends_at, status, notes, hospital_id, department_id, unit_id, departments!department_id(name), units!unit_id(name), hospitals!hospital_id(name), supervisor:profiles!supervisor_id(full_name))")
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
    hospital_id: s.hospital_id ?? null,
    department_id: s.department_id ?? null,
    unit_id: s.unit_id ?? null,
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

  // My personal notifications feed (real, per-user).
  const { data: notifications } = await admin.from("notifications")
    .select("id, type, title, body, href, read, created_at")
    .eq("user_id", me).order("created_at", { ascending: false }).limit(12);

  return {
    shift, patients, tasks: tasks ?? [], observations, safetyAlerts, escalations,
    notifications: notifications ?? [],
  };
}

// ── Ward context (HWW-WARD-001 Ward Dashboard) ──────────────────────────────
// The unit-level operational picture around the nurse's shift: census + acuity
// mix, bed occupancy and who is on duty. Scoped to the shift's unit when set,
// else its department. Null when the nurse has no current shift.
export type WardContext = {
  census: number;
  acuity: Record<string, number>;
  isolation: number;
  beds: { occupied: number; total: number } | null;
  staff: { name: string | null; role: string; status: string }[];
  onDuty: number;
};

export async function loadWardContext(admin: any, shift: any | null): Promise<WardContext | null> {
  if (!shift?.id) return null;
  const IN_WARD = ["admitted", "transfer_pending", "discharge_pending"];

  let pq = admin.from("op_patients").select("id, acuity_level, isolation_status").in("operational_status", IN_WARD);
  if (shift.unit_id) pq = pq.eq("unit_id", shift.unit_id);
  else if (shift.department_id) pq = pq.eq("department_id", shift.department_id);
  else if (shift.hospital_id) pq = pq.eq("hospital_id", shift.hospital_id);

  const [patientsRes, bedsRes, staffRes] = await Promise.all([
    pq.limit(500),
    shift.unit_id
      ? admin.from("op_beds").select("id, status").eq("unit_id", shift.unit_id).limit(500)
      : Promise.resolve({ data: null }),
    admin.from("op_shift_staff").select("role, status, profiles!staff_id(full_name)").eq("shift_id", shift.id).limit(100),
  ]);

  const acuity: Record<string, number> = { stable: 0, moderate: 0, high: 0, critical: 0 };
  let isolation = 0;
  for (const p of patientsRes.data ?? []) {
    acuity[p.acuity_level] = (acuity[p.acuity_level] ?? 0) + 1;
    if (p.isolation_status && p.isolation_status !== "none") isolation++;
  }
  const bedRows = bedsRes.data as any[] | null;
  const staff = (staffRes.data ?? []).map((r: any) => ({ name: r.profiles?.full_name ?? null, role: r.role, status: r.status }));

  return {
    census: (patientsRes.data ?? []).length,
    acuity,
    isolation,
    beds: bedRows ? { occupied: bedRows.filter((b: any) => b.status === "occupied").length, total: bedRows.length } : null,
    staff,
    onDuty: staff.filter((x: any) => x.status === "on_duty").length,
  };
}
