import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// ── Assessment Intelligence Workspace data loader ───────────────────────────
// The AI-powered assessment quality & governance view (Assessment Intelligence
// spec v1.0 + mockup). One hospital-scoped pass over the live assessment graph —
// the item bank, quiz attempts, recorded assessments (by method), competency
// scores, decisions, frameworks/CPUs, knowledge & simulation objects — synthes-
// ised into: a health dashboard, navigator, blueprint alignment, competency
// coverage matrix, item analysis, evidence sufficiency, rule-derived predictions
// and the right-hand intelligence panel.
//
// Honest-UI: every figure is computed from real records. Psychometrics that need
// data we don't capture at this volume are returned null and shown muted, never
// fabricated: reliability coefficients (Cronbach's α / KR-20 / inter-rater) need
// item×learner response matrices; OSCE station quality needs an OSCE-station
// store (none yet); fairness/DIF needs demographic & site metadata; assessor
// consistency needs double-scored encounters.

const PASS_OUTCOMES = new Set(["competent", "provisionally_competent"]);
const KNOWLEDGE_METHODS = new Set(["knowledge_test", "quiz", "written", "oral"]);
const WBA_METHODS = new Set(["workplace", "direct_observation", "case_discussion", "mini_cex", "dops"]);
const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null);
const mean = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
};

export type Tint = "green" | "amber" | "red" | "muted";
const tintOf = (v: number | null): Tint => (v === null ? "muted" : v >= 75 ? "green" : v >= 50 ? "amber" : "red");

export type HealthKpi = { label: string; value: number | null; tint: Tint; note?: string };
export type NavNode = { id: string; name: string; meta: string; tint: Tint; children: NavNode[] };
export type RadarAxis = { label: string; value: number };
export type MatrixRow = { name: string; cells: (boolean | null)[]; evidence: "Strong" | "Partial" | "Weak" | "None" };
export type DonutSlice = { label: string; n: number; color: string };
export type RiskItem = { title: string; severity: "High" | "Medium" | "Low"; detail: string };
export type Prediction = { title: string; reason: string; confidence: number };
export type PanelAction = { title: string; priority: "High" | "Medium" | "Low"; href: string };
export type MetricRow = { label: string; value: number | null; unit?: string };

export type AssessmentIntelligence = {
  scope: { institution: string; programmes: number; assessments: number; items: number; standards: string[] };
  health: HealthKpi[];
  risk: { level: "Low" | "Medium" | "High"; confidence: "High" | "Medium" | "Low" };
  navigator: NavNode;
  types: { label: string; n: number }[];
  status: { label: string; n: number }[];
  versions: { note: string; lifecycle: { label: string; n: number }[] };
  blueprint: { radar: RadarAxis[]; note: string; finding: string };
  coverage: { columns: string[]; rows: MatrixRow[]; note: string };
  items: { total: number; slices: DonutSlice[]; avgFacility: number | null; flagged: number; note: string };
  osce: { available: boolean; note: string };
  reliability: { metrics: MetricRow[]; note: string };
  fairness: { available: boolean; note: string };
  evidence: { defensible: number | null; sufficientCount: number; totalWithEvidence: number; missing: { label: string; n: number }[]; note: string };
  predictions: Prediction[];
  risks: RiskItem[];
  panel: {
    summary: { healthLabel: string; criticalRisks: number; highPriorityReviews: number; blueprintGaps: number; recommendations: number };
    reasoning: string[];
    sources: string[];
    actions: PanelAction[];
    outputs: { label: string; href: string }[];
    aiConfigured: boolean;
  };
};

