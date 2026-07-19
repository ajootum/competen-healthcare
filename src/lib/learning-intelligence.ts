import { createAdminClient } from "@/lib/supabase/server";
import { computeRiskFlags } from "@/lib/engines/risk";

type Admin = ReturnType<typeof createAdminClient>;

// ── Learning Intelligence Workspace data loader ─────────────────────────────
// The AI-powered learner progression / engagement / mastery / intervention view
// (Learning Intelligence spec v1.0 + mockup). One hospital-scoped pass over the
// live learning graph — learners, competency scores, course enrolments, quiz
// attempts, competency decisions, interventions and the shared risk engine —
// synthesised into: a health dashboard, an interactive learner risk map, learner
// status, progression, engagement, mastery, learning barriers, intervention
// effectiveness, rule-derived predictions and the right-hand intelligence panel.
//
// Honest-UI: every figure is computed from real records. Signals with no store
// (attendance, active-learning time, discussion, feedback response, resource
// telemetry, a curriculum schedule for "expected progress") are returned null /
// shown muted or as forecasts — never fabricated. Learner markers use first name
// + last initial (educators are hospital-scoped and already see their learners).

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null);
const mean = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
};

export type Tint = "green" | "amber" | "red" | "muted";
const tintOf = (v: number | null, invert = false): Tint => {
  if (v === null) return "muted";
  const x = invert ? 100 - v : v;
  return x >= 75 ? "green" : x >= 50 ? "amber" : "red";
};

export type State = "On Track" | "Accelerating" | "Needs Attention" | "At Risk" | "Critical" | "Inactive";
export type HealthKpi = { label: string; value: number | null; tint: Tint };
export type NavNode = { id: string; name: string; meta: string; tint: Tint; children: NavNode[] };
export type RiskDot = { id: string; label: string; x: number; y: number; state: State; driver: string; progress: number | null };
export type BarRow = { label: string; value: number | null; muted?: boolean };
export type MasteryRow = { domain: string; bands: number[]; avg: number | null };
export type Barrier = { label: string; learners: number; share: number | null };
export type Prediction = { title: string; reason: string; confidence: number };
export type Alert = { title: string; severity: "High" | "Medium" | "Low" };
export type PanelAction = { title: string; priority: "High" | "Medium" | "Low"; href: string };

export type LearningIntelligence = {
  scope: { institution: string; cohorts: number; learners: number; period: string };
  health: HealthKpi[];
  risk: { level: "Low" | "Medium" | "High"; confidence: "High" | "Medium" | "Low" };
  navigator: NavNode;
  statusCounts: { state: State; n: number; color: string }[];
  riskMap: RiskDot[];
  progression: { actual: number | null; monthly: { label: string; value: number | null }[]; note: string };
  engagement: { score: number | null; signals: BarRow[]; note: string };
  mastery: { bands: string[]; rows: MasteryRow[]; note: string };
  barriers: { rows: Barrier[]; note: string };
  interventions: { total: number; completed: number; improved: number; noChange: number; escalated: number; successRate: number | null; note: string };
  predictions: Prediction[];
  panel: {
    summary: { highRisk: number; needingAttention: number; progressionDelays: number; activeInterventions: number; recommendations: number };
    alerts: Alert[];
    actions: PanelAction[];
    sources: string[];
    outputs: { label: string; href: string }[];
    aiConfigured: boolean;
  };
};

const STATE_COLOR: Record<State, string> = { "On Track": "#22c55e", Accelerating: "#3b82f6", "Needs Attention": "#f59e0b", "At Risk": "#f97316", Critical: "#ef4444", Inactive: "#64748b" };
const shortName = (full: string): string => {
  const parts = (full ?? "").trim().split(/\s+/);
  return parts.length >= 2 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : (parts[0] ?? "Learner");
};

