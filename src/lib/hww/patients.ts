// My Patient Workspace loader (HWW-WARD-001 S5) — the full operational context
// per assigned patient, composed from every real store: patient context (bed,
// age, diagnosis, consultant — sex is NOT in the operational schema and is
// never fabricated), acuity + workload latest scores (migration 153),
// observation schedule, medication schedule (154), open tasks, active safety
// alerts, open escalations, nurse concerns (152) and operational notes.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { effectiveStatus } from "@/lib/hww/medications";

const migrationMissingErr = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));

export async function loadMyPatientWorkspace(admin: any, userId: string, now = Date.now()) {
  const { data: asg } = await admin.from("op_patient_assignments")
    .select("id, assignment_type, competency_validated, started_at, op_patients!patient_id(id, label, patient_ref, age_years, diagnosis, consultant, current_stage, acuity_level, dependency_level, isolation_status, risk_level, operational_status, op_beds!bed_id(label, bed_type), departments!department_id(name))")
    .eq("staff_id", userId).eq("status", "active").limit(50);
  const patients = ((asg ?? []) as any[]).filter(a => a.op_patients);
  const ids = patients.map(a => a.op_patients.id);
  if (!ids.length) return { patients: [], byPatient: new Map<string, any>() };

  const dayBack = new Date(now - 24 * 3.6e6).toISOString();
  const dayAhead = new Date(now + 24 * 3.6e6).toISOString();
  const soft = (p: Promise<any>) => p.then((r: any) => (r.error && !migrationMissingErr(r.error) ? { data: [] } : r), () => ({ data: [] }));

  const [obs, meds, tasks, alerts, escs, concerns, notes, acuity, workload] = await Promise.all([
    soft(admin.from("op_observations").select("*").in("patient_id", ids).order("due_at", { ascending: true }).limit(300)),
    soft(admin.from("op_med_schedule").select("*").in("patient_id", ids).gte("scheduled_at", dayBack).lte("scheduled_at", dayAhead).order("scheduled_at", { ascending: true }).limit(200)),
    soft(admin.from("op_tasks").select("*").in("patient_id", ids).not("status", "in", "(completed,verified,cancelled)").order("due_at", { ascending: true }).limit(200)),
    soft(admin.from("op_safety_alerts").select("*").in("patient_id", ids).eq("active", true).limit(100)),
    soft(admin.from("op_escalations").select("*").in("patient_id", ids).in("status", ["open", "acknowledged"]).limit(100)),
    soft(admin.from("op_concerns").select("*").in("patient_id", ids).in("status", ["open", "in_progress", "carried_forward"]).limit(100)),
    soft(admin.from("op_operational_notes").select("*").in("patient_id", ids).order("created_at", { ascending: false }).limit(60)),
    soft(admin.from("op_acuity_assessments").select("patient_id, score, level, significant_change, assessed_at, assessed_by_name").in("patient_id", ids).order("assessed_at", { ascending: false }).limit(100)),
    soft(admin.from("op_workload_assessments").select("patient_id, percentage, framework, assessed_at").in("patient_id", ids).order("assessed_at", { ascending: false }).limit(100)),
  ]);

  const pick = (rows: any[], pid: string) => rows.filter((r: any) => r.patient_id === pid);
  const first = (rows: any[], pid: string) => rows.find((r: any) => r.patient_id === pid) ?? null;

  const byPatient = new Map<string, any>();
  for (const pid of ids) {
    const medRows = pick(meds.data ?? [], pid).map((m: any) => ({ ...m, effective_status: effectiveStatus(m, now) }));
    byPatient.set(pid, {
      observations: pick(obs.data ?? [], pid),
      obsDue: pick(obs.data ?? [], pid).filter((o: any) => ["due", "overdue"].includes(o.status)),
      meds: medRows,
      medsOpen: medRows.filter((m: any) => ["due", "overdue", "delayed", "scheduled", "in_progress"].includes(m.effective_status)),
      tasks: pick(tasks.data ?? [], pid),
      alerts: pick(alerts.data ?? [], pid),
      escalations: pick(escs.data ?? [], pid),
      concerns: pick(concerns.data ?? [], pid),
      notes: pick(notes.data ?? [], pid).slice(0, 5),
      acuityLatest: first(acuity.data ?? [], pid),
      workloadLatest: first(workload.data ?? [], pid),
    });
  }

  return { patients, byPatient };
}
