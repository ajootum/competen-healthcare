// COMP-027 Competency-to-Workforce readiness gate. Before a worker is deployed onto a shift, check their
// competency readiness against the governed record: expired competencies raise a WARNING (advisory), and an
// unresolved CRITICAL competency failure BLOCKS deployment unless a supervisor applies a governed override.
// Real over competency_decisions — no fabrication. A per-role "which competencies are critical for this shift"
// config (staffing rules) is the next-phase refinement; today criticality = the decision's critical_failure flag.
/* eslint-disable @typescript-eslint/no-explicit-any */

const nameOf = (row: any) => { const fc = row?.framework_competencies; return (Array.isArray(fc) ? fc[0]?.name : fc?.name) ?? null; };

/** The answer when the governed record could not be read. Counts stay 0 — reporting failures we never saw
 *  would be its own fabrication — so `unavailable` is the only thing that distinguishes this from a clean pass. */
const unverifiable = (detail: string): DeploymentReadiness => ({
  blocked: true,
  unavailable: true,
  reason: "This worker's competency record could not be read, so readiness is unknown — deploying now requires a governed override and will be recorded as unverified.",
  warning: detail.slice(0, 200),
  expiredCount: 0,
  criticalFailures: 0,
  expiredCompetencies: [],
  criticalCompetencies: [],
});

export type DeploymentReadiness = {
  blocked: boolean;
  /**
   * ⚠ THE GOVERNED RECORD COULD NOT BE READ. Distinct from `blocked`, which means the record was read and
   * disqualifies the worker. `blocked` is set true alongside it deliberately — see below.
   */
  unavailable: boolean;
  reason: string | null;
  warning: string | null;
  expiredCount: number;
  criticalFailures: number;
  expiredCompetencies: string[];
  criticalCompetencies: string[];
};

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THIS IS A GATE, NOT A DISPLAY, AND IT USED TO OPEN WHEN IT COULD NOT SEE.
//
// The read discarded its error, so a failed query produced `decs = []`, therefore no critical failures,
// therefore `blocked: false` and `reason: null` — the function answered "this worker is cleared" for a
// record it never read. shift-staff/route.ts skips its 409 on exactly that boolean, so the worker was
// assigned; and because `readiness.blocked` was false, the audit row was written as a clean `deploy_staff`
// with `readiness_override: undefined`. A deployment that was NEVER CHECKED was indistinguishable, forever
// after, from one that PASSED. That is the part with no recovery.
//
// WHY `blocked` IS ALSO SET TRUE when the check is unavailable, rather than adding a flag beside a false:
// every existing consumer reads `blocked`, so anything that has not been taught about `unavailable` gets the
// safe answer automatically. assignment-engine's `!!r.blocked` stops treating an unverified nurse as
// assignable without needing to know why.
//
// AND WHY THIS DOES NOT STRAND A SHIFT. The route's response to `blocked` is a 409 that says an override is
// required, not a refusal — so a supervisor with patients to cover can still deploy, deliberately, and the
// override is recorded. Refusing outright would leave beds uncovered, which is the failure mode
// [[safest-option-on-conflict]] warns about: the safest branch is not the most restrictive one.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
export async function checkDeploymentReadiness(admin: any, staffId: string): Promise<DeploymentReadiness> {
  const today = new Date().toISOString().slice(0, 10);
  let decs: any[] = [];
  try {
    const { data, error } = await admin.from("competency_decisions").select("outcome, expiry_date, critical_failure, framework_competencies(name)").eq("nurse_id", staffId).limit(3000);
    if (error) return unverifiable(error.message);
    decs = data ?? [];
  } catch (e: any) {
    return unverifiable(String(e?.message ?? e));
  }

  const expired = decs.filter(d => d.outcome === "expired" || (d.outcome === "competent" && d.expiry_date && d.expiry_date < today));
  const criticalFailures = decs.filter(d => d.critical_failure && ["requires_remediation", "not_yet_competent", "expired"].includes(String(d.outcome)));
  const blocked = criticalFailures.length > 0;

  return {
    blocked,
    unavailable: false,
    reason: blocked ? `Worker has ${criticalFailures.length} unresolved critical competency failure${criticalFailures.length === 1 ? "" : "s"} — deployment requires a governed override.` : null,
    warning: expired.length > 0 ? `${expired.length} expired competenc${expired.length === 1 ? "y" : "ies"} — verify currency before deploying to a role that requires them.` : null,
    expiredCount: expired.length,
    criticalFailures: criticalFailures.length,
    expiredCompetencies: [...new Set(expired.map(nameOf).filter(Boolean))].slice(0, 5) as string[],
    criticalCompetencies: [...new Set(criticalFailures.map(nameOf).filter(Boolean))].slice(0, 5) as string[],
  };
}