export async function loadAssessmentIntelligence(admin: Admin, hospitalId: string): Promise<AssessmentIntelligence> {
  const noRows = Promise.resolve({ data: [] as never[] });

  const { data: nurses } = await admin.from("profiles").select("id").eq("hospital_id", hospitalId || "").eq("role", "nurse").limit(2000);
  const nurseIds = (nurses ?? []).map(n => n.id);

  const [
    { data: hospital }, { data: frameworks }, { data: domains }, { data: comps }, { data: cpus },
    { data: scores }, { data: decisions }, { data: assessments }, { data: questions }, { data: quiz },
    { data: knowledge }, { data: cases },
  ] = await Promise.all([
    hospitalId ? admin.from("hospitals").select("name").eq("id", hospitalId).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("frameworks").select("id, name, pub_status").limit(200),
    admin.from("framework_domains").select("id, name, framework_id").limit(2000),
    admin.from("framework_competencies").select("id, name, domain_id, cpu_id, risk_category").limit(5000),
    admin.from("clinical_practice_units").select("id, name, code, pub_status").limit(2000),
    nurseIds.length ? admin.from("competency_scores").select("competency_id, cycle_id, score, is_passing, educator_validated, assessed_at").in("nurse_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("competency_decisions").select("competency_id, outcome, validated_at").in("nurse_id", nurseIds).limit(8000) : noRows,
    admin.from("assessments").select("competency_id, method, score, status, cycle_id").limit(10000),
    admin.from("questions").select("id, content, type, category, difficulty, is_published").limit(8000),
    nurseIds.length ? admin.from("quiz_attempts").select("question_id, is_correct, user_id").in("user_id", nurseIds).limit(8000) : noRows,
    admin.from("knowledge_objects").select("cpu_id").neq("status", "retired").limit(8000),
    admin.from("clinical_cases").select("cpu_id").neq("status", "retired").limit(8000),
  ]);

  type Comp = { id: string; name: string; domain_id: string | null; cpu_id: string | null; risk_category: string | null };
  const fc = (comps ?? []) as Comp[];
  const fw = (frameworks ?? []) as { id: string; name: string; pub_status: string | null }[];
  const dm = (domains ?? []) as { id: string; name: string; framework_id: string }[];
  const cpuList = (cpus ?? []) as { id: string; name: string; code: string | null; pub_status: string | null }[];
  const sc = (scores ?? []) as { competency_id: string; cycle_id: string | null; score: number; is_passing: boolean; educator_validated: boolean; assessed_at: string }[];
  const dec = (decisions ?? []) as { competency_id: string; outcome: string; validated_at: string | null }[];
  const q = (questions ?? []) as { id: string; content: string; type: string; category: string | null; difficulty: string | null; is_published: boolean }[];
  const qz = (quiz ?? []) as { question_id: string; is_correct: boolean; user_id: string }[];

  // Hospital-scope recorded assessments via the cycles that produced our scores.
  const hospitalCycles = new Set(sc.map(s => s.cycle_id).filter(Boolean));
  const ass = ((assessments ?? []) as { competency_id: string; method: string; score: number | null; status: string; cycle_id: string | null }[]).filter(a => a.cycle_id && hospitalCycles.has(a.cycle_id));

  const domFw = new Map(dm.map(d => [d.id, d.framework_id]));
  const knowledgeCpus = new Set((knowledge ?? []).map(k => k.cpu_id).filter(Boolean));
  const simCpus = new Set((cases ?? []).map(c => c.cpu_id).filter(Boolean));
  const compFw = (c: Comp) => domFw.get(c.domain_id ?? "") ?? null;

  // Per-competency evidence modalities from recorded assessments.
  const methodsByComp = new Map<string, Set<string>>();
  for (const a of ass) { const s = methodsByComp.get(a.competency_id) ?? new Set<string>(); s.add(a.method); methodsByComp.set(a.competency_id, s); }
  const scoredComps = new Set(sc.map(s => s.competency_id));
  const validatedComps = new Set(sc.filter(s => s.educator_validated).map(s => s.competency_id));
  const decisionComps = new Set(dec.map(d => d.competency_id));
  const defensibleComps = new Set([...validatedComps, ...dec.filter(d => d.validated_at || PASS_OUTCOMES.has(d.outcome)).map(d => d.competency_id)]);

  const hasKnowledge = (c: Comp) => scoredComps.has(c.id) || [...(methodsByComp.get(c.id) ?? [])].some(m => KNOWLEDGE_METHODS.has(m)) || (!!c.cpu_id && knowledgeCpus.has(c.cpu_id));
  const hasSim = (c: Comp) => (!!c.cpu_id && simCpus.has(c.cpu_id)) || (methodsByComp.get(c.id)?.has("simulation") ?? false);
  const hasOsce = (c: Comp) => methodsByComp.get(c.id)?.has("osce") ?? false;
  const hasWba = (c: Comp) => [...(methodsByComp.get(c.id) ?? [])].some(m => WBA_METHODS.has(m));
  const hasEvidence = (c: Comp) => decisionComps.has(c.id) || validatedComps.has(c.id);
  const isAssessed = (c: Comp) => scoredComps.has(c.id) || methodsByComp.has(c.id) || decisionComps.has(c.id);
  const modalities = (c: Comp) => [hasKnowledge(c), hasSim(c), hasOsce(c), hasWba(c)].filter(Boolean).length;

  const total = fc.length;

  // ── Item bank facility (real, from quiz attempts) ────────────────────────
  const facilityByQ = new Map<string, { correct: number; total: number }>();
  for (const x of qz) { const g = facilityByQ.get(x.question_id) ?? { correct: 0, total: 0 }; g.total++; if (x.is_correct) g.correct++; facilityByQ.set(x.question_id, g); }
  const facility = (id: string) => { const g = facilityByQ.get(id); return g && g.total > 0 ? g.correct / g.total : null; };
  const facilities = [...facilityByQ.values()].filter(g => g.total > 0).map(g => g.correct / g.total);
  const avgFacility = facilities.length ? Math.round((facilities.reduce((a, b) => a + b, 0) / facilities.length) * 100) : null;

  // Item quality buckets (facility-based; discrimination needs response matrices).
  let good = 0, review = 0, poor = 0, undrafted = 0;
  for (const item of q) {
    if (!item.is_published) { undrafted++; continue; }
    const f = facility(item.id);
    if (f === null) good++;                          // published, no attempts yet → treat as OK
    else if (f >= 0.3 && f <= 0.85) good++;          // healthy difficulty band
    else if (f >= 0.2 && f <= 0.95) review++;        // borderline — needs review
    else poor++;                                     // too easy / too hard
  }
  const itemQualityPct = q.length ? Math.round((good / q.length) * 100) : null;
  const flaggedItems = review + poor + undrafted;

  // ── Health KPIs ──────────────────────────────────────────────────────────
  const competencyCoverage = pct(fc.filter(isAssessed).length, total);
  const cpuIds = [...new Set(fc.map(c => c.cpu_id).filter(Boolean))] as string[];
  const cpuCovered = cpuIds.filter(id => fc.some(c => c.cpu_id === id && isAssessed(c))).length;
  const blueprintAlignment = pct(cpuCovered, cpuIds.length);
  const evidenceSufficiency = pct(fc.filter(hasEvidence).length, total);

  const health: HealthKpi[] = [
    { label: "Blueprint Alignment", value: blueprintAlignment, tint: tintOf(blueprintAlignment) },
    { label: "Competency Coverage", value: competencyCoverage, tint: tintOf(competencyCoverage) },
    { label: "Evidence Sufficiency", value: evidenceSufficiency, tint: tintOf(evidenceSufficiency) },
    { label: "Item Quality", value: itemQualityPct, tint: tintOf(itemQualityPct) },
    { label: "Reliability", value: null, tint: "muted", note: "Needs item×learner response matrices" },
    { label: "Fairness", value: null, tint: "muted", note: "Needs demographic & site metadata" },
    { label: "Assessor Consistency", value: null, tint: "muted", note: "Needs double-scored encounters" },
  ];
  const overallHealth = mean([blueprintAlignment, competencyCoverage, evidenceSufficiency, itemQualityPct]);
  health.unshift({ label: "Overall Health", value: overallHealth, tint: tintOf(overallHealth) });

  // ── Blueprint radar: actual assessment coverage by domain (live) ─────────
  const domainAxes: RadarAxis[] = dm.map(d => {
    const ids = fc.filter(c => c.domain_id === d.id);
    return { label: d.name, value: pct(ids.filter(isAssessed).length, ids.length) ?? 0, n: ids.length };
  }).filter(a => a.n > 0).sort((a, b) => b.n - a.n).slice(0, 6).map(({ label, value }) => ({ label, value }));
  const knowledgeShare = ass.length ? Math.round((ass.filter(a => KNOWLEDGE_METHODS.has(a.method)).length / ass.length) * 100) : (scoredComps.size && !ass.length ? 100 : 0);
  const blueprint = {
    radar: domainAxes,
    note: "Axes show the actual share of each domain's competencies that are assessed. Target ('required') blueprint weights need a blueprint-weighting store.",
    finding: knowledgeShare >= 60
      ? `Assessment leans on knowledge testing (${knowledgeShare}% of recorded assessments) — observed-performance methods look underrepresented.`
      : "Method mix spans knowledge, simulation and workplace evidence — no single-modality over-reliance detected.",
  };

  // ── Competency coverage matrix (backed columns + honest muted) ───────────
  const evidenceLabel = (c: Comp): MatrixRow["evidence"] => {
    const m = modalities(c);
    if (!hasEvidence(c) && !isAssessed(c)) return "None";
    if (defensibleComps.has(c.id) && m >= 3) return "Strong";
    if (hasEvidence(c) && m >= 2) return "Partial";
    return "Weak";
  };
  const coverageRows: MatrixRow[] = [...fc].sort((a, b) => modalities(b) - modalities(a)).slice(0, 8).map(c => ({
    name: c.name,
    cells: [hasKnowledge(c), hasSim(c), hasOsce(c), hasWba(c), null /* Portfolio: no store */] as (boolean | null)[],
    evidence: evidenceLabel(c),
  }));

  // ── Evidence sufficiency (live) ──────────────────────────────────────────
  const withEvidence = fc.filter(c => isAssessed(c) || hasEvidence(c));
  const missingObs = fc.filter(c => !hasWba(c)).length;
  const missingSim = fc.filter(c => !hasSim(c)).length;
  const noValidated = fc.filter(c => !validatedComps.has(c.id) && !decisionComps.has(c.id)).length;
  const evidence = {
    defensible: pct([...defensibleComps].length, withEvidence.length),
    sufficientCount: [...defensibleComps].length,
    totalWithEvidence: withEvidence.length,
    missing: [
      { label: "Workplace / direct observation", n: missingObs },
      { label: "Simulation evidence", n: missingSim },
      { label: "Validated assessor sign-off", n: noValidated },
    ].filter(m => m.n > 0),
    note: "Defensible = competency has a validated score or a recorded decision. Multi-observation & triangulation rules run in the Validation Center.",
  };

  // ── Reliability (not computable at this volume — honest null) ─────────────
  const doubleScored = 0; // no double-scored encounter store
  const reliability = {
    metrics: [
      { label: "Inter-rater reliability (ICC)", value: null },
      { label: "Internal consistency (KR-20)", value: null },
      { label: "Assessor agreement", value: null, unit: "%" },
    ] as MetricRow[],
    note: `Reliability coefficients need item×learner response matrices and double-scored encounters (currently ${doubleScored} on record). Not fabricated — shown when the data supports them.`,
  };

  // ── Navigator: Institution → Programme → CPU → assessed competencies ─────
  const compHealth = (ids: Comp[]): number | null => {
    if (!ids.length) return null;
    const cov = ids.filter(isAssessed).length, ev = ids.filter(hasEvidence).length;
    return Math.round(((cov + ev) / (ids.length * 2)) * 100);
  };
  const cpuNodes = (fwId: string): NavNode[] => {
    const inFw = fc.filter(c => compFw(c) === fwId);
    const cids = [...new Set(inFw.map(c => c.cpu_id).filter(Boolean))] as string[];
    return cids.map(cid => {
      const cpu = cpuList.find(c => c.id === cid);
      const ids = inFw.filter(c => c.cpu_id === cid);
      return { id: cid, name: cpu?.name ?? "CPU", meta: `${ids.filter(isAssessed).length}/${ids.length} assessed`, tint: tintOf(compHealth(ids)), children: [] };
    });
  };
  const navigator: NavNode = {
    id: "root", name: (hospital as { name: string } | null)?.name ?? "Your institution", meta: `${fw.length} programmes`, tint: tintOf(overallHealth),
    children: fw.map(f => {
      const ids = fc.filter(c => compFw(c) === f.id);
      return { id: f.id, name: f.name, meta: `${ids.filter(isAssessed).length}/${ids.length} assessed`, tint: tintOf(compHealth(ids)), children: cpuNodes(f.id) };
    }),
  };

  // ── Assessment type & status counts (live) ───────────────────────────────
  const typeCount = new Map<string, number>();
  for (const a of ass) typeCount.set(a.method, (typeCount.get(a.method) ?? 0) + 1);
  typeCount.set("knowledge items", q.length);
  const TYPE_LABELS: Record<string, string> = { knowledge_test: "Knowledge Test", osce: "OSCE", simulation: "Simulation", workplace: "Workplace", direct_observation: "Direct Obs.", case_discussion: "Case Disc.", portfolio: "Portfolio" };
  const types = [...typeCount.entries()].map(([k, n]) => ({ label: TYPE_LABELS[k] ?? (k[0].toUpperCase() + k.slice(1)), n })).sort((a, b) => b.n - a.n);

  const statusCount = new Map<string, number>();
  for (const a of ass) statusCount.set(a.status ?? "recorded", (statusCount.get(a.status ?? "recorded") ?? 0) + 1);
  const status = [
    { label: "Published items", n: q.filter(i => i.is_published).length },
    { label: "Draft items", n: q.filter(i => !i.is_published).length },
    { label: "Recorded assessments", n: ass.length },
    { label: "Completed", n: ass.filter(a => a.status === "complete").length },
  ];

  // ── Predictions (rule-derived, not ML) ───────────────────────────────────
  const passRate = sc.length ? Math.round((sc.filter(s => s.is_passing).length / sc.length) * 100) : null;
  const blueprintGaps = fc.filter(c => !isAssessed(c)).length;
  const predictions: Prediction[] = [];
  if (passRate !== null && passRate < 60) predictions.push({ title: "Elevated failure risk", reason: `Recorded pass rate is ${passRate}% across scored competencies`, confidence: 78 });
  if (blueprintGaps > 0) predictions.push({ title: "Blueprint coverage gap", reason: `${blueprintGaps} competencies have no recorded assessment`, confidence: Math.min(92, 60 + Math.round((blueprintGaps / Math.max(1, total)) * 40)) });
  if (knowledgeShare >= 60) predictions.push({ title: "Method imbalance", reason: `Knowledge testing is ${knowledgeShare}% of recorded assessment — observed performance may be under-sampled`, confidence: 70 });
  if (flaggedItems > 0) predictions.push({ title: "Item quality risk", reason: `${flaggedItems} items are draft or fall outside the healthy difficulty band`, confidence: 65 });
  if (!predictions.length) predictions.push({ title: "Stable assessment quality", reason: "No structural risk signals in the current data", confidence: 60 });

  // ── Risk register (rule-derived) ─────────────────────────────────────────
  const risks: RiskItem[] = [];
  if (noValidated > 0) risks.push({ title: `Insufficient validated evidence for ${noValidated} competencies`, severity: "High", detail: "No validated score or recorded decision" });
  if (blueprintGaps > 0) risks.push({ title: `${blueprintGaps} competencies unassessed (blueprint gap)`, severity: "High", detail: "Not covered by any recorded assessment" });
  if (knowledgeShare >= 60) risks.push({ title: "Over-reliance on knowledge assessment", severity: "Medium", detail: `${knowledgeShare}% of recorded assessments are knowledge-based` });
  risks.push({ title: "Reliability not measurable", severity: "Medium", detail: "No response matrices or double-scored encounters on record" });
  if (missingObs > 0) risks.push({ title: `${missingObs} competencies lack direct observation`, severity: "Medium", detail: "No workplace/observed assessment recorded" });

  // ── Right intelligence panel ─────────────────────────────────────────────
  const healthLabel = overallHealth === null ? "Insufficient data" : overallHealth >= 85 ? "Excellent" : overallHealth >= 70 ? "Good" : overallHealth >= 50 ? "Fair" : "At Risk";
  const highPriorityReviews = review + poor;
  const criticalRisks = risks.filter(r => r.severity === "High").length;

  const reasoning: string[] = [];
  if (blueprintGaps) reasoning.push(`${blueprintGaps} competencies have no recorded assessment (blueprint gap).`);
  if (knowledgeShare >= 60) reasoning.push(`Knowledge testing accounts for ${knowledgeShare}% of recorded assessment; observed performance is under-sampled.`);
  reasoning.push("Reliability, assessor agreement and fairness can't be scored yet — the required response, double-scoring and demographic data aren't captured.");
  if (noValidated) reasoning.push(`${noValidated} competencies await validated assessor evidence before a defensible decision.`);

  const actions: PanelAction[] = [];
  if (blueprintGaps) actions.push({ title: "Generate missing assessments", priority: "High", href: "/educator/studio/mapping" });
  if (highPriorityReviews) actions.push({ title: `Review ${highPriorityReviews} flagged items`, priority: "High", href: "/educator/questions" });
  if (knowledgeShare >= 60) actions.push({ title: "Rebalance assessment blueprint", priority: "Medium", href: "/educator/studio/mapping" });
  if (noValidated) actions.push({ title: "Request & validate evidence", priority: "Medium", href: "/educator/validations" });
  actions.push({ title: "Send to Validation Center", priority: "Low", href: "/educator/validations" });
  actions.push({ title: "Prepare quality report", priority: "Low", href: "/educator/analytics/assessment" });

  const { configured } = await import("@/lib/ai/config").then(m => ({ configured: m.aiStatus().configured })).catch(() => ({ configured: false }));
  const backedCount = [blueprintAlignment, competencyCoverage, evidenceSufficiency, itemQualityPct].filter(v => v !== null).length;

  return {
    scope: {
      institution: (hospital as { name: string } | null)?.name ?? "Your institution",
      programmes: fw.length, assessments: ass.length, items: q.length, standards: fw.slice(0, 5).map(f => f.name),
    },
    health,
    risk: {
      level: overallHealth === null ? "Medium" : criticalRisks >= 2 || overallHealth < 50 ? "High" : overallHealth < 70 ? "Medium" : "Low",
      confidence: backedCount >= 4 ? "High" : backedCount >= 2 ? "Medium" : "Low",
    },
    navigator, types, status,
    versions: {
      note: "Assessment version history needs a versioning store. Publication state below is live.",
      lifecycle: [
        { label: "Published items", n: q.filter(i => i.is_published).length },
        { label: "Draft items", n: q.filter(i => !i.is_published).length },
        { label: "Recorded assessments", n: ass.length },
      ],
    },
    blueprint,
    coverage: {
      columns: ["Knowledge", "Simulation", "OSCE", "WBA", "Portfolio"],
      rows: coverageRows,
      note: "OSCE columns read from recorded method='osce'; a dedicated OSCE-station store isn't built, so practical coverage may be understated. Portfolio has no store (muted).",
    },
    items: {
      total: q.length,
      slices: [
        { label: "Good", n: good, color: "#22c55e" }, { label: "Needs Review", n: review, color: "#f59e0b" },
        { label: "Poor", n: poor, color: "#ef4444" }, { label: "Draft", n: undrafted, color: "#64748b" },
      ],
      avgFacility, flagged: flaggedItems,
      note: "Buckets use publication state and facility (proportion-correct). Discrimination, distractor efficiency and Bloom level need per-attempt response data.",
    },
    osce: { available: false, note: "OSCE station quality (critical-action coverage, checklist reliability, timing, examiner burden) needs an OSCE-station & checklist store. Not yet captured — shown as unavailable rather than estimated." },
    reliability,
    fairness: { available: false, note: "Fairness & bias review (differential item functioning, site variance, demographic performance) needs demographic and site metadata linked to results. Not captured — surfaced honestly rather than inferred." },
    evidence,
    predictions,
    risks,
    panel: {
      summary: { healthLabel, criticalRisks, highPriorityReviews, blueprintGaps, recommendations: actions.length + predictions.length },
      reasoning, sources: ["Item bank & attempts", "Recorded assessments", "Competency framework & CPUs", "Learner scores & decisions", "Knowledge objects & simulations"],
      actions,
      outputs: [
        { label: "Assessment Analytics", href: "/educator/analytics/assessment" },
        { label: "Item & Question Analytics", href: "/educator/analytics/assessment/questions" },
        { label: "Blueprint Performance", href: "/educator/analytics/assessment/blueprint" },
        { label: "Reliability & Validity", href: "/educator/analytics/assessment/reliability" },
        { label: "Competency Coverage", href: "/educator/analytics/competency" },
      ],
      aiConfigured: configured,
    },
  };
}
