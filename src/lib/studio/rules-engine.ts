/* eslint-disable @typescript-eslint/no-explicit-any */
// CST-007 — Competency Rules Engine (consolidation view). The competency business rules already exist,
// but scattered across stores: assignment rules (cmo_assignment_rules, COMP-018), progression edges
// (competency_dependencies, CST-105), scoring/consensus (assessment_blueprints, scoring_levels),
// evidence validation (evidence_matrix), critical-failure/risk (critical_failure_rules) and
// recertification cadence (reassessment_schedules). This surfaces them as one governed Rules Library,
// categorised, with real counts and representative rules — authoring stays in each source surface (a
// unified visual rule builder is the next-phase authoring layer). Everything here is real, read on demand.

const NONE = "00000000-0000-0000-0000-000000000000";

export type RuleCategory = { key: string; label: string; icon: string; n: number; href: string; desc: string; samples: string[] };
export type Schedule = { name: string; cycle: string | null; months: number | null; triggers: string[]; grace: number | null };

export async function loadRulesEngine(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.or(`hospital_id.eq.${hid ?? NONE},hospital_id.is.null`));
  const count = (q: any) => Promise.resolve(q).then((r: any) => (r?.count ?? 0)).then((n: any) => (typeof n === "number" ? n : 0));
  const rows = (q: any) => Promise.resolve(q).then((r: any) => ((r?.data ?? []) as any[]));

  const [assignN, depN, blueprintN, scaleN, evN, cfN, schedN] = await Promise.all([
    count(scope(admin.from("cmo_assignment_rules").select("id", { count: "exact", head: true }))),
    count(admin.from("competency_dependencies").select("id", { count: "exact", head: true })),
    count(admin.from("assessment_blueprints").select("id", { count: "exact", head: true })),
    count(admin.from("scoring_levels").select("id", { count: "exact", head: true })),
    count(admin.from("evidence_matrix").select("cpu_id", { count: "exact", head: true })),
    count(admin.from("critical_failure_rules").select("id", { count: "exact", head: true })),
    count(admin.from("reassessment_schedules").select("id", { count: "exact", head: true })),
  ]);

  // Representative rules (defensive select("*") so unknown columns never break the query).
  const [assignRows, critRows, schedRows, bpRows] = await Promise.all([
    rows(scope(admin.from("cmo_assignment_rules").select("*").limit(8))),
    rows(admin.from("critical_failure_rules").select("*").limit(8)),
    rows(admin.from("reassessment_schedules").select("*").limit(30)),
    rows(admin.from("assessment_blueprints").select("*").limit(8)),
  ]);

  const assignSamples = assignRows.map(r => r.name ?? r.rule_name ?? r.competency_name ?? "Assignment rule").slice(0, 5);
  const critSamples = critRows.map(r => r.description ?? r.rule ?? "Critical-failure rule").slice(0, 5);
  const bpSamples = bpRows.map(r => (r.consensus_rule ? `Consensus: ${r.consensus_rule}` : r.min_score != null ? `Min score ${r.min_score}` : "Blueprint rule")).slice(0, 5);

  const schedules: Schedule[] = schedRows.map(r => {
    const triggers: string[] = [];
    if (r.trigger_on_fail) triggers.push("on fail");
    if (r.trigger_on_expiry) triggers.push("on expiry");
    return { name: r.name ?? r.cycle_type ?? "Schedule", cycle: r.cycle_type ?? null, months: r.frequency_months ?? null, triggers, grace: r.grace_period_days ?? null };
  });
  const schedSamples = schedules.map(s => `${s.name}${s.months ? ` · every ${s.months}mo` : ""}`).slice(0, 5);

  const categories: RuleCategory[] = [
    { key: "progression", label: "Progression & Assignment", icon: "🎯", n: assignN + depN, href: "/competency-office/assignment-rules",
      desc: "Who is assigned which competency and how progression is gated (assignment rules + prerequisite graph).",
      samples: [...assignSamples, ...(depN > 0 ? [`${depN} dependency edge${depN === 1 ? "" : "s"}`] : [])].slice(0, 5) },
    { key: "scoring", label: "Assessment Scoring", icon: "🎚️", n: blueprintN + scaleN, href: "/super-admin/assessment-methods",
      desc: "Pass marks, minimum scores, assessor counts and consensus rules on assessment blueprints and scoring scales.",
      samples: [...bpSamples, ...(scaleN > 0 ? [`${scaleN} scoring level${scaleN === 1 ? "" : "s"}`] : [])].slice(0, 5) },
    { key: "evidence", label: "Evidence Validation", icon: "📎", n: evN, href: "/super-admin/content",
      desc: "Required evidence quantities, validity windows and critical evidence per CPU (evidence matrix).",
      samples: evN > 0 ? [`${evN} evidence requirement${evN === 1 ? "" : "s"} across CPUs`] : [] },
    { key: "critical", label: "Critical Failure & Risk", icon: "⛔", n: cfN, href: "/super-admin/content",
      desc: "Behaviours that mandate an automatic fail regardless of overall score.",
      samples: critSamples },
    { key: "recert", label: "Recertification & Reassessment", icon: "♻️", n: schedN, href: "/competency-office/recertification",
      desc: "Cadence, triggers and grace periods that drive competency renewal.",
      samples: schedSamples },
  ];

  const total = categories.reduce((s, c) => s + c.n, 0);
  return { total, categories, schedules };
}
