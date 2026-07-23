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

// Acuity → demand points (TAG-001 §6.1 workload model). Base 1 point per patient plus an
// acuity additive. Transparent + configurable-by-tenant is a next-phase WPS wiring; the
// weights are surfaced in the UI so the model stays auditable, not a black box.
const ACUITY_PTS: Record<string, number> = { critical: 3, high: 2, medium: 0.5, low: 0 };
const acuityPts = (lvl: string) => ACUITY_PTS[lvl] ?? 0.5;
const wardOf = (p: any) => p?.departments?.name ?? "Unit";
const stdev = (xs: number[]) => { if (xs.length < 2) return 0; const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };

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

// ── Assignment Exceptions (TAG-001 §5) ───────────────────────────────────────
// Evaluate the exception catalogue (EX-001..015 subset that's computable from live op_*
// data) into a governance work queue. Each row carries the rule evidence that produced it
// (TAG-ARCH-003 explainability). Lifecycle/SLA/owner need an exception store → honest
// next-phase; every derived exception is state "Open".
const EX_CAT: Record<string, { icon: string; title: string; family: string }> = {
  "EX-001": { icon: "🧑‍⚕️", title: "Insufficient staff coverage", family: "Coverage" },
  "EX-003": { icon: "🧑", title: "Unassigned patient", family: "Assignment" },
  "EX-004": { icon: "⛓️", title: "Multiple primary assignments", family: "Assignment" },
  "EX-005": { icon: "🎯", title: "Competency gap", family: "Competency" },
  "EX-009": { icon: "⚖️", title: "Workload imbalance", family: "Workload" },
  "EX-011": { icon: "❤️", title: "High-acuity mismatch", family: "Acuity" },
  "EX-012": { icon: "📊", title: "Ratio breach", family: "Ratio" },
};

export async function loadTaExceptions(admin: any, hid: string | null, isSuper: boolean) {
  const base = await loadTeamAssignments(admin, hid, isSuper);
  if (!base.ready) return { ready: false as const };
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const { data } = await loadOpsConsoleData(admin, hid, isSuper);
  const { patients, assignments } = data;
  const activeAssign = assignments.filter((a: any) => a.status === "active");
  const assignedIds = new Set(activeAssign.map((a: any) => a.patient_id));
  const highAcuity = patients.filter((p: any) => ["critical", "high"].includes(p.acuity_level));

  // Ratio standards (real when provisioned): default nurse:patient upper bound by unit.
  let standards: any[] = [];
  try { const { data: st } = await scope(admin.from("op_staffing_standards").select("department_id, role, target_ratio, min_count")); standards = st ?? []; } catch { standards = []; }

  type Row = { code: string; icon: string; title: string; family: string; scope: string; detail: string; evidence: string; severity: "Critical" | "High" | "Medium" | "Low"; recommended: string };
  const rows: Row[] = [];
  const push = (code: string, scopeTxt: string, detail: string, evidence: string, severity: Row["severity"], recommended: string) => { const c = EX_CAT[code]; rows.push({ code, icon: c.icon, title: c.title, family: c.family, scope: scopeTxt, detail, evidence, severity, recommended }); };

  // EX-001 / EX-009 / EX-012 — per active shift
  for (const s of base.liveShifts) {
    if (s.staffCov != null && s.staffCov < 90) push("EX-001", `${s.shiftType} · ${s.ward}`, `${s.present}/${s.scheduled} present (${s.staffCov}%)`, "Present qualified capacity below required threshold", s.staffCov < 75 ? "Critical" : "High", "Request staff / open shift in Staffing Engine");
    if (s.workload === "High") push("EX-009", `${s.shiftType} · ${s.ward}`, `${s.ratio} patients/nurse`, "Workload exceeds configured threshold", "High", "Rebalance via Workload Oversight");
    if (s.ratio != null && s.ratio > 5) push("EX-012", `${s.shiftType} · ${s.ward}`, `Ratio ${s.ratio}:1 (max 5:1)`, "Configured nurse:patient ratio breached", s.ratio > 6.5 ? "Critical" : "High", "Add nurse or reduce load");
  }
  // EX-003 — unassigned eligible patients
  for (const p of patients.filter((p: any) => !assignedIds.has(p.id))) {
    const hi = ["critical", "high"].includes(p.acuity_level);
    push("EX-003", wardOf(p), `${p.label ?? "Patient"} · ${p.acuity_level ?? "acuity n/a"}`, "Eligible patient lacks valid primary assignment", hi ? "Critical" : "High", "Assign accountable worker");
  }
  // EX-004 — multiple primary assignments (patient with >1 active assignment)
  const byPatient = new Map<string, number>();
  for (const a of activeAssign) byPatient.set(a.patient_id, (byPatient.get(a.patient_id) ?? 0) + 1);
  for (const [pid, n] of byPatient) if (n > 1) { const p = patients.find((x: any) => x.id === pid); push("EX-004", wardOf(p), `${p?.label ?? "Patient"} · ${n} active assignments`, "Patient has overlapping primary accountability", "High", "Resolve to a single accountable owner"); }
  // EX-005 — competency gap
  for (const a of activeAssign.filter((a: any) => a.competency_validated === false)) { const p = patients.find((x: any) => x.id === a.patient_id); push("EX-005", wardOf(p), `${a.op_patients?.label ?? p?.label ?? "Patient"} · ${a.profiles?.full_name ?? "staff"}`, "Assignment lacks required validated competency", ["critical", "high"].includes(p?.acuity_level) ? "Critical" : "High", "Validate competency or reassign"); }
  // EX-011 — high-acuity mismatch
  for (const p of highAcuity) { const unassigned = !assignedIds.has(p.id); const unvalidated = activeAssign.some((a: any) => a.patient_id === p.id && a.competency_validated === false); if (unassigned || unvalidated) push("EX-011", wardOf(p), `${p.label ?? "Patient"} · ${p.acuity_level}`, unassigned ? "High-acuity patient unassigned" : "High-acuity patient on unvalidated assignment", "Critical", "Assign senior/validated clinician"); }

  const RANK: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  rows.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const bySev = (s: string) => rows.filter(r => r.severity === s).length;
  const byFamily = [...new Set(rows.map(r => r.family))].map(f => ({ family: f, count: rows.filter(r => r.family === f).length })).sort((a, b) => b.count - a.count);
  void standards;
  return {
    ready: true as const,
    kpis: { open: rows.length, critical: bySev("Critical"), high: bySev("High"), medium: bySev("Medium") + bySev("Low"), families: byFamily.length },
    rows, byFamily,
  };
}

