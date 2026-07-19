import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// ── Assessment Analytics (5 modules) data loader ────────────────────────────
// Performance, Question Analytics, Reliability & Validity, Blueprint and
// Difficulty. Recorded assessments, the question bank and quiz attempts are
// live; psychometrics that need per-attempt response matrices (discrimination,
// Bloom mapping, distractor efficiency, Cronbach/KR-20, inter-rater) have no
// store at this data volume and are returned null / shown honestly.

const PASS_OUTCOMES = new Set(["competent", "provisionally_competent"]);
// Question difficulty label → an illustrative facility index (proportion correct).
const DIFF_INDEX: Record<string, number> = { easy: 0.75, medium: 0.5, hard: 0.3 };
const METHOD_LABELS: Record<string, string> = { direct_observation: "Direct Obs.", simulation: "Simulation", knowledge_test: "Knowledge Test", osce: "OSCE", case_discussion: "Case Disc.", workplace: "Workplace", portfolio: "Portfolio" };

export type AsmPerfRow = { label: string; type: string; learners: number; avg: number | null; passRate: number | null; median: number | null; sd: number | null; n: number };
export type QuestionRow = { id: string; content: string; category: string; type: string; difficulty: string; facility: number | null; attempts: number; status: string };

export type AssessmentAnalytics = {
  performance: {
    cards: { total: number; completed: number; avg: number | null; passRate: number | null; firstAttempt: number | null; reassessment: number | null; competencyAch: number | null; qualityIndex: number | null };
    byType: AsmPerfRow[];
    byProgram: { name: string; passRate: number | null }[];
    trend: { label: string; avg: number | null; pass: number | null }[];
    journey: { label: string; n: number }[];
    insights: string[];
  };
  questions: {
    cards: { total: number; highQuality: number; needsReview: number; retired: number; avgDiscrimination: null; avgFacility: number | null; distractorEfficiency: null };
    byDifficulty: { label: string; n: number; color: string }[];
    byType: { label: string; n: number }[];
    byCategory: { label: string; n: number }[];
    table: QuestionRow[];
    insights: string[];
  };
  reliability: {
    cards: { cronbach: number | null; kr20: number | null; interRater: number | null; internalConsistency: number | null; sem: number | null; confidence: string };
    indicators: { label: string; value: number | null }[];
    validity: { label: string; state: string }[];
    insights: string[];
  };
  blueprint: {
    cards: { alignment: number | null; competencyCoverage: number | null; cpuCoverage: number | null; loCoverage: null; missing: number; overrepresented: number };
    matrix: { name: string; dims: (boolean | null)[] }[];
    coverageByArea: { label: string; pct: number }[];
    insights: string[];
  };
  difficulty: {
    cards: { avgIndex: number | null; easy: number; moderate: number; difficult: number; veryDifficult: number };
    distribution: { label: string; n: number; color: string }[];
    byCategory: { label: string; easy: number; medium: number; hard: number; avg: number | null }[];
    insights: string[];
  };
};

