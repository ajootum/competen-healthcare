// COMP-026 Competency Operational Analytics — Benchmarking & Comparison engine. Internal peer comparison of
// competency readiness across the workforce's clinical/professional DOMAINS (the finest-grained comparable
// entity the analytics engine exposes). REUSES loadCompetencyAnalytics: its domain scorecards already carry a
// real readiness (achievement %), coverage, gaps and at-risk counts per domain — we rank those into a league
// table with quartile bands, percentiles, spread and below-target flags. No recomputation from raw records, no
// new migration. NOTE: the engine has no per-organisational-unit/department readiness rollup (competency_readiness
// _snapshots exposes only an aggregate), so this is INTERNAL area-vs-area benchmarking; external / network /
// regional / industry-percentile benchmarking needs peer-hospital comparator data that isn't present (page Foot).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadCompetencyAnalytics } from "@/lib/competency-analytics";

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

// Linear-interpolated quantile (q in 0..1).
const quantile = (xs: number[], q: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return s[base + 1] !== undefined ? Math.round(s[base] + rest * (s[base + 1] - s[base])) : Math.round(s[base]);
};

const TARGET = 75; // readiness target used to flag areas needing attention

export async function loadBenchmarking(admin: any, hid: string | null, isSuper: boolean) {
  void isSuper; // loadCompetencyAnalytics is single-hospital scoped; super-admin with no hid → empty (honest)
  const analytics = await loadCompetencyAnalytics(admin, hid ?? "").catch(() => null);
  if (!analytics) return { provisioned: false as const };

  const cards = analytics.domains.cards;
  const frameworksTotal = analytics.coverage.cards.total;

  // Comparison entities = the competency-domain scorecards the engine already computes. Each carries a real
  // readiness = achievement % (the same measure the engine averages into its "Readiness Index"). These clinical/
  // professional domains are the finest-grained peer group available — NOT organisational units (see Foot).
  const raw = (analytics.domains.scorecards ?? [])
    .filter((s: any) => s.achievement !== null)
    .map((s: any) => ({
      name: String(s.name ?? "—").replace(/^Domain\s*\d+:\s*/i, ""),
      readiness: s.achievement as number,
      coverage: (s.coverage ?? 0) as number,
      avgScore: (s.avgScore ?? null) as number | null,
      gaps: (s.gaps ?? 0) as number,
      atRisk: (s.atRisk ?? 0) as number,
      trend: s.trend as any,
    }));

  if (raw.length === 0) {
    return { provisioned: true as const, empty: true as const, frameworksTotal, engineReadiness: cards.readiness };
  }

  const vals = raw.map(u => u.readiness);
  const n = raw.length;
  const med = median(vals);
  const p25 = quantile(vals, 0.25);
  const p75 = quantile(vals, 0.75);
  const mean = Math.round(vals.reduce((a, b) => a + b, 0) / n);
  const best = Math.max(...vals);
  const worst = Math.min(...vals);
  const spread = best - worst;

  // Quartile band relative to the internal peer set.
  const bandOf = (r: number) =>
    r >= p75 ? { band: "Top quartile", tone: "emerald", color: "#10b981" } :
    r >= med ? { band: "Upper mid", tone: "teal", color: "#14b8a6" } :
    r >= p25 ? { band: "Lower mid", tone: "amber", color: "#f59e0b" } :
               { band: "Bottom quartile", tone: "rose", color: "#f43f5e" };

  // Relative position: % of peers this area outperforms (top = 100, bottom = 0 when values are distinct).
  const percentileOf = (r: number) => (n > 1 ? Math.round((raw.filter(u => u.readiness < r).length / (n - 1)) * 100) : 100);

  const ranked = raw
    .map(u => {
      const b = bandOf(u.readiness);
      return {
        ...u,
        gapPts: Math.max(0, 100 - u.readiness),      // readiness shortfall to a fully-ready area
        gapToLeader: Math.max(0, best - u.readiness), // distance behind the top area
        vsMedian: u.readiness - med,
        percentile: percentileOf(u.readiness),
        band: b.band, tone: b.tone, color: b.color,
      };
    })
    .sort((a, b) => b.readiness - a.readiness || a.gaps - b.gaps || a.name.localeCompare(b.name))
    .map((u, i) => ({ rank: i + 1, ...u }));

  const bestUnit = ranked[0];
  const worstUnit = ranked[ranked.length - 1];
  const belowTarget = ranked.filter(u => u.readiness < TARGET).length;
  const top = ranked.slice(0, 3);
  const bottom = ranked.slice(-3).reverse();

  const bandDefs = [
    { key: "Top quartile", color: "#10b981" },
    { key: "Upper mid", color: "#14b8a6" },
    { key: "Lower mid", color: "#f59e0b" },
    { key: "Bottom quartile", color: "#f43f5e" },
  ];
  const bandDist = bandDefs
    .map(dbf => ({ label: dbf.key, color: dbf.color, n: ranked.filter(u => u.band === dbf.key).length }))
    .filter(dbf => dbf.n > 0);

  const bars = ranked.map(u => ({ label: u.name, n: u.readiness, extra: `${u.readiness}%` }));
  const barColors = ranked.map(u => u.color);

  return {
    provisioned: true as const,
    empty: false as const,
    frameworksTotal,
    singleUnit: n < 2,
    noVariance: spread === 0,
    engineReadiness: cards.readiness, // engine's own portfolio Readiness Index (mean achievement)
    stats: { n, median: med, p25, p75, mean, best, worst, spread, target: TARGET },
    kpis: {
      unitsCompared: n,
      median: med,
      topQuartile: p75,
      bestPct: bestUnit.readiness,
      bestName: bestUnit.name,
      widestGap: spread,
      belowTarget,
    },
    ranked, top, bottom, bandDist, bars, barColors, bestUnit, worstUnit,
  };
}
