// My Patient Workspace loader (HWW-WARD-001 S5) — the full operational context
// per assigned patient, composed from every real store: patient context (bed,
// age, diagnosis, consultant — sex is NOT in the operational schema and is
// never fabricated), acuity + workload latest scores (migration 153),
// observation schedule, medication schedule (154), open tasks, active safety
// alerts, open escalations, nurse concerns (152) and operational notes.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { effectiveStatus } from "@/lib/hww/medications";
import { computeCnci, cnciInputFromRows, pewsTrend, reassessmentDue, type CnciResult } from "@/lib/hww/cnci";

const migrationMissingErr = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));

// Decorate a loaded patient context with the ARCH-002 prioritisation fields:
// CNCI (S9), PEWS trend, and the S8 reassessment prompt.
export function decorateContext(patient: any, ctx: any): { cnci: CnciResult; pews: number | null; trend: "up" | "down" | "flat" | null; reassess: { due: boolean; reason: string | null } } {
  const input = cnciInputFromRows({
    patient,
    acuityLatest: ctx.acuityLatest, workloadLatest: ctx.workloadLatest,
    observations: ctx.observations, meds: ctx.meds,
    alerts: ctx.alerts, escalations: ctx.escalations, concerns: ctx.concerns, tasks: ctx.tasks,
  });
  const detObs = (ctx.observations ?? []).filter((o: any) => o.recorded_at && (o.escalation_triggered || (o.ews_score != null && o.ews_score >= 5)))
    .sort((x: any, y: any) => +new Date(y.recorded_at) - +new Date(x.recorded_at))[0] ?? null;
  return {
    cnci: computeCnci(input),
    pews: input.pewsLatest,
    trend: pewsTrend(input.pewsLatest, input.pewsPrev),
    reassess: reassessmentDue({
      latestAcuityAt: ctx.acuityLatest?.assessed_at ?? null,
      latestObsEscalatedAt: detObs?.recorded_at ?? null,
      acuityLevel: patient.acuity_level,
    }),
  };
}

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
  for (const a of patients) {
    const pid = a.op_patients.id;
    const medRows = pick(meds.data ?? [], pid).map((m: any) => ({ ...m, effective_status: effectiveStatus(m, now) }));
    const ctx: any = {
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
    };
    Object.assign(ctx, decorateContext(a.op_patients, ctx));
    byPatient.set(pid, ctx);
  }

  return { patients, byPatient };
}

