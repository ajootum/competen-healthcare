/* eslint-disable @typescript-eslint/no-explicit-any */
// CAPM-006 — Benchmarking & Maturity Analytics. Real CROSS-DEPARTMENT competency benchmarking (PA comparators are
// seeded; COMP-026 is domain-vs-domain — neither compares department to department). For each department it
// computes competency coverage, average Benner MATURITY and currency into a composite capability score, then
// benchmarks every department against the enterprise mean — rank, percentile, quartile, delta — and rolls up an
// organisational maturity level. Real over competency_decisions via profiles.department_id. Internal benchmarking
// only (no cross-tenant peer data exists — stated honestly). No migration.

type Admin = any;
const NONE = "00000000-0000-0000-0000-000000000000";
const ACHIEVED = ["competent", "competent_with_conditions", "provisionally_competent"];
const MATURITY: Record<string, number> = { novice: 1, advanced_beginner: 2, competent: 3, proficient: 4, expert: 5, mentor: 5, authority: 6 };
const isMissing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const MIN_STAFF = 3;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r1 = (n: number) => Math.round(n * 10) / 10;

const maturityLevel = (m: number) => (m >= 4 ? "Expert" : m >= 3 ? "Proficient" : m >= 2 ? "Competent" : "Developing");
const levelTone = (m: number) => (m >= 4 ? "emerald" : m >= 3 ? "teal" : m >= 2 ? "amber" : "rose");

export async function loadBenchmarking(admin: Admin, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const probe = await admin.from("competency_decisions").select("id").limit(1);
  if (probe.error && isMissing(probe.error)) return { provisioned: false as const };

  const { data: depts, error: dErr } = await scope(admin.from("departments").select("id, name, hospital_id").limit(5000));
  if (dErr) return isMissing(dErr) ? { provisioned: false as const } : emptyResult();
  const deptList = (depts ?? []) as any[];
  if (!deptList.length) return emptyResult();
  const deptName = new Map(deptList.map(d => [d.id, d.name]));

  const { data: profs } = await scope(admin.from("profiles").select("id, department_id").not("department_id", "is", null).limit(30000));
  const deptOfNurse = new Map<string, string>();
  const staffCount = new Map<string, number>();
  for (const p of (profs ?? []) as any[]) { deptOfNurse.set(p.id, p.department_id); staffCount.set(p.department_id, (staffCount.get(p.department_id) ?? 0) + 1); }
  const nurseIds = [...deptOfNurse.keys()];
  if (!nurseIds.length) return emptyResult();

  const today = new Date().toISOString().slice(0, 10);
  const agg = new Map<string, { total: number; achieved: number; expired: number; mSum: number; mN: number }>();
  const seen = new Set<string>();
  for (let i = 0; i < nurseIds.length; i += 2000) {
    const chunk = nurseIds.slice(i, i + 2000);
    const { data } = await admin.from("competency_decisions").select("nurse_id, competency_id, outcome, maturity, expiry_date, created_at").in("nurse_id", chunk).order("created_at", { ascending: false }).limit(60000);
    for (const d of (data ?? []) as any[]) {
      const k = `${d.nurse_id}:${d.competency_id}`; if (seen.has(k)) continue; seen.add(k);
      const dept = deptOfNurse.get(d.nurse_id); if (!dept) continue;
      const g = agg.get(dept) ?? { total: 0, achieved: 0, expired: 0, mSum: 0, mN: 0 };
      g.total++;
      const isAch = ACHIEVED.includes(d.outcome);
      if (isAch) { g.achieved++; const m = MATURITY[d.maturity]; if (m) { g.mSum += m; g.mN++; } }
      if (d.outcome === "expired" || (d.expiry_date && d.expiry_date < today)) g.expired++;
      agg.set(dept, g);
    }
  }

  // Per-department scores.
  let rows = deptList.map(d => {
    const g = agg.get(d.id);
    if (!g || g.total < MIN_STAFF) return null;
    const coverage = g.achieved / g.total;
    const currency = g.achieved ? Math.max(0, (g.achieved - g.expired) / g.achieved) : 0;
    const avgMaturity = g.mN ? g.mSum / g.mN : 0;
    const capability = Math.round(100 * (0.5 * coverage + 0.2 * currency + 0.3 * (avgMaturity / 6)));
    return {
      id: d.id, department: deptName.get(d.id) ?? "Department", staff: staffCount.get(d.id) ?? 0,
      coverage: Math.round(coverage * 100), currency: Math.round(currency * 100), avgMaturity: r1(avgMaturity),
      level: maturityLevel(avgMaturity), levelTone: levelTone(avgMaturity), capability,
    };
  }).filter(Boolean) as any[];

  if (rows.length < 2) return { provisioned: true as const, empty: false, insufficient: true, n: rows.length, rows, kpis: emptyKpis(), distribution: [] as any[], leaders: [] as any[], laggards: [] as any[] };

  rows.sort((a, b) => b.capability - a.capability);
  const scores = rows.map(r => r.capability);
  const benchmark = Math.round(mean(scores));
  const n = rows.length;
  rows = rows.map((r, i) => ({ ...r, rank: i + 1, percentile: n > 1 ? Math.round(((n - (i + 1)) / (n - 1)) * 100) : 100, delta: r.capability - benchmark }));

  const distribution = ["Expert", "Proficient", "Competent", "Developing"].map(level => ({ level, n: rows.filter(r => r.level === level).length })).filter(x => x.n > 0);
  const leaders = rows.slice(0, 3);
  const laggards = rows.slice(-3).reverse().map(r => ({ ...r, gapToLeader: rows[0].capability - r.capability }));
  const enterpriseMaturity = r1(mean(rows.map(r => r.avgMaturity)));

  return {
    provisioned: true as const, empty: false, insufficient: false, n,
    kpis: {
      departments: n,
      benchmark,
      topScore: rows[0].capability,
      spread: rows[0].capability - rows[n - 1].capability,
      aboveBenchmark: rows.filter(r => r.delta > 0).length,
      enterpriseMaturity, enterpriseLevel: maturityLevel(enterpriseMaturity),
    },
    rows, distribution, leaders, laggards,
  };
}

function emptyKpis() { return { departments: 0, benchmark: 0, topScore: 0, spread: 0, aboveBenchmark: 0, enterpriseMaturity: 0, enterpriseLevel: "—" }; }
function emptyResult() { return { provisioned: true as const, empty: true, insufficient: false, n: 0, rows: [] as any[], kpis: emptyKpis(), distribution: [] as any[], leaders: [] as any[], laggards: [] as any[] }; }
