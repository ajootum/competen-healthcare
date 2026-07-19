import { createAdminClient } from "@/lib/supabase/server";
import { trendOf, type Trend } from "@/lib/analytics-data";

type Admin = ReturnType<typeof createAdminClient>;

// ── Competency Analytics (7 modules) data loader ────────────────────────────
// Coverage, Achievement, Heatmaps, Gaps, Domain Performance, Skill Mastery and
// Trends — all computed from live framework + assessment + decision + logbook
// records. Framework structure (competencies, domains, CPUs, skills) is rich;
// learner achievement is whatever has actually been recorded. Dimensions with
// no store (learning-outcome/course mapping, OSCE results, closure time,
// change-point detection) return null so the UI shows honest states.

export const PROFICIENCY = ["Foundational", "Developing", "Proficient", "Advanced", "Expert"] as const;
// Benner 0–6 → proficiency band index (0..4)
const BAND = (s: number) => s >= 6 ? 4 : s >= 5 ? 3 : s >= 4 ? 2 : s >= 2 ? 1 : 0;
const REQUIRED = (risk: string | null) => risk === "high" ? 5 : 4; // Advanced vs Proficient
const MASTERY = [["observed", "Observed"], ["assisted", "Assisted"], ["supervised", "Supervised"], ["independent", "Independent"]] as const;

export type CoverageRow = { name: string; domain: string; dims: boolean[] }; // resource,knowledge,sim,assessment,evidence,reassess
export type LearnerAch = { id: string; name: string; program: string; assigned: number; achieved: number; pctAchieved: number; proficiency: number | null; overdue: number; reassessDue: number; status: "On Track" | "At Risk" | "Excellent" };
export type GapRow = { id: string; name: string; required: number; current: number | null; gap: number; learners: number; risk: "High" | "Medium" | "Low"; category: string; status: string };
export type DomainCard = { id: string; name: string; achievement: number | null; coverage: number; avgScore: number | null; gaps: number; atRisk: number; trend: Trend };
export type SkillRow = { id: string; skill: string; competency: string; learner: string; supervision: string; lastPerformed: string | null; status: string; evidence: number };

export type CompetencyAnalytics = {
  coverage: {
    cards: { total: number; fully: number; partial: number; uncovered: number; overAssessed: number; curriculumRate: number | null; assessmentRate: number | null; evidenceRate: number | null };
    matrix: CoverageRow[];
    funnel: { label: string; n: number }[];
    byFramework: { name: string; pct: number }[];
    insights: string[];
  };
  achievement: {
    cards: { overall: number | null; achieved: number; inProgress: number; notStarted: number; reassessDue: number; avgProficiency: number | null; firstAttempt: number | null; timeToComp: number | null };
    byProficiency: { label: string; n: number; color: string }[];
    byLearner: LearnerAch[];
    byMethod: { label: string; pct: number | null; n: number }[];
    journey: { label: string; n: number }[];
    insights: string[];
  };
  heatmap: {
    cards: { highPerforming: number; criticalWeak: number; unassessed: number; expiring: number; riskIndex: number | null };
    rows: { learner: string; cells: (number | null)[] }[];
    domains: string[];
    insights: string[];
  };
  gaps: {
    cards: { total: number; critical: number; highRiskLearners: number; highRiskDepts: number; overdue: number; avgClosure: number | null };
    register: GapRow[];
    categories: { label: string; n: number; color: string }[];
    priority: { name: string; risk: number; learners: number; severity: number }[];
    recs: string[];
  };
  domains: {
    cards: { highest: { name: string; pct: number } | null; lowest: { name: string; pct: number } | null; avgScore: number | null; criticalRisks: number; readiness: number | null; coverage: number | null };
    scorecards: DomainCard[];
    radar: { domain: string; value: number }[];
    insights: string[];
  };
  skills: {
    cards: { total: number; logged: number; independent: number; supervised: number; verified: number; pending: number; independentRate: number | null };
    distribution: { label: string; n: number }[];
    table: SkillRow[];
    dueReassessment: { skill: string; learner: string; when: string | null }[];
    insights: string[];
  };
  trends: {
    cards: { achievement: Trend; mastery: Trend; readiness: Trend; velocity: number };
    monthly: { label: string; achievement: number | null; coverage: number | null; mastery: number | null }[];
    changePoints: { event: string; when: string; impact: string }[];
    insights: string[];
  };
};

