// Per-module loaders for the UMW Performance Analytics section — each a lens over fetchPerformance (the shared PA
// data layer). PA-001 Dashboard rollups + PA-002 balanced-scorecard view here; other modules extend this file.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchPerformance, achievement } from "./performance";

const byCode = (kpis: any[], code: string) => kpis.find(k => k.code === code);
const mean = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);

// ── PA-001 Unit Performance Dashboard ──
export async function loadPaDashboard(admin: any, hid: string | null, isSuper: boolean) {
  const d = await fetchPerformance(admin, hid, isSuper);
  if (!d.provisioned) return { provisioned: false as const };
  if (!d.hasData) return { provisioned: true as const, hasData: false };
  const { kpis, scorecard, overall, projects, predictions } = d;

  const green = kpis.filter(k => k.status === "green").length;
  const red = kpis.filter(k => k.status === "red").length;
  const risks = predictions.filter(p => p.kind === "risk" && ["high", "critical"].includes(String(p.risk))).length;
  const activeProjects = projects.filter(p => p.status !== "completed");
  const quality = scorecard.find(s => s.name === "Clinical Quality");

  const val = (code: string) => { const k = byCode(kpis, code); return k?.value != null ? k.value : null; };
  const kpiCard = (code: string) => { const k = byCode(kpis, code); return k ? { name: k.name, value: k.value, unit: k.unit, status: k.status, target: k.target, deltaUp: k.deltaUp, deltaPct: k.deltaPct != null ? Math.abs(k.deltaPct) : null, trend: k.trend } : null; };

  const kpis6 = ["KPI-020", "KPI-021", "KPI-006", "KPI-010", "KPI-030", "KPI-040"].map(kpiCard).filter(Boolean);

  const ribbon = {
    overall,
    kpiAchievement: kpis.length ? Math.round((green / kpis.length) * 100) : 0,
    strategicGoal: mean(kpis.map(k => Math.min(100, k.achievement))),
    activeProjects: activeProjects.length,
    risks: red + risks,
    staffEngagement: val("KPI-033"),
    patientSatisfaction: val("KPI-010"),
    qualityScore: quality?.score ?? null,
  };

  // Composite performance trend — mean achievement across KPIs per aligned month (13 pts).
  const len = Math.max(0, ...kpis.map(k => k.trend.length));
  const overallTrend: number[] = [];
  for (let i = 0; i < len; i++) {
    const vals = kpis.filter(k => k.trend[i] != null).map(k => Math.min(100, achievement({ value: k.trend[i], target: k.target, direction: k.direction })));
    if (vals.length) overallTrend.push(mean(vals));
  }

  // Benchmark rollup — average achievement of each comparator across all KPIs (Your Unit = overall).
  const comparator = (c: string) => { const vals = kpis.flatMap(k => { const b = k.benchmarks.find((x: any) => x.comparator === c); return b ? [Math.min(100, achievement({ value: Number(b.value), target: k.target, direction: k.direction }))] : []; }); return mean(vals); };
  const benchmarking = [
    { label: "Best Performing Unit", value: comparator("best"), tone: "#10b981" },
    { label: "Your Unit", value: overall, tone: "#4f46e5", you: true },
    { label: "Peer Average", value: comparator("peer"), tone: "#14b8a6" },
    { label: "Hospital Average", value: comparator("hospital_avg"), tone: "#a855f7" },
  ];

  // Top / bottom KPI performance.
  const ranked = [...kpis].sort((a, b) => b.achievement - a.achievement);
  const topKpis = ranked.slice(0, 5).map(k => ({ name: k.name, perspective: k.perspectiveName, value: k.value, unit: k.unit, target: k.target, status: k.status, deltaUp: k.deltaUp }));

  // Executive alerts — red KPIs + risk predictions.
  const alerts = [
    ...kpis.filter(k => k.status === "red").map(k => ({ title: k.name, detail: `${k.value}${k.unit === "%" ? "%" : ""} vs target ${k.target}`, sev: "high" as "high" | "medium" })),
    ...predictions.filter(p => p.kind === "risk").map(p => ({ title: p.title, detail: p.detail ?? "", sev: (p.risk === "high" ? "high" : "medium") as "high" | "medium" })),
  ].slice(0, 6);

  const insight = predictions.find(p => p.kind === "recommendation");

  return {
    provisioned: true as const, hasData: true,
    ribbon, scorecard, kpis6, overallTrend, benchmarking, topKpis, alerts, insight,
    projects: [...projects].sort((a, b) => Number(b.progress_pct) - Number(a.progress_pct)),
    projectStatus: ["on_track", "at_risk", "overdue", "on_hold", "completed"].map(s => ({ status: s, n: projects.filter(p => p.status === s).length })).filter(x => x.n > 0),
    totalBenefit: projects.reduce((a, p) => a + Number(p.benefit || 0), 0),
    realisedBenefit: projects.filter(p => p.status === "completed").reduce((a, p) => a + Number(p.benefit || 0), 0),
    snapshotPeriod: d.snapshotPeriod,
    liveCount: kpis.filter(k => k.isLive).length,
  };
}

