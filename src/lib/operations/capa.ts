// CAPA & Improvement Workspace (UMW-EA-003) loader. Reads the real quality store —
// op_quality_actions (migration 073: capa / audit_action / pdsa / improvement_project
// / rca / policy_review, priority, status open|in_progress|overdue|completed, owner,
// due/completed dates). Derives a 5x5 risk score and timeline progress from the stored
// priority + dates (there is no explicit risk or %-complete column — honest, noted in
// the UI). KPIs, CAPA register, by-type/status, overdue list, improvement projects,
// closure trend, upcoming reviews, the selected review panel (rule-based AI insight)
// and rule-based AI insights. Fail-soft: not-provisioned before 073. CAPA has no
// department dimension in the store → unit-wide (honest). Root-cause categorisation,
// evidence/verification and RCA methodology are next-phase honest states. Decisions
// run through the existing audited /api/operations/quality-actions route.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { QUALITY_TYPE_LABEL } from "@/lib/operations/quality-safety";

const NONE = "00000000-0000-0000-0000-000000000000";

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
const codeOf = (r: any) => `CAPA-${String(r.created_at ?? "").slice(0, 4) || "20XX"}-${String(r.id ?? "").slice(0, 4).toUpperCase()}`;

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
      ...r, code: codeOf(r), typeLabel: QUALITY_TYPE_LABEL[r.action_type] ?? r.action_type,
      overdue: isOverdue(r, nowIso), risk: rs, riskBand: riskBand(rs), progress: progressOf(r, nowMs),
      owner: r.owner_name ?? r.created_by_name ?? "Unassigned",
    };
  };
  const all = rows.map(enrich);
  const open = all.filter((r: any) => r.status !== "completed");
  const completed = all.filter((r: any) => r.status === "completed");

  if (!all.length) return { provisioned: true as const, empty: true, kpis: emptyKpis(), register: [], counts: emptyCounts(), byType: [], byStatus: [], overdueList: [], projects: [], closureTrend: [], upcoming: [], review: null, aiInsights: [], rootCauseNext: true };

  // ── KPIs ────────────────────────────────────────────────────────────────
  const overdueList = open.filter((r: any) => r.overdue).sort((a: any, b: any) => (a.due_at ?? "9") < (b.due_at ?? "9") ? -1 : 1);
  const inProgress = open.filter((r: any) => r.status === "in_progress");
  const pendingVerification = inProgress.filter((r: any) => r.progress >= 80); // timeline-complete, awaiting closure evidence (derived — no verification stage in store)
  const d30 = new Date(nowMs - 30 * 864e5).toISOString();
  const completedThisPeriod = completed.filter((r: any) => (r.completed_at ?? r.created_at) >= d30);
  const closureDays = completed.map((r: any) => r.completed_at && r.created_at ? (new Date(r.completed_at).getTime() - new Date(r.created_at).getTime()) / 864e5 : null).filter((x: any): x is number => x != null && x >= 0);
  const avgClosure = closureDays.length ? Math.round((closureDays.reduce((a: number, b: number) => a + b, 0) / closureDays.length) * 10) / 10 : null;
  const closedRatio = all.length ? Math.round((completed.length / all.length) * 100) : null;

  const kpis = {
    open: open.length, overdue: overdueList.length, inProgress: inProgress.length,
    pendingVerification: pendingVerification.length, completedThisPeriod: completedThisPeriod.length,
    avgClosure, effectiveness: closedRatio,
  };

  // ── Register (priority + risk first) ──────────────────────────────────────
  const bandRank: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
  const register = [...open].sort((a: any, b: any) => (bandRank[a.riskBand] - bandRank[b.riskBand]) || (b.risk - a.risk) || ((a.due_at ?? "9") < (b.due_at ?? "9") ? -1 : 1));
  const counts = {
    all: open.length,
    high: open.filter((r: any) => r.riskBand === "High").length,
    medium: open.filter((r: any) => r.riskBand === "Medium").length,
    low: open.filter((r: any) => r.riskBand === "Low").length,
  };

  // ── Distribution ──────────────────────────────────────────────────────────
  const grp = (arr: any[], key: (r: any) => string) => { const m: Record<string, number> = {}; for (const r of arr) { const k = key(r); m[k] = (m[k] ?? 0) + 1; } return Object.entries(m).map(([label, n]) => ({ label, n, pct: arr.length ? Math.round((n / arr.length) * 100) : 0 })).sort((a, b) => b.n - a.n); };
  const byType = grp(all, (r: any) => r.typeLabel);
  const STATUS_ORDER = ["open", "in_progress", "overdue", "completed"];
  const byStatus = STATUS_ORDER.map(s => ({ label: s === "in_progress" ? "In Progress" : s[0].toUpperCase() + s.slice(1), key: s, n: all.filter((r: any) => r.status === s).length })).filter(x => x.n > 0);

  // ── Improvement projects ─────────────────────────────────────────────────
  const projects = open.filter((r: any) => r.action_type === "improvement_project").sort((a: any, b: any) => b.progress - a.progress).slice(0, 6);

  // ── Closure trend (completions per week, last 8 wks) ──────────────────────
  const weeks: { label: string; start: number; end: number }[] = [];
  for (let i = 7; i >= 0; i--) { const end = nowMs - (i * 7) * 864e5; const start = end - 7 * 864e5; weeks.push({ label: new Date(start).toISOString().slice(5, 10), start, end }); }
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

  return { provisioned: true as const, empty: false, kpis, register, counts, byType, byStatus, overdueList, projects, closureTrend, upcoming, review, aiInsights, rootCauseNext: true };
}

function emptyKpis() { return { open: 0, overdue: 0, inProgress: 0, pendingVerification: 0, completedThisPeriod: 0, avgClosure: null, effectiveness: null }; }
function emptyCounts() { return { all: 0, high: 0, medium: 0, low: 0 }; }