export async function loadAssessmentAnalytics(admin: Admin, hospitalId: string): Promise<AssessmentAnalytics> {
  const now = new Date().getTime();
  const noRows = Promise.resolve({ data: [] as never[] });

  const { data: nurses } = await admin.from("profiles").select("id, specialization").eq("hospital_id", hospitalId || "").eq("role", "nurse").limit(2000);
  const nurseIds = (nurses ?? []).map(n => n.id);
  const specById = new Map((nurses ?? []).map(n => [n.id, (n.specialization as string | null) ?? "General"]));

  const [
    { data: scores }, { data: assessments }, { data: questions }, { data: quiz },
    { data: comps }, { data: knowledge }, { data: cases }, { data: decisions },
  ] = await Promise.all([
    nurseIds.length ? admin.from("competency_scores").select("nurse_id, competency_id, cycle_id, score, is_passing, assessed_at").in("nurse_id", nurseIds).limit(8000) : noRows,
    admin.from("assessments").select("competency_id, method, score, status, cycle_id, assessed_at").limit(10000),
    admin.from("questions").select("id, content, type, category, difficulty, is_published").limit(8000),
    nurseIds.length ? admin.from("quiz_attempts").select("question_id, is_correct, user_id").in("user_id", nurseIds).limit(8000) : noRows,
    admin.from("framework_competencies").select("id, name, cpu_id").limit(5000),
    admin.from("knowledge_objects").select("cpu_id").neq("status", "retired").limit(8000),
    admin.from("clinical_cases").select("cpu_id").neq("status", "retired").limit(8000),
    nurseIds.length ? admin.from("competency_decisions").select("competency_id, outcome").in("nurse_id", nurseIds).limit(8000) : noRows,
  ]);

  const sc = (scores ?? []) as { nurse_id: string; competency_id: string; cycle_id: string | null; score: number; is_passing: boolean; assessed_at: string }[];
  const hospitalCycles = new Set(sc.map(s => s.cycle_id).filter(Boolean));
  const ass = ((assessments ?? []) as { competency_id: string; method: string; score: number | null; status: string; cycle_id: string | null; assessed_at: string }[]).filter(a => a.cycle_id && hospitalCycles.has(a.cycle_id));
  const q = (questions ?? []) as { id: string; content: string; type: string; category: string | null; difficulty: string | null; is_published: boolean }[];
  const qz = (quiz ?? []) as { question_id: string; is_correct: boolean; user_id: string }[];
  const fc = (comps ?? []) as { id: string; name: string; cpu_id: string | null }[];

  const stats = (vals: number[]) => {
    if (!vals.length) return { avg: null, median: null, sd: null };
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sorted = [...vals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - avg) ** 2, 0) / vals.length);
    return { avg: Math.round((avg / 6) * 100), median: Math.round((median / 6) * 100), sd: Math.round(sd * 10) / 10 };
  };

  // ── Module 1: Assessment Performance ──
  const allScoreVals = sc.map(s => s.score);
  const passRate = sc.length ? Math.round((sc.filter(s => s.is_passing).length / sc.length) * 100) : null;
  const achievedComps = new Set([...(decisions ?? []).filter((d: { outcome: string }) => PASS_OUTCOMES.has(d.outcome)).map((d: { competency_id: string }) => d.competency_id), ...sc.filter(s => s.is_passing).map(s => s.competency_id)]);
  // group recorded assessments by method
  const methodGroups = new Map<string, { scores: number[]; learners: Set<string> }>();
  for (const a of ass) { const g = methodGroups.get(a.method) ?? { scores: [], learners: new Set() }; if (a.score !== null) g.scores.push(a.score); methodGroups.set(a.method, g); }
  // knowledge test group from quiz
  if (qz.length) { const g = methodGroups.get("knowledge_test") ?? { scores: [], learners: new Set() }; for (const x of qz) { g.scores.push(x.is_correct ? 6 : 0); g.learners.add(x.user_id); } methodGroups.set("knowledge_test", g); }
  const byType: AsmPerfRow[] = [...methodGroups.entries()].map(([m, g]) => {
    const st = stats(g.scores);
    return { label: METHOD_LABELS[m] ?? m, type: m, learners: g.learners.size, avg: st.avg, passRate: g.scores.length ? Math.round((g.scores.filter(v => v >= 4).length / g.scores.length) * 100) : null, median: st.median, sd: st.sd, n: g.scores.length };
  }).sort((a, b) => b.n - a.n);
  const progGroups = new Map<string, { pass: number; total: number }>();
  for (const s of sc) { const p = specById.get(s.nurse_id) ?? "General"; const g = progGroups.get(p) ?? { pass: 0, total: 0 }; g.total++; if (s.is_passing) g.pass++; progGroups.set(p, g); }
  const months = Array.from({ length: 6 }, (_, i) => { const dt = new Date(now); dt.setMonth(dt.getMonth() - (5 - i)); return { key: dt.toISOString().slice(0, 7), label: dt.toLocaleDateString(undefined, { month: "short" }) }; });
  const overallStats = stats(allScoreVals);
  const performance = {
    cards: {
      total: ass.length + qz.length, completed: ass.filter(a => a.status === "complete").length + qz.length,
      avg: overallStats.avg, passRate,
      firstAttempt: null as number | null, reassessment: null as number | null,
      competencyAch: fc.length ? Math.round((achievedComps.size / fc.length) * 100) : null,
      qualityIndex: [overallStats.avg, passRate].filter((v): v is number => v !== null).length ? Math.round([overallStats.avg, passRate].filter((v): v is number => v !== null).reduce((a, b) => a + b, 0) / [overallStats.avg, passRate].filter(v => v !== null).length) : null,
    },
    byType,
    byProgram: [...progGroups.entries()].map(([name, g]) => ({ name, passRate: g.total ? Math.round((g.pass / g.total) * 100) : null })).slice(0, 6),
    trend: months.map(m => { const ms = sc.filter(s => s.assessed_at.slice(0, 7) === m.key); const st = stats(ms.map(s => s.score)); return { label: m.label, avg: st.avg, pass: ms.length ? Math.round((ms.filter(s => s.is_passing).length / ms.length) * 100) : null }; }),
    journey: [
      { label: "Attempted", n: sc.length + qz.length }, { label: "Completed", n: ass.filter(a => a.status === "complete").length + qz.length },
      { label: "Marked", n: sc.length }, { label: "Validated", n: sc.filter(s => s.is_passing).length }, { label: "Competency Awarded", n: achievedComps.size },
    ],
    insights: (() => {
      const out: string[] = [];
      const weak = byType.filter(t => (t.passRate ?? 100) < 60);
      if (weak.length) out.push(`${weak[0].label} assessments show the lowest pass rate (${weak[0].passRate}%).`);
      if (passRate !== null && passRate >= 80) out.push(`Overall pass rate is strong at ${passRate}%.`);
      return out;
    })(),
  };

  // ── Module 2: Question Analytics ──
  const facilityByQ = new Map<string, { correct: number; total: number }>();
  for (const x of qz) { const g = facilityByQ.get(x.question_id) ?? { correct: 0, total: 0 }; g.total++; if (x.is_correct) g.correct++; facilityByQ.set(x.question_id, g); }
  const facilities = [...facilityByQ.values()].map(g => g.correct / g.total);
  const diffCount = { easy: 0, medium: 0, hard: 0, unset: 0 };
  const typeCount = new Map<string, number>();
  const catCount = new Map<string, number>();
  for (const item of q) {
    const dfl = (item.difficulty ?? "").toLowerCase();
    if (dfl === "easy" || dfl === "medium" || dfl === "hard") diffCount[dfl]++; else diffCount.unset++;
    typeCount.set(item.type ?? "other", (typeCount.get(item.type ?? "other") ?? 0) + 1);
    catCount.set(item.category ?? "Uncategorised", (catCount.get(item.category ?? "Uncategorised") ?? 0) + 1);
  }
  const questionsMod = {
    cards: {
      total: q.length, highQuality: q.filter(item => item.is_published).length, needsReview: q.filter(item => !item.is_published).length,
      retired: 0, avgDiscrimination: null as null,
      avgFacility: facilities.length ? Math.round((facilities.reduce((a, b) => a + b, 0) / facilities.length) * 100) : null,
      distractorEfficiency: null as null,
    },
    byDifficulty: [
      { label: "Easy", n: diffCount.easy, color: "#22c55e" }, { label: "Medium", n: diffCount.medium, color: "#f59e0b" },
      { label: "Hard", n: diffCount.hard, color: "#ef4444" }, { label: "Unset", n: diffCount.unset, color: "#cbd5e1" },
    ],
    byType: [...typeCount.entries()].map(([label, n]) => ({ label: label.toUpperCase(), n })),
    byCategory: [...catCount.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n).slice(0, 8),
    table: q.slice(0, 15).map(item => {
      const f = facilityByQ.get(item.id);
      return { id: item.id, content: item.content, category: item.category ?? "—", type: (item.type ?? "—").toUpperCase(), difficulty: item.difficulty ?? "—", facility: f ? Math.round((f.correct / f.total) * 100) : null, attempts: f?.total ?? 0, status: item.is_published ? "Published" : "Draft" };
    }),
    insights: (() => {
      const out: string[] = [];
      if (diffCount.unset) out.push(`${diffCount.unset} questions have no difficulty label set.`);
      if (q.filter(item => !item.is_published).length) out.push(`${q.filter(item => !item.is_published).length} questions are unpublished and need review.`);
      out.push("Discrimination index, Bloom mapping and distractor efficiency need per-attempt response data — not captured at this volume.");
      return out;
    })(),
  };

  // ── Module 3: Reliability & Validity (mostly not computable at this volume) ──
  // KR-20 needs an item×learner correct/incorrect matrix; with sparse attempts it isn't meaningful.
  const reliability = {
    cards: { cronbach: null as number | null, kr20: null as number | null, interRater: null as number | null, internalConsistency: null as number | null, sem: null as number | null, confidence: "Insufficient data" },
    indicators: [
      { label: "Cronbach's Alpha", value: null }, { label: "KR-20", value: null }, { label: "Split-half reliability", value: null },
      { label: "Test–retest reliability", value: null }, { label: "Inter-rater reliability", value: null }, { label: "Generalisability coefficient", value: null },
    ] as { label: string; value: number | null }[],
    validity: [
      { label: "Content validity", state: "Needs review panel" }, { label: "Construct validity", state: "Not tracked" },
      { label: "Criterion validity", state: "Not tracked" }, { label: "Face validity", state: "Not tracked" }, { label: "Consequential validity", state: "Not tracked" },
    ],
    insights: [
      "Reliability coefficients (Cronbach's α, KR-20) need multi-item score matrices across many learners — not available at the current data volume.",
      "Inter-rater agreement needs double-scored encounters; assessor calibration is on the roadmap.",
    ],
  };

  // ── Module 4: Blueprint Performance ──
  const knowledgeCpus = new Set((knowledge ?? []).map((k: { cpu_id: string | null }) => k.cpu_id).filter(Boolean));
  const simCpus = new Set((cases ?? []).map((c: { cpu_id: string | null }) => c.cpu_id).filter(Boolean));
  const assessedComps = new Set([...sc.map(s => s.competency_id), ...ass.map(a => a.competency_id)]);
  // question coverage: competencies whose CPU has a question bank — approximate via knowledge presence
  const blueprintMatrix = fc.slice(0, 12).map(item => ({
    name: item.name,
    dims: [
      assessedComps.has(item.id), // Questions/knowledge assessment
      false, // OSCE stations — none recorded
      !!item.cpu_id && simCpus.has(item.cpu_id), // Simulations
      ass.some(a => a.competency_id === item.id), // Skills assessment
      !!item.cpu_id && knowledgeCpus.has(item.cpu_id), // Portfolio/knowledge evidence
    ] as (boolean | null)[],
  }));
  const compCovered = fc.filter(item => assessedComps.has(item.id)).length;
  const cpuIds = [...new Set(fc.map(item => item.cpu_id).filter(Boolean))];
  const cpuCovered = cpuIds.filter(id => fc.some(item => item.cpu_id === id && assessedComps.has(item.id))).length;
  const blueprint = {
    cards: {
      alignment: fc.length ? Math.round((compCovered / fc.length) * 100) : null,
      competencyCoverage: fc.length ? Math.round((compCovered / fc.length) * 100) : null,
      cpuCoverage: cpuIds.length ? Math.round((cpuCovered / cpuIds.length) * 100) : null,
      loCoverage: null as null, missing: fc.length - compCovered,
      overrepresented: [...facilityByQ.values()].filter(g => g.total > 3).length,
    },
    matrix: blueprintMatrix,
    coverageByArea: [
      { label: "Competencies", pct: fc.length ? Math.round((compCovered / fc.length) * 100) : 0 },
      { label: "CPUs", pct: cpuIds.length ? Math.round((cpuCovered / cpuIds.length) * 100) : 0 },
      { label: "Simulations", pct: cpuIds.length ? Math.round(([...simCpus].filter(id => cpuIds.includes(id)).length / cpuIds.length) * 100) : 0 },
      { label: "Knowledge", pct: cpuIds.length ? Math.round(([...knowledgeCpus].filter(id => cpuIds.includes(id)).length / cpuIds.length) * 100) : 0 },
    ],
    insights: (() => {
      const out: string[] = [];
      if (fc.length - compCovered > 0) out.push(`${fc.length - compCovered} competencies have no assessment coverage (blueprint gap).`);
      out.push("OSCE stations aren't recorded yet — practical-assessment coverage may be understated.");
      return out;
    })(),
  };

  // ── Module 5: Difficulty Analysis ──
  const diffByCat = new Map<string, { easy: number; medium: number; hard: number }>();
  for (const item of q) { const c = item.category ?? "Uncategorised"; const g = diffByCat.get(c) ?? { easy: 0, medium: 0, hard: 0 }; const dfl = (item.difficulty ?? "").toLowerCase(); if (dfl === "easy" || dfl === "medium" || dfl === "hard") g[dfl]++; diffByCat.set(c, g); }
  const idxVals = q.map(item => DIFF_INDEX[(item.difficulty ?? "").toLowerCase()]).filter((v): v is number => v !== undefined);
  const difficulty = {
    cards: {
      avgIndex: idxVals.length ? Math.round((idxVals.reduce((a, b) => a + b, 0) / idxVals.length) * 100) / 100 : null,
      easy: diffCount.easy, moderate: diffCount.medium, difficult: diffCount.hard, veryDifficult: 0,
    },
    distribution: [
      { label: "Easy", n: diffCount.easy, color: "#22c55e" }, { label: "Moderate", n: diffCount.medium, color: "#f59e0b" },
      { label: "Difficult", n: diffCount.hard, color: "#ef4444" }, { label: "Unset", n: diffCount.unset, color: "#cbd5e1" },
    ],
    byCategory: [...diffByCat.entries()].map(([label, g]) => {
      const tot = g.easy + g.medium + g.hard;
      const avg = tot ? Math.round(((g.easy * DIFF_INDEX.easy + g.medium * DIFF_INDEX.medium + g.hard * DIFF_INDEX.hard) / tot) * 100) : null;
      return { label, ...g, avg };
    }).sort((a, b) => (b.easy + b.medium + b.hard) - (a.easy + a.medium + a.hard)).slice(0, 8),
    insights: (() => {
      const out: string[] = [];
      if (diffCount.hard > diffCount.easy + diffCount.medium) out.push("The bank skews difficult — consider adding easier items for balance.");
      else if (diffCount.easy > diffCount.medium + diffCount.hard) out.push("The bank skews easy — add more challenging items to discriminate ability.");
      out.push("True item difficulty (proportion-correct) needs more learner attempts — labels are author-assigned.");
      return out;
    })(),
  };

  return { performance, questions: questionsMod, reliability, blueprint, difficulty };
}