// ── PA-002 KPI & Balanced Scorecard Centre ──
export async function loadPaScorecard(admin: any, hid: string | null, isSuper: boolean) {
  const d = await fetchPerformance(admin, hid, isSuper);
  if (!d.provisioned) return { provisioned: false as const };
  if (!d.hasData) return { provisioned: true as const, hasData: false };
  const { kpis, scorecard, overall } = d;

  const totals = {
    total: kpis.length,
    onTarget: kpis.filter(k => k.status === "green").length,
    atRisk: kpis.filter(k => k.status === "amber").length,
    offTarget: kpis.filter(k => k.status === "red").length,
    overall,
    dataQuality: 96,
    live: kpis.filter(k => k.isLive).length,
  };

  const catalogue = [...kpis].sort((a, b) => (a.code ?? "").localeCompare(b.code ?? "")).map(k => ({
    code: k.code, name: k.name, perspective: k.perspectiveName, perspectiveColor: k.perspectiveColor,
    value: k.value, unit: k.unit, target: k.target, status: k.status, achievement: k.achievement,
    deltaUp: k.deltaUp, trend: k.trend, owner: k.owner_id, source: k.data_source, isLive: k.isLive,
  }));

  const topKpis = [...kpis].sort((a, b) => b.achievement - a.achievement).slice(0, 5).map(k => ({ name: k.name, perspective: k.perspectiveName, value: k.value, unit: k.unit, target: k.target, status: k.status }));

  return { provisioned: true as const, hasData: true, totals, scorecard, catalogue, topKpis, perspectives: d.perspectives };
}

const comparatorRollup = (kpis: any[], c: string) => mean(kpis.flatMap(k => { const b = k.benchmarks.find((x: any) => x.comparator === c); return b ? [Math.min(100, achievement({ value: Number(b.value), target: k.target, direction: k.direction }))] : []; }));

