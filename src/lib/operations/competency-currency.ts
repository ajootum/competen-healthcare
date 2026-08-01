// Is this clinician's competency record CURRENT? (XWI P2-2)
//
// THE BUG THIS REPLACES. The patient-assignment gate asked the database for decisions whose outcome is
// passing, and validated the clinician if any of them had not expired:
//
//     .eq("nurse_id", staffId).in("outcome", PASSING)     // <- never sees a revocation
//
// competency_decisions is VERSIONED. A nurse found competent in version 1 and later suspended,
// not-yet-competent or requiring remediation in version 2 still has the version 1 row sitting in the
// table, and a query filtered to passing outcomes cannot see the row that overrode it. So the gate
// returned validated = true for a clinician whose competency had been withdrawn, stored that as
// `competency_validated: true` on the assignment, and never asked for the override the rule exists to
// force. The revocation was invisible precisely because it was a revocation.
//
// The rule is LATEST-PER-COMPETENCY, then judge. Migration 024 shipped a `latest_decisions` view for this
// and nothing ever used it; doing the same reduction here keeps it in one tested place and works whether
// or not that view is deployed -- this database has had four migrations silently fail to land.
//
// Superseding order: version_num, then effective_date, then created_at. Rows with no competency_id cannot
// supersede anything, so each stands alone.

export type DecisionRow = {
  competency_id?: string | null;
  outcome?: string | null;
  expiry_date?: string | null;
  critical_failure?: boolean | null;
  version_num?: number | null;
  effective_date?: string | null;
  created_at?: string | null;
  id?: string | null;
};

export const PASSING_OUTCOMES = ["competent", "competent_with_conditions", "provisionally_competent"];
export const UNRESOLVED_OUTCOMES = ["requires_remediation", "not_yet_competent", "expired", "suspended"];

/** The columns the reduction needs. Selecting fewer silently reintroduces the bug. */
export const DECISION_COLUMNS = "id, competency_id, outcome, expiry_date, critical_failure, version_num, effective_date, created_at";

const rank = (d: DecisionRow): [number, string, string] => [
  d.version_num ?? 0,
  d.effective_date ?? "",
  d.created_at ?? "",
];

/** One decision per competency: the one that currently applies. */
export function latestPerCompetency(rows: DecisionRow[]): DecisionRow[] {
  const best = new Map<string, DecisionRow>();
  for (const d of rows) {
    // No competency_id means nothing to supersede or be superseded by.
    const key = d.competency_id ?? `__row:${d.id ?? Math.random()}`;
    const cur = best.get(key);
    if (!cur) { best.set(key, d); continue; }
    const [av, ad, ac] = rank(d), [bv, bd, bc] = rank(cur);
    if (av > bv || (av === bv && (ad > bd || (ad === bd && ac > bc)))) best.set(key, d);
  }
  return [...best.values()];
}

export type CompetencyCurrency = {
  /** at least one CURRENT competency that is passing and unexpired, and no unresolved critical failure */
  validated: boolean;
  currentPassing: number;
  expired: number;
  criticalFailures: number;
  /** passing rows that a later decision overrode -- the ones the old gate counted */
  supersededPassing: number;
};

export function assessCompetencyCurrency(rows: DecisionRow[], today = new Date().toISOString().slice(0, 10)): CompetencyCurrency {
  const latest = latestPerCompetency(rows);
  const isPassing = (d: DecisionRow) => PASSING_OUTCOMES.includes(String(d.outcome));
  const unexpired = (d: DecisionRow) => !d.expiry_date || d.expiry_date >= today;

  const currentPassing = latest.filter(d => isPassing(d) && unexpired(d)).length;
  const expired = latest.filter(d => isPassing(d) && !unexpired(d)).length;
  // Aligned with COMP-027's checkDeploymentReadiness: an unresolved critical failure is disqualifying.
  // The two gates guarding the same clinician disagreeing about whether they may work is worse than
  // either rule on its own.
  const criticalFailures = latest.filter(d => d.critical_failure && UNRESOLVED_OUTCOMES.includes(String(d.outcome))).length;

  const latestIds = new Set(latest.map(d => d.id));
  const supersededPassing = rows.filter(d => !latestIds.has(d.id) && isPassing(d)).length;

  return { validated: currentPassing > 0 && criticalFailures === 0, currentPassing, expired, criticalFailures, supersededPassing };
}
