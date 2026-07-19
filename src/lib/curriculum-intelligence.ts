import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// ── Curriculum Intelligence Workspace data loader ───────────────────────────
// The AI-powered curriculum governance view (Curriculum Intelligence spec v1.0 +
// mockup). One hospital-scoped pass over the live curriculum graph — frameworks
// (curricula), domains, CPUs, competencies, assessments, evidence, simulations,
// knowledge and courses — synthesised into the workspace's slices: a health
// dashboard, navigator hierarchy, curriculum map, gap/alignment/coverage
// analysis, assessment intelligence, timeline, impact analysis, improvement
// opportunities, rule-derived predictions and the right-hand intelligence panel.
//
// Honest-UI: every figure is computed from real records. Dimensions with no
// backing store (formal version history, academic year/semester/module layers,
// OSCE/portfolio/reflection evidence types, ML predictions) return null or are
// clearly labelled as proxies/rule-derived — never fabricated.

const PASS_OUTCOMES = new Set(["competent", "provisionally_competent"]);
const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null);
const mean = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
};

export type Tint = "green" | "amber" | "red" | "muted";
const tintOf = (v: number | null): Tint => (v === null ? "muted" : v >= 75 ? "green" : v >= 50 ? "amber" : "red");

export type HealthKpi = { label: string; value: number | null; tint: Tint };
export type NavNode = { id: string; name: string; meta: string; tint: Tint; children: NavNode[] };
export type MapNode = { id: string; label: string; count: number | null; proxy?: boolean };
export type CiGap = { id: string; name: string; category: string; severity: "Critical" | "High" | "Medium" | "Low"; rootCause: string };
export type RadarAxis = { label: string; value: number; proxy?: boolean };
export type MatrixRow = { name: string; cells: (boolean | null)[] };
export type DonutSlice = { label: string; value: number; color: string };
export type TimelineStage = { label: string; n: number; state: "done" | "current" | "upcoming" };
export type Prediction = { title: string; reason: string; confidence: number };
export type StandardStatus = { name: string; coverage: number | null };
export type PanelAction = { title: string; priority: "High" | "Medium" | "Low"; href: string };

export type CurriculumIntelligence = {
  scope: { institution: string; programmes: number; standards: string[]; competencies: number; cpus: number };
  health: HealthKpi[];
  risk: { level: "Low" | "Medium" | "High"; confidence: "High" | "Medium" | "Low" };
  navigator: NavNode;
  versions: { note: string; lifecycle: { label: string; n: number }[] };
  map: MapNode[];
  gaps: { total: number; critical: number; register: CiGap[]; severity: { label: string; n: number; color: string }[] };
  alignment: RadarAxis[];
  coverage: { columns: string[]; rows: MatrixRow[]; note: string };
  assessment: { slices: DonutSlice[]; overall: number | null; note: string };
  timeline: TimelineStage[];
  impact: { subject: string | null; items: { label: string; count: number }[]; note: string } | null;
  improvements: { title: string; detail: string; href: string }[];
  predictions: Prediction[];
  panel: {
    summary: { healthLabel: string; currentRisks: number; immediateAttention: number; recommendedImprovements: number; pendingReviews: number };
    reasoning: string[];
    standards: StandardStatus[];
    actions: PanelAction[];
    outputs: { label: string; href: string }[];
    aiConfigured: boolean;
  };
};