export async function loadCompetencyAnalytics(admin: Admin, hospitalId: string): Promise<CompetencyAnalytics> {
  const now = new Date().getTime();
  const today = new Date().toISOString().slice(0, 10);
  const noRows = Promise.resolve({ data: [] as never[] });

  const { data: nurses } = await admin.from("profiles")
    .select("id, full_name, specialization, department_id").eq("hospital_id", hospitalId || "").eq("role", "nurse").limit(2000);
  const nurseIds = (nurses ?? []).map(n => n.id);
  const nurseName = new Map((nurses ?? []).map(n => [n.id, n.full_name as string]));

  const [
    { data: comps }, { data: domains }, { data: cpus }, { data: scores },
    { data: decisions }, { data: skills }, { data: logbook },
    { data: resourceLinks }, { data: knowledge }, { data: cases }, { data: assessments },
  ] = await Promise.all([
    admin.from("framework_competencies").select("id, name, domain_id, cpu_id, code, risk_category").limit(5000),
    admin.from("framework_domains").select("id, name, framework_id, frameworks(name)").limit(2000),
    admin.from("clinical_practice_units").select("id, reassessment_months, risk_category").limit(2000),
    nurseIds.length ? admin.from("competency_scores").select("nurse_id, competency_id, domain_id, score, is_passing, assessed_at").in("nurse_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("competency_decisions").select("nurse_id, competency_id, domain_id, outcome, maturity, expiry_date, validated_at, created_at").in("nurse_id", nurseIds).limit(8000) : noRows,
    admin.from("competency_skills").select("id, competency_id, name").eq("is_active", true).limit(8000),
    nurseIds.length ? admin.from("skill_log_entries").select("nurse_id, skill_id, skill_name, competency_id, supervision_level, status, performed_at").in("nurse_id", nurseIds).limit(8000) : noRows,
    admin.from("resource_competencies").select("competency_id").limit(8000),
    admin.from("knowledge_objects").select("cpu_id").neq("status", "retired").limit(8000),
    admin.from("clinical_cases").select("cpu_id").neq("status", "retired").limit(8000),
    admin.from("assessments").select("competency_id, method").limit(10000),
  ]);

  type Comp = { id: string; name: string; domain_id: string | null; cpu_id: string | null; code: string | null; risk_category: string | null };
  const fc = (comps ?? []) as Comp[];
  const domName = new Map((domains ?? []).map(d => [d.id, d.name as string]));
  const domFramework = new Map((domains ?? []).map(d => [d.id, (d.frameworks as unknown as { name: string } | null)?.name ?? "Framework"]));
  const cpuReassess = new Map((cpus ?? []).map(c => [c.id, c.reassessment_months as number | null]));
  type Score = { nurse_id: string; competency_id: string; domain_id: string | null; score: number; is_passing: boolean; assessed_at: string };
  const sc = (scores ?? []) as Score[];
  type Dec = { nurse_id: string; competency_id: string; domain_id: string | null; outcome: string; maturity: string | null; expiry_date: string | null; validated_at: string | null; created_at: string };
  const dec = (decisions ?? []) as Dec[];
  const log = (logbook ?? []) as { nurse_id: string; skill_id: string | null; skill_name: string; competency_id: string | null; supervision_level: string; status: string; performed_at: string | null }[];

  // Coverage sets
  const resourceComps = new Set((resourceLinks ?? []).map(r => r.competency_id));
  const knowledgeCpus = new Set((knowledge ?? []).map(k => k.cpu_id).filter(Boolean));
  const simCpus = new Set((cases ?? []).map(c => c.cpu_id).filter(Boolean));
  const assessCount = new Map<string, Set<string>>();
  for (const a of (assessments ?? []) as { competency_id: string; method: string }[]) { const s = assessCount.get(a.competency_id) ?? new Set(); s.add(a.method); assessCount.set(a.competency_id, s); }
  const scoredComps = new Set(sc.map(s => s.competency_id));
  const evidenceComps = new Set(dec.map(d => d.competency_id));
  const validatedComps = new Set(dec.filter(d => d.validated_at).map(d => d.competency_id));
  const PASS_OUTCOMES = new Set(["competent", "provisionally_competent"]);

  const covOf = (c: Comp) => [
    resourceComps.has(c.id),
    !!c.cpu_id && knowledgeCpus.has(c.cpu_id),
    !!c.cpu_id && simCpus.has(c.cpu_id),
    assessCount.has(c.id) || scoredComps.has(c.id),
    evidenceComps.has(c.id),
    !!c.cpu_id && !!cpuReassess.get(c.cpu_id),
  ];

  // ── Module 1: Coverage ──
  const covData = fc.map(c => ({ c, dims: covOf(c), count: covOf(c).filter(Boolean).length }));
  const fully = covData.filter(x => x.count >= 4).length;
  const uncovered = covData.filter(x => x.count === 0).length;
  const partial = fc.length - fully - uncovered;
  const overAssessed = fc.filter(c => (assessCount.get(c.id)?.size ?? 0) > 2).length;
  const coverage = {
    cards: {
      total: fc.length, fully, partial, uncovered, overAssessed,
      curriculumRate: fc.length ? Math.round((covData.filter(x => x.dims[0] || x.dims[1]).length / fc.length) * 100) : null,
      assessmentRate: fc.length ? Math.round((covData.filter(x => x.dims[3]).length / fc.length) * 100) : null,
      evidenceRate: fc.length ? Math.round((covData.filter(x => x.dims[4]).length / fc.length) * 100) : null,
    },
    matrix: covData.slice(0, 14).map(x => ({ name: x.c.name, domain: domName.get(x.c.domain_id ?? "") ?? "—", dims: x.dims })),
    funnel: [
      { label: "Required", n: fc.length },
      { label: "Mapped to curriculum", n: fc.filter(c => c.domain_id).length },
      { label: "Taught", n: covData.filter(x => x.dims[0] || x.dims[1]).length },
      { label: "Practised", n: covData.filter(x => x.dims[2]).length },
      { label: "Assessed", n: covData.filter(x => x.dims[3]).length },
      { label: "Evidence captured", n: covData.filter(x => x.dims[4]).length },
      { label: "Validated", n: fc.filter(c => validatedComps.has(c.id)).length },
    ],
    byFramework: (() => {
      const m = new Map<string, { total: number; assessed: number }>();
      for (const x of covData) { const f = domFramework.get(x.c.domain_id ?? "") ?? "Framework"; const a = m.get(f) ?? { total: 0, assessed: 0 }; a.total++; if (x.dims[3]) a.assessed++; m.set(f, a); }
      return [...m.entries()].map(([name, v]) => ({ name, pct: v.total ? Math.round((v.assessed / v.total) * 100) : 0 })).sort((a, b) => b.pct - a.pct).slice(0, 6);
    })(),
    insights: (() => {
      const out: string[] = [];
      const noAssess = covData.filter(x => !x.dims[3]).length;
      if (noAssess) out.push(`${noAssess} competencies have no assessment method mapped.`);
      const noSim = covData.filter(x => x.dims[3] && !x.dims[2]).length;
      if (noSim) out.push(`${noSim} assessed competencies are not practised in simulation.`);
      const noEvidence = covData.filter(x => !x.dims[4]).length;
      if (noEvidence) out.push(`${noEvidence} competencies have no captured workplace evidence.`);
      return out;
    })(),
  };

  // ── Module 2: Achievement (competency-centric) ──
  const passDecComps = new Set(dec.filter(d => PASS_OUTCOMES.has(d.outcome)).map(d => d.competency_id));
  const passScoreComps = new Set(sc.filter(s => s.is_passing).map(s => s.competency_id));
  const achievedSet = new Set([...passDecComps, ...passScoreComps]);
  const recordedComps = new Set([...scoredComps, ...evidenceComps]);
  const expiredComps = new Set(dec.filter(d => d.expiry_date && d.expiry_date < today).map(d => d.competency_id));
  const achieved = achievedSet.size;
  const notStarted = fc.filter(c => !recordedComps.has(c.id)).length;
  const inProgress = fc.length - achieved - notStarted;
  const avgScoreAll = sc.length ? sc.reduce((s, x) => s + x.score, 0) / sc.length : null;

  const profBands = [0, 0, 0, 0, 0];
  for (const cid of achievedSet) {
    const best = Math.max(...sc.filter(s => s.competency_id === cid).map(s => s.score), 0);
    profBands[BAND(best)]++;
  }
  const PROF_COLORS = ["#ef4444", "#f59e0b", "#3b82f6", "#8b5cf6", "#10b981"];

  const byLearner: LearnerAch[] = (nurses ?? []).map(n => {
    const myScores = sc.filter(s => s.nurse_id === n.id);
    const myDec = dec.filter(d => d.nurse_id === n.id);
    const assignedSet = new Set([...myScores.map(s => s.competency_id), ...myDec.map(d => d.competency_id)]);
    const achievedComps = new Set([...myScores.filter(s => s.is_passing).map(s => s.competency_id), ...myDec.filter(d => PASS_OUTCOMES.has(d.outcome)).map(d => d.competency_id)]);
    const overdue = myDec.filter(d => d.expiry_date && d.expiry_date < today).length;
    const prof = myScores.length ? Math.round((myScores.reduce((s, x) => s + x.score, 0) / myScores.length) * 10) / 10 : null;
    const pctA = assignedSet.size ? Math.round((achievedComps.size / assignedSet.size) * 100) : 0;
    const status: LearnerAch["status"] = overdue > 0 || pctA < 50 ? "At Risk" : pctA >= 85 ? "Excellent" : "On Track";
    return { id: n.id, name: n.full_name as string, program: n.specialization as string ?? "General", assigned: assignedSet.size, achieved: achievedComps.size, pctAchieved: pctA, proficiency: prof, overdue, reassessDue: overdue, status };
  }).sort((a, b) => b.pctAchieved - a.pctAchieved);

  const methodBy = new Map<string, { n: number; pass: number }>();
  for (const a of (assessments ?? []) as { competency_id: string; method: string }[]) {
    const m = methodBy.get(a.method) ?? { n: 0, pass: 0 }; m.n++; if (passScoreComps.has(a.competency_id)) m.pass++; methodBy.set(a.method, m);
  }
  const METHOD_LABELS: Record<string, string> = { direct_observation: "Direct Obs.", simulation: "Simulation", knowledge_test: "Knowledge", osce: "OSCE", case_discussion: "Case Disc.", workplace: "Workplace", portfolio: "Portfolio" };
  const byMethod = [...methodBy.entries()].map(([m, v]) => ({ label: METHOD_LABELS[m] ?? m, pct: v.n ? Math.round((v.pass / v.n) * 100) : null, n: v.n }));

  const achievement = {
    cards: {
      overall: fc.length ? Math.round((achieved / fc.length) * 100) : null,
      achieved, inProgress, notStarted, reassessDue: expiredComps.size,
      avgProficiency: avgScoreAll !== null ? Math.round((avgScoreAll / 6) * 5 * 10) / 10 : null,
      firstAttempt: null as number | null, timeToComp: null as number | null,
    },
    byProficiency: PROFICIENCY.map((label, i) => ({ label, n: profBands[i], color: PROF_COLORS[i] })),
    byLearner, byMethod,
    journey: [
      { label: "Assigned", n: recordedComps.size },
      { label: "Assessment attempted", n: scoredComps.size },
      { label: "Evidence submitted", n: evidenceComps.size },
      { label: "Validated", n: validatedComps.size },
      { label: "Achieved", n: achieved },
      { label: "Reassessment due", n: expiredComps.size },
    ],
    insights: (() => {
      const out: string[] = [];
      if (expiredComps.size) out.push(`${expiredComps.size} competencies are past their reassessment date.`);
      if (notStarted) out.push(`${notStarted} competencies have no learner activity yet.`);
      const excellent = byLearner.filter(l => l.status === "Excellent").length;
      if (excellent) out.push(`${excellent} learner${excellent === 1 ? " is" : "s are"} ready for accelerated progression.`);
      return out;
    })(),
  };

  // ── Module 3: Heatmap (learner × domain) ──
  const domainList = [...new Set(sc.map(s => s.domain_id).filter(Boolean))] as string[];
  const heatRows = (nurses ?? []).map(n => ({
    learner: n.full_name as string,
    cells: domainList.map(did => {
      const rows = sc.filter(s => s.nurse_id === n.id && s.domain_id === did);
      return rows.length ? Math.round(rows.reduce((s, x) => s + x.score, 0) / rows.length) : null;
    }),
  }));
  const compAvg = new Map<string, number[]>();
  for (const s of sc) { const a = compAvg.get(s.competency_id) ?? []; a.push(s.score); compAvg.set(s.competency_id, a); }
  const avgArr = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const heatmap = {
    cards: {
      highPerforming: [...compAvg.values()].filter(a => avgArr(a) >= 5).length,
      criticalWeak: [...compAvg.values()].filter(a => avgArr(a) < 3).length,
      unassessed: fc.length - scoredComps.size,
      expiring: expiredComps.size,
      riskIndex: fc.length ? Math.round((([...compAvg.values()].filter(a => avgArr(a) < 3).length + (fc.length - scoredComps.size)) / fc.length) * 100) : null,
    },
    rows: heatRows,
    domains: domainList.map(d => domName.get(d) ?? "—"),
    insights: (() => {
      const out: string[] = [];
      const weak = [...compAvg.entries()].filter(([, a]) => avgArr(a) < 3).length;
      if (weak) out.push(`${weak} competencies show below-standard performance across learners.`);
      if (fc.length - scoredComps.size > 0) out.push(`${fc.length - scoredComps.size} competencies remain unassessed.`);
      return out;
    })(),
  };

  // ── Module 4: Gaps ──
  const gapRows: GapRow[] = fc.map(c => {
    const cs = sc.filter(s => s.competency_id === c.id);
    const current = cs.length ? Math.round((cs.reduce((s, x) => s + x.score, 0) / cs.length) * 10) / 10 : null;
    const required = REQUIRED(c.risk_category);
    const gap = current !== null ? Math.max(0, Math.round((required - current) * 10) / 10) : required;
    const learners = new Set(cs.filter(s => s.score < required).map(s => s.nurse_id)).size || (current === null ? nurseIds.length : 0);
    const dims = covOf(c);
    const category = !dims[1] ? "Knowledge" : !dims[2] ? "Practical Skill" : !dims[4] ? "Evidence" : (current ?? 0) < 3 ? "Clinical Reasoning" : "Exposure";
    const risk: GapRow["risk"] = c.risk_category === "high" && gap >= 2 ? "High" : gap >= 2 ? "Medium" : "Low";
    return { id: c.id, name: c.name, required, current, gap, learners, risk, category, status: current === null ? "Not started" : "Open" };
  }).filter(g => g.gap > 0).sort((a, b) => b.gap - a.gap || b.learners - a.learners);
  const critical = gapRows.filter(g => g.risk === "High").length;
  const highRiskLearners = new Set(sc.filter(s => { const c = fc.find(x => x.id === s.competency_id); return c && s.score < REQUIRED(c.risk_category); }).map(s => s.nurse_id)).size;
  const catCounts = new Map<string, number>();
  for (const g of gapRows) catCounts.set(g.category, (catCounts.get(g.category) ?? 0) + 1);
  const CAT_COLORS: Record<string, string> = { Knowledge: "#3b82f6", "Practical Skill": "#f59e0b", Evidence: "#10b981", "Clinical Reasoning": "#8b5cf6", Exposure: "#ef4444" };
  const gaps = {
    cards: {
      total: gapRows.length, critical, highRiskLearners,
      highRiskDepts: new Set((nurses ?? []).filter(n => sc.some(s => s.nurse_id === n.id && s.score < 4)).map(n => n.department_id)).size,
      overdue: expiredComps.size, avgClosure: null as number | null,
    },
    register: gapRows.slice(0, 12),
    categories: [...catCounts.entries()].map(([label, n]) => ({ label, n, color: CAT_COLORS[label] ?? "#9ca3af" })),
    priority: gapRows.slice(0, 12).map(g => ({ name: g.name, risk: g.risk === "High" ? 3 : g.risk === "Medium" ? 2 : 1, learners: g.learners, severity: g.gap })),
    recs: (() => {
      const out: string[] = [];
      if (critical) out.push(`${critical} critical gaps need immediate intervention — assign simulation and reassessment.`);
      const knowledge = catCounts.get("Knowledge") ?? 0;
      if (knowledge) out.push(`${knowledge} knowledge gaps — link learning resources and schedule knowledge checks.`);
      return out;
    })(),
  };

  // ── Module 5: Domain Performance ──
  const domainIds = [...new Set(fc.map(c => c.domain_id).filter(Boolean))] as string[];
  const scorecards: DomainCard[] = domainIds.map(did => {
    const dComps = fc.filter(c => c.domain_id === did);
    const dScores = sc.filter(s => s.domain_id === did);
    const dCompIds = new Set(dComps.map(c => c.id));
    const achievedInDom = [...achievedSet].filter(id => dCompIds.has(id)).length;
    const half = now - 45 * 86400000;
    const recent = dScores.filter(s => new Date(s.assessed_at).getTime() >= half);
    const older = dScores.filter(s => new Date(s.assessed_at).getTime() < half);
    const rAvg = recent.length ? recent.reduce((s, x) => s + x.score, 0) / recent.length : 0;
    const oAvg = older.length ? older.reduce((s, x) => s + x.score, 0) / older.length : 0;
    return {
      id: did, name: domName.get(did) ?? "—",
      achievement: dComps.length ? Math.round((achievedInDom / dComps.length) * 100) : null,
      coverage: dComps.length ? Math.round((dComps.filter(c => covOf(c)[3]).length / dComps.length) * 100) : 0,
      avgScore: dScores.length ? Math.round((dScores.reduce((s, x) => s + x.score, 0) / dScores.length / 6) * 100) : null,
      gaps: gapRows.filter(g => dCompIds.has(g.id)).length,
      atRisk: new Set(dScores.filter(s => s.score < 4).map(s => s.nurse_id)).size,
      trend: older.length && recent.length ? trendOf(rAvg, oAvg) : null,
    };
  }).sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1));
  const scored = scorecards.filter(d => d.avgScore !== null);
  const domainsMod = {
    cards: {
      highest: scored[0] ? { name: scored[0].name, pct: scored[0].avgScore! } : null,
      lowest: scored.length > 1 ? { name: scored[scored.length - 1].name, pct: scored[scored.length - 1].avgScore! } : null,
      avgScore: scored.length ? Math.round(scored.reduce((s, d) => s + (d.avgScore ?? 0), 0) / scored.length) : null,
      criticalRisks: scorecards.filter(d => (d.avgScore ?? 100) < 50).length,
      readiness: scored.length ? Math.round(scored.reduce((s, d) => s + (d.achievement ?? 0), 0) / scored.length) : null,
      coverage: scorecards.length ? Math.round(scorecards.reduce((s, d) => s + d.coverage, 0) / scorecards.length) : null,
    },
    scorecards: scorecards.slice(0, 12),
    radar: scored.slice(0, 7).map(d => ({ domain: d.name, value: d.avgScore ?? 0 })),
    insights: (() => {
      const out: string[] = [];
      const decl = scorecards.filter(d => d.trend?.dir === "down");
      if (decl.length) out.push(`${decl[0].name} domain is deteriorating — needs attention.`);
      if (scored.length > 1) out.push(`Strongest: ${scored[0].name}; weakest: ${scored[scored.length - 1].name}.`);
      return out;
    })(),
  };

  // ── Module 6: Skill Mastery ──
  const totalSkills = (skills ?? []).length;
  const compNameById = new Map(fc.map(c => [c.id, c.name]));
  const distribution = MASTERY.map(([key, label]) => ({ label, n: log.filter(l => l.supervision_level === key).length }));
  const independent = log.filter(l => l.supervision_level === "independent").length;
  const verified = log.filter(l => l.status === "verified").length;
  const skillTable: SkillRow[] = log.slice(0, 15).map((l, i) => ({
    id: `${l.skill_id ?? i}`, skill: l.skill_name, competency: l.competency_id ? (compNameById.get(l.competency_id) ?? "—") : "—",
    learner: nurseName.get(l.nurse_id) ?? "—", supervision: MASTERY.find(m => m[0] === l.supervision_level)?.[1] ?? l.supervision_level,
    lastPerformed: l.performed_at, status: l.status, evidence: 1,
  }));
  const skillsMod = {
    cards: {
      total: totalSkills, logged: log.length, independent, supervised: log.filter(l => l.supervision_level === "supervised" || l.supervision_level === "assisted").length,
      verified, pending: log.filter(l => l.status === "pending").length,
      independentRate: log.length ? Math.round((independent / log.length) * 100) : null,
    },
    distribution, table: skillTable,
    dueReassessment: [] as { skill: string; learner: string; when: string | null }[],
    insights: (() => {
      const out: string[] = [];
      if (log.filter(l => l.status === "pending").length) out.push(`${log.filter(l => l.status === "pending").length} logged skills await verification.`);
      if (!log.length) out.push("No skills have been logged in the workplace logbook yet.");
      return out;
    })(),
  };

  // ── Module 7: Trends (monthly, 6 months) ──
  const months = Array.from({ length: 6 }, (_, i) => { const dt = new Date(now); dt.setMonth(dt.getMonth() - (5 - i)); return { key: dt.toISOString().slice(0, 7), label: dt.toLocaleDateString(undefined, { month: "short" }) }; });
  const monthly = months.map(m => {
    const mScores = sc.filter(s => s.assessed_at.slice(0, 7) === m.key);
    const mLog = log.filter(l => l.performed_at && l.performed_at.slice(0, 7) === m.key);
    return {
      label: m.label,
      achievement: mScores.length ? Math.round((mScores.filter(s => s.is_passing).length / mScores.length) * 100) : null,
      coverage: mScores.length ? Math.round((new Set(mScores.map(s => s.competency_id)).size / Math.max(1, fc.length)) * 100) : null,
      mastery: mLog.length ? Math.round((mLog.filter(l => l.supervision_level === "independent").length / mLog.length) * 100) : null,
    };
  });
  const halfTrend = (arr: (number | null)[]) => { const v = arr.filter((x): x is number => x !== null); if (v.length < 2) return null as Trend; const mid = Math.floor(v.length / 2); return trendOf(v.slice(mid).reduce((s, x) => s + x, 0) / (v.length - mid), v.slice(0, mid).reduce((s, x) => s + x, 0) / mid); };
  const trends = {
    cards: {
      achievement: halfTrend(monthly.map(m => m.achievement)),
      mastery: halfTrend(monthly.map(m => m.mastery)),
      readiness: halfTrend(monthly.map(m => m.coverage)),
      velocity: Math.round((sc.filter(s => new Date(s.assessed_at).getTime() >= now - 30 * 86400000).length) * 10) / 10,
    },
    monthly,
    changePoints: [] as { event: string; when: string; impact: string }[],
    insights: (() => {
      const out: string[] = [];
      const t = halfTrend(monthly.map(m => m.achievement));
      if (t) out.push(`Achievement is trending ${t.dir === "up" ? "up" : "down"} ${t.pct}% over the last months.`);
      out.push("Change-point detection needs richer event history — not yet computed.");
      return out;
    })(),
  };

  return { coverage, achievement, heatmap, gaps, domains: domainsMod, skills: skillsMod, trends };
}
