// Assessment & Validation Centre (CKP-001.4) loader — assessment governance
// dashboard. Aggregates assessment assets (methods, rubrics/checklists,
// blueprints, question banks, OSCE, scoring, reassessment), an assessment-by-
// type overview, blueprint method mix, blueprint coverage over CPUs, and
// validation outcomes from competency_decisions. Live counts; fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (r: any) => (r?.error ? null : r?.count ?? 0);
const bucket = (rows: any[], key: string) => { const m: Record<string, number> = {}; for (const r of rows) { const k = r[key] ?? "unknown"; m[k] = (m[k] ?? 0) + 1; } return m; };

export async function loadAssessmentCentre(admin: any) {
  const head = (t: string) => admin.from(t).select("*", { count: "exact", head: true });

  const [asmtCount, methodCount, methodActive, chkCount, itemCount, bpCount, scaleCount, levelCount, qbCount, osceCount, reassessCount, reassessActive, caseCount, cpuCount, bpMethodRows, bpCpuRows, decisionRows, cpuRows, skillRows, fwRows] = await Promise.all([
    head("assessments"), head("assessment_method_configs"),
    admin.from("assessment_method_configs").select("*", { count: "exact", head: true }).eq("is_active", true),
    head("skill_checklists"), head("checklist_items"), head("assessment_blueprints"),
    head("scoring_scales"), head("scoring_levels"), head("question_banks"), head("osce_exams"),
    head("reassessment_schedules"), admin.from("reassessment_schedules").select("*", { count: "exact", head: true }).eq("is_active", true),
    head("clinical_cases"), head("clinical_practice_units"),
    admin.from("blueprint_methods").select("method").limit(20000),
    admin.from("assessment_blueprints").select("cpu_id").limit(20000),
    admin.from("competency_decisions").select("validation_outcome").limit(20000),
    // Picker lists for the in-place Assessment Builder.
    admin.from("clinical_practice_units").select("id, name").order("name").limit(1000),
    admin.from("competency_skills").select("id, name, framework_competencies!competency_id(name)").eq("is_active", true).order("name").limit(2000),
    admin.from("frameworks").select("id, name").order("name").limit(1000),
  ]);

  const bpMethods = bucket(bpMethodRows.error ? [] : bpMethodRows.data ?? [], "method");
  const blueprintCpus = new Set((bpCpuRows.error ? [] : bpCpuRows.data ?? []).map((r: any) => r.cpu_id).filter(Boolean));
  const cpuTotal = num(cpuCount) ?? 0;
  const blueprintCoverage = cpuTotal ? Math.round((blueprintCpus.size / cpuTotal) * 100) : null;

  const validation = bucket(decisionRows.error ? [] : decisionRows.data ?? [], "validation_outcome");
  const validationReady = !decisionRows.error && (decisionRows.data ?? []).length > 0;

  // Assessment-by-type overview (real asset counts).
  const overview = [
    { label: "Question Banks", n: num(qbCount) ?? 0, color: "#3b82f6" },
    { label: "OSCE Exams", n: num(osceCount) ?? 0, color: "#8b5cf6" },
    { label: "Checklists", n: num(chkCount) ?? 0, color: "#14b8a6" },
    { label: "Blueprints", n: num(bpCount) ?? 0, color: "#f59e0b" },
    { label: "Simulation Cases", n: num(caseCount) ?? 0, color: "#ef4444" },
    { label: "Methods", n: num(methodCount) ?? 0, color: "#6b7280" },
  ].filter(a => a.n > 0);
  const overviewTotal = overview.reduce((s, a) => s + a.n, 0);

  return {
    kpis: {
      assessments: num(asmtCount) ?? 0,
      methods: num(methodCount) ?? 0, methodsActive: num(methodActive) ?? 0,
      rubrics: num(chkCount) ?? 0, blueprints: num(bpCount) ?? 0,
      scoringScales: num(scaleCount) ?? 0, questionBanks: num(qbCount) ?? 0,
      osce: num(osceCount) ?? 0, reassessment: num(reassessCount) ?? 0, reassessmentActive: num(reassessActive) ?? 0,
    },
    overview, overviewTotal,
    methodMix: Object.entries(bpMethods).map(([method, n]) => ({ method: method.replace(/_/g, " "), n })).sort((a, b) => (b.n as number) - (a.n as number)).slice(0, 8),
    coverage: { blueprintCoverage, blueprintsDefined: blueprintCpus.size, cpuTotal, checklistItems: num(itemCount) ?? 0, scoringLevels: num(levelCount) ?? 0 },
    validation, validationReady,
    // Picker lists for the Assessment Builder (label skills with their competency).
    pickers: {
      cpus: (cpuRows.error ? [] : cpuRows.data ?? []).map((c: any) => ({ id: c.id, label: c.name })),
      skills: (skillRows.error ? [] : skillRows.data ?? []).map((s: any) => ({ id: s.id, label: s.framework_competencies?.name ? `${s.name} (${s.framework_competencies.name})` : s.name })),
      frameworks: (fwRows.error ? [] : fwRows.data ?? []).map((f: any) => ({ id: f.id, label: f.name })),
    },
    generatedAt: new Date().toISOString(),
  };
}
