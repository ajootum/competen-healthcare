import { NextResponse } from "next/server";
import { getCaller, isResponse } from "@/lib/api-auth";

// My Shift (COE Healthcare Worker workspace) — the caller's own operational
// picture: current shift, assigned patients, tasks and observations due.
// Self-scoped: any authenticated clinician sees only their own work.
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const admin = c.admin as any;
  const me = c.userId;
  const today = new Date(); today.setDate(today.getDate() - 1);
  const since = today.toISOString().slice(0, 10);

  // Current shift deployment (active/planned, recent).
  const { data: deploy } = await admin.from("op_shift_staff")
    .select("role, status, op_shifts!shift_id(id, shift_type, shift_date, status, department_id, departments!department_id(name))")
    .eq("staff_id", me).limit(20);
  const shift = (deploy ?? [])
    .filter((d: any) => d.op_shifts && ["planned", "active"].includes(d.op_shifts.status) && d.op_shifts.shift_date >= since)
    .sort((a: any, b: any) => (b.op_shifts.status === "active" ? 1 : 0) - (a.op_shifts.status === "active" ? 1 : 0))[0] ?? null;

  // Patients I am responsible for.
  const { data: asg } = await admin.from("op_patient_assignments")
    .select("id, assignment_type, competency_validated, op_patients!patient_id(id, label, acuity_level, isolation_status, risk_level, op_beds!bed_id(label), departments!department_id(name))")
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

  // Observations due/overdue and recently recorded for my patients.
  let observations: any[] = [];
  if (patientIds.length) {
    const { data } = await admin.from("op_observations")
      .select("*, op_patients!patient_id(label)")
      .in("patient_id", patientIds)
      .order("due_at", { ascending: true }).limit(200);
    observations = data ?? [];
  }

  return NextResponse.json({
    shift: shift ? { role: shift.role, status: shift.status, ...shift.op_shifts } : null,
    patients, tasks: tasks ?? [], observations,
  });
}
