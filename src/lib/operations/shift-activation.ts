// Shift Planning & Activation Centre (SSW-SPA-001) — the Shift Supervisor's operational
// orchestration hub. It does NOT own operational data; it consumes live data from the
// authoritative modules (published roster from WSE-001B, attendance from Workforce Ops,
// census/acuity from Patient Ops, competency, tasks, escalations) and validates shift
// readiness before activation. Composes the current/next shift with the roster, census,
// attendance, establishment demand and a 12-item readiness checklist derived from live
// state — every value traceable to a single source. Activation is gated on mandatory
// readiness items. Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";
import { loadEstablishment } from "@/lib/operations/establishment";
import { loadRosterForWeek, mondayOf } from "@/lib/operations/roster-solver";

const PRESENT = new Set(["on_duty", "confirmed"]);
const ACUITY_SCORE: Record<string, number> = { critical: 4, high: 3, moderate: 2, stable: 1 };

export async function loadShiftActivation(admin: any, hid: string | null, isSuper: boolean) {
  const [ops, est, roster] = await Promise.all([
    loadOpsConsoleData(admin, hid, isSuper),
    loadEstablishment(admin, hid, isSuper) as Promise<any>,
    loadRosterForWeek(admin, hid, isSuper, mondayOf()),
  ]);
  if (!ops.ready) return { ready: false as const };
  const { shifts, shiftStaff, patients, escalations, alerts, tasks } = ops.data;

  // The shift to plan/activate: prefer a planned shift (pre-activation), else the active one
  const planned = shifts.find((s: any) => s.status === "planned");
  const active = shifts.find((s: any) => s.status === "active");
  const shift = planned ?? active ?? shifts[0] ?? null;
  const phase = shift?.status === "active" ? "activated" : "planning";

  const roster0 = shiftStaff.filter((s: any) => !shift || s.shift_id === shift.id);
  const expected = roster0.length;
  const confirmed = roster0.filter((s: any) => PRESENT.has(s.status)).length;
  const absent = roster0.filter((s: any) => s.status === "absent").length;
  const attendancePct = expected ? Math.round((confirmed / expected) * 100) : null;

  const totalPatients = patients.length;
  const acuitySum = patients.reduce((n: number, p: any) => n + (ACUITY_SCORE[p.acuity_level] ?? 1), 0);
  const avgAcuity = totalPatients ? +(acuitySum / totalPatients).toFixed(1) : null;
  const highAcuity = patients.filter((p: any) => ["critical", "high"].includes(p.acuity_level)).length;

  const activeAssign = ops.data.assignments.filter((a: any) => a.status === "active");
  const assignedPatients = new Set(activeAssign.map((a: any) => a.patient_id)).size;
  const unvalidated = activeAssign.filter((a: any) => a.competency_validated === false).length;
  const urgentTasks = tasks.filter((t: any) => t.priority === "urgent");
  const urgentAssigned = urgentTasks.filter((t: any) => t.assigned_to).length;
  const openEsc = escalations.filter((e: any) => ["open", "acknowledged"].includes(e.status));
  const highAlerts = alerts.filter((a: any) => a.severity === "high");

  // Demand (establishment) + coverage
  const requiredFte = est.ready ? est.kpis.totalRequired : null;
  const coverage = est.ready ? est.kpis.coverageCompliance : null;
  const minStaffing = est.ready && est.kpis.vacancyFte <= 0;

  // Breaks scheduled?
  let breaksScheduled = 0;
  try { const q = admin.from("op_staff_breaks").select("id", { count: "exact", head: true }).in("status", ["scheduled", "on_break"]); const { count } = await (isSuper ? q : q.eq("hospital_id", hid ?? "00000000-0000-0000-0000-000000000000")); breaksScheduled = count ?? 0; } catch { /* honest */ }

  // Handover accepted?
  let handoverAccepted = false;
  try { const { data } = await (isSuper ? admin.from("op_handovers").select("status").order("created_at", { ascending: false }).limit(1) : admin.from("op_handovers").select("status").eq("hospital_id", hid ?? "00000000-0000-0000-0000-000000000000").order("created_at", { ascending: false }).limit(1)); handoverAccepted = (data ?? [])[0]?.status === "accepted"; } catch { /* honest */ }

  // 12-item readiness checklist (SSW-SPA-001 §12) derived from live state
  const check = (label: string, ok: boolean, detail: string, mandatory = true, source = "") => ({ label, ok, detail, mandatory, source });
  const checklist = [
    check("Attendance confirmed", attendancePct != null && attendancePct >= 90, `${confirmed}/${expected} staff confirmed`, true, "Workforce Ops"),
    check("Patient census complete", totalPatients > 0, `${totalPatients} patients`, true, "Patient Ops"),
    check("Acuity complete", avgAcuity != null, `avg acuity ${avgAcuity ?? "—"}`, true, "Clinical Status"),
    check("Competency gaps addressed", unvalidated === 0, unvalidated ? `${unvalidated} unvalidated assignment(s)` : "all validated", true, "Competency Platform"),
    check("Minimum staffing achieved", minStaffing, coverage != null ? `${coverage}% of establishment` : "n/a", true, "WSE-001A/E"),
    check("Break coverage validated", breaksScheduled > 0, `${breaksScheduled} break(s) scheduled`, false, "Workforce Ops"),
    check("Critical tasks assigned", urgentTasks.length === 0 || urgentAssigned === urgentTasks.length, `${urgentAssigned}/${urgentTasks.length} urgent tasks assigned`, true, "Task Centre"),
    check("Operational risks acknowledged", openEsc.length === 0 && highAlerts.length === 0, `${openEsc.length} escalation(s), ${highAlerts.length} alert(s)`, false, "Quality & Safety"),
    check("Patient allocation approved", totalPatients === 0 || assignedPatients >= totalPatients, `${assignedPatients}/${totalPatients} patients allocated`, true, "WSE-001C–E"),
    check("Handover completed", handoverAccepted, handoverAccepted ? "Accepted" : "Pending acceptance", false, "Handover Centre"),
  ];
  const mandatoryDone = checklist.filter(c => c.mandatory).every(c => c.ok);
  const readinessPct = Math.round((checklist.filter(c => c.ok).length / checklist.length) * 100);

  // Risk register
  const risks = [
    ...openEsc.slice(0, 4).map((e: any) => ({ type: "Escalation", label: e.summary || `Escalation L${e.level}`, sev: (e.level ?? 0) >= 4 ? "High" : "Medium" })),
    ...highAlerts.slice(0, 3).map((a: any) => ({ type: "Safety alert", label: a.category ?? "Alert", sev: "High" })),
    ...(unvalidated ? [{ type: "Competency", label: `${unvalidated} unvalidated assignment(s)`, sev: "Medium" }] : []),
  ];

  return {
    ready: true as const, phase, shift,
    kpis: { expected, confirmed, absent, attendancePct, totalPatients, avgAcuity, highAcuity, requiredFte, coverage, assignedPatients, readinessPct },
    checklist, mandatoryDone, risks,
    roster: roster0.map((s: any) => ({ id: s.id, name: s.profiles?.full_name ?? "Staff", role: s.role, status: s.status })).sort((a: any, b: any) => a.name.localeCompare(b.name)),
    rosterProvisioned: (roster as any).provisioned, publishedRoster: (roster as any).roster ?? null,
    breaksScheduled,
  };
}