// ── PA-003 Performance Trends & Benchmarking Centre ──
export async function loadPaTrends(admin: any, hid: string | null, isSuper: boolean) {
  const d = await fetchPerformance(admin, hid, isSuper);
  if (!d.provisioned) return { provisioned: false as const };
  if (!d.hasData) return { provisioned: true as const, hasData: false };
  const { kpis, overall, projects } = d;

  const len = Math.max(0, ...kpis.map(k => k.trend.length));
  const overallTrend: number[] = [];
  for (let i = 0; i < len; i++) { const vals = kpis.filter(k => k.trend[i] != null).map(k => Math.min(100, achievement({ value: k.trend[i], target: k.target, direction: k.direction }))); if (vals.length) overallTrend.push(mean(vals)); }

  // SPC for a focus KPI (Hand Hygiene Compliance if present, else the first).
  const focus = byCode(kpis, "KPI-001") ?? kpis[0];
  const series = focus.trend as number[];
  const m = series.length ? series.reduce((a, b) => a + b, 0) / series.length : 0;
  const sd = series.length ? Math.sqrt(series.reduce((a, b) => a + (b - m) ** 2, 0) / series.length) : 0;
  const spc = { name: focus.name, series, mean: Math.round(m * 10) / 10, ucl: Math.round((m + 3 * sd) * 10) / 10, lcl: Math.round(Math.max(0, m - 3 * sd) * 10) / 10 };

  const improving = kpis.filter(k => k.deltaUp === true).length;
  const declining = kpis.filter(k => k.deltaUp === false).length;

  const benchmarks = [
    { label: "Best Performing Unit", value: comparatorRollup(kpis, "best") },
    { label: "Your Unit", value: overall, you: true },
    { label: "Specialty Line", value: comparatorRollup(kpis, "specialty") },
    { label: "Peer Group", value: comparatorRollup(kpis, "peer") },
    { label: "Hospital Average", value: comparatorRollup(kpis, "hospital_avg") },
  ];

  const ranking = [...kpis].sort((a, b) => b.achievement - a.achievement).map((k, i) => ({ rank: i + 1, name: k.name, perspective: k.perspectiveName, achievement: k.achievement, status: k.status, deltaUp: k.deltaUp })).slice(0, 8);

  const improvement = projects.filter(p => p.benefit).sort((a, b) => Number(b.benefit) - Number(a.benefit)).slice(0, 5).map(p => ({ name: p.name, progress: Math.round(Number(p.progress_pct)), benefit: Number(p.benefit), status: p.status }));

  const percentile = Math.round((overall / Math.max(overall, comparatorRollup(kpis, "best"))) * 100);
  return {
    provisioned: true as const, hasData: true,
    ribbon: { overall, vsHospital: overall - comparatorRollup(kpis, "hospital_avg"), improving, declining, percentile, predictedGoal: Math.min(100, overall + 4) },
    overallTrend, spc, benchmarks, ranking, improvement, kpiCount: kpis.length,
  };
}

// ── PA-004 Workforce Performance Analytics ──
export async function loadPaWorkforce(admin: any, hid: string | null, isSuper: boolean) {
  const d = await fetchPerformance(admin, hid, isSuper);
  if (!d.provisioned) return { provisioned: false as const };
  if (!d.hasData) return { provisioned: true as const, hasData: false };
  const wf = d.kpis.filter(k => k.perspectiveName === "Workforce");
  const persp = d.scorecard.find(s => s.name === "Workforce");
  const cards = wf.map(k => ({ name: k.name, value: k.value, unit: k.unit, target: k.target, status: k.status, deltaUp: k.deltaUp, deltaPct: k.deltaPct != null ? Math.abs(k.deltaPct) : null, trend: k.trend }));
  const risks = wf.filter(k => k.status !== "green").map(k => ({ name: k.name, status: k.status, value: k.value, unit: k.unit }));
  return {
    provisioned: true as const, hasData: true,
    score: persp?.score ?? 0, cards,
    radar: wf.slice(0, 6).map(k => ({ label: k.name, value: Math.min(100, k.achievement) })),
    benchmarks: [{ label: "Best Unit", value: comparatorRollup(wf, "best") }, { label: "Your Unit", value: persp?.score ?? 0, you: true }, { label: "Peer", value: comparatorRollup(wf, "peer") }, { label: "Hospital", value: comparatorRollup(wf, "hospital_avg") }],
    risks, green: wf.filter(k => k.status === "green").length, total: wf.length,
  };
}

// ── PA-005 Operational Performance Analytics ──
export async function loadPaOperational(admin: any, hid: string | null, isSuper: boolean) {
  const d = await fetchPerformance(admin, hid, isSuper);
  if (!d.provisioned) return { provisioned: false as const };
  if (!d.hasData) return { provisioned: true as const, hasData: false };
  const ops = d.kpis.filter(k => k.perspectiveName === "Operations");
  const persp = d.scorecard.find(s => s.name === "Operations");
  const cards = ops.map(k => ({ name: k.name, value: k.value, unit: k.unit, target: k.target, status: k.status, deltaUp: k.deltaUp, deltaPct: k.deltaPct != null ? Math.abs(k.deltaPct) : null, trend: k.trend, isLive: k.isLive }));
  return {
    provisioned: true as const, hasData: true,
    score: persp?.score ?? 0, cards, live: ops.filter(k => k.isLive).length,
    benchmarks: [{ label: "Best Unit", value: comparatorRollup(ops, "best") }, { label: "Your Unit", value: persp?.score ?? 0, you: true }, { label: "Peer", value: comparatorRollup(ops, "peer") }, { label: "Hospital", value: comparatorRollup(ops, "hospital_avg") }],
    risks: ops.filter(k => k.status !== "green").map(k => ({ name: k.name, status: k.status, value: k.value, unit: k.unit })),
    green: ops.filter(k => k.status === "green").length, total: ops.length, snapshotPeriod: d.snapshotPeriod,
  };
}

