// Learning Oversight & Development Centre (UMG-005) — the Unit Manager's learning oversight layer above
// the Educator Workspace. Real over the live competency spine (competency_decisions → learning compliance,
// competency gaps that drive learning needs, by-role heat map, priority queue) + the learning catalogue
// (curricula / learning_pathways / learning_resources / resource_competencies → recommended learning for
// each gap). Honest next-phase: per-staff learning ASSIGNMENT tracking, protected-learning-time, individual
// development plans and career-pathway progression — none has a store yet. Tenant-scoped; fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadCompetencyOfficeDashboard } from "@/lib/competency-office-data";

const NONE = "00000000-0000-0000-0000-000000000000";
const PASSING = ["competent", "competent_with_conditions", "provisionally_competent"];

export async function loadLearningCentre(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const T = new Date().toISOString().slice(0, 10);
  const d30 = (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); })();
  const office = await loadCompetencyOfficeDashboard(admin, hid, isSuper);

  // ── Competency spine → learning needs ────────────────────────────────────────────────────────
  let provisioned = true;
  let latest: any[] = [];
  try {
    const { data, error } = await scope(admin.from("competency_decisions")
      .select("nurse_id, competency_id, outcome, expiry_date, created_at, profiles!nurse_id(full_name, role)")
      .order("created_at", { ascending: false }).limit(20000));
    if (error) throw error;
    const seen = new Set<string>();
    for (const d of data ?? []) { const k = `${d.nurse_id}:${d.competency_id}`; if (seen.has(k)) continue; seen.add(k); latest.push(d); }
  } catch { provisioned = false; latest = []; }

  const isCurrent = (d: any) => PASSING.includes(d.outcome) && (!d.expiry_date || d.expiry_date >= T);
  const isExpired = (d: any) => PASSING.includes(d.outcome) && d.expiry_date && d.expiry_date < T;
  const isExpiring = (d: any) => PASSING.includes(d.outcome) && d.expiry_date && d.expiry_date >= T && d.expiry_date <= d30;
  const isNone = (d: any) => !PASSING.includes(d.outcome);
  const isGap = (d: any) => isExpired(d) || isNone(d) || isExpiring(d);

  const compliance = { total: latest.length, current: latest.filter(isCurrent).length, pct: office.compliance.coverage };
  const gaps = {
    expired: latest.filter(isExpired).length,
    expiring: latest.filter(isExpiring).length,
    none: latest.filter(isNone).length,
    staffAffected: new Set(latest.filter(isGap).map(d => d.nurse_id)).size,
  };

  // Learning heat map by role (gap concentration).
  const byRoleMap = new Map<string, { total: number; gaps: number }>();
  latest.forEach(d => { const role = (d.profiles?.role ?? "unknown").replace(/_/g, " "); const g = byRoleMap.get(role) ?? { total: 0, gaps: 0 }; g.total++; if (isGap(d)) g.gaps++; byRoleMap.set(role, g); });
  const byRole = [...byRoleMap.entries()].map(([role, g]) => ({ role, total: g.total, gaps: g.gaps, pct: g.total ? Math.round(((g.total - g.gaps) / g.total) * 100) : 0 })).sort((a, b) => a.pct - b.pct).slice(0, 8);

  // Priority queue — staff with the most learning gaps.
  const byStaff = new Map<string, { name: string; role: string; gaps: number }>();
  latest.filter(isGap).forEach(d => { const g = byStaff.get(d.nurse_id) ?? { name: d.profiles?.full_name ?? "—", role: (d.profiles?.role ?? "").replace(/_/g, " "), gaps: 0 }; g.gaps++; byStaff.set(d.nurse_id, g); });
  const priorityStaff = [...byStaff.values()].sort((a, b) => b.gaps - a.gaps).slice(0, 8);

  // ── Learning catalogue ───────────────────────────────────────────────────────────────────────
  const catalogue = { curricula: 0, pathways: 0, resources: 0, mapped: 0, provisioned: true };
  try {
    const [cur, pat, res, rc] = await Promise.all([
      admin.from("curricula").select("id", { count: "exact", head: true }),
      admin.from("learning_pathways").select("id", { count: "exact", head: true }),
      admin.from("learning_resources").select("id", { count: "exact", head: true }),
      admin.from("resource_competencies").select("competency_id").limit(20000),
    ]);
    if ((cur as any).error && (res as any).error) throw (cur as any).error;
    catalogue.curricula = cur.count ?? 0;
    catalogue.pathways = pat.count ?? 0;
    catalogue.resources = res.count ?? 0;
    catalogue.mapped = new Set(((rc.data ?? []) as any[]).map(r => r.competency_id)).size;
  } catch { catalogue.provisioned = false; }

  // Recommended learning — gap competencies that have mapped learning resources.
  let recommended: any[] = [];
  try {
    const gapCompIds = [...new Set(latest.filter(isGap).map(d => d.competency_id).filter(Boolean))].slice(0, 300);
    if (gapCompIds.length) {
      const [{ data: rc }, { data: comps }] = await Promise.all([
        admin.from("resource_competencies").select("competency_id, resource_id").in("competency_id", gapCompIds).limit(5000),
        admin.from("framework_competencies").select("id, name").in("id", gapCompIds).limit(5000),
      ]);
      const name = new Map<string, string>((comps ?? []).map((c: any) => [c.id, c.name]));
      const byComp = new Map<string, number>();
      (rc ?? []).forEach((r: any) => byComp.set(r.competency_id, (byComp.get(r.competency_id) ?? 0) + 1));
      recommended = [...byComp.entries()].map(([id, n]) => ({ competency: name.get(id) ?? "Competency", resources: n })).sort((a, b) => b.resources - a.resources).slice(0, 6);
    }
  } catch { /* fail-soft */ }

  // ── LDS-001 operational layer (learning_assignments / learning_enrolments, migration 089) ────
  // Real assignment/enrolment/completion tracking; fail-soft + provisioned-aware (empty until seeded).
  const learning = { provisioned: true, total: 0, active: 0, completed: 0, inProgress: 0, notStarted: 0, overdue: 0, dueSoon: 0, exempt: 0, completionRate: 0, mandatoryCompliance: null as number | null, activeAssignments: 0, overdueList: [] as any[] };
  try {
    const { data: enr, error } = await scope(admin.from("learning_enrolments")
      .select("status, progress_pct, mandatory, due_date, completed_at, user_id, profiles!user_id(full_name, role), course:learning_courses!course_id(title)")
      .limit(20000));
    if (error) throw error;
    const rows = (enr ?? []) as any[];
    learning.total = rows.length;
    learning.completed = rows.filter(e => e.status === "completed").length;
    learning.inProgress = rows.filter(e => e.status === "in_progress").length;
    learning.notStarted = rows.filter(e => e.status === "not_started").length;
    learning.exempt = rows.filter(e => e.status === "exempt").length;
    const isOverdue = (e: any) => e.status === "overdue" || (e.mandatory && !["completed", "exempt"].includes(e.status) && e.due_date && e.due_date < T);
    learning.overdue = rows.filter(isOverdue).length;
    learning.dueSoon = rows.filter(e => !["completed", "exempt"].includes(e.status) && e.due_date && e.due_date >= T && e.due_date <= d30).length;
    learning.active = rows.filter(e => ["not_started", "in_progress", "overdue"].includes(e.status)).length;
    const nonExempt = learning.total - learning.exempt;
    learning.completionRate = nonExempt ? Math.round((learning.completed / nonExempt) * 100) : 0;
    const mand = rows.filter(e => e.mandatory);
    learning.mandatoryCompliance = mand.length ? Math.round((mand.filter(e => e.status === "completed").length / mand.length) * 100) : null;
    learning.overdueList = rows.filter(isOverdue).sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")).slice(0, 8)
      .map(e => ({ name: e.profiles?.full_name ?? "—", role: (e.profiles?.role ?? "").replace(/_/g, " "), course: e.course?.title ?? "Course", due: e.due_date }));
    const { count } = await scope(admin.from("learning_assignments").select("id", { count: "exact", head: true }).eq("active", true));
    learning.activeAssignments = count ?? 0;
  } catch { learning.provisioned = false; }

  // Recent learning/competency activity.
  let activity: any[] = [];
  try {
    const { data: au } = await scope(admin.from("audit_log").select("id, action, created_at, actor:profiles!actor_id(full_name)").order("created_at", { ascending: false }).limit(60));
    activity = (au ?? []).filter((a: any) => /learn|competenc|assess|pathway|curricul|develop|validat/i.test(a.action ?? "")).slice(0, 10);
  } catch { /* fail-soft */ }

  return { provisioned: provisioned || office.compliance.total > 0, ready: provisioned || office.compliance.total > 0, compliance, gaps, byRole, priorityStaff, catalogue, recommended, activity, learning };
}
