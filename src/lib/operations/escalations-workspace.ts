// Escalations Workspace (UMW-EA-002) loader. Reads the real op_escalations store —
// KPIs, the escalation board, by-type/severity analytics, weekly timeline, hotspot
// analysis, the selected review panel (with rule-based AI risk scoring + recommended
// actions) and AI early-warning. Tenant-scoped; dept via the linked patient. Fail-
// soft pre-migration. op_patients holds NO PHI (age/sex/name), so patient detail is
// operational-only (honest).
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const cap = (s?: string) => (s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, " ") : "Other");
const sevBucket = (level: number) => (level >= 4 ? "Critical" : level === 3 ? "High" : level === 2 ? "Medium" : "Low");
const REC_BY_TYPE: Record<string, string[]> = {
  clinical: ["Senior clinical review", "Review observations", "Consider sepsis screen", "Review oxygen therapy", "Notify medical officer"],
  staffing: ["Review roster & skill mix", "Redeploy available staff", "Approve overtime if safe", "Notify workforce lead"],
  equipment: ["Biomedical review", "Swap to backup device", "Log equipment incident", "Confirm patient safety"],
  patient_safety: ["Immediate safety review", "Reassess care plan", "Open incident if harm", "Notify safety lead"],
  operational: ["Assign owner", "Resolve blocker", "Notify coordinator"],
  infection_control: ["Isolate & review", "Notify IPC team", "Screen contacts"],
};

export async function loadEscalations(admin: any, hid: string | null, isSuper: boolean, dept?: string, selectedId?: string) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const probe = await admin.from("op_escalations").select("id").limit(1);
  if (probe.error && /does not exist|schema cache/i.test(probe.error.message ?? "")) return { provisioned: false as const };

  const { data } = await scope(admin.from("op_escalations")
    .select("*, op_patients!patient_id(label, department_id, acuity_level, departments!department_id(name)), profiles!raised_by(full_name), assignee:profiles!assigned_responder(full_name)")
    .order("level", { ascending: false }).order("created_at", { ascending: false }).limit(600));
  let rows = (data ?? []);
  if (dept) rows = rows.filter((r: any) => r.op_patients?.department_id === dept);

  const now = Date.now(); const nowIso = new Date().toISOString();
  const d7 = new Date(); d7.setDate(d7.getDate() - 7); const since7 = d7.toISOString();
  const enrich = (r: any) => ({
    ...r, reporter: r.profiles?.full_name ?? "—", owner: r.assignee?.full_name ?? null,
    area: r.op_patients?.departments?.name ?? (r.unit_id ? "Unit" : "Unit-level"),
    patientLabel: r.op_patients?.label ?? null, elapsedMin: Math.floor((now - new Date(r.created_at).getTime()) / 60000),
    bucket: sevBucket(r.level), overdue: r.response_deadline ? r.response_deadline < nowIso : false,
  });
  const all = rows.map(enrich);
  const open = all.filter((r: any) => ["open", "acknowledged"].includes(r.status));
  const resolved = all.filter((r: any) => r.status === "resolved");

  const respTimes = resolved.filter((r: any) => r.resolved_at).map((r: any) => (new Date(r.resolved_at).getTime() - new Date(r.created_at).getTime()) / 60000).filter((m: number) => m >= 0);
  const avgResponse = respTimes.length ? Math.round(respTimes.reduce((a: number, b: number) => a + b, 0) / respTimes.length) : null;
  const criticalN = open.filter((r: any) => r.level >= 4).length;
  const kpis = {
    open: open.length, critical: criticalN, highPriority: open.filter((r: any) => r.level === 3).length,
    awaitingReview: open.filter((r: any) => r.status === "open").length,
    avgResponse, resolvedThisWeek: resolved.filter((r: any) => r.resolved_at && r.resolved_at >= since7).length,
    health: open.length ? Math.max(0, Math.round(100 - (criticalN / open.length) * 40 - (open.filter((r: any) => r.overdue).length / open.length) * 25)) : 100,
  };

  const board = open;
  const grp = (arr: any[], key: string) => { const m: Record<string, number> = {}; for (const r of arr) { const k = r[key] ?? "other"; m[k] = (m[k] ?? 0) + 1; } return Object.entries(m).map(([label, n]) => ({ label: cap(label), n, pct: arr.length ? Math.round((n / arr.length) * 100) : 0 })).sort((a, b) => b.n - a.n); };
  const byType = grp(open, "escalation_type");
  const bySeverity = ["Critical", "High", "Medium", "Low"].map(b => ({ label: b, n: open.filter((r: any) => r.bucket === b).length }));

  // Weekly timeline (opened vs resolved per day, last 7 days).
  const days: string[] = []; for (let i = 6; i >= 0; i--) { const dd = new Date(); dd.setDate(dd.getDate() - i); days.push(dd.toISOString().slice(0, 10)); }
  const timeline = days.map(dt => ({ date: dt, opened: all.filter((r: any) => (r.created_at ?? "").slice(0, 10) === dt).length, resolved: all.filter((r: any) => (r.resolved_at ?? "").slice(0, 10) === dt).length }));

  const hotspots = grp(open, "area").slice(0, 6);

  const selected = (selectedId ? all.find((r: any) => r.id === selectedId) : null) ?? board[0] ?? null;
  let review = null;
  if (selected) {
    const riskScore = Math.min(100, selected.level * 18 + (selected.status === "open" ? 10 : 0) + (selected.overdue ? 10 : 0));
    review = {
      ...selected, riskScore, riskLabel: riskScore >= 80 ? "High Risk" : riskScore >= 55 ? "Medium Risk" : "Low Risk",
      recommendations: (REC_BY_TYPE[selected.escalation_type] ?? REC_BY_TYPE.operational),
      dueIn: selected.response_deadline ? Math.round((new Date(selected.response_deadline).getTime() - now) / 60000) : null,
    };
  }

  // AI early warning (rule-based over the live queue).
  const aiWarn: { tone: string; title: string; sub: string }[] = [];
  if (criticalN >= 2) aiWarn.push({ tone: "red", title: "High critical-escalation volume", sub: `${criticalN} critical open — concentrate senior review` });
  if (open.filter((r: any) => r.escalation_type === "staffing").length) aiWarn.push({ tone: "amber", title: "Staffing risk increasing", sub: "Open staffing escalations present" });
  if (open.filter((r: any) => r.escalation_type === "equipment").length) aiWarn.push({ tone: "amber", title: "Equipment issues trending up", sub: "Open equipment escalations present" });
  if (open.filter((r: any) => r.overdue).length) aiWarn.push({ tone: "red", title: "Overdue escalations", sub: `${open.filter((r: any) => r.overdue).length} past SLA — action required` });

  return { provisioned: true as const, total: all.length, kpis, board, byType, bySeverity, timeline, hotspots, review, aiWarn };
}
