/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-006 — Competency Governance Dashboard & Intelligence Workspace.
// Role-based governance intelligence. It COMPOSES the CGR-001 registry (loadGovernanceRegistry) into the four
// dashboard components the spec asks for — all from real facts, nothing fabricated:
//   • Competency Assurance Score (§6.1) — the registry completeness composite, broken into its contributing
//     dimensions (ownership / regulatory alignment / evidence / review compliance) for explainability.
//   • Organisational maturity (§7) — the assurance score mapped to the 5-level model (Reactive → Predictive).
//   • Regulatory Readiness (§6.2) — competency_standard_mappings grouped by standard BODY (JCI/WHO/…) with
//     coverage breakdown. (New signal — the registry only counts mappings per competency, not per body.)
//   • Competency Risk (§6.3) — high-risk / unowned / no-evidence / overdue, from the registry states.
//   • Governance Performance (§6.4) — change_requests throughput + competency_decision validation rate +
//     active governance committees. (New signal — real governance activity.)
//   • Domain portfolio — per clinical domain governance score (the Nursing Director portfolio lens, §5.1).
// No migration — a rollup over the same governance spine CGR-001 reads.

import { loadGovernanceRegistry } from "@/lib/cgr/registry";

type Admin = any;

const MATURITY = [
  { min: 85, num: 5, label: "Predictive", desc: "AI-supported competency assurance." },
  { min: 70, num: 4, label: "Optimised", desc: "Data-driven improvement." },
  { min: 55, num: 3, label: "Managed", desc: "Competency processes monitored." },
  { min: 35, num: 2, label: "Defined", desc: "Basic competency structures established." },
  { min: 0, num: 1, label: "Reactive", desc: "Limited governance and visibility." },
];
const maturityOf = (s: number) => MATURITY.find((m) => s >= m.min)!;

const cnt = (q: any) => Promise.resolve(q).then((r: any) => (r.error ? 0 : r.count ?? 0)).catch(() => 0);

export async function loadGovernanceDashboard(admin: Admin) {
  const reg = await loadGovernanceRegistry(admin);
  if (!reg.provisioned) return { provisioned: false as const };

  const recs = reg.records;
  const n = recs.length;

  const reviewComplied = recs.filter((r) => r.reviewDue && !r.reviewOverdue).length;
  const reviewCompliancePct = n ? Math.round((reviewComplied / n) * 100) : 0;

  const assurance = reg.kpis.avgScore;
  const maturity = maturityOf(assurance);
  const dimensions = [
    { label: "Ownership", pct: reg.kpis.ownerPct },
    { label: "Regulatory alignment", pct: reg.kpis.standardsPct },
    { label: "Evidence", pct: reg.kpis.evidencePct },
    { label: "Review compliance", pct: reviewCompliancePct },
  ];

  // Regulatory readiness by standard body + change-control throughput (both governance-scale, bounded).
  const [{ data: sm }, { data: cr }] = await Promise.all([
    admin.from("competency_standard_mappings").select("competency_id, standard_body, coverage").limit(5000),
    admin.from("change_requests").select("status, change_kind").limit(5000),
  ]);

  const bodyMap = new Map<string, { comps: Set<string>; total: number; full: number; partial: number; reference: number }>();
  for (const m of sm ?? []) {
    const b = m.standard_body || "other";
    const e = bodyMap.get(b) ?? { comps: new Set<string>(), total: 0, full: 0, partial: 0, reference: 0 };
    e.comps.add(m.competency_id);
    e.total++;
    if (m.coverage === "full") e.full++;
    else if (m.coverage === "partial") e.partial++;
    else e.reference++;
    bodyMap.set(b, e);
  }
  const bodies = [...bodyMap.entries()]
    .map(([body, e]) => ({ body, competencies: e.comps.size, mappings: e.total, full: e.full, partial: e.partial, reference: e.reference }))
    .sort((a, b) => b.competencies - a.competencies);

  const change = { open: 0, approved: 0, rejected: 0, implemented: 0, major: 0, minor: 0, revision: 0, total: 0 };
  const bump = (k: string) => { if (Object.prototype.hasOwnProperty.call(change, k)) (change as any)[k]++; };
  for (const c of cr ?? []) {
    change.total++;
    bump(c.status);
    bump(c.change_kind);
  }
  const changeClosed = change.approved + change.rejected + change.implemented;

  const [decTotal, decValidated, committees] = await Promise.all([
    cnt(admin.from("competency_decisions").select("id", { count: "exact", head: true })),
    cnt(admin.from("competency_decisions").select("id", { count: "exact", head: true }).eq("validation_outcome", "validated")),
    cnt(admin.from("governance_committees").select("id", { count: "exact", head: true }).eq("is_active", true)),
  ]);
  const validationRate = decTotal ? Math.round((decValidated / decTotal) * 100) : 0;

  // Domain portfolio — worst-governed first (the leadership "where do I look" lens).
  const domMap = new Map<string, { total: number; scoreSum: number; owned: number; atRisk: number }>();
  for (const r of recs) {
    const d = r.domain || "Ungrouped";
    const e = domMap.get(d) ?? { total: 0, scoreSum: 0, owned: 0, atRisk: 0 };
    e.total++;
    e.scoreSum += r.score;
    if (r.owner) e.owned++;
    if (r.state === "at_risk" || r.state === "ungoverned") e.atRisk++;
    domMap.set(d, e);
  }
  const domains = [...domMap.entries()]
    .map(([domain, e]) => ({ domain, total: e.total, score: Math.round(e.scoreSum / e.total), ownerPct: Math.round((e.owned / e.total) * 100), atRisk: e.atRisk }))
    .sort((a, b) => a.score - b.score);

  const priorities = recs.filter((r) => r.state === "at_risk" || r.state === "ungoverned").slice(0, 8);

  return {
    provisioned: true as const,
    n,
    total: reg.total,
    capped: reg.capped,
    assurance,
    maturity,
    maturityModel: MATURITY,
    dimensions,
    states: reg.states,
    kpis: reg.kpis,
    reviewCompliancePct,
    regulatoryReadiness: reg.kpis.standardsPct,
    bodies,
    change,
    changeClosed,
    decTotal,
    decValidated,
    validationRate,
    committees,
    domains,
    priorities,
  };
}
