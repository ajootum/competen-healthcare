// UMW-OPC-008 Shift Timeline & Handover Centre loader. Assembles the shift picture over the live operational stores:
// a real shift timeline from today's events (escalations / safety / task activity / movements), an auto-generated SBAR
// from live unit state (plus the recorded op_handover if one exists), a handover-readiness score, outstanding
// actions, high-risk patients to watch, the on-duty staff overview and an incoming-shift preview (template). Read-only
// manager lens; the SBAR is a live-state summary, not a signed clinical handover. Live execution stays in the SSW.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchOpsCore, sev, pct, nowMs, NONE } from "./ops-shared";

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const SHIFT_START = 7, SHIFT_END = 19; // day-shift template window (07:00–19:00)

export async function loadHandoverCommand(admin: any, hid: string | null, isSuper: boolean, deptId: string | null) {
  const c = await fetchOpsCore(admin, hid, isSuper, deptId);
  if (!c.provisioned) return { provisioned: false as const };
  const { patients, staff, escalations, safety, tasks, blockers, movements, cur } = c;
  const now = nowMs();
  const startToday = new Date(new Date(now).toISOString().slice(0, 10) + "T00:00:00Z").toISOString();

  // Latest recorded handover (thin store — may be a single record).
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const hoRes = await scope(admin.from("op_handovers").select("id, status, summary, created_at")).order("created_at", { ascending: false }).limit(1).then((r: any) => r, () => ({ data: [] }));
  const handover = (hoRes.data ?? [])[0] ?? null;

  const admitted = patients.filter(p => p.operational_status === "admitted");
  const highRisk = patients.filter(p => p.risk_level === "high");
  const openEsc = escalations.filter(e => ["open", "acknowledged"].includes(e.status));
  const openHighEsc = openEsc.filter(e => sev(e.severity) === "high");
  const activeSafety = safety.filter(s => s.active);
  const activeHighSafety = activeSafety.filter(s => sev(s.severity) === "high");
  const openTasks = tasks.filter(t => !["completed", "verified", "cancelled"].includes(t.status));
  const overdue = openTasks.filter(t => t.due_at && new Date(t.due_at).getTime() < now);
  const onDuty = staff.filter(s => !["off_duty", "absent"].includes(s.status)).length || staff.length;
  const requiredFte = cur.required_fte != null ? Math.round(Number(cur.required_fte)) : (onDuty ? Math.ceil(onDuty * 1.1) : null);
  const coverage = requiredFte ? pct(onDuty, requiredFte) : null;

  // Shift progress (template day-shift window).
  const hr = new Date(now).getHours() + new Date(now).getMinutes() / 60;
  const shiftProgress = clamp(((Math.min(SHIFT_END, Math.max(SHIFT_START, hr)) - SHIFT_START) / (SHIFT_END - SHIFT_START)) * 100);

  const readiness = clamp(100 - openHighEsc.length * 10 - overdue.length * 3 - activeHighSafety.length * 8 - (openEsc.length - openHighEsc.length) * 3);

  const kpis = {
    shiftProgress, patientsInCare: admitted.length, openActions: openTasks.length, escalations: openEsc.length,
    handoverStatus: handover ? (handover.status === "accepted" ? "Accepted" : handover.status === "pending" ? "In Progress" : "Draft") : "Not started",
    unresolvedIssues: openHighEsc.length + activeHighSafety.length,
    staffOnDuty: onDuty, staffRequired: requiredFte, readiness,
  };

  // Real shift timeline from today's events.
  const evs: { at: string; label: string; detail: string; tone: string }[] = [];
  escalations.filter(e => e.created_at >= startToday).forEach(e => evs.push({ at: e.created_at, label: "Escalation", detail: e.summary ?? "clinical", tone: sev(e.severity) === "high" ? "rose" : "amber" }));
  activeSafety.filter(s => s.created_at >= startToday).forEach(s => evs.push({ at: s.created_at, label: "Safety alert", detail: String(s.category).replace(/_/g, " "), tone: "amber" }));
  tasks.filter(t => t.completed_at && t.completed_at >= startToday).forEach(t => evs.push({ at: t.completed_at, label: "Task completed", detail: t.description, tone: "emerald" }));
  movements.forEach(m => evs.push({ at: m.created_at, label: String(m.event_type).replace(/_/g, " "), detail: m.detail ?? "", tone: "blue" }));
  const timeline = evs.filter(e => e.at).sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()).slice(0, 10);

  // Auto-generated SBAR from live state.
  const sbar = {
    situation: `${admitted.length} patients in care, ${highRisk.length} high risk. ${openEsc.length} active escalation${openEsc.length === 1 ? "" : "s"}.`,
    background: `${cur.admissions ?? 0} admissions / ${cur.discharges ?? 0} discharges today (snapshot). ${blockers.length} flow blocker${blockers.length === 1 ? "" : "s"} active.`,
    assessment: `${activeSafety.filter(s => s.category === "deterioration").length} deteriorating alert${activeSafety.filter(s => s.category === "deterioration").length === 1 ? "" : "s"}; staffing ${coverage != null ? `${coverage}%` : `${onDuty} on duty`}. ${overdue.length} action${overdue.length === 1 ? "" : "s"} overdue.`,
    recommendation: `Monitor ${highRisk.length} high-risk patient${highRisk.length === 1 ? "" : "s"}${overdue.length ? `; clear ${overdue.length} overdue action${overdue.length === 1 ? "" : "s"}` : ""}. Prepare for planned admissions.`,
  };

  // High-risk patients to watch.
  const watch = highRisk.slice(0, 4).map(p => ({ label: p.label, acuity: p.acuity_level, isolation: p.isolation_status !== "none" ? p.isolation_status : null }));

  // Outstanding actions (overdue + due soon).
  const outstanding = openTasks.filter(t => t.due_at).sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()).slice(0, 6).map(t => ({ desc: t.description, priority: t.priority, due: t.due_at, overdue: new Date(t.due_at).getTime() < now }));

  // On-duty staff by role.
  const roleCounts: Record<string, number> = {};
  staff.filter(s => !["off_duty", "absent"].includes(s.status)).forEach(s => { const key = ["nurse", "charge"].includes(s.role) ? "Nurses" : s.role === "doctor" ? "Doctors" : ["therapist", "educator", "assessor"].includes(s.role) ? "Allied" : "Support"; roleCounts[key] = (roleCounts[key] ?? 0) + 1; });
  const staffOverview = [
    { label: "Nurses", n: roleCounts["Nurses"] ?? 0, color: "#3b82f6" },
    { label: "Doctors", n: roleCounts["Doctors"] ?? 0, color: "#a855f7" },
    { label: "Allied", n: roleCounts["Allied"] ?? 0, color: "#22c55e" },
    { label: "Support", n: roleCounts["Support"] ?? 0, color: "#f59e0b" },
  ];

  return {
    provisioned: true as const, hasData: c.hasData, kpis, timeline, sbar, handover, watch, outstanding, staffOverview,
    coverage, onDuty, asOf: cur.period ?? null,
  };
}
