import { createAdminClient } from "@/lib/supabase/server";

type Admin = ReturnType<typeof createAdminClient>;

// ── Learner Outcomes (5 modules) data loader ────────────────────────────────
// Learning Success, Competency Achievement, Clinical Readiness, Certification
// Readiness and CPD Progress. Measures programme results from live scores,
// decisions, enrolments and the workplace logbook. Retention/graduation,
// clinical hours/rotations, satisfaction and CPD (no logged activity) have no
// store and are returned null / shown honestly.

const PASS_OUTCOMES = new Set(["competent", "provisionally_competent"]);

export type ProgramRow = { name: string; success: number | null; learners: number };
export type ReadinessRow = { id: string; name: string; program: string; readiness: number; level: "Ready" | "Nearly Ready" | "Needs Practice" | "Not Ready" };
export type CertRow = { id: string; name: string; eligible: boolean; achieved: number; required: number; certificate: boolean };

export type LearnerOutcomes = {
  cards: { successIndex: number | null; competencyAch: number | null; clinicalReadiness: number | null; certReadiness: number | null; cpdCompliance: number | null };
  success: {
    cards: { successRate: number | null; completion: number | null; graduation: null; retention: null; satisfaction: null; avgGpa: number | null; index: number | null };
    distribution: { label: string; n: number; color: string }[];
    byProgram: ProgramRow[];
    journey: { label: string; n: number }[];
    insights: string[];
  };
  competency: {
    cards: { achieved: number; outstanding: number; inProgress: number; expiring: number; avgLevel: number | null; index: number | null };
    byDomain: { domain: string; pct: number }[];
    journey: { label: string; n: number }[];
    insights: string[];
  };
  clinical: {
    cards: { readinessScore: number | null; skillsValidated: number; independentSkills: number; wpaCompleted: number; supervisorApproval: number | null; casesCompleted: number };
    domains: { domain: string; pct: number }[];
    levels: { label: string; n: number; color: string }[];
    exposure: { label: string; n: number | null }[];
    table: ReadinessRow[];
    insights: string[];
  };
  certification: {
    cards: { eligible: number; requirementsMet: number | null; evidenceVerified: number; outstanding: number; certificatesIssued: number; readinessScore: number | null };
    checklist: { label: string; completed: number; pending: number; missing: number }[];
    funnel: { label: string; n: number }[];
    table: CertRow[];
    insights: string[];
  };
  cpd: {
    cards: { hours: number | null; credits: number | null; activePlans: number | null; compliance: number | null; note: string };
    categories: { label: string; n: number | null }[];
    recommended: { title: string; category: string; points: number | null; href: string }[];
    insights: string[];
  };
};

