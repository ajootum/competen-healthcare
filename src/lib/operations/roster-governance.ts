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
