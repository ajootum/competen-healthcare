import { createAdminClient } from "@/lib/supabase/server";
import { computeRiskFlags } from "@/lib/engines/risk";

type Admin = ReturnType<typeof createAdminClient>;

// ── Analytics & Quality data loader ─────────────────────────────────────────
// Every figure in the Analytics Overview is computed here from live, hospital-
// scoped records. Trends are only emitted when a real prior period exists —
// never a fabricated delta. Dimensions with no backing store (CPD target unset,
// learning-outcome / faculty stores absent) return null so the UI can show an
// honest "not tracked" state instead of a fake bar.

export type Trend = { pct: number; dir: "up" | "down" } | null;

// Relative period-over-period change; null when there's no prior-period basis.
export function trendOf(cur: number, prev: number): Trend {
  if (!prev || prev <= 0) return null;
  const p = ((cur - prev) / prev) * 100;
  if (!isFinite(p) || Math.abs(p) < 0.05) return null;
  return { pct: Math.round(Math.abs(p) * 10) / 10, dir: p >= 0 ? "up" : "down" };
}

// Benner 0–6 → the spec's four achievement bands.
const BAND_OF = (score: number) => score >= 6 ? 3 : score >= 4 ? 2 : score >= 2 ? 1 : 0;
export const BANDS = ["Foundational", "Developing", "Proficient", "Advanced"] as const;

export type AnalyticsData = {
  learners: number;
  kpis: {
    activeLearners: { value: number; active30: number; trend: Trend };
    courseCompletion: { pct: number | null; completed: number; total: number; trend: Trend };
    avgCompetency: { pct: number | null; raw: number | null; trend: Trend };
    passRate: { pct: number | null; trend: Trend };
    atRisk: { count: number };
    cpdCompliance: { pct: number | null; note: string };
  };
  progressTrend: { label: string; overall: number | null; completion: number | null; success: number | null }[];
  heatmap: { domain: string; cells: { band: string; pct: number; n: number }[]; total: number }[];
  quality: { label: string; pct: number | null; backed: boolean }[];
  overallQuality: number | null;
  distribution: { label: string; n: number; color: string }[];
  distributionTotal: number;
  assessmentPerf: { label: string; passRate: number | null; avg: number | null; n: number }[];
  topAtRisk: { id: string; name: string; program: string; score: number; level: "High" | "Medium" | "Low" }[];
};

