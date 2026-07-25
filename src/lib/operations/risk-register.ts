// Enterprise Risk Register (UMG-QS-006) — the Unit Manager's risk oversight, aligned to the detailed spec.
// Consolidation over the enterprise 5×5 register (gov_risks + gov_controls, migration 060), scoped to the
// manager's hospital PLUS platform-wide risks (hospital_id null); no store forked, no migration. Real: the
// KPI ribbon (risk exposure / high-&-extreme / under-treatment / overdue-treatment / controls-effectiveness /
// due-for-review / emerging), the residual 5×5 heat map, category distribution, top-10 by residual with a
// residual-vs-inherent trend, treatment-plan status (from the risk status + review date), controls
// effectiveness by type, reviews-due, emerging (recently created), escalated, recent updates and AI insights.
// Bands (gov-risk.band): 1–4 low · 5–9 medium · 10–15 high · 16–25 critical/extreme. Honest next-phase (spec
// §8 entities with no store): per-risk SCORE trend graphs + "Risks Trending Up" (no RiskHistory), Risks by
// Department (gov_risks has no department — grouped by category), "Escalated To" (no Escalation record) and
// treatment-task progress (no TreatmentPlan/Task store). Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { band } from "@/lib/super-admin/gov-risk";

const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const CAT_LABEL = (c: string) => (c ?? "operational").replace(/_/g, " ");
const CAT_COLOR: Record<string, string> = { clinical: "#10b981", workforce: "#3b82f6", operational: "#8b5cf6", patient_safety: "#f59e0b", clinical_safety: "#f59e0b", compliance: "#6b7280", financial: "#ef4444", technology: "#06b6d4", cybersecurity: "#06b6d4", infrastructure: "#a855f7", regulatory: "#94a3b8", strategic: "#ec4899", legal: "#64748b", reputation: "#f43f5e", data_protection: "#0ea5e9", ai: "#d946ef", business_continuity: "#f97316", third_party: "#84cc16" };
const catColor = (c: string, i: number) => CAT_COLOR[c] ?? ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7", "#ec4899"][i % 8];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const monthKey = (iso: string) => String(iso ?? "").slice(0, 7);
const riskId = (r: any) => `RISK-${String(r.created_at ?? "").slice(0, 4) || "20XX"}-${String(r.id ?? "").replace(/-/g, "").slice(0, 4).toUpperCase()}`;
const exposureBand = (p: number) => (p >= 75 ? "Extreme" : p >= 55 ? "High" : p >= 30 ? "Moderate" : "Low");

