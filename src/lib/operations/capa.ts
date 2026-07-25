// CAPA & Continuous Improvement Centre (UMG-QS-004 / UMW-EA-003) loader. Reads the real quality store —
// op_quality_actions (migration 073: capa / audit_action / pdsa / improvement_project / rca / policy_review,
// priority, status open|in_progress|overdue|completed, owner, due/completed dates). Aligned to the QS-004
// high-fidelity design spec. Real: the 8-KPI ribbon (open / overdue / due-this-week / high-priority /
// awaiting-verification / effectiveness-review candidates / completion-rate / avg-closure), the opened /
// closed / closure-time sparklines and period deltas (derived from created_at + completed_at — no snapshot
// store needed), the CAPA register (Work Queue) risk-ranked, by-type/"source", by-status, priority
// distribution, PDSA cycles, closure trend, overdue list, improvement projects, upcoming reviews, the review
// panel (derived 5×5 risk assessment + rule-based AI) and AI insights. Honest next-phase: op_quality_actions
// has NO source-module linkage (source shown by action type), and no milestone/budget/dependency/evidence/
// verification/effectiveness columns — the full Improvement Project Workspace and the Evidence → Verification
// → Effectiveness → Lessons Learned stages need a new store. Decisions run through /api/operations/quality-actions.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { QUALITY_TYPE_LABEL } from "@/lib/operations/quality-safety";

const NONE = "00000000-0000-0000-0000-000000000000";
// Originating-source proxy from the action type (true source-module linkage is next-phase).
const SOURCE_LABEL: Record<string, string> = { capa: "Corrective Action", audit_action: "Audit", rca: "Incident / RCA", pdsa: "Improvement (PDSA)", improvement_project: "Improvement Project", policy_review: "Policy Review" };
const PRIORITY_COLOR: Record<string, string> = { high: "#ef4444", medium: "#f59e0b", low: "#22c55e" };

const isOverdue = (r: any, nowIso: string) => r.status !== "completed" && ((r.status === "overdue") || (r.due_at != null && r.due_at < nowIso));
const likelihood = (r: any, nowIso: string) => Math.min(5, (r.priority === "high" ? 4 : r.priority === "medium" ? 3 : 2) + (isOverdue(r, nowIso) ? 1 : 0));
const severity = (r: any) => (r.priority === "high" ? 5 : r.priority === "medium" ? 3 : 2);
const riskScore = (r: any, nowIso: string) => Math.min(25, likelihood(r, nowIso) * severity(r));
const riskBand = (s: number) => (s >= 15 ? "High" : s >= 8 ? "Medium" : "Low");
const progressOf = (r: any, nowMs: number) => {
  if (r.status === "completed") return 100;
  if (r.created_at && r.due_at) {
    const c = new Date(r.created_at).getTime(), d = new Date(r.due_at).getTime();
    if (d > c) return Math.max(5, Math.min(98, Math.round(((nowMs - c) / (d - c)) * 100)));
  }
  return r.status === "in_progress" ? 55 : r.status === "overdue" ? 85 : 15;
};
const codeOf = (r: any) => `CAPA-${String(r.created_at ?? "").slice(0, 4) || "20XX"}-${String(r.id ?? "").replace(/-/g, "").slice(0, 4).toUpperCase()}`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const monthKey = (iso: string) => String(iso ?? "").slice(0, 7);

