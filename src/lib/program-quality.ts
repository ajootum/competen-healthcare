import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// ── Program Quality (8 modules) data loader ─────────────────────────────────
// Executive composite over the whole Analytics & Quality stack: programme,
// faculty, curriculum, assessment and compliance KPIs plus benchmarking, annual
// reviews and quality reports. Reuses live scores, decisions, enrolments,
// assessments, questions, audits and CAPA actions. Cross-org benchmarking,
// formal annual-review cycles and the report builder have no store and are
// shown honestly.

const PASS_OUTCOMES = new Set(["competent", "provisionally_competent"]);
const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;

export type FacultyRow = { id: string; name: string; assessments: number; simulations: number };
export type Bar = { label: string; pct: number | null; backed: boolean };

export type ProgramQuality = {
  exec: { qualityIndex: number | null; accreditation: number | null; competencyAch: number | null; learnerSuccess: number | null; facultyEffect: number | null; compliance: number | null; improvement: number | null; benchmark: string };
  program: {
    cards: { qualityIndex: number | null; activeLearners: number; graduation: null; attainment: number | null; passRate: number | null; facultyEffect: number | null; accreditation: number | null; cqi: number | null };
    byDomain: Bar[];
    trend: { label: string; value: number | null }[];
    insights: string[];
  };
  faculty: {
    cards: { qualityScore: null; satisfaction: null; turnaround: null; teaching: number; count: number };
    ranking: FacultyRow[];
    insights: string[];
  };
  curriculum: {
    cards: { coverage: number | null; blueprintIntegrity: number | null; loAchievement: number | null; cpuCompletion: number | null; quality: number | null };
    insights: string[];
  };
  assessment: {
    cards: { quality: number | null; reliability: null; blueprintAlignment: number | null; passRate: number | null; reassessment: null };
    topTypes: { label: string; pct: number | null }[];
    insights: string[];
  };
  compliance: {
    cards: { policy: null; accreditation: number | null; assessment: null; documentation: null; clinical: number | null };
    matrix: Bar[];
    capa: { open: number; closed: number; total: number };
    alerts: { label: string; level: "High" | "Medium" | "Low" }[];
    insights: string[];
  };
  benchmarking: { available: boolean; note: string };
  annualReviews: { cards: { completed: number; pending: number; actionsClosed: number; actionsOpen: number }; capaItems: { title: string; status: string; due: string | null }[]; note: string };
  reports: { cards: { generated: number; scheduled: number; shared: number; pending: number }; templates: string[]; exports: { label: string; href: string }[]; note: string };
};

