import { createAdminClient } from "@/lib/supabase/server";
import { computeRiskFlags } from "@/lib/engines/risk";

type Admin = ReturnType<typeof createAdminClient>;

// ── Improvement & Action Center (3 modules) data loader ─────────────────────
// The execution layer: Improvement Plans, CAPA and Educational Risks. CAPA is
// live from capa_actions; educational risks are derived from live risk flags
// (competency decisions) plus audit findings. There is no improvement-plan
// store yet, so that module is an honest shell.

const CLOSED = new Set(["completed", "closed", "verified"]);

export type CapaRow = { title: string; program: string; severity: string; status: string; due: string | null };
export type RiskRow = { name: string; category: string; severity: "Critical" | "High" | "Medium" | "Low"; owner: string; flags: number };

export type ImprovementCenter = {
  exec: { activePlans: null; openCapas: number; criticalRisks: number; overdueActions: number; completionRate: number | null; effectiveness: null; riskReduction: null; overallScore: number | null };
  plans: { note: string };
  capa: {
    cards: { total: number; critical: number; overdue: number; open: number; verified: number };
    byStatus: { label: string; n: number; color: string }[];
    bySeverity: { label: string; n: number; color: string }[];
    bySource: { label: string; n: number }[];
    recent: CapaRow[];
    closureRate: number | null;
  };
  risks: {
    cards: { critical: number; high: number; medium: number; low: number; total: number };
    byCategory: { label: string; n: number; color: string }[];
    bySeverity: { label: string; n: number; color: string }[];
    top: RiskRow[];
    note: string;
  };
};

const SEV_OF: Record<string, "Critical" | "High" | "Medium" | "Low"> = { critical_failure: "Critical", not_competent: "High", expired: "Medium" };
const CAT_OF: Record<string, string> = { critical_failure: "Critical Failure", not_competent: "Competency Gap", expired: "Expired Competency" };
const SEV_COLOR: Record<string, string> = { Critical: "#ef4444", High: "#f59e0b", Medium: "#eab308", Low: "#22c55e" };
const CAT_COLORS = ["#8b5cf6", "#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#14b8a6"];

