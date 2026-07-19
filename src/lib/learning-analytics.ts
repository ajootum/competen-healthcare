import { createAdminClient } from "@/lib/supabase/server";
import { computeRiskFlags } from "@/lib/engines/risk";
import { trendOf, type Trend } from "@/lib/analytics-data";

type Admin = ReturnType<typeof createAdminClient>;

// ── Learning Analytics (6 modules) data loader ──────────────────────────────
// One hospital-scoped pass computing the live slices for all six modules
// (Learner, Cohort, Course, Faculty, Trend, Custom). "Cohorts" are the
// hospital's departments — the populated grouping dimension. Every figure is
// real; dimensions with no store (time-spent, logins, lesson-level analytics,
// faculty ratings, forecasting) return null so the UI shows honest states.

export type LearnerRow = {
  id: string; name: string; program: string; currentCompetency: string;
  progress: number | null; avgScore: number | null; lastActive: string | null;
  risk: "High" | "Medium" | "Low" | "None"; engagement: number; aiRec: string;
};
export type CohortRow = {
  id: string; name: string; learners: number; completion: number | null;
  competency: number | null; passRate: number | null; simulation: number | null;
  risk: "High" | "Medium" | "Low";
};
export type CourseRow = { id: string; title: string; level: string; enrolled: number; completion: number | null };
export type FacultyRow = { id: string; name: string; assessments: number; simulations: number; learners: number };
export type MonthPoint = { label: string; completion: number | null; competency: number | null; engagement: number | null; certifications: number };

export type LearningAnalytics = {
  learners: {
    cards: { total: number; active: number; recent: number; inactive: number; completionRate: number | null; avgLearningTime: null };
    timeline: { label: string; assessments: number; completions: number; quizzes: number }[];
    velocity: { competenciesPerWeek: number; completionsPerWeek: number; quizzesPerWeek: number; hoursPerWeek: null };
    table: LearnerRow[];
    heatmap: { rows: string[]; cols: string[]; cells: number[][]; max: number };
    profile: { name: string; strengths: string[]; areas: string[]; consistency: string; dropout: string } | null;
  };
  cohorts: {
    cards: { count: number; highest: { name: string; pct: number } | null; lowest: { name: string; pct: number } | null; avgCompletion: number | null; avgCompetency: number | null };
    table: CohortRow[];
    radar: { domain: string; values: number[] }[];
    cohortNames: string[];
    insights: string[];
  };
  courses: {
    cards: { courses: number; activeLearners: number; completion: number | null; avgScore: number | null; passRate: number | null; avgDuration: number | null };
    funnel: { label: string; n: number }[];
    comparison: CourseRow[];
    content: { label: string; value: number | null }[];
    recs: string[];
  };
  faculty: {
    cards: { faculty: number; courses: number; learners: number; avgTurnaround: null };
    ranking: FacultyRow[];
    insights: string[];
  };
  trends: {
    cards: { completion: Trend; competency: Trend; engagement: Trend; certifications: Trend };
    monthly: MonthPoint[];
  };
};

const RISK_RANK = { High: 3, Medium: 2, Low: 1, None: 0 } as const;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOUR_BUCKETS = ["12–4a", "4–8a", "8a–12", "12–4p", "4–8p", "8p–12"];