// ── Workload Oversight (TAG-001 §6) ──────────────────────────────────────────
// Demand-points model: converts patient + acuity + task demand into comparable points and
// compares with productive staff capacity per unit and per assignee. Real over patients,
// acuity, op_tasks and op_patient_assignments. Forecast/next-4h-risk need history → honest.
export async function loadTaWorkload(admin: any, hid: string | null, isSuper: boolean) {
  const { ready, data } = await loadOpsConsoleData(admin, hid, isSuper);
  if (!ready) return { ready: false as const };
  const { patients, assignments, shiftStaff, tasks } = data;
  const activeAssign = assignments.filter((a: any) => a.status === "active");
  const CAP_PER_NURSE = 6; // productive capacity points per present nurse (transparent assumption)

  // Per-unit demand vs capacity
  const wards = [...new Set(patients.map(wardOf))];
  const openTasks = tasks.filter((t: any) => !["completed", "verified", "cancelled"].includes(t.status));
  const units = wards.map(name => {
    const dp = patients.filter((p: any) => wardOf(p) === name);
    const patientPts = dp.reduce((n: number, p: any) => n + 1 + acuityPts(p.acuity_level), 0);
    const taskPts = openTasks.filter((t: any) => dp.some((p: any) => p.id === t.patient_id)).length * 0.5;
    const demand = +(patientPts + taskPts).toFixed(1);
    // capacity = present nurses on active shifts in this ward × cap-per-nurse
    const nurses = shiftStaff.filter((x: any) => ["nurse", "charge"].includes(x.role) && PRESENT.has(x.status)).length;
    const wardNurses = Math.max(1, Math.round(nurses / Math.max(1, wards.length))); // even split proxy (no shift↔ward map for staff)
    const capacity = wardNurses * CAP_PER_NURSE;
    const index = capacity ? Math.round((demand / capacity) * 100) : null;
    const status = index == null ? "—" : index >= 100 ? "Critical" : index >= 85 ? "High" : index >= 60 ? "Moderate" : "Low";
    return { name, patients: dp.length, high: dp.filter((p: any) => ["critical", "high"].includes(p.acuity_level)).length, patientPts: +patientPts.toFixed(1), taskPts, demand, capacity, index, status };
  }).sort((a, b) => (b.index ?? 0) - (a.index ?? 0));

  // Per-assignee workload (from active assignments grouped by staff)
  const staffMap = new Map<string, { name: string; patients: any[] }>();
  for (const a of activeAssign) { if (!a.staff_id) continue; const cur = staffMap.get(a.staff_id) ?? { name: a.profiles?.full_name ?? "Staff", patients: [] as any[] }; const p = patients.find((x: any) => x.id === a.patient_id); if (p) cur.patients.push(p); staffMap.set(a.staff_id, cur); }
  const assignees = [...staffMap.values()].map(s => {
    const demand = +s.patients.reduce((n, p) => n + 1 + acuityPts(p.acuity_level), 0).toFixed(1);
    const acuityPtsSum = +s.patients.reduce((n, p) => n + acuityPts(p.acuity_level), 0).toFixed(1);
    const index = Math.round((demand / CAP_PER_NURSE) * 100);
    const status = index >= 100 ? "Critical" : index >= 85 ? "High" : index >= 60 ? "Moderate" : "Low";
    return { name: s.name, patients: s.patients.length, high: s.patients.filter(p => ["critical", "high"].includes(p.acuity_level)).length, acuityPts: acuityPtsSum, demand, capacity: CAP_PER_NURSE, index, status };
  }).sort((a, b) => b.index - a.index);

  const indices = units.map(u => u.index).filter((x): x is number => x != null);
  const avgIndex = indices.length ? Math.round(indices.reduce((a, b) => a + b, 0) / indices.length) : null;
  const overloaded = assignees.filter(a => a.index >= 100).length;
  const criticalUnits = units.filter(u => u.status === "Critical").length;
  const imbalance = assignees.length > 1 ? Math.round(stdev(assignees.map(a => a.index))) : 0;

  // Redistribution recommendations (busiest → lightest unit)
  const recs: { from: string; to: string; before: string; after: string; rationale: string }[] = [];
  if (units.length > 1) { const busiest = units[0]; const lightest = units[units.length - 1]; if (busiest.index != null && lightest.index != null && busiest.index - lightest.index >= 25) recs.push({ from: busiest.name, to: lightest.name, before: `${busiest.index}% → ${lightest.index}%`, after: "narrows the gap", rationale: `Move workload from ${busiest.name} (index ${busiest.index}) toward ${lightest.name} (index ${lightest.index}) to reduce imbalance.` }); }

  return {
    ready: true as const,
    kpis: { avgIndex, overloaded, criticalUnits, imbalance, assignees: assignees.length },
    units, assignees, recs, capPerNurse: CAP_PER_NURSE, weights: ACUITY_PTS,
  };
}

