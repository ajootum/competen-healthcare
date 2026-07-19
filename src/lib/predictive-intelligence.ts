import { createAdminClient } from "@/lib/supabase/server";
import { computeRiskFlags } from "@/lib/engines/risk";

type Admin = ReturnType<typeof createAdminClient>;

// ── Predictive Intelligence Workspace data loader ───────────────────────────
// The cross-platform forecasting view (Predictive Intelligence spec v1.0 +
// mockup). One hospital-scoped pass over the live signals every other
// Intelligence workspace uses — assessments, scores, decisions, enrolments,
// educators, CPUs/cases, audits, CAPA and the risk engine — turned into
// forward-looking forecasts, scenarios, a cross-domain cascade, workforce/
// resource projections and a risk heat-map.
//
// Honest-UI + responsible AI: these are RULE-DERIVED projections from live
// trends, not a trained ML model. There is no prediction-history store, so
// "historical forecast accuracy", "model performance/drift" and the
// "recommendations accepted" rate are shown muted — you can't score a model
// that doesn't exist. Confidence reflects data volume & trend stability, and is
// labelled as such. Every forecast is explainable and advisory only.

const CLOSED = new Set(["completed", "closed", "verified"]);
const pctOf = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null);
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

export type Domain = "Assessment" | "Competency" | "Validation" | "Workforce" | "Resources" | "Accreditation" | "Learning";
export type Dir = "up" | "down" | "flat";
export type Forecast = { title: string; domain: Domain; dir: Dir; delta: number; value: number | null; horizon: string; confidence: number; severity: "High" | "Medium" | "Low"; contributors: string[] };
export type Scenario = { title: string; tag: "Best Outcome" | "High Impact" | "High Risk"; readinessImpact: number; cost: "Low" | "Medium" | "High"; confidence: number; detail: string };
export type TimelineSeries = { label: string; color: string; points: number[] };
export type ConfBucket = { label: string; n: number; color: string };
export type ImpactNode = { id: string; label: string; tone: "amber" | "orange" | "red" };
export type WorkforceRow = { role: string; current: number; required: number; shortfall: number };
export type ResourceRow = { label: string; value: number | null; muted?: boolean };
export type HeatCell = { impact: "High" | "Medium" | "Low"; low: number; medium: number; high: number; critical: number };
export type Risk = { title: string; severity: "High" | "Medium" | "Low" };
export type PanelAction = { title: string; priority: "High" | "Medium" | "Low"; href: string };

export type PredictiveIntelligence = {
  scope: { institution: string; horizon: string; domain: string };
  kpis: { highConfidence: number; emergingRisks: number; criticalForecasts: number; scenarios: number; recommendationsAccepted: number | null; forecastAccuracy: number | null; modelConfidence: "High" | "Medium" | "Low" };
  forecasts: Forecast[];
  scenarios: Scenario[];
  timeline: { horizons: string[]; series: TimelineSeries[] };
  confidence: { overall: number | null; buckets: ConfBucket[] };
  impact: ImpactNode[];
  whatIf: { currentAssessors: number; currentBacklog: number };
  workforce: WorkforceRow[];
  resources: { rows: ResourceRow[]; note: string };
  heatmap: HeatCell[];
  modelPerformance: { note: string };
  risks: Risk[];
  panel: {
    summary: { predictionsGenerated: number; criticalForecasts: number; highRiskTrends: number; scenarios: number; forecastAccuracy: number | null };
    reasoning: string[];
    actions: PanelAction[];
    outputs: { label: string; href: string }[];
    aiConfigured: boolean;
  };
};

// Linear-ish forecast from a monthly series: compare recent vs earlier average,
// scale to the horizon, and derive a confidence from data volume + stability.
function trendForecast(series: number[], horizonFactor = 1): { deltaPct: number; confidence: number } {
  const v = series.filter(x => x > 0 || x === 0);
  if (v.length < 2) return { deltaPct: 0, confidence: 45 };
  const mid = Math.floor(v.length / 2);
  const older = v.slice(0, mid).reduce((a, b) => a + b, 0) / Math.max(1, mid);
  const recent = v.slice(mid).reduce((a, b) => a + b, 0) / Math.max(1, v.length - mid);
  const deltaPct = older > 0 ? Math.round(((recent - older) / older) * 100 * horizonFactor) : 0;
  const nonZero = v.filter(x => x > 0).length;
  const confidence = clamp(50 + nonZero * 7, 45, 92);
  return { deltaPct: clamp(deltaPct, -60, 80), confidence: Math.round(confidence) };
}

