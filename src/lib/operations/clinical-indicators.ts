// Clinical Indicators Centre (UMG-QS-008) — the Unit Manager's lens over the clinical-quality indicators
// (quality_indicators + indicator_measurements, migration 019), grouped by category via the hospital's
// quality_objects. Real: an 8-KPI ribbon (overall attainment score, meeting/below target, trending-down,
// high-risk, composite AI risk), the category breakdown, top underperformers, a per-category attainment trend,
// data-quality metrics and threshold-breach alerts — all computed from the measured values. Fail-soft +
// provisioned-aware. Peer benchmarking + a dedicated improvement-projects store are next-phase surfaces.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));

function rag(value: number | null, target: number | null, escalation: number | null, direction: string): "green" | "amber" | "red" | "gray" {
  if (value == null || target == null) return "gray";
  if (direction === "lower_is_better") {
    if (value <= target) return "green";
    if (escalation != null && value <= escalation) return "amber";
    return escalation != null ? "red" : "amber";
  }
  if (value >= target) return "green";
  if (escalation != null && value >= escalation) return "amber";
  return escalation != null ? "red" : "amber";
}
// Attainment % — how close the value is to target (direction-aware), capped for display.
function attain(value: number | null, target: number | null, direction: string): number | null {
  if (value == null || target == null || target === 0 || value === 0) return value == null || target == null ? null : (direction === "lower_is_better" ? 130 : 0);
  const a = direction === "lower_is_better" ? (target / value) * 100 : (value / target) * 100;
  return Math.max(0, Math.min(130, Math.round(a)));
}

