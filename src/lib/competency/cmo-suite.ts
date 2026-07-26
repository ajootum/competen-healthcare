// Competency Office expansion shared data layer (CMO-008..020). One fail-soft read of the new cmo_* stores
// (certifications / privileges / assignments / forecasts / plans / publications / accreditations / config / AI recs)
// PLUS reused competency_* stores (scores → gaps, decisions → review board, readiness_snapshots, cycle_frameworks →
// standards). Every CMO module is a lens over this. Read model; write workflows are the next phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const NONE = "00000000-0000-0000-0000-000000000000";
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
export const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const soft = (p: any) => p.then((r: any) => r, () => ({ data: [], error: null }));
export const daysLeft = (d: string | null) => (d ? Math.round((new Date(d).getTime() - Date.now()) / 86400000) : null);

export async function fetchCmoSuite(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const [certRes, privRes, asgRes, fcRes, planRes, pubRes, accrRes, cfgRes, aiRes,
    scoreRes, decRes, readyRes, fwRes] = await Promise.all([
    soft(scope(admin.from("cmo_certifications").select("*"))),
    soft(scope(admin.from("cmo_privileges").select("*"))),
    soft(scope(admin.from("cmo_assignments").select("*"))),
    soft(scope(admin.from("cmo_forecasts").select("*"))),
    soft(scope(admin.from("cmo_plans").select("*"))),
    soft(scope(admin.from("cmo_publications").select("*"))),
    soft(scope(admin.from("cmo_accreditations").select("*"))),
    soft(scope(admin.from("cmo_config").select("*"))),
    soft(scope(admin.from("cmo_ai_recommendations").select("*")).order("created_at", { ascending: false })),
    // Reused competency engine stores (cycle-scoped — fetched broadly, fail-soft).
    soft(admin.from("competency_scores").select("competency_id, framework_id, final_score, avg_score, level_label, assessor_count").limit(1000)),
    soft(admin.from("competency_decisions").select("outcome, competency_id, framework_id, cycle_id").limit(1000)),
    soft(scope(admin.from("competency_readiness_snapshots").select("*")).order("snapshot_date", { ascending: false }).limit(30)),
    soft(admin.from("cycle_frameworks").select("framework_id, status, framework_score").limit(200)),
  ]);
  const anyNew = !(certRes.error && missing(certRes.error)) || !(pubRes.error && missing(pubRes.error));

  const owners = new Set<string>();
  [certRes, privRes].forEach((r: any) => (r.data ?? []).forEach((row: any) => row.staff_id && owners.add(row.staff_id)));
  const profRes = owners.size ? await soft(admin.from("profiles").select("id, full_name").in("id", [...owners])) : { data: [] };
  const nameById = new Map<string, string>((profRes.data ?? []).map((p: any) => [p.id, p.full_name]));

  return {
    provisioned: anyNew,
    certifications: (certRes.data ?? []) as any[],
    privileges: (privRes.data ?? []) as any[],
    assignments: (asgRes.data ?? []) as any[],
    forecasts: (fcRes.data ?? []) as any[],
    plans: (planRes.data ?? []) as any[],
    publications: (pubRes.data ?? []) as any[],
    accreditations: (accrRes.data ?? []) as any[],
    config: (cfgRes.data ?? []) as any[],
    aiRecs: (aiRes.data ?? []) as any[],
    scores: (scoreRes.data ?? []) as any[],
    decisions: (decRes.data ?? []) as any[],
    readiness: (readyRes.data ?? []) as any[],
    frameworks: (fwRes.data ?? []) as any[],
    nameById,
  };
}

export const STATUS_TONE: Record<string, string> = { active: "emerald", expiring: "amber", expired: "rose", pending: "amber", suspended: "rose", under_review: "amber", assigned: "blue", in_progress: "blue", completed: "emerald", overdue: "rose", exempt: "slate", draft: "slate", in_review: "amber", approved: "emerald", published: "emerald", scheduled: "blue", rolled_back: "rose", compliant: "emerald", partial: "amber", gap: "rose", not_mapped: "slate", open: "amber", accepted: "emerald", dismissed: "slate", on_hold: "amber" };
export const RISK_TONE: Record<string, string> = { low: "slate", medium: "amber", high: "rose" };
