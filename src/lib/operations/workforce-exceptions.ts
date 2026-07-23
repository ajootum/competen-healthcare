// Workforce Exceptions & Approvals (UMW-WFM-006) loader — the governance layer across the WFM
// suite. Aggregates workforce approval requests (approval_requests, migration 077 — the approval
// workflow engine) with exceptions raised across the workforce modules (op_replacement_requests,
// op_attendance_exceptions, op_roster_exceptions, op_escalations, op_leave_records). Real over
// what each store holds; §41 non-integrated implementation. Cost exposure needs a workforce-cost
// store → honest. Fail-soft per source.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => /does not exist|schema cache/i.test(e?.message ?? "");
const SEV_PRI: Record<string, string> = { critical: "critical", high: "high", medium: "moderate", normal: "moderate", low: "low" };
// Approval categories that belong to workforce governance
const WF_CATEGORIES = ["staffing", "personnel", "competency", "operations", "finance"];
const PRANK: Record<string, number> = { critical: 0, high: 1, medium: 2, moderate: 2, low: 3, informational: 4 };

export async function loadWorkforceExceptions(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  // Approval requests (the workflow engine) — workforce categories
  let approvals: any[] = [];
  let apprProvisioned = true;
  try {
    const res = await scope(admin.from("approval_requests").select("id, category, title, priority, impact, status, requester_name, sla_hours, submitted_at, due_at, decided_at, ai_recommendation").in("category", WF_CATEGORIES).order("submitted_at", { ascending: false })).limit(200);
    if (res.error) apprProvisioned = !missing(res.error);
    else approvals = res.data ?? [];
  } catch { approvals = []; }

  // Aggregate workforce exceptions from the op_* stores (each fail-soft)
  const exceptions: any[] = [];
  const push = (r: any) => exceptions.push(r);
  try {
    const { data } = await scope(admin.from("op_replacement_requests").select("id, role, priority, status, reason, requested_at").not("status", "in", "(filled,redeployed,cancelled,declined)")).limit(120);
    for (const r of data ?? []) push({ source: "Replacement", tab: "redeployment", category: "Redeployment & Replacement", severity: SEV_PRI[r.priority] ?? "moderate", title: `${r.role} replacement`, staff: null, detail: r.reason, status: r.status, when: r.requested_at });
  } catch { /* store absent */ }
  try {
    const { data } = await scope(admin.from("op_attendance_exceptions").select("id, category, severity, status, staff_name, operational_impact, detected_at").not("status", "in", "(corrected,approved_exception,rejected,closed)")).limit(120);
    for (const r of data ?? []) push({ source: "Attendance", tab: "attendance", category: "Attendance & Leave", severity: r.severity ?? "moderate", title: (r.category ?? "").replace(/_/g, " "), staff: r.staff_name, detail: r.operational_impact, status: r.status, when: r.detected_at });
  } catch { /* store absent */ }
  try {
    const { data } = await scope(admin.from("op_roster_exceptions").select("id, category, severity, status, staff_name, description, detected_at").not("status", "in", "(resolved,rejected,expired,superseded)")).limit(120);
    for (const r of data ?? []) push({ source: "Roster", tab: "roster", category: "Roster & Shift", severity: r.severity ?? "moderate", title: (r.category ?? "").replace(/_/g, " "), staff: r.staff_name, detail: r.description, status: r.status, when: r.detected_at });
  } catch { /* store absent */ }
  try {
    const { data } = await scope(admin.from("op_escalations").select("id, level, summary, escalation_type, status, created_at").neq("status", "resolved").neq("status", "cancelled")).limit(120);
    for (const r of data ?? []) push({ source: "Escalation", tab: "escalations", category: "Escalation", severity: (r.level ?? 0) >= 4 ? "critical" : (r.level ?? 0) >= 3 ? "high" : "moderate", title: r.summary ?? r.escalation_type ?? "Escalation", staff: null, detail: r.escalation_type, status: r.status, when: r.created_at });
  } catch { /* store absent */ }
  try {
    const { data } = await scope(admin.from("op_leave_records").select("id, staff_name, absence_type, leave_approval_status, absence_date").eq("leave_approval_status", "pending")).limit(120);
    for (const r of data ?? []) push({ source: "Leave", tab: "attendance", category: "Attendance & Leave", severity: "moderate", title: `${(r.absence_type ?? "").replace(/_/g, " ")} — pending`, staff: r.staff_name, detail: null, status: "pending", when: r.absence_date });
  } catch { /* store absent */ }

  const nowMs = Date.now();
  const OPEN_APPR = new Set(["waiting", "pending_info", "escalated", "returned", "delegated"]);
  const openApprovals = approvals.filter((a: any) => OPEN_APPR.has(a.status));
  const overdue = openApprovals.filter((a: any) => a.due_at && new Date(a.due_at).getTime() < nowMs);
  const escalatedCount = approvals.filter((a: any) => a.status === "escalated").length + exceptions.filter((e: any) => e.source === "Escalation").length;
  const critical = exceptions.filter((e: any) => e.severity === "critical").length + openApprovals.filter((a: any) => a.priority === "critical").length;
  const financeExposure = openApprovals.filter((a: any) => a.category === "finance").length;

  // Priority decision panel — open approvals, overdue + critical first (overdue flagged here so
  // the page never calls Date.now() during render — react-hooks/purity)
  const priority = [...openApprovals].map((a: any) => ({ ...a, overdue: !!(a.due_at && new Date(a.due_at).getTime() < nowMs) }))
    .sort((a: any, b: any) => (a.overdue ? 0 : 1) - (b.overdue ? 0 : 1) || (PRANK[a.priority] ?? 9) - (PRANK[b.priority] ?? 9))
    .slice(0, 8);

  const cats = [...new Set(exceptions.map((e: any) => e.category))].map(c => ({ category: c, count: exceptions.filter((e: any) => e.category === c).length })).sort((a, b) => b.count - a.count);
  exceptions.sort((a: any, b: any) => (PRANK[a.severity] ?? 9) - (PRANK[b.severity] ?? 9));

  const kpis = {
    openExceptions: exceptions.length + openApprovals.length,
    awaitingApproval: openApprovals.length,
    critical, overdue: overdue.length, escalated: escalatedCount, retrospective: 0, financeExposure,
    exceptionCount: exceptions.length,
  };

  return { ready: true as const, apprProvisioned, approvals, openApprovals, exceptions, kpis, cats, priority };
}
