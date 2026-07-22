// Risk & Internal Controls (GOV-001.4) loader — the 5×5 enterprise risk
// register + controls library (migration 060). Platform-wide, fail-soft with
// honest banners until the migration runs. Inherent score = likelihood×impact;
// residual uses the residual pair when scored, else falls back to inherent.
// Bands: 1–4 low · 5–9 medium · 10–15 high · 16–25 critical. The heat map is
// the real register bucketed by (likelihood, impact) — nothing synthetic.
/* eslint-disable @typescript-eslint/no-explicit-any */

const bucket = (rows: any[], key: string) => { const m: Record<string, number> = {}; for (const r of rows) { const k = r[key] ?? "unknown"; m[k] = (m[k] ?? 0) + 1; } return m; };

export const band = (score: number) => (score >= 16 ? "critical" : score >= 10 ? "high" : score >= 5 ? "medium" : "low");

export async function loadRiskControls(admin: any) {
  const todayStr = new Date().toISOString().slice(0, 10);

  const [riskRows, controlRows, hospitals] = await Promise.all([
    admin.from("gov_risks").select("id, title, category, status, treatment, likelihood, impact, residual_likelihood, residual_impact, review_date, hospital_id, owner_name, created_at").order("created_at", { ascending: false }).limit(2000),
    admin.from("gov_controls").select("id, name, control_type, frequency, effectiveness, last_tested, risk_id, hospital_id, created_at").order("created_at", { ascending: false }).limit(2000),
    admin.from("hospitals").select("id, name").limit(2000),
  ]);

  const ready = !riskRows.error;
  const controlsReady = !controlRows.error;
  const risks = (ready ? riskRows.data ?? [] : []) as any[];
  const controls = (controlsReady ? controlRows.data ?? [] : []) as any[];
  const hospName = new Map<string, string>((hospitals.error ? [] : hospitals.data ?? []).map((h: any) => [h.id, h.name]));

  const open = risks.filter(r => r.status !== "closed");
  const scored = open.map(r => {
    const inherent = (r.likelihood ?? 3) * (r.impact ?? 3);
    const residual = r.residual_likelihood && r.residual_impact ? r.residual_likelihood * r.residual_impact : null;
    return { ...r, inherent, residual, band: band(residual ?? inherent) };
  });

  const byBand = bucket(scored, "band");
  const overdueReviews = open.filter(r => r.review_date && r.review_date < todayStr).length;

  // 5×5 heat map — cells keyed "likelihood-impact" with open-risk counts.
  const heat: Record<string, number> = {};
  for (const r of open) heat[`${r.likelihood ?? 3}-${r.impact ?? 3}`] = (heat[`${r.likelihood ?? 3}-${r.impact ?? 3}`] ?? 0) + 1;

  const topRisks = scored.sort((a, b) => (b.residual ?? b.inherent) - (a.residual ?? a.inherent)).slice(0, 6).map(r => ({
    id: r.id, title: r.title, category: r.category, status: r.status, treatment: r.treatment,
    inherent: r.inherent, residual: r.residual, band: r.band,
    scope: r.hospital_id ? (hospName.get(r.hospital_id) ?? "Tenant") : "Platform-wide",
    overdue: !!(r.review_date && r.review_date < todayStr),
  }));

  const effectiveness = bucket(controls, "effectiveness");
  const controlList = controls.slice(0, 6).map(ct => ({
    id: ct.id, name: ct.name, type: ct.control_type, frequency: ct.frequency,
    effectiveness: ct.effectiveness, lastTested: ct.last_tested,
    linkedRisk: ct.risk_id ? (risks.find(r => r.id === ct.risk_id)?.title ?? "—") : null,
  }));

  return {
    ready, controlsReady,
    kpis: {
      total: ready ? risks.length : null,
      critical: ready ? byBand.critical ?? 0 : null,
      high: ready ? byBand.high ?? 0 : null,
      medium: ready ? byBand.medium ?? 0 : null,
      low: ready ? byBand.low ?? 0 : null,
      overdueReviews: ready ? overdueReviews : null,
    },
    heat,
    openCount: open.length,
    closedCount: risks.length - open.length,
    byCategory: Object.entries(bucket(open, "category")).map(([category, n]) => ({ category, n })).sort((a, b) => (b.n as number) - (a.n as number)).slice(0, 8),
    byTreatment: bucket(open, "treatment"),
    topRisks,
    controls: {
      total: controlsReady ? controls.length : null,
      effectiveness,
      notTested: effectiveness.not_tested ?? 0,
      byType: bucket(controls, "control_type"),
      list: controlList,
    },
    pickers: {
      risks: open.slice(0, 500).map(r => ({ id: r.id, label: `${r.title} (${r.likelihood ?? 3}×${r.impact ?? 3})` })),
      controls: controls.slice(0, 500).map(ct => ({ id: ct.id, label: `${ct.name} (${String(ct.effectiveness).replace(/_/g, " ")})` })),
    },
    generatedAt: new Date().toISOString(),
  };
}
