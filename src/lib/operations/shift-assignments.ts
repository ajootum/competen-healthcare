// Shift Team Assignments (SSW-TC-TEAM-001) loader — the Shift Supervisor's operational
// allocation engine. Composes live op_* data (loadOpsConsoleData: patients + acuity +
// beds, op_patient_assignments, op_shift_staff, escalations, alerts) into a ward-grouped
// assignment board, unassigned staff/patients, per-role coverage, a derived assignment
// checklist, breaks and recent reassignments. Assignment itself runs through the audited,
// competency-validating /api/operations/assignments route. op_patients carries no PHI, so
// cards show operational identifiers + acuity only — never fabricated names/ages/diagnoses.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";

const PRESENT = new Set(["on_duty", "confirmed", "assigned"]);
const CLINICAL = new Set(["nurse", "charge", "doctor", "therapist", "float"]);
const acuityBadge = (a: string) => (["critical", "high"].includes(a) ? "High" : a === "moderate" ? "Medium" : "Low");
const ROLE_LABEL: Record<string, string> = { nurse: "Registered Nurses", charge: "Charge Nurses", support: "Support Staff", float: "Float Pool", doctor: "Doctors", therapist: "Allied Health", educator: "Educators", assessor: "Assessors" };

export async function loadShiftAssignments(admin: any, hid: string | null, isSuper: boolean) {
  const { ready, data } = await loadOpsConsoleData(admin, hid, isSuper);
  if (!ready) return { ready: false as const };
  const { shifts, patients, assignments, shiftStaff, escalations, alerts } = data;

  const activeShift = shifts.find((s: any) => s.status === "active") ?? shifts[0] ?? null;
  const shiftId = activeShift?.id ?? null;

  // Present staff on this shift
  const roster = shiftStaff.filter((s: any) => (!shiftId || s.shift_id === shiftId));
  const present = roster.filter((s: any) => PRESENT.has(s.status));
  const confirmed = roster.filter((s: any) => ["confirmed", "on_duty"].includes(s.status)).length;

  // Active primary assignments → patient_id → assignment
  const primary = new Map<string, any>();
  for (const a of assignments) if (a.status === "active" && a.assignment_type === "primary") primary.set(a.patient_id, a);
  const assignedStaffIds = new Set([...primary.values()].map((a: any) => a.staff_id));

  const enrich = (p: any) => {
    const a = primary.get(p.id);
    return {
      id: p.id, label: p.label, bed: p.op_beds?.label ?? null, ward: p.departments?.name ?? "Unassigned Ward",
      acuity: p.acuity_level, acuityBadge: acuityBadge(p.acuity_level), isolation: p.isolation_status,
      assigned: a ? { assignmentId: a.id, name: a.profiles?.full_name ?? "—", staffId: a.staff_id, validated: a.competency_validated } : null,
    };
  };
  const board = patients.map(enrich);
  const unassignedPatients = board.filter((p: any) => !p.assigned);
  const highAcuity = board.filter((p: any) => ["critical", "high"].includes(p.acuity));

  // Ward columns (grouped by ward, bed-sorted)
  const wardNames = [...new Set(board.map((p: any) => p.ward))];
  const columns = wardNames.map(w => {
    const ps = board.filter((p: any) => p.ward === w).sort((a: any, b: any) => String(a.bed ?? "").localeCompare(String(b.bed ?? "")));
    return { ward: w, patients: ps, assigned: ps.filter((p: any) => p.assigned).length, total: ps.length };
  }).sort((a, b) => b.total - a.total);

  // Unassigned staff (present, clinical, not primary-assigned)
  const unassignedStaff = present.filter((s: any) => CLINICAL.has(s.role) && !assignedStaffIds.has(s.staff_id)).map((s: any) => ({ id: s.staff_id, name: s.profiles?.full_name ?? "—", role: s.role }));
  const staffPicker = present.filter((s: any) => CLINICAL.has(s.role)).map((s: any) => ({ id: s.staff_id, name: s.profiles?.full_name ?? "—", role: s.role }));

  // Per-role coverage
  const roles = [...new Set(present.map((s: any) => s.role))];
  const staffByRole = roles.map(role => {
    const on = present.filter((s: any) => s.role === role).length;
    const required = roster.filter((s: any) => s.role === role).length; // scheduled as the target baseline
    const coverage = required ? Math.round((on / required) * 100) : (on > 0 ? 100 : null);
    return { role, label: ROLE_LABEL[role] ?? role, on, required, coverage, status: coverage == null ? "—" : coverage >= 100 ? "Good" : coverage >= 75 ? "Fair" : "Low" };
  }).sort((a, b) => b.on - a.on);

  // Breaks (fail-soft)
  let breaks: any[] = [];
  try { const { data: bk } = await admin.from("op_staff_breaks").select("staff_name, scheduled_at, status").in("status", ["scheduled", "on_break", "overdue"]).order("scheduled_at").limit(12); breaks = (bk ?? []).map((b: any) => ({ name: b.staff_name ?? "—", at: b.scheduled_at ? new Date(b.scheduled_at).toISOString().slice(11, 16) : "—", status: b.status === "overdue" ? "Needs cover" : b.status === "on_break" ? "On break" : "Planned" })); } catch { breaks = []; }
  const breaksPending = breaks.filter((b: any) => b.status !== "On break").length;

  // Recent reassignments (audit_log assign_patient)
  let reassignments: any[] = []; let reassignToday = 0;
  try {
    const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? "00000000-0000-0000-0000-000000000000"));
    const { data: au } = await scope(admin.from("audit_log").select("entity_name, actor_name, created_at, new_value").eq("action", "assign_patient").order("created_at", { ascending: false })).limit(10);
    const today = new Date().toISOString().slice(0, 10);
    reassignments = (au ?? []).map((a: any) => ({ patient: a.entity_name ?? "—", by: a.actor_name ?? "—", at: a.created_at ? new Date(a.created_at).toISOString().slice(11, 16) : "—", override: !!a.new_value?.override }));
    reassignToday = (au ?? []).filter((a: any) => (a.created_at ?? "").slice(0, 10) === today).length;
  } catch { /* fail-soft */ }

  // KPIs
  const scheduled = roster.length;
  const kpis = {
    staffOnShift: present.length, staffScheduled: scheduled, confirmedPct: scheduled ? Math.round((confirmed / scheduled) * 100) : null,
    patientsToAllocate: unassignedPatients.length,
    highAcuity: highAcuity.length, highAcuityAssigned: highAcuity.filter((p: any) => p.assigned).length,
    coverage: board.length ? Math.round((board.filter((p: any) => p.assigned).length / board.length) * 100) : null,
    breaksPending, reassignToday,
  };

  // Assignment checklist (derived)
  const rnRole = staffByRole.find(r => r.role === "nurse");
  const checklist = [
    { label: "Attendance confirmed", ok: scheduled > 0 && confirmed >= Math.ceil(scheduled * 0.5) },
    { label: "All high-acuity patients assigned", ok: highAcuity.every((p: any) => p.assigned) },
    { label: "Wards have required RN coverage", ok: !rnRole || (rnRole.coverage != null && rnRole.coverage >= 90) },
    { label: "Break cover planned", ok: breaks.length > 0 || breaksPending === 0 },
    { label: "Assignments reviewed", ok: unassignedPatients.length === 0 },
  ];

  return {
    ready: true as const, shiftId, shiftLabel: activeShift ? `${activeShift.shift_type} shift` : "current shift",
    columns, unassignedPatients, unassignedStaff, staffPicker, staffByRole, breaks, reassignments, checklist, kpis,
    criticalAlerts: escalations.filter((e: any) => (e.level ?? 0) >= 4).length + alerts.filter((a: any) => a.severity === "high").length,
  };
}
