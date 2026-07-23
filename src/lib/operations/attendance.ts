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