export async function loadAnalytics(admin: Admin, hospitalId: string): Promise<AnalyticsData> {
  const now = new Date().getTime();
  const iso = (ms: number) => new Date(ms).toISOString();
  const d30 = iso(now - 30 * 86400000);
  const d60 = iso(now - 60 * 86400000);
  const noRows = Promise.resolve({ data: [] as never[] });

  const { data: nurses } = await admin.from("profiles")
    .select("id, full_name, specialization").eq("hospital_id", hospitalId || "").eq("role", "nurse").limit(1000);
  const nurseIds = (nurses ?? []).map(n => n.id);
  const specById = new Map((nurses ?? []).map(n => [n.id, (n.specialization as string | null) ?? "General"]));

  const [
    { data: scores }, { data: enrollments }, { data: quiz },
    { data: fwComps }, { data: domains }, { data: audits },
    { data: cpdLogs }, { data: hospital }, { data: assessments },
  ] = await Promise.all([
    nurseIds.length ? admin.from("competency_scores")
      .select("nurse_id, competency_id, domain_id, cycle_id, score, is_passing, assessed_at, educator_validated")
      .in("nurse_id", nurseIds).limit(5000) : noRows,
    nurseIds.length ? admin.from("course_enrollments")
      .select("user_id, progress, completed_at, enrolled_at").in("user_id", nurseIds).limit(5000) : noRows,
    nurseIds.length ? admin.from("quiz_attempts")
      .select("user_id, is_correct, attempted_at").in("user_id", nurseIds).limit(5000) : noRows,
    admin.from("framework_competencies").select("id").limit(5000),
    admin.from("framework_domains").select("id, name").limit(2000),
    hospitalId ? admin.from("audits").select("compliance_pct").eq("hospital_id", hospitalId).limit(2000) : noRows,
    nurseIds.length ? admin.from("cpd_logs").select("user_id, hours").in("user_id", nurseIds).limit(5000) : noRows,
    hospitalId ? admin.from("hospitals").select("cpd_target_hours").eq("id", hospitalId).maybeSingle() : Promise.resolve({ data: null }),
    nurseIds.length ? admin.from("assessments").select("method, score, cycle_id").limit(10000) : noRows,
  ]);

  const scoreRows = (scores ?? []) as { nurse_id: string; competency_id: string; domain_id: string | null; cycle_id: string | null; score: number; is_passing: boolean; assessed_at: string; educator_validated: boolean }[];
  // Scope assessments to this hospital via the cycles that produced its scores.
  const hospitalCycles = new Set(scoreRows.map(s => s.cycle_id).filter(Boolean));
  const inWin = (t: string, from: string) => t >= from;
  const cur = scoreRows.filter(s => inWin(s.assessed_at, d30));
  const prev = scoreRows.filter(s => s.assessed_at >= d60 && s.assessed_at < d30);

  // ── KPI: Active Learners (distinct nurses assessed in window) ──
  const active30 = new Set(cur.map(s => s.nurse_id)).size;
  const activePrev = new Set(prev.map(s => s.nurse_id)).size;

  // ── KPI: Course Completion ──
  const enr = (enrollments ?? []) as { user_id: string; progress: number | null; completed_at: string | null; enrolled_at: string }[];
  const completed = enr.filter(e => e.completed_at).length;
  const completionPct = enr.length ? Math.round((completed / enr.length) * 100) : null;
  const compCur = enr.filter(e => e.completed_at && e.completed_at >= d30).length;
  const compPrev = enr.filter(e => e.completed_at && e.completed_at >= d60 && e.completed_at < d30).length;

  // ── KPI: Avg Competency Score (% of Benner max 6) ──
  const avgRaw = cur.length ? cur.reduce((s, x) => s + x.score, 0) / cur.length : null;
  const avgPrevRaw = prev.length ? prev.reduce((s, x) => s + x.score, 0) / prev.length : null;
  const avgPct = avgRaw !== null ? Math.round((avgRaw / 6) * 100) : null;

  // ── KPI: Assessment Pass Rate ──
  const passCur = cur.length ? Math.round((cur.filter(s => s.is_passing).length / cur.length) * 100) : null;
  const passPrev = prev.length ? Math.round((prev.filter(s => s.is_passing).length / prev.length) * 100) : null;

  // ── KPI: At-Risk ──
  let risks: Awaited<ReturnType<typeof computeRiskFlags>> = [];
  try { risks = await computeRiskFlags(admin, hospitalId); } catch { /* fail-soft */ }

  // ── KPI: CPD Compliance ──
  const target = (hospital as { cpd_target_hours: number | null } | null)?.cpd_target_hours ?? null;
  const cpd = (cpdLogs ?? []) as { user_id: string; hours: number | null }[];
  const hoursByNurse = new Map<string, number>();
  for (const l of cpd) hoursByNurse.set(l.user_id, (hoursByNurse.get(l.user_id) ?? 0) + (l.hours ?? 0));
  let cpdPct: number | null = null; let cpdNote = "";
  if (!target) cpdNote = "No annual CPD target set for this hospital yet.";
  else if (!cpd.length) cpdNote = "No CPD activity logged yet.";
  else if (nurseIds.length) {
    const meeting = nurseIds.filter(id => (hoursByNurse.get(id) ?? 0) >= target).length;
    cpdPct = Math.round((meeting / nurseIds.length) * 100);
    cpdNote = `≥ ${target}h/yr target`;
  }

  // ── Learning Progress Trend (last 4 weeks) ──
  const progressTrend = [3, 2, 1, 0].map(w => {
    const from = now - (w + 1) * 7 * 86400000, to = now - w * 7 * 86400000;
    const wk = scoreRows.filter(s => { const t = new Date(s.assessed_at).getTime(); return t >= from && t < to; });
    const success = wk.length ? Math.round((wk.filter(s => s.is_passing).length / wk.length) * 100) : null;
    const overall = wk.length ? Math.round((wk.reduce((s, x) => s + x.score, 0) / wk.length / 6) * 100) : null;
    // cumulative completion up to the end of this week
    const done = enr.filter(e => e.completed_at && new Date(e.completed_at).getTime() < to).length;
    const completion = enr.length ? Math.round((done / enr.length) * 100) : null;
    return { label: `Wk ${4 - w}`, overall, completion, success };
  });

  // ── Competency Achievement Heatmap (domain × band, % of domain's scores) ──
  const domName = new Map((domains ?? []).map(d => [d.id, d.name as string]));
  const byDomain = new Map<string, number[]>(); // domainId -> [b0,b1,b2,b3]
  for (const s of scoreRows) {
    if (!s.domain_id) continue;
    const arr = byDomain.get(s.domain_id) ?? [0, 0, 0, 0];
    arr[BAND_OF(s.score)]++; byDomain.set(s.domain_id, arr);
  }
  const heatmap = [...byDomain.entries()]
    .map(([id, arr]) => {
      const total = arr.reduce((a, b) => a + b, 0);
      return {
        domain: domName.get(id) ?? "Other", total,
        cells: BANDS.map((band, i) => ({ band, n: arr[i], pct: total ? Math.round((arr[i] / total) * 100) : 0 })),
      };
    })
    .sort((a, b) => b.total - a.total).slice(0, 10);

  // ── Program Quality Summary ──
  const coverageTotal = (fwComps ?? []).length;
  const assessedComp = new Set(scoreRows.map(s => s.competency_id)).size;
  const coveragePct = coverageTotal ? Math.round((assessedComp / coverageTotal) * 100) : null;
  const attainment = scoreRows.length ? Math.round((scoreRows.filter(s => s.is_passing).length / scoreRows.length) * 100) : null;
  const engaged = new Set([
    ...cur.map(s => s.nurse_id),
    ...enr.filter(e => e.enrolled_at >= d30 || (e.completed_at && e.completed_at >= d30)).map(e => e.user_id),
    ...((quiz ?? []) as { user_id: string; attempted_at: string }[]).filter(q => q.attempted_at >= d30).map(q => q.user_id),
  ]);
  const engagement = nurseIds.length ? Math.round((engaged.size / nurseIds.length) * 100) : null;
  const complianceRate = (audits ?? []).length
    ? Math.round((audits as { compliance_pct: number | null }[]).reduce((s, a) => s + (a.compliance_pct ?? 0), 0) / (audits ?? []).length) : null;

  const quality: AnalyticsData["quality"] = [
    { label: "Curriculum Coverage", pct: coveragePct, backed: coveragePct !== null },
    { label: "Competency Attainment", pct: attainment, backed: attainment !== null },
    { label: "Learner Engagement", pct: engagement, backed: engagement !== null },
    { label: "Compliance Rate", pct: complianceRate, backed: complianceRate !== null },
    { label: "Learning Outcome Achievement", pct: null, backed: false },
    { label: "Assessment Quality Index", pct: null, backed: false },
    { label: "Faculty Performance", pct: null, backed: false },
  ];
  const backedVals = quality.filter(q => q.backed && q.pct !== null).map(q => q.pct as number);
  const overallQuality = backedVals.length ? Math.round(backedVals.reduce((a, b) => a + b, 0) / backedVals.length) : null;

  // ── Learner Distribution by Progress ──
  const perNurse = new Map<string, { total: number; passing: number }>();
  for (const s of scoreRows) {
    const a = perNurse.get(s.nurse_id) ?? { total: 0, passing: 0 };
    a.total++; if (s.is_passing) a.passing++; perNurse.set(s.nurse_id, a);
  }
  const bandCounts = [0, 0, 0, 0]; // Excellent, Good, Average, At Risk
  for (const a of perNurse.values()) {
    const pct = (a.passing / a.total) * 100;
    bandCounts[pct >= 80 ? 0 : pct >= 60 ? 1 : pct >= 40 ? 2 : 3]++;
  }
  const distribution = [
    { label: "Excellent (80%+)", n: bandCounts[0], color: "#10b981" },
    { label: "Good (60–79%)", n: bandCounts[1], color: "#3b82f6" },
    { label: "Average (40–59%)", n: bandCounts[2], color: "#f59e0b" },
    { label: "At Risk (<40%)", n: bandCounts[3], color: "#ef4444" },
  ];
  const distributionTotal = bandCounts.reduce((a, b) => a + b, 0);

  // ── Assessment Performance Overview (by real source) ──
  const ass = ((assessments ?? []) as { method: string; score: number | null; cycle_id: string | null }[])
    .filter(a => a.cycle_id && hospitalCycles.has(a.cycle_id));
  const obs = ass.filter(a => a.method === "direct_observation");
  const sim = ass.filter(a => a.method === "simulation");
  const q = (quiz ?? []) as { is_correct: boolean }[];
  const perf = (rows: { score: number | null; passing: boolean }[]) => {
    if (!rows.length) return { passRate: null, avg: null, n: 0 };
    const passRate = Math.round((rows.filter(r => r.passing).length / rows.length) * 100);
    const scored = rows.filter(r => r.score !== null);
    const avg = scored.length ? Math.round((scored.reduce((s, r) => s + (r.score ?? 0), 0) / scored.length / 6) * 100) : null;
    return { passRate, avg, n: rows.length };
  };
  const assessmentPerf: AnalyticsData["assessmentPerf"] = [
    { label: "Quizzes", ...perf(q.map(r => ({ score: r.is_correct ? 6 : 0, passing: r.is_correct }))) },
    { label: "Observation", ...perf(obs.map(r => ({ score: r.score, passing: (r.score ?? 0) >= 4 }))) },
    { label: "Simulation", ...perf(sim.map(r => ({ score: r.score, passing: (r.score ?? 0) >= 4 }))) },
    { label: "OSCE", passRate: null, avg: null, n: 0 },
  ];

  // ── Top At-Risk Learners ──
  const topAtRisk = risks.slice(0, 5).map(r => {
    const critical = r.flags.some(f => f.type === "critical_failure");
    const level: "High" | "Medium" | "Low" = critical || r.flags.length >= 3 ? "High" : r.flags.length >= 2 ? "Medium" : "Low";
    return { id: r.nurseId, name: r.nurseName, program: specById.get(r.nurseId) ?? "General", score: r.flags.length, level };
  });

  return {
    learners: nurseIds.length,
    kpis: {
      activeLearners: { value: nurseIds.length, active30, trend: trendOf(active30, activePrev) },
      courseCompletion: { pct: completionPct, completed, total: enr.length, trend: trendOf(compCur, compPrev) },
      avgCompetency: { pct: avgPct, raw: avgRaw, trend: trendOf(avgRaw ?? 0, avgPrevRaw ?? 0) },
      passRate: { pct: passCur, trend: trendOf(passCur ?? 0, passPrev ?? 0) },
      atRisk: { count: risks.length },
      cpdCompliance: { pct: cpdPct, note: cpdNote },
    },
    progressTrend, heatmap, quality, overallQuality,
    distribution, distributionTotal, assessmentPerf, topAtRisk,
  };
}