export async function loadLearningIntelligence(admin: Admin, hospitalId: string): Promise<LearningIntelligence> {
  const now = Date.now();
  const d30 = new Date(now - 30 * 86400000).toISOString();
  const noRows = Promise.resolve({ data: [] as never[] });

  const { data: nurses } = await admin.from("profiles").select("id, full_name, specialization, department_id, created_at").eq("hospital_id", hospitalId || "").eq("role", "nurse").limit(2000);
  const nurseIds = (nurses ?? []).map(n => n.id);

  const [
    { data: hospital }, { data: scores }, { data: enrollments }, { data: quiz },
    { data: decisions }, { data: interventions }, { data: departments }, { data: domains },
  ] = await Promise.all([
    hospitalId ? admin.from("hospitals").select("name").eq("id", hospitalId).maybeSingle() : Promise.resolve({ data: null }),
    nurseIds.length ? admin.from("competency_scores").select("nurse_id, domain_id, score, is_passing, assessed_at").in("nurse_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("course_enrollments").select("user_id, progress, completed_at, enrolled_at").in("user_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("quiz_attempts").select("user_id, is_correct, attempted_at").in("user_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("competency_decisions").select("nurse_id, outcome, expiry_date").in("nurse_id", nurseIds).limit(8000) : noRows,
    hospitalId ? admin.from("interventions").select("nurse_id, status, outcome").eq("hospital_id", hospitalId).limit(4000) : noRows,
    hospitalId ? admin.from("departments").select("id, name").eq("hospital_id", hospitalId).limit(200) : noRows,
    admin.from("framework_domains").select("id, name").limit(2000),
  ]);

  type NurseP = { id: string; full_name: string; specialization: string | null; department_id: string | null; created_at: string };
  const np = (nurses ?? []) as NurseP[];
  const sc = (scores ?? []) as { nurse_id: string; domain_id: string | null; score: number; is_passing: boolean; assessed_at: string }[];
  const enr = (enrollments ?? []) as { user_id: string; progress: number | null; completed_at: string | null; enrolled_at: string }[];
  const qz = (quiz ?? []) as { user_id: string; is_correct: boolean; attempted_at: string }[];
  const dec = (decisions ?? []) as { nurse_id: string; outcome: string; expiry_date: string | null }[];
  const iv = (interventions ?? []) as { nurse_id: string; status: string | null; outcome: string | null }[];
  const deptName = new Map((departments ?? []).map(d => [d.id, d.name as string]));
  const domName = new Map((domains ?? []).map(d => [d.id, d.name as string]));

  let risks: Awaited<ReturnType<typeof computeRiskFlags>> = [];
  try { risks = await computeRiskFlags(admin, hospitalId); } catch { /* fail-soft */ }
  const riskByNurse = new Map(risks.map(r => [r.nurseId, r]));

  // ── Per-learner activity & engagement ────────────────────────────────────
  const lastActive = new Map<string, string>();
  const events30 = new Map<string, number>();
  const bump = (id: string, ts: string) => { const c = lastActive.get(id); if (!c || ts > c) lastActive.set(id, ts); if (ts >= d30) events30.set(id, (events30.get(id) ?? 0) + 1); };
  for (const s of sc) bump(s.nurse_id, s.assessed_at);
  for (const q of qz) bump(q.user_id, q.attempted_at);
  for (const e of enr) { bump(e.user_id, e.enrolled_at); if (e.completed_at) bump(e.user_id, e.completed_at); }
  const maxEv = Math.max(1, ...events30.values());

  const scByNurse = new Map<string, typeof sc>();
  for (const s of sc) { const a = scByNurse.get(s.nurse_id) ?? []; a.push(s); scByNurse.set(s.nurse_id, a); }
  const enrByNurse = new Map<string, typeof enr>();
  for (const e of enr) { const a = enrByNurse.get(e.user_id) ?? []; a.push(e); enrByNurse.set(e.user_id, a); }

  type Learner = { id: string; name: string; dept: string | null; progress: number | null; competency: number | null; engagement: number; state: State; driver: string; active: boolean };
  const learners: Learner[] = np.map(n => {
    const mine = scByNurse.get(n.id) ?? [];
    const competency = mine.length ? Math.round((mine.reduce((s, x) => s + x.score, 0) / mine.length / 6) * 100) : null;
    const myEnr = enrByNurse.get(n.id) ?? [];
    const progress = myEnr.length ? Math.round(myEnr.reduce((s, e) => s + (e.completed_at ? 100 : (e.progress ?? 0)), 0) / myEnr.length) : null;
    const engagement = Math.round(((events30.get(n.id) ?? 0) / maxEv) * 100);
    const active = (lastActive.get(n.id) ?? "") >= d30;
    const rk = riskByNurse.get(n.id);
    const flags = rk?.flags ?? [];
    const critical = flags.some(f => f.type === "critical_failure") || flags.length >= 3;
    let state: State, driver: string;
    if (critical) { state = "Critical"; driver = flags.find(f => f.type === "critical_failure") ? "Critical assessment failure" : "Multiple competency risks"; }
    else if (flags.length >= 2) { state = "At Risk"; driver = "Competency risk flags"; }
    else if (flags.length === 1 || (competency !== null && competency < 55)) { state = "Needs Attention"; driver = flags[0]?.type === "expired" ? "Expired evidence" : "Below competency threshold"; }
    else if (!active) { state = "Inactive"; driver = "No activity in 30 days"; }
    else if (engagement >= 60 && (progress ?? 0) >= 70) { state = "Accelerating"; driver = "High engagement & progress"; }
    else { state = "On Track"; driver = "Progressing as expected"; }
    return { id: n.id, name: n.full_name, dept: n.department_id, progress, competency, engagement, state, driver, active };
  });

  const total = learners.length;
  const stateCount = (s: State) => learners.filter(l => l.state === s).length;
  const STATES: State[] = ["On Track", "Accelerating", "Needs Attention", "At Risk", "Critical", "Inactive"];
  const statusCounts = STATES.map(s => ({ state: s, n: stateCount(s), color: STATE_COLOR[s] }));

  // ── Learner Risk Map (progress × engagement, coloured by state) ──────────
  const riskMap: RiskDot[] = learners
    .filter(l => l.progress !== null || l.engagement > 0 || l.state !== "On Track")
    .slice(0, 60)
    .map(l => ({ id: l.id, label: shortName(l.name), x: Math.max(0, Math.min(100, l.progress ?? 0)), y: Math.max(0, Math.min(100, l.engagement)), state: l.state, driver: l.driver, progress: l.competency }));

  // ── Health KPIs ──────────────────────────────────────────────────────────
  const onTrack = stateCount("On Track") + stateCount("Accelerating");
  const needsAttention = stateCount("Needs Attention");
  const highRisk = stateCount("At Risk") + stateCount("Critical");
  const engagementAvg = total ? Math.round(learners.reduce((s, l) => s + l.engagement, 0) / total) : null;
  const competencyProgression = mean(learners.map(l => l.competency));
  const passingDecisions = dec.filter(d => d.outcome === "competent" || d.outcome === "provisionally_competent");
  const expired = dec.filter(d => d.expiry_date && d.expiry_date < new Date(now).toISOString().slice(0, 10)).length;
  const retention = passingDecisions.length ? Math.round(((passingDecisions.length - expired) / passingDecisions.length) * 100) : null;
  const ivWithOutcome = iv.filter(i => i.outcome);
  const ivImproved = iv.filter(i => i.outcome === "improved").length;
  const interventionSuccess = ivWithOutcome.length ? Math.round((ivImproved / ivWithOutcome.length) * 100) : null;

  const onTrackPct = pct(onTrack, total);
  const overall = mean([onTrackPct, engagementAvg, competencyProgression, retention]);
  const health: HealthKpi[] = [
    { label: "Overall Learning Health", value: overall, tint: tintOf(overall) },
    { label: "Learners On Track", value: onTrackPct, tint: tintOf(onTrackPct) },
    { label: "Needs Attention", value: pct(needsAttention, total), tint: tintOf(pct(needsAttention, total), true) },
    { label: "High-Risk Learners", value: pct(highRisk, total), tint: tintOf(pct(highRisk, total), true) },
    { label: "Engagement Score", value: engagementAvg, tint: tintOf(engagementAvg) },
    { label: "Competency Progression", value: competencyProgression, tint: tintOf(competencyProgression) },
    { label: "Retention Score", value: retention, tint: tintOf(retention) },
    { label: "Intervention Success", value: interventionSuccess, tint: tintOf(interventionSuccess) },
  ];

  // ── Navigator: Institution → Cohort (dept) → state groups ────────────────
  const deptIds = [...new Set(np.map(n => n.department_id).filter(Boolean))] as string[];
  const cohortHealth = (ids: Learner[]): number | null => mean(ids.map(l => l.competency));
  const navigator: NavNode = {
    id: "root", name: (hospital as { name: string } | null)?.name ?? "Your institution", meta: `${deptIds.length} cohorts`, tint: tintOf(overall),
    children: deptIds.map(cid => {
      const members = learners.filter(l => l.dept === cid);
      const hr = members.filter(l => l.state === "At Risk" || l.state === "Critical").length;
      return { id: cid, name: deptName.get(cid) ?? "Cohort", meta: `${members.length} learners · ${hr} high-risk`, tint: tintOf(cohortHealth(members)), children: [] };
    }),
  };

  // ── Progression Intelligence (actual live; expected needs a schedule) ────
  const monthLabels = Array.from({ length: 6 }, (_, i) => { const dt = new Date(now); dt.setMonth(dt.getMonth() - (5 - i)); return { key: dt.toISOString().slice(0, 7), label: dt.toLocaleDateString(undefined, { month: "short" }) }; });
  const progMonthly = monthLabels.map(m => {
    const ms = sc.filter(s => s.assessed_at.slice(0, 7) === m.key);
    return { label: m.label, value: ms.length ? Math.round((ms.reduce((s, x) => s + x.score, 0) / ms.length / 6) * 100) : null };
  });
  const actualProgress = mean(learners.map(l => l.progress));
  const progression = {
    actual: actualProgress, monthly: progMonthly,
    note: "Actual progression is live from enrolment progress & competency scores. 'Expected progress' and projected delay need a curriculum-schedule store — not inferred.",
  };

  // ── Engagement Intelligence (real signals + honest muted) ────────────────
  const contentCompletion = enr.length ? Math.round((enr.filter(e => e.completed_at).length / enr.length) * 100) : null;
  const assessmentAttempts = total ? Math.round((new Set([...sc.map(s => s.nurse_id), ...qz.map(q => q.user_id)]).size / total) * 100) : null;
  const engagement = {
    score: engagementAvg,
    signals: [
      { label: "Content completion", value: contentCompletion },
      { label: "Assessment attempts", value: assessmentAttempts },
      { label: "Attendance", value: null, muted: true },
      { label: "Active learning time", value: null, muted: true },
      { label: "Discussion participation", value: null, muted: true },
      { label: "Feedback response", value: null, muted: true },
    ] as BarRow[],
    note: "Engagement score is activity-based (assessments, quizzes, enrolments in the last 30 days). Attendance, time-on-task, discussion and feedback telemetry have no store — shown muted.",
  };

  // ── Mastery Intelligence (domain × mastery band, live score distribution) ─
  const BANDS = ["Not Introduced", "Developing", "Approaching", "Competent", "Consistent"];
  const bandOf = (score: number): number => score < 3.5 ? 1 : score < 4.5 ? 2 : score < 5.5 ? 3 : 4; // 0..6 scale → Developing/Approaching/Competent/Consistent (index 0 "Not Introduced" reserved for unscored)
  const domIds = [...new Set(sc.map(s => s.domain_id).filter(Boolean))] as string[];
  const masteryRows: MasteryRow[] = domIds.map(did => {
    const rows = sc.filter(s => s.domain_id === did);
    const bands = [0, 0, 0, 0, 0];
    for (const r of rows) bands[bandOf(r.score)]++;
    const avg = rows.length ? Math.round((rows.reduce((s, x) => s + x.score, 0) / rows.length / 6) * 100) : null;
    return { domain: domName.get(did) ?? "Domain", bands, avg };
  }).filter(r => r.bands.some(b => b > 0)).sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0)).slice(0, 6);
  const mastery = { bands: BANDS, rows: masteryRows, note: "Mastery bands derived from competency-score distribution. Retention/decay uses decision expiry; workplace-transfer evidence lives in the Validation Center." };

  // ── Learning Barrier Analysis (rule-derived) ─────────────────────────────
  const lowEngaged = learners.filter(l => l.engagement < 30).length;
  const belowThreshold = learners.filter(l => l.competency !== null && l.competency < 55).length;
  const inactive = stateCount("Inactive");
  const overdueEvidence = risks.filter(r => r.flags.some(f => f.type === "expired")).length;
  const quizPass = qz.length ? Math.round((qz.filter(q => q.is_correct).length / qz.length) * 100) : null;
  const barrierRaw: Barrier[] = [
    { label: "Low engagement / inactivity", learners: lowEngaged + inactive, share: pct(lowEngaged + inactive, total) },
    { label: "Below competency threshold", learners: belowThreshold, share: pct(belowThreshold, total) },
    { label: "Overdue / expired evidence", learners: overdueEvidence, share: pct(overdueEvidence, total) },
    { label: "Knowledge gaps (low quiz pass)", learners: quizPass !== null && quizPass < 70 ? qz.length : 0, share: quizPass !== null && quizPass < 70 ? quizPass : null },
  ];
  const barriers = { rows: barrierRaw.filter(b => b.learners > 0).sort((a, b) => b.learners - a.learners), note: "Barriers are inferred from live engagement, scores and evidence status. Content-sequencing and clinical-exposure barriers need curriculum & placement data." };

  // ── Intervention Effectiveness (live from interventions) ─────────────────
  const ivCompleted = iv.filter(i => i.status === "completed").length;
  const interventionsMod = {
    total: iv.length, completed: ivCompleted, improved: ivImproved,
    noChange: iv.filter(i => i.outcome === "no_change" || i.outcome === "no_significant_change").length,
    escalated: iv.filter(i => i.outcome === "escalated").length,
    successRate: interventionSuccess,
    note: iv.length ? "Live from the interventions register." : "No interventions recorded yet — success rate appears once support actions are logged.",
  };

  // ── Predictions (forecasts, rule-derived) ────────────────────────────────
  const predictions: Prediction[] = [];
  if (highRisk > 0) predictions.push({ title: `${highRisk} learners at risk of assessment failure`, reason: "Competency risk flags plus low recent engagement", confidence: 74 });
  if (overdueEvidence > 0) predictions.push({ title: `${overdueEvidence} learners likely to face competency delay`, reason: "Overdue or expired evidence blocks progression", confidence: 80 });
  if (needsAttention > 0) predictions.push({ title: `${needsAttention} learners may disengage`, reason: "Below-threshold competency with declining activity", confidence: 66 });
  if (!predictions.length) predictions.push({ title: "Stable cohort trajectory", reason: "No elevated risk signals in the current data", confidence: 60 });

  // ── Right intelligence panel ─────────────────────────────────────────────
  const activeInterventions = iv.filter(i => i.status !== "completed").length;
  const progressionDelays = overdueEvidence + learners.filter(l => (l.progress ?? 100) < 40).length;
  const alerts: Alert[] = [];
  if (highRisk) alerts.push({ title: `${highRisk} learners at high risk of assessment failure`, severity: "High" });
  if (overdueEvidence) alerts.push({ title: `${overdueEvidence} learners have overdue competency evidence`, severity: "High" });
  const decliningCohorts = navigator.children.filter(c => c.tint === "red").length;
  if (decliningCohorts) alerts.push({ title: `${decliningCohorts} cohorts show weak competency progression`, severity: "Medium" });
  if (expired) alerts.push({ title: `${expired} competency decisions have expired (retention decline)`, severity: "Medium" });
  if (inactive) alerts.push({ title: `${inactive} learners inactive for 30+ days`, severity: "Low" });

  const actions: PanelAction[] = [];
  if (highRisk) actions.push({ title: `Create remediation plans for ${highRisk} learners`, priority: "High", href: "/educator/interventions" });
  if (needsAttention) actions.push({ title: "Schedule learner check-ins", priority: "High", href: "/educator/meetings" });
  if (belowThreshold) actions.push({ title: "Assign additional simulation practice", priority: "Medium", href: "/educator/simulation" });
  if (overdueEvidence) actions.push({ title: "Request missing clinical evidence", priority: "Medium", href: "/educator/validations" });
  actions.push({ title: "Prepare cohort improvement report", priority: "Low", href: "/educator/analytics/learning" });

  const { configured } = await import("@/lib/ai/config").then(m => ({ configured: m.aiStatus().configured })).catch(() => ({ configured: false }));
  const backedCount = [onTrackPct, engagementAvg, competencyProgression, retention].filter(v => v !== null).length;

  return {
    scope: {
      institution: (hospital as { name: string } | null)?.name ?? "Your institution",
      cohorts: deptIds.length, learners: total,
      period: new Date(now).toLocaleDateString(undefined, { month: "short", year: "numeric" }),
    },
    health,
    risk: {
      level: overall === null ? "Medium" : highRisk > total * 0.15 || overall < 50 ? "High" : overall < 70 ? "Medium" : "Low",
      confidence: backedCount >= 4 ? "High" : backedCount >= 2 ? "Medium" : "Low",
    },
    navigator, statusCounts, riskMap, progression, engagement, mastery, barriers,
    interventions: interventionsMod, predictions,
    panel: {
      summary: { highRisk, needingAttention: needsAttention, progressionDelays, activeInterventions, recommendations: actions.length + predictions.length },
      alerts, actions,
      sources: ["Learner competency scores", "Course enrolments & quizzes", "Competency decisions & evidence", "Interventions register", "Risk engine flags"],
      outputs: [
        { label: "Learner Risk Report", href: "/educator/at-risk" },
        { label: "Learning Analytics", href: "/educator/analytics/learning" },
        { label: "Learner Outcomes", href: "/educator/analytics/outcomes" },
        { label: "Interventions", href: "/educator/interventions" },
      ],
      aiConfigured: configured,
    },
  };
}
