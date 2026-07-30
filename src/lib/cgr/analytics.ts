/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-016 — Competency Governance Analytics, Metrics & Continuous Improvement.
// "Is our governance system improving over time, and where should leaders focus?" Adds the two things the
// point-in-time CGR-006 dashboard lacks, both from real data:
//   • Governance TREND (§4.4/§6) — competency_readiness_snapshots (mig 088): readiness_score + compliance_score +
//     at_risk_units + expiring_30 over snapshot_date, aggregated enterprise-wide → a real time series.
//   • Continuous-improvement ENGINE (§8) — the registry gaps turned into ranked improvement opportunities
//     (assign owners / clear overdue reviews / map standards / attach evidence / govern the ungoverned) with
//     count, impact and the governance lever each one moves.
// Plus current metrics + maturity (§7) and a governance-activity leading indicator (audit volume Δ). No migration.

import { loadGovernanceRegistry } from "@/lib/cgr/registry";

type Admin = any;
const DAY = 86400000;
const MATURITY = [
  { min: 85, num: 5, label: "Predictive" },
  { min: 70, num: 4, label: "Integrated" },
  { min: 55, num: 3, label: "Managed" },
  { min: 35, num: 2, label: "Structured" },
  { min: 0, num: 1, label: "Reactive" },
];
const IMPACT_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export async function loadGovernanceAnalytics(admin: Admin) {
  const [reg, snapRes, auditRes] = await Promise.all([
    loadGovernanceRegistry(admin).catch(() => ({ provisioned: false } as any)),
    admin.from("competency_readiness_snapshots").select("snapshot_date, readiness_score, compliance_score, at_risk_units, expiring_30").order("snapshot_date", { ascending: false }).limit(500),
    admin.from("audit_log").select("created_at").order("created_at", { ascending: false }).limit(3000),
  ]);

  const r: any = reg?.provisioned ? reg : null;
  const recs: any[] = r ? r.records : [];
  const states = r ? r.states : { ungoverned: 0, at_risk: 0 };

  // Governance trend — aggregate snapshots per date across the enterprise.
  const snaps = (snapRes.error ? [] : snapRes.data ?? []) as any[];
  const byDate = new Map<string, { rs: number; cs: number; ar: number; ex: number; n: number }>();
  for (const s of snaps) {
    const e = byDate.get(s.snapshot_date) ?? { rs: 0, cs: 0, ar: 0, ex: 0, n: 0 };
    e.rs += s.readiness_score ?? 0;
    e.cs += s.compliance_score ?? 0;
    e.ar += s.at_risk_units ?? 0;
    e.ex += s.expiring_30 ?? 0;
    e.n++;
    byDate.set(s.snapshot_date, e);
  }
  const trend = [...byDate.entries()]
    .map(([date, e]) => ({ date, readiness: Math.round(e.rs / e.n), compliance: Math.round(e.cs / e.n), atRisk: e.ar, expiring: e.ex }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-12);
  const complianceDelta = trend.length >= 2 ? trend[trend.length - 1].compliance - trend[0].compliance : null;
  const readinessDelta = trend.length >= 2 ? trend[trend.length - 1].readiness - trend[0].readiness : null;

  const assurance = r ? r.kpis.avgScore : null;
  const maturity = assurance != null ? MATURITY.find((m) => assurance >= m.min)! : null;

  // Continuous-improvement opportunities from the registry gaps.
  const opps: any[] = [];
  if (r) {
    const unownedHigh = recs.filter((x) => !x.owner && (x.risk === "high" || x.risk === "critical")).length;
    const overdue = r.kpis.overdue;
    const unmapped = recs.filter((x) => x.standards === 0).length;
    const noEvidence = recs.filter((x) => x.decisions === 0).length;
    if (unownedHigh) opps.push({ action: "Assign accountable owners to high/critical-risk competencies", count: unownedHigh, impact: "high", lever: "Ownership" });
    if (states.ungoverned) opps.push({ action: "Bring ungoverned competencies under governance", count: states.ungoverned, impact: "high", lever: "Governance" });
    if (overdue) opps.push({ action: "Clear overdue competency reviews", count: overdue, impact: "high", lever: "Review currency" });
    if (unmapped) opps.push({ action: "Map competencies to regulatory standards", count: unmapped, impact: "medium", lever: "Regulatory" });
    if (noEvidence) opps.push({ action: "Attach supporting evidence / decisions", count: noEvidence, impact: "medium", lever: "Evidence" });
    opps.sort((a, b) => (IMPACT_RANK[a.impact] ?? 9) - (IMPACT_RANK[b.impact] ?? 9) || b.count - a.count);
  }

  // Governance activity leading indicator — audit volume last 30d vs prior 30d.
  const audit = (auditRes.error ? [] : auditRes.data ?? []) as any[];
  const now = Date.now();
  const last30 = audit.filter((a) => now - new Date(a.created_at).getTime() <= 30 * DAY).length;
  const prev30 = audit.filter((a) => { const t = now - new Date(a.created_at).getTime(); return t > 30 * DAY && t <= 60 * DAY; }).length;

  return {
    provisioned: !!r || trend.length > 0,
    hasRegistry: !!r,
    trend,
    complianceDelta,
    readinessDelta,
    maturity,
    maturityModel: MATURITY,
    opportunities: opps.slice(0, 6),
    metrics: r
      ? { assurance, regulatory: r.kpis.standardsPct, evidence: r.kpis.evidencePct, ownership: r.kpis.ownerPct, overdue: r.kpis.overdue, atRisk: states.at_risk + states.ungoverned, highRisk: r.kpis.highRisk }
      : null,
    activity: { last30, prev30, delta: last30 - prev30 },
  };
}
