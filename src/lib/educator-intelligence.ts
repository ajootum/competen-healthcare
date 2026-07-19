import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// ── Educator Intelligence Workspace data loader ─────────────────────────────
// The AI-powered educator capacity / workload / effectiveness / development view
// (Educator Intelligence spec v1.0 + mockup). One hospital-scoped pass over the
// live educator roster (educator/assessor profiles) and their assessment
// activity (attributed via assessments.assessor_id) — the one educator signal we
// actually capture. Synthesised into: a health dashboard, navigator, workload
// distribution, capacity by department, an educator workload map, contribution
// mix, a risk centre, rule-derived predictions and the AI panel.
//
// Honest-UI + governance: this workspace never ranks or scores educators
// punitively. Every backed figure comes from real activity. Signals with no
// store — teaching effectiveness per educator (no teaching→outcome link),
// feedback turnaround & quality (no timing store), role readiness, development
// progress, succession, collaboration ratings — are shown muted with a note on
// what each needs, never fabricated. Workload is expressed relative to the team
// median (we hold no contracted-hours data), not as an absolute utilisation %.

const median = (xs: number[]): number => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null);
const mean = (xs: (number | null)[]): number | null => { const v = xs.filter((x): x is number => x !== null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };

export type Tint = "green" | "amber" | "red" | "muted";
export type Band = "Balanced" | "High" | "Overloaded" | "Critical" | "Underutilised";
export type HealthKpi = { label: string; value: number | null; tint: Tint; note?: string };
export type NavNode = { id: string; name: string; meta: string; tint: Tint; children: NavNode[] };
export type WorkloadSlice = { band: Band; n: number; color: string };
export type CapacityRow = { dept: string; educators: number; load: number; utilisation: number | null; band: Band };
export type EducatorDot = { id: string; label: string; x: number; y: number; band: Band; role: string; load: number };
export type MutedMetric = { label: string; note: string };
export type ContribSlice = { label: string; n: number; pct: number; color: string };
export type Risk = { title: string; severity: "High" | "Medium" | "Low"; detail: string };
export type Prediction = { title: string; reason: string; confidence: number };
export type PanelAction = { title: string; priority: "High" | "Medium" | "Low"; href: string };

const BAND_COLOR: Record<Band, string> = { Balanced: "#22c55e", High: "#f59e0b", Overloaded: "#f97316", Critical: "#ef4444", Underutilised: "#3b82f6" };

export type EducatorIntelligence = {
  scope: { institution: string; educators: number; assessors: number; assessments: number };
  health: HealthKpi[];
  risk: { level: "Low" | "Medium" | "High"; confidence: "High" | "Medium" | "Low" };
  navigator: NavNode;
  workload: { total: number; slices: WorkloadSlice[] };
  capacity: { rows: CapacityRow[]; note: string };
  map: EducatorDot[];
  contribution: { slices: ContribSlice[]; note: string };
  unbacked: { teachingEffectiveness: MutedMetric; feedback: MutedMetric[]; development: MutedMetric; succession: MutedMetric };
  risks: Risk[];
  predictions: Prediction[];
  panel: {
    summary: { overloaded: number; developmentNeeds: number | null; capacityGaps: number; highRisks: number; recommendations: number };
    reasoning: string[];
    sources: string[];
    actions: PanelAction[];
    outputs: { label: string; href: string }[];
    aiConfigured: boolean;
  };
};

export async function loadEducatorIntelligence(admin: Admin, hospitalId: string): Promise<EducatorIntelligence> {
  const now = Date.now();
  const d60 = new Date(now - 60 * 86400000).toISOString();
  const noRows = Promise.resolve({ data: [] as never[] });

  const { data: hospital } = hospitalId ? await admin.from("hospitals").select("name").eq("id", hospitalId).maybeSingle() : { data: null };

  const [
    { data: educators }, { data: departments }, { data: scores }, { data: assessments },
  ] = await Promise.all([
    hospitalId ? admin.from("profiles").select("id, full_name, role, roles, department_id").eq("hospital_id", hospitalId).or("role.in.(educator,assessor),roles.cs.{educator},roles.cs.{assessor}").limit(500) : noRows,
    hospitalId ? admin.from("departments").select("id, name").eq("hospital_id", hospitalId).limit(200) : noRows,
    hospitalId ? admin.from("competency_scores").select("cycle_id").limit(8000) : noRows,
    admin.from("assessments").select("assessor_id, method, score, status, cycle_id, assessed_at").limit(10000),
  ]);

  type Edu = { id: string; full_name: string; role: string; roles: string[] | null; department_id: string | null };
  const eds = (educators ?? []) as Edu[];
  const deptName = new Map((departments ?? []).map(d => [d.id, d.name as string]));
  const edIds = new Set(eds.map(e => e.id));
  // Scope assessments to this hospital via the cycles that produced local scores.
  const hospitalCycles = new Set(((scores ?? []) as { cycle_id: string | null }[]).map(s => s.cycle_id).filter(Boolean));
  const ass = ((assessments ?? []) as { assessor_id: string | null; method: string; score: number | null; status: string; cycle_id: string | null; assessed_at: string }[])
    .filter(a => a.assessor_id && edIds.has(a.assessor_id) && (!a.cycle_id || hospitalCycles.has(a.cycle_id) || !hospitalCycles.size));

  const isAssessor = (e: Edu) => e.role === "assessor" || (e.roles ?? []).includes("assessor");

  // ── Per-educator workload from real assessment activity ──────────────────
  const byEd = new Map<string, { total: number; osce: number; sim: number; wba: number; knowledge: number; pending: number; last: string | null }>();
  for (const e of eds) byEd.set(e.id, { total: 0, osce: 0, sim: 0, wba: 0, knowledge: 0, pending: 0, last: null });
  for (const a of ass) {
    const w = byEd.get(a.assessor_id!)!;
    w.total++;
    if (a.method === "osce") w.osce++;
    else if (a.method === "simulation") w.sim++;
    else if (a.method === "workplace" || a.method === "direct_observation") w.wba++;
    else w.knowledge++;
    if (a.status !== "complete") w.pending++;
    if (!w.last || a.assessed_at > w.last) w.last = a.assessed_at;
  }
  const loads = eds.map(e => byEd.get(e.id)!.total);
  const med = median(loads.filter(l => l > 0)) || 1;
  const bandOf = (load: number): Band => {
    if (load === 0) return "Underutilised";
    if (load > med * 2) return "Critical";
    if (load > med * 1.5) return "Overloaded";
    if (load > med * 1.15) return "High";
    if (load < med * 0.5) return "Underutilised";
    return "Balanced";
  };
  const active = (id: string) => (byEd.get(id)!.last ?? "") >= d60;

  // ── Workload distribution ────────────────────────────────────────────────
  const bands: Band[] = ["Balanced", "High", "Overloaded", "Critical", "Underutilised"];
  const bandCount = (b: Band) => eds.filter(e => bandOf(byEd.get(e.id)!.total) === b).length;
  const slices: WorkloadSlice[] = bands.map(b => ({ band: b, n: bandCount(b), color: BAND_COLOR[b] }));
  const overloaded = bandCount("Overloaded") + bandCount("Critical");
  const underutilised = bandCount("Underutilised");

  // ── Health KPIs (backed = capacity/workload; rest muted) ─────────────────
  const capacityAdequacy = pct(eds.length - overloaded, eds.length);
  const workloadBalance = pct(bandCount("Balanced"), eds.length);
  const activeShare = pct(eds.filter(e => active(e.id)).length, eds.length);
  const overall = mean([capacityAdequacy, workloadBalance, activeShare]);
  const health: HealthKpi[] = [
    { label: "Overall Educator Health", value: overall, tint: overall === null ? "muted" : overall >= 75 ? "green" : overall >= 50 ? "amber" : "red" },
    { label: "Capacity Adequacy", value: capacityAdequacy, tint: capacityAdequacy === null ? "muted" : capacityAdequacy >= 75 ? "green" : capacityAdequacy >= 50 ? "amber" : "red" },
    { label: "Workload Balance", value: workloadBalance, tint: workloadBalance === null ? "muted" : workloadBalance >= 60 ? "green" : workloadBalance >= 40 ? "amber" : "red" },
    { label: "Active Deployment", value: activeShare, tint: activeShare === null ? "muted" : activeShare >= 75 ? "green" : activeShare >= 50 ? "amber" : "red" },
    { label: "Teaching Effectiveness", value: null, tint: "muted", note: "Needs a teaching-assignment → learner-outcome link" },
    { label: "Assessment Turnaround", value: null, tint: "muted", note: "Needs feedback timestamps (submitted → returned)" },
    { label: "Feedback Quality", value: null, tint: "muted", note: "Needs a feedback-rating store" },
    { label: "Development Progress", value: null, tint: "muted", note: "Needs an educator development-plan store" },
  ];

  // ── Navigator: Institution → Department → Educator ───────────────────────
  const deptIds = [...new Set(eds.map(e => e.department_id).filter(Boolean))] as string[];
  const deptTint = (ids: Edu[]): Tint => { const ov = ids.filter(e => ["Overloaded", "Critical"].includes(bandOf(byEd.get(e.id)!.total))).length; return !ids.length ? "muted" : ov > ids.length / 2 ? "red" : ov > 0 ? "amber" : "green"; };
  const navigator: NavNode = {
    id: "root", name: (hospital as { name: string } | null)?.name ?? "Your institution", meta: `${eds.length} educators`, tint: overall === null ? "muted" : overall >= 75 ? "green" : "amber",
    children: [
      ...deptIds.map(did => {
        const members = eds.filter(e => e.department_id === did);
        return { id: did, name: deptName.get(did) ?? "Department", meta: `${members.length} educators`, tint: deptTint(members), children: members.slice(0, 12).map(e => ({ id: e.id, name: e.full_name, meta: `${byEd.get(e.id)!.total} assess · ${bandOf(byEd.get(e.id)!.total)}`, tint: (["Overloaded", "Critical"].includes(bandOf(byEd.get(e.id)!.total)) ? "red" : bandOf(byEd.get(e.id)!.total) === "Underutilised" ? "muted" : "green") as Tint, children: [] })) };
      }),
      ...(eds.some(e => !e.department_id) ? [{ id: "unassigned", name: "Unassigned", meta: `${eds.filter(e => !e.department_id).length} educators`, tint: "muted" as Tint, children: eds.filter(e => !e.department_id).slice(0, 12).map(e => ({ id: e.id, name: e.full_name, meta: `${byEd.get(e.id)!.total} assess`, tint: "green" as Tint, children: [] })) }] : []),
    ],
  };

  // ── Capacity by department (load per educator; demand needs a store) ─────
  const capacity = {
    rows: deptIds.map(did => {
      const members = eds.filter(e => e.department_id === did);
      const load = members.reduce((s, e) => s + byEd.get(e.id)!.total, 0);
      const perEd = members.length ? load / members.length : 0;
      const utilisation = pct(Math.round(perEd), Math.max(1, Math.round(med * 1.5))); // relative to a "full" load = 1.5× median
      const band = members.length ? bandOf(Math.round(perEd)) : "Underutilised";
      return { dept: deptName.get(did) ?? "Department", educators: members.length, load, utilisation, band } as CapacityRow;
    }).sort((a, b) => (b.utilisation ?? 0) - (a.utilisation ?? 0)),
    note: "Utilisation is assessment load per educator relative to the team median. Contracted hours & programme demand need a scheduling store — capacity gaps are directional, not absolute.",
  };

  // ── Educator workload map (volume × recency, coloured by band) ───────────
  const maxLoad = Math.max(1, ...loads);
  const map: EducatorDot[] = eds.filter(e => byEd.get(e.id)!.total > 0 || !active(e.id)).slice(0, 60).map(e => {
    const w = byEd.get(e.id)!;
    const recency = w.last ? Math.max(0, 100 - Math.min(100, Math.round((now - new Date(w.last).getTime()) / (2 * 86400000)))) : 0;
    return { id: e.id, label: e.full_name.split(/\s+/)[0] + " " + (e.full_name.split(/\s+/).slice(-1)[0]?.[0] ?? "") + ".", x: Math.round((w.total / maxLoad) * 100), y: recency, band: bandOf(w.total), role: isAssessor(e) ? "Assessor" : "Educator", load: w.total };
  });

  // ── Contribution mix (from real activity types) ──────────────────────────
  const totOsce = ass.filter(a => a.method === "osce").length;
  const totSim = ass.filter(a => a.method === "simulation").length;
  const totWba = ass.filter(a => a.method === "workplace" || a.method === "direct_observation").length;
  const totKnow = ass.length - totOsce - totSim - totWba;
  const contribTotal = ass.length || 1;
  const contribution = {
    slices: [
      { label: "Knowledge / written", n: totKnow, color: "#3b82f6" },
      { label: "OSCE", n: totOsce, color: "#8b5cf6" },
      { label: "Simulation", n: totSim, color: "#14b8a6" },
      { label: "Workplace / observation", n: totWba, color: "#f59e0b" },
    ].filter(s => s.n > 0).map(s => ({ ...s, pct: Math.round((s.n / contribTotal) * 100) })),
    note: "Contribution is inferred from recorded assessment activity by type. Curriculum, mentoring and committee work need a contribution-log store.",
  };

  // ── Risk centre (rule-derived from real activity) ────────────────────────
  const singlePointDepts = deptIds.filter(did => eds.filter(e => e.department_id === did && active(e.id)).length === 1).length;
  const idle = eds.filter(e => !active(e.id)).length;
  const risks: Risk[] = [];
  if (overloaded) risks.push({ title: `${overloaded} educators above workload threshold`, severity: "High", detail: "Assessment load exceeds 1.5× the team median" });
  if (singlePointDepts) risks.push({ title: `${singlePointDepts} departments depend on a single active educator`, severity: "High", detail: "Single-point dependency risk" });
  if (underutilised) risks.push({ title: `${underutilised} educators underutilised`, severity: "Medium", detail: "Below 0.5× median assessment load — capacity to redistribute" });
  if (idle) risks.push({ title: `${idle} educators inactive for 60+ days`, severity: "Medium", detail: "No recorded assessment activity recently" });

  // ── Predictions (rule-derived) ───────────────────────────────────────────
  const activeAssessors = eds.filter(e => isAssessor(e) && active(e.id)).length;
  const predictions: Prediction[] = [];
  if (activeAssessors <= 2) predictions.push({ title: "Assessor shortage risk", reason: `Only ${activeAssessors} assessor${activeAssessors === 1 ? "" : "s"} active in the last 60 days`, confidence: 80 });
  if (overloaded) predictions.push({ title: "Workload escalation likely", reason: `${overloaded} educators already above threshold; load concentrates without redistribution`, confidence: 72 });
  if (singlePointDepts) predictions.push({ title: "Coverage gap on absence", reason: `${singlePointDepts} departments have a single active educator`, confidence: 68 });
  if (!predictions.length) predictions.push({ title: "Stable educator capacity", reason: "Workload is balanced across active educators", confidence: 60 });

  // ── Right panel ──────────────────────────────────────────────────────────
  const capacityGaps = singlePointDepts + (activeAssessors <= 2 ? 1 : 0);
  const reasoning: string[] = [];
  if (overloaded) reasoning.push(`${overloaded} educators carry assessment load above 1.5× the team median.`);
  if (underutilised) reasoning.push(`${underutilised} educators are underutilised — capacity exists to rebalance.`);
  if (singlePointDepts) reasoning.push(`${singlePointDepts} departments rely on a single active educator.`);
  reasoning.push("Teaching effectiveness, feedback turnaround, development and succession can't be scored — the underlying assignment, timing and plan data isn't captured.");

  const actions: PanelAction[] = [];
  if (overloaded) actions.push({ title: "Reallocate assessment workload", priority: "High", href: "/educator/analytics/learning/faculty" });
  if (activeAssessors <= 2) actions.push({ title: "Schedule assessor calibration", priority: "High", href: "/educator/meetings" });
  if (singlePointDepts) actions.push({ title: "Prepare capacity plan", priority: "Medium", href: "/educator/analytics/quality" });
  if (underutilised) actions.push({ title: "Redistribute to underutilised educators", priority: "Medium", href: "/educator/analytics/learning/faculty" });
  actions.push({ title: "Prepare workload distribution report", priority: "Low", href: "/educator/analytics/learning" });

  const { configured } = await import("@/lib/ai/config").then(m => ({ configured: m.aiStatus().configured })).catch(() => ({ configured: false }));
  const backedCount = [capacityAdequacy, workloadBalance, activeShare].filter(v => v !== null).length;

  return {
    scope: {
      institution: (hospital as { name: string } | null)?.name ?? "Your institution",
      educators: eds.length, assessors: eds.filter(isAssessor).length, assessments: ass.length,
    },
    health,
    risk: {
      level: overall === null ? "Medium" : overloaded > eds.length * 0.25 || (overall < 50) ? "High" : overall < 70 ? "Medium" : "Low",
      confidence: backedCount >= 3 ? "High" : backedCount >= 1 ? "Medium" : "Low",
    },
    navigator,
    workload: { total: eds.length, slices },
    capacity, map, contribution,
    unbacked: {
      teachingEffectiveness: { label: "Teaching Effectiveness", note: "Per-educator teaching impact needs a teaching-assignment → cohort-outcome link. Assessment activity is captured; teaching delivery is not." },
      feedback: [
        { label: "Assessment turnaround", note: "Needs submitted→returned timestamps" },
        { label: "Feedback quality", note: "Needs a learner feedback-rating store" },
        { label: "Moderation participation", note: "Needs a moderation-event store" },
      ],
      development: { label: "Development & Readiness", note: "Role readiness and development progress need an educator competency & development-plan store — surfaced honestly rather than inferred." },
      succession: { label: "Succession & Leadership", note: "Leadership-potential signals need contribution, mentoring and outcome history that isn't captured yet." },
    },
    risks, predictions,
    panel: {
      summary: { overloaded, developmentNeeds: null, capacityGaps, highRisks: risks.filter(r => r.severity === "High").length, recommendations: actions.length + predictions.length },
      reasoning,
      sources: ["Educator & assessor roster", "Assessment activity (assessor-attributed)", "Departments", "Assessment cycles"],
      actions,
      outputs: [
        { label: "Faculty Activity Analytics", href: "/educator/analytics/learning/faculty" },
        { label: "Learning Analytics", href: "/educator/analytics/learning" },
        { label: "Program Quality", href: "/educator/analytics/quality" },
      ],
      aiConfigured: configured,
    },
  };
}