export async function loadLearnerOutcomes(admin: Admin, hospitalId: string): Promise<LearnerOutcomes> {
  const today = new Date().toISOString().slice(0, 10);
  const noRows = Promise.resolve({ data: [] as never[] });

  const { data: nurses } = await admin.from("profiles").select("id, full_name, specialization, department_id").eq("hospital_id", hospitalId || "").eq("role", "nurse").limit(2000);
  const nurseIds = (nurses ?? []).map(n => n.id);

  const [
    { data: departments }, { data: comps }, { data: domains }, { data: scores },
    { data: decisions }, { data: enrollments }, { data: logbook }, { data: assessments },
    { data: cases }, { data: cpdLogs }, { data: hospital }, { data: courses },
  ] = await Promise.all([
    hospitalId ? admin.from("departments").select("id, name").eq("hospital_id", hospitalId).limit(200) : noRows,
    admin.from("framework_competencies").select("id, name, domain_id, cpu_id, risk_category").limit(5000),
    admin.from("framework_domains").select("id, name").limit(2000),
    nurseIds.length ? admin.from("competency_scores").select("nurse_id, competency_id, domain_id, cycle_id, score, is_passing").in("nurse_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("competency_decisions").select("nurse_id, competency_id, outcome, expiry_date, validated_at").in("nurse_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("course_enrollments").select("user_id, completed_at, certificate_url, progress").in("user_id", nurseIds).limit(8000) : noRows,
    nurseIds.length ? admin.from("skill_log_entries").select("nurse_id, supervision_level, status").in("nurse_id", nurseIds).limit(8000) : noRows,
    admin.from("assessments").select("competency_id, method, cycle_id").limit(10000),
    admin.from("clinical_cases").select("id").neq("status", "retired").limit(8000),
    nurseIds.length ? admin.from("cpd_logs").select("user_id, hours").in("user_id", nurseIds).limit(8000) : noRows,
    hospitalId ? admin.from("hospitals").select("cpd_target_hours").eq("id", hospitalId).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("courses").select("id, title, category, cpd_points, is_published").eq("is_published", true).limit(200),
  ]);

  const deptName = new Map((departments ?? []).map(d => [d.id, d.name as string]));
  const domName = new Map((domains ?? []).map(d => [d.id, d.name as string]));
  type Comp = { id: string; name: string; domain_id: string | null; cpu_id: string | null; risk_category: string | null };
  const fc = (comps ?? []) as Comp[];
  const sc = (scores ?? []) as { nurse_id: string; competency_id: string; domain_id: string | null; cycle_id: string | null; score: number; is_passing: boolean }[];
  const dec = (decisions ?? []) as { nurse_id: string; competency_id: string; outcome: string; expiry_date: string | null; validated_at: string | null }[];
  const enr = (enrollments ?? []) as { user_id: string; completed_at: string | null; certificate_url: string | null; progress: number | null }[];
  const log = (logbook ?? []) as { nurse_id: string; supervision_level: string; status: string }[];
  const hospitalCycles = new Set(sc.map(s => s.cycle_id).filter(Boolean));
  const ass = ((assessments ?? []) as { competency_id: string; method: string; cycle_id: string | null }[]).filter(a => a.cycle_id && hospitalCycles.has(a.cycle_id));

  const achievedComps = new Set([...dec.filter(d => PASS_OUTCOMES.has(d.outcome)).map(d => d.competency_id), ...sc.filter(s => s.is_passing).map(s => s.competency_id)]);
  const recordedComps = new Set([...sc.map(s => s.competency_id), ...dec.map(d => d.competency_id)]);
  const expiredComps = new Set(dec.filter(d => d.expiry_date && d.expiry_date < today).map(d => d.competency_id));

  const progById = new Map((nurses ?? []).map(n => [n.id, deptName.get(n.department_id ?? "") ?? (n.specialization as string | null) ?? "General"]));

  // Per-learner achievement % (of competencies they have records for)
  const perLearner = new Map<string, { total: number; achieved: number; scoreSum: number; scoreN: number }>();
  for (const s of sc) { const a = perLearner.get(s.nurse_id) ?? { total: 0, achieved: 0, scoreSum: 0, scoreN: 0 }; a.scoreSum += s.score; a.scoreN++; perLearner.set(s.nurse_id, a); }
  for (const n of nurses ?? []) {
    const mineScores = sc.filter(s => s.nurse_id === n.id);
    const mineDec = dec.filter(d => d.nurse_id === n.id);
    const assigned = new Set([...mineScores.map(s => s.competency_id), ...mineDec.map(d => d.competency_id)]);
    const achieved = new Set([...mineScores.filter(s => s.is_passing).map(s => s.competency_id), ...mineDec.filter(d => PASS_OUTCOMES.has(d.outcome)).map(d => d.competency_id)]);
    const a = perLearner.get(n.id) ?? { total: 0, achieved: 0, scoreSum: 0, scoreN: 0 };
    a.total = assigned.size; a.achieved = achieved.size; perLearner.set(n.id, a);
  }
  const learnerPct = (id: string) => { const a = perLearner.get(id); return a && a.total ? Math.round((a.achieved / a.total) * 100) : (a && a.scoreN ? Math.round((a.scoreSum / a.scoreN / 6) * 100) : null); };

  // ── Module 1: Learning Success ──
  const completions = enr.filter(e => e.completed_at).length;
  const avgScore = sc.length ? sc.reduce((s, x) => s + x.score, 0) / sc.length : null;
  const passRate = sc.length ? Math.round((sc.filter(s => s.is_passing).length / sc.length) * 100) : null;
  const distBuckets = [0, 0, 0, 0, 0]; // Outstanding, Successful, Satisfactory, Needs Support, At Risk
  for (const n of nurses ?? []) { const p = learnerPct(n.id); if (p === null) continue; distBuckets[p >= 90 ? 0 : p >= 75 ? 1 : p >= 60 ? 2 : p >= 40 ? 3 : 4]++; }
  const progGroups = new Map<string, { pass: number; total: number; learners: Set<string> }>();
  for (const s of sc) { const p = progById.get(s.nurse_id) ?? "General"; const g = progGroups.get(p) ?? { pass: 0, total: 0, learners: new Set() }; g.total++; if (s.is_passing) g.pass++; g.learners.add(s.nurse_id); progGroups.set(p, g); }
  const completionRate = enr.length ? Math.round((completions / enr.length) * 100) : null;
  const avgGpa = avgScore !== null ? Math.round((avgScore / 6) * 100) : null;
  const successIndex = [completionRate, passRate, avgGpa].filter((v): v is number => v !== null).length ? Math.round([completionRate, passRate, avgGpa].filter((v): v is number => v !== null).reduce((a, b) => a + b, 0) / [completionRate, passRate, avgGpa].filter(v => v !== null).length) : null;
  const success = {
    cards: { successRate: passRate, completion: completionRate, graduation: null as null, retention: null as null, satisfaction: null as null, avgGpa, index: successIndex },
    distribution: [
      { label: "Outstanding (90%+)", n: distBuckets[0], color: "#10b981" }, { label: "Successful (75–89%)", n: distBuckets[1], color: "#3b82f6" },
      { label: "Satisfactory (60–74%)", n: distBuckets[2], color: "#f59e0b" }, { label: "Needs Support (40–59%)", n: distBuckets[3], color: "#f97316" }, { label: "At Risk (<40%)", n: distBuckets[4], color: "#ef4444" },
    ],
    byProgram: [...progGroups.entries()].map(([name, g]) => ({ name, success: g.total ? Math.round((g.pass / g.total) * 100) : null, learners: g.learners.size })).sort((a, b) => (b.success ?? 0) - (a.success ?? 0)).slice(0, 7),
    journey: [
      { label: "Enrolled", n: nurseIds.length }, { label: "Learning", n: new Set(enr.map(e => e.user_id)).size },
      { label: "Assessment", n: new Set(sc.map(s => s.nurse_id)).size }, { label: "Competency", n: new Set([...achievedComps].flatMap(cid => sc.filter(s => s.competency_id === cid && s.is_passing).map(s => s.nurse_id))).size },
      { label: "Graduation", n: (nurses ?? []).filter(n => (learnerPct(n.id) ?? 0) >= 90).length },
    ],
    insights: (() => {
      const out: string[] = [];
      const top = [...progGroups.entries()].map(([n, g]) => ({ n, pct: g.total ? (g.pass / g.total) * 100 : 0 })).sort((a, b) => b.pct - a.pct)[0];
      if (top) out.push(`${top.n} shows the highest learner success (${Math.round(top.pct)}%).`);
      if (distBuckets[4]) out.push(`${distBuckets[4]} learner${distBuckets[4] === 1 ? " is" : "s are"} at risk of not completing — intervention suggested.`);
      return out;
    })(),
  };

  // ── Module 2: Competency Achievement ──
  const achievedN = achievedComps.size;
  const notStarted = fc.filter(c => !recordedComps.has(c.id)).length;
  const inProgress = fc.length - achievedN - notStarted;
  const domainAch = [...new Set(fc.map(c => c.domain_id).filter(Boolean))].map(did => {
    const dComps = fc.filter(c => c.domain_id === did); const ids = new Set(dComps.map(c => c.id));
    return { domain: domName.get(did as string) ?? "—", pct: dComps.length ? Math.round(([...achievedComps].filter(id => ids.has(id)).length / dComps.length) * 100) : 0 };
  }).sort((a, b) => b.pct - a.pct).slice(0, 8);
  const competency = {
    cards: {
      achieved: achievedN, outstanding: fc.length - achievedN, inProgress, expiring: expiredComps.size,
      avgLevel: avgScore !== null ? Math.round((avgScore) * 10) / 10 : null,
      index: fc.length ? Math.round((achievedN / fc.length) * 100) : null,
    },
    byDomain: domainAch,
    journey: [
      { label: "Assigned", n: recordedComps.size }, { label: "Assessment", n: new Set(sc.map(s => s.competency_id)).size },
      { label: "Evidence", n: new Set(dec.map(d => d.competency_id)).size }, { label: "Validated", n: new Set(dec.filter(d => d.validated_at).map(d => d.competency_id)).size },
      { label: "Passport", n: achievedN },
    ],
    insights: (() => { const out: string[] = []; if (expiredComps.size) out.push(`${expiredComps.size} competencies are expiring / need reassessment.`); if (notStarted) out.push(`${notStarted} required competencies are not started.`); return out; })(),
  };

  // ── Module 3: Clinical Readiness ──
  const independent = log.filter(l => l.supervision_level === "independent").length;
  const validated = log.filter(l => l.status === "verified").length;
  const wpa = ass.filter(a => a.method === "direct_observation").length;
  const supervisorApproval = dec.length ? Math.round((dec.filter(d => d.validated_at).length / dec.length) * 100) : null;
  const readinessScore = fc.length ? Math.round((achievedN / fc.length) * 100) : null;
  const readinessTable: ReadinessRow[] = (nurses ?? []).map(n => {
    const p = learnerPct(n.id) ?? 0;
    const level: ReadinessRow["level"] = p >= 80 ? "Ready" : p >= 60 ? "Nearly Ready" : p >= 40 ? "Needs Practice" : "Not Ready";
    return { id: n.id, name: n.full_name as string, program: progById.get(n.id) ?? "General", readiness: p, level };
  }).sort((a, b) => b.readiness - a.readiness);
  const levelCounts = { "Ready": 0, "Nearly Ready": 0, "Needs Practice": 0, "Not Ready": 0 };
  for (const r of readinessTable) levelCounts[r.level]++;
  const clinical = {
    cards: { readinessScore, skillsValidated: validated, independentSkills: independent, wpaCompleted: wpa, supervisorApproval, casesCompleted: (cases ?? []).length },
    domains: [...new Set(sc.map(s => s.domain_id).filter(Boolean))].map(did => {
      const rows = sc.filter(s => s.domain_id === did);
      return { domain: domName.get(did as string) ?? "—", pct: rows.length ? Math.round((rows.reduce((s, x) => s + x.score, 0) / rows.length / 6) * 100) : 0 };
    }).sort((a, b) => b.pct - a.pct).slice(0, 8),
    levels: [
      { label: "Ready for Independent Practice", n: levelCounts["Ready"], color: "#10b981" }, { label: "Nearly Ready", n: levelCounts["Nearly Ready"], color: "#3b82f6" },
      { label: "Needs More Practice", n: levelCounts["Needs Practice"], color: "#f59e0b" }, { label: "Not Ready", n: levelCounts["Not Ready"], color: "#ef4444" },
    ],
    exposure: [
      { label: "Case logs", n: log.length }, { label: "Simulations", n: (cases ?? []).length },
      { label: "Procedures", n: null }, { label: "Rotations", n: null }, { label: "Clinical hours", n: null },
    ],
    table: readinessTable,
    insights: (() => { const out: string[] = []; if (levelCounts["Ready"]) out.push(`${levelCounts["Ready"]} learner${levelCounts["Ready"] === 1 ? " is" : "s are"} ready for independent practice.`); if (levelCounts["Not Ready"]) out.push(`${levelCounts["Not Ready"]} learner${levelCounts["Not Ready"] === 1 ? " needs" : "s need"} more clinical exposure.`); return out; })(),
  };

  // ── Module 4: Certification Readiness ──
  const validatedComps = new Set(dec.filter(d => d.validated_at).map(d => d.competency_id));
  const certTable: CertRow[] = (nurses ?? []).map(n => {
    const mineScores = sc.filter(s => s.nurse_id === n.id);
    const mineDec = dec.filter(d => d.nurse_id === n.id);
    const achieved = new Set([...mineScores.filter(s => s.is_passing).map(s => s.competency_id), ...mineDec.filter(d => PASS_OUTCOMES.has(d.outcome)).map(d => d.competency_id)]).size;
    const required = new Set([...mineScores.map(s => s.competency_id), ...mineDec.map(d => d.competency_id)]).size;
    const cert = enr.some(e => e.user_id === n.id && e.certificate_url);
    return { id: n.id, name: n.full_name as string, eligible: required > 0 && achieved === required, achieved, required, certificate: cert };
  });
  const eligible = certTable.filter(c => c.eligible).length;
  const certsIssued = enr.filter(e => e.certificate_url).length;
  const certification = {
    cards: {
      eligible, requirementsMet: fc.length ? Math.round((achievedN / fc.length) * 100) : null,
      evidenceVerified: validatedComps.size, outstanding: fc.length - achievedN, certificatesIssued: certsIssued,
      readinessScore: fc.length ? Math.round((achievedN / fc.length) * 100) : null,
    },
    checklist: [
      { label: "Programme completion", completed: completions, pending: enr.length - completions, missing: 0 },
      { label: "Competencies", completed: achievedN, pending: inProgress, missing: notStarted },
      { label: "Assessments", completed: new Set(sc.map(s => s.competency_id)).size, pending: 0, missing: fc.length - new Set(sc.map(s => s.competency_id)).size },
      { label: "Evidence validated", completed: validatedComps.size, pending: new Set(dec.map(d => d.competency_id)).size - validatedComps.size, missing: 0 },
    ],
    funnel: [
      { label: "Enrolled", n: nurseIds.length }, { label: "Eligible", n: eligible },
      { label: "Evidence Complete", n: new Set(dec.map(d => d.nurse_id)).size }, { label: "Validated", n: new Set(dec.filter(d => d.validated_at).map(d => d.nurse_id)).size },
      { label: "Certified", n: new Set(enr.filter(e => e.certificate_url).map(e => e.user_id)).size },
    ],
    table: certTable,
    insights: (() => { const out: string[] = []; if (notStarted) out.push(`${notStarted} mandatory competencies are outstanding across learners.`); if (eligible) out.push(`${eligible} learner${eligible === 1 ? " is" : "s are"} eligible for certification.`); out.push("OSCE, portfolio and CPD certification requirements need their stores — tracked as soon."); return out; })(),
  };

  // ── Module 5: CPD Progress ──
  const target = (hospital as { cpd_target_hours: number | null } | null)?.cpd_target_hours ?? null;
  const cpd = (cpdLogs ?? []) as { user_id: string; hours: number | null }[];
  const cpdHours = cpd.reduce((s, l) => s + (l.hours ?? 0), 0);
  let cpdCompliance: number | null = null; let cpdNote = "";
  if (!target) cpdNote = "No annual CPD target set for this hospital.";
  else if (!cpd.length) cpdNote = "No CPD activity logged yet.";
  else if (nurseIds.length) { const meeting = nurseIds.filter(id => cpd.filter(l => l.user_id === id).reduce((s, l) => s + (l.hours ?? 0), 0) >= target).length; cpdCompliance = Math.round((meeting / nurseIds.length) * 100); cpdNote = `≥ ${target}h/yr target`; }
  const cpdMod = {
    cards: { hours: cpd.length ? Math.round(cpdHours) : null, credits: null as number | null, activePlans: null as number | null, compliance: cpdCompliance, note: cpdNote },
    categories: ["Clinical", "Leadership", "Education", "Quality", "Research", "Patient Safety"].map(label => ({ label, n: null as number | null })),
    recommended: (courses ?? []).slice(0, 4).map(c => ({ title: c.title as string, category: (c.category as string) ?? "General", points: (c.cpd_points as number | null) ?? null, href: "/educator/courses" })),
    insights: [
      cpd.length ? `${Math.round(cpdHours)} CPD hours logged across learners.` : "No CPD activity has been logged yet.",
      "CPD categories, credits, plans and career-progression tracking need a CPD activity store with category tagging — on the roadmap.",
    ],
  };

  return {
    cards: {
      successIndex, competencyAch: competency.cards.index, clinicalReadiness: readinessScore,
      certReadiness: certification.cards.readinessScore, cpdCompliance,
    },
    success, competency, clinical, certification, cpd: cpdMod,
  };
}