export async function loadProgramQuality(admin: Admin, hospitalId: string): Promise<ProgramQuality> {
  const now = new Date().getTime();
  const noRows = Promise.resolve({ data: [] as never[] });

  const { data: nurses } = await admin.from("profiles").select("id").eq("hospital_id", hospitalId || "").eq("role", "nurse").limit(2000);
  const nurseIds = (nurses ?? []).map(n => n.id);

  const [
    { data: comps }, { data: scores }, { data: decisions },
    { data: enrollments }, { data: assessments }, { data: questions }, { data: quiz },
    { data: audits }, { data: capa }, { data: faculty }, { data: knowledge }, { data: cases }, { data: resourceLinks },
  ] = await Promise.all([
    admin.from("framework_competencies").select("id, cpu_id, risk_category").limit(5000),
    nurseIds.length ? admin.from("competency_scores").select("nurse_id, competency_id, score, is_passing, assessed_at, cycle_id").in("nurse_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("competency_decisions").select("competency_id, outcome, validated_at").in("nurse_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("course_enrollments").select("user_id, completed_at").in("user_id", nurseIds).limit(8000) : noRows,
    admin.from("assessments").select("competency_id, method, score, cycle_id, assessor_id").limit(10000),
    admin.from("questions").select("id, difficulty, is_published").limit(8000),
    nurseIds.length ? admin.from("quiz_attempts").select("is_correct").in("user_id", nurseIds).limit(8000) : noRows,
    hospitalId ? admin.from("audits").select("audit_type, compliance_pct, items_met, items_not_met").eq("hospital_id", hospitalId).limit(2000) : noRows,
    hospitalId ? admin.from("capa_actions").select("title, status, due_date").eq("hospital_id", hospitalId).limit(500) : noRows,
    hospitalId ? admin.from("profiles").select("id, full_name").eq("hospital_id", hospitalId).or("role.in.(educator,assessor),roles.cs.{educator},roles.cs.{assessor}").limit(500) : noRows,
    admin.from("knowledge_objects").select("cpu_id").neq("status", "retired").limit(8000),
    admin.from("clinical_cases").select("cpu_id").neq("status", "retired").limit(8000),
    admin.from("resource_competencies").select("competency_id").limit(8000),
  ]);

  type Comp = { id: string; cpu_id: string | null; risk_category: string | null };
  const fc = (comps ?? []) as Comp[];
  const sc = (scores ?? []) as { nurse_id: string; competency_id: string; score: number; is_passing: boolean; assessed_at: string; cycle_id: string | null }[];
  const dec = (decisions ?? []) as { competency_id: string; outcome: string; validated_at: string | null }[];
  const enr = (enrollments ?? []) as { user_id: string; completed_at: string | null }[];
  const hospitalCycles = new Set(sc.map(s => s.cycle_id).filter(Boolean));
  const ass = ((assessments ?? []) as { competency_id: string; method: string; score: number | null; cycle_id: string | null; assessor_id: string | null }[]).filter(a => a.cycle_id && hospitalCycles.has(a.cycle_id));
  const q = (questions ?? []) as { id: string; difficulty: string | null; is_published: boolean }[];
  const qz = (quiz ?? []) as { is_correct: boolean }[];
  const au = (audits ?? []) as { audit_type: string; compliance_pct: number | null; items_met: number | null; items_not_met: number | null }[];
  const capaRows = (capa ?? []) as { title: string; status: string; due_date: string | null }[];

  const knowledgeCpus = new Set((knowledge ?? []).map((k: { cpu_id: string | null }) => k.cpu_id).filter(Boolean));
  const simCpus = new Set((cases ?? []).map((c: { cpu_id: string | null }) => c.cpu_id).filter(Boolean));
  const resourceComps = new Set((resourceLinks ?? []).map((r: { competency_id: string }) => r.competency_id));
  const assessedComps = new Set([...sc.map(s => s.competency_id), ...ass.map(a => a.competency_id)]);
  const achievedComps = new Set([...dec.filter(d => PASS_OUTCOMES.has(d.outcome)).map(d => d.competency_id), ...sc.filter(s => s.is_passing).map(s => s.competency_id)]);

  // shared metrics
  const passRate = sc.length ? Math.round((sc.filter(s => s.is_passing).length / sc.length) * 100) : null;
  const attainment = fc.length ? Math.round((achievedComps.size / fc.length) * 100) : null;
  const coverage = fc.length ? Math.round((assessedComps.size / fc.length) * 100) : null;
  const avgScorePct = sc.length ? Math.round((sc.reduce((s, x) => s + x.score, 0) / sc.length / 6) * 100) : null;
  const completion = enr.length ? Math.round((enr.filter(e => e.completed_at).length / enr.length) * 100) : null;
  const learnerSuccess = avg([passRate, completion].filter((v): v is number => v !== null));
  const auditCompliance = au.length ? avg(au.map(a => a.compliance_pct ?? 0)) : null;
  const clinicalCompliance = au.filter(a => a.audit_type === "clinical").length ? avg(au.filter(a => a.audit_type === "clinical").map(a => a.compliance_pct ?? 0)) : null;
  const capaClosed = capaRows.filter(c => c.status === "completed" || c.status === "closed").length;
  const cqi = capaRows.length ? Math.round((capaClosed / capaRows.length) * 100) : null;

  // faculty activity (assessments conducted per assessor)
  const facultyList = (faculty ?? []) as { id: string; full_name: string }[];
  const byAssessor = new Map<string, { total: number; sim: number }>();
  for (const a of ass) { if (!a.assessor_id) continue; const x = byAssessor.get(a.assessor_id) ?? { total: 0, sim: 0 }; x.total++; if (a.method === "simulation") x.sim++; byAssessor.set(a.assessor_id, x); }
  const facultyRanking: FacultyRow[] = facultyList.map(f => { const x = byAssessor.get(f.id) ?? { total: 0, sim: 0 }; return { id: f.id, name: f.full_name, assessments: x.total, simulations: x.sim }; }).sort((a, b) => b.assessments - a.assessments);

  const months = Array.from({ length: 6 }, (_, i) => { const dt = new Date(now); dt.setMonth(dt.getMonth() - (5 - i)); return { key: dt.toISOString().slice(0, 7), label: dt.toLocaleDateString(undefined, { month: "short" }) }; });
  const trend = months.map(m => { const ms = sc.filter(s => s.assessed_at.slice(0, 7) === m.key); return { label: m.label, value: ms.length ? Math.round((ms.reduce((s, x) => s + x.score, 0) / ms.length / 6) * 100) : null }; });

  const qualityIndex = avg([attainment, coverage, passRate, auditCompliance].filter((v): v is number => v !== null));

  // curriculum blueprint integrity
  const fullyMapped = fc.filter(c => assessedComps.has(c.id) && !!c.cpu_id).length;
  const blueprintIntegrity = fc.length ? Math.round((fullyMapped / fc.length) * 100) : null;
  const cpuMapped = fc.length ? Math.round((fc.filter(c => c.cpu_id).length / fc.length) * 100) : null;
  const curriculumQuality = avg([coverage, blueprintIntegrity, attainment].filter((v): v is number => v !== null));

  // assessment quality
  const qPublished = q.length ? Math.round((q.filter(x => x.is_published).length / q.length) * 100) : null;
  const quizPass = qz.length ? Math.round((qz.filter(x => x.is_correct).length / qz.length) * 100) : null;

  return {
    exec: {
      qualityIndex, accreditation: auditCompliance, competencyAch: attainment, learnerSuccess,
      facultyEffect: null, compliance: auditCompliance, improvement: cqi, benchmark: "no external data",
    },
    program: {
      cards: { qualityIndex, activeLearners: nurseIds.length, graduation: null, attainment, passRate, facultyEffect: null, accreditation: auditCompliance, cqi },
      byDomain: [
        { label: "Academic Quality", pct: attainment, backed: attainment !== null },
        { label: "Clinical Quality", pct: avgScorePct, backed: avgScorePct !== null },
        { label: "Assessment Quality", pct: passRate, backed: passRate !== null },
        { label: "Compliance", pct: auditCompliance, backed: auditCompliance !== null },
        { label: "Readiness", pct: attainment, backed: attainment !== null },
        { label: "Faculty Quality", pct: null, backed: false },
        { label: "Learner Satisfaction", pct: null, backed: false },
        { label: "Employer Satisfaction", pct: null, backed: false },
      ],
      trend,
      insights: (() => { const out: string[] = []; if (qualityIndex !== null) out.push(`Programme Quality Index is ${qualityIndex}% (composite of attainment, coverage, pass rate and compliance).`); if (attainment !== null && attainment < 60) out.push(`Competency attainment (${attainment}%) is below institutional benchmark.`); return out; })(),
    },
    faculty: {
      cards: { qualityScore: null, satisfaction: null, turnaround: null, teaching: facultyList.length, count: facultyList.length },
      ranking: facultyRanking,
      insights: ["Faculty quality score, learner satisfaction and turnaround need survey and timestamp stores — activity is tracked in Learning Analytics › Faculty."],
    },
    curriculum: {
      cards: { coverage, blueprintIntegrity, loAchievement: attainment, cpuCompletion: cpuMapped, quality: curriculumQuality },
      insights: (() => { const out: string[] = []; const noSim = fc.filter(c => !(c.cpu_id && simCpus.has(c.cpu_id))).length; if (noSim) out.push(`${noSim} competencies lack simulation coverage.`); const noKnow = fc.filter(c => !(c.cpu_id && knowledgeCpus.has(c.cpu_id)) && !resourceComps.has(c.id)).length; if (noKnow) out.push(`${noKnow} competencies lack linked learning content.`); return out; })(),
    },
    assessment: {
      cards: { quality: avg([qPublished, passRate].filter((v): v is number => v !== null)), reliability: null, blueprintAlignment: coverage, passRate, reassessment: null },
      topTypes: [
        { label: "Direct Observation", pct: ass.filter(a => a.method === "direct_observation").length ? avg(ass.filter(a => a.method === "direct_observation" && a.score !== null).map(a => Math.round(((a.score ?? 0) / 6) * 100))) : null },
        { label: "Simulation", pct: ass.filter(a => a.method === "simulation").length ? avg(ass.filter(a => a.method === "simulation" && a.score !== null).map(a => Math.round(((a.score ?? 0) / 6) * 100))) : null },
        { label: "Knowledge Test", pct: quizPass },
      ],
      insights: (() => { const out: string[] = []; if (fc.length - assessedComps.size > 0) out.push(`${fc.length - assessedComps.size} competencies have blueprint gaps (no assessment).`); out.push("Reliability & validity coefficients need item response matrices — see Assessment Analytics."); return out; })(),
    },
    compliance: {
      cards: { policy: null, accreditation: auditCompliance, assessment: null, documentation: null, clinical: clinicalCompliance },
      matrix: [
        { label: "Accreditation", pct: auditCompliance, backed: auditCompliance !== null },
        { label: "Clinical Standards", pct: clinicalCompliance, backed: clinicalCompliance !== null },
        { label: "Policy Adherence", pct: null, backed: false },
        { label: "Documentation", pct: null, backed: false },
        { label: "Assessment Compliance", pct: null, backed: false },
      ],
      capa: { open: capaRows.length - capaClosed, closed: capaClosed, total: capaRows.length },
      alerts: capaRows.filter(c => c.status !== "completed" && c.status !== "closed").slice(0, 5).map(c => ({ label: c.title, level: "Medium" as const })),
      insights: (() => { const out: string[] = []; if (auditCompliance !== null) out.push(`Average audit compliance is ${auditCompliance}%.`); if (capaRows.length - capaClosed > 0) out.push(`${capaRows.length - capaClosed} corrective actions are still open.`); if (!au.length) out.push("Only clinical audits are recorded; policy and documentation compliance need their stores."); return out; })(),
    },
    benchmarking: { available: false, note: "External benchmarking needs cross-organisation data (national/peer datasets) that isn't available in this tenant. Internal single-hospital data can't produce percentile rankings yet." },
    annualReviews: {
      cards: { completed: 0, pending: 0, actionsClosed: capaClosed, actionsOpen: capaRows.length - capaClosed },
      capaItems: capaRows.slice(0, 6).map(c => ({ title: c.title, status: c.status, due: c.due_date })),
      note: "Formal annual programme-review cycles need a review store. Corrective actions (CAPA) are shown as the live improvement-action proxy.",
    },
    reports: {
      cards: { generated: 0, scheduled: 0, shared: 0, pending: 0 },
      templates: ["Executive Quality", "Programme Quality", "Accreditation", "Curriculum", "Assessment", "Faculty Performance", "Learner Outcomes", "Improvement Plan"],
      exports: [
        { label: "Validations CSV", href: "/api/reports/validations" }, { label: "Passport Centre CSV", href: "/api/reports/passports" },
        { label: "Analytics CSV", href: "/api/reports/analytics" }, { label: "Quality CSV", href: "/api/reports/quality" },
      ],
      note: "Saved report definitions and schedules are empty; the executive report builder is on the roadmap. Live CSV exports below are available now.",
    },
  };
}