export async function loadCAPA(admin: any, hid: string | null, isSuper: boolean, _dept?: string, selectedId?: string) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const probe = await admin.from("op_quality_actions").select("id").limit(1);
  if (probe.error && /does not exist|schema cache/i.test(probe.error.message ?? "")) return { provisioned: false as const };

  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const { data } = await scope(admin.from("op_quality_actions")
    .select("id, action_type, title, description, priority, status, owner_name, due_at, completed_at, created_at, created_by_name")
    .order("created_at", { ascending: false })).limit(4000);

  const rows = (data ?? []) as any[];
  const enrich = (r: any) => {
    const rs = riskScore(r, nowIso);
    return {
      ...r, code: codeOf(r), typeLabel: QUALITY_TYPE_LABEL[r.action_type] ?? r.action_type, source: SOURCE_LABEL[r.action_type] ?? "Other",
      overdue: isOverdue(r, nowIso), risk: rs, riskBand: riskBand(rs), progress: progressOf(r, nowMs),
      owner: r.owner_name ?? r.created_by_name ?? "Unassigned",
    };
  };
  const all = rows.map(enrich);
  const open = all.filter((r: any) => r.status !== "completed");
  const completed = all.filter((r: any) => r.status === "completed");

  // ── 6-month buckets (opened / closed / closure-time sparklines + deltas — real from timestamps) ──
  const now = new Date();
  const months: { key: string; label: string }[] = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleString("en-US", { month: "short" }) }); }
  const openedSpark = months.map(m => all.filter((r: any) => monthKey(r.created_at) === m.key).length);
  const closedSpark = months.map(m => completed.filter((r: any) => monthKey(r.completed_at ?? r.created_at) === m.key).length);
  const closureDaysOf = (r: any) => (r.completed_at && r.created_at) ? (new Date(r.completed_at).getTime() - new Date(r.created_at).getTime()) / 864e5 : null;
  const closureSpark = months.map(m => { const xs = completed.filter((r: any) => monthKey(r.completed_at ?? r.created_at) === m.key).map(closureDaysOf).filter((x: any): x is number => x != null && x >= 0); const mn = mean(xs); return mn != null ? Math.round(mn * 10) / 10 : 0; });
  const pctDelta = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : null);
  const openedDelta = pctDelta(openedSpark[5], openedSpark[4]);
  const closedDelta = pctDelta(closedSpark[5], closedSpark[4]);

  if (!all.length) return { provisioned: true as const, empty: true, kpis: emptyKpis(), sparks: { opened: openedSpark, closed: closedSpark, closure: closureSpark }, deltas: { opened: null, closed: null }, monthsLabels: months.map(m => m.label), register: [], counts: emptyCounts(), priorityDist: [], byType: [], bySource: [], byStatus: [], overdueList: [], projects: [], pdsa: [], closureTrend: [], upcoming: [], review: null, aiInsights: [], rootCauseNext: true };

  // ── KPIs (8-card ribbon) ──────────────────────────────────────────────────
  const nowMsLocal = nowMs;
  const d7 = new Date(nowMsLocal + 7 * 864e5).toISOString();
  const overdueList = open.filter((r: any) => r.overdue).sort((a: any, b: any) => (a.due_at ?? "9") < (b.due_at ?? "9") ? -1 : 1);
  const inProgress = open.filter((r: any) => r.status === "in_progress");
  const pendingVerification = inProgress.filter((r: any) => r.progress >= 80); // timeline-complete, awaiting closure evidence (derived)
  const dueThisWeek = open.filter((r: any) => r.due_at && r.due_at >= nowIso && r.due_at <= d7);
  const highPriority = open.filter((r: any) => r.priority === "high");
  const d30 = new Date(nowMsLocal - 30 * 864e5).toISOString();
  const completedThisPeriod = completed.filter((r: any) => (r.completed_at ?? r.created_at) >= d30);
  const closureDays = completed.map(closureDaysOf).filter((x: any): x is number => x != null && x >= 0);
  const avgClosure = closureDays.length ? Math.round((closureDays.reduce((a: number, b: number) => a + b, 0) / closureDays.length) * 10) / 10 : null;
  const completionRate = all.length ? Math.round((completed.length / all.length) * 100) : null;

  const kpis = {
    open: open.length, overdue: overdueList.length, inProgress: inProgress.length,
    dueThisWeek: dueThisWeek.length, highPriority: highPriority.length,
    pendingVerification: pendingVerification.length,
    effectivenessReviews: completedThisPeriod.length, // completed this period = effectiveness-review candidates (proxy — no effectiveness stage in store)
    completedThisPeriod: completedThisPeriod.length,
    completionRate, avgClosure, effectiveness: completionRate,
  };

  // ── Register (Work Queue — priority + risk first) ─────────────────────────
  const bandRank: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
  const register = [...open].sort((a: any, b: any) => (bandRank[a.riskBand] - bandRank[b.riskBand]) || (b.risk - a.risk) || ((a.due_at ?? "9") < (b.due_at ?? "9") ? -1 : 1));
  const counts = { all: open.length, high: open.filter((r: any) => r.riskBand === "High").length, medium: open.filter((r: any) => r.riskBand === "Medium").length, low: open.filter((r: any) => r.riskBand === "Low").length };
  const priorityDist = [
    { label: "High", n: open.filter((r: any) => r.priority === "high").length, color: PRIORITY_COLOR.high },
    { label: "Medium", n: open.filter((r: any) => r.priority === "medium").length, color: PRIORITY_COLOR.medium },
    { label: "Low", n: open.filter((r: any) => r.priority === "low").length, color: PRIORITY_COLOR.low },
  ];

  // ── Distribution (by type + by "source" [action-type proxy] + by status) ──
  const grp = (arr: any[], key: (r: any) => string) => { const m: Record<string, number> = {}; for (const r of arr) { const k = key(r); m[k] = (m[k] ?? 0) + 1; } return Object.entries(m).map(([label, n]) => ({ label, n, pct: arr.length ? Math.round((n / arr.length) * 100) : 0 })).sort((a, b) => b.n - a.n); };
  const byType = grp(all, (r: any) => r.typeLabel);
  const bySource = grp(all, (r: any) => r.source);
  const STATUS_ORDER = ["open", "in_progress", "overdue", "completed"];
  const byStatus = STATUS_ORDER.map(s => ({ label: s === "in_progress" ? "In Progress" : s[0].toUpperCase() + s.slice(1), key: s, n: all.filter((r: any) => r.status === s).length })).filter(x => x.n > 0);

  // ── Improvement projects + PDSA cycles ────────────────────────────────────
  const projects = open.filter((r: any) => r.action_type === "improvement_project").sort((a: any, b: any) => b.progress - a.progress).slice(0, 6);
  const pdsa = all.filter((r: any) => r.action_type === "pdsa").sort((a: any, b: any) => (a.status === "completed" ? 1 : 0) - (b.status === "completed" ? 1 : 0) || b.progress - a.progress).slice(0, 6)
    .map((r: any) => ({ id: r.id, title: r.title, status: r.status, progress: r.progress, owner: r.owner, due: r.due_at }));

  // ── Closure trend (completions per week, last 8 wks) ──────────────────────
  const weeks: { label: string; start: number; end: number }[] = [];
  for (let i = 7; i >= 0; i--) { const end = nowMsLocal - (i * 7) * 864e5; const start = end - 7 * 864e5; weeks.push({ label: new Date(start).toISOString().slice(5, 10), start, end }); }
  const closureTrend = weeks.map(w => ({ label: w.label, n: completed.filter((r: any) => { const t = new Date(r.completed_at ?? r.created_at).getTime(); return t >= w.start && t < w.end; }).length }));

  // ── Upcoming reviews ──────────────────────────────────────────────────────
  const upcoming = open.filter((r: any) => r.due_at && r.due_at >= nowIso).sort((a: any, b: any) => (a.due_at < b.due_at ? -1 : 1)).slice(0, 6);

  // ── Selected review ───────────────────────────────────────────────────────
  const selected = (selectedId ? all.find((r: any) => r.id === selectedId) : null) ?? register[0] ?? open[0] ?? all[0] ?? null;
  let review = null;
  if (selected) {
    const l = likelihood(selected, nowIso), s = severity(selected);
    const controls = selected.overdue ? "Weak" : selected.status === "in_progress" ? "Partial" : "Adequate";
    const detect = selected.risk >= 15 ? 3 : selected.risk >= 8 ? 4 : 5;
    const conf = Math.min(95, 55 + selected.risk);
    const rec = selected.risk >= 15 ? "Escalate & prioritise" : selected.risk >= 8 ? "Progress with verification" : "Standard closure track";
    const actions = [
      selected.riskBand === "High" ? "Assign senior owner / escalate" : "Confirm owner and due date",
      "Attach corrective + preventive evidence",
      selected.overdue ? "Recover overdue action immediately" : "Track progress to due date",
      "Verify effectiveness before closure",
    ];
    review = {
      ...selected, likelihood: l, severity: s, detectability: detect, controls,
      aiConfidence: conf, aiRec: rec, aiActions: actions,
      impact: [
        { label: "Patient Safety", level: selected.riskBand === "High" ? "High" : selected.riskBand },
        { label: "Clinical Outcome", level: selected.riskBand === "High" ? "At Risk" : "Stable" },
        { label: "Resource Impact", level: selected.priority === "high" ? "High" : "Medium" },
        { label: "Reputational Risk", level: selected.riskBand === "High" ? "Medium" : "Low" },
      ],
    };
  }

  // ── AI insights (rule-based) ─────────────────────────────────────────────
  const aiInsights: { icon: string; text: string; tone: string }[] = [];
  const topType = byType[0];
  if (overdueList.length) aiInsights.push({ icon: "⏰", text: `${overdueList.length} CAPA${overdueList.length === 1 ? "" : "s"} overdue — recovery needed`, tone: "red" });
  if (counts.high) aiInsights.push({ icon: "⚠", text: `${counts.high} high-risk CAPA${counts.high === 1 ? "" : "s"} require escalation`, tone: "amber" });
  if (topType && all.length >= 4) aiInsights.push({ icon: "📊", text: `Top category: ${topType.label} (${topType.pct}%)`, tone: "gray" });
  if (avgClosure != null) aiInsights.push({ icon: "⏱", text: `Average closure time ${avgClosure} days`, tone: "gray" });
  if (dueThisWeek.length) aiInsights.push({ icon: "📅", text: `${dueThisWeek.length} CAPA${dueThisWeek.length === 1 ? "" : "s"} due within 7 days`, tone: "amber" });

  return { provisioned: true as const, empty: false, kpis, sparks: { opened: openedSpark, closed: closedSpark, closure: closureSpark }, deltas: { opened: openedDelta, closed: closedDelta }, monthsLabels: months.map(m => m.label), register, counts, priorityDist, byType, bySource, byStatus, overdueList, projects, pdsa, closureTrend, upcoming, review, aiInsights, rootCauseNext: true };
}

function emptyKpis() { return { open: 0, overdue: 0, inProgress: 0, dueThisWeek: 0, highPriority: 0, pendingVerification: 0, effectivenessReviews: 0, completedThisPeriod: 0, completionRate: null, avgClosure: null, effectiveness: null }; }
function emptyCounts() { return { all: 0, high: 0, medium: 0, low: 0 }; }