export async function loadRiskRegister(admin: any, hid: string | null, isSuper: boolean) {
  const T = new Date(), today = T.toISOString().slice(0, 10);
  const riskSel = admin.from("gov_risks").select("id, title, category, likelihood, impact, residual_likelihood, residual_impact, treatment, status, owner_name, mitigation, review_date, created_at, updated_at").neq("status", "closed");
  const ctrlSel = admin.from("gov_controls").select("id, name, control_type, effectiveness, risk_id");
  const closedSel = admin.from("gov_risks").select("id", { count: "exact", head: true }).eq("status", "closed");
  const [riskRes, ctrlRes, closedRes] = await Promise.all([
    (isSuper ? riskSel : riskSel.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`)).limit(3000),
    (isSuper ? ctrlSel : ctrlSel.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`)).limit(3000),
    (isSuper ? closedSel : closedSel.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`)),
  ]);
  if (riskRes.error && missing(riskRes.error)) return { provisioned: false as const };
  const rows = (riskRes.error ? [] : riskRes.data ?? []) as any[];
  const controls = (ctrlRes.error ? [] : ctrlRes.data ?? []) as any[];
  const closedCount = closedRes.error ? 0 : (closedRes.count ?? 0);

  const scored = rows.map(r => {
    const inherent = (r.likelihood ?? 3) * (r.impact ?? 3);
    const rL = r.residual_likelihood ?? r.likelihood ?? 3, rI = r.residual_impact ?? r.impact ?? 3;
    const residual = rL * rI;
    return { ...r, inherent, residual, rL, rI, band: band(residual), reviewOverdue: !!(r.review_date && r.review_date < today), trend: residual < inherent ? "down" : residual > inherent ? "up" : "flat" };
  });

  // ── 5×5 residual heat map ─────────────────────────────────────────────────────────────────────
  const heat: Record<string, number> = {};
  scored.forEach(r => { const key = `${Math.max(1, Math.min(5, r.rL))}-${Math.max(1, Math.min(5, r.rI))}`; heat[key] = (heat[key] ?? 0) + 1; });

  // ── KPIs ──────────────────────────────────────────────────────────────────────────────────────
  const exposurePct = scored.length ? Math.round((mean(scored.map(r => r.residual))! / 25) * 100) : null;
  const highExtreme = scored.filter(r => r.residual >= 10).length;
  const extreme = scored.filter(r => r.band === "critical").length;
  const underTreatment = scored.filter(r => r.status === "mitigating").length;
  const overdueTreatment = scored.filter(r => (r.status === "mitigating" && r.reviewOverdue) || r.status === "escalated").length;
  const d30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const dueForReview = scored.filter(r => r.review_date && r.review_date <= d30).length;
  const created30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const emerging = scored.filter(r => r.created_at && r.created_at >= created30).length;
  const controlsTotal = controls.length;
  const controlsEffective = controls.filter(c => c.effectiveness === "effective").length;
  const controlsEffectiveness = controlsTotal ? Math.round((controlsEffective / controlsTotal) * 100) : null;

  // Total-risks volume sparkline (created per month, real).
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(T.getFullYear(), T.getMonth() - i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); }
  const totalSpark = months.map(m => scored.filter(r => monthKey(r.created_at) === m).length);

  const kpis = {
    exposurePct, exposureBand: exposurePct != null ? exposureBand(exposurePct) : "—",
    total: rows.length, highExtreme, extreme, high: scored.filter(r => r.band === "high").length,
    underTreatment, overdueTreatment, controlsEffectiveness, dueForReview, emerging,
    totalSpark,
  };

  // ── Top 10 by residual ────────────────────────────────────────────────────────────────────────
  const top10 = [...scored].sort((a, b) => b.residual - a.residual).slice(0, 10).map(r => ({ id: riskId(r), title: r.title, category: CAT_LABEL(r.category), residual: r.residual, inherent: r.inherent, trend: r.trend, level: r.band === "critical" ? "Extreme" : r.band === "high" ? "High" : r.band === "medium" ? "Moderate" : "Low" }));

  // ── Category distribution ─────────────────────────────────────────────────────────────────────
  const catMap = new Map<string, number>();
  scored.forEach(r => catMap.set(r.category ?? "operational", (catMap.get(r.category ?? "operational") ?? 0) + 1));
  const categoryDist = [...catMap.entries()].map(([cat, n], i) => ({ key: cat, label: CAT_LABEL(cat) + " Risks", n, pct: rows.length ? Math.round((n / rows.length) * 100) : 0, color: catColor(cat, i) })).sort((a, b) => b.n - a.n);

  // ── Treatment-plan status (closed = completed treatment; the rest from open status + review date)
  const treatmentStatus = [
    { label: "Completed", key: "completed", n: closedCount, color: "#10b981" },
    { label: "In Progress", key: "in_progress", n: scored.filter(r => r.status === "mitigating" && !r.reviewOverdue).length, color: "#3b82f6" },
    { label: "Overdue", key: "overdue", n: scored.filter(r => (r.status === "mitigating" && r.reviewOverdue) || r.status === "escalated").length, color: "#ef4444" },
    { label: "Not Started", key: "not_started", n: scored.filter(r => r.status === "open").length, color: "#f59e0b" },
    { label: "Accepted", key: "accepted", n: scored.filter(r => r.status === "accepted").length, color: "#94a3b8" },
  ].filter(s => s.n > 0);
  const treatmentTotal = closedCount + scored.length;
  const treatmentProgress = treatmentTotal ? Math.round(((closedCount + scored.filter(r => ["mitigating", "accepted"].includes(r.status)).length) / treatmentTotal) * 100) : null;

  // ── Controls effectiveness by type ────────────────────────────────────────────────────────────
  const controlsByType = ["preventive", "detective", "corrective"].map(t => { const cs = controls.filter(c => c.control_type === t); return { type: t[0].toUpperCase() + t.slice(1) + " Controls", total: cs.length, effective: cs.filter(c => c.effectiveness === "effective").length, pct: cs.length ? Math.round((cs.filter(c => c.effectiveness === "effective").length / cs.length) * 100) : null }; }).filter(x => x.total > 0);

  // ── Reviews due · emerging · escalated · recent updates ───────────────────────────────────────
  const dueForReviewList = scored.filter(r => r.review_date).sort((a, b) => String(a.review_date).localeCompare(String(b.review_date))).slice(0, 6)
    .map(r => ({ id: riskId(r), title: r.title, reviewDue: r.review_date, daysLeft: Math.round((new Date(r.review_date).getTime() - Date.now()) / 864e5) }));
  const emergingList = [...scored].filter(r => r.created_at && r.created_at >= created30).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 6)
    .map(r => ({ id: riskId(r), title: r.title, level: r.band === "critical" ? "Extreme" : r.band === "high" ? "High" : r.band === "medium" ? "Medium" : "Low", at: (r.created_at ?? "").slice(0, 10) }));
  const escalatedList = scored.filter(r => r.status === "escalated").slice(0, 6).map(r => ({ id: riskId(r), title: r.title, category: CAT_LABEL(r.category), owner: r.owner_name, at: (r.updated_at ?? "").slice(0, 10) }));
  const recentUpdates = [...scored].sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""))).slice(0, 6)
    .map(r => ({ id: riskId(r), title: r.title, category: CAT_LABEL(r.category), owner: r.owner_name, status: r.status, residual: r.residual, band: r.band, reviewDate: r.review_date }));

  // ── AI risk intelligence (rule-based) ─────────────────────────────────────────────────────────
  const ai: { text: string; detail: string; confidence: number; tone: string }[] = [];
  if (extreme) ai.push({ text: `${extreme} extreme risk(s) require immediate escalation`, detail: "Residual score ≥ 16 on the 5×5 register", confidence: 88, tone: "rose" });
  const topCat = categoryDist[0];
  if (topCat && topCat.n >= 3) ai.push({ text: `${topCat.label} concentration: ${topCat.n} risk(s) (${topCat.pct}%)`, detail: "Highest risk-category concentration", confidence: 76, tone: "amber" });
  if (kpis.dueForReview) ai.push({ text: `${kpis.dueForReview} risk review(s) due within 30 days`, detail: "Overdue reviews weaken assurance", confidence: 80, tone: "sky" });
  if (controlsEffectiveness != null && controlsEffectiveness < 75) ai.push({ text: `Controls effectiveness at ${controlsEffectiveness}% — below target`, detail: `${controls.filter(c => c.effectiveness === "ineffective").length} ineffective control(s)`, confidence: 72, tone: "amber" });
  if (emerging) ai.push({ text: `${emerging} emerging risk(s) newly identified this month`, detail: "Recently registered — assess and treat", confidence: 70, tone: "emerald" });

  return {
    provisioned: true as const, hasData: rows.length > 0,
    kpis, heat, top10, categoryDist, treatmentStatus, treatmentProgress, controlsByType,
    controlsEffectiveness, controlsTotal, dueForReviewList, emergingList, escalatedList, recentUpdates, ai,
  };
}
