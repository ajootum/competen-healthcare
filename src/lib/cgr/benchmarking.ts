/* eslint-disable @typescript-eslint/no-explicit-any */
// CGR-022 — Competency Governance Global Benchmarking & Comparative Intelligence.
// "How does our governance compare across units, and what can we learn to improve?" The comparative lens over the
// CGR-001 registry — distinct from CAPM-006 (which benchmarks CAPABILITY / Benner maturity) and richer than the
// CGR-006 portfolio list (which just ranks per-domain scores):
//   • Governance benchmark indicators (§7): governance maturity, ownership, regulatory readiness, review currency,
//     evidence completeness — per clinical domain AND per framework.
//   • Comparison analysis (§6): each unit's gap vs the enterprise mean + a leading / on-par / lagging band.
//   • Improvement-oriented intelligence (§4.3 / §9): top-band units as peer-learning exemplars, lagging units as
//     intervention targets. Internal comparative only; external org benchmarking would need consent + anonymisation.
// Shares the registry substrate (no new store); capability benchmarking cross-links to CAPM-006. No migration.

import { loadGovernanceRegistry } from "@/lib/cgr/registry";

type Admin = any;

function group(recs: any[], keyFn: (r: any) => string | null) {
  const map = new Map<string, any>();
  for (const r of recs) {
    const key = keyFn(r) || "Ungrouped";
    const e = map.get(key) ?? { total: 0, scoreSum: 0, owned: 0, mapped: 0, reviewOk: 0, evid: 0 };
    e.total++;
    e.scoreSum += r.score;
    if (r.owner) e.owned++;
    if (r.standards > 0) e.mapped++;
    if (r.reviewDue && !r.reviewOverdue) e.reviewOk++;
    if (r.decisions > 0) e.evid++;
    map.set(key, e);
  }
  return [...map.entries()].map(([name, e]) => ({
    name,
    count: e.total,
    maturity: Math.round(e.scoreSum / e.total),
    ownership: Math.round((e.owned / e.total) * 100),
    regulatory: Math.round((e.mapped / e.total) * 100),
    review: Math.round((e.reviewOk / e.total) * 100),
    evidence: Math.round((e.evid / e.total) * 100),
  }));
}

function rankAgainst(rows: any[], mean: number) {
  return rows
    .map((r) => {
      const gap = r.maturity - mean;
      const band = gap >= 8 ? "leading" : gap <= -8 ? "lagging" : "on_par";
      return { ...r, gap, band };
    })
    .sort((a, b) => b.maturity - a.maturity);
}

export async function loadGovernanceBenchmarking(admin: Admin) {
  const reg: any = await loadGovernanceRegistry(admin).catch(() => ({ provisioned: false }));
  if (!reg.provisioned) return { provisioned: false as const };

  const recs = reg.records;
  const n = recs.length;
  const reviewPct = n ? Math.round((recs.filter((r: any) => r.reviewDue && !r.reviewOverdue).length / n) * 100) : 0;

  const enterprise = {
    maturity: reg.kpis.avgScore,
    ownership: reg.kpis.ownerPct,
    regulatory: reg.kpis.standardsPct,
    review: reviewPct,
    evidence: reg.kpis.evidencePct,
  };

  const domains = rankAgainst(group(recs, (r) => r.domain).filter((d) => d.count >= 1), enterprise.maturity);
  const frameworks = rankAgainst(group(recs, (r) => r.framework).filter((f) => f.count >= 1), enterprise.maturity);

  const leading = domains.filter((d) => d.band === "leading");
  const lagging = domains.filter((d) => d.band === "lagging");

  return {
    provisioned: true as const,
    enterprise,
    domains,
    frameworks,
    best: domains[0] ?? null,
    worst: domains.length ? domains[domains.length - 1] : null,
    spread: domains.length ? domains[0].maturity - domains[domains.length - 1].maturity : 0,
    leadingCount: leading.length,
    laggingCount: lagging.length,
    exemplars: leading.slice(0, 4),
    interventions: lagging.slice(0, 4),
  };
}
