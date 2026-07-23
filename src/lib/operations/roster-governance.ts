// Roster Governance (UMW-WFM-004) loader. The Unit Manager's assurance & approval layer
// BETWEEN the WSE Scheduling Engine (which generates the roster) and the published roster —
// it does NOT generate rosters, it governs them. Composes the already-built engines that run
// over the SAME current-week roster store (op_rosters / op_roster_assignments, migration 080):
// constraint (coverage/working-time/safety), competency matching (skill mix), fairness and
// cost, plus supervisor-coverage + coverage-readiness computed directly from the roster
// assignments. Produces the overall assurance score (§8.2) with a hard publish-block that a
// high numeric score can never override, and the governance-overview widgets. Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadRosterForWeek, mondayOf } from "@/lib/operations/roster-solver";
import { loadConstraintEngine } from "@/lib/operations/constraint-engine";
import { loadCompetencyMatching } from "@/lib/operations/competency-matching";
import { loadFairnessEngine } from "@/lib/operations/fairness-engine";
import { loadCostEngine } from "@/lib/operations/cost-engine";

const NONE = "00000000-0000-0000-0000-000000000000";
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
// §8.2 assurance bands
export const bandOf = (s: number) => (s >= 90 ? "Ready" : s >= 75 ? "Review required" : s >= 50 ? "Material risks" : "Not publishable");

// Assurance-score weights (transparent + surfaced in the UI — explainability, §27.8).
export const ASSURANCE_WEIGHTS = { coverage: 0.25, competency: 0.2, supervisor: 0.15, workingTime: 0.15, fairness: 0.1, exceptions: 0.15 };

