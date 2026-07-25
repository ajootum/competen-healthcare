// PW-006 My Learning Centre — a personalised, course-centric learning hub over the person's REAL records:
// learning_enrolments (progress_pct, status, due), learning_courses (catalogue), cpd_logs (hours/points/type),
// learning_pathways + pathway_items (the plan). Computes the KPI ribbon, Continue-Learning list, the learning
// plan, recommendations (catalogue minus enrolled), domain pathways, the CPD summary donut, rule-based
// achievements and the learning calendar. Read-only aggregation. Numbers are the person's own — honestly lighter
// than the aspirational mockup for a real clinician.
/* eslint-disable @typescript-eslint/no-explicit-any */
const dayMs = 86400000;
const q = async (p: Promise<any>) => { try { const r = await p; return r?.error ? [] : (r?.data ?? []); } catch { return []; } };

// CPD activity_type → summary bucket.
const CPD_BUCKET: Record<string, { label: string; color: string }> = {
  course: { label: "Formal Learning", color: "#3b82f6" }, workshop: { label: "Formal Learning", color: "#3b82f6" }, conference: { label: "Formal Learning", color: "#3b82f6" },
  self_study: { label: "Self-Directed", color: "#f59e0b" },
  simulation: { label: "Practical & Sim", color: "#10b981" }, osce: { label: "Practical & Sim", color: "#10b981" },
};
const COURSE_TYPE_LABEL: Record<string, string> = { elearning: "eLearning", classroom: "Classroom", simulation: "Simulation", module: "Module" };

function computeStreak(dates: string[]): number {
  if (!dates.length) return 0;
  const days = [...new Set(dates)].sort().reverse(); // yyyy-mm-dd desc
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let streak = 0;
  const cursor = new Date(today);
  // Allow the streak to start today or yesterday.
  const mostRecent = new Date(days[0] + "T00:00:00");
  if ((today.getTime() - mostRecent.getTime()) / dayMs > 1) return 0;
  for (const d of days) {
    const dd = new Date(d + "T00:00:00");
    if (dd.getTime() === cursor.getTime() || dd.getTime() === cursor.getTime() - dayMs) { streak++; cursor.setTime(dd.getTime() - dayMs); }
    else break;
  }
  return streak;
}