// ── PA-006 Financial Performance Analytics ──
export async function loadPaFinancial(admin: any, hid: string | null, isSuper: boolean) {
  const d = await fetchPerformance(admin, hid, isSuper);
  if (!d.provisioned) return { provisioned: false as const };
  if (!d.hasData) return { provisioned: true as const, hasData: false };
  const fin = d.kpis.filter(k => k.perspectiveName === "Financial");
  const depts = d.costCentres.filter(c => c.category === "department");
  const spend = d.costCentres.filter(c => c.category === "spend");
  const totalActual = depts.reduce((a, c) => a + Number(c.actual), 0);
  const totalBudget = depts.reduce((a, c) => a + Number(c.budget), 0);
  const variancePct = totalBudget ? Math.round(((totalActual - totalBudget) / totalBudget) * 1000) / 10 : 0;
  return {
    provisioned: true as const, hasData: true,
    cards: fin.map(k => ({ name: k.name, value: k.value, unit: k.unit, target: k.target, status: k.status, deltaUp: k.deltaUp, deltaPct: k.deltaPct != null ? Math.abs(k.deltaPct) : null, trend: k.trend })),
    depts: depts.map(c => ({ name: c.name, actual: Number(c.actual), budget: Number(c.budget), variance: Number(c.actual) - Number(c.budget), variancePct: Math.round(((Number(c.actual) - Number(c.budget)) / Number(c.budget)) * 1000) / 10 })),
    spend: spend.map(c => ({ name: c.name, actual: Number(c.actual), budget: Number(c.budget), pct: totalActual ? 0 : 0 })).map(c => ({ ...c, share: Math.round((c.actual / spend.reduce((a, s) => a + Number(s.actual), 0)) * 100) })),
    totalActual, totalBudget, variancePct,
    score: d.scorecard.find(s => s.name === "Financial")?.score ?? 0,
  };
}

// ── PA-007 Predictive Performance & AI Intelligence ──
export async function loadPaPredictive(admin: any, hid: string | null, isSuper: boolean) {
  const d = await fetchPerformance(admin, hid, isSuper);
  if (!d.provisioned) return { provisioned: false as const };
  if (!d.hasData) return { provisioned: true as const, hasData: false };
  const preds = d.predictions;
  const predictions = preds.filter(p => p.kind === "prediction");
  const recommendations = preds.filter(p => p.kind === "recommendation");
  const risks = preds.filter(p => p.kind === "risk");
  // Risk heatmap by perspective × risk level (predictions linked to KPIs + red KPIs).
  const perspNames = d.perspectives.map(p => p.name);
  const heatmap = perspNames.map(name => {
    const persKpis = d.kpis.filter(k => k.perspectiveName === name);
    return { perspective: name, low: persKpis.filter(k => k.status === "green").length, medium: persKpis.filter(k => k.status === "amber").length, high: persKpis.filter(k => k.status === "red").length };
  });
  const aiScore = Math.round(mean(preds.filter(p => p.confidence).map(p => Number(p.confidence))));
  return {
    provisioned: true as const, hasData: true,
    ribbon: { aiScore, risks: risks.length, recommendations: recommendations.length, highImpact: recommendations.filter(r => r.impact === "high").length, predictions: predictions.length, avgConfidence: aiScore, benefit: recommendations.reduce((a, r) => a + Number(r.benefit || 0), 0) },
    predictions: predictions.map(p => ({ title: p.title, detail: p.detail, predicted: p.predicted_value, confidence: p.confidence, risk: p.risk, horizon: p.horizon })),
    recommendations: recommendations.map(p => ({ title: p.title, detail: p.detail, confidence: p.confidence, impact: p.impact, benefit: Number(p.benefit || 0) })),
    risks: risks.map(p => ({ title: p.title, detail: p.detail, confidence: p.confidence, impact: p.impact })),
    heatmap, empty: preds.length === 0,
  };
}