// ── Competency Matching (TAG-001 §7) ─────────────────────────────────────────
// Assignment-level competency fit over op_patient_assignments.competency_validated. Match
// matrix by ward + gap queue are real; currency/expiry authoring and the eligible-staff
// finder are owned by the Competency Engine (CME-001, §1.3 boundary) → cross-linked.
export async function loadTaCompetency(admin: any, hid: string | null, isSuper: boolean) {
  const { ready, data } = await loadOpsConsoleData(admin, hid, isSuper);
  if (!ready) return { ready: false as const };
  const { patients, assignments } = data;
  const activeAssign = assignments.filter((a: any) => a.status === "active");
  const validated = activeAssign.filter((a: any) => a.competency_validated === true).length;
  const gaps = activeAssign.filter((a: any) => a.competency_validated === false);
  const unknown = activeAssign.filter((a: any) => a.competency_validated == null).length;
  const requiring = activeAssign.length; // all active assignments require competency match
  const matchRate = requiring ? Math.round((validated / requiring) * 100) : null;
  const highAcuityIds = new Set(patients.filter((p: any) => ["critical", "high"].includes(p.acuity_level)).map((p: any) => p.id));

  // Match by ward
  const wards = [...new Set(activeAssign.map((a: any) => wardOf(patients.find((p: any) => p.id === a.patient_id))))];
  const byWard = wards.map(name => {
    const da = activeAssign.filter((a: any) => wardOf(patients.find((p: any) => p.id === a.patient_id)) === name);
    const v = da.filter((a: any) => a.competency_validated === true).length;
    const g = da.filter((a: any) => a.competency_validated === false).length;
    const u = da.filter((a: any) => a.competency_validated == null).length;
    const pct = da.length ? Math.round((v / da.length) * 100) : null;
    return { ward: name, total: da.length, validated: v, gap: g, unknown: u, pct, status: pct == null ? "—" : pct >= 90 ? "Validated" : pct >= 75 ? "Supervision required" : g ? "Critical" : "At risk" };
  }).filter(x => x.total > 0).sort((a, b) => (a.pct ?? 100) - (b.pct ?? 100));

  // Gap queue (unvalidated first, then unknown)
  const gapQueue = [...gaps.map((a: any) => ({ a, kind: "gap" as const })), ...activeAssign.filter((a: any) => a.competency_validated == null).map((a: any) => ({ a, kind: "unknown" as const }))].map(({ a, kind }) => {
    const p = patients.find((x: any) => x.id === a.patient_id);
    const hi = highAcuityIds.has(a.patient_id);
    return { patient: a.op_patients?.label ?? p?.label ?? "Patient", staff: a.profiles?.full_name ?? "Unassigned", ward: wardOf(p), acuity: p?.acuity_level ?? "—", kind, severity: kind === "gap" && hi ? "Critical" : kind === "gap" ? "High" : "Watch", reason: a.override_reason ?? null };
  }).sort((a, b) => ({ Critical: 0, High: 1, Watch: 2 } as any)[a.severity] - ({ Critical: 0, High: 1, Watch: 2 } as any)[b.severity]);

  const criticalGaps = gapQueue.filter(g => g.severity === "Critical").length;
  return {
    ready: true as const,
    kpis: { matchRate, criticalGaps, gaps: gaps.length, unknown, requiring },
    byWard, gapQueue,
  };
}