export async function loadLearningCentre(admin: any, userId: string, profile: any) {
  const now = Date.now();
  const hid = profile?.hospital_id ?? null;
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const [enrol, cpd, pathway] = await Promise.all([
    q(admin.from("learning_enrolments").select("id, course_id, status, progress_pct, score, mandatory, due_date, completed_at, enrolled_on").eq("user_id", userId).limit(500)),
    q(admin.from("cpd_logs").select("activity_type, title, hours, cpd_points, activity_date, certificate_url").eq("user_id", userId).limit(1000)),
    q(admin.from("learning_pathways").select("id, title, status, generated_at").eq("nurse_id", userId).order("generated_at", { ascending: false }).limit(1)),
  ]);

  // Course titles/types for enrolled courses.
  const courseIds = [...new Set(enrol.map((e: any) => e.course_id).filter(Boolean))];
  const course = new Map<string, any>();
  if (courseIds.length) (await q(admin.from("learning_courses").select("id, title, course_type, mandatory, competency_id").in("id", courseIds))).forEach((c: any) => course.set(c.id, c));
  const withCourse = enrol.map((e: any) => ({ ...e, course: course.get(e.course_id) ?? { title: "Course", course_type: null } }));

  const inProgress = withCourse.filter((e: any) => e.status === "in_progress").sort((a: any, b: any) => (b.progress_pct ?? 0) - (a.progress_pct ?? 0));
  const completed = withCourse.filter((e: any) => e.status === "completed");
  const overdueMandatory = withCourse.filter((e: any) => e.mandatory && !["completed", "exempt"].includes(e.status) && e.due_date && new Date(e.due_date).getTime() < now);

  // ── CPD ──
  const cpdYear = cpd.filter((l: any) => (l.activity_date ?? "") >= yearStart);
  const cpdPointsYear = Math.round(cpdYear.reduce((s: number, l: any) => s + Number(l.cpd_points || 0), 0));
  const hoursThisMonth = Math.round(cpd.filter((l: any) => l.activity_date && new Date(l.activity_date + "T00:00:00").getTime() >= monthStart.getTime()).reduce((s: number, l: any) => s + Number(l.hours || 0), 0) * 10) / 10;
  const certificates = cpd.filter((l: any) => l.certificate_url).length || completed.filter((e: any) => e.mandatory).length;
  const streak = computeStreak(cpd.map((l: any) => l.activity_date).filter(Boolean));

  // CPD summary buckets (this year).
  const buckets = new Map<string, { label: string; color: string; pts: number }>();
  for (const l of cpdYear) { const b = CPD_BUCKET[l.activity_type] ?? { label: "Other", color: "#94a3b8" }; const cur = buckets.get(b.label) ?? { label: b.label, color: b.color, pts: 0 }; cur.pts += Number(l.cpd_points || 0); buckets.set(b.label, cur); }
  const cpdSummary = [...buckets.values()].sort((a, b) => b.pts - a.pts);

  // ── Learning plan (pathway) ──
  let plan: any = null;
  if (pathway.length) {
    const items = await q(admin.from("pathway_items").select("competency_name, reason, resource_title, resource_type, status").eq("pathway_id", pathway[0].id).limit(50));
    const done = items.filter((i: any) => i.status === "completed").length;
    const pending = items.filter((i: any) => i.status !== "completed");
    plan = { title: pathway[0].title ?? "My Development Plan", total: items.length, done, progress: items.length ? Math.round((done / items.length) * 100) : 0, nextMilestone: pending[0] ?? null, recommendedNext: pending[1] ?? null };
  }

  // ── Recommendations: active catalogue courses not yet enrolled (hospital-scoped + shared/master) ──
  let catQ = admin.from("learning_courses").select("id, title, course_type, mandatory, competency_id").eq("active", true);
  catQ = hid ? catQ.or(`hospital_id.eq.${hid},hospital_id.is.null`) : catQ.is("hospital_id", null);
  const catalogue = await q(catQ.limit(200));
  const enrolledIds = new Set(courseIds);
  const recommended = catalogue.filter((c: any) => !enrolledIds.has(c.id)).slice(0, 6);

  // ── Domain pathways: group catalogue courses by competency domain ──
  const compIds = [...new Set(catalogue.map((c: any) => c.competency_id).filter(Boolean))];
  const domainOf = new Map<string, string>();
  if (compIds.length) {
    const comps = await q(admin.from("framework_competencies").select("id, domain_id").in("id", compIds));
    const domIds = [...new Set(comps.map((c: any) => c.domain_id).filter(Boolean))];
    const domName = new Map<string, string>();
    if (domIds.length) (await q(admin.from("framework_domains").select("id, name").in("id", domIds))).forEach((d: any) => domName.set(d.id, d.name));
    comps.forEach((c: any) => { if (c.domain_id) domainOf.set(c.id, domName.get(c.domain_id) ?? ""); });
  }
  const pathCount = new Map<string, number>();
  catalogue.forEach((c: any) => { const dn = c.competency_id ? domainOf.get(c.competency_id) : null; if (dn) pathCount.set(dn, (pathCount.get(dn) ?? 0) + 1); });
  const pathways = [...pathCount.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 4);

  // ── Learning calendar: upcoming due enrolments ──
  const calendar = withCourse.filter((e: any) => e.due_date && new Date(e.due_date).getTime() >= now - dayMs && !["completed", "exempt"].includes(e.status)).sort((a: any, b: any) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime()).slice(0, 5).map((e: any) => ({ title: e.course.title, type: COURSE_TYPE_LABEL[e.course.course_type] ?? "Course", date: e.due_date }));

  // ── Achievements (rule-based badges) ──
  const validated = await q(admin.from("competency_decisions").select("id, validation_outcome").eq("nurse_id", userId).eq("validation_outcome", "validated"));
  const cpdTarget = hid ? Number((await q(admin.from("hospitals").select("cpd_target_hours").eq("id", hid).limit(1)))[0]?.cpd_target_hours ?? 0) : 0;
  const cpdHoursYear = Math.round(cpdYear.reduce((s: number, l: any) => s + Number(l.hours || 0), 0) * 10) / 10;
  const achievements = [
    { label: "CPD Achiever", icon: "🎖️", color: "#3b82f6", earned: cpdTarget > 0 ? cpdHoursYear >= cpdTarget : cpdPointsYear >= 10 },
    { label: "Quick Learner", icon: "⚡", color: "#8b5cf6", earned: completed.length >= 5 },
    { label: "Assessment Pro", icon: "🏅", color: "#f59e0b", earned: validated.length >= 3 },
    { label: "Compliance Star", icon: "✅", color: "#10b981", earned: overdueMandatory.length === 0 && withCourse.some((e: any) => e.mandatory) },
  ];

  return {
    kpis: { hoursThisMonth, inProgress: inProgress.length, completed: completed.length, certificates, cpdPointsYear, streak },
    continueLearning: inProgress.slice(0, 6), plan, recommended, pathways, cpdSummary, cpdPointsYear, achievements, calendar,
    overdueMandatory: overdueMandatory.length, cpdTarget, cpdHoursYear,
    courseTypeLabel: COURSE_TYPE_LABEL,
  };
}