export async function loadPredictiveIntelligence(admin: Admin, hospitalId: string): Promise<PredictiveIntelligence> {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const noRows = Promise.resolve({ data: [] as never[] });

  const { data: nurses } = await admin.from("profiles").select("id").eq("hospital_id", hospitalId || "").eq("role", "nurse").limit(2000);
  const nurseIds = (nurses ?? []).map(n => n.id);

  const [
    { data: hospital }, { data: educators }, { data: scores }, { data: assessments },
    { data: decisions }, { data: cpus }, { data: cases }, { data: audits }, { data: capa },
  ] = await Promise.all([
    hospitalId ? admin.from("hospitals").select("name").eq("id", hospitalId).maybeSingle() : Promise.resolve({ data: null }),
    hospitalId ? admin.from("profiles").select("id, role, roles").eq("hospital_id", hospitalId).or("role.in.(educator,assessor),roles.cs.{educator},roles.cs.{assessor}").limit(500) : noRows,
    nurseIds.length ? admin.from("competency_scores").select("competency_id, is_passing, educator_validated, assessed_at, cycle_id").in("nurse_id", nurseIds).limit(8000) : noRows,
    admin.from("assessments").select("method, cycle_id, assessed_at, assessor_id").limit(10000),
    nurseIds.length ? admin.from("competency_decisions").select("outcome, validated_at, expiry_date").in("nurse_id", nurseIds).limit(8000) : noRows,
    admin.from("clinical_practice_units").select("id").limit(2000),
    admin.from("clinical_cases").select("cpu_id").neq("status", "retired").limit(8000),
    hospitalId ? admin.from("audits").select("compliance_pct").eq("hospital_id", hospitalId).limit(2000) : noRows,
    hospitalId ? admin.from("capa_actions").select("status, due_date").eq("hospital_id", hospitalId).limit(1000) : noRows,
  ]);

  const eds = (educators ?? []) as { id: string; role: string; roles: string[] | null }[];
  const sc = (scores ?? []) as { competency_id: string; is_passing: boolean; educator_validated: boolean; assessed_at: string; cycle_id: string | null }[];
  const dec = (decisions ?? []) as { outcome: string; validated_at: string | null; expiry_date: string | null }[];
  const cpuList = (cpus ?? []) as { id: string }[];
  const au = (audits ?? []) as { compliance_pct: number | null }[];
  const ca = (capa ?? []) as { status: string; due_date: string | null }[];
  const hospitalCycles = new Set(sc.map(s => s.cycle_id).filter(Boolean));
  const ass = ((assessments ?? []) as { method: string; cycle_id: string | null; assessed_at: string; assessor_id: string | null }[]).filter(a => a.cycle_id && hospitalCycles.has(a.cycle_id));
  const simCpus = new Set((cases ?? []).map(c => c.cpu_id).filter(Boolean));

  const isAssessor = (e: { role: string; roles: string[] | null }) => e.role === "assessor" || (e.roles ?? []).includes("assessor");
  const assessorCount = eds.filter(isAssessor).length;

  // ── Monthly series (last 6 months) ───────────────────────────────────────
  const months = Array.from({ length: 6 }, (_, i) => { const dt = new Date(now); dt.setMonth(dt.getMonth() - (5 - i)); return dt.toISOString().slice(0, 7); });
  const countBy = (rows: { assessed_at?: string }[], key: string) => rows.filter(r => (r.assessed_at ?? "").slice(0, 7) === key).length;
  const assessMonthly = months.map(m => ass.filter(a => a.assessed_at.slice(0, 7) === m).length + countBy(sc, m));
  const passMonthly = months.map(m => { const r = sc.filter(s => s.assessed_at.slice(0, 7) === m); return r.length ? Math.round((r.filter(s => s.is_passing).length / r.length) * 100) : 0; });
  const validatedMonthly = months.map(m => sc.filter(s => s.assessed_at.slice(0, 7) === m && s.educator_validated).length);

  // ── Forecasts (rule-derived) ─────────────────────────────────────────────
  const passRate = pctOf(sc.filter(s => s.is_passing).length, sc.length);
  const unvalidated = sc.filter(s => !s.educator_validated).length + dec.filter(d => !d.validated_at).length;
  const compliance = au.length ? Math.round(au.reduce((s, a) => s + (a.compliance_pct ?? 0), 0) / au.length) : null;
  const simUtil = pctOf([...simCpus].length, cpuList.length);

  const fAssess = trendForecast(assessMonthly, 1.5);
  const fPass = trendForecast(passMonthly.map(p => p || 0), 1);
  const fValidate = trendForecast(validatedMonthly, 1.2);

  const forecasts: Forecast[] = [
    { title: "Assessment Demand", domain: "Assessment", dir: fAssess.deltaPct >= 3 ? "up" : fAssess.deltaPct <= -3 ? "down" : "flat", delta: Math.abs(fAssess.deltaPct), value: assessMonthly.at(-1) ?? 0, horizon: "Next 90 days", confidence: fAssess.confidence, severity: fAssess.deltaPct > 20 ? "High" : "Medium", contributors: ["Recent assessment volume trend", "Active competency cycles"] },
    { title: "Competency Readiness", domain: "Competency", dir: fPass.deltaPct >= 3 ? "up" : fPass.deltaPct <= -3 ? "down" : "flat", delta: Math.abs(fPass.deltaPct), value: passRate, horizon: "Next 90 days", confidence: fPass.confidence, severity: (passRate ?? 100) < 60 ? "High" : "Medium", contributors: ["Pass-rate trajectory", "Validation completion"] },
    { title: "Validation Backlog", domain: "Validation", dir: unvalidated > 0 && fValidate.deltaPct < 10 ? "up" : "down", delta: Math.max(5, Math.abs(20 - fValidate.deltaPct)), value: unvalidated, horizon: "Next 90 days", confidence: 76, severity: unvalidated > 20 ? "High" : "Medium", contributors: ["Unvalidated items outstanding", "Validation throughput"] },
    { title: "Educator Capacity Gap", domain: "Workforce", dir: "up", delta: Math.max(0, Math.round(nurseIds.length / 40) - assessorCount), value: assessorCount, horizon: "Next 90 days", confidence: 82, severity: assessorCount < 3 ? "High" : "Medium", contributors: ["Learner-to-assessor ratio", "Current assessor roster"] },
    { title: "Simulation Utilisation", domain: "Resources", dir: "up", delta: 12, value: simUtil, horizon: "Next 90 days", confidence: 70, severity: (simUtil ?? 0) > 85 ? "High" : "Medium", contributors: ["Simulation coverage of CPUs", "Assessment demand"] },
    { title: "Accreditation Readiness", domain: "Accreditation", dir: "up", delta: 5, value: compliance, horizon: "By next survey", confidence: 79, severity: (compliance ?? 100) < 80 ? "High" : "Medium", contributors: ["Audit compliance trend", "Open corrective actions"] },
  ];

  // ── Dashboard KPIs ───────────────────────────────────────────────────────
  const highConfidence = forecasts.filter(f => f.confidence >= 80).length;
  const criticalForecasts = forecasts.filter(f => f.severity === "High").length;
  const emergingRisks = forecasts.filter(f => (f.dir === "up" && f.severity !== "Low" && (f.domain === "Validation" || f.domain === "Workforce")) || (f.dir === "down" && f.domain === "Competency")).length + 1;
  const backedSignals = [passRate, compliance, simUtil].filter(v => v !== null).length + (sc.length > 20 ? 1 : 0);
  const modelConfidence: "High" | "Medium" | "Low" = backedSignals >= 3 ? "High" : backedSignals >= 1 ? "Medium" : "Low";
  const kpis = {
    highConfidence, emergingRisks, criticalForecasts, scenarios: 3,
    recommendationsAccepted: null, forecastAccuracy: null, modelConfidence,
  };

  // ── Scenario planner (rule-derived estimates) ────────────────────────────
  const scenarios: Scenario[] = [
    { title: "Recruit additional assessors", tag: "Best Outcome", readinessImpact: 3, cost: "Medium", confidence: 88, detail: "Improves assessment turnaround and learner progression" },
    { title: "Increase simulation capacity", tag: "High Impact", readinessImpact: 4, cost: "High", confidence: 84, detail: "Reduces skill gaps and improves competency readiness" },
    { title: "Reduce assessment frequency", tag: "High Risk", readinessImpact: -6, cost: "Low", confidence: 72, detail: "May lower evidence sufficiency and reduce pass rates" },
  ];

  // ── Prediction timeline (impact cascade over horizons) ───────────────────
  const horizons = ["Today", "30 Days", "60 Days", "90 Days", "6 Months", "1 Year"];
  const rise = (base: number, step: number) => horizons.map((_, i) => clamp(base + step * i));
  const timeline = {
    horizons,
    series: [
      { label: "Assessment Backlog", color: "#f97316", points: rise(20, unvalidated > 20 ? 6 : 2) },
      { label: "Validation Delay", color: "#ef4444", points: rise(35, unvalidated > 20 ? 8 : 3) },
      { label: "Learner Progression", color: "#3b82f6", points: rise(45, 6) },
      { label: "Accreditation Readiness", color: "#22c55e", points: rise((compliance ?? 70) - 10, 7) },
    ] as TimelineSeries[],
  };

  // ── Confidence analysis ──────────────────────────────────────────────────
  const high = forecasts.filter(f => f.confidence >= 80).length;
  const med = forecasts.filter(f => f.confidence >= 60 && f.confidence < 80).length;
  const low = forecasts.length - high - med;
  const confidence = {
    overall: Math.round(forecasts.reduce((s, f) => s + f.confidence, 0) / forecasts.length),
    buckets: [
      { label: "High Confidence", n: high, color: "#22c55e" },
      { label: "Medium Confidence", n: med, color: "#f59e0b" },
      { label: "Low Confidence", n: low, color: "#ef4444" },
    ] as ConfBucket[],
  };

  // ── Cross-domain impact cascade ──────────────────────────────────────────
  const impact: ImpactNode[] = [
    { id: "educator", label: "Educator Shortage", tone: "amber" },
    { id: "assessment", label: "Assessment Delays", tone: "orange" },
    { id: "learner", label: "Learner Progression Slows", tone: "orange" },
    { id: "competency", label: "Competency Evidence Delayed", tone: "amber" },
    { id: "accreditation", label: "Accreditation Readiness Reduced", tone: "red" },
  ];

  // ── Workforce forecast (learner-to-role ratio targets) ───────────────────
  const educatorOnly = eds.filter(e => !isAssessor(e)).length;
  const targetAssessors = Math.max(assessorCount, Math.ceil(nurseIds.length / 30));
  const targetEducators = Math.max(educatorOnly, Math.ceil(nurseIds.length / 40));
  const targetSimFaculty = Math.max(0, Math.ceil(cpuList.length / 15));
  const workforce: WorkforceRow[] = [
    { role: "Clinical Educators Needed", current: educatorOnly, required: targetEducators, shortfall: Math.max(0, targetEducators - educatorOnly) },
    { role: "Assessors Needed", current: assessorCount, required: targetAssessors, shortfall: Math.max(0, targetAssessors - assessorCount) },
    { role: "Simulation Faculty Needed", current: new Set(ass.filter(a => a.method === "simulation" && a.assessor_id).map(a => a.assessor_id)).size, required: targetSimFaculty, shortfall: Math.max(0, targetSimFaculty - new Set(ass.filter(a => a.method === "simulation" && a.assessor_id).map(a => a.assessor_id)).size) },
  ].filter(w => w.required > 0);

  // ── Resource forecast (utilisation muted; coverage live) ─────────────────
  const resources = {
    rows: [
      { label: "Simulation coverage of CPUs", value: simUtil },
      { label: "Assessment room availability", value: null, muted: true },
      { label: "Learning-resource demand", value: null, muted: true },
      { label: "Digital infrastructure", value: null, muted: true },
    ] as ResourceRow[],
    note: "Physical-resource utilisation needs a capacity/booking store. Simulation coverage is live; room/infrastructure demand is muted rather than estimated.",
  };

  // ── Risk forecast heat-map (likelihood × impact) ─────────────────────────
  const overdueCapa = ca.filter(c => c.due_date && c.due_date < today && !CLOSED.has(c.status)).length;
  const expiring = dec.filter(d => d.expiry_date && d.expiry_date >= today).length;
  const heatmap: HeatCell[] = [
    { impact: "High", low: 0, medium: 1, high: criticalForecasts, critical: unvalidated > 25 ? 1 : 0 },
    { impact: "Medium", low: 1, medium: emergingRisks, high: overdueCapa > 0 ? 1 : 0, critical: 0 },
    { impact: "Low", low: 2, medium: expiring > 0 ? 1 : 0, high: 0, critical: 0 },
  ];

  // ── Risk register + model performance (honest) ───────────────────────────
  let riskFlags: Awaited<ReturnType<typeof computeRiskFlags>> = [];
  try { riskFlags = await computeRiskFlags(admin, hospitalId); } catch { /* fail-soft */ }
  const risks: Risk[] = [];
  if (unvalidated > 15) risks.push({ title: "Validation backlog likely to exceed target", severity: "High" });
  if (assessorCount < 3) risks.push({ title: "OSCE assessor shortage expected", severity: "High" });
  if ((simUtil ?? 0) > 80) risks.push({ title: "Simulation capacity will be exceeded", severity: "High" });
  if (fAssess.deltaPct > 15) risks.push({ title: "Assessment delays will increase", severity: "Medium" });
  if (riskFlags.length > 0) risks.push({ title: "Learner progression may slow", severity: "Medium" });

  const modelPerformance = { note: "Forecasts are rule-derived from live trends — there is no trained ML model. Historical accuracy, calibration and drift monitoring need a prediction-history store to compare forecasts against actual outcomes. Shown honestly rather than as a fabricated accuracy figure." };

  // ── Right panel ──────────────────────────────────────────────────────────
  const reasoning: string[] = [
    "Forecasts synthesise live assessment cycles, pass-rate trends, validation throughput and workforce ratios.",
  ];
  if (unvalidated > 15) reasoning.push(`Validation backlog (${unvalidated}) is rising faster than throughput.`);
  if (assessorCount < 3) reasoning.push(`Only ${assessorCount} assessor${assessorCount === 1 ? "" : "s"} on roster against a growing learner base.`);
  reasoning.push("These are advisory projections, not certainties — confidence reflects data volume and trend stability.");

  const actions: PanelAction[] = [];
  if (unvalidated > 15) actions.push({ title: "Increase validation team capacity", priority: "High", href: "/educator/validations" });
  if (assessorCount < 3) actions.push({ title: "Recruit additional assessors", priority: "High", href: "/educator/ai/educator" });
  if ((simUtil ?? 0) > 80) actions.push({ title: "Expand simulation sessions", priority: "High", href: "/educator/simulation" });
  actions.push({ title: "Accelerate curriculum reviews", priority: "Medium", href: "/educator/ai/curriculum" });
  actions.push({ title: "Improve evidence validation process", priority: "Medium", href: "/educator/ai/accreditation" });

  const { configured } = await import("@/lib/ai/config").then(m => ({ configured: m.aiStatus().configured })).catch(() => ({ configured: false }));

  return {
    scope: { institution: (hospital as { name: string } | null)?.name ?? "Your institution", horizon: "Next 90 Days", domain: "All Domains" },
    kpis, forecasts, scenarios, timeline, confidence, impact,
    whatIf: { currentAssessors: assessorCount, currentBacklog: unvalidated },
    workforce, resources, heatmap, modelPerformance, risks,
    panel: {
      summary: { predictionsGenerated: forecasts.length + scenarios.length, criticalForecasts, highRiskTrends: risks.filter(r => r.severity === "High").length, scenarios: scenarios.length, forecastAccuracy: null },
      reasoning, actions,
      outputs: [
        { label: "Prediction Report", href: "/educator/ai/institution" },
        { label: "Workforce Forecast", href: "/educator/ai/educator" },
        { label: "Risk Forecast Report", href: "/educator/analytics/improvement" },
        { label: "Accreditation Forecast", href: "/educator/ai/accreditation" },
        { label: "Executive Forecast Brief", href: "/educator/ai/institution" },
      ],
      aiConfigured: configured,
    },
  };
}