export async function loadLearningAnalytics(admin: Admin, hospitalId: string): Promise<LearningAnalytics> {
  const now = new Date().getTime();
  const iso = (ms: number) => new Date(ms).toISOString();
  const d30 = iso(now - 30 * 86400000);
  const noRows = Promise.resolve({ data: [] as never[] });

  const { data: nurses } = await admin.from("profiles")
    .select("id, full_name, specialization, department_id, created_at").eq("hospital_id", hospitalId || "").eq("role", "nurse").limit(2000);
  const nurseIds = (nurses ?? []).map(n => n.id);

  const [
    { data: scores }, { data: enrollments }, { data: quiz },
    { data: departments }, { data: domains }, { data: assessments }, { data: faculty },
  ] = await Promise.all([
    nurseIds.length ? admin.from("competency_scores")
      .select("nurse_id, competency_id, domain_id, cycle_id, score, is_passing, assessed_at, framework_competencies(name)")
      .in("nurse_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("course_enrollments")
      .select("user_id, course_id, progress, completed_at, enrolled_at, certificate_url, courses(title, level, duration_hours)")
      .in("user_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("quiz_attempts").select("user_id, is_correct, attempted_at").in("user_id", nurseIds).limit(8000) : noRows,
    hospitalId ? admin.from("departments").select("id, name").eq("hospital_id", hospitalId).limit(200) : noRows,
    admin.from("framework_domains").select("id, name").limit(2000),
    nurseIds.length ? admin.from("assessments").select("assessor_id, method, cycle_id").limit(10000) : noRows,
    hospitalId ? admin.from("profiles").select("id, full_name, role, roles").eq("hospital_id", hospitalId)
      .or("role.in.(educator,assessor),roles.cs.{educator},roles.cs.{assessor}").limit(500) : noRows,
  ]);

  type Score = { nurse_id: string; competency_id: string; domain_id: string | null; cycle_id: string | null; score: number; is_passing: boolean; assessed_at: string; framework_competencies: { name: string } | null };
  const sc = (scores ?? []) as unknown as Score[];
  type Enr = { user_id: string; course_id: string; progress: number | null; completed_at: string | null; enrolled_at: string; certificate_url: string | null; courses: { title: string; level: string; duration_hours: number | null } | null };
  const enr = (enrollments ?? []) as unknown as Enr[];
  const qz = (quiz ?? []) as { user_id: string; is_correct: boolean; attempted_at: string }[];
  const deptName = new Map((departments ?? []).map(d => [d.id, d.name as string]));
  const domName = new Map((domains ?? []).map(d => [d.id, d.name as string]));
  const nurseById = new Map((nurses ?? []).map(n => [n.id, n]));

  const hospitalCycles = new Set(sc.map(s => s.cycle_id).filter(Boolean));
  const ass = ((assessments ?? []) as { assessor_id: string | null; method: string; cycle_id: string | null }[]).filter(a => a.cycle_id && hospitalCycles.has(a.cycle_id));

  let risks: Awaited<ReturnType<typeof computeRiskFlags>> = [];
  try { risks = await computeRiskFlags(admin, hospitalId); } catch { /* fail-soft */ }
  const riskByNurse = new Map(risks.map(r => [r.nurseId, r]));

  // ── Per-learner aggregation ──
  const lastActive = new Map<string, string>();
  const bump = (id: string, ts: string) => { const cur = lastActive.get(id); if (!cur || ts > cur) lastActive.set(id, ts); };
  for (const s of sc) bump(s.nurse_id, s.assessed_at);
  for (const e of enr) { if (e.completed_at) bump(e.user_id, e.completed_at); bump(e.user_id, e.enrolled_at); }
  for (const q of qz) bump(q.user_id, q.attempted_at);

  const events30 = new Map<string, number>();
  const addEv = (id: string, ts: string) => { if (ts >= d30) events30.set(id, (events30.get(id) ?? 0) + 1); };
  for (const s of sc) addEv(s.nurse_id, s.assessed_at);
  for (const q of qz) addEv(q.user_id, q.attempted_at);
  for (const e of enr) { addEv(e.user_id, e.enrolled_at); if (e.completed_at) addEv(e.user_id, e.completed_at); }
  const maxEv = Math.max(1, ...[...events30.values()]);

  const scByNurse = new Map<string, Score[]>();
  for (const s of sc) { const a = scByNurse.get(s.nurse_id) ?? []; a.push(s); scByNurse.set(s.nurse_id, a); }
  const enrByNurse = new Map<string, Enr[]>();
  for (const e of enr) { const a = enrByNurse.get(e.user_id) ?? []; a.push(e); enrByNurse.set(e.user_id, a); }

  const table: LearnerRow[] = (nurses ?? []).map(n => {
    const mine = scByNurse.get(n.id) ?? [];
    const latest = [...mine].sort((a, b) => b.assessed_at.localeCompare(a.assessed_at))[0];
    const avg = mine.length ? Math.round((mine.reduce((s, x) => s + x.score, 0) / mine.length / 6) * 100) : null;
    const myEnr = enrByNurse.get(n.id) ?? [];
    const progress = myEnr.length ? Math.round(myEnr.reduce((s, e) => s + (e.completed_at ? 100 : (e.progress ?? 0)), 0) / myEnr.length) : null;
    const rk = riskByNurse.get(n.id);
    const risk: LearnerRow["risk"] = !rk ? "None" : rk.flags.some(f => f.type === "critical_failure") || rk.flags.length >= 3 ? "High" : rk.flags.length >= 2 ? "Medium" : "Low";
    const engagement = Math.round(((events30.get(n.id) ?? 0) / maxEv) * 100);
    const active = (lastActive.get(n.id) ?? "") >= d30;
    const aiRec = risk === "High" ? "Assign remediation" : risk !== "None" ? "Recommend simulation" : !active ? "Send encouragement" : (avg ?? 100) < 60 ? "Recommend assessment" : "On track";
    return {
      id: n.id, name: n.full_name as string, program: deptName.get(n.department_id ?? "") ?? (n.specialization as string | null) ?? "General",
      currentCompetency: latest?.framework_competencies?.name ?? "—", progress, avgScore: avg,
      lastActive: lastActive.get(n.id) ?? null, risk, engagement, aiRec,
    };
  }).sort((a, b) => RISK_RANK[b.risk] - RISK_RANK[a.risk] || (b.avgScore ?? 0) - (a.avgScore ?? 0));

  // ── Learner cards ──
  const activeCount = new Set([...events30.keys()]).size;
  const recentNew = (nurses ?? []).filter(n => (n.created_at as string) >= d30).length;
  const completionsAll = enr.filter(e => e.completed_at).length;
  const learnerCards = {
    total: nurseIds.length, active: activeCount, recent: recentNew, inactive: nurseIds.length - activeCount,
    completionRate: enr.length ? Math.round((completionsAll / enr.length) * 100) : null, avgLearningTime: null as null,
  };

  // ── Activity timeline (weekly, last 8 weeks) ──
  const timeline = Array.from({ length: 8 }, (_, i) => {
    const w = 7 - i; const from = now - (w + 1) * 7 * 86400000, to = now - w * 7 * 86400000;
    const inWk = (ts: string) => { const t = new Date(ts).getTime(); return t >= from && t < to; };
    return {
      label: `W${i + 1}`,
      assessments: sc.filter(s => inWk(s.assessed_at)).length,
      completions: enr.filter(e => e.completed_at && inWk(e.completed_at)).length,
      quizzes: qz.filter(q => inWk(q.attempted_at)).length,
    };
  });

  // ── Velocity (avg / week, last 4 weeks) ──
  const in4w = (ts: string) => new Date(ts).getTime() >= now - 28 * 86400000;
  const velocity = {
    competenciesPerWeek: Math.round((sc.filter(s => in4w(s.assessed_at)).length / 4) * 10) / 10,
    completionsPerWeek: Math.round((enr.filter(e => e.completed_at && in4w(e.completed_at)).length / 4) * 10) / 10,
    quizzesPerWeek: Math.round((qz.filter(q => in4w(q.attempted_at)).length / 4) * 10) / 10,
    hoursPerWeek: null as null,
  };

  // ── Engagement heatmap (day × hour-bucket) ──
  const cells = DAYS.map(() => HOUR_BUCKETS.map(() => 0));
  const mark = (ts: string) => { const dt = new Date(ts); const day = (dt.getDay() + 6) % 7; const b = Math.floor(dt.getHours() / 4); cells[day][b]++; };
  for (const s of sc) mark(s.assessed_at);
  for (const q of qz) mark(q.attempted_at);
  for (const e of enr) { mark(e.enrolled_at); if (e.completed_at) mark(e.completed_at); }
  const heatMax = Math.max(1, ...cells.flat());

  // ── AI learner profile (busiest learner, rule-derived) ──
  const topLearner = [...scByNurse.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  let profile: LearningAnalytics["learners"]["profile"] = null;
  if (topLearner) {
    const [nid, mine] = topLearner;
    const byDom = new Map<string, { pass: number; total: number }>();
    for (const s of mine) { const d = domName.get(s.domain_id ?? "") ?? "Other"; const a = byDom.get(d) ?? { pass: 0, total: 0 }; a.total++; if (s.is_passing) a.pass++; byDom.set(d, a); }
    const strengths = [...byDom.entries()].filter(([, v]) => v.pass === v.total).map(([d]) => d).slice(0, 3);
    const areas = [...byDom.entries()].filter(([, v]) => v.pass < v.total).map(([d]) => d).slice(0, 3);
    profile = {
      name: (nurseById.get(nid)?.full_name as string) ?? "—",
      strengths: strengths.length ? strengths : ["Insufficient data"],
      areas: areas.length ? areas : ["None flagged"],
      consistency: mine.length >= 5 ? "Regular" : "Sparse record",
      dropout: (riskByNurse.get(nid)?.flags.length ?? 0) > 0 ? "Elevated" : "Low",
    };
  }

  // ── Cohorts (by department) ──
  const cohortIds = [...new Set((nurses ?? []).map(n => n.department_id).filter(Boolean))] as string[];
  const cohortTable: CohortRow[] = cohortIds.map(cid => {
    const members = (nurses ?? []).filter(n => n.department_id === cid).map(n => n.id);
    const mset = new Set(members);
    const cScores = sc.filter(s => mset.has(s.nurse_id));
    const cEnr = enr.filter(e => mset.has(e.user_id));
    const cSim = ass.filter(a => a.method === "simulation").length; // hospital-level sim proxy
    const passRate = cScores.length ? Math.round((cScores.filter(s => s.is_passing).length / cScores.length) * 100) : null;
    const competency = cScores.length ? Math.round((cScores.reduce((s, x) => s + x.score, 0) / cScores.length / 6) * 100) : null;
    const completion = cEnr.length ? Math.round((cEnr.filter(e => e.completed_at).length / cEnr.length) * 100) : null;
    const flagged = members.filter(id => riskByNurse.has(id)).length;
    const risk: CohortRow["risk"] = flagged > members.length / 2 ? "High" : flagged > 0 ? "Medium" : "Low";
    return { id: cid, name: deptName.get(cid) ?? "Cohort", learners: members.length, completion, competency, passRate, simulation: cSim || null, risk };
  }).sort((a, b) => (b.competency ?? 0) - (a.competency ?? 0));

  const ranked = cohortTable.filter(c => c.competency !== null);
  const cohortRadarDomains = [...new Set(sc.map(s => domName.get(s.domain_id ?? "") ?? "Other"))].slice(0, 6);
  const radar = cohortRadarDomains.map(dom => ({
    domain: dom,
    values: cohortTable.map(c => {
      const members = new Set((nurses ?? []).filter(n => n.department_id === c.id).map(n => n.id));
      const rows = sc.filter(s => members.has(s.nurse_id) && (domName.get(s.domain_id ?? "") ?? "Other") === dom);
      return rows.length ? Math.round((rows.reduce((s, x) => s + x.score, 0) / rows.length / 6) * 100) : 0;
    }),
  }));
  const cohortInsights: string[] = [];
  if (ranked.length) {
    cohortInsights.push(`${ranked[0].name} is the strongest cohort at ${ranked[0].competency}% competency.`);
    if (ranked.length > 1) cohortInsights.push(`${ranked[ranked.length - 1].name} is weakest at ${ranked[ranked.length - 1].competency}% — prioritise support.`);
  }
  const cohorts = {
    cards: {
      count: cohortIds.length,
      highest: ranked[0] ? { name: ranked[0].name, pct: ranked[0].competency! } : null,
      lowest: ranked.length > 1 ? { name: ranked[ranked.length - 1].name, pct: ranked[ranked.length - 1].competency! } : null,
      avgCompletion: cohortTable.some(c => c.completion !== null) ? Math.round(cohortTable.reduce((s, c) => s + (c.completion ?? 0), 0) / cohortTable.length) : null,
      avgCompetency: ranked.length ? Math.round(ranked.reduce((s, c) => s + (c.competency ?? 0), 0) / ranked.length) : null,
    },
    table: cohortTable, radar, cohortNames: cohortTable.map(c => c.name), insights: cohortInsights,
  };

  // ── Courses ──
  const started = enr.filter(e => (e.progress ?? 0) > 0 || e.completed_at).length;
  const activeCourse = enr.filter(e => (e.progress ?? 0) > 0 && !e.completed_at).length;
  const certified = enr.filter(e => e.certificate_url || e.completed_at).length;
  const funnel = [
    { label: "Enrolled", n: enr.length }, { label: "Started", n: started }, { label: "Active", n: activeCourse },
    { label: "Completed", n: completionsAll }, { label: "Certified", n: certified },
  ];
  const byCourse = new Map<string, { title: string; level: string; enrolled: number; completed: number }>();
  for (const e of enr) {
    const a = byCourse.get(e.course_id) ?? { title: e.courses?.title ?? "Course", level: e.courses?.level ?? "—", enrolled: 0, completed: 0 };
    a.enrolled++; if (e.completed_at) a.completed++; byCourse.set(e.course_id, a);
  }
  const comparison: CourseRow[] = [...byCourse.entries()].map(([id, c]) => ({
    id, title: c.title, level: c.level, enrolled: c.enrolled, completion: c.enrolled ? Math.round((c.completed / c.enrolled) * 100) : null,
  })).sort((a, b) => (b.completion ?? 0) - (a.completion ?? 0));
  const durations = enr.map(e => e.courses?.duration_hours).filter((v): v is number => v != null);
  const courseCards = {
    courses: byCourse.size, activeLearners: new Set(enr.map(e => e.user_id)).size,
    completion: enr.length ? Math.round((completionsAll / enr.length) * 100) : null,
    avgScore: null as number | null, passRate: qz.length ? Math.round((qz.filter(q => q.is_correct).length / qz.length) * 100) : null,
    avgDuration: durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : null,
  };
  const courseRecs: string[] = [];
  const worst = comparison.filter(c => c.completion !== null).sort((a, b) => (a.completion ?? 0) - (b.completion ?? 0))[0];
  if (worst && (worst.completion ?? 0) < 60) courseRecs.push(`"${worst.title}" has the lowest completion (${worst.completion}%) — review pacing and content.`);
  if (courseCards.passRate !== null && courseCards.passRate < 70) courseRecs.push(`Quiz pass rate is ${courseCards.passRate}% — some questions may be too difficult.`);
  const courses = {
    cards: courseCards, funnel, comparison,
    content: [
      { label: "Quiz attempts", value: qz.length }, { label: "Videos watched", value: null },
      { label: "Reading completion", value: null }, { label: "Downloads", value: null }, { label: "Simulation usage", value: ass.filter(a => a.method === "simulation").length || null },
    ],
    recs: courseRecs,
  };

  // ── Faculty (activity-based; ratings not tracked) ──
  const facultyList = (faculty ?? []) as { id: string; full_name: string }[];
  const assessByAssessor = new Map<string, { total: number; sim: number }>();
  for (const a of ass) { if (!a.assessor_id) continue; const x = assessByAssessor.get(a.assessor_id) ?? { total: 0, sim: 0 }; x.total++; if (a.method === "simulation") x.sim++; assessByAssessor.set(a.assessor_id, x); }
  const facultyRanking: FacultyRow[] = facultyList.map(f => {
    const x = assessByAssessor.get(f.id) ?? { total: 0, sim: 0 };
    return { id: f.id, name: f.full_name, assessments: x.total, simulations: x.sim, learners: 0 };
  }).sort((a, b) => b.assessments - a.assessments);
  const facultyInsights: string[] = [];
  if (facultyRanking[0]?.assessments) facultyInsights.push(`${facultyRanking[0].name} has conducted the most assessments (${facultyRanking[0].assessments}).`);
  const idle = facultyRanking.filter(f => f.assessments === 0).length;
  if (idle) facultyInsights.push(`${idle} faculty member${idle === 1 ? "" : "s"} have no recorded assessment activity this period.`);
  const facultyMod = {
    cards: { faculty: facultyList.length, courses: byCourse.size, learners: nurseIds.length, avgTurnaround: null as null },
    ranking: facultyRanking, insights: facultyInsights,
  };

  // ── Trends (monthly, last 6 months) ──
  const monthKey = (ms: number) => new Date(ms).toISOString().slice(0, 7);
  const months = Array.from({ length: 6 }, (_, i) => {
    const dt = new Date(now); dt.setMonth(dt.getMonth() - (5 - i));
    return { key: monthKey(dt.getTime()), label: dt.toLocaleDateString(undefined, { month: "short" }) };
  });
  const monthly: MonthPoint[] = months.map(m => {
    const mScores = sc.filter(s => s.assessed_at.slice(0, 7) === m.key);
    const mEnr = enr.filter(e => e.completed_at && e.completed_at.slice(0, 7) === m.key);
    const mQuiz = qz.filter(q => q.attempted_at.slice(0, 7) === m.key);
    const engagementActors = new Set([...mScores.map(s => s.nurse_id), ...mQuiz.map(q => q.user_id), ...mEnr.map(e => e.user_id)]).size;
    return {
      label: m.label,
      completion: mEnr.length ? mEnr.length : (enr.some(e => e.completed_at) ? 0 : null),
      competency: mScores.length ? Math.round((mScores.reduce((s, x) => s + x.score, 0) / mScores.length / 6) * 100) : null,
      engagement: nurseIds.length ? Math.round((engagementActors / nurseIds.length) * 100) : null,
      certifications: enr.filter(e => e.completed_at && e.completed_at.slice(0, 7) === m.key).length,
    };
  });
  const half = (arr: (number | null)[]) => {
    const v = arr.filter((x): x is number => x !== null);
    if (v.length < 2) return null as Trend;
    const mid = Math.floor(v.length / 2);
    const a = v.slice(0, mid).reduce((s, x) => s + x, 0) / mid;
    const b = v.slice(mid).reduce((s, x) => s + x, 0) / (v.length - mid);
    return trendOf(b, a);
  };
  const trends = {
    cards: {
      completion: half(monthly.map(m => m.completion)),
      competency: half(monthly.map(m => m.competency)),
      engagement: half(monthly.map(m => m.engagement)),
      certifications: half(monthly.map(m => m.certifications)),
    },
    monthly,
  };

  return {
    learners: { cards: learnerCards, timeline, velocity, table, heatmap: { rows: HOUR_BUCKETS, cols: DAYS, cells, max: heatMax }, profile },
    cohorts, courses, faculty: facultyMod, trends,
  };
}
