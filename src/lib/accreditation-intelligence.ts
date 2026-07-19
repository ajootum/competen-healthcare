import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// ── Accreditation Intelligence Workspace data loader ────────────────────────
// The AI-powered continuous-accreditation & evidence-readiness view
// (Accreditation Intelligence spec v1.0 + mockup). One hospital-scoped pass over
// the live compliance graph — audits (measurable elements), CAPA corrective
// actions, the evidence table, competency decisions (validation & expiry),
// policies (currency) and the framework/competency/assessment structure —
// synthesised into: a readiness dashboard, a standards map, evidence readiness,
// a compliance-gap breakdown, programme compliance, action tracking, policy
// currency, a risk centre, a readiness forecast and the AI panel.
//
// Honest-UI + governance: the platform has no formal standards catalogue,
// regulatory-mapping, evidence-lifecycle, survey/mock-survey or tracer stores.
// Those are shown muted with a note; the AI never declares compliance. Backed
// figures come from audits, CAPA, decisions, policies and evidence counts.

const PASS_OUTCOMES = new Set(["competent", "provisionally_competent"]);
const CLOSED = new Set(["completed", "closed", "verified"]);
const CRITICAL = new Set(["high", "critical", "urgent"]);
const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null);
const mean = (xs: (number | null)[]): number | null => { const v = xs.filter((x): x is number => x !== null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };

export type Tint = "green" | "amber" | "red" | "muted";
const tintOf = (v: number | null): Tint => (v === null ? "muted" : v >= 85 ? "green" : v >= 70 ? "amber" : v >= 50 ? "amber" : "red");

export type HealthKpi = { label: string; value: number | null; tint: Tint };
export type MapRow = { label: string; n: number };
export type DonutSlice = { label: string; n: number; color: string; pct: number };
export type GapBar = { label: string; n: number; pct: number | null; color: string };
export type ProgrammeRow = { name: string; readiness: number | null; compliance: number | null; risk: "Low" | "Medium" | "High" };
export type Risk = { title: string; severity: "High" | "Medium" | "Low"; impact: "High" | "Medium" | "Low"; owner: string };
export type PanelAction = { title: string; priority: "High" | "Medium" | "Low"; href: string };
export type ForecastPoint = { label: string; value: number | null };

export type AccreditationIntelligence = {
  scope: { institution: string; frameworks: number; standards: number; cycle: string };
  health: HealthKpi[];
  criticalGaps: number;
  confidence: "High" | "Medium" | "Low";
  standardsMap: { source: string; rows: MapRow[] };
  evidence: { total: number; slices: DonutSlice[] };
  gaps: { bars: GapBar[]; note: string };
  programmes: ProgrammeRow[];
  actions: { total: number; onTrack: number; atRisk: number; overdue: number };
  policy: { current: number; due: number; overdue: number; currency: number | null };
  survey: { available: boolean; readiness: number | null; note: string };
  risks: Risk[];
  forecast: { points: ForecastPoint[]; target: number; note: string };
  panel: {
    summary: { readiness: number | null; criticalGaps: number; evidenceGaps: number; policiesDue: number; actionsOverdue: number; standardsAtRisk: number; recommendations: number };
    reasoning: string[];
    actions: PanelAction[];
    outputs: { label: string; href: string }[];
    aiConfigured: boolean;
  };
};

export async function loadAccreditationIntelligence(admin: Admin, hospitalId: string): Promise<AccreditationIntelligence> {
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const noRows = Promise.resolve({ data: [] as never[] });

  const { data: nurses } = await admin.from("profiles").select("id, department_id").eq("hospital_id", hospitalId || "").eq("role", "nurse").limit(2000);
  const nurseIds = (nurses ?? []).map(n => n.id);

  const [
    { data: hospital }, { data: audits }, { data: capa }, { data: evidence }, { data: policies },
    { data: frameworks }, { data: comps }, { data: cpus }, { data: assessments },
    { data: decisions }, { data: scores }, { data: departments },
  ] = await Promise.all([
    hospitalId ? admin.from("hospitals").select("name").eq("id", hospitalId).maybeSingle() : Promise.resolve({ data: null }),
    hospitalId ? admin.from("audits").select("area, audit_type, compliance_pct, items_met, items_not_met, items_na").eq("hospital_id", hospitalId).limit(2000) : noRows,
    hospitalId ? admin.from("capa_actions").select("status, priority, due_date").eq("hospital_id", hospitalId).limit(1000) : noRows,
    hospitalId ? admin.from("evidence").select("id").eq("hospital_id", hospitalId).limit(8000) : noRows,
    hospitalId ? admin.from("policies").select("review_date, is_active").eq("hospital_id", hospitalId).limit(2000) : noRows,
    admin.from("frameworks").select("id, name").limit(200),
    admin.from("framework_competencies").select("id, domain_id").limit(5000),
    admin.from("clinical_practice_units").select("id", { count: "exact", head: true }),
    admin.from("assessments").select("id", { count: "exact", head: true }),
    nurseIds.length ? admin.from("competency_decisions").select("nurse_id, competency_id, outcome, validated_at, expiry_date").in("nurse_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("competency_scores").select("nurse_id, competency_id").in("nurse_id", nurseIds).limit(8000) : noRows,
    hospitalId ? admin.from("departments").select("id, name").eq("hospital_id", hospitalId).limit(200) : noRows,
  ]);

  const au = (audits ?? []) as { area: string | null; audit_type: string | null; compliance_pct: number | null; items_met: number | null; items_not_met: number | null; items_na: number | null }[];
  const ca = (capa ?? []) as { status: string; priority: string | null; due_date: string | null }[];
  const pol = (policies ?? []) as { review_date: string | null; is_active: boolean }[];
  const fw = (frameworks ?? []) as { id: string; name: string }[];
  const fc = (comps ?? []) as { id: string; domain_id: string | null }[];
  const dec = (decisions ?? []) as { nurse_id: string; competency_id: string; outcome: string; validated_at: string | null; expiry_date: string | null }[];
  const sc = (scores ?? []) as { nurse_id: string; competency_id: string }[];
  const np = (nurses ?? []) as { id: string; department_id: string | null }[];
  const deptName = new Map((departments ?? []).map(d => [d.id, d.name as string]));
  const cpuCount = (cpus as unknown as { count: number | null })?.count ?? 0;
  const assessCount = (assessments as unknown as { count: number | null })?.count ?? 0;

  const totalComps = fc.length;
  const evidenceComps = new Set(dec.map(d => d.competency_id));
  const validatedDecisions = dec.filter(d => d.validated_at).length;
  const validatedComps = new Set(dec.filter(d => d.validated_at).map(d => d.competency_id));
  const scoredNoDecision = new Set(sc.map(s => s.competency_id).filter(id => !evidenceComps.has(id)));
  const expiredEvidence = dec.filter(d => d.expiry_date && d.expiry_date < today).length;
  const expiringEvidence = dec.filter(d => d.expiry_date && d.expiry_date >= today && d.expiry_date <= soon).length;

  // ── Audit-derived compliance ─────────────────────────────────────────────
  const itemsMet = au.reduce((s, a) => s + (a.items_met ?? 0), 0);
  const itemsNotMet = au.reduce((s, a) => s + (a.items_not_met ?? 0), 0);
  const itemsNa = au.reduce((s, a) => s + (a.items_na ?? 0), 0);
  const standardsCompliance = au.length ? Math.round(au.reduce((s, a) => s + (a.compliance_pct ?? 0), 0) / au.length) : pct(itemsMet, itemsMet + itemsNotMet);

  // ── Health metrics ───────────────────────────────────────────────────────
  const evidenceSufficiency = pct(evidenceComps.size, totalComps);
  const evidenceValidation = pct(validatedDecisions, dec.length);
  const activePolicies = pol.filter(p => p.is_active);
  const currentPolicies = activePolicies.filter(p => !p.review_date || p.review_date >= today).length;
  const policyCurrency = pct(currentPolicies, activePolicies.length);
  const actionCompletion = ca.length ? Math.round((ca.filter(c => CLOSED.has(c.status)).length / ca.length) * 100) : null;
  const surveyPreparedness = mean([standardsCompliance, evidenceSufficiency, evidenceValidation, actionCompletion]);
  const overallReadiness = mean([standardsCompliance, evidenceSufficiency, evidenceValidation, policyCurrency, actionCompletion]);

  const criticalOpenCapa = ca.filter(c => c.priority && CRITICAL.has(c.priority) && !CLOSED.has(c.status)).length;
  const criticalGaps = (itemsNotMet > 0 ? Math.min(itemsNotMet, 20) : 0) + criticalOpenCapa + (expiredEvidence > 0 ? 1 : 0);

  const health: HealthKpi[] = [
    { label: "Overall Readiness", value: overallReadiness, tint: tintOf(overallReadiness) },
    { label: "Standards Compliance", value: standardsCompliance, tint: tintOf(standardsCompliance) },
    { label: "Evidence Sufficiency", value: evidenceSufficiency, tint: tintOf(evidenceSufficiency) },
    { label: "Evidence Validation", value: evidenceValidation, tint: tintOf(evidenceValidation) },
    { label: "Policy Currency", value: policyCurrency, tint: tintOf(policyCurrency) },
    { label: "Action Completion", value: actionCompletion, tint: tintOf(actionCompletion) },
    { label: "Survey Preparedness", value: surveyPreparedness, tint: tintOf(surveyPreparedness) },
  ];

  // ── Standards map (institution structure → evidence, live counts) ────────
  const standardsMap = {
    source: fw[0]?.name ?? "Institution standards",
    rows: [
      { label: "Policies", n: activePolicies.length },
      { label: "Curricula & CPUs", n: fw.length + cpuCount },
      { label: "Competencies", n: totalComps },
      { label: "Assessments", n: assessCount },
      { label: "Evidence Items", n: (evidence ?? []).length + dec.length },
      { label: "Validated Evidence", n: validatedDecisions },
    ] as MapRow[],
  };

  // ── Evidence readiness (competency-based) ────────────────────────────────
  const sufficientValidated = validatedComps.size;
  const sufficientNotValidated = evidenceComps.size - validatedComps.size;
  const insufficient = scoredNoDecision.size;
  const missing = Math.max(0, totalComps - evidenceComps.size - scoredNoDecision.size);
  const evTotal = sufficientValidated + sufficientNotValidated + insufficient + missing || 1;
  const evidenceOut = {
    total: (evidence ?? []).length + dec.length,
    slices: [
      { label: "Sufficient & Validated", n: sufficientValidated, color: "#22c55e" },
      { label: "Sufficient, Not Validated", n: sufficientNotValidated, color: "#84cc16" },
      { label: "Insufficient Evidence", n: insufficient, color: "#f59e0b" },
      { label: "Missing Evidence", n: missing, color: "#ef4444" },
    ].map(s => ({ ...s, pct: Math.round((s.n / evTotal) * 100) })) as DonutSlice[],
  };

  // ── Compliance gap analysis (from audit measurable elements) ─────────────
  const gapTotal = itemsMet + itemsNotMet + itemsNa || 1;
  const gaps = {
    bars: [
      { label: "Compliant", n: itemsMet, color: "#22c55e" },
      { label: "Non-Compliant", n: itemsNotMet, color: "#ef4444" },
      { label: "Not Assessed", n: itemsNa, color: "#64748b" },
    ].map(b => ({ ...b, pct: pct(b.n, gapTotal) })) as GapBar[],
    note: au.length ? "Measurable-element counts from recorded audits. Substantially/partially-compliant gradations need finer audit scoring." : "No audits recorded yet — run an audit to populate compliance gaps.",
  };

  // ── Programme & site compliance (department readiness) ───────────────────
  const deptIds = [...new Set(np.map(n => n.department_id).filter(Boolean))] as string[];
  const programmes: ProgrammeRow[] = deptIds.map(did => {
    const members = new Set(np.filter(n => n.department_id === did).map(n => n.id));
    const mDec = dec.filter(d => members.has(d.nurse_id));
    const readiness = pct(mDec.filter(d => d.validated_at).length, mDec.length) ?? pct(mDec.filter(d => PASS_OUTCOMES.has(d.outcome)).length, mDec.length);
    const compliance = pct(mDec.filter(d => PASS_OUTCOMES.has(d.outcome)).length, mDec.length);
    const risk: ProgrammeRow["risk"] = (readiness ?? 100) < 60 ? "High" : (readiness ?? 100) < 80 ? "Medium" : "Low";
    return { name: deptName.get(did) ?? "Programme", readiness, compliance, risk };
  }).filter(p => p.readiness !== null || p.compliance !== null).sort((a, b) => (b.readiness ?? -1) - (a.readiness ?? -1));

  // ── Action tracking (CAPA) ───────────────────────────────────────────────
  const openCapa = ca.filter(c => !CLOSED.has(c.status));
  const overdueCapa = openCapa.filter(c => c.due_date && c.due_date < today).length;
  const atRiskCapa = openCapa.filter(c => c.due_date && c.due_date >= today && c.due_date <= soon).length;
  const onTrackCapa = openCapa.length - overdueCapa - atRiskCapa;
  const actions = { total: ca.length, onTrack: Math.max(0, onTrackCapa), atRisk: atRiskCapa, overdue: overdueCapa };

  // ── Policy currency ──────────────────────────────────────────────────────
  const dueReview = activePolicies.filter(p => p.review_date && p.review_date >= today && p.review_date <= soon).length;
  const overdueReview = activePolicies.filter(p => p.review_date && p.review_date < today).length;
  const policy = { current: currentPolicies, due: dueReview, overdue: overdueReview, currency: policyCurrency };

  // ── Survey preparation (no scheduling store — readiness only) ─────────────
  const survey = { available: false, readiness: surveyPreparedness, note: "Survey scheduling, evidence-room packs and mock-survey management need dedicated stores. Readiness above is live; the survey calendar isn't yet captured." };

  // ── Risk centre (rule-derived) ───────────────────────────────────────────
  const unvalidated = dec.filter(d => !d.validated_at).length;
  const standardsAtRisk = itemsNotMet + (evidenceSufficiency !== null && evidenceSufficiency < 70 ? 1 : 0);
  const risks: Risk[] = [];
  if (unvalidated > 0) risks.push({ title: `Evidence validation backlog (${unvalidated} items)`, severity: "High", impact: "High", owner: "Quality Lead" });
  if (expiringEvidence > 0) risks.push({ title: `${expiringEvidence} evidence items nearing expiry`, severity: "High", impact: "High", owner: "Quality Lead" });
  if (overdueReview > 0) risks.push({ title: `${overdueReview} policies overdue for review`, severity: "Medium", impact: "Medium", owner: "Policy Lead" });
  if (overdueCapa > 0) risks.push({ title: `${overdueCapa} corrective actions overdue`, severity: "Medium", impact: "Medium", owner: "Quality Manager" });
  if (itemsNotMet > 0) risks.push({ title: `${itemsNotMet} audit elements non-compliant`, severity: "Medium", impact: "High", owner: "QA Manager" });

  // ── Readiness forecast (rule-derived trajectory to survey/target) ────────
  const base = overallReadiness ?? 70;
  const forecastMonths = ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"];
  const gapToTarget = Math.max(0, 90 - base);
  const forecast = {
    points: forecastMonths.map((label, i) => ({ label, value: Math.min(96, Math.round(base + (gapToTarget * i) / (forecastMonths.length - 1))) })) as ForecastPoint[],
    target: 90,
    note: "Advisory projection: current readiness trending toward target if open actions & validations are completed. Not a trained model.",
  };

  // ── Right panel ──────────────────────────────────────────────────────────
  const policiesDue = dueReview + overdueReview;
  const reasoning: string[] = [];
  if (unvalidated > 0) reasoning.push(`Evidence validation is incomplete for ${unvalidated} decisions.`);
  if (overdueCapa > 0) reasoning.push(`${overdueCapa} corrective actions are overdue.`);
  if (policyCurrency !== null && policyCurrency < 90) reasoning.push(`Policy currency is ${policyCurrency}% — ${overdueReview} policies past review date.`);
  if (itemsNotMet > 0) reasoning.push(`${itemsNotMet} audit measurable elements are non-compliant.`);
  if (!reasoning.length) reasoning.push("Accreditation readiness is on track across compliance, evidence and actions.");

  const panelActions: PanelAction[] = [];
  if (unvalidated > 0) panelActions.push({ title: "Validate missing evidence", priority: "High", href: "/educator/validations" });
  if (overdueReview > 0) panelActions.push({ title: "Update expiring policies", priority: "High", href: "/educator/analytics/quality" });
  if (overdueCapa > 0) panelActions.push({ title: "Close overdue corrective actions", priority: "Medium", href: "/educator/analytics/improvement" });
  if (itemsNotMet > 0) panelActions.push({ title: "Prepare survey evidence packs", priority: "Medium", href: "/educator/analytics/accreditation" });
  panelActions.push({ title: "Generate self-assessment report", priority: "Medium", href: "/educator/analytics/accreditation" });

  const { configured } = await import("@/lib/ai/config").then(m => ({ configured: m.aiStatus().configured })).catch(() => ({ configured: false }));
  const backedCount = health.filter(h => h.value !== null).length;

  return {
    scope: {
      institution: (hospital as { name: string } | null)?.name ?? "Your institution",
      frameworks: fw.length, standards: itemsMet + itemsNotMet + itemsNa,
      cycle: `${new Date().getFullYear()} Survey Cycle`,
    },
    health, criticalGaps,
    confidence: backedCount >= 6 ? "High" : backedCount >= 3 ? "Medium" : "Low",
    standardsMap, evidence: evidenceOut, gaps, programmes, actions, policy, survey, risks, forecast,
    panel: {
      summary: {
        readiness: overallReadiness, criticalGaps, evidenceGaps: (totalComps - evidenceComps.size),
        policiesDue, actionsOverdue: overdueCapa, standardsAtRisk, recommendations: panelActions.length + risks.length,
      },
      reasoning, actions: panelActions,
      outputs: [
        { label: "Accreditation Readiness Report", href: "/educator/analytics/accreditation" },
        { label: "Standards Compliance Matrix", href: "/educator/analytics/accreditation" },
        { label: "Evidence Gap Report", href: "/educator/analytics/competency/gaps" },
        { label: "Corrective Action Plan", href: "/educator/analytics/improvement" },
        { label: "Executive Accreditation Brief", href: "/educator/ai/institution" },
      ],
      aiConfigured: configured,
    },
  };
}
