import type { OwnEvidenceClass } from "./vocabulary";

// ── PROFESSIONAL PROGRESS ── pure, from the person's own record and nothing else ── COMPETEN-IND-007 ───
//
// ⚠ NO INVENTED TARGETS (the src/app/dashboard/cpd header rule). Hours are summed by year and shown as
// hours. There is no annual target, no registration-cycle requirement and no "on track" verdict, because
// no store holds a target for an Individual person and inventing one would be a claim about what their
// regulator requires.
//
// ⚠ NOT MEASURED IS A STATE, NOT A ZERO. Every ratio here is null when its denominator is empty, and the
// page renders null as "Not measured" with the reason. A plan with no goals is not 0% complete.

export type GoalLike = { id: string; need_id: string | null; status: string; target_date: string | null };
export type NeedLike = { id: string; title: string; status: string };
export type CpdLike = { id: string; goal_id: string | null; hours: number | string; activity_date: string; evidence_class: string };
export type EvidenceLike = { id: string; need_id: string | null; evidence_class: string };

export type PlanProgress = {
  total: number; planned: number; inProgress: number; done: number; dropped: number; overdue: number;
  /** done / (total - dropped), or null when nothing is left to count. */
  completion: number | null;
};

export function planProgress(goals: readonly GoalLike[], today: string): PlanProgress {
  const n = (s: string) => goals.filter(g => g.status === s).length;
  const done = n("done");
  const dropped = n("dropped");
  const counted = goals.length - dropped;
  return {
    total: goals.length, planned: n("planned"), inProgress: n("in_progress"), done, dropped,
    overdue: goals.filter(g => (g.status === "planned" || g.status === "in_progress") && !!g.target_date && g.target_date < today).length,
    completion: counted > 0 ? done / counted : null,
  };
}

export type CpdYear = { year: number; hours: number; entries: number; withDocument: number };

/** Hours by calendar year, newest first. Only years with at least one entry appear. */
export function cpdHoursByYear(entries: readonly CpdLike[]): CpdYear[] {
  const by = new Map<number, CpdYear>();
  for (const e of entries) {
    const year = Number(String(e.activity_date).slice(0, 4));
    if (!Number.isInteger(year)) continue;
    const y = by.get(year) ?? { year, hours: 0, entries: 0, withDocument: 0 };
    y.hours = Math.round((y.hours + Number(e.hours || 0)) * 10) / 10;
    y.entries++;
    if (e.evidence_class === "source_linked") y.withDocument++;
    by.set(year, y);
  }
  return [...by.values()].sort((a, b) => b.year - a.year);
}

export type NeedCoverage = { needId: string; title: string; status: string; goals: number; cpd: number; evidence: number; covered: boolean };

export type Coverage = {
  needs: NeedCoverage[];
  /** Needs with at least one CPD entry or evidence item behind them, of needs not closed. Null when none. */
  covered: number;
  counted: number;
  ratio: number | null;
  byClass: Record<OwnEvidenceClass, number>;
};

/**
 * Evidence coverage: for each development need, what stands behind it. A CPD entry counts toward a need
 * through the goal it is linked to. An evidence item counts through its own need link. A closed need is
 * listed but not counted -- the person set it aside.
 */
export function evidenceCoverage(
  needs: readonly NeedLike[], goals: readonly GoalLike[], cpd: readonly CpdLike[], evidence: readonly EvidenceLike[],
): Coverage {
  const goalNeed = new Map(goals.map(g => [g.id, g.need_id]));
  const rows: NeedCoverage[] = needs.map(need => {
    const goalCount = goals.filter(g => g.need_id === need.id).length;
    const cpdCount = cpd.filter(c => c.goal_id && goalNeed.get(c.goal_id) === need.id).length;
    const evCount = evidence.filter(e => e.need_id === need.id).length;
    return { needId: need.id, title: need.title, status: need.status, goals: goalCount, cpd: cpdCount, evidence: evCount, covered: cpdCount + evCount > 0 };
  });
  const counted = rows.filter(r => r.status !== "closed");
  const covered = counted.filter(r => r.covered).length;
  const byClass: Record<OwnEvidenceClass, number> = { self_declared: 0, source_linked: 0 };
  for (const item of [...cpd, ...evidence]) {
    if (item.evidence_class === "self_declared" || item.evidence_class === "source_linked") byClass[item.evidence_class]++;
  }
  return { needs: rows, covered, counted: counted.length, ratio: counted.length ? covered / counted.length : null, byClass };
}

export type GoalActivity = {
  goalId: string; status: string; targetDate: string | null; overdue: boolean;
  entries: number; hours: number; withDocument: number; lastActivity: string | null;
};

/**
 * Pure: for each goal that is not dropped, the CPD the person linked to it -- entries, hours, how many
 * carry a document, and the latest activity date. Self-directed: it needs no framework and no catalogue,
 * only the person's own goals and CPD. A goal with no CPD is 0 entries, which IS a count of the person's
 * rows (nothing linked yet), not a missing measurement. Open goals first, by target date.
 */
export function goalActivity(goals: readonly GoalLike[], cpd: readonly CpdLike[], today: string): GoalActivity[] {
  const open = (s: string) => s === "planned" || s === "in_progress";
  return goals.filter(g => g.status !== "dropped").map(g => {
    const mine = cpd.filter(c => c.goal_id === g.id);
    const hours = Math.round(mine.reduce((s, c) => s + Number(c.hours || 0), 0) * 100) / 100;
    const last = mine.map(c => c.activity_date).sort().at(-1) ?? null;
    return { goalId: g.id, status: g.status, targetDate: g.target_date, overdue: open(g.status) && !!g.target_date && g.target_date < today,
      entries: mine.length, hours, withDocument: mine.filter(c => c.evidence_class === "source_linked").length, lastActivity: last };
  }).sort((a, b) => Number(open(b.status)) - Number(open(a.status)) || (a.targetDate ?? "9999-12-31").localeCompare(b.targetDate ?? "9999-12-31"));
}