export async function loadRosterGovernance(admin: any, hid: string | null, isSuper: boolean) {
  const weekStart = mondayOf();
  const [rw, con, comp, fair, cost] = await Promise.all([
    loadRosterForWeek(admin, hid, isSuper, weekStart),
    loadConstraintEngine(admin, hid, isSuper) as Promise<any>,
    loadCompetencyMatching(admin, hid, isSuper) as Promise<any>,
    loadFairnessEngine(admin, hid, isSuper) as Promise<any>,
    loadCostEngine(admin, hid, isSuper) as Promise<any>,
  ]);
  if (!(rw as any).provisioned) return { provisioned: false as const, weekStart };
  const roster = (rw as any).roster;
  if (!roster) return { provisioned: true as const, hasRoster: false as const, weekStart };
  const asg: any[] = (rw as any).assignments ?? [];
  const days: string[] = (rw as any).days ?? [];

  // ── Coverage readiness + supervisor coverage (from roster assignments) ───────
  const shiftMap = new Map<string, { unit: string; date: string; shift: string; posts: number; filled: number; supPost: boolean; supFilled: boolean }>();
  for (const a of asg) {
    const key = `${a.unit_name}|${a.shift_date}|${a.shift_type}`;
    const s = shiftMap.get(key) ?? { unit: a.unit_name, date: a.shift_date, shift: a.shift_type, posts: 0, filled: 0, supPost: false, supFilled: false };
    s.posts++;
    if (a.status === "assigned") s.filled++;
    if (a.is_supervisor) { s.supPost = true; if (a.status === "assigned") s.supFilled = true; }
    shiftMap.set(key, s);
  }
  const shifts = [...shiftMap.values()];
  const totalShifts = shifts.length;
  const fullyCovered = shifts.filter(s => s.posts > 0 && s.filled === s.posts).length;
  const uncoveredShifts = shifts.filter(s => s.filled === 0).length;
  const partialShifts = totalShifts - fullyCovered - uncoveredShifts;
  const totalPosts = asg.length;
  const filledPosts = asg.filter(a => a.status === "assigned").length;
  const coveragePct = totalPosts ? Math.round((filledPosts / totalPosts) * 100) : null;
  // highest-risk dates (most uncovered posts)
  const gapByDate = new Map<string, number>();
  for (const a of asg) if (a.status === "uncovered") gapByDate.set(a.shift_date, (gapByDate.get(a.shift_date) ?? 0) + 1);
  const riskDates = [...gapByDate.entries()].map(([date, gaps]) => ({ date, gaps })).sort((a, b) => b.gaps - a.gaps).slice(0, 5);

  const supPostShifts = shifts.filter(s => s.supPost).length;
  const supConfirmed = shifts.filter(s => s.supFilled).length;
  const supUncovered = supPostShifts - supConfirmed;
  const supNoPost = totalShifts - supPostShifts; // shift with no supervisor post at all
  const supervisorScore = supPostShifts ? Math.round((supConfirmed / supPostShifts) * 100) : null;

  // ── Component scores (reuse engine outputs; fall back to stored roster scores) ─
  const coverageScore = roster.coverage_score ?? coveragePct;
  const competencyScore = comp?.kpis?.matchScore ?? roster.competency_score ?? null;
  const workingTimeScore = con?.kpis?.complianceScore ?? null;
  const fairnessScore = fair?.kpis?.overall ?? roster.fairness_score ?? null;
  const critical = con?.kpis?.critical ?? 0;
  const warnings = con?.kpis?.warnings ?? 0;
  const exceptionsScore = clamp(100 - (critical * 15 + warnings * 3), 0, 100);

  // Weighted assurance over available components (renormalised)
  const comps: { key: keyof typeof ASSURANCE_WEIGHTS; score: number | null; label: string }[] = [
    { key: "coverage", score: coverageScore, label: "Coverage adequacy" },
    { key: "competency", score: competencyScore, label: "Skill-mix / competency" },
    { key: "supervisor", score: supervisorScore, label: "Supervisor coverage" },
    { key: "workingTime", score: workingTimeScore, label: "Working-time compliance" },
    { key: "fairness", score: fairnessScore, label: "Fairness" },
    { key: "exceptions", score: exceptionsScore, label: "Exception load" },
  ];
  const avail = comps.filter(c => c.score != null);
  const wSum = avail.reduce((n, c) => n + ASSURANCE_WEIGHTS[c.key], 0);
  const assurance = wSum ? Math.round(avail.reduce((n, c) => n + ASSURANCE_WEIGHTS[c.key] * (c.score as number), 0) / wSum) : null;

  // ── Hard publish-block (a high score can never override a critical safety rule) ─
  const blockingReasons: string[] = [];
  if (supUncovered > 0) blockingReasons.push(`${supUncovered} shift(s) without a confirmed Shift Supervisor`);
  if (uncoveredShifts > 0) blockingReasons.push(`${uncoveredShifts} shift(s) with no staff assigned`);
  if (critical > 0) blockingReasons.push(`${critical} critical constraint violation(s)`);
  const expiredOnRoster = comp?.kpis?.expiredCerts ?? 0;
  const publishable = blockingReasons.length === 0 && roster.status !== "archived";

  // ── Recent governance activity (audit_log, real) ─────────────────────────────
  const ROSTER_ACTIONS = ["generate_roster", "publish_roster", "archive_roster"];
  let recentActivity: any[] = [];
  try {
    const q = admin.from("audit_log").select("actor_name, action, entity_name, created_at").in("action", ROSTER_ACTIONS).order("created_at", { ascending: false }).limit(12);
    const { data } = await (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
    recentActivity = data ?? [];
  } catch { recentActivity = []; }

  return {
    provisioned: true as const, hasRoster: true as const, weekStart, days,
    roster: {
      status: roster.status, version: roster.version, coverageScore: roster.coverage_score, competencyScore: roster.competency_score, fairnessScore: roster.fairness_score,
      estCost: roster.est_cost, slotsTotal: roster.slots_total, slotsFilled: roster.slots_filled,
      generatedByName: roster.generated_by_name, generatedAt: roster.generated_at, publishedByName: roster.published_by_name, publishedAt: roster.published_at, notes: roster.notes,
    },
    assurance: { score: assurance, band: assurance != null ? bandOf(assurance) : "—", components: comps, weights: ASSURANCE_WEIGHTS, publishable, blockingReasons },
    coverage: { totalShifts, fullyCovered, partialShifts, uncoveredShifts, coveragePct, totalPosts, filledPosts, riskDates },
    supervisor: { required: supPostShifts, confirmed: supConfirmed, uncovered: supUncovered, noPost: supNoPost, score: supervisorScore },
    skillMix: { competencyScore, currentPct: comp?.kpis?.currentPct ?? null, expiredCerts: expiredOnRoster, expiringCerts: comp?.kpis?.expiringCerts ?? 0, roleCoverage: comp?.roleCoverage ?? [] },
    workingTime: { score: workingTimeScore, critical, warnings, blocked: con?.kpis?.blocked ?? 0, overLimit: fair?.kpis?.overLimit ?? 0, topViolated: con?.topViolated ?? [] },
    fairness: { overall: fairnessScore, nightEquity: fair?.kpis?.nightEquity ?? null, weekendEquity: fair?.kpis?.weekendEquity ?? null, biasAlerts: fair?.kpis?.biasAlerts ?? 0 },
    cost: { totalLabour: cost?.kpis?.totalLabour ?? null, weeklyBudget: cost?.kpis?.weeklyBudget ?? null, variance: cost?.kpis?.variance ?? null, overtimeHours: cost?.kpis?.overtimeHours ?? null, agencyProjected: cost?.kpis?.agencyProjected ?? null },
    exceptions: { critical, warnings, blocked: con?.kpis?.blocked ?? 0, overrideRequests: con?.kpis?.overrideRequests ?? 0 },
    recentActivity,
  };
}

// ── Coverage & Safety Validation (§10) ───────────────────────────────────────
// Per-shift safe-staffing validation outcome (safe / warning / gap / critical) + a heat map
// (unit×shift rows, dates as columns) computed directly from the roster assignments. A shift
// is critical when it has no staff, or a required supervisor post is unfilled.
export async function loadRosterCoverage(admin: any, hid: string | null, isSuper: boolean) {
  const weekStart = mondayOf();
  const rw = await loadRosterForWeek(admin, hid, isSuper, weekStart);
  if (!(rw as any).provisioned) return { provisioned: false as const, weekStart };
  const roster = (rw as any).roster;
  if (!roster) return { provisioned: true as const, hasRoster: false as const, weekStart };
  const asg: any[] = (rw as any).assignments ?? [];
  const days: string[] = (rw as any).days ?? [];

  const map = new Map<string, any>();
  for (const a of asg) {
    const key = `${a.unit_name}|${a.shift_date}|${a.shift_type}`;
    const s = map.get(key) ?? { unit: a.unit_name, date: a.shift_date, shift: a.shift_type, posts: 0, filled: 0, supPost: false, supFilled: false, compGap: 0 };
    s.posts++;
    if (a.status === "assigned") { s.filled++; if (!a.competency_validated) s.compGap++; }
    if (a.is_supervisor) { s.supPost = true; if (a.status === "assigned") s.supFilled = true; }
    map.set(key, s);
  }
  const shifts = [...map.values()].map(s => {
    const gap = s.posts - s.filled;
    const pct = s.posts ? Math.round((s.filled / s.posts) * 100) : 100;
    const outcome = s.filled === 0 ? "critical" : (s.supPost && !s.supFilled) ? "critical" : gap > 0 ? (pct >= 80 ? "warning" : "gap") : "safe";
    return { ...s, gap, pct, outcome };
  });
  const units = [...new Set(shifts.map(s => s.unit))];
  const counts = { safe: 0, warning: 0, gap: 0, critical: 0 } as Record<string, number>;
  shifts.forEach(s => { counts[s.outcome] = (counts[s.outcome] ?? 0) + 1; });
  const cell = (unit: string, date: string, shift: string) => shifts.find(s => s.unit === unit && s.date === date && s.shift === shift) ?? null;

  return { provisioned: true as const, hasRoster: true as const, weekStart, days, units, shifts, counts, cell, roster: { status: roster.status, version: roster.version } };
}

// ── Store-backed views (migration 082) ───────────────────────────────────────
// Rule → exception catalogue category + recommended resolution + persisted-severity (§14).
const EXC_MAP: Record<string, { category: string; resolution: string }> = {
  "Minimum staffing ratios": { category: "coverage", resolution: "Add staff / request cross-unit cover" },
  "Mandatory Shift Supervisor coverage": { category: "supervisor", resolution: "Assign eligible supervisor or acting cover" },
  "Mandatory competencies": { category: "competency", resolution: "Reassign to validated staff or add supervision" },
  "Maximum weekly hours (48h / 4 shifts)": { category: "working_time", resolution: "Redistribute shifts / approve overtime" },
  "Minimum rest between shifts": { category: "working_time", resolution: "Space assignments to restore rest" },
  "Rotation & workload fairness": { category: "fairness", resolution: "Rebalance shift distribution" },
};
const SEV_LC: Record<string, string> = { Critical: "critical", High: "high", Medium: "moderate", Low: "low" };

// Exceptions & Resolutions (§14) — derived (raise-able) constraint exceptions + the persisted,
// stateful op_roster_exceptions register for the current roster.
export async function loadRosterExceptionsView(admin: any, hid: string | null, isSuper: boolean) {
  const con = await loadConstraintEngine(admin, hid, isSuper) as any;
  if (!con.provisioned) return { provisioned: false as const };
  if (!con.hasRoster) return { provisioned: true as const, hasRoster: false as const };
  const rosterId = con.roster.id;
  const derived = (con.rules ?? []).filter((r: any) => r.count > 0).map((r: any) => ({ rule: r.rule, count: r.count, severity: SEV_LC[r.severity] ?? "moderate", ...(EXC_MAP[r.rule] ?? { category: "conflict", resolution: "Review" }) }));

  let persisted: any[] = [];
  try {
    const q = admin.from("op_roster_exceptions").select("id, category, severity, status, description, staff_name, unit_name, override_reason, resolved_at, created_at").eq("roster_id", rosterId).order("created_at", { ascending: false }).limit(80);
    const { data } = await (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
    persisted = data ?? [];
  } catch { /* store not provisioned */ }
  const openPersisted = persisted.filter((e: any) => !["resolved", "rejected", "expired", "superseded"].includes(e.status));

  return { provisioned: true as const, hasRoster: true as const, rosterId, derived, persisted, openPersisted, kpis: { critical: con.kpis?.critical ?? 0, overrideRequests: con.kpis?.overrideRequests ?? 0 }, recentOverrides: con.recentOverrides ?? [] };
}

// Amendments, Swaps & Replacements (§16) — the op_roster_amendments register for the current
// roster. Post-publication changes preserve the originally published roster (BR-EXA-006/010).
export async function loadRosterAmendmentsView(admin: any, hid: string | null, isSuper: boolean) {
  const rw = await loadRosterForWeek(admin, hid, isSuper, mondayOf());
  if (!(rw as any).provisioned) return { provisioned: false as const };
  const roster = (rw as any).roster;
  if (!roster) return { provisioned: true as const, hasRoster: false as const };
  let amendments: any[] = [];
  try {
    const q = admin.from("op_roster_amendments").select("id, amendment_type, reason, affected_unit, affected_shift_date, from_staff_name, to_staff_name, approval_status, emergency, requested_by_name, requested_at").eq("roster_id", roster.id).order("requested_at", { ascending: false }).limit(60);
    const { data } = await (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
    amendments = data ?? [];
  } catch { /* store not provisioned */ }
  const open = amendments.filter((a: any) => !["applied", "rejected", "cancelled"].includes(a.approval_status));
  const appliedCount = amendments.filter((a: any) => a.approval_status === "applied").length;
  return { provisioned: true as const, hasRoster: true as const, rosterId: roster.id, rosterStatus: roster.status, amendments, open, appliedCount };
}

// Planned vs Actual (§17) — the op_roster_actuals confirmations vs planned assignments.
export async function loadPlannedVsActualView(admin: any, hid: string | null, isSuper: boolean) {
  const rw = await loadRosterForWeek(admin, hid, isSuper, mondayOf());
  if (!(rw as any).provisioned) return { provisioned: false as const };
  const roster = (rw as any).roster;
  if (!roster) return { provisioned: true as const, hasRoster: false as const };
  const asg: any[] = ((rw as any).assignments ?? []).filter((a: any) => a.status === "assigned");
  let actuals: any[] = [];
  try {
    const q = admin.from("op_roster_actuals").select("id, unit_name, shift_date, shift_type, staff_name, attendance_status, variance_reason, actual_hours, confirmed_by_name, created_at").eq("roster_id", roster.id).order("created_at", { ascending: false }).limit(200);
    const { data } = await (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
    actuals = data ?? [];
  } catch { /* store not provisioned */ }
  const attended = actuals.filter((a: any) => a.attendance_status === "attended").length;
  const variances = actuals.filter((a: any) => !["attended"].includes(a.attendance_status));
  const plannedPosts = asg.length;
  const confirmed = actuals.length;
  return { provisioned: true as const, hasRoster: true as const, rosterId: roster.id, plannedPosts, confirmed, attended, variances, actuals, planned: asg.map((a: any) => ({ id: a.id, unit: a.unit_name, date: a.shift_date, shift: a.shift_type, staff: a.staff_name, role: a.role })) };
}

// Approval & Publication (§15) — the op_roster_approvals chain + op_roster_publications record +
// op_roster_acknowledgements summary for the current roster.
export async function loadApprovalStores(admin: any, hid: string | null, isSuper: boolean) {
  const rw = await loadRosterForWeek(admin, hid, isSuper, mondayOf());
  if (!(rw as any).provisioned) return { provisioned: false as const };
  const roster = (rw as any).roster;
  if (!roster) return { provisioned: true as const, hasRoster: false as const };
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  let approvals: any[] = [], publications: any[] = [];
  let ackSummary = { notified: 0, acknowledged: 0, concerns: 0 };
  try { const { data } = await scope(admin.from("op_roster_approvals").select("id, stage_order, approval_stage, approver_role, approver_name, status, decision, comments, acted_at").eq("roster_id", roster.id).order("stage_order")); approvals = data ?? []; } catch { /* store absent */ }
  try { const { data } = await scope(admin.from("op_roster_publications").select("id, publication_status, published_at, published_by_name, recipient_count, version, created_at").eq("roster_id", roster.id).order("created_at", { ascending: false })); publications = data ?? []; } catch { /* store absent */ }
  const latestPublication = publications[0] ?? null;
  if (latestPublication) { try { const { data } = await admin.from("op_roster_acknowledgements").select("acknowledged_at, concern_raised").eq("roster_publication_id", latestPublication.id); ackSummary = { notified: (data ?? []).length, acknowledged: (data ?? []).filter((a: any) => a.acknowledged_at).length, concerns: (data ?? []).filter((a: any) => a.concern_raised).length }; } catch { /* store absent */ } }
  const submitted = approvals.length > 0;
  const allApproved = submitted && approvals.every((a: any) => ["approved", "approved_with_conditions"].includes(a.status));
  return { provisioned: true as const, hasRoster: true as const, rosterId: roster.id, rosterStatus: roster.status, approvals, submitted, allApproved, publications, latestPublication, ackSummary };
}
