// Workforce Availability & Attendance (UMW-WFM-005) loader. The Unit Manager's operational
// bridge between planned availability (approved roster / op_shift_staff) and actual attendance
// (Shift Supervisor confirmation via op_shift_staff.status) — the spec's §39 "non-integrated
// hospital" implementation, which is exactly what this platform stores today. Attendance STATE
// is real (on_duty=present / confirmed=acknowledged / assigned=not-reported / absent / off_duty
// =completed); check-in/out timestamps, minutes-late and absence sub-classification need a
// dedicated attendance-event + leave store → honest next-phase. Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";

const NONE = "00000000-0000-0000-0000-000000000000";
export const ROLE_LABEL: Record<string, string> = { charge: "Charge Nurse", nurse: "Registered Nurse", support: "Healthcare Assistant", float: "Float / Bank", doctor: "Doctor", therapist: "Therapist", educator: "Educator", assessor: "Assessor" };
const CLINICAL = new Set(["charge", "nurse", "support", "float", "doctor", "therapist"]);
// op_shift_staff.status → attendance state
const ATT: Record<string, string> = { on_duty: "Present", confirmed: "Confirmed", assigned: "Not reported", absent: "Absent", off_duty: "Completed" };

export async function loadAttendance(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const { ready, data } = await loadOpsConsoleData(admin, hid, isSuper);
  if (!ready) return { ready: false as const };
  const { shifts, shiftStaff, escalations } = data;
  const activeShifts = shifts.filter((s: any) => s.status === "active");
  const activeIds = [...new Set(activeShifts.map((s: any) => s.id))];
  const staff = shiftStaff.filter((s: any) => activeIds.includes(s.shift_id));

  // Attendance-event timestamps (op_attendance_events, migration 083) — enriches the register
  // with real arrival time + minutes-late per check-in. Fail-soft: store may be empty.
  const latestCheckIn = new Map<string, any>();
  if (activeIds.length) {
    try {
      const { data: ev } = await admin.from("op_attendance_events").select("shift_staff_id, event_type, event_at, minutes_late, check_in_method").in("shift_id", activeIds).order("event_at", { ascending: false });
      for (const e of ev ?? []) if (e.event_type === "check_in" && !latestCheckIn.has(e.shift_staff_id)) latestCheckIn.set(e.shift_staff_id, e);
    } catch { /* store not provisioned */ }
  }

  // Per-staff attendance register (the shared basis for Live Overview + Today's Attendance)
  const register = staff.map((s: any) => {
    const shift = activeShifts.find((x: any) => x.id === s.shift_id);
    const ci = latestCheckIn.get(s.id);
    return {
      id: s.id, staffId: s.staff_id, name: s.profiles?.full_name ?? "Staff", role: s.role, roleLabel: ROLE_LABEL[s.role] ?? s.role,
      status: s.status, attendance: ATT[s.status] ?? "Unknown",
      unit: shift?.departments?.name ?? "Unit", shiftType: shift?.shift_type ?? "—", shiftId: s.shift_id,
      supervisor: shift?.supervisor_id && shift.supervisor_id === s.staff_id,
      arrivalAt: ci?.event_at ?? null, minutesLate: ci?.minutes_late ?? null, checkInMethod: ci?.check_in_method ?? null,
    };
  }).sort((a: any, b: any) => a.name.localeCompare(b.name));
  const lateCount = register.filter((r: any) => (r.minutesLate ?? 0) > 0).length;

  const count = (st: string) => register.filter((r: any) => r.status === st).length;
  const expected = register.length;
  const present = count("on_duty");
  const confirmed = count("confirmed");
  const notReported = count("assigned");
  const absent = count("absent");
  const completed = count("off_duty");
  const presentRate = expected ? Math.round((present / expected) * 100) : null;

  // Role breakdown of expected vs present
  const roleBreakdown = [...new Set(register.map((r: any) => r.role))].map(role => {
    const rows = register.filter((r: any) => r.role === role);
    return { role, label: ROLE_LABEL[role] ?? role, expected: rows.length, present: rows.filter((r: any) => r.status === "on_duty").length, absent: rows.filter((r: any) => r.status === "absent").length };
  }).sort((a, b) => b.expected - a.expected);

  // Available replacements — clinical hospital staff not on any active shift
  const onShift = new Set(staff.map((s: any) => s.staff_id));
  let replacementPool: any[] = [];
  try { const { data: all } = await scope(admin.from("profiles").select("id, full_name, role, roles")).limit(500); replacementPool = (all ?? []).filter((p: any) => !onShift.has(p.id) && (CLINICAL.has(p.role) || (p.roles ?? []).some((r: string) => CLINICAL.has(r)))); } catch { replacementPool = []; }
  const replacements = replacementPool.length;

  // Required staffing (op_staffing_standards) for coverage-after-attendance
  let required: number | null = null;
  try { const { data: std } = await scope(admin.from("op_staffing_standards").select("min_count")); if (std && std.length) required = std.reduce((n: number, r: any) => n + (r.min_count ?? 0), 0); } catch { required = null; }
  const coverageBasis = required ?? expected;
  const coveragePct = coverageBasis ? Math.round((present / coverageBasis) * 100) : null;
  const coverageState = coveragePct == null ? "—" : present >= coverageBasis ? "Fully covered" : coveragePct >= 90 ? "Below target" : "Below minimum";

  // Attendance risk (transparent rule-based, §7.1F)
  const supervisorAbsent = register.some((r: any) => (r.role === "charge" || r.supervisor) && r.status === "absent");
  let riskScore = 0;
  riskScore += absent * 15;
  riskScore += supervisorAbsent ? 40 : 0;
  riskScore += (absent > 0 && replacements === 0) ? 25 : 0;
  riskScore += notReported * 5;
  riskScore += (coverageState === "Below minimum") ? 25 : coverageState === "Below target" ? 10 : 0;
  const riskLevel = riskScore >= 60 ? "Critical" : riskScore >= 35 ? "High" : riskScore >= 15 ? "Moderate" : "Low";

  // Critical attendance alerts (§10) — real over status
  const alerts: { sev: string; title: string; detail: string; action: string }[] = [];
  if (supervisorAbsent) alerts.push({ sev: "Critical", title: "Shift Supervisor absent", detail: "No confirmed charge/supervisor present on an active shift", action: "Assign acting supervisor / redeploy" });
  register.filter((r: any) => r.status === "absent" && ["charge", "nurse"].includes(r.role)).forEach((r: any) => alerts.push({ sev: "High", title: "No-show in minimum-staffing role", detail: `${r.name} (${r.roleLabel}) · ${r.unit}`, action: "Request replacement" }));
  if (absent >= 2) alerts.push({ sev: "High", title: "Multiple staff absent", detail: `${absent} staff absent across active shifts`, action: "Assess coverage & escalate" });
  if (absent > 0 && replacements === 0) alerts.push({ sev: "Critical", title: "No replacement candidate", detail: "Absent staff with no available replacement pool", action: "Escalate staffing shortage" });
  if (coverageState === "Below minimum") alerts.push({ sev: "Critical", title: "Coverage below minimum", detail: `${present}/${coverageBasis} present`, action: "Redeploy / open shift" });

  // Status distribution (§9) — real segments; Late/ReplacementPending/Redeployed need a store
  const distribution = [
    { label: "Present", n: present, tone: "emerald" },
    { label: "Confirmed", n: confirmed, tone: "sky" },
    { label: "Not yet reported", n: notReported, tone: "amber" },
    { label: "Absent", n: absent, tone: "rose" },
    { label: "Completed", n: completed, tone: "gray" },
  ];

  // Live attendance timeline (§8) — from audit_log attendance-relevant actions
  let timeline: any[] = [];
  try {
    const q = admin.from("audit_log").select("actor_name, action, entity_name, created_at").in("action", ["record_attendance", "deploy_staff", "open_shift", "schedule_break", "raise_escalation"]).order("created_at", { ascending: false }).limit(12);
    const { data: tl } = await (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
    timeline = tl ?? [];
  } catch { timeline = []; }

  const pendingActions = notReported + absent;
  const criticalAlerts = escalations.filter((e: any) => (e.level ?? 0) >= 4).length;

  return {
    ready: true as const, activeShifts: activeShifts.length,
    kpis: { expected, present, presentRate, confirmed, notReported, absent, completed, late: lateCount, replacements, riskLevel, riskScore, coveragePct, coverageState, coverageBasis, requiredKnown: required != null, pendingActions, criticalAlerts },
    roleBreakdown, register, replacementPool: replacementPool.slice(0, 20), distribution, alerts, timeline,
  };
}

// Operational absence classification (op_leave_records, migration 083) — merges the latest
// same-day leave classification onto the absent register. Operational fields only (§15.4).
export const LEAVE_LABEL: Record<string, string> = {
  sick: "Sick leave", annual: "Annual leave", maternity_parental: "Maternity / parental", compassionate: "Compassionate", study: "Study leave", official_duty: "Official duty", training: "Training", emergency: "Emergency", unpaid: "Unpaid leave", suspension: "Suspension", occupational_restriction: "Occupational restriction", administrative: "Administrative", unauthorised: "Unauthorised", no_show: "No-show", unknown: "Unclassified",
};

export async function loadAbsenceLeave(admin: any, hid: string | null, isSuper: boolean) {
  const base = await loadAttendance(admin, hid, isSuper);
  if (!base.ready) return { ready: false as const };
  const absent = base.register.filter((r: any) => r.status === "absent");
  const staffIds = base.register.map((r: any) => r.staffId).filter(Boolean);
  const today = new Date().toISOString().slice(0, 10);
  const byStaff = new Map<string, any>();
  if (staffIds.length) {
    try {
      const q = admin.from("op_leave_records").select("staff_id, absence_type, expected_return, replacement_required, leave_approval_status, operational_impact, created_at").in("staff_id", staffIds).eq("absence_date", today).order("created_at", { ascending: false });
      const { data } = await (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
      for (const l of data ?? []) if (!byStaff.has(l.staff_id)) byStaff.set(l.staff_id, l);
    } catch { /* store not provisioned */ }
  }
  const rows = absent.map((r: any) => ({ ...r, leave: byStaff.get(r.staffId) ?? null }));
  const classified = rows.filter((r: any) => r.leave).length;
  const types = [...new Set(rows.filter((r: any) => r.leave).map((r: any) => r.leave.absence_type))];
  const byType = types.map(t => ({ type: t, label: LEAVE_LABEL[t as string] ?? t, count: rows.filter((r: any) => r.leave?.absence_type === t).length })).sort((a, b) => b.count - a.count);
  const replacementOutstanding = rows.filter((r: any) => r.leave?.replacement_required).length;
  return { ready: true as const, absent: rows, classified, total: absent.length, byType, replacementOutstanding, kpis: base.kpis };
}

// Replacement & Redeployment (op_replacement_requests, migration 083) — the request workflow
// over the current-shift gaps + eligible candidate pool. Fail-soft if the store is empty.
export async function loadReplacement(admin: any, hid: string | null, isSuper: boolean) {
  const base = await loadAttendance(admin, hid, isSuper);
  if (!base.ready) return { ready: false as const };
  const absent = base.register.filter((r: any) => r.status === "absent");
  const shiftIds = [...new Set(base.register.map((r: any) => r.shiftId))];
  let requests: any[] = [];
  if (shiftIds.length) {
    try {
      const q = admin.from("op_replacement_requests").select("id, shift_id, role, reason, priority, status, is_redeployment, selected_staff_name, absent_staff_id, requested_by_name, requested_at").in("shift_id", shiftIds).order("requested_at", { ascending: false }).limit(50);
      const { data } = await (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
      requests = (data ?? []).map((r: any) => ({ ...r, roleLabel: ROLE_LABEL[r.role] ?? r.role }));
    } catch { /* store not provisioned */ }
  }
  const OPEN = (s: string) => !["filled", "redeployed", "cancelled", "declined"].includes(s);
  const open = requests.filter((r: any) => OPEN(r.status));
  const filledToday = requests.filter((r: any) => ["filled", "redeployed"].includes(r.status)).length;
  const reqByStaff = new Set(open.map((r: any) => r.absent_staff_id).filter(Boolean));
  const gaps = absent.map((r: any) => ({ ...r, hasRequest: reqByStaff.has(r.staffId) }));
  return { ready: true as const, gaps, requests, open, filledToday, pool: base.replacementPool ?? [], kpis: base.kpis };
}

// Future / declared availability (op_staff_availability, migration 083).
export const AVAIL_LABEL: Record<string, string> = { normal: "Normal roster", additional: "Additional shift", on_call: "On call", standby: "Standby", redeployment: "Redeployment", overtime: "Overtime", remote: "Remote", partial: "Partial", temporarily_unavailable: "Temporarily unavailable", unavailable: "Unavailable", unknown: "Unknown" };
const AVAIL_CLINICAL = new Set(["charge", "nurse", "support", "float", "doctor", "therapist"]);

export async function loadFutureAvailability(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  let declarations: any[] = [];
  let provisioned = true;
  try {
    const res = await scope(admin.from("op_staff_availability").select("id, staff_name, availability_type, period_start, period_end, reason, source, confidence, expires_at, updated_at").order("updated_at", { ascending: false })).limit(100);
    if (res.error) provisioned = !/does not exist|schema cache/i.test(res.error.message ?? "");
    else declarations = res.data ?? [];
  } catch { declarations = []; }
  const nowMs = Date.now();
  const active = declarations.filter((d: any) => !d.expires_at || new Date(d.expires_at).getTime() >= nowMs);
  const types = [...new Set(active.map((d: any) => d.availability_type))];
  const byType = types.map(t => ({ type: t, label: AVAIL_LABEL[t as string] ?? t, count: active.filter((d: any) => d.availability_type === t).length })).sort((a, b) => b.count - a.count);
  const unavailable = active.filter((d: any) => ["unavailable", "temporarily_unavailable"].includes(d.availability_type)).length;
  const expiringSoon = active.filter((d: any) => d.expires_at && new Date(d.expires_at).getTime() < nowMs + 7 * 864e5).length;

  let picker: any[] = [];
  try { const { data } = await scope(admin.from("profiles").select("id, full_name, role")).limit(500); picker = (data ?? []).filter((p: any) => AVAIL_CLINICAL.has(p.role)); } catch { picker = []; }

  return { provisioned, declarations: active, byType, unavailable, expiringSoon, total: active.length, picker: picker.slice(0, 200) };
}

// Attendance Exceptions (op_attendance_exceptions, migration 083) — persisted, stateful register
// PLUS live-derived exceptions (raise-able) from current attendance state. Fail-soft.
const EXC_RANK: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3, informational: 4 };
export async function loadAttendanceExceptions(admin: any, hid: string | null, isSuper: boolean) {
  const base = await loadAttendance(admin, hid, isSuper);
  if (!base.ready) return { ready: false as const };

  // Derived (raise-able) exceptions from live attendance state
  const derived: any[] = [];
  for (const r of base.register) {
    if (r.status === "absent" && ["charge", "nurse"].includes(r.role)) derived.push({ key: `noshow-${r.id}`, category: "no_show", label: "No-show in minimum-staffing role", staffId: r.staffId, shiftId: r.shiftId, shiftStaffId: r.id, staff: r.name, unit: r.unit, severity: r.role === "charge" ? "critical" : "high", detail: `${r.roleLabel} · absent` });
    if ((r.role === "charge" || r.supervisor) && r.status === "absent") derived.push({ key: `sup-${r.id}`, category: "supervisor_absent", label: "Shift Supervisor absent", staffId: r.staffId, shiftId: r.shiftId, shiftStaffId: r.id, staff: r.name, unit: r.unit, severity: "critical", detail: "No confirmed supervisor" });
    if ((r.minutesLate ?? 0) > 30) derived.push({ key: `late-${r.id}`, category: "late", label: "Severe late arrival", staffId: r.staffId, shiftId: r.shiftId, shiftStaffId: r.id, staff: r.name, unit: r.unit, severity: "high", detail: `${r.minutesLate}m late` });
  }

  // Persisted exceptions (open) over active shifts
  const shiftIds = [...new Set(base.register.map((r: any) => r.shiftId))];
  let persisted: any[] = [];
  if (shiftIds.length) {
    try {
      const q = admin.from("op_attendance_exceptions").select("id, staff_name, category, severity, status, detected_at, operational_impact, resolution_action").in("shift_id", shiftIds).order("detected_at", { ascending: false }).limit(60);
      const { data } = await (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
      persisted = data ?? [];
    } catch { /* store not provisioned */ }
  }
  const openPersisted = persisted.filter((e: any) => !["corrected", "approved_exception", "rejected", "closed"].includes(e.status));
  derived.sort((a, b) => EXC_RANK[a.severity] - EXC_RANK[b.severity]);
  return { ready: true as const, derived, persisted, openPersisted, kpis: base.kpis };
}