export async function loadCurriculumIntelligence(admin: Admin, hospitalId: string): Promise<CurriculumIntelligence> {
  const noRows = Promise.resolve({ data: [] as never[] });

  const { data: nurses } = await admin.from("profiles").select("id").eq("hospital_id", hospitalId || "").eq("role", "nurse").limit(2000);
  const nurseIds = (nurses ?? []).map(n => n.id);

  const [
    { data: hospital }, { data: frameworks }, { data: domains }, { data: comps }, { data: cpus },
    { data: scores }, { data: decisions }, { data: assessments }, { data: resourceLinks },
    { data: knowledge }, { data: cases }, { data: courses }, { data: audits },
  ] = await Promise.all([
    hospitalId ? admin.from("hospitals").select("name").eq("id", hospitalId).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("frameworks").select("id, name, library, pub_status").limit(200),
    admin.from("framework_domains").select("id, name, framework_id").limit(2000),
    admin.from("framework_competencies").select("id, name, domain_id, cpu_id, risk_category").limit(5000),
    admin.from("clinical_practice_units").select("id, name, code, risk_category, pub_status").limit(2000),
    nurseIds.length ? admin.from("competency_scores").select("competency_id, is_passing, educator_validated").in("nurse_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("competency_decisions").select("competency_id, outcome").in("nurse_id", nurseIds).limit(8000) : noRows,
    admin.from("assessments").select("competency_id, method").limit(10000),
    admin.from("resource_competencies").select("competency_id").limit(8000),
    admin.from("knowledge_objects").select("cpu_id").neq("status", "retired").limit(8000),
    admin.from("clinical_cases").select("cpu_id").neq("status", "retired").limit(8000),
    admin.from("courses").select("id").eq("is_published", true).limit(2000),
    hospitalId ? admin.from("audits").select("compliance_pct").eq("hospital_id", hospitalId).limit(2000) : noRows,
  ]);

  type Comp = { id: string; name: string; domain_id: string | null; cpu_id: string | null; risk_category: string | null };
  const fc = (comps ?? []) as Comp[];
  const fw = (frameworks ?? []) as { id: string; name: string; library: string | null; pub_status: string | null }[];
  const dm = (domains ?? []) as { id: string; name: string; framework_id: string }[];
  const cpuList = (cpus ?? []) as { id: string; name: string; code: string | null; risk_category: string | null; pub_status: string | null }[];
  const sc = (scores ?? []) as { competency_id: string; is_passing: boolean; educator_validated: boolean }[];
  const dec = (decisions ?? []) as { competency_id: string; outcome: string }[];
  const au = (audits ?? []) as { compliance_pct: number | null }[];

  const domFw = new Map(dm.map(d => [d.id, d.framework_id]));
  const knowledgeCpus = new Set((knowledge ?? []).map(k => k.cpu_id).filter(Boolean));
  const simCpus = new Set((cases ?? []).map(c => c.cpu_id).filter(Boolean));
  const resourceComps = new Set((resourceLinks ?? []).map(r => r.competency_id));

  const assessMethods = new Map<string, Set<string>>();
  for (const a of (assessments ?? []) as { competency_id: string; method: string }[]) {
    const s = assessMethods.get(a.competency_id) ?? new Set<string>();
    s.add(a.method); assessMethods.set(a.competency_id, s);
  }
  const scoredComps = new Set(sc.map(s => s.competency_id));
  const evidenceComps = new Set(dec.map(d => d.competency_id));
  const achievedComps = new Set([...dec.filter(d => PASS_OUTCOMES.has(d.outcome)).map(d => d.competency_id), ...sc.filter(s => s.is_passing).map(s => s.competency_id)]);
  const hasAssessment = (id: string) => assessMethods.has(id) || scoredComps.has(id);
  const compFw = (c: Comp) => domFw.get(c.domain_id ?? "") ?? null;

  const total = fc.length;

  // ── Health KPIs (all live) ──────────────────────────────────────────────
  const assessmentCoverage = pct(fc.filter(c => hasAssessment(c.id)).length, total);
  const competencyCoverage = pct(fc.filter(c => c.domain_id && c.cpu_id).length, total); // structural: in the domain→CPU chain
  const evidenceSufficiency = pct(evidenceComps.size, total);
  const alignmentScore = pct(fc.filter(c => c.cpu_id && compFw(c)).length, total); // competency→CPU→framework chain intact
  const standardsCompliance = au.length ? Math.round(au.reduce((s, a) => s + (a.compliance_pct ?? 0), 0) / au.length) : pct(fw.filter(f => f.pub_status === "published").length, fw.length);
  const attainment = pct(fc.filter(c => achievedComps.has(c.id)).length, total);
  const overallHealth = mean([alignmentScore, competencyCoverage, assessmentCoverage, evidenceSufficiency, standardsCompliance, attainment]);

  const health: HealthKpi[] = [
    { label: "Overall Health", value: overallHealth, tint: tintOf(overallHealth) },
    { label: "Alignment Score", value: alignmentScore, tint: tintOf(alignmentScore) },
    { label: "Competency Coverage", value: competencyCoverage, tint: tintOf(competencyCoverage) },
    { label: "Assessment Coverage", value: assessmentCoverage, tint: tintOf(assessmentCoverage) },
    { label: "Evidence Sufficiency", value: evidenceSufficiency, tint: tintOf(evidenceSufficiency) },
    { label: "Standards Compliance", value: standardsCompliance, tint: tintOf(standardsCompliance) },
  ];

  // ── Gap detection (rule-based over the live graph) ───────────────────────
  const gapItems: CiGap[] = [];
  for (const c of fc) {
    if (!hasAssessment(c.id)) gapItems.push({ id: `${c.id}:a`, name: c.name, category: "Assessment", severity: c.risk_category === "high" ? "Critical" : "High", rootCause: "No assessment mapped" });
    if (!c.cpu_id) gapItems.push({ id: `${c.id}:c`, name: c.name, category: "CPU", severity: "High", rootCause: "Not mapped to a CPU" });
    else if (!simCpus.has(c.cpu_id)) gapItems.push({ id: `${c.id}:s`, name: c.name, category: "Simulation", severity: "Medium", rootCause: "No simulation for this CPU" });
    if (!resourceComps.has(c.id) && !(c.cpu_id && knowledgeCpus.has(c.cpu_id))) gapItems.push({ id: `${c.id}:r`, name: c.name, category: "Learning resource", severity: "Low", rootCause: "No learning content linked" });
    if (!evidenceComps.has(c.id)) gapItems.push({ id: `${c.id}:e`, name: c.name, category: "Evidence", severity: c.risk_category === "high" ? "High" : "Medium", rootCause: "No observed practice evidence" });
  }
  const SEV_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  gapItems.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  const sevCount = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const g of gapItems) sevCount[g.severity]++;

  // ── Navigator hierarchy: Institution → Frameworks → Domains → CPUs ───────
  const compHealth = (ids: Set<string>): number | null => {
    if (!ids.size) return null;
    const cov = [...ids].filter(id => hasAssessment(id)).length;
    const ev = [...ids].filter(id => evidenceComps.has(id)).length;
    return Math.round(((cov + ev) / (ids.size * 2)) * 100);
  };
  const cpuNodes = (fwId: string, domId: string): NavNode[] => {
    const inDomain = fc.filter(c => c.domain_id === domId);
    const cpuIds = [...new Set(inDomain.map(c => c.cpu_id).filter(Boolean))] as string[];
    return cpuIds.map(cid => {
      const cpu = cpuList.find(c => c.id === cid);
      const ids = new Set(inDomain.filter(c => c.cpu_id === cid).map(c => c.id));
      const h = compHealth(ids);
      return { id: cid, name: cpu?.name ?? "CPU", meta: `${cpu?.code ?? ""} · ${ids.size} comp`.trim(), tint: tintOf(h), children: [] };
    });
  };
  const domainNodes = (fwId: string): NavNode[] =>
    dm.filter(d => d.framework_id === fwId).map(d => {
      const ids = new Set(fc.filter(c => c.domain_id === d.id).map(c => c.id));
      return { id: d.id, name: d.name, meta: `${ids.size} competenc${ids.size === 1 ? "y" : "ies"}`, tint: tintOf(compHealth(ids)), children: cpuNodes(fwId, d.id) };
    });
  const navigator: NavNode = {
    id: "root", name: (hospital as { name: string } | null)?.name ?? "Your institution", meta: `${fw.length} curricula`, tint: tintOf(overallHealth),
    children: fw.map(f => {
      const ids = new Set(fc.filter(c => compFw(c) === f.id).map(c => c.id));
      return { id: f.id, name: f.name, meta: `${f.pub_status ?? "draft"} · ${ids.size} comp`, tint: tintOf(compHealth(ids)), children: domainNodes(f.id) };
    }),
  };

  // ── Curriculum map (the digital-twin object chain) ───────────────────────
  const assessedDistinct = new Set([...assessMethods.keys(), ...scoredComps]).size;
  const map: MapNode[] = [
    { id: "domains", label: "Domains", count: dm.length },
    { id: "courses", label: "Courses", count: (courses ?? []).length },
    { id: "cpus", label: "CPUs", count: cpuList.length },
    { id: "competencies", label: "Competencies", count: total },
    { id: "assessments", label: "Assessments", count: assessedDistinct },
    { id: "evidence", label: "Evidence", count: evidenceComps.size },
    { id: "resources", label: "Learning Resources", count: resourceComps.size },
    { id: "outcomes", label: "Outcomes", count: achievedComps.size, proxy: true },
  ];

  // ── Alignment radar (chain-integrity ratios; some proxied) ───────────────
  const withDomain = fc.filter(c => c.domain_id).length;
  const alignment: RadarAxis[] = [
    { label: "Domain → CPU", value: pct(fc.filter(c => c.domain_id && c.cpu_id).length, withDomain) ?? 0 },
    { label: "CPU → Competency", value: pct(fc.filter(c => c.cpu_id).length, total) ?? 0 },
    { label: "Competency → Assessment", value: assessmentCoverage ?? 0 },
    { label: "Assessment → Evidence", value: evidenceSufficiency ?? 0 },
    { label: "Evidence → Standards", value: standardsCompliance ?? 0 },
    { label: "Framework alignment", value: alignmentScore ?? 0 },
  ];

  // ── Competency coverage matrix (backed columns + honest gaps) ────────────
  const coverageRows: MatrixRow[] = fc.slice(0, 10).map(c => ({
    name: c.name,
    cells: [
      !!c.cpu_id && knowledgeCpus.has(c.cpu_id), // Knowledge
      hasAssessment(c.id),                        // Assessment
      !!c.cpu_id && simCpus.has(c.cpu_id),        // Simulation
      evidenceComps.has(c.id),                    // Evidence
      null,                                       // OSCE — no store
      null,                                       // Clinical practice — no store
      null,                                       // Portfolio — no store
    ] as (boolean | null)[],
  }));

  // ── Assessment intelligence (coverage by domain, live) ───────────────────
  const DONUT = ["#22c55e", "#3b82f6", "#f59e0b", "#a855f7", "#06b6d4", "#ec4899", "#14b8a6", "#eab308"];
  const domSlices = dm.map((d, i) => {
    const ids = fc.filter(c => c.domain_id === d.id);
    const cov = pct(ids.filter(c => hasAssessment(c.id)).length, ids.length);
    return { label: d.name, value: cov ?? 0, color: DONUT[i % DONUT.length], n: ids.length };
  }).filter(s => s.n > 0).sort((a, b) => b.value - a.value).slice(0, 6).map(({ label, value, color }) => ({ label, value, color }));

  // ── Timeline (real lifecycle stages; formal versioning not stored) ───────
  const lifeCount = (status: string) => fw.filter(f => f.pub_status === status).length + cpuList.filter(c => c.pub_status === status).length;
  const timeline: TimelineStage[] = [
    { label: "Draft", n: lifeCount("draft"), state: "done" },
    { label: "In Review", n: lifeCount("review"), state: "current" },
    { label: "Published", n: lifeCount("published") + fw.filter(f => f.pub_status === "active").length, state: "done" },
    { label: "Archived", n: lifeCount("archived"), state: "upcoming" },
  ];

  // ── Impact analysis (digital-twin dependents of the highest-risk item) ───
  const impactSubject = [...fc].sort((a, b) => {
    const ra = a.risk_category === "high" ? 0 : 1, rb = b.risk_category === "high" ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return (hasAssessment(a.id) ? 1 : 0) - (hasAssessment(b.id) ? 1 : 0);
  })[0] ?? null;
  const impact = impactSubject ? {
    subject: impactSubject.name,
    items: [
      { label: "Assessments", count: (assessMethods.get(impactSubject.id)?.size ?? 0) },
      { label: "CPU", count: impactSubject.cpu_id ? 1 : 0 },
      { label: "Simulations", count: impactSubject.cpu_id && simCpus.has(impactSubject.cpu_id) ? 1 : 0 },
      { label: "Learning Resources", count: (resourceComps.has(impactSubject.id) ? 1 : 0) + (impactSubject.cpu_id && knowledgeCpus.has(impactSubject.cpu_id) ? 1 : 0) },
      { label: "Evidence Records", count: dec.filter(d => d.competency_id === impactSubject.id).length + sc.filter(s => s.competency_id === impactSubject.id).length },
      { label: "Standards", count: compFw(impactSubject) ? 1 : 0 },
    ],
    note: "Dependents traced live across the curriculum graph. Learner/educator impact needs a change-event store.",
  } : null;

  // ── Improvement opportunities (rule-derived, actionable) ─────────────────
  const nameCounts = new Map<string, number>();
  for (const c of fc) nameCounts.set(c.name.trim().toLowerCase(), (nameCounts.get(c.name.trim().toLowerCase()) ?? 0) + 1);
  const duplicates = [...nameCounts.values()].filter(n => n > 1).length;
  const missingSim = fc.filter(c => !(c.cpu_id && simCpus.has(c.cpu_id))).length;
  const missingAssess = fc.filter(c => !hasAssessment(c.id)).length;
  const draftFw = fw.filter(f => f.pub_status === "draft").length;
  const improvements: CurriculumIntelligence["improvements"] = [];
  if (duplicates) improvements.push({ title: "Merge duplicate competencies", detail: `${duplicates} competency name${duplicates === 1 ? "" : "s"} repeat across the framework`, href: "/educator/analytics/competency/gaps" });
  if (missingAssess) improvements.push({ title: "Complete the assessment blueprint", detail: `${missingAssess} competencies have no assessment mapped`, href: "/educator/studio/mapping" });
  if (missingSim) improvements.push({ title: "Increase simulation exposure", detail: `${missingSim} competencies lack a linked simulation`, href: "/educator/simulation" });
  if ((evidenceSufficiency ?? 100) < 80) improvements.push({ title: "Strengthen evidence capture", detail: `Evidence sufficiency is ${evidenceSufficiency}%`, href: "/educator/validations" });
  if (draftFw) improvements.push({ title: "Publish draft curricula", detail: `${draftFw} framework${draftFw === 1 ? " is" : "s are"} still in draft`, href: "/educator/studio/curriculum" });
  if (!improvements.length) improvements.push({ title: "Maintain current standards", detail: "No structural improvement opportunities detected", href: "/educator/analytics/curriculum" });

  // ── Predictions (rule-derived signals, not ML) ───────────────────────────
  const predictions: Prediction[] = [];
  if (missingSim > 0) predictions.push({ title: "Elevated OSCE-readiness risk", reason: `${missingSim} competencies have no simulation exposure`, confidence: Math.min(95, 55 + Math.round((missingSim / Math.max(1, total)) * 40)) });
  if ((evidenceSufficiency ?? 100) < 70) predictions.push({ title: "Insufficient practice evidence at review", reason: `Only ${evidenceSufficiency}% of competencies have observed evidence`, confidence: 80 });
  if (sevCount.Critical > 0) predictions.push({ title: "Accreditation finding likely", reason: `${sevCount.Critical} critical gap${sevCount.Critical === 1 ? "" : "s"} in high-risk competencies`, confidence: 72 });
  if (!predictions.length) predictions.push({ title: "Stable curriculum trajectory", reason: "No structural risk signals in the current data", confidence: 60 });

  // ── Right intelligence panel ─────────────────────────────────────────────
  const healthLabel = overallHealth === null ? "Insufficient data" : overallHealth >= 85 ? "Excellent" : overallHealth >= 70 ? "Good" : overallHealth >= 50 ? "Fair" : "At Risk";
  const pendingReviews = fw.filter(f => ["draft", "review"].includes(f.pub_status ?? "")).length + cpuList.filter(c => ["draft", "review"].includes(c.pub_status ?? "")).length;

  const reasoning: string[] = [];
  if (sevCount.Critical) reasoning.push(`${sevCount.Critical} critical gap${sevCount.Critical === 1 ? "" : "s"} detected in high-risk competencies without assessment.`);
  if (missingAssess) reasoning.push(`Assessment coverage is ${assessmentCoverage}% — ${missingAssess} competencies remain unmapped.`);
  if (duplicates) reasoning.push(`${duplicates} competency name${duplicates === 1 ? "" : "s"} recur across modules; merging may remove duplicated evidence.`);
  if ((evidenceSufficiency ?? 100) < 80) reasoning.push(`Evidence sufficiency (${evidenceSufficiency}%) is below the 80% readiness threshold.`);
  if (!reasoning.length) reasoning.push("No material curriculum risks detected in the current institutional data.");

  const standards: StandardStatus[] = fw.slice(0, 6).map(f => {
    const ids = fc.filter(c => compFw(c) === f.id);
    return { name: f.name, coverage: pct(ids.filter(c => hasAssessment(c.id)).length, ids.length) };
  });

  const actions: PanelAction[] = [];
  if (missingAssess) actions.push({ title: "Update assessment blueprint", priority: "High", href: "/educator/studio/mapping" });
  if (sevCount.Critical) actions.push({ title: "Resolve critical gaps", priority: "High", href: "/educator/analytics/curriculum/gaps" });
  if (missingSim) actions.push({ title: "Create simulation scenarios", priority: "Medium", href: "/educator/simulation" });
  if (duplicates) actions.push({ title: "Merge duplicate competencies", priority: "Medium", href: "/educator/analytics/competency/gaps" });
  actions.push({ title: "Prepare accreditation report", priority: "Low", href: "/educator/analytics/accreditation" });
  actions.push({ title: "Assign curriculum review", priority: "Low", href: "/educator/studio/curriculum" });

  const { configured } = await import("@/lib/ai/config").then(m => ({ configured: m.aiStatus().configured })).catch(() => ({ configured: false }));

  const backedCount = [alignmentScore, competencyCoverage, assessmentCoverage, evidenceSufficiency, standardsCompliance, attainment].filter(v => v !== null).length;

  return {
    scope: {
      institution: (hospital as { name: string } | null)?.name ?? "Your institution",
      programmes: fw.length, standards: fw.slice(0, 5).map(f => f.name), competencies: total, cpus: cpuList.length,
    },
    health,
    risk: {
      level: overallHealth === null ? "Medium" : sevCount.Critical > 0 || overallHealth < 50 ? "High" : overallHealth < 70 ? "Medium" : "Low",
      confidence: backedCount >= 5 ? "High" : backedCount >= 2 ? "Medium" : "Low",
    },
    navigator,
    versions: {
      note: "Formal version history needs a curriculum-versioning store. Lifecycle status below is live from publication state.",
      lifecycle: [
        { label: "Published / Active", n: fw.filter(f => ["published", "active"].includes(f.pub_status ?? "")).length },
        { label: "In review", n: fw.filter(f => f.pub_status === "review").length },
        { label: "Draft", n: fw.filter(f => f.pub_status === "draft").length },
      ],
    },
    map,
    gaps: {
      total: gapItems.length, critical: sevCount.Critical, register: gapItems.slice(0, 8),
      severity: [
        { label: "Critical", n: sevCount.Critical, color: "#ef4444" }, { label: "High", n: sevCount.High, color: "#f59e0b" },
        { label: "Medium", n: sevCount.Medium, color: "#eab308" }, { label: "Low", n: sevCount.Low, color: "#22c55e" },
      ],
    },
    alignment,
    coverage: {
      columns: ["Knowledge", "Assessment", "Simulation", "Evidence", "OSCE", "Clinical", "Portfolio"],
      rows: coverageRows,
      note: "OSCE, clinical-practice and portfolio evidence types have no dedicated store yet — shown muted, not scored.",
    },
    assessment: {
      slices: domSlices, overall: assessmentCoverage,
      note: "Coverage = share of each domain's competencies with at least one mapped assessment.",
    },
    timeline,
    impact,
    improvements,
    predictions,
    panel: {
      summary: {
        healthLabel, currentRisks: sevCount.Critical + sevCount.High,
        immediateAttention: sevCount.Critical, recommendedImprovements: improvements.length, pendingReviews,
      },
      reasoning, standards, actions,
      outputs: [
        { label: "Gap Analysis", href: "/educator/analytics/curriculum/gaps" },
        { label: "Curriculum Analytics", href: "/educator/analytics/curriculum" },
        { label: "Competency Coverage", href: "/educator/analytics/competency" },
        { label: "Accreditation Readiness", href: "/educator/analytics/accreditation" },
      ],
      aiConfigured: configured,
    },
  };
}
