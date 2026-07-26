// QAW-004 Enterprise Risk Management Centre — ISO 31000 risk register, heat map, controls.
// Grounded in gov_risks + gov_controls (migration 060). 6-month high-risk trend from the daily
// quality_score_snapshots (091). KRIs have no store yet → reported honestly as next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NONE } from "@/app/quality-accreditation/_ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// score band → tone
export const band = (score: number) => (score >= 15 ? "rose" : score >= 10 ? "amber" : score >= 5 ? "blue" : "emerald");
const bandLabel = (score: number) => (score >= 15 ? "Extreme" : score >= 10 ? "High" : score >= 5 ? "Medium" : "Low");
const CAT_TONE = ["emerald", "teal", "blue", "indigo", "violet", "amber", "rose", "slate"];

export async function loadRiskCentre(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  const { data: riskRows, error } = await scope(admin.from("gov_risks").select("id, title, description, category, owner_name, likelihood, impact, residual_likelihood, residual_impact, treatment, status, mitigation, review_date, created_at").limit(4000));
  if (error) return { provisioned: false as const };
  const risks = (riskRows ?? []) as any[];
  const { data: ctrlRows } = await scope(admin.from("gov_controls").select("id, name, control_type, effectiveness, risk_id, owner_name, last_tested").limit(4000));
  const controls = (ctrlRows ?? []) as any[];

  const score = (r: any) => Number(r.likelihood || 0) * Number(r.impact || 0);
  const residual = (r: any) => (r.residual_likelihood && r.residual_impact) ? Number(r.residual_likelihood) * Number(r.residual_impact) : score(r);
  const open = risks.filter(r => r.status !== "closed");

  // Bands (by inherent score).
  const bands = { extreme: 0, high: 0, medium: 0, low: 0 };
  risks.forEach(r => { const s = score(r); if (s >= 15) bands.extreme++; else if (s >= 10) bands.high++; else if (s >= 5) bands.medium++; else bands.low++; });

  // 5×5 heat map: rows = likelihood 5→1, cols = impact 1→5.
  const heat: { likelihood: number; cells: { impact: number; count: number; tone: string }[] }[] = [];
  for (let l = 5; l >= 1; l--) {
    const cells = [];
    for (let im = 1; im <= 5; im++) {
      const count = risks.filter(r => Number(r.likelihood) === l && Number(r.impact) === im).length;
      cells.push({ impact: im, count, tone: band(l * im) });
    }
    heat.push({ likelihood: l, cells });
  }

  // By category.
  const catMap = new Map<string, number>();
  risks.forEach(r => catMap.set(r.category, (catMap.get(r.category) ?? 0) + 1));
  const byCategory = [...catMap.entries()].sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({ label: label.replace(/_/g, " "), value, tone: CAT_TONE[i % CAT_TONE.length] }));

  // Top risks (by inherent score).
  const topRisks = [...risks].sort((a, b) => score(b) - score(a)).slice(0, 6).map(r => ({
    title: r.title, category: (r.category || "").replace(/_/g, " "), score: score(r), residual: residual(r),
    status: r.status, tone: band(score(r)), lower: residual(r) < score(r),
  }));

  // Risk status distribution.
  const statusDonut = ["open", "mitigating", "accepted", "escalated", "closed"].map((s, i) => ({ label: s[0].toUpperCase() + s.slice(1), value: risks.filter(r => r.status === s).length, tone: ["amber", "blue", "emerald", "rose", "slate"][i] }));

  // Treatment strategy split.
  const treatmentSplit = ["reduce", "monitor", "accept", "transfer", "avoid", "escalate"].map(t => ({ label: t[0].toUpperCase() + t.slice(1), value: risks.filter(r => r.treatment === t).length })).filter(x => x.value > 0);

  // Controls.
  const riskWithCtrl = new Set(controls.map(c => c.risk_id).filter(Boolean));
  const ctrlEff = ["effective", "partially_effective", "ineffective", "not_tested"].map((e, i) => ({ label: e.replace(/_/g, " "), value: controls.filter(c => c.effectiveness === e).length, tone: ["emerald", "amber", "rose", "slate"][i] }));

  // 6-month high-risk trend from quality_score_snapshots.
  let trend: { label: string; value: number }[] = [];
  try {
    const { data: snaps } = await scope(admin.from("quality_score_snapshots").select("snapshot_date, high_risks").order("snapshot_date", { ascending: false }).limit(180));
    const rows = (snaps ?? []) as any[];
    const byMonth = new Map<string, number>();
    rows.forEach(s => { const k = String(s.snapshot_date).slice(0, 7); if (!byMonth.has(k)) byMonth.set(k, Number(s.high_risks || 0)); });
    trend = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-6).map(([k, v]) => ({ label: MONTHS[Number(k.slice(5, 7)) - 1], value: v }));
  } catch { /* snapshots optional */ }

  return {
    provisioned: true as const,
    kpis: {
      total: risks.length, extreme: bands.extreme, high: bands.high, medium: bands.medium, low: bands.low,
      openTreatment: open.filter(r => ["open", "mitigating", "escalated"].includes(r.status)).length,
      controlled: risks.length ? Math.round(([...riskWithCtrl].length / risks.length) * 100) : 0,
      controls: controls.length,
    },
    heat, byCategory, topRisks, statusDonut, treatmentSplit, ctrlEff, trend,
    bandLegend: [{ label: "Extreme", value: bands.extreme, tone: "rose" }, { label: "High", value: bands.high, tone: "amber" }, { label: "Medium", value: bands.medium, tone: "blue" }, { label: "Low", value: bands.low, tone: "emerald" }],
    bandLabelOf: bandLabel,
  };
}
