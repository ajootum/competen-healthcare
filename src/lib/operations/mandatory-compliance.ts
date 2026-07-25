// Mandatory Learning & Compliance Centre (LDS-002) — the compliance-focused view over the LDS-001
// learning operations (learning_enrolments / learning_assignments / learning_courses, migration 089).
// Real: the compliance KPIs, status distribution, by-role & by-course compliance, top critical gaps,
// named overdue learners (with a derived escalation level), upcoming expiries and recent completions.
// Honest next-phase: exception/extension request store, escalation store, risk-level classification,
// by-department grouping (no department field on staff) and the compliance trend history. Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const today = () => new Date().toISOString().slice(0, 10);
const plus = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (aIso: string) => Math.round((Date.now() - new Date(aIso).getTime()) / 86400000);
const escLevel = (days: number) => (days >= 21 ? "Level 3" : days >= 14 ? "Level 2" : "Level 1");

export async function loadMandatoryCompliance(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const T = today(), d30 = plus(30);

  let provisioned = true;
  let enr: any[] = [];
  try {
    const { data, error } = await scope(admin.from("learning_enrolments")
      .select("id, status, mandatory, due_date, completed_at, updated_at, user_id, profiles!user_id(full_name, role), course:learning_courses!course_id(id, title)")
      .limit(20000));
    if (error) throw error;
    enr = data ?? [];
  } catch { provisioned = false; enr = []; }

  let assignmentsIssued = 0;
  try { const { count } = await scope(admin.from("learning_assignments").select("id", { count: "exact", head: true })); assignmentsIssued = count ?? 0; } catch { /* fail-soft */ }

  // Mandatory-learning universe (the compliance centre is about mandatory learning).
  const M = enr.filter(e => e.mandatory);
  const isOverdue = (e: any) => e.status === "overdue" || (!["completed", "exempt"].includes(e.status) && e.due_date && e.due_date < T);
  const isDueSoon = (e: any) => !["completed", "exempt"].includes(e.status) && e.due_date && e.due_date >= T && e.due_date <= d30;
  const isDone = (e: any) => e.status === "completed";
  const nonExempt = M.filter(e => e.status !== "exempt");

  // Per-learner rollup.
  const learners = new Map<string, { name: string; role: string; total: number; done: number; overdue: number; dueSoon: number }>();
  M.forEach(e => { const g = learners.get(e.user_id) ?? { name: e.profiles?.full_name ?? "—", role: (e.profiles?.role ?? "").replace(/_/g, " "), total: 0, done: 0, overdue: 0, dueSoon: 0 }; g.total++; if (isDone(e)) g.done++; if (isOverdue(e)) g.overdue++; if (isDueSoon(e)) g.dueSoon++; learners.set(e.user_id, g); });
  const learnerArr = [...learners.values()];

  const kpis = {
    overallCompliance: nonExempt.length ? Math.round((nonExempt.filter(isDone).length / nonExempt.length) * 100) : 0,
    fullyCompliant: learnerArr.filter(l => l.total > 0 && l.done === l.total).length,
    dueSoon: M.filter(isDueSoon).length,
    overdueLearners: learnerArr.filter(l => l.overdue > 0).length,
    assignmentsIssued,
    completionRate: nonExempt.length ? Math.round((nonExempt.filter(isDone).length / nonExempt.length) * 100) : 0,
    totalLearners: learnerArr.length,
  };

  // Status distribution.
  const status = {
    compliant: M.filter(isDone).length,
    dueSoon: M.filter(isDueSoon).length,
    overdue: M.filter(isOverdue).length,
    notStarted: M.filter(e => e.status === "not_started" && !isOverdue(e) && !isDueSoon(e)).length,
    exempt: M.filter(e => e.status === "exempt").length,
  };

  // Compliance by role + by course.
  const groupPct = (keyFn: (e: any) => string) => {
    const g = new Map<string, { total: number; done: number }>();
    nonExempt.forEach(e => { const k = keyFn(e); const x = g.get(k) ?? { total: 0, done: 0 }; x.total++; if (isDone(e)) x.done++; g.set(k, x); });
    return [...g.entries()].map(([name, x]) => ({ name, total: x.total, pct: x.total ? Math.round((x.done / x.total) * 100) : 0 })).sort((a, b) => a.pct - b.pct);
  };
  const byRole = groupPct(e => (e.profiles?.role ?? "unknown").replace(/_/g, " ")).slice(0, 8);
  const byCourse = groupPct(e => e.course?.title ?? "Course").slice(0, 8);

  // Top critical gaps — courses with the most non-compliant (overdue/incomplete) learners.
  const gapMap = new Map<string, number>();
  M.filter(e => !isDone(e) && e.status !== "exempt").forEach(e => { const c = e.course?.title ?? "Course"; gapMap.set(c, (gapMap.get(c) ?? 0) + 1); });
  const topGaps = [...gapMap.entries()].map(([requirement, affected]) => ({ requirement, affected })).sort((a, b) => b.affected - a.affected).slice(0, 6);

  // Overdue learners table (named, days overdue, escalation level).
  const overdueLearners = M.filter(isOverdue).sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
    .slice(0, 12).map(e => { const days = e.due_date ? daysBetween(e.due_date) : 0; return { name: e.profiles?.full_name ?? "—", role: (e.profiles?.role ?? "").replace(/_/g, " "), requirement: e.course?.title ?? "Course", due: e.due_date, days, escalation: escLevel(days) }; });

  // Upcoming (due within 30 days) + recent completions.
  const upcoming = M.filter(isDueSoon).sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")).slice(0, 6)
    .map(e => ({ requirement: e.course?.title ?? "Course", name: e.profiles?.full_name ?? "—", due: e.due_date, days: e.due_date ? Math.max(0, -daysBetween(e.due_date)) : null }));
  const recentCompletions = M.filter(e => isDone(e) && e.completed_at).sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "")).slice(0, 8)
    .map(e => ({ name: e.profiles?.full_name ?? "—", requirement: e.course?.title ?? "Course", at: e.completed_at }));

  // Escalation summary (derived from overdue by level) — honest proxy until an escalation store exists.
  const escalations = { l1: overdueLearners.filter(o => o.escalation === "Level 1").length, l2: overdueLearners.filter(o => o.escalation === "Level 2").length, l3: overdueLearners.filter(o => o.escalation === "Level 3").length };

  return {
    provisioned, ready: provisioned, hasData: M.length > 0,
    kpis, status, byRole, byCourse, topGaps, overdueLearners, upcoming, recentCompletions, escalations,
  };
}
