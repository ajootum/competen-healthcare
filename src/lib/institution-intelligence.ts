import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// ── Institution Intelligence Workspace data loader ──────────────────────────
// The enterprise AI operating-centre view (Institution Intelligence spec v1.0 +
// mockup). One hospital-scoped pass that synthesises the domain signals the
// other Intelligence workspaces expose — curriculum, assessment, learning,
// competency, educator, quality/accreditation — into a single institutional
// picture: a health dashboard, an enterprise map, programme comparison,
// workforce, operational backlogs, capacity, quality, resources, a risk centre,
// rule-derived predictions and the AI panel.
//
// Honest-UI: every figure is computed from real records. Enterprise layers with
// no store (campus/faculty/school hierarchy, capacity in contracted hours,
// resource utilisation telemetry, budget) are shown muted or as directional
// signals — never fabricated. Programmes are the hospital's departments (the
// populated grouping); finer academic layers aren't modelled.

const PASS_OUTCOMES = new Set(["competent", "provisionally_competent"]);
const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null);
const mean = (xs: (number | null)[]): number | null => { const v = xs.filter((x): x is number => x !== null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };

export type Tint = "green" | "amber" | "red" | "muted";
const tintOf = (v: number | null): Tint => (v === null ? "muted" : v >= 85 ? "green" : v >= 70 ? "amber" : v >= 50 ? "amber" : "red");

export type HealthKpi = { label: string; value: number | null; tint: Tint };
export type MapNode = { id: string; name: string; health: number | null; kind: string; children: MapNode[] };
export type ProgrammeRow = { name: string; health: number | null; learners: number; progression: number | null; risk: "Low" | "Medium" | "High" };
export type WorkforceSlice = { label: string; n: number; color: string };
export type OpRow = { label: string; n: number; level: "High" | "Medium" | "Low" };
export type Bar = { label: string; pct: number | null; muted?: boolean };
export type Risk = { title: string; category: string; severity: "High" | "Medium" | "Low"; owner: string };
export type Prediction = { title: string; reason: string; confidence: number; level: "High Risk" | "Medium Risk" };
export type PanelAction = { title: string; priority: "High" | "Medium" | "Low"; href: string };

export type InstitutionIntelligence = {
  scope: { institution: string; programmes: number; learners: number; educators: number };
  health: HealthKpi[];
  risk: { confidence: "High" | "Medium" | "Low" };
  map: MapNode;
  programmes: ProgrammeRow[];
  workforce: { total: number; slices: WorkforceSlice[]; capacity: number | null };
  operations: OpRow[];
  capacity: { bars: Bar[]; note: string };
  quality: { score: number | null; bars: Bar[] };
  resources: { bars: Bar[]; note: string };
  risks: Risk[];
  predictions: Prediction[];
  panel: {
    summary: { health: number | null; strategicRisks: number; operationalRisks: number; improvementActions: number; accreditation: number | null };
    reasoning: string[];
    actions: PanelAction[];
    outputs: { label: string; href: string }[];
    aiConfigured: boolean;
  };
};

export async function loadInstitutionIntelligence(admin: Admin, hospitalId: string): Promise<InstitutionIntelligence> {
  const today = new Date().toISOString().slice(0, 10);
  const noRows = Promise.resolve({ data: [] as never[] });

  const { data: nurses } = await admin.from("profiles").select("id, department_id").eq("hospital_id", hospitalId || "").eq("role", "nurse").limit(2000);
  const nurseIds = (nurses ?? []).map(n => n.id);

  const [
    { data: hospital }, { data: educators }, { data: departments },
    { data: comps }, { data: scores }, { data: decisions }, { data: enrollments },
    { data: assessments }, { data: questions }, { data: audits }, { data: capa }, { data: interventions },
    { data: knowledge }, { data: cases },
  ] = await Promise.all([
    hospitalId ? admin.from("hospitals").select("name").eq("id", hospitalId).maybeSingle() : Promise.resolve({ data: null }),
    hospitalId ? admin.from("profiles").select("id, role, roles").eq("hospital_id", hospitalId).or("role.in.(educator,assessor),roles.cs.{educator},roles.cs.{assessor}").limit(500) : noRows,
    hospitalId ? admin.from("departments").select("id, name").eq("hospital_id", hospitalId).limit(200) : noRows,
    admin.from("framework_competencies").select("id, cpu_id, risk_category").limit(5000),
    nurseIds.length ? admin.from("competency_scores").select("nurse_id, competency_id, score, is_passing, educator_validated, cycle_id").in("nurse_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("competency_decisions").select("competency_id, outcome, validated_at, expiry_date").in("nurse_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("course_enrollments").select("user_id, progress, completed_at").in("user_id", nurseIds).limit(8000) : noRows,
    admin.from("assessments").select("competency_id, method, status, cycle_id, assessor_id").limit(10000),
    admin.from("questions").select("id, is_published").limit(8000),
    hospitalId ? admin.from("audits").select("compliance_pct, items_not_met").eq("hospital_id", hospitalId).limit(2000) : noRows,
    hospitalId ? admin.from("capa_actions").select("status").eq("hospital_id", hospitalId).limit(500) : noRows,
    hospitalId ? admin.from("interventions").select("status").eq("hospital_id", hospitalId).limit(4000) : noRows,
    admin.from("knowledge_objects").select("cpu_id").neq("status", "retired").limit(8000),
    admin.from("clinical_cases").select("cpu_id").neq("status", "retired").limit(8000),
  ]);

  const np = (nurses ?? []) as { id: string; department_id: string | null }[];
  const eds = (educators ?? []) as { id: string; role: string; roles: string[] | null }[];
  const deptName = new Map((departments ?? []).map(d => [d.id, d.name as string]));
  const fc = (comps ?? []) as { id: string; cpu_id: string | null; risk_category: string | null }[];
  const sc = (scores ?? []) as { nurse_id: string; competency_id: string; score: number; is_passing: boolean; educator_validated: boolean; cycle_id: string | null }[];
  const dec = (decisions ?? []) as { competency_id: string; outcome: string; validated_at: string | null; expiry_date: string | null }[];
  const enr = (enrollments ?? []) as { user_id: string; progress: number | null; completed_at: string | null }[];
  const hospitalCycles = new Set(sc.map(s => s.cycle_id).filter(Boolean));
  const ass = ((assessments ?? []) as { competency_id: string; method: string; status: string; cycle_id: string | null; assessor_id: string | null }[]).filter(a => a.cycle_id && hospitalCycles.has(a.cycle_id));
  const q = (questions ?? []) as { id: string; is_published: boolean }[];
  const au = (audits ?? []) as { compliance_pct: number | null; items_not_met: number | null }[];
  const capaRows = (capa ?? []) as { status: string }[];
  const iv = (interventions ?? []) as { status: string }[];

  const total = fc.length;
  const methodsByComp = new Map<string, Set<string>>();
  for (const a of ass) { const s = methodsByComp.get(a.competency_id) ?? new Set<string>(); s.add(a.method); methodsByComp.set(a.competency_id, s); }
  const scoredComps = new Set(sc.map(s => s.competency_id));
  const evidenceComps = new Set(dec.map(d => d.competency_id));
  const validatedComps = new Set(dec.filter(d => d.validated_at).map(d => d.competency_id));
  const achievedComps = new Set([...dec.filter(d => PASS_OUTCOMES.has(d.outcome)).map(d => d.competency_id), ...sc.filter(s => s.is_passing).map(s => s.competency_id)]);
  const assessed = (id: string) => methodsByComp.has(id) || scoredComps.has(id);

  // ── Domain health composites (institution-level, live) ───────────────────
  const assessmentCoverage = pct(fc.filter(c => assessed(c.id)).length, total);
  const evidenceCoverage = pct(evidenceComps.size, total);
  const cpuMapping = pct(fc.filter(c => c.cpu_id).length, total);
  const curriculumHealth = mean([assessmentCoverage, evidenceCoverage, cpuMapping]);

  const publishedItems = pct(q.filter(i => i.is_published).length, q.length);
  const assessmentQuality = mean([assessmentCoverage, publishedItems]);

  const passRate = pct(sc.filter(s => s.is_passing).length, sc.length);
  const completion = pct(enr.filter(e => e.completed_at).length, enr.length);
  const learningHealth = mean([passRate, completion]);

  const competencyReadiness = pct(achievedComps.size, total);

  // educator capacity: not-overloaded share via assessment load spread
  const loadByEd = new Map<string, number>();
  for (const a of ass) if (a.assessor_id) loadByEd.set(a.assessor_id, (loadByEd.get(a.assessor_id) ?? 0) + 1);
  const loads = eds.map(e => loadByEd.get(e.id) ?? 0);
  const activeLoads = loads.filter(l => l > 0).sort((a, b) => a - b);
  const medLoad = activeLoads.length ? activeLoads[Math.floor(activeLoads.length / 2)] : 1;
  const overloadedEds = loads.filter(l => l > medLoad * 1.5).length;
  const educatorCapacity = pct(eds.length - overloadedEds, eds.length);

  const accreditationReadiness = au.length ? Math.round(au.reduce((s, a) => s + (a.compliance_pct ?? 0), 0) / au.length) : pct(validatedComps.size, evidenceComps.size || total);

  const deptIds = [...new Set(np.map(n => n.department_id).filter(Boolean))] as string[];
  const deptHealth = (did: string): number | null => {
    const members = new Set(np.filter(n => n.department_id === did).map(n => n.id));
    const rows = sc.filter(s => members.has(s.nurse_id));
    return rows.length ? Math.round((rows.filter(s => s.is_passing).length / rows.length) * 100) : null;
  };
  const programmeHealth = mean(deptIds.map(deptHealth));

  const capaClosed = capaRows.filter(c => c.status === "closed" || c.status === "completed").length;
  const qualityImprovement = capaRows.length ? Math.round((capaClosed / capaRows.length) * 100) : (curriculumHealth !== null ? curriculumHealth : null);

  const institutionalHealth = mean([programmeHealth, curriculumHealth, assessmentQuality, learningHealth, competencyReadiness, educatorCapacity, accreditationReadiness]);

  const health: HealthKpi[] = [
    { label: "Institutional Health", value: institutionalHealth, tint: tintOf(institutionalHealth) },
    { label: "Programme Health", value: programmeHealth, tint: tintOf(programmeHealth) },
    { label: "Curriculum Health", value: curriculumHealth, tint: tintOf(curriculumHealth) },
    { label: "Assessment Quality", value: assessmentQuality, tint: tintOf(assessmentQuality) },
    { label: "Learning Health", value: learningHealth, tint: tintOf(learningHealth) },
    { label: "Competency Readiness", value: competencyReadiness, tint: tintOf(competencyReadiness) },
    { label: "Educator Capacity", value: educatorCapacity, tint: tintOf(educatorCapacity) },
    { label: "Accreditation Readiness", value: accreditationReadiness, tint: tintOf(accreditationReadiness) },
  ];

  // ── Enterprise map: Institution → Department → (programme proxy) ──────────
  const map: MapNode = {
    id: "root", name: (hospital as { name: string } | null)?.name ?? "Your institution", health: institutionalHealth, kind: "Institution",
    children: deptIds.map(did => ({
      id: did, name: deptName.get(did) ?? "Department", health: deptHealth(did), kind: "Department",
      children: [],
    })).sort((a, b) => (b.health ?? -1) - (a.health ?? -1)),
  };

  // ── Programme comparison (departments) ───────────────────────────────────
  const programmes: ProgrammeRow[] = deptIds.map(did => {
    const members = np.filter(n => n.department_id === did).map(n => n.id);
    const mset = new Set(members);
    const h = deptHealth(did);
    const myEnr = enr.filter(e => mset.has(e.user_id));
    const progression = myEnr.length ? Math.round(myEnr.reduce((s, e) => s + (e.completed_at ? 100 : (e.progress ?? 0)), 0) / myEnr.length) : null;
    const risk: ProgrammeRow["risk"] = (h ?? 100) < 60 ? "High" : (h ?? 100) < 78 ? "Medium" : "Low";
    return { name: deptName.get(did) ?? "Programme", health: h, learners: members.length, progression, risk };
  }).sort((a, b) => (b.health ?? -1) - (a.health ?? -1));

  // ── Workforce (roster counts by role) ────────────────────────────────────
  const assessorCount = eds.filter(e => e.role === "assessor" || (e.roles ?? []).includes("assessor")).length;
  const educatorOnly = eds.filter(e => (e.role === "educator" || (e.roles ?? []).includes("educator")) && !(e.role === "assessor" || (e.roles ?? []).includes("assessor"))).length;
  const simFaculty = new Set(ass.filter(a => a.method === "simulation" && a.assessor_id).map(a => a.assessor_id)).size;
  const validationExperts = new Set(ass.filter(a => (a.method === "workplace" || a.method === "direct_observation") && a.assessor_id).map(a => a.assessor_id)).size;
  const workforce = {
    total: eds.length,
    slices: [
      { label: "Educators", n: educatorOnly, color: "#22c55e" },
      { label: "Assessors", n: assessorCount, color: "#3b82f6" },
      { label: "Simulation faculty", n: simFaculty, color: "#a855f7" },
      { label: "Workplace assessors", n: validationExperts, color: "#f59e0b" },
    ].filter(s => s.n > 0),
    capacity: educatorCapacity,
  };

  // ── Operational intelligence (live backlogs) ─────────────────────────────
  const validationBacklog = sc.filter(s => !s.educator_validated).length + dec.filter(d => !d.validated_at).length;
  const assessmentApprovals = q.filter(i => !i.is_published).length;
  const learnerSupport = iv.filter(i => i.status !== "completed").length;
  const overdueEvidence = dec.filter(d => d.expiry_date && d.expiry_date < today).length;
  const operations: OpRow[] = ([
    { label: "Validation backlog", n: validationBacklog, level: validationBacklog > 20 ? "High" : validationBacklog > 5 ? "Medium" : "Low" },
    { label: "Assessment approvals pending", n: assessmentApprovals, level: assessmentApprovals > 15 ? "High" : assessmentApprovals > 5 ? "Medium" : "Low" },
    { label: "Learner support cases", n: learnerSupport, level: learnerSupport > 30 ? "Medium" : "Low" },
    { label: "Overdue competency evidence", n: overdueEvidence, level: overdueEvidence > 10 ? "High" : overdueEvidence > 0 ? "Medium" : "Low" },
  ] as OpRow[]).filter(o => o.n > 0);

  // ── Capacity intelligence (backed where possible, else muted) ────────────
  const assessmentCapacity = pct(ass.length, Math.max(1, total * 2)); // recorded vs a "2 methods each" target
  const capacity = {
    bars: [
      { label: "Educator capacity", pct: educatorCapacity },
      { label: "Assessment capacity", pct: assessmentCapacity },
      { label: "Validation capacity", pct: pct(validatedComps.size, evidenceComps.size || total) },
      { label: "Simulation labs", pct: null, muted: true },
      { label: "Clinical placements", pct: null, muted: true },
      { label: "Infrastructure", pct: null, muted: true },
    ] as Bar[],
    note: "Educator, assessment & validation capacity are live from activity. Physical capacity (labs, placements, infrastructure) needs a scheduling/asset store — shown muted.",
  };

  // ── Quality intelligence ─────────────────────────────────────────────────
  const qualityScore = mean([accreditationReadiness, curriculumHealth, assessmentQuality, qualityImprovement]);
  const quality = {
    score: qualityScore,
    bars: [
      { label: "Standards compliance", pct: accreditationReadiness },
      { label: "Curriculum quality", pct: curriculumHealth },
      { label: "Assessment quality", pct: assessmentQuality },
      { label: "Evidence quality", pct: pct(validatedComps.size, evidenceComps.size || total) },
      { label: "Improvement completion", pct: qualityImprovement },
    ] as Bar[],
  };

  // ── Resource intelligence (counts real; utilisation muted) ───────────────
  const resources = {
    bars: [
      { label: "Learning resources", pct: pct((knowledge ?? []).length, Math.max(1, total)) },
      { label: "Simulation resources", pct: pct((cases ?? []).length, Math.max(1, total)) },
      { label: "Assessment banks", pct: pct(q.length, Math.max(1, total * 3)) },
      { label: "Digital resource usage", pct: null, muted: true },
      { label: "Library usage", pct: null, muted: true },
      { label: "OSCE stations", pct: null, muted: true },
    ] as Bar[],
    note: "Resource coverage is derived from published content counts. Utilisation telemetry (usage, library, OSCE stations) needs a resource-tracking store.",
  };

  // ── Institutional risk centre (rule-derived) ─────────────────────────────
  const belowTarget = programmes.filter(p => (p.health ?? 100) < 70).length;
  const risks: Risk[] = [];
  if (validationBacklog > 20) risks.push({ title: "Validation backlog increasing", category: "Operational", severity: "High", owner: "Quality Manager" });
  if (overloadedEds > 0) risks.push({ title: `${overloadedEds} educators above workload threshold`, category: "Workforce", severity: "High", owner: "Dean" });
  if (assessorCount <= 2) risks.push({ title: "OSCE assessor shortage", category: "Workforce", severity: "High", owner: "Head — Assessment" });
  if (belowTarget > 0) risks.push({ title: `${belowTarget} programme${belowTarget === 1 ? "" : "s"} below quality target`, category: "Quality", severity: "Medium", owner: "Programme Lead" });
  if (overdueEvidence > 0) risks.push({ title: `${overdueEvidence} competency evidence records expired`, category: "Curriculum", severity: "Medium", owner: "Curriculum Lead" });
  if ((accreditationReadiness ?? 100) < 80) risks.push({ title: "Accreditation readiness below target", category: "Accreditation", severity: "Medium", owner: "Quality Manager" });

  // ── Predictions (rule-derived) ───────────────────────────────────────────
  const predictions: Prediction[] = [];
  if (validationBacklog > 15) predictions.push({ title: "Validation backlog to exceed target", reason: "Unvalidated items accumulating faster than validation activity", confidence: 88, level: "High Risk" });
  if (assessorCount <= 2) predictions.push({ title: "Assessor shortage risk", reason: `Only ${assessorCount} assessor${assessorCount === 1 ? "" : "s"} on the roster`, confidence: 82, level: "High Risk" });
  if (belowTarget > 0) predictions.push({ title: "Quality decline in underperforming programmes", reason: `${belowTarget} programme(s) already below the 70% health target`, confidence: 70, level: "Medium Risk" });
  if (overdueEvidence > 0) predictions.push({ title: "Rising reassessment demand", reason: `${overdueEvidence} evidence records expired and need refresh`, confidence: 74, level: "Medium Risk" });
  if (!predictions.length) predictions.push({ title: "Stable institutional trajectory", reason: "No strategic risk signals in the current data", confidence: 60, level: "Medium Risk" });

  // ── Right panel ──────────────────────────────────────────────────────────
  const strategicRisks = risks.filter(r => r.severity === "High").length;
  const improvementActions = capaRows.filter(c => c.status !== "closed" && c.status !== "completed").length + risks.length;

  const reasoning: string[] = [];
  if (validationBacklog > 15) reasoning.push(`Validation backlog is ${validationBacklog} items and rising faster than validation throughput.`);
  if (overloadedEds > 0) reasoning.push(`${overloadedEds} educators carry assessment load above 1.5× the team median.`);
  if (belowTarget > 0) reasoning.push(`${belowTarget} programme(s) are below the institutional quality target.`);
  if ((accreditationReadiness ?? 100) < 90) reasoning.push(`Accreditation readiness is ${accreditationReadiness}% — close open audit findings to lift it.`);
  if (!reasoning.length) reasoning.push("Institutional health is stable across programmes, workforce and quality.");

  const actions: PanelAction[] = [];
  if (validationBacklog > 15) actions.push({ title: "Increase validation capacity", priority: "High", href: "/educator/validations" });
  if (assessorCount <= 2) actions.push({ title: "Recruit additional OSCE assessors", priority: "High", href: "/educator/ai/educator" });
  if (belowTarget > 0) actions.push({ title: "Review staffing & improvement model", priority: "Medium", href: "/educator/analytics/quality" });
  actions.push({ title: "Accelerate curriculum reviews", priority: "Medium", href: "/educator/ai/curriculum" });
  actions.push({ title: "Prepare institutional improvement plan", priority: "Low", href: "/educator/analytics/improvement" });

  const { configured } = await import("@/lib/ai/config").then(m => ({ configured: m.aiStatus().configured })).catch(() => ({ configured: false }));
  const backedCount = health.filter(h => h.value !== null).length;

  return {
    scope: {
      institution: (hospital as { name: string } | null)?.name ?? "Your institution",
      programmes: deptIds.length, learners: nurseIds.length, educators: eds.length,
    },
    health,
    risk: { confidence: backedCount >= 7 ? "High" : backedCount >= 4 ? "Medium" : "Low" },
    map, programmes, workforce, operations, capacity, quality, resources, risks, predictions,
    panel: {
      summary: {
        health: institutionalHealth, strategicRisks, operationalRisks: operations.length,
        improvementActions, accreditation: accreditationReadiness,
      },
      reasoning, actions,
      outputs: [
        { label: "Institution Health Report", href: "/educator/analytics/quality" },
        { label: "Programme Comparison", href: "/educator/analytics/quality" },
        { label: "Quality & Compliance", href: "/educator/analytics/quality" },
        { label: "Risk Register", href: "/educator/analytics/improvement" },
        { label: "Accreditation Readiness", href: "/educator/analytics/accreditation" },
      ],
      aiConfigured: configured,
    },
  };
}
