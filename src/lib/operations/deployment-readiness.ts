// COMP-027 Competency-to-Workforce readiness gate. Before a worker is deployed onto a shift, check their
// competency readiness against the governed record: expired competencies raise a WARNING (advisory), and an
// unresolved CRITICAL competency failure BLOCKS deployment unless a supervisor applies a governed override.
// Real over competency_decisions — no fabrication. A per-role "which competencies are critical for this shift"
// config (staffing rules) is the next-phase refinement; today criticality = the decision's critical_failure flag.
/* eslint-disable @typescript-eslint/no-explicit-any */

const nameOf = (row: any) => { const fc = row?.framework_competencies; return (Array.isArray(fc) ? fc[0]?.name : fc?.name) ?? null; };

export type DeploymentReadiness = {
  blocked: boolean;
  reason: string | null;
  warning: string | null;
  expiredCount: number;
  criticalFailures: number;
  expiredCompetencies: string[];
  criticalCompetencies: string[];
};

export async function checkDeploymentReadiness(admin: any, staffId: string): Promise<DeploymentReadiness> {
  const today = new Date().toISOString().slice(0, 10);
  let decs: any[] = [];
  try {
    const { data } = await admin.from("competency_decisions").select("outcome, expiry_date, critical_failure, framework_competencies(name)").eq("nurse_id", staffId).limit(3000);
    decs = data ?? [];
  } catch { decs = []; }

  const expired = decs.filter(d => d.outcome === "expired" || (d.outcome === "competent" && d.expiry_date && d.expiry_date < today));
  const criticalFailures = decs.filter(d => d.critical_failure && ["requires_remediation", "not_yet_competent", "expired"].includes(String(d.outcome)));
  const blocked = criticalFailures.length > 0;

  return {
    blocked,
    reason: blocked ? `Worker has ${criticalFailures.length} unresolved critical competency failure${criticalFailures.length === 1 ? "" : "s"} — deployment requires a governed override.` : null,
    warning: expired.length > 0 ? `${expired.length} expired competenc${expired.length === 1 ? "y" : "ies"} — verify currency before deploying to a role that requires them.` : null,
    expiredCount: expired.length,
    criticalFailures: criticalFailures.length,
    expiredCompetencies: [...new Set(expired.map(nameOf).filter(Boolean))].slice(0, 5) as string[],
    criticalCompetencies: [...new Set(criticalFailures.map(nameOf).filter(Boolean))].slice(0, 5) as string[],
  };
}