export async function loadClinicalIndicators(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  const objRes = await scope(admin.from("quality_objects").select("id, title, code")).limit(3000);
  if (objRes.error && missing(objRes.error)) return { provisioned: false as const };
  const objs = (objRes.error ? [] : objRes.data ?? []) as any[];
  const objIds = objs.map(o => o.id);
  if (!objIds.length) return { provisioned: true as const, hasData: false, ...empty() };

  const indRes = await admin.from("quality_indicators").select("id, code, name, unit, direction, target_value, escalation_value, frequency, quality_object_id").in("quality_object_id", objIds).eq("is_active", true).limit(2000);
  const inds = (indRes.error ? [] : indRes.data ?? []) as any[];
  if (!inds.length) return { provisioned: true as const, hasData: false, ...empty() };

  // Measurements (hospital-scoped), oldest→newest.
  const indIds = inds.map(i => i.id);
  const mByInd = new Map<string, { period: string; value: number; hasND: boolean }[]>();
  const periodSet = new Set<string>();
  try {
    const mq = admin.from("indicator_measurements").select("indicator_id, period, value, numerator, denominator").in("indicator_id", indIds).order("period", { ascending: true }).limit(50000);
    const { data } = await (isSuper ? mq : mq.eq("hospital_id", hid ?? NONE));
    (data ?? []).forEach((m: any) => {
      if (!mByInd.has(m.indicator_id)) mByInd.set(m.indicator_id, []);
      mByInd.get(m.indicator_id)!.push({ period: m.period, value: Number(m.value), hasND: m.numerator != null && m.denominator != null });
      periodSet.add(m.period);
    });
  } catch { /* fail-soft */ }
  const periods = [...periodSet].sort().slice(-6);

  const catName = new Map(objs.map(o => [o.id, o.title]));
  const indicators = inds.map(i => {
    const ms = mByInd.get(i.id) ?? [];
    const latest = ms.length ? ms[ms.length - 1] : null;
    const prev = ms.length > 1 ? ms[ms.length - 2] : null;
    const target = i.target_value != null ? Number(i.target_value) : null;
    const escalation = i.escalation_value != null ? Number(i.escalation_value) : null;
    const value = latest?.value ?? null;
    const status = rag(value, target, escalation, i.direction);
    const worsening = value != null && prev != null && (i.direction === "lower_is_better" ? value > prev.value : value < prev.value);
    return {
      code: i.code, name: i.name, unit: i.unit, direction: i.direction, frequency: i.frequency,
      category: catName.get(i.quality_object_id) ?? "Uncategorised",
      target, escalation, value, period: latest?.period ?? null, status, worsening,
      attainment: attain(value, target, i.direction),
      gap: value != null && target != null ? (i.direction === "lower_is_better" ? value - target : target - value) : null,
      trend: ms.slice(-8).map(m => m.value), byPeriod: Object.fromEntries(ms.map(m => [m.period, m.value])),
      hasND: !!latest?.hasND, history: ms.length,
    };
  });

  const measured = indicators.filter(i => i.value != null);
  const green = indicators.filter(i => i.status === "green").length;
  const amber = indicators.filter(i => i.status === "amber").length;
  const red = indicators.filter(i => i.status === "red").length;
  const gray = indicators.filter(i => i.status === "gray").length;
  const below = amber + red;
  const trendingDown = indicators.filter(i => i.worsening).length;
  const attTot = measured.map(i => Math.min(100, i.attainment ?? 0));
  const overallScore = attTot.length ? Math.round(attTot.reduce((a, b) => a + b, 0) / attTot.length) : null;
  const riskScore = indicators.length ? Math.round(((red * 1 + amber * 0.5 + trendingDown * 0.3) / indicators.length) * 100) / 100 : 0;

  // Category breakdown.
  const cats = [...new Set(indicators.map(i => i.category))];
  const byCategory = cats.map(category => {
    const g = indicators.filter(i => i.category === category);
    return { category, total: g.length, meeting: g.filter(i => i.status === "green").length, below: g.filter(i => i.status === "amber" || i.status === "red").length, noData: g.filter(i => i.status === "gray").length };
  }).sort((a, b) => b.total - a.total);

  // Top underperformers — worst attainment first (measured only, below target).
  const topUnderperformers = measured.filter(i => i.status !== "green").sort((a, b) => (a.attainment ?? 0) - (b.attainment ?? 0)).slice(0, 10);
  const highImpact = topUnderperformers.filter(i => i.status === "red" || (i.attainment ?? 100) < 85).slice(0, 6).map(i => ({ ...i, impact: i.status === "red" ? "High" : "Medium" }));

  // Per-category attainment trend across periods (avg capped-attainment).
  const trendSeries: Record<string, (number | null)[]> = { Overall: [] };
  const CAT_KEYS = byCategory.slice(0, 4).map(c => c.category); // top categories for the chart
  for (const c of CAT_KEYS) trendSeries[c] = [];
  for (const p of periods) {
    const at = (list: any[]) => { const vals = list.map(i => { const v = i.byPeriod[p]; return v == null ? null : Math.min(100, attain(v, i.target, i.direction) ?? 0); }).filter((x): x is number => x != null); return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null; };
    trendSeries.Overall.push(at(indicators));
    for (const c of CAT_KEYS) trendSeries[c].push(at(indicators.filter(i => i.category === c)));
  }

  // Data quality — completeness/timeliness/accuracy/consistency, all real.
  const latestPeriod = periods[periods.length - 1];
  const dataQuality = {
    completeness: indicators.length ? Math.round((measured.length / indicators.length) * 100) : 0,
    timeliness: indicators.length ? Math.round((indicators.filter(i => i.period === latestPeriod).length / indicators.length) * 100) : 0,
    accuracy: measured.length ? Math.round((indicators.filter(i => i.hasND).length / measured.length) * 100) : 0,
    consistency: indicators.length ? Math.round((indicators.filter(i => i.history >= periods.length).length / indicators.length) * 100) : 0,
  };

  // Alerts — threshold breaches + sharp declines, worst first.
  const alerts = [...indicators.filter(i => i.status === "red").map(i => ({ name: i.name, severity: "Critical", message: `${i.name} ${i.direction === "lower_is_better" ? "above" : "below"} escalation threshold`, status: i.status })),
  ...indicators.filter(i => i.status === "amber" && i.worsening).map(i => ({ name: i.name, severity: "High", message: `${i.name} below target and declining`, status: i.status })),
  ...indicators.filter(i => i.status === "amber" && !i.worsening).map(i => ({ name: i.name, severity: "Medium", message: `${i.name} below target`, status: i.status }))].slice(0, 8);

  // Improvement projects proxy — open CAPA/quality actions for the hospital (real cross-domain count).
  let improvementProjects = 0;
  try { const { count } = await scope(admin.from("capa_actions").select("id", { count: "exact", head: true })).not("status", "in", "(completed,verified,closed)"); improvementProjects = count ?? 0; } catch { /* fail-soft */ }

  const kpis = {
    total: indicators.length, measured: measured.length, onTarget: green, below, warning: amber, atEscalation: red, noData: gray,
    trendingDown, overallScore, riskScore, highRisk: red, improvementProjects,
    coverage: indicators.length ? Math.round((measured.length / indicators.length) * 100) : 0,
    benchmarkPct: indicators.length ? Math.round((green / indicators.length) * 100) : 0,
  };

  return { provisioned: true as const, hasData: measured.length > 0, kpis, indicators, byCategory, topUnderperformers, highImpact, trend: { periods, series: trendSeries }, dataQuality, alerts };
}

function empty() {
  return { kpis: { total: 0, measured: 0, onTarget: 0, below: 0, warning: 0, atEscalation: 0, noData: 0, trendingDown: 0, overallScore: null, riskScore: 0, highRisk: 0, improvementProjects: 0, coverage: 0, benchmarkPct: 0 }, indicators: [] as any[], byCategory: [] as any[], topUnderperformers: [] as any[], highImpact: [] as any[], trend: { periods: [] as string[], series: {} as Record<string, (number | null)[]> }, dataQuality: { completeness: 0, timeliness: 0, accuracy: 0, consistency: 0 }, alerts: [] as any[] };
}
