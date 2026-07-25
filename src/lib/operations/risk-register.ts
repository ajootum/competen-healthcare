// Enterprise Risk Register (UMG-QS-006) — the Unit Manager's lens over the enterprise 5×5 risk register
// (gov_risks + gov_controls, migration 060). Scoped to the manager's hospital PLUS platform-wide risks
// (hospital_id null). Real: KPIs (open / high & critical / review-overdue / controls), the 5×5 inherent-risk
// heat map, risk-by-category, the register ranked by residual (else inherent) score, and the controls-library
// summary. Bands (via gov-risk.band): 1–4 low · 5–9 medium · 10–15 high · 16–25 critical. Risks are
// registered/treated in the Governance & Compliance risk workspace (audited); this is the manager surface.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { band } from "@/lib/super-admin/gov-risk";

const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const CAT_LABEL = (c: string) => (c ?? "operational").replace(/_/g, " ");

export async function loadRiskRegister(admin: any, hid: string | null, isSuper: boolean) {
  const T = new Date().toISOString().slice(0, 10);
  const riskSel = admin.from("gov_risks").select("id, title, category, likelihood, impact, residual_likelihood, residual_impact, treatment, status, owner_name, mitigation, review_date").neq("status", "closed");
  const ctrlSel = admin.from("gov_controls").select("id, name, control_type, effectiveness, risk_id");
  const [riskRes, ctrlRes] = await Promise.all([
    (isSuper ? riskSel : riskSel.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`)).limit(3000),
    (isSuper ? ctrlSel : ctrlSel.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`)).limit(3000),
  ]);
  if (riskRes.error && missing(riskRes.error)) return { provisioned: false as const };
  const rows = (riskRes.error ? [] : riskRes.data ?? []) as any[];
  const controls = (ctrlRes.error ? [] : ctrlRes.data ?? []) as any[];

  const scored = rows.map(r => {
    const inherent = (r.likelihood ?? 3) * (r.impact ?? 3);
    const residual = (r.residual_likelihood != null && r.residual_impact != null) ? r.residual_likelihood * r.residual_impact : null;
    return { ...r, inherent, residual, score: residual ?? inherent, band: band(residual ?? inherent) };
  });

  const kpis = {
    total: rows.length,
    critical: scored.filter(r => r.band === "critical").length,
    high: scored.filter(r => r.band === "high").length,
    highOrCritical: scored.filter(r => r.score >= 15).length,
    mitigating: rows.filter(r => r.status === "mitigating").length,
    escalated: rows.filter(r => r.status === "escalated").length,
    reviewOverdue: rows.filter(r => r.review_date && r.review_date < T).length,
    controls: controls.length,
  };

  // 5×5 inherent heat map (count by likelihood × impact).
  const heat: Record<string, number> = {};
  scored.forEach(r => { const key = `${Math.max(1, Math.min(5, r.likelihood ?? 3))}-${Math.max(1, Math.min(5, r.impact ?? 3))}`; heat[key] = (heat[key] ?? 0) + 1; });

  // By category — count + peak score.
  const catMap = new Map<string, { n: number; peak: number }>();
  scored.forEach(r => { const c = CAT_LABEL(r.category); const g = catMap.get(c) ?? { n: 0, peak: 0 }; g.n++; g.peak = Math.max(g.peak, r.score); catMap.set(c, g); });
  const byCategory = [...catMap.entries()].map(([name, g]) => ({ name, n: g.n, peak: g.peak })).sort((a, b) => b.peak - a.peak || b.n - a.n).slice(0, 8);

  // Register ranked by score.
  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const register = [...scored].sort((a, b) => (rank[a.band] - rank[b.band]) || (b.score - a.score)).slice(0, 12)
    .map(r => ({ title: r.title, category: CAT_LABEL(r.category), likelihood: r.likelihood ?? 3, impact: r.impact ?? 3, inherent: r.inherent, residual: r.residual, score: r.score, band: r.band, treatment: r.treatment, status: r.status, owner: r.owner_name, reviewOverdue: !!(r.review_date && r.review_date < T) }));

  // Controls library summary.
  const ctrlSummary = {
    total: controls.length,
    effective: controls.filter(c => c.effectiveness === "effective").length,
    partial: controls.filter(c => c.effectiveness === "partially_effective").length,
    ineffective: controls.filter(c => c.effectiveness === "ineffective").length,
    notTested: controls.filter(c => c.effectiveness === "not_tested").length,
    linked: new Set(controls.filter(c => c.risk_id).map(c => c.risk_id)).size,
  };

  return { provisioned: true as const, hasData: rows.length > 0, kpis, heat, byCategory, register, controls: ctrlSummary };
}
