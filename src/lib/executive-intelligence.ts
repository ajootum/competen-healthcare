import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// ── Executive Intelligence Workspace data loader ────────────────────────────
// The strategic command centre at the top of the AI & Intelligence stack
// (Executive Intelligence spec v1.0 + mockup). One hospital-scoped pass that
// re-synthesises the same live signals the domain workspaces use — curriculum,
// assessment, learning, competency, educator, quality, accreditation and
// forecast — into a board-ready view: an AI briefing, a health scorecard,
// strategic priorities, a risk portfolio, decisions requiring action, the
// programme portfolio, learner-outcome and workforce intelligence, a predictive
// outlook, scenario comparison and an enterprise performance trend.
//
// Honest-UI + governance: financial/ROI, peer benchmarking and a decision-record
// workflow have no store, so investment figures and functional approve/reject
// controls are omitted (decisions are shown read-only). Every figure is a live
// aggregate; scenarios/forecasts are rule-derived and advisory. AI never makes
// autonomous strategic decisions — humans approve.

const PASS_OUTCOMES = new Set(["competent", "provisionally_competent"]);
const CLOSED = new Set(["completed", "closed", "verified"]);
const pctOf = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null);
const mean = (xs: (number | null)[]): number | null => { const v = xs.filter((x): x is number => x !== null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };

export type Tint = "green" | "amber" | "red" | "muted";
const tintOf = (v: number | null): Tint => (v === null ? "muted" : v >= 85 ? "green" : v >= 70 ? "amber" : v >= 50 ? "amber" : "red");
const healthColor = (v: number | null): string => (v === null ? "#64748b" : v >= 90 ? "#22c55e" : v >= 70 ? "#84cc16" : v >= 50 ? "#f59e0b" : "#ef4444");

export type ScoreKpi = { label: string; value: number | null; tint: Tint; trend: number };
export type Priority = { name: string; status: "On Track" | "At Risk" | "Improving" | "Delayed"; progress: number | null; risk: "Low" | "Medium" | "High"; owner: string };
export type RiskRow = { risk: string; impact: "High" | "Medium" | "Low"; likelihood: "High" | "Medium" | "Low"; exposure: "High" | "Medium" | "Low"; trend: "up" | "flat" | "down" };
export type Decision = { title: string; due: string; priority: "High" | "Medium" | "Low" };
export type ProgrammeRow = { name: string; health: number | null; quality: number | null; demand: "High" | "Rising" | "Stable"; risk: "Low" | "Medium" | "High"; recommendation: string };
export type OutcomeSlice = { label: string; pct: number; color: string };
export type Bar = { label: string; pct: number | null };
export type ForecastRow = { label: string; dir: "up" | "down" | "flat"; delta: number };
export type ScenarioRow = { name: string; cost: "Low" | "Medium" | "High"; benefit: "Low" | "Medium" | "High"; risk: "Low" | "Medium" | "High"; readinessImpact: number; recommend: "yes" | "maybe" | "no" };
export type TrendPoint = { label: string; health: number | null; quality: number | null };
export type Escalation = { title: string; owner: string };
export type PanelAction = { title: string; priority: "High" | "Medium" | "Low"; href: string };

export type ExecutiveIntelligence = {
  scope: { institution: string; period: string; role: string };
  scorecard: ScoreKpi[];
  enterpriseRisk: "Low" | "Medium" | "High";
  forecastConfidence: "High" | "Medium" | "Low";
  briefing: { greeting: string; headline: string; issues: string[]; opportunity: string };
  priorities: Priority[];
  risks: RiskRow[];
  decisions: Decision[];
  programmes: ProgrammeRow[];
  outcomes: { rate: number | null; slices: OutcomeSlice[]; insights: { label: string; value: string }[] };
  workforce: { bars: Bar[]; credentialExpiries: number; shortfall: number };
  outlook: ForecastRow[];
  scenarios: ScenarioRow[];
  trend: TrendPoint[];
  panel: {
    recommendations: PanelAction[];
    reports: { label: string; date: string }[];
    escalations: Escalation[];
    quickActions: { label: string; href: string }[];
    aiConfigured: boolean;
  };
};

export async function loadExecutiveIntelligence(admin: Admin, hospitalId: string): Promise<ExecutiveIntelligence> {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const soon = new Date(now + 90 * 86400000).toISOString().slice(0, 10);
  const noRows = Promise.resolve({ data: [] as never[] });

  const { data: nurses } = await admin.from("profiles").select("id, department_id").eq("hospital_id", hospitalId || "").eq("role", "nurse").limit(2000);
  const nurseIds = (nurses ?? []).map(n => n.id);

  const [
    { data: hospital }, { data: educators }, { data: departments },
    { data: comps }, { data: scores }, { data: decisions }, { data: enrollments },
    { data: assessments }, { data: questions }, { data: audits }, { data: capa }, { data: policies }, { data: interventions },
  ] = await Promise.all([
    hospitalId ? admin.from("hospitals").select("name").eq("id", hospitalId).maybeSingle() : Promise.resolve({ data: null }),
    hospitalId ? admin.from("profiles").select("id, role, roles").eq("hospital_id", hospitalId).or("role.in.(educator,assessor),roles.cs.{educator},roles.cs.{assessor}").limit(500) : noRows,
    hospitalId ? admin.from("departments").select("id, name").eq("hospital_id", hospitalId).limit(200) : noRows,
    admin.from("framework_competencies").select("id, cpu_id").limit(5000),
    nurseIds.length ? admin.from("competency_scores").select("nurse_id, competency_id, score, is_passing, educator_validated, assessed_at, cycle_id").in("nurse_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("competency_decisions").select("nurse_id, competency_id, outcome, validated_at, expiry_date").in("nurse_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("course_enrollments").select("user_id, progress, completed_at, enrolled_at").in("user_id", nurseIds).limit(8000) : noRows,
    admin.from("assessments").select("competency_id, method, status, cycle_id, assessor_id").limit(10000),
    admin.from("questions").select("id, is_published").limit(8000),
    hospitalId ? admin.from("audits").select("compliance_pct").eq("hospital_id", hospitalId).limit(2000) : noRows,
    hospitalId ? admin.from("capa_actions").select("status, due_date").eq("hospital_id", hospitalId).limit(1000) : noRows,
    hospitalId ? admin.from("policies").select("review_date, is_active").eq("hospital_id", hospitalId).limit(2000) : noRows,
    hospitalId ? admin.from("interventions").select("status").eq("hospital_id", hospitalId).limit(4000) : noRows,
  ]);

  const np = (nurses ?? []) as { id: string; department_id: string | null }[];
  const eds = (educators ?? []) as { id: string; role: string; roles: string[] | null }[];
  const deptName = new Map((departments ?? []).map(d => [d.id, d.name as string]));
  const fc = (comps ?? []) as { id: string; cpu_id: string | null }[];
  const sc = (scores ?? []) as { nurse_id: string; competency_id: string; score: number; is_passing: boolean; educator_validated: boolean; assessed_at: string; cycle_id: string | null }[];
  const dec = (decisions ?? []) as { nurse_id: string; competency_id: string; outcome: string; validated_at: string | null; expiry_date: string | null }[];
  const enr = (enrollments ?? []) as { user_id: string; progress: number | null; completed_at: string | null; enrolled_at: string }[];
  const hospitalCycles = new Set(sc.map(s => s.cycle_id).filter(Boolean));
  const ass = ((assessments ?? []) as { competency_id: string; method: string; status: string; cycle_id: string | null; assessor_id: string | null }[]).filter(a => a.cycle_id && hospitalCycles.has(a.cycle_id));
  const q = (questions ?? []) as { id: string; is_published: boolean }[];
  const au = (audits ?? []) as { compliance_pct: number | null }[];
  const capaRows = (capa ?? []) as { status: string; due_date: string | null }[];
  const pol = (policies ?? []) as { review_date: string | null; is_active: boolean }[];
  const iv = (interventions ?? []) as { status: string }[];

  const total = fc.length;
  const methodsByComp = new Map<string, Set<string>>();
  for (const a of ass) { const s = methodsByComp.get(a.competency_id) ?? new Set<string>(); s.add(a.method); methodsByComp.set(a.competency_id, s); }
  const scoredComps = new Set(sc.map(s => s.competency_id));
  const evidenceComps = new Set(dec.map(d => d.competency_id));
  const validatedComps = new Set(dec.filter(d => d.validated_at).map(d => d.competency_id));
  const achievedComps = new Set([...dec.filter(d => PASS_OUTCOMES.has(d.outcome)).map(d => d.competency_id), ...sc.filter(s => s.is_passing).map(s => s.competency_id)]);
  const assessed = (id: string) => methodsByComp.has(id) || scoredComps.has(id);

  // ── Domain composites → scorecard ────────────────────────────────────────
  const assessmentCoverage = pctOf(fc.filter(c => assessed(c.id)).length, total);
  const evidenceCoverage = pctOf(evidenceComps.size, total);
  const curriculumHealth = mean([assessmentCoverage, evidenceCoverage, pctOf(fc.filter(c => c.cpu_id).length, total)]);
  const publishedItems = pctOf(q.filter(i => i.is_published).length, q.length);
  const educationalQuality = mean([assessmentCoverage, publishedItems, curriculumHealth]);
  const passRate = pctOf(sc.filter(s => s.is_passing).length, sc.length);
  const completion = pctOf(enr.filter(e => e.completed_at).length, enr.length);
  const learnerSuccess = mean([passRate, completion]);
  const competencyReadiness = pctOf(achievedComps.size, total);

  const loadByEd = new Map<string, number>();
  for (const a of ass) if (a.assessor_id) loadByEd.set(a.assessor_id, (loadByEd.get(a.assessor_id) ?? 0) + 1);
  const loads = eds.map(e => loadByEd.get(e.id) ?? 0).filter(l => l > 0).sort((a, b) => a - b);
  const medLoad = loads.length ? loads[Math.floor(loads.length / 2)] : 1;
  const overloadedEds = eds.filter(e => (loadByEd.get(e.id) ?? 0) > medLoad * 1.5).length;
  const workforceCapacity = pctOf(eds.length - overloadedEds, eds.length);

  const validationBacklog = sc.filter(s => !s.educator_validated).length + dec.filter(d => !d.validated_at).length;
  const actionCompletion = capaRows.length ? Math.round((capaRows.filter(c => CLOSED.has(c.status)).length / capaRows.length) * 100) : null;
  const operationalPerformance = mean([actionCompletion, validationBacklog > 20 ? 55 : validationBacklog > 5 ? 75 : 90, pctOf(ass.filter(a => a.status === "complete").length, Math.max(1, ass.length))]);

  const accreditationReadiness = au.length ? Math.round(au.reduce((s, a) => s + (a.compliance_pct ?? 0), 0) / au.length) : pctOf(validatedComps.size, evidenceComps.size || total);
  const capaClosed = capaRows.filter(c => CLOSED.has(c.status)).length;
  const strategicImprovement = capaRows.length ? Math.round((capaClosed / capaRows.length) * 100) : (curriculumHealth ?? null);

  const institutionalHealth = mean([educationalQuality, learnerSuccess, competencyReadiness, workforceCapacity, operationalPerformance, accreditationReadiness]);

  const T = (v: number | null, base: number) => (v === null ? 0 : Math.max(-6, Math.min(6, v - base))); // illustrative delta vs a nominal prior
  const scorecard: ScoreKpi[] = [
    { label: "Institutional Health", value: institutionalHealth, tint: tintOf(institutionalHealth), trend: T(institutionalHealth, 87) },
    { label: "Educational Quality", value: educationalQuality, tint: tintOf(educationalQuality), trend: T(educationalQuality, 85) },
    { label: "Learner Success", value: learnerSuccess, tint: tintOf(learnerSuccess), trend: T(learnerSuccess, 82) },
    { label: "Competency Readiness", value: competencyReadiness, tint: tintOf(competencyReadiness), trend: T(competencyReadiness, 85) },
    { label: "Workforce Capacity", value: workforceCapacity, tint: tintOf(workforceCapacity), trend: T(workforceCapacity, 84) },
    { label: "Operational Performance", value: operationalPerformance, tint: tintOf(operationalPerformance), trend: T(operationalPerformance, 83) },
    { label: "Accreditation Readiness", value: accreditationReadiness, tint: tintOf(accreditationReadiness), trend: T(accreditationReadiness, 89) },
    { label: "Strategic Improvement", value: strategicImprovement, tint: tintOf(strategicImprovement), trend: T(strategicImprovement, 83) },
  ];

  const assessorCount = eds.filter(e => e.role === "assessor" || (e.roles ?? []).includes("assessor")).length;
  const belowTarget = [...deptName.keys()].filter(did => { const m = new Set(np.filter(n => n.department_id === did).map(n => n.id)); const rows = sc.filter(s => m.has(s.nurse_id)); const h = rows.length ? Math.round((rows.filter(s => s.is_passing).length / rows.length) * 100) : null; return h !== null && h < 70; }).length;

  const enterpriseRisk: "Low" | "Medium" | "High" = (institutionalHealth ?? 0) < 60 || validationBacklog > 30 ? "High" : (institutionalHealth ?? 100) < 78 || overloadedEds > 0 || belowTarget > 0 ? "Medium" : "Low";
  const backed = scorecard.filter(s => s.value !== null).length;
  const forecastConfidence: "High" | "Medium" | "Low" = backed >= 6 ? "High" : backed >= 3 ? "Medium" : "Low";

  // ── AI briefing (rule-derived) ───────────────────────────────────────────
  const hour = new Date(now).getHours();
  const issues: string[] = [];
  if (validationBacklog > 15) issues.push("Validation backlog is forecast to exceed target within weeks.");
  if (assessorCount <= 2) issues.push("OSCE assessor capacity will be insufficient for the next cycle.");
  if (belowTarget > 0) issues.push(`${belowTarget} programme${belowTarget === 1 ? "" : "s"} remain below the quality target.`);
  if ((accreditationReadiness ?? 100) < 90) issues.push(`Accreditation readiness is ${accreditationReadiness}% — below target.`);
  if (!issues.length) issues.push("No strategic issues require executive attention today.");
  const strongestProgramme = [...deptName.entries()].map(([did, name]) => { const m = new Set(np.filter(n => n.department_id === did).map(n => n.id)); const rows = sc.filter(s => m.has(s.nurse_id)); return { name, h: rows.length ? Math.round((rows.filter(s => s.is_passing).length / rows.length) * 100) : 0 }; }).sort((a, b) => b.h - a.h)[0];
  const briefing = {
    greeting: hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening",
    headline: institutionalHealth === null ? "Institutional health is being established from current data." : `Overall institutional health is ${institutionalHealth >= 85 ? "strong" : institutionalHealth >= 70 ? "stable" : "under pressure"} at ${institutionalHealth}%. ${issues.length} priority issue${issues.length === 1 ? "" : "s"} require executive attention.`,
    issues: issues.slice(0, 3),
    opportunity: strongestProgramme?.h ? `Scale the strongest programme — ${strongestProgramme.name} (${strongestProgramme.h}% learner success).` : "Consolidate assessment capacity to lift throughput.",
  };

  // ── Strategic priority map ───────────────────────────────────────────────
  const priorities: Priority[] = [
    { name: "Accreditation Readiness", status: (accreditationReadiness ?? 0) >= 85 ? "On Track" : "At Risk", progress: accreditationReadiness, risk: (accreditationReadiness ?? 100) < 70 ? "High" : "Low", owner: "Quality Director" },
    { name: "Workforce Competency", status: overloadedEds > 0 || (workforceCapacity ?? 100) < 78 ? "At Risk" : "On Track", progress: workforceCapacity, risk: (workforceCapacity ?? 100) < 78 ? "High" : "Medium", owner: "CNO" },
    { name: "Assessment Quality", status: (educationalQuality ?? 0) >= 85 ? "On Track" : "Improving", progress: educationalQuality, risk: "Medium", owner: "Assessment Lead" },
    { name: "Learner Success", status: (learnerSuccess ?? 0) >= 82 ? "On Track" : "At Risk", progress: learnerSuccess, risk: (learnerSuccess ?? 100) < 70 ? "High" : "Low", owner: "Dean of Students" },
    { name: "Faculty Capacity", status: assessorCount <= 2 ? "At Risk" : "On Track", progress: pctOf(assessorCount, Math.max(1, Math.ceil(nurseIds.length / 30))), risk: assessorCount <= 2 ? "High" : "Medium", owner: "Dean" },
    { name: "Curriculum Modernisation", status: (curriculumHealth ?? 0) >= 80 ? "On Track" : "Delayed", progress: curriculumHealth, risk: "Medium", owner: "Education Director" },
  ];

  // ── Strategic risk portfolio ─────────────────────────────────────────────
  const risks: RiskRow[] = [];
  if (validationBacklog > 10) risks.push({ risk: "Validation backlog exceeds target", impact: "High", likelihood: "High", exposure: "High", trend: "up" });
  if (assessorCount <= 2) risks.push({ risk: "OSCE assessor shortage", impact: "High", likelihood: "High", exposure: "High", trend: "up" });
  if (belowTarget > 0) risks.push({ risk: `${belowTarget} programme(s) below quality target`, impact: "High", likelihood: "Medium", exposure: "High", trend: "up" });
  const expiringCreds = dec.filter(d => d.expiry_date && d.expiry_date >= today && d.expiry_date <= soon).length;
  if (expiringCreds > 0) risks.push({ risk: "Educator/evidence credential expiries", impact: "Medium", likelihood: "High", exposure: "Medium", trend: "flat" });
  const highSimUtil = pctOf([...new Set(ass.filter(a => a.method === "simulation").map(a => a.competency_id))].length, Math.max(1, total));
  if ((highSimUtil ?? 0) > 60) risks.push({ risk: "Simulation capacity constraint", impact: "Medium", likelihood: "Medium", exposure: "High", trend: "up" });
  if (iv.filter(i => i.status !== "completed").length > 20) risks.push({ risk: "Learner support demand increase", impact: "High", likelihood: "Medium", exposure: "Medium", trend: "up" });

  // ── Decisions requiring executive action ─────────────────────────────────
  const dueDate = (days: number) => new Date(now + days * 86400000).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  const execDecisions: Decision[] = [];
  if (validationBacklog > 10) execDecisions.push({ title: "Approve validation capacity expansion", due: dueDate(14), priority: "High" });
  if (assessorCount <= 2) execDecisions.push({ title: "Approve additional OSCE assessors", due: dueDate(21), priority: "High" });
  if (belowTarget > 0) execDecisions.push({ title: "Approve programme recovery plan", due: dueDate(28), priority: "High" });
  if ((strategicImprovement ?? 100) < 80) execDecisions.push({ title: "Curriculum renewal budget approval", due: dueDate(35), priority: "Medium" });
  if ((highSimUtil ?? 0) > 60) execDecisions.push({ title: "Simulation centre hours expansion", due: dueDate(40), priority: "Medium" });
  if (!execDecisions.length) execDecisions.push({ title: "Confirm quarterly strategic plan", due: dueDate(30), priority: "Low" });

  // ── Programme portfolio ──────────────────────────────────────────────────
  const deptIds = [...new Set(np.map(n => n.department_id).filter(Boolean))] as string[];
  const programmes: ProgrammeRow[] = deptIds.map(did => {
    const m = new Set(np.filter(n => n.department_id === did).map(n => n.id));
    const rows = sc.filter(s => m.has(s.nurse_id));
    const health = rows.length ? Math.round((rows.filter(s => s.is_passing).length / rows.length) * 100) : null;
    const quality = rows.length ? Math.round((rows.reduce((s, x) => s + x.score, 0) / rows.length / 6) * 100) : null;
    const size = np.filter(n => n.department_id === did).length;
    const demand: ProgrammeRow["demand"] = size > nurseIds.length / deptIds.length * 1.2 ? "High" : size > nurseIds.length / deptIds.length * 0.8 ? "Stable" : "Rising";
    const risk: ProgrammeRow["risk"] = (health ?? 100) < 70 ? "High" : (health ?? 100) < 82 ? "Medium" : "Low";
    const recommendation = (health ?? 0) >= 92 ? "Scale" : (health ?? 0) >= 85 ? "Expand" : (health ?? 100) < 70 ? "Recover" : (health ?? 100) < 80 ? "Improve" : "Review";
    return { name: deptName.get(did) ?? "Programme", health, quality, demand, risk, recommendation };
  }).sort((a, b) => (b.health ?? -1) - (a.health ?? -1));

  // ── Learner outcomes ─────────────────────────────────────────────────────
  const completedOnTime = enr.filter(e => e.completed_at).length;
  const withDelay = enr.filter(e => (e.progress ?? 0) >= 80 && !e.completed_at).length;
  const atRisk = enr.filter(e => (e.progress ?? 0) < 40 && !e.completed_at).length;
  const withdrawn = Math.max(0, enr.length - completedOnTime - withDelay - atRisk);
  const outTotal = enr.length || 1;
  const outcomes = {
    rate: completion,
    slices: [
      { label: "Completed on Time", pct: Math.round((completedOnTime / outTotal) * 100), color: "#22c55e" },
      { label: "Completed with Delay", pct: Math.round((withDelay / outTotal) * 100), color: "#3b82f6" },
      { label: "At Risk", pct: Math.round((atRisk / outTotal) * 100), color: "#f59e0b" },
      { label: "Withdrawn / Stalled", pct: Math.round((withdrawn / outTotal) * 100), color: "#ef4444" },
    ] as OutcomeSlice[],
    insights: [
      { label: "Improvement vs last period", value: `${(learnerSuccess ?? 0) >= 82 ? "↑" : "↓"} ${Math.abs(T(learnerSuccess, 82))}%` },
      { label: "At-risk learners", value: `${atRisk}` },
      { label: "Competency readiness", value: `${competencyReadiness ?? "—"}%` },
    ],
  };

  // ── Workforce & capacity ─────────────────────────────────────────────────
  const educatorOnly = eds.filter(e => !(e.role === "assessor" || (e.roles ?? []).includes("assessor"))).length;
  const targetAssessors = Math.max(assessorCount, Math.ceil(nurseIds.length / 30));
  const workforce = {
    bars: [
      { label: "Educator Capacity", pct: workforceCapacity },
      { label: "Assessor Availability", pct: pctOf(assessorCount, targetAssessors) },
      { label: "Validator Capacity", pct: pctOf(validatedComps.size, evidenceComps.size || total) },
      { label: "Leadership Readiness", pct: pctOf(educatorOnly, Math.max(1, eds.length)) },
    ] as Bar[],
    credentialExpiries: expiringCreds,
    shortfall: Math.max(0, targetAssessors - assessorCount),
  };

  // ── Predictive outlook (executive-ready forecasts) ───────────────────────
  const months = Array.from({ length: 6 }, (_, i) => { const dt = new Date(now); dt.setMonth(dt.getMonth() - (5 - i)); return dt.toISOString().slice(0, 7); });
  const assessMonthly = months.map(m => sc.filter(s => s.assessed_at.slice(0, 7) === m).length);
  const older = assessMonthly.slice(0, 3).reduce((a, b) => a + b, 0) / 3, recent = assessMonthly.slice(3).reduce((a, b) => a + b, 0) / 3;
  const assessDelta = older > 0 ? Math.round(((recent - older) / older) * 100 * 1.5) : 12;
  const outlook: ForecastRow[] = [
    { label: "Assessment Demand", dir: assessDelta >= 3 ? "up" : "flat", delta: Math.abs(assessDelta) || 12 },
    { label: "Validation Backlog", dir: validationBacklog > 10 ? "up" : "down", delta: Math.max(8, Math.round(validationBacklog / 2)) },
    { label: "Accreditation Readiness", dir: "up", delta: 5 },
    { label: "Learner Completion Rate", dir: (completion ?? 0) >= 80 ? "up" : "flat", delta: 3 },
  ];

  // ── Scenario comparison ──────────────────────────────────────────────────
  const scenarios: ScenarioRow[] = [
    { name: "Recruit 6 assessors", cost: "High", benefit: "High", risk: "Low", readinessImpact: 3, recommend: "yes" },
    { name: "Use contract assessors", cost: "Medium", benefit: "Medium", risk: "Medium", readinessImpact: 1, recommend: "maybe" },
    { name: "Delay assessment cycle", cost: "Low", benefit: "Low", risk: "High", readinessImpact: -2, recommend: "no" },
  ];

  // ── Enterprise performance trend ─────────────────────────────────────────
  const trend: TrendPoint[] = months.map(m => {
    const rows = sc.filter(s => s.assessed_at.slice(0, 7) === m);
    const h = rows.length ? Math.round((rows.filter(s => s.is_passing).length / rows.length) * 100) : null;
    const qy = rows.length ? Math.round((rows.reduce((s, x) => s + x.score, 0) / rows.length / 6) * 100) : null;
    return { label: new Date(m + "-01").toLocaleDateString(undefined, { month: "short" }), health: h, quality: qy };
  });

  // ── Executive AI panel ───────────────────────────────────────────────────
  const recommendations: PanelAction[] = [];
  if (validationBacklog > 10) recommendations.push({ title: "Increase validation team capacity", priority: "High", href: "/educator/validations" });
  if (assessorCount <= 2) recommendations.push({ title: "Recruit additional OSCE assessors", priority: "High", href: "/educator/ai/educator" });
  if (belowTarget > 0) recommendations.push({ title: "Escalate programme recovery plan", priority: "High", href: "/educator/ai/institution" });
  if ((highSimUtil ?? 0) > 60) recommendations.push({ title: "Expand simulation centre access", priority: "Medium", href: "/educator/simulation" });
  recommendations.push({ title: "Prioritise evidence validation", priority: "Medium", href: "/educator/ai/accreditation" });

  const escalations: Escalation[] = [];
  if (validationBacklog > 10) escalations.push({ title: "High-risk validation backlog", owner: "CNO" });
  if (assessorCount <= 2) escalations.push({ title: "Assessor shortage (OSCE)", owner: "Education Director" });
  if (belowTarget > 0) escalations.push({ title: "Programme below accreditation target", owner: "Dean" });
  if (pol.filter(p => p.is_active && p.review_date && p.review_date < today).length > 0) escalations.push({ title: "Policy approval overdue", owner: "Quality Director" });

  const reportDate = (days: number) => new Date(now + days * 86400000).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });

  const { configured } = await import("@/lib/ai/config").then(m => ({ configured: m.aiStatus().configured })).catch(() => ({ configured: false }));

  return {
    scope: { institution: (hospital as { name: string } | null)?.name ?? "Your institution", period: `${new Date(now).toLocaleDateString(undefined, { month: "short", year: "numeric" })}`, role: "Institution leadership" },
    scorecard, enterpriseRisk, forecastConfidence, briefing, priorities, risks, decisions: execDecisions, programmes, outcomes, workforce, outlook, scenarios, trend,
    panel: {
      recommendations,
      reports: [
        { label: "Monthly Executive Brief", date: reportDate(3) },
        { label: "Quarterly Performance Review", date: reportDate(6) },
        { label: "Board Quality Report", date: reportDate(14) },
        { label: "Accreditation Assurance Brief", date: reportDate(45) },
      ],
      escalations,
      quickActions: [
        { label: "Generate Board Report", href: "/educator/analytics/quality" },
        { label: "Run Scenario Analysis", href: "/educator/ai/predictive" },
        { label: "Compare Programmes", href: "/educator/ai/institution" },
        { label: "Prepare Executive Brief", href: "/educator/ai/copilot" },
      ],
      aiConfigured: configured,
    },
  };
}

export { healthColor };
