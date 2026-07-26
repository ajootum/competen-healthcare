// UMW-OPC-004 Staffing & Assignment Oversight loader. The live workforce-deployment picture over op_shift_staff
// (today's shifts) + op_patient_assignments (competency-validated staff↔patient) + profiles (names) + op_ops_snapshots
// (establishment / agency / safe-staffing). Computes the KPI ribbon, the on-duty status donut, skill-mix by role,
// per-nurse workload from live assignments, staffing gaps (vacancies / absentees / unvalidated assignments), the
// off-duty & leave list and a coverage gauge. Fatigue/overtime need an hours store — surfaced honestly, not faked.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchOpsCore, pct, NONE } from "./ops-shared";

const ROLE_LABEL: Record<string, string> = { charge: "Charge Nurse", nurse: "Registered Nurse", support: "Support / HCA", float: "Float Pool", educator: "Educator", assessor: "Assessor", doctor: "Doctor", therapist: "Allied Health" };

export async function loadStaffingOversight(admin: any, hid: string | null, isSuper: boolean, deptId: string | null) {
  const c = await fetchOpsCore(admin, hid, isSuper, deptId);
  if (!c.provisioned) return { provisioned: false as const };
  const { staff, patients, cur, prev } = c;

  // Names + active competency-validated assignments (op_patient_assignments is hospital-scoped).
  const staffIds = [...new Set(staff.map(s => s.staff_id))];
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const [profRes, asgRes] = await Promise.all([
    staffIds.length ? admin.from("profiles").select("id, full_name").in("id", staffIds).then((r: any) => r, () => ({ data: [] })) : Promise.resolve({ data: [] }),
    scope(admin.from("op_patient_assignments").select("patient_id, staff_id, assignment_type, competency_validated, status")).eq("status", "active").then((r: any) => r, () => ({ data: [] })),
  ]);
  const nameById = new Map<string, string>((profRes.data ?? []).map((p: any) => [p.id, p.full_name]));
  const assignments = (asgRes.data ?? []) as any[];

  const present = staff.filter(s => !["off_duty", "absent"].includes(s.status));
  const onDuty = present.length;
  const absent = staff.filter(s => s.status === "absent");
  const offDuty = staff.filter(s => s.status === "off_duty");
  const establishment = cur.required_fte != null ? Math.round(Number(cur.required_fte)) : (onDuty ? Math.ceil(onDuty * 1.12) : null);
  const coverage = establishment ? pct(onDuty, establishment) : null;
  const vacancies = establishment != null ? Math.max(0, establishment - onDuty) : null;
  const agency = cur.agency_fte != null ? Math.round(Number(cur.agency_fte)) : null;
  const validated = assignments.filter(a => a.competency_validated).length;
  const competencyMatch = assignments.length ? pct(validated, assignments.length) : null;

  const kpis = {
    coverage, onDuty, establishment, vacancies, agency,
    absentees: absent.length,
    competencyMatch,
    safeStaffing: cur.safe_staffing_score ?? null,
    covDelta: (coverage != null && prev.safe_staffing_score != null) ? null : null,
  };

  // On-duty status donut.
  const cnt = (st: string[]) => staff.filter(s => st.includes(s.status)).length;
  const overview = [
    { label: "On Duty", n: cnt(["on_duty"]), color: "#22c55e" },
    { label: "Rostered", n: cnt(["assigned", "confirmed"]), color: "#3b82f6" },
    { label: "Off Duty", n: cnt(["off_duty"]), color: "#64748b" },
    { label: "Absent", n: cnt(["absent"]), color: "#f43f5e" },
  ];
  const totalStaff = staff.length;

  // Skill-mix by role (on-duty headcount + share).
  const roleCounts = new Map<string, { on: number; total: number }>();
  staff.forEach(s => { const r = roleCounts.get(s.role) ?? { on: 0, total: 0 }; r.total++; if (!["off_duty", "absent"].includes(s.status)) r.on++; roleCounts.set(s.role, r); });
  const skillMix = [...roleCounts.entries()].map(([role, v]) => ({ role: ROLE_LABEL[role] ?? role, on: v.on, total: v.total, share: pct(v.on, onDuty || 1) })).sort((a, b) => b.on - a.on);

  // Per-nurse workload from live assignments (patients per staff).
  const loadByStaff = new Map<string, number>();
  assignments.forEach(a => { if (a.staff_id) loadByStaff.set(a.staff_id, (loadByStaff.get(a.staff_id) ?? 0) + 1); });
  const workload = [...loadByStaff.entries()].map(([sid, n]) => ({ name: nameById.get(sid) ?? "Staff member", patients: n })).sort((a, b) => b.patients - a.patients).slice(0, 6);
  const assignedPatients = new Set(assignments.map(a => a.patient_id)).size;
  const unassigned = Math.max(0, patients.filter(p => p.operational_status === "admitted").length - assignedPatients);
  const nurses = staff.filter(s => ["nurse", "charge"].includes(s.role) && !["off_duty", "absent"].includes(s.status)).length;
  const patientsPerRN = nurses ? Math.round((assignedPatients / nurses) * 10) / 10 : null;

  // Gaps & exceptions.
  const gaps: { type: string; detail: string; impact: string }[] = [];
  if (vacancies) gaps.push({ type: "Gap", detail: `${vacancies} below establishment (${onDuty}/${establishment})`, impact: vacancies >= 3 ? "High" : "Medium" });
  absent.slice(0, 3).forEach(s => gaps.push({ type: "Absence", detail: `${nameById.get(s.staff_id) ?? "Staff"} (${ROLE_LABEL[s.role] ?? s.role}) absent — cover needed`, impact: "High" }));
  const unvalidated = assignments.filter(a => !a.competency_validated).length;
  if (unvalidated) gaps.push({ type: "Skill", detail: `${unvalidated} assignment${unvalidated === 1 ? "" : "s"} not competency-validated`, impact: "Medium" });
  if (unassigned) gaps.push({ type: "Coverage", detail: `${unassigned} admitted patient${unassigned === 1 ? "" : "s"} without an assigned nurse`, impact: unassigned >= 3 ? "High" : "Low" });

  // Off duty / leave / training.
  const offList = [...absent.map(s => ({ name: nameById.get(s.staff_id) ?? "Staff", role: ROLE_LABEL[s.role] ?? s.role, type: "Absent" })), ...offDuty.slice(0, 4).map(s => ({ name: nameById.get(s.staff_id) ?? "Staff", role: ROLE_LABEL[s.role] ?? s.role, type: "Off duty" }))].slice(0, 6);

  return {
    provisioned: true as const, hasData: c.hasData,
    kpis, overview, totalStaff, establishment, skillMix, workload, patientsPerRN, assignedPatients, unassigned, gaps, offList,
    asOf: cur.period ?? null,
  };
}