// ── Single-patient workspace (HWW-ARCH-002 S7) ──────────────────────────────
// The full per-patient view: context + histories + patient-linked messages +
// a merged operational timeline. Access mirrors the API rule: the assigned
// nurse, or staff tier (checked by the caller/page).
export async function loadPatientOne(admin: any, userId: string, patientId: string, now = Date.now()) {
  const { data: p } = await admin.from("op_patients")
    .select("*, op_beds!bed_id(label, bed_type), departments!department_id(name)")
    .eq("id", patientId).maybeSingle();
  if (!p) return { found: false as const };

  const { data: asg } = await admin.from("op_patient_assignments").select("id, staff_id, assignment_type, started_at, profiles!staff_id(full_name)")
    .eq("patient_id", patientId).eq("status", "active").limit(10);
  const assignments = (asg ?? []) as any[];
  const assignedToMe = assignments.some(a => a.staff_id === userId);

  const dayBack = new Date(now - 48 * 3.6e6).toISOString();
  const soft = (q: Promise<any>) => q.then((r: any) => (r.error && !migrationMissingErr(r.error) ? { data: [] } : r), () => ({ data: [] }));
  const [obs, meds, medEvents, tasks, alerts, escs, concerns, notes, acuityHist, workloadHist, messages] = await Promise.all([
    soft(admin.from("op_observations").select("*").eq("patient_id", patientId).order("due_at", { ascending: true }).limit(200)),
    soft(admin.from("op_med_schedule").select("*").eq("patient_id", patientId).gte("scheduled_at", dayBack).order("scheduled_at", { ascending: true }).limit(100)),
    soft(admin.from("op_med_administrations").select("*, op_med_schedule!schedule_id(drug_name, route)").eq("patient_id", patientId).order("administered_at", { ascending: false }).limit(50)),
    soft(admin.from("op_tasks").select("*").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(100)),
    soft(admin.from("op_safety_alerts").select("*").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(50)),
    soft(admin.from("op_escalations").select("*").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(50)),
    soft(admin.from("op_concerns").select("*").eq("patient_id", patientId).order("raised_at", { ascending: false }).limit(50)),
    soft(admin.from("op_operational_notes").select("*").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(30)),
    soft(admin.from("op_acuity_assessments").select("*").eq("patient_id", patientId).order("assessed_at", { ascending: false }).limit(30)),
    soft(admin.from("op_workload_assessments").select("*").eq("patient_id", patientId).order("assessed_at", { ascending: false }).limit(30)),
    soft(admin.from("op_messages").select("*").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(20)),
  ]);

  const medRows = (meds.data ?? []).map((m: any) => ({ ...m, effective_status: effectiveStatus(m, now) }));
  const activeAlerts = (alerts.data ?? []).filter((a: any) => a.active);
  const openEscs = (escs.data ?? []).filter((e: any) => ["open", "acknowledged"].includes(e.status));
  const activeConcerns = (concerns.data ?? []).filter((c: any) => ["open", "in_progress", "carried_forward"].includes(c.status));
  const openTasks = (tasks.data ?? []).filter((t: any) => !["completed", "verified", "cancelled"].includes(t.status));

  const ctx: any = {
    observations: obs.data ?? [],
    obsDue: (obs.data ?? []).filter((o: any) => ["due", "overdue"].includes(o.status)),
    meds: medRows,
    medsOpen: medRows.filter((m: any) => ["due", "overdue", "delayed", "scheduled", "in_progress"].includes(m.effective_status)),
    medEvents: medEvents.data ?? [],
    tasks: openTasks,
    alerts: activeAlerts,
    escalations: openEscs,
    concerns: activeConcerns,
    notes: notes.data ?? [],
    acuityLatest: (acuityHist.data ?? [])[0] ?? null,
    workloadLatest: (workloadHist.data ?? [])[0] ?? null,
  };
  Object.assign(ctx, decorateContext(p, ctx));

  // Merged operational timeline (most recent first).
  type T = { at: string; icon: string; text: string; tone?: string };
  const tl: T[] = [
    ...(obs.data ?? []).filter((o: any) => o.recorded_at).map((o: any) => ({ at: o.recorded_at, icon: "📈", text: `Observation recorded — ${String(o.observation_type).replace(/_/g, " ")}${o.ews_score != null ? `, PEWS ${o.ews_score}` : ""}${o.escalation_triggered ? " (auto-escalated)" : ""}`, tone: o.escalation_triggered ? "text-red-700" : undefined })),
    ...(medEvents.data ?? []).map((e: any) => ({ at: e.administered_at, icon: "💊", text: `Medication ${e.outcome} — ${e.op_med_schedule?.drug_name ?? ""}${e.delay_minutes > 0 ? ` (+${e.delay_minutes} min)` : ""}${e.witness_name ? `, witnessed` : ""}`, tone: e.outcome !== "administered" ? "text-amber-700" : undefined })),
    ...(acuityHist.data ?? []).map((a: any) => ({ at: a.assessed_at, icon: "🌡️", text: `Acuity assessed — ${a.score}/18 ${a.level}${a.significant_change ? " (significant change)" : ""}`, tone: a.significant_change ? "text-orange-700" : undefined })),
    ...(workloadHist.data ?? []).map((w: any) => ({ at: w.assessed_at, icon: "⚖️", text: `Workload assessed — ${Number(w.percentage).toFixed(0)}% (${w.framework === "nas" ? "NAS" : "ward"})` })),
    ...(tasks.data ?? []).filter((t: any) => t.completed_at).map((t: any) => ({ at: t.completed_at, icon: "✅", text: `Task completed — ${t.description}` })),
    ...(concerns.data ?? []).map((c: any) => ({ at: c.raised_at, icon: "🚩", text: `Concern raised — ${String(c.category).replace(/_/g, " ")} (${c.priority})` })),
    ...(concerns.data ?? []).filter((c: any) => c.resolved_at).map((c: any) => ({ at: c.resolved_at, icon: "🏁", text: `Concern resolved — ${String(c.category).replace(/_/g, " ")}` })),
    ...(alerts.data ?? []).map((a: any) => ({ at: a.created_at, icon: "🛡️", text: `Safety alert — ${String(a.category).replace(/_/g, " ")} (${a.severity})`, tone: "text-red-700" })),
    ...(escs.data ?? []).map((e: any) => ({ at: e.created_at, icon: "⬆️", text: `Escalation L${e.level} — ${e.summary}`, tone: "text-red-700" })),
    ...(notes.data ?? []).map((n: any) => ({ at: n.created_at, icon: "🗒️", text: `Note — ${n.note}` })),
  ].filter(t => t.at).sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 30);

  return {
    found: true as const,
    patient: p, assignments, assignedToMe, ctx,
    acuityHistory: acuityHist.data ?? [], workloadHistory: workloadHist.data ?? [],
    messages: messages.data ?? [], timeline: tl,
  };
}
