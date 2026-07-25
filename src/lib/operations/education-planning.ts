// Education Planning Centre (LDS-005) — the Unit Manager's oversight of the unit's formal education
// plans, milestones, study leave and sponsorship over the core stores (migration 090). Real: the
// Overview KPIs, education plans + progress, academic milestones, funding overview, study-leave
// overview, the risk panel and pending approvals. Fail-soft + provisioned-aware (empty until an
// education plan is created). Honest next-phase: programme applications, institutional partnerships,
// qualification verification and pipeline analytics — the fuller LDS-005 domain.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const today = () => new Date().toISOString().slice(0, 10);
const plus = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const STUDY_ENTITLEMENT = 30; // default annual study-leave entitlement (days) — configurable store is next-phase

export async function loadEducationPlanning(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const T = today(), d60 = plus(60);

  let provisioned = true;
  let plans: any[] = [], milestones: any[] = [], leave: any[] = [], sponsor: any[] = [];
  try {
    const [pRes, mRes, lRes, sRes] = await Promise.all([
      scope(admin.from("education_plans").select("id, programme_title, institution, study_mode, start_date, expected_completion, status, progress_pct, adviser, user_id, profiles!user_id(full_name)")).order("created_at", { ascending: false }).limit(500),
      scope(admin.from("education_milestones").select("id, plan_id, name, planned_date, status, completed_at")).limit(5000),
      scope(admin.from("study_leave_requests").select("id, leave_type, days, start_date, status, user_id, profiles!user_id(full_name)")).order("created_at", { ascending: false }).limit(2000),
      scope(admin.from("sponsorship_requests").select("id, source, amount, currency, status, amount_disbursed, user_id, profiles!user_id(full_name)")).order("created_at", { ascending: false }).limit(2000),
    ]);
    if (pRes.error) throw pRes.error;
    plans = pRes.data ?? []; milestones = (mRes as any).error ? [] : (mRes.data ?? []); leave = (lRes as any).error ? [] : (lRes.data ?? []); sponsor = (sRes as any).error ? [] : (sRes.data ?? []);
  } catch { provisioned = false; }

  const active = plans.filter(p => p.status === "active");
  const msByPlan = new Map<string, any[]>();
  milestones.forEach(m => { if (!msByPlan.has(m.plan_id)) msByPlan.set(m.plan_id, []); msByPlan.get(m.plan_id)!.push(m); });
  const msCompleted = milestones.filter(m => m.status === "completed").length;
  const msOverdue = milestones.filter(m => m.status !== "completed" && m.planned_date && m.planned_date < T);

  const fundingApproved = sponsor.filter(s => ["approved", "disbursed"].includes(s.status)).reduce((n, s) => n + Number(s.amount ?? 0), 0);
  const fundingUtilised = sponsor.reduce((n, s) => n + Number(s.amount_disbursed ?? 0), 0);
  const studyDaysApproved = leave.filter(l => l.status === "approved").reduce((n, l) => n + Number(l.days ?? 0), 0);

  const riskPlanIds = new Set(msOverdue.map(m => m.plan_id));
  const plansAtRisk = plans.filter(p => p.status === "active" && (riskPlanIds.has(p.id) || p.status === "on_hold")).length + plans.filter(p => p.status === "on_hold").length;
  const pendingApprovals = leave.filter(l => l.status === "requested").length + sponsor.filter(s => s.status === "requested").length;

  const kpis = {
    activePlans: active.length,
    avgProgress: active.length ? Math.round(active.reduce((n, p) => n + (p.progress_pct ?? 0), 0) / active.length) : 0,
    milestonesCompleted: msCompleted, milestonesTotal: milestones.length,
    fundingApproved, fundingUtilised,
    studyDaysApproved, studyEntitlement: STUDY_ENTITLEMENT,
    plansAtRisk, pendingApprovals,
  };

  // Plans list with milestone progress.
  const plansList = plans.slice(0, 8).map(p => { const ms = msByPlan.get(p.id) ?? []; const done = ms.filter(m => m.status === "completed").length; return { id: p.id, user_id: p.user_id, title: p.programme_title, institution: p.institution, name: p.profiles?.full_name ?? "—", mode: (p.study_mode ?? "").replace(/_/g, " "), status: p.status, progress: p.progress_pct ?? 0, milestones: `${done}/${ms.length}`, completion: p.expected_completion }; });

  // Upcoming academic milestones (≤60d, not completed).
  const upcoming = milestones.filter(m => m.status !== "completed" && m.planned_date && m.planned_date >= T && m.planned_date <= d60)
    .sort((a, b) => (a.planned_date ?? "").localeCompare(b.planned_date ?? "")).slice(0, 6).map(m => ({ name: m.name, date: m.planned_date }));

  // Funding by source + study leave by type.
  const fundBy = new Map<string, number>();
  sponsor.filter(s => ["approved", "disbursed"].includes(s.status)).forEach(s => fundBy.set(s.source, (fundBy.get(s.source) ?? 0) + Number(s.amount ?? 0)));
  const fundingBySource = [...fundBy.entries()].map(([source, amount]) => ({ source: source.replace(/_/g, " "), amount })).sort((a, b) => b.amount - a.amount);
  const leaveBy = new Map<string, number>();
  leave.filter(l => l.status === "approved").forEach(l => leaveBy.set(l.leave_type, (leaveBy.get(l.leave_type) ?? 0) + Number(l.days ?? 0)));
  const leaveByType = [...leaveBy.entries()].map(([type, days]) => ({ type: type.replace(/_/g, " "), days })).sort((a, b) => b.days - a.days);

  // Risk panel + pending approvals list.
  const risks = [
    ...msOverdue.slice(0, 4).map(m => ({ label: `Milestone overdue: ${m.name}`, detail: `Due ${m.planned_date}`, severity: "high" as const })),
    ...(pendingApprovals ? [{ label: `${pendingApprovals} approval(s) pending`, detail: "Study leave / sponsorship awaiting decision", severity: "medium" as const }] : []),
  ].slice(0, 5);
  const pendingList = [
    ...leave.filter(l => l.status === "requested").map(l => ({ kind: "Study leave", name: l.profiles?.full_name ?? "—", detail: `${l.days}d ${l.leave_type}`, id: l.id, type: "leave" })),
    ...sponsor.filter(s => s.status === "requested").map(s => ({ kind: "Sponsorship", name: s.profiles?.full_name ?? "—", detail: `${s.currency} ${Number(s.amount).toLocaleString()}`, id: s.id, type: "sponsorship" })),
  ].slice(0, 6);

  return { provisioned, ready: provisioned, hasData: plans.length > 0, kpis, plansList, upcoming, fundingBySource, leaveByType, risks, pendingList, currency: sponsor[0]?.currency ?? "UGX" };
}