export async function loadImprovementCenter(admin: Admin, hospitalId: string): Promise<ImprovementCenter> {
  const today = new Date().toISOString().slice(0, 10);
  const noRows = Promise.resolve({ data: [] as never[] });

  const [{ data: capa }, { data: audits }] = await Promise.all([
    hospitalId ? admin.from("capa_actions").select("title, status, priority, due_date, audit_id, created_at, closed_at").eq("hospital_id", hospitalId).limit(1000) : noRows,
    hospitalId ? admin.from("audits").select("area, items_not_met").eq("hospital_id", hospitalId).limit(2000) : noRows,
  ]);
  let riskFlags: Awaited<ReturnType<typeof computeRiskFlags>> = [];
  try { riskFlags = await computeRiskFlags(admin, hospitalId); } catch { /* fail-soft */ }

  const ca = (capa ?? []) as { title: string; status: string; priority: string | null; due_date: string | null; audit_id: string | null; closed_at: string | null }[];
  const au = (audits ?? []) as { area: string | null; items_not_met: number | null }[];

  // ── CAPA ──
  const open = ca.filter(c => !CLOSED.has(c.status)).length;
  const verified = ca.filter(c => c.status === "verified" || c.status === "closed").length;
  const critical = ca.filter(c => c.priority === "high" || c.priority === "critical").length;
  const overdue = ca.filter(c => c.due_date && c.due_date < today && !CLOSED.has(c.status)).length;
  const completed = ca.filter(c => CLOSED.has(c.status)).length;
  const closureRate = ca.length ? Math.round((completed / ca.length) * 100) : null;
  const statusMap = new Map<string, number>();
  for (const c of ca) statusMap.set(c.status, (statusMap.get(c.status) ?? 0) + 1);
  const STATUS_COLORS: Record<string, string> = { open: "#ef4444", in_progress: "#f59e0b", investigation: "#3b82f6", implementation: "#8b5cf6", completed: "#22c55e", closed: "#22c55e", verified: "#10b981" };
  const sevMap = new Map<string, number>();
  for (const c of ca) sevMap.set(c.priority ?? "unset", (sevMap.get(c.priority ?? "unset") ?? 0) + 1);
  const PRIO_COLORS: Record<string, string> = { critical: "#ef4444", high: "#f59e0b", medium: "#eab308", low: "#22c55e", unset: "#cbd5e1" };
  const srcMap = new Map<string, number>();
  for (const c of ca) srcMap.set(c.audit_id ? "Audit Finding" : "Programme Improvement", (srcMap.get(c.audit_id ? "Audit Finding" : "Programme Improvement") ?? 0) + 1);

  // ── Educational Risks (from live risk flags + audit findings) ──
  type RiskItem = { name: string; category: string; severity: "Critical" | "High" | "Medium" | "Low"; owner: string };
  const items: RiskItem[] = [];
  for (const r of riskFlags) for (const f of r.flags) items.push({ name: r.nurseName, category: CAT_OF[f.type] ?? "Other", severity: SEV_OF[f.type] ?? "Medium", owner: r.nurseName });
  // audit non-compliant items as compliance risks (one per audit area with unmet items)
  for (const a of au) if ((a.items_not_met ?? 0) > 0) items.push({ name: a.area ?? "Compliance", category: "Compliance", severity: "High", owner: "Quality" });

  const levelCounts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const it of items) levelCounts[it.severity]++;
  const catMap = new Map<string, number>();
  for (const it of items) catMap.set(it.category, (catMap.get(it.category) ?? 0) + 1);
  // aggregate top risks per learner
  const byLearner = new Map<string, { category: string; severity: RiskItem["severity"]; flags: number; owner: string }>();
  for (const it of items) {
    const cur = byLearner.get(it.name) ?? { category: it.category, severity: it.severity, flags: 0, owner: it.owner };
    cur.flags++;
    const rank = { Critical: 3, High: 2, Medium: 1, Low: 0 };
    if (rank[it.severity] > rank[cur.severity]) { cur.severity = it.severity; cur.category = it.category; }
    byLearner.set(it.name, cur);
  }
  const topRisks: RiskRow[] = [...byLearner.entries()].map(([name, r]) => ({ name, category: r.category, severity: r.severity, owner: r.owner, flags: r.flags }))
    .sort((a, b) => ({ Critical: 3, High: 2, Medium: 1, Low: 0 })[b.severity] - ({ Critical: 3, High: 2, Medium: 1, Low: 0 })[a.severity] || b.flags - a.flags).slice(0, 8);

  return {
    exec: {
      activePlans: null, openCapas: open, criticalRisks: levelCounts.Critical,
      overdueActions: overdue, completionRate: closureRate, effectiveness: null, riskReduction: null,
      overallScore: closureRate !== null ? Math.max(0, Math.round(closureRate - levelCounts.Critical * 5)) : null,
    },
    plans: { note: "No improvement-plan store exists yet. The guided plan builder (SMART objectives, milestones, action register, effectiveness verification) is on the roadmap. Corrective actions are tracked live under CAPA." },
    capa: {
      cards: { total: ca.length, critical, overdue, open, verified },
      byStatus: [...statusMap.entries()].map(([label, n]) => ({ label: label.replace(/_/g, " "), n, color: STATUS_COLORS[label] ?? "#9ca3af" })),
      bySeverity: [...sevMap.entries()].map(([label, n]) => ({ label, n, color: PRIO_COLORS[label] ?? "#9ca3af" })),
      bySource: [...srcMap.entries()].map(([label, n]) => ({ label, n })),
      recent: ca.slice(0, 8).map(c => ({ title: c.title, program: "—", severity: c.priority ?? "—", status: c.status, due: c.due_date })),
      closureRate,
    },
    risks: {
      cards: { critical: levelCounts.Critical, high: levelCounts.High, medium: levelCounts.Medium, low: levelCounts.Low, total: items.length },
      byCategory: [...catMap.entries()].map(([label, n], i) => ({ label, n, color: CAT_COLORS[i % CAT_COLORS.length] })),
      bySeverity: (["Critical", "High", "Medium", "Low"] as const).map(label => ({ label, n: levelCounts[label], color: SEV_COLOR[label] })),
      top: topRisks,
      note: "Risks are derived live from competency decisions (critical failures, not-yet-competent, expired) and audit findings. A configurable 5×5 impact×likelihood register with residual-risk scoring, KRIs and treatment tracking is on the roadmap.",
    },
  };
}
