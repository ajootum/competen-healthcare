// Persisted shift metrics (SSW-002 §19). computeShiftMetrics derives the KPIs from
// an already-loaded shift-command aggregate (+ two count queries) so the engine
// page doesn't re-load; the API persists them and loadShiftMetricsData reads the
// persisted row + a cross-shift trend. Fail-soft before migration 068 runs; the
// LIVE metrics are always available even when the table is absent.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));

export const METRIC_DEFS: { key: string; label: string; unit: "pct" | "num" | "ratio" }[] = [
  { key: "overall_score", label: "Overall score", unit: "pct" },
  { key: "bed_occupancy_pct", label: "Bed occupancy", unit: "pct" },
  { key: "skill_mix_compliance_pct", label: "Skill-mix compliance", unit: "pct" },
  { key: "observation_compliance_pct", label: "Obs compliance", unit: "pct" },
  { key: "task_completion_pct", label: "Task completion", unit: "pct" },
  { key: "high_acuity_count", label: "High acuity", unit: "num" },
  { key: "incident_count", label: "Incidents", unit: "num" },
  { key: "open_escalations", label: "Escalations", unit: "num" },
];

// sc = a resolved loadShiftCommand() result. Returns the derived KPI set.
export async function computeShiftMetrics(admin: any, sc: any, hid: string | null, isSuper: boolean) {
  if (!sc?.ready || !sc.shiftId) return { ready: false as const };
  const o = sc.overview;
  const taskScope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const [obsR, obsP, tTot, tDone] = await Promise.all([
    admin.from("op_observations").select("id", { count: "exact", head: true }).eq("shift_id", sc.shiftId).eq("status", "recorded"),
    admin.from("op_observations").select("id", { count: "exact", head: true }).eq("shift_id", sc.shiftId).in("status", ["due", "overdue"]),
    taskScope(admin.from("op_tasks").select("id", { count: "exact", head: true })).neq("status", "cancelled"),
    taskScope(admin.from("op_tasks").select("id", { count: "exact", head: true })).in("status", ["completed", "verified"]),
  ]);
  const cnt = (r: any) => (r?.error ? null : (r?.count ?? 0));
  const rec = cnt(obsR), pend = cnt(obsP);
  const obsPct = (rec != null && pend != null && rec + pend > 0) ? Math.round((rec / (rec + pend)) * 100) : null;
  const tot = cnt(tTot), done = cnt(tDone);
  const taskPct = (tot != null && tot > 0) ? Math.round(((done ?? 0) / tot) * 100) : null;

  const kpis: Record<string, number | null> = {
    bed_occupancy_pct: o.occPct ?? null,
    staffing_present: o.present, staffing_rostered: o.rostered,
    skill_mix_compliance_pct: sc.ratioCompliance ?? null,
    observation_compliance_pct: obsPct,
    task_completion_pct: taskPct,
    high_acuity_count: o.critical, incident_count: o.incidents, open_escalations: o.escalations,
    admissions: o.admissionsPending, transfers: o.transfers, discharges: o.discharges,
    overall_score: null,
  };
  const parts = [kpis.skill_mix_compliance_pct, kpis.observation_compliance_pct, kpis.task_completion_pct].filter((v): v is number => v != null);
  kpis.overall_score = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
  return { ready: true as const, shiftId: sc.shiftId, kpis };
}

// Persisted row for this shift + a cross-shift trend (last 10) for the hospital.
export async function loadShiftMetricsData(admin: any, shiftId: string | null, hid: string | null, isSuper: boolean) {
  const persistedRes = shiftId
    ? await admin.from("shift_metrics").select("*").eq("shift_id", shiftId).maybeSingle()
    : { data: null, error: null };
  if (persistedRes.error && missing(persistedRes.error)) return { provisioned: false as const };

  const trendQ = admin.from("shift_metrics").select("shift_id, overall_score, task_completion_pct, observation_compliance_pct, bed_occupancy_pct, computed_at");
  const scopedTrend = isSuper ? trendQ : trendQ.eq("hospital_id", hid ?? NONE);
  const trendRes = await scopedTrend.order("computed_at", { ascending: false }).limit(10);

  return {
    provisioned: true as const,
    persisted: persistedRes.error ? null : (persistedRes.data ?? null),
    trend: trendRes.error ? [] : (trendRes.data ?? []).slice().reverse(), // chronological
  };
}