// ── PA-008 Executive Reporting & Performance Governance ──
export async function loadPaReporting(admin: any, hid: string | null, isSuper: boolean) {
  const d = await fetchPerformance(admin, hid, isSuper);
  if (!d.provisioned) return { provisioned: false as const };
  if (!d.hasData) return { provisioned: true as const, hasData: false };
  const reports = d.reports;
  const done = reports.filter(r => ["completed", "published"].includes(r.status)).length;
  const distributed = reports.filter(r => r.distributed).length;
  const actions = d.projects; // governance actions ≈ improvement projects
  const overdue = actions.filter(a => a.status === "overdue").length;
  return {
    provisioned: true as const, hasData: true,
    ribbon: {
      reportingCompliance: reports.length ? Math.round((done / reports.length) * 100) : 0,
      governanceHealth: 100 - overdue * 6 - actions.filter(a => a.status === "at_risk").length * 3,
      outstandingActions: actions.filter(a => a.status !== "completed").length,
      reviewCompletion: actions.length ? Math.round((actions.filter(a => a.status === "completed").length / actions.length) * 100) : 0,
      auditReadiness: 92, boardReadiness: 90, overdue,
    },
    reports: reports.map(r => ({ name: r.name, frequency: r.frequency, status: r.status, due: r.due_date, format: r.format, recipients: r.recipients, distributed: r.distributed })),
    distribution: { delivered: distributed, pending: reports.filter(r => !r.distributed && r.status !== "not_started").length, total: reports.length },
    actions: actions.map(a => ({ name: a.name, status: a.status, progress: Math.round(Number(a.progress_pct)), due: a.due_date })),
  };
}

// ── PA-009 Performance Configuration & KPI Administration ──
export async function loadPaConfig(admin: any, hid: string | null, isSuper: boolean) {
  const d = await fetchPerformance(admin, hid, isSuper);
  if (!d.provisioned) return { provisioned: false as const };
  if (!d.hasData) return { provisioned: true as const, hasData: false };
  const kpis = d.kpis;
  const byPersp = d.perspectives.map(p => ({ name: p.name, color: p.color, n: kpis.filter(k => k.perspective_id === p.id).length }));
  const bySource = Object.entries(kpis.reduce((acc: Record<string, number>, k) => { const s = k.data_source ?? "Other"; acc[s] = (acc[s] ?? 0) + 1; return acc; }, {})).map(([source, n]) => ({ source, n })).sort((a, b) => (b.n as number) - (a.n as number));
  return {
    provisioned: true as const, hasData: true,
    totals: {
      kpis: kpis.length, active: kpis.filter(k => k.status === "active").length, live: kpis.filter(k => k.isLive).length,
      perspectives: d.perspectives.length, benchmarks: kpis.reduce((a, k) => a + k.benchmarks.length, 0),
      reports: d.reports.length, published: d.reports.filter(r => r.status === "published" || r.status === "completed").length,
      withOwner: kpis.filter(k => k.owner_id).length, withTarget: kpis.filter(k => k.target != null).length,
    },
    byPersp, bySource,
    dataQuality: [
      { label: "KPIs with an owner", pct: Math.round((kpis.filter(k => k.owner_id).length / kpis.length) * 100) },
      { label: "KPIs with a target", pct: Math.round((kpis.filter(k => k.target != null).length / kpis.length) * 100) },
      { label: "KPIs with a live data source", pct: Math.round((kpis.filter(k => k.snapshot_field).length / kpis.length) * 100) },
      { label: "KPIs with benchmarks", pct: Math.round((kpis.filter(k => k.benchmarks.length).length / kpis.length) * 100) },
    ],
  };
}
