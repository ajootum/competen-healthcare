// Team Assignment Governance & Oversight (UMW-WFM-002) loader. The Unit Manager's
// managerial oversight of assignments across all active shifts — it does NOT perform
// routine allocation (that's the Shift Supervisor's). Composes live op_* data
// (loadOpsConsoleData: patients + acuity, op_patient_assignments [shift-scoped, with
// competency_validated + override_reason], op_shift_staff, escalations, alerts) with the
// active op_shifts (supervisor + department) into: KPIs, live per-shift assignment
// coverage, a derived exception queue, workload + competency-match by ward, real recent
// overrides and policy compliance, and a rule-based AI recommendation. Fail-soft.
// Cross-unit deployment requests have no store → honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";

const NONE = "00000000-0000-0000-0000-000000000000";
const PRESENT = new Set(["on_duty", "confirmed", "assigned"]);
const todayStr = () => new Date().toISOString().slice(0, 10);

export async function loadTeamAssignments(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const { ready, data } = await loadOpsConsoleData(admin, hid, isSuper);
  if (!ready) return { ready: false as const };
  const { patients, assignments, shiftStaff, escalations, alerts } = data;

  // Active shifts with supervisor + department
  let shifts: any[] = [];
  try { const { data: sh } = await scope(admin.from("op_shifts").select("id, shift_type, status, department_id, supervisor_id, departments!department_id(name), profiles!supervisor_id(full_name)").eq("status", "active").order("shift_type")).limit(50); shifts = sh ?? []; } catch { shifts = []; }

  const deptOfPatient = new Map<string, string>();
  for (const p of patients) deptOfPatient.set(p.id, p.departments?.name ?? "Unit");
  const activeAssign = assignments.filter((a: any) => a.status === "active");
  const assignedPatientIds = new Set(activeAssign.map((a: any) => a.patient_id));
  const unassigned = patients.filter((p: any) => !assignedPatientIds.has(p.id));
  const highAcuity = patients.filter((p: any) => ["critical", "high"].includes(p.acuity_level));

  // ── Per-shift live assignment coverage ────────────────────────────────────
  const liveShifts = shifts.map((s: any) => {
    const staff = shiftStaff.filter((x: any) => x.shift_id === s.id);
    const present = staff.filter((x: any) => PRESENT.has(x.status)).length;
    const scheduled = staff.length;
    const shiftAssign = activeAssign.filter((a: any) => a.shift_id === s.id);
    const covPatients = new Set(shiftAssign.map((a: any) => a.patient_id)).size;
    // Patients in this shift's department (fallback: all)
    const deptPatients = s.department_id ? patients.filter((p: any) => p.department_id === s.department_id) : patients;
    const totalP = deptPatients.length;
    const staffCov = scheduled ? Math.round((present / scheduled) * 100) : null;
    const patientCov = totalP ? Math.round((covPatients / totalP) * 100) : null;
    const nurses = staff.filter((x: any) => ["nurse", "charge"].includes(x.role) && PRESENT.has(x.status)).length;
    const ratio = nurses ? +(covPatients / nurses).toFixed(1) : null;
    const workload = ratio == null ? "—" : ratio > 5 ? "High" : ratio > 3.5 ? "Moderate" : "Good";
    const status = (staffCov != null && staffCov < 90) || workload === "High" ? "Action needed" : "On track";
    return { id: s.id, shiftType: s.shift_type, ward: s.departments?.name ?? "All Units", supervisor: s.profiles?.full_name ?? "Unassigned", present, scheduled, staffCov, covPatients, totalP, patientCov, workload, ratio, status };
  });

  // ── KPIs ────────────────────────────────────────────────────────────────
  const totalPresent = liveShifts.reduce((n, s) => n + s.present, 0);
  const totalScheduled = liveShifts.reduce((n, s) => n + s.scheduled, 0);
  const overallCoverage = totalScheduled ? Math.round((totalPresent / totalScheduled) * 100) : null;
  const competencyMismatch = activeAssign.filter((a: any) => a.competency_validated === false).length;
  const criticalAlerts = escalations.filter((e: any) => (e.level ?? 0) >= 4).length + alerts.filter((a: any) => a.severity === "high").length;
  const kpis = {
    activeShifts: shifts.length,
    overallCoverage,
    patientsCovered: assignedPatientIds.size, totalPatients: patients.length,
    patientCoveragePct: patients.length ? Math.round((assignedPatientIds.size / patients.length) * 100) : null,
    highAcuity: highAcuity.length,
    highAcuityNeedReview: highAcuity.filter((p: any) => !assignedPatientIds.has(p.id) || activeAssign.some((a: any) => a.patient_id === p.id && a.competency_validated === false)).length,
    unassigned: unassigned.length,
    competencyMismatch,
    criticalAlerts,
    pendingApprovals: 0, // cross-unit deployment store not provisioned (honest)
  };

  // ── Workload by ward (derived score) ──────────────────────────────────────
  const deptNames = [...new Set(patients.map((p: any) => p.departments?.name ?? "Unit"))];
  const workloadByWard = deptNames.map(name => {
    const dp = patients.filter((p: any) => (p.departments?.name ?? "Unit") === name);
    const high = dp.filter((p: any) => ["critical", "high"].includes(p.acuity_level)).length;
    const score = Math.min(100, Math.round(dp.length * 6 + high * 15));
    return { ward: name, score, status: score >= 85 ? "High" : score >= 60 ? "Medium" : "Good", patients: dp.length, high };
  }).sort((a, b) => b.score - a.score);

  // ── Competency match by ward (% validated) ────────────────────────────────
  const competencyByWard = deptNames.map(name => {
    const da = activeAssign.filter((a: any) => (deptOfPatient.get(a.patient_id) ?? "Unit") === name);
    const validated = da.filter((a: any) => a.competency_validated === true).length;
    const pct = da.length ? Math.round((validated / da.length) * 100) : null;
    return { ward: name, pct, status: pct == null ? "—" : pct >= 80 ? "Good" : "At risk", total: da.length };
  }).filter(x => x.total > 0).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));

  // ── Exception queue (derived) ─────────────────────────────────────────────
  const exceptions: { type: string; icon: string; title: string; context: string; detail: string; severity: string }[] = [];
  for (const s of liveShifts) {
    const nurses = shiftStaff.filter((x: any) => x.shift_id === s.id && ["nurse", "charge"].includes(x.role) && PRESENT.has(x.status)).length;
    if (s.staffCov != null && s.staffCov < 90) exceptions.push({ type: "Staffing", icon: "🧑‍⚕️", title: "Insufficient staff coverage", context: `${s.shiftType} · ${s.ward}`, detail: `${s.present}/${s.scheduled} present`, severity: s.staffCov < 75 ? "High" : "Medium" });
    if (s.workload === "High") exceptions.push({ type: "Workload", icon: "⚖️", title: "High workload imbalance", context: `${s.shiftType} · ${s.ward}`, detail: `${s.ratio} patients/nurse`, severity: "High" });
    void nurses;
  }
  if (competencyMismatch) exceptions.push({ type: "Competency", icon: "🎯", title: "Competency gap", context: "Active assignments", detail: `${competencyMismatch} unvalidated`, severity: "Medium" });
  if (kpis.highAcuityNeedReview) exceptions.push({ type: "High acuity", icon: "❤️", title: "High acuity patient needs review", context: "Unassigned / unvalidated", detail: `${kpis.highAcuityNeedReview} patient(s)`, severity: "Medium" });
  const exceptionCounts = { all: exceptions.length, Staffing: exceptions.filter(e => e.type === "Staffing").length, Workload: exceptions.filter(e => e.type === "Workload").length, Competency: exceptions.filter(e => e.type === "Competency").length, "High acuity": exceptions.filter(e => e.type === "High acuity").length };

  // ── Recent overrides (real — override_reason set) ─────────────────────────
  const overrides = assignments.filter((a: any) => a.override_reason).map((a: any) => ({ patient: a.op_patients?.label ?? "—", staff: a.profiles?.full_name ?? "—", reason: a.override_reason, at: a.started_at, today: (a.started_at ?? "").slice(0, 10) === todayStr() }));
  const overridesToday = overrides.filter((o: any) => o.today).length;

  // ── Policy compliance (derived from competency validation) ────────────────
  const totalAssign = activeAssign.length;
  const complianceRate = totalAssign ? Math.round(((totalAssign - competencyMismatch) / totalAssign) * 100) : null;
  const violations = activeAssign.filter((a: any) => a.competency_validated === false && highAcuity.some((p: any) => p.id === a.patient_id)).length; // unvalidated on high-acuity

  // ── AI insight (rule-based) ───────────────────────────────────────────────
  const busiest = workloadByWard[0]; const quietest = [...workloadByWard].reverse()[0];
  const aiInsight = busiest && quietest && busiest.ward !== quietest.ward && busiest.score - quietest.score > 20
    ? `Consider redeploying 1 nurse from ${quietest.ward} (workload ${quietest.score}) to ${busiest.ward} (workload ${busiest.score}) to rebalance coverage${highAcuity.length ? ` and reduce risk for ${highAcuity.length} high-acuity patients` : ""}.`
    : "Workload is reasonably balanced across wards — no reallocation recommended.";

  return {
    ready: true as const, kpis, liveShifts, exceptions, exceptionCounts, workloadByWard, competencyByWard,
    overrides: overrides.slice(0, 6), overridesToday, policy: { complianceRate, overridesToday, violations },
    aiInsight, crossUnitProvisioned: false as const,
  };
}
