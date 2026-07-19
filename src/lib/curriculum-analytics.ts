import { createAdminClient } from "@/lib/supabase/server";
import { type Trend } from "@/lib/analytics-data";

type Admin = ReturnType<typeof createAdminClient>;

// ── Curriculum Analytics (6 modules) data loader ────────────────────────────
// Effectiveness, Blueprint, Learning Outcomes, CPU, Content and Gap analysis.
// "Curricula" are the competency frameworks (the curricula table is empty), and
// domains stand in as learning-outcome proxies (no learning_outcomes store).
// Everything is computed live; unbacked dimensions (learner/faculty satisfaction,
// content engagement, version history, accreditation mapping) return null.

const PASS_OUTCOMES = new Set(["competent", "provisionally_competent"]);

export type CurriculumRow = { id: string; name: string; program: string; completion: number | null; attainment: number | null; quality: number | null; trend: Trend };
export type CpuRow = { id: string; name: string; domain: string; completion: number | null; achievement: number | null; assessments: number; simulation: number; evidence: number; score: number | null };
export type OutcomeRow = { id: string; name: string; achievement: number | null; competencies: number; assessment: number | null; status: string };
export type CurGapRow = { id: string; name: string; category: string; severity: "Critical" | "High" | "Medium" | "Low"; learners: number; rootCause: string; status: string };

export type CurriculumAnalytics = {
  effectiveness: {
    cards: { activeCurricula: number; effectiveness: number | null; attainment: number | null; completion: number | null; satisfaction: null; accreditation: number | null; qualityIndex: number | null };
    table: CurriculumRow[];
    distribution: { label: string; n: number; color: string }[];
    trend: { label: string; value: number | null }[];
    lifecycle: { label: string; n: number }[];
    insights: string[];
  };
  blueprint: {
    cards: { completion: number | null; alignment: number | null; missingLinks: number; assessmentQuality: number | null; cpuMapping: number | null; outcomeAlignment: null };
    matrix: { name: string; dims: (boolean | null)[] }[];
    integrity: { label: string; n: number }[];
    insights: string[];
  };
  outcomes: {
    cards: { achieved: number; partial: number; notAchieved: number; avgAttainment: number | null; assessmentRate: number | null; evidenceQuality: null };
    table: OutcomeRow[];
    insights: string[];
  };
  cpus: {
    cards: { total: number; active: number; highPerforming: number; needsReview: number; completion: number | null; assessmentQuality: number | null; evidence: number | null };
    table: CpuRow[];
    lifecycle: { label: string; n: number; color: string }[];
    radar: { cpu: string; attainment: number; evidence: number }[];
    insights: string[];
  };
  content: {
    cards: { resources: number; documents: number; simulations: number; courses: number; interactive: null; engagement: null; completion: number | null; quality: null };
    byType: { label: string; n: number }[];
    trend: { label: string; enrolled: number; completed: number }[];
    top: { title: string; type: string; enrolled: number; completion: number | null }[];
    insights: string[];
  };
  gaps: {
    cards: { total: number; critical: number; assessment: number; content: number; cpu: number; simulation: number; accreditation: null; faculty: null };
    register: CurGapRow[];
    categories: { label: string; n: number; color: string }[];
    severity: { label: string; n: number; color: string }[];
    insights: string[];
  };
};

