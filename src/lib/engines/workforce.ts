import { createAdminClient } from "@/lib/supabase/server";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";

type Admin = ReturnType<typeof createAdminClient>;

export type HeatCell = { readiness: number; total: number; passing: number };
export type ForecastRow = { id: string; name: string; d30: number; d60: number; d90: number };
export type WorkforceReport = {
  departments: { id: string; name: string }[];
  frameworks: { id: string; name: string }[];
  heat: Record<string, Record<string, HeatCell>>; // deptId -> frameworkId -> cell
  risk: {
    expired: number;
    dueSoon: number;         // expiring within 60 days
    criticalFailures: number;
    notYetCompetent: number;
    remediation: number;
  };
  deptReadiness: { id: string; name: string; readiness: number; workers: number }[];
  // Book III Ch.10 (predictive-lite): reassessment demand forecast by window
  forecast: { d30: number; d60: number; d90: number; byDept: ForecastRow[] };
  totalDecisions: number;
};

/**
 * Book I Ch.14 — Workforce Intelligence.
 * Builds a department × framework readiness heat map plus risk indicators
 * from the formal competency_decisions produced by the Decision Engine.
 */
export async function workforceReport(admin: Admin, hospitalId: string): Promise<WorkforceReport> {
  const [{ data: depts }, { data: workers }, { data: frameworks }] = await Promise.all([
    admin.from("departments").select("id, name").eq("hospital_id", hospitalId).order("name"),
    admin.from("profiles").select("id, department_id").eq("hospital_id", hospitalId).eq("role", "nurse"),
    admin.from("frameworks").select("id, name").eq("is_active", true).order("name"),
  ]);

  const deptById = new Map((depts ?? []).map(d => [d.id, d.name]));
  const workerDept = new Map((workers ?? []).map(w => [w.id, w.department_id as string | null]));
  const workerIds = (workers ?? []).map(w => w.id);

  // Latest decision per (nurse, competency)
  const { data: decisions } = workerIds.length
    ? await admin.from("competency_decisions")
        .select("nurse_id, competency_id, framework_id, outcome, expiry_date, critical_failure, created_at")
        .in("nurse_id", workerIds)
        .order("created_at", { ascending: false })
    : { data: [] as {
        nurse_id: string; competency_id: string; framework_id: string | null;
        outcome: string; expiry_date: string | null; critical_failure: boolean; created_at: string;
      }[] };

  const seen = new Set<string>();
  const latest = (decisions ?? []).filter(d => {
    const k = `${d.nurse_id}:${d.competency_id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const heat: Record<string, Record<string, HeatCell>> = {};
  const risk = { expired: 0, dueSoon: 0, criticalFailures: 0, notYetCompetent: 0, remediation: 0 };
  const deptAgg = new Map<string, { passing: number; total: number; workers: Set<string> }>();
  const forecastAgg = new Map<string, { d30: number; d60: number; d90: number }>();
  const forecastTotal = { d30: 0, d60: 0, d90: 0 };

  for (const d of latest) {
    const deptId = workerDept.get(d.nurse_id) ?? "__none__";
    const fwId = d.framework_id ?? "__none__";
    const passing = OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing ?? false;

    heat[deptId] ??= {};
    heat[deptId][fwId] ??= { readiness: 0, total: 0, passing: 0 };
    heat[deptId][fwId].total++;
    if (passing) heat[deptId][fwId].passing++;

    const agg = deptAgg.get(deptId) ?? { passing: 0, total: 0, workers: new Set<string>() };
    agg.total++; if (passing) agg.passing++; agg.workers.add(d.nurse_id);
    deptAgg.set(deptId, agg);

    // Risk indicators
    if (d.critical_failure) risk.criticalFailures++;
    if (d.outcome === "not_yet_competent") risk.notYetCompetent++;
    if (d.outcome === "requires_remediation") risk.remediation++;
    if (d.expiry_date) {
      const days = (new Date(d.expiry_date).getTime() - Date.now()) / 86400000;
      if (days < 0) risk.expired++;
      else if (days <= 60) risk.dueSoon++;

      // Forecast buckets: ≤30d, 31–60d, 61–90d (reassessment demand planning)
      if (days >= 0 && days <= 90) {
        const fa = forecastAgg.get(deptId) ?? { d30: 0, d60: 0, d90: 0 };
        if (days <= 30) { fa.d30++; forecastTotal.d30++; }
        else if (days <= 60) { fa.d60++; forecastTotal.d60++; }
        else { fa.d90++; forecastTotal.d90++; }
        forecastAgg.set(deptId, fa);
      }
    }
  }

  // Finalise heat readiness %
  for (const deptId of Object.keys(heat))
    for (const fwId of Object.keys(heat[deptId])) {
      const c = heat[deptId][fwId];
      c.readiness = c.total ? Math.round((c.passing / c.total) * 100) : 0;
    }

  const deptReadiness = [...deptAgg.entries()].map(([id, agg]) => ({
    id,
    name: id === "__none__" ? "Unassigned" : (deptById.get(id) ?? id),
    readiness: agg.total ? Math.round((agg.passing / agg.total) * 100) : 0,
    workers: agg.workers.size,
  })).sort((a, b) => b.readiness - a.readiness);

  const byDept: ForecastRow[] = [...forecastAgg.entries()]
    .map(([id, f]) => ({
      id,
      name: id === "__none__" ? "Unassigned" : (deptById.get(id) ?? id),
      ...f,
    }))
    .sort((a, b) => (b.d30 + b.d60 + b.d90) - (a.d30 + a.d60 + a.d90));

  return {
    departments: (depts ?? []).map(d => ({ id: d.id, name: d.name })),
    frameworks: (frameworks ?? []).map(f => ({ id: f.id, name: f.name })),
    heat,
    risk,
    deptReadiness,
    forecast: { ...forecastTotal, byDept },
    totalDecisions: latest.length,
  };
}
