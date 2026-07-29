// Validation Queue (CMO-005) — the evidence/competency validation command centre over the governed
// validation object (competency_decisions: validation_outcome / validated_by / validated_at). Real:
// the §3 dashboard widgets (pending validation, near-SLA, rejected, approved-today), the named pending
// queue and recent validation history. The approve/reject workflow itself lives in the educator/UMW
// validation surfaces (cross-linked). Honest next-phase: committee review, appeals, AI evidence-quality
// scoring and configurable SLA — each needs its own store. Tenant-scoped; fail-soft; no fabrication.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const SLA_DAYS = 7;
const tc = (s: string | null) => (s ?? "").replace(/_/g, " ").split(" ").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
const ageDays = (iso: string) => Math.round((Date.now() - new Date(iso).getTime()) / 86400000);

// COMP-022 Evidence Confidence — a transparent score (0–100) computed from real signals on the governed
// decision: authenticity (verification status), attainment (outcome), currency (recency) and maturity, with
// a critical-failure integrity penalty. Not a persisted per-evidence score (that would be a next-phase column)
// — computed on read so the Validation dashboard's confidence metric is real, explainable and never fabricated.
const MRANK: Record<string, number> = { expert: 15, proficient: 13, competent: 11, advanced_beginner: 8, novice: 5, embedded: 15, established: 12, developing: 8, emerging: 5 };
function confidenceOf(d: any): number {
  let c = d.validated_at ? 35 : d.validation_outcome === "validated" ? 30 : d.validation_outcome === "rejected" ? 8 : 16; // authenticity
  const o = String(d.outcome ?? "");
  c += /^competent$/.test(o) ? 30 : /conditions|provisional/.test(o) ? 18 : /remediation|not_yet/.test(o) ? 6 : 12;        // attainment
  const age = d.created_at ? ageDays(d.created_at) : 999;
  c += age <= 90 ? 20 : age <= 365 ? 12 : 5;                                                                                // currency
  c += MRANK[d.maturity] ?? (d.maturity ? 8 : 5);                                                                           // maturity
  if (d.critical_failure) c -= 25;                                                                                          // integrity penalty
  return Math.max(0, Math.min(100, Math.round(c)));
}

export async function loadValidationQueue(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const T = new Date().toISOString().slice(0, 10);

  let provisioned = true;
  let decs: any[] = [];
  try {
    const { data, error } = await scope(admin.from("competency_decisions")
      .select("id, nurse_id, competency_id, outcome, maturity, validation_outcome, validated_at, created_at, critical_failure, profiles!nurse_id(full_name, role)")
      .order("created_at", { ascending: false }).limit(4000));
    if (error) throw error;
    decs = data ?? [];
  } catch { provisioned = false; decs = []; }

  // Competency names for the queue rows.
  const compIds = [...new Set(decs.map(d => d.competency_id).filter(Boolean))].slice(0, 3000);
  const compName = new Map<string, string>();
  if (compIds.length) { try { const { data } = await admin.from("framework_competencies").select("id, name").in("id", compIds).limit(5000); (data ?? []).forEach((c: any) => compName.set(c.id, c.name)); } catch { /* fail-soft */ } }

  const pending = decs.filter(d => !d.validated_at && d.validation_outcome !== "rejected");
  const rejected = decs.filter(d => d.validation_outcome === "rejected");
  const approved = decs.filter(d => d.validation_outcome === "validated" && d.validated_at);
  const nearSla = pending.filter(d => d.created_at && ageDays(d.created_at) >= SLA_DAYS);
  const approvedToday = approved.filter(d => (d.validated_at ?? "").slice(0, 10) === T).length;

  const row = (d: any) => ({ id: d.id, name: d.profiles?.full_name ?? "—", role: (d.profiles?.role ?? "").replace(/_/g, " "), competency: compName.get(d.competency_id) ?? "Competency", outcome: d.outcome ? tc(d.outcome) : "—", age: d.created_at ? ageDays(d.created_at) : null, confidence: confidenceOf(d) });

  const pendingList = pending
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "")) // oldest first
    .slice(0, 10).map(d => ({ ...row(d), overdue: !!(d.created_at && ageDays(d.created_at) >= SLA_DAYS) }));

  const history = decs
    .filter(d => d.validated_at || d.validation_outcome === "rejected")
    .sort((a, b) => (b.validated_at ?? b.created_at ?? "").localeCompare(a.validated_at ?? a.created_at ?? ""))
    .slice(0, 10)
    .map(d => ({ ...row(d), decision: d.validation_outcome === "validated" ? "Validated" : d.validation_outcome === "rejected" ? "Rejected" : tc(d.validation_outcome) || "Decided", at: d.validated_at }));

  // COMP-022 Evidence Confidence — mean over all decisions + distribution bands + confidence of the pending queue.
  const confs = decs.map(confidenceOf);
  const avgConfidence = confs.length ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length) : null;
  const pendingConfs = pending.map(confidenceOf);
  const pendingAvgConfidence = pendingConfs.length ? Math.round(pendingConfs.reduce((a, b) => a + b, 0) / pendingConfs.length) : null;
  const confidenceBands = { high: confs.filter(c => c >= 80).length, moderate: confs.filter(c => c >= 60 && c < 80).length, low: confs.filter(c => c < 60).length };
  const lowConfidencePending = pending.filter(d => confidenceOf(d) < 60).length;

  const kpis = {
    pending: pending.length,
    nearSla: nearSla.length,
    rejected: rejected.length,
    approvedToday,
    total: decs.length,
    avgConfidence,
    pendingAvgConfidence,
  };

  // Rule-based explainable AI insights (recommendation only).
  const ai: { text: string; why: string; priority: "high" | "medium" | "low" }[] = [];
  if (nearSla.length) ai.push({ text: `${nearSla.length} case(s) past the ${SLA_DAYS}-day SLA — prioritise or escalate`, why: `Awaiting > ${SLA_DAYS} days`, priority: "high" });
  const critPending = pending.filter(d => d.critical_failure).length;
  if (critPending) ai.push({ text: `${critPending} pending case(s) flagged critical failure`, why: "Critical failures gate deployment", priority: "high" });
  if (pending.length) ai.push({ text: `Assign ${pending.length} pending validation(s) to reviewers`, why: "Approval recalculates readiness immediately (§5)", priority: "medium" });
  if (lowConfidencePending) ai.push({ text: `${lowConfidencePending} pending case(s) below 60% evidence confidence — request stronger or more recent evidence`, why: "Low authenticity / currency / attainment signal", priority: lowConfidencePending > pending.length / 2 ? "high" : "medium" });

  return { provisioned, ready: provisioned, kpis, pendingList, history, ai, confidenceBands, lowConfidencePending };
}