export async function loadCurriculumAnalytics(admin: Admin, hospitalId: string): Promise<CurriculumAnalytics> {
  const now = new Date().getTime();
  const noRows = Promise.resolve({ data: [] as never[] });

  const { data: nurses } = await admin.from("profiles").select("id").eq("hospital_id", hospitalId || "").eq("role", "nurse").limit(2000);
  const nurseIds = (nurses ?? []).map(n => n.id);

  const [
    { data: frameworks }, { data: domains }, { data: comps }, { data: cpus },
    { data: scores }, { data: decisions }, { data: enrollments }, { data: courses },
    { data: resourceLinks }, { data: knowledge }, { data: cases }, { data: assessments },
  ] = await Promise.all([
    admin.from("frameworks").select("id, name, library, pub_status").limit(200),
    admin.from("framework_domains").select("id, name, framework_id").limit(2000),
    admin.from("framework_competencies").select("id, name, domain_id, cpu_id, risk_category").limit(5000),
    admin.from("clinical_practice_units").select("id, name, code, risk_category, pub_status").limit(2000),
    nurseIds.length ? admin.from("competency_scores").select("nurse_id, competency_id, domain_id, score, is_passing, assessed_at").in("nurse_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("competency_decisions").select("competency_id, outcome, validated_at").in("nurse_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("course_enrollments").select("course_id, completed_at, enrolled_at, progress, courses(title, category)").in("user_id", nurseIds).limit(8000) : noRows,
    admin.from("courses").select("id, title, category, level, is_published").limit(2000),
    admin.from("resource_competencies").select("competency_id").limit(8000),
    admin.from("knowledge_objects").select("cpu_id").neq("status", "retired").limit(8000),
    admin.from("clinical_cases").select("cpu_id").neq("status", "retired").limit(8000),
    admin.from("assessments").select("competency_id, method").limit(10000),
  ]);

  type Comp = { id: string; name: string; domain_id: string | null; cpu_id: string | null; risk_category: string | null };
  const fc = (comps ?? []) as Comp[];
  const domName = new Map((domains ?? []).map(d => [d.id, d.name as string]));
  const domFw = new Map((domains ?? []).map(d => [d.id, d.framework_id as string]));
  const fwName = new Map((frameworks ?? []).map(f => [f.id, f.name as string]));
  const fwLib = new Map((frameworks ?? []).map(f => [f.id, (f.library as string) ?? "core"]));
  type Score = { nurse_id: string; competency_id: string; domain_id: string | null; score: number; is_passing: boolean; assessed_at: string };
  const sc = (scores ?? []) as Score[];
  const dec = (decisions ?? []) as { competency_id: string; outcome: string; validated_at: string | null }[];

  const resourceComps = new Set((resourceLinks ?? []).map(r => r.competency_id));
  const knowledgeCpus = new Set((knowledge ?? []).map(k => k.cpu_id).filter(Boolean));
  const simCpus = new Set((cases ?? []).map(c => c.cpu_id).filter(Boolean));
  const assessMethods = new Map<string, Set<string>>();
  for (const a of (assessments ?? []) as { competency_id: string; method: string }[]) { const s = assessMethods.get(a.competency_id) ?? new Set(); s.add(a.method); assessMethods.set(a.competency_id, s); }
  const scoredComps = new Set(sc.map(s => s.competency_id));
  const evidenceComps = new Set(dec.map(d => d.competency_id));
  const achievedComps = new Set([...dec.filter(d => PASS_OUTCOMES.has(d.outcome)).map(d => d.competency_id), ...sc.filter(s => s.is_passing).map(s => s.competency_id)]);
  const compAvg = new Map<string, number>();
  { const acc = new Map<string, number[]>(); for (const s of sc) { const a = acc.get(s.competency_id) ?? []; a.push(s.score); acc.set(s.competency_id, a); } for (const [k, v] of acc) compAvg.set(k, v.reduce((x, y) => x + y, 0) / v.length); }

  const compFw = (c: Comp) => domFw.get(c.domain_id ?? "") ?? null;
  const hasAssessment = (id: string) => assessMethods.has(id) || scoredComps.has(id);

  // ── Module 1: Curriculum Effectiveness (frameworks = curricula) ──
  const fwWithComps = [...new Set(fc.map(compFw).filter(Boolean))] as string[];
  const curTable: CurriculumRow[] = fwWithComps.map(fwId => {
    const cs = fc.filter(c => compFw(c) === fwId);
    const ids = new Set(cs.map(c => c.id));
    const fScores = sc.filter(s => ids.has(s.competency_id));
    const completion = cs.length ? Math.round(([...achievedComps].filter(id => ids.has(id)).length / cs.length) * 100) : null;
    const attainment = fScores.length ? Math.round((fScores.filter(s => s.is_passing).length / fScores.length) * 100) : null;
    const coverage = cs.length ? Math.round((cs.filter(c => hasAssessment(c.id)).length / cs.length) * 100) : 0;
    const quality = Math.round(([completion, attainment, coverage].filter((v): v is number => v !== null).reduce((a, b) => a + b, 0)) / Math.max(1, [completion, attainment, coverage].filter(v => v !== null).length));
    return { id: fwId, name: fwName.get(fwId) ?? "Curriculum", program: fwLib.get(fwId) ?? "core", completion, attainment, quality, trend: null };
  }).sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0));

  const qBucket = [0, 0, 0, 0];
  for (const c of curTable) { const q = c.quality ?? 0; qBucket[q >= 80 ? 0 : q >= 60 ? 1 : q >= 40 ? 2 : 3]++; }
  const monthLabels = Array.from({ length: 6 }, (_, i) => { const dt = new Date(now); dt.setMonth(dt.getMonth() - (5 - i)); return { key: dt.toISOString().slice(0, 7), label: dt.toLocaleDateString(undefined, { month: "short" }) }; });
  const effTrend = monthLabels.map(m => { const ms = sc.filter(s => s.assessed_at.slice(0, 7) === m.key); return { label: m.label, value: ms.length ? Math.round((ms.reduce((s, x) => s + x.score, 0) / ms.length / 6) * 100) : null }; });
  const lifecycleCount = new Map<string, number>();
  for (const f of (frameworks ?? [])) lifecycleCount.set(f.pub_status ?? "draft", (lifecycleCount.get(f.pub_status ?? "draft") ?? 0) + 1);
  const allAttain = sc.length ? Math.round((sc.filter(s => s.is_passing).length / sc.length) * 100) : null;
  const allCompletion = fc.length ? Math.round((achievedComps.size / fc.length) * 100) : null;
  const effectiveness = {
    cards: {
      activeCurricula: fwWithComps.length,
      effectiveness: curTable.length ? Math.round(curTable.reduce((s, c) => s + (c.quality ?? 0), 0) / curTable.length) : null,
      attainment: allAttain, completion: allCompletion, satisfaction: null as null,
      accreditation: null as number | null,
      qualityIndex: curTable.length ? Math.round(curTable.reduce((s, c) => s + (c.quality ?? 0), 0) / curTable.length) : null,
    },
    table: curTable.slice(0, 10),
    distribution: [
      { label: "Excellent (80%+)", n: qBucket[0], color: "#10b981" }, { label: "Good (60–79%)", n: qBucket[1], color: "#3b82f6" },
      { label: "Average (40–59%)", n: qBucket[2], color: "#f59e0b" }, { label: "Poor (<40%)", n: qBucket[3], color: "#ef4444" },
    ],
    trend: effTrend, lifecycle: [...lifecycleCount.entries()].map(([label, n]) => ({ label, n })),
    insights: (() => {
      const out: string[] = [];
      const weak = curTable.filter(c => (c.quality ?? 0) < 50);
      if (weak.length) out.push(`${weak[0].name} has the lowest quality index (${weak[0].quality}%) — review content and assessment.`);
      const noSim = fc.filter(c => !(c.cpu_id && simCpus.has(c.cpu_id))).length;
      if (noSim) out.push(`${noSim} competencies lack simulation exposure across curricula.`);
      return out;
    })(),
  };

  // ── Module 2: Blueprint Analytics ──
  // matrix columns: Assessments, Simulations, Evidence, Knowledge (backed) + Courses/Lessons/Clinical (soon = null)
  const blueprintMatrix = fc.slice(0, 12).map(c => ({
    name: c.name,
    dims: [
      hasAssessment(c.id),
      !!c.cpu_id && simCpus.has(c.cpu_id),
      evidenceComps.has(c.id),
      !!c.cpu_id && knowledgeCpus.has(c.cpu_id),
      null, null, // Courses, Clinical placement — no store
    ] as (boolean | null)[],
  }));
  const missingAssess = fc.filter(c => !hasAssessment(c.id)).length;
  const missingSim = fc.filter(c => !(c.cpu_id && simCpus.has(c.cpu_id))).length;
  const orphan = fc.filter(c => !c.domain_id || !c.cpu_id).length;
  const fullyMapped = fc.filter(c => hasAssessment(c.id) && evidenceComps.has(c.id) && !!c.cpu_id).length;
  const blueprint = {
    cards: {
      completion: fc.length ? Math.round((fullyMapped / fc.length) * 100) : null,
      alignment: fc.length ? Math.round((fc.filter(c => c.cpu_id).length / fc.length) * 100) : null,
      missingLinks: missingAssess + orphan,
      assessmentQuality: fc.length ? Math.round((fc.filter(c => hasAssessment(c.id)).length / fc.length) * 100) : null,
      cpuMapping: fc.length ? Math.round((fc.filter(c => c.cpu_id).length / fc.length) * 100) : null,
      outcomeAlignment: null as null,
    },
    matrix: blueprintMatrix,
    integrity: [
      { label: "Missing assessments", n: missingAssess }, { label: "Missing simulations", n: missingSim },
      { label: "Orphan competencies", n: orphan }, { label: "No CPU mapping", n: fc.filter(c => !c.cpu_id).length },
    ],
    insights: (() => {
      const out: string[] = [];
      if (missingAssess) out.push(`${missingAssess} competencies have no assessment mapped.`);
      if (orphan) out.push(`${orphan} competencies are orphaned (no domain or CPU link).`);
      return out;
    })(),
  };

  // ── Module 3: Learning Outcomes (domain proxy) ──
  const domainIds = [...new Set(fc.map(c => c.domain_id).filter(Boolean))] as string[];
  const outcomeTable: OutcomeRow[] = domainIds.map(did => {
    const dComps = fc.filter(c => c.domain_id === did);
    const ids = new Set(dComps.map(c => c.id));
    const achievedN = [...achievedComps].filter(id => ids.has(id)).length;
    const dScores = sc.filter(s => ids.has(s.competency_id));
    const achievement = dComps.length ? Math.round((achievedN / dComps.length) * 100) : null;
    return {
      id: did, name: domName.get(did) ?? "Outcome", achievement, competencies: dComps.length,
      assessment: dScores.length ? Math.round((dScores.filter(s => s.is_passing).length / dScores.length) * 100) : null,
      status: achievement === null ? "Not assessed" : achievement >= 80 ? "Achieved" : achievement >= 40 ? "Partial" : "Not Achieved",
    };
  }).sort((a, b) => (b.achievement ?? -1) - (a.achievement ?? -1));
  const outcomes = {
    cards: {
      achieved: outcomeTable.filter(o => o.status === "Achieved").length,
      partial: outcomeTable.filter(o => o.status === "Partial").length,
      notAchieved: outcomeTable.filter(o => o.status === "Not Achieved").length,
      avgAttainment: outcomeTable.some(o => o.achievement !== null) ? Math.round(outcomeTable.reduce((s, o) => s + (o.achievement ?? 0), 0) / outcomeTable.filter(o => o.achievement !== null).length) : null,
      assessmentRate: fc.length ? Math.round((scoredComps.size / fc.length) * 100) : null,
      evidenceQuality: null as null,
    },
    table: outcomeTable.slice(0, 12),
    insights: (() => {
      const out: string[] = [];
      const under = outcomeTable.filter(o => o.status === "Not Achieved");
      if (under.length) out.push(`${under.length} outcome areas are consistently under-achieved.`);
      out.push("A dedicated learning-outcomes store isn't built — domains are used as outcome proxies.");
      return out;
    })(),
  };

  // ── Module 4: CPU Analytics ──
  type Cpu = { id: string; name: string; code: string | null; risk_category: string | null; pub_status: string | null };
  const cpuList = (cpus ?? []) as Cpu[];
  const cpuTable: CpuRow[] = cpuList.map(cpu => {
    const cComps = fc.filter(c => c.cpu_id === cpu.id);
    const ids = new Set(cComps.map(c => c.id));
    const cScores = sc.filter(s => ids.has(s.competency_id));
    const completion = cComps.length ? Math.round(([...achievedComps].filter(id => ids.has(id)).length / cComps.length) * 100) : null;
    const achievement = cScores.length ? Math.round((cScores.filter(s => s.is_passing).length / cScores.length) * 100) : null;
    const assessN = cComps.filter(c => hasAssessment(c.id)).length;
    const dom = domName.get(cComps[0]?.domain_id ?? "") ?? "—";
    const score = [completion, achievement].filter((v): v is number => v !== null).length ? Math.round([completion, achievement].filter((v): v is number => v !== null).reduce((a, b) => a + b, 0) / [completion, achievement].filter(v => v !== null).length) : null;
    return { id: cpu.id, name: cpu.name, domain: dom, completion, achievement, assessments: assessN, simulation: simCpus.has(cpu.id) ? 1 : 0, evidence: knowledgeCpus.has(cpu.id) ? 1 : 0, score };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const cpuLifecycle = new Map<string, number>();
  for (const c of cpuList) cpuLifecycle.set(c.pub_status ?? "draft", (cpuLifecycle.get(c.pub_status ?? "draft") ?? 0) + 1);
  const LIFE_COLORS: Record<string, string> = { published: "#10b981", active: "#22c55e", draft: "#94a3b8", review: "#f59e0b", archived: "#cbd5e1" };
  const cpusMod = {
    cards: {
      total: cpuList.length, active: cpuList.filter(c => ["published", "active"].includes(c.pub_status ?? "")).length,
      highPerforming: cpuTable.filter(c => (c.score ?? 0) >= 70).length, needsReview: cpuTable.filter(c => (c.score ?? 100) < 50).length,
      completion: cpuTable.some(c => c.completion !== null) ? Math.round(cpuTable.reduce((s, c) => s + (c.completion ?? 0), 0) / cpuTable.filter(c => c.completion !== null).length) : null,
      assessmentQuality: cpuList.length ? Math.round((cpuTable.reduce((s, c) => s + c.assessments, 0) / Math.max(1, fc.filter(c => c.cpu_id).length)) * 100) : null,
      evidence: cpuList.length ? Math.round((cpuTable.filter(c => c.evidence).length / cpuList.length) * 100) : null,
    },
    table: cpuTable,
    lifecycle: [...cpuLifecycle.entries()].map(([label, n]) => ({ label, n, color: LIFE_COLORS[label] ?? "#9ca3af" })),
    radar: cpuTable.slice(0, 6).map(c => ({ cpu: c.name, attainment: c.achievement ?? 0, evidence: c.evidence ? 100 : 0 })),
    insights: (() => {
      const out: string[] = [];
      const weak = cpuTable.filter(c => (c.score ?? 100) < 50);
      if (weak.length) out.push(`${weak[0].name} CPU is underperforming — review content and assessments.`);
      const noEvidence = cpuTable.filter(c => !c.evidence).length;
      if (noEvidence) out.push(`${noEvidence} CPUs have no linked knowledge objects.`);
      return out;
    })(),
  };

  // ── Module 5: Content Effectiveness ──
  const enr = (enrollments ?? []) as unknown as { course_id: string; completed_at: string | null; enrolled_at: string; progress: number | null; courses: { title: string; category: string } | null }[];
  const byCourse = new Map<string, { title: string; enrolled: number; completed: number }>();
  for (const e of enr) { const a = byCourse.get(e.course_id) ?? { title: e.courses?.title ?? "Course", enrolled: 0, completed: 0 }; a.enrolled++; if (e.completed_at) a.completed++; byCourse.set(e.course_id, a); }
  const content = {
    cards: {
      resources: (knowledge ?? []).length + (cases ?? []).length + (courses ?? []).length + (resourceLinks ? 0 : 0),
      documents: (knowledge ?? []).length, simulations: (cases ?? []).length, courses: (courses ?? []).length,
      interactive: null as null, engagement: null as null,
      completion: enr.length ? Math.round((enr.filter(e => e.completed_at).length / enr.length) * 100) : null, quality: null as null,
    },
    byType: [
      { label: "Documents", n: (knowledge ?? []).length }, { label: "Simulations", n: (cases ?? []).length },
      { label: "Courses", n: (courses ?? []).length }, { label: "Resources", n: 1 }, { label: "Videos", n: 0 }, { label: "Interactive", n: 0 },
    ],
    trend: monthLabels.map(m => ({
      label: m.label,
      enrolled: enr.filter(e => e.enrolled_at.slice(0, 7) === m.key).length,
      completed: enr.filter(e => e.completed_at && e.completed_at.slice(0, 7) === m.key).length,
    })),
    top: [...byCourse.entries()].map(([id, c]) => ({ id, title: c.title, type: "Course", enrolled: c.enrolled, completion: c.enrolled ? Math.round((c.completed / c.enrolled) * 100) : null })).sort((a, b) => b.enrolled - a.enrolled).slice(0, 6),
    insights: (() => {
      const out: string[] = [];
      out.push(`${(knowledge ?? []).length} knowledge documents and ${(cases ?? []).length} simulations available across CPUs.`);
      out.push("View/completion/time-spent telemetry needs a content-tracking store — engagement metrics not yet captured.");
      return out;
    })(),
  };

  // ── Module 6: Gap Analysis (curriculum-level) ──
  const gapItems: CurGapRow[] = [];
  for (const c of fc) {
    const cats: { cat: string; cause: string }[] = [];
    if (!hasAssessment(c.id)) cats.push({ cat: "Assessment", cause: "No assessment mapped" });
    if (!resourceComps.has(c.id) && !(c.cpu_id && knowledgeCpus.has(c.cpu_id))) cats.push({ cat: "Learning resource", cause: "No learning content linked" });
    if (!(c.cpu_id && simCpus.has(c.cpu_id))) cats.push({ cat: "Simulation", cause: "No simulation access" });
    if (!c.cpu_id) cats.push({ cat: "CPU", cause: "Not mapped to a CPU" });
    for (const { cat, cause } of cats) {
      const avg = compAvg.get(c.id) ?? null;
      const severity: CurGapRow["severity"] = c.risk_category === "high" && cat === "Assessment" ? "Critical" : cat === "Assessment" || cat === "CPU" ? "High" : cat === "Simulation" ? "Medium" : "Low";
      gapItems.push({ id: `${c.id}:${cat}`, name: c.name, category: cat, severity, learners: avg === null ? nurseIds.length : sc.filter(s => s.competency_id === c.id && s.score < 4).length, rootCause: cause, status: "Open" });
    }
  }
  const SEV_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  gapItems.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  const gapCatCount = new Map<string, number>();
  for (const g of gapItems) gapCatCount.set(g.category, (gapCatCount.get(g.category) ?? 0) + 1);
  const sevCount = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const g of gapItems) sevCount[g.severity]++;
  const CAT_COLORS: Record<string, string> = { Assessment: "#3b82f6", "Learning resource": "#f59e0b", Simulation: "#8b5cf6", CPU: "#ef4444" };
  const gaps = {
    cards: {
      total: gapItems.length, critical: sevCount.Critical,
      assessment: gapCatCount.get("Assessment") ?? 0, content: gapCatCount.get("Learning resource") ?? 0,
      cpu: gapCatCount.get("CPU") ?? 0, simulation: gapCatCount.get("Simulation") ?? 0,
      accreditation: null as null, faculty: null as null,
    },
    register: gapItems.slice(0, 12),
    categories: [...gapCatCount.entries()].map(([label, n]) => ({ label, n, color: CAT_COLORS[label] ?? "#9ca3af" })),
    severity: [
      { label: "Critical", n: sevCount.Critical, color: "#ef4444" }, { label: "High", n: sevCount.High, color: "#f59e0b" },
      { label: "Medium", n: sevCount.Medium, color: "#eab308" }, { label: "Low", n: sevCount.Low, color: "#22c55e" },
    ],
    insights: (() => {
      const out: string[] = [];
      if (sevCount.Critical) out.push(`${sevCount.Critical} critical curriculum gaps may affect accreditation.`);
      if ((gapCatCount.get("Simulation") ?? 0) > 0) out.push(`${gapCatCount.get("Simulation")} simulation gaps — highest structural risk.`);
      return out;
    })(),
  };

  return { effectiveness, blueprint, outcomes, cpus: cpusMod, content, gaps };
}
