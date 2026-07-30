// Shift Summary loader (HWW-WARD-001 S4.12) — the nurse's shift in numbers:
// what I personally did this shift (observations recorded, medications
// administered, tasks completed, assessments, concerns, escalations), my
// current shift context, the shift's computed quality metrics when present,
// and handover readiness. All real rows; my-authored counts scoped by actor.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadMyShift } from "@/lib/hww/my-shift";

export async function loadMyShiftSummary(admin: any, userId: string, now = Date.now()) {
  const base = await loadMyShift(admin, userId);
  const shift = base.shift;
  // The reporting window: the shift's span when deployed, else the last 12h.
  const since = shift?.starts_at ?? new Date(now - 12 * 3.6e6).toISOString();

  const soft = (p: any) => p.then((r: any) => r, () => ({ count: 0, data: [] }));
  const cnt = (r: any) => (r?.error ? 0 : r?.count ?? 0);

  const [obsRes, medRes, taskRes, acuityRes, workloadRes, concernRes, escRes, incRes, metricsRes] = await Promise.all([
    soft(admin.from("op_observations").select("id", { count: "exact", head: true }).eq("observer_id", userId).gte("recorded_at", since)),
    soft(admin.from("op_med_administrations").select("outcome").eq("administered_by", userId).gte("administered_at", since).limit(200)),
    soft(admin.from("op_tasks").select("id", { count: "exact", head: true }).eq("completed_by", userId).gte("completed_at", since)),
    soft(admin.from("op_acuity_assessments").select("id, significant_change").eq("assessed_by", userId).gte("assessed_at", since).limit(100)),
    soft(admin.from("op_workload_assessments").select("id", { count: "exact", head: true }).eq("assessed_by", userId).gte("assessed_at", since)),
    soft(admin.from("op_concerns").select("id, status").eq("raised_by", userId).gte("raised_at", since).limit(100)),
    soft(admin.from("op_escalations").select("id", { count: "exact", head: true }).eq("raised_by", userId).gte("created_at", since)),
    soft(admin.from("op_incidents").select("id", { count: "exact", head: true }).eq("reported_by", userId).gte("created_at", since)),
    shift?.id
      ? soft(admin.from("shift_metrics").select("*").eq("shift_id", shift.id).order("computed_at", { ascending: false }).limit(1))
      : Promise.resolve({ data: [] }),
  ]);

  const medEvents = (medRes.data ?? []) as any[];
  const acuityRows = (acuityRes.data ?? []) as any[];
  const concernRows = (concernRes.data ?? []) as any[];

  // Handover readiness: SBAR prepared for how many of my patients?
  let sbarReady = 0;
  const mine = base.patients.map((a: any) => a.op_patients.id);
  if (mine.length) {
    const { data: ho } = await admin.from("op_handovers").select("id").neq("status", "accepted").order("created_at", { ascending: false }).limit(1);
    if (ho?.[0]) {
      const { data: items } = await admin.from("op_handover_items").select("patient_id, sbar_situation, sbar_background, sbar_assessment, sbar_recommendation")
        .eq("handover_id", ho[0].id).in("patient_id", mine).limit(100);
      sbarReady = ((items ?? []) as any[]).filter(i => i.sbar_situation || i.sbar_background || i.sbar_assessment || i.sbar_recommendation).length;
    }
  }

  return {
    shift,
    patients: base.patients,
    tasksOpen: base.tasks.length,
    since,
    my: {
      observations: cnt(obsRes),
      medsAdministered: medEvents.filter(e => e.outcome === "administered").length,
      medsDelayedOmitted: medEvents.filter(e => e.outcome !== "administered").length,
      tasksCompleted: cnt(taskRes),
      acuityAssessments: acuityRows.length,
      significantChanges: acuityRows.filter(r => r.significant_change).length,
      workloadAssessments: cnt(workloadRes),
      concernsRaised: concernRows.length,
      concernsResolved: concernRows.filter(r => r.status === "resolved").length,
      escalationsRaised: cnt(escRes),
      incidentsReported: cnt(incRes),
    },
    sbarReady,
    shiftMetrics: (metricsRes.data ?? [])[0] ?? null,
  };
}
