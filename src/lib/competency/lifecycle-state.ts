// COMP-017 Competency Lifecycle state machine — the persisted current state per worker×competency plus an
// immutable transition log (competency_lifecycle_state + lifecycle_events, migration 126). Unlike the inferred
// CMO-004 lifecycle view, this is a real record that transitions on events. transitionLifecycle() is fail-soft
// (no-ops until migration 126 is applied), so wiring it into write-paths never breaks the originating request.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";

// The 14-state lifecycle (COMP-017 §3), earliest → terminal.
export const LIFECYCLE_STATES = ["draft", "assigned", "accepted", "in_progress", "evidence_submitted", "awaiting_assessment", "under_review", "competent", "competent_conditions", "renewed", "remediation_required", "suspended", "expired", "archived"] as const;
export const STATE_LABEL: Record<string, string> = { draft: "Draft", assigned: "Assigned", accepted: "Accepted", in_progress: "In Progress", evidence_submitted: "Evidence Submitted", awaiting_assessment: "Awaiting Assessment", under_review: "Under Review", competent: "Competent", competent_conditions: "Competent (Conditions)", renewed: "Renewed", remediation_required: "Remediation Required", suspended: "Suspended", expired: "Expired", archived: "Archived" };
export const STATE_COLOR: Record<string, string> = { draft: "#cbd5e1", assigned: "#94a3b8", accepted: "#14b8a6", in_progress: "#0ea5e9", evidence_submitted: "#8b5cf6", awaiting_assessment: "#6366f1", under_review: "#3b82f6", competent: "#10b981", competent_conditions: "#84cc16", renewed: "#22c55e", remediation_required: "#f59e0b", suspended: "#f97316", expired: "#ef4444", archived: "#64748b" };

export function mapDecisionToState(outcome: string | null, expiryDate: string | null): string {
  const today = new Date().toISOString().slice(0, 10);
  if (outcome === "expired" || (expiryDate && expiryDate < today)) return "expired";
  if (["requires_remediation", "not_yet_competent"].includes(outcome ?? "")) return "remediation_required";
  if (outcome === "suspended") return "suspended";
  if (outcome === "competent_with_conditions") return "competent_conditions";
  if (outcome === "competent") return "competent";
  return "under_review";
}

// Record a lifecycle transition (upsert current state + append an immutable event). Fail-soft.
export async function transitionLifecycle(admin: any, p: { hospitalId: string | null; nurseId: string; competencyId: string; toState: string; reason?: string; actorId?: string | null; actorName?: string | null }): Promise<void> {
  if (!p.nurseId || !p.competencyId || !p.toState) return;
  try {
    const { data: cur, error } = await admin.from("competency_lifecycle_state").select("state").eq("nurse_id", p.nurseId).eq("competency_id", p.competencyId).maybeSingle();
    if (error) return; // table not provisioned → no-op
    const from = cur?.state ?? null;
    if (from === p.toState) return;
    await admin.from("competency_lifecycle_state").upsert({ hospital_id: p.hospitalId ?? null, nurse_id: p.nurseId, competency_id: p.competencyId, state: p.toState, updated_at: new Date().toISOString() }, { onConflict: "nurse_id,competency_id" });
    await admin.from("lifecycle_events").insert({ hospital_id: p.hospitalId ?? null, nurse_id: p.nurseId, competency_id: p.competencyId, from_state: from, to_state: p.toState, reason: p.reason ?? null, actor_id: p.actorId ?? null, actor_name: p.actorName ?? null });
  } catch { /* fail-soft */ }
}

// A single worker's own lifecycle — their competency states + recent transitions, for the passport timeline.
export async function loadWorkerLifecycle(admin: any, nurseId: string): Promise<{ provisioned: boolean; total: number; distribution: any[]; transitions: any[] }> {
  const sRes = await admin.from("competency_lifecycle_state").select("state").eq("nurse_id", nurseId).limit(5000);
  if (sRes.error) return { provisioned: false, total: 0, distribution: [], transitions: [] };
  const rows = (sRes.data ?? []) as any[];
  const count = (s: string) => rows.filter(r => r.state === s).length;
  const distribution = LIFECYCLE_STATES.map(s => ({ state: s, label: STATE_LABEL[s], color: STATE_COLOR[s], n: count(s) })).filter(x => x.n > 0);
  let events: any[] = [];
  try { const { data } = await admin.from("lifecycle_events").select("from_state, to_state, reason, occurred_at, competency_id").eq("nurse_id", nurseId).order("occurred_at", { ascending: false }).limit(12); events = (data ?? []) as any[]; } catch { events = []; }
  const cIds = [...new Set(events.map(e => e.competency_id).filter(Boolean))] as string[];
  const cName = new Map<string, string>(); if (cIds.length) { const { data } = await admin.from("framework_competencies").select("id, name").in("id", cIds.slice(0, 200)); ((data ?? []) as any[]).forEach(c => cName.set(c.id, c.name)); }
  const transitions = events.map(e => ({ competency: cName.get(e.competency_id) ?? "Competency", from: e.from_state, to: e.to_state, reason: e.reason, when: e.occurred_at }));
  return { provisioned: true, total: rows.length, distribution, transitions };
}

export async function loadLifecycleStates(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const res = await scope(admin.from("competency_lifecycle_state").select("state, updated_at").limit(50000));
  if (res.error) return { provisioned: false as const };
  const rows = (res.data ?? []) as any[];
  const total = rows.length;
  const count = (s: string) => rows.filter(r => r.state === s).length;
  const distribution = LIFECYCLE_STATES.map(s => ({ state: s, label: STATE_LABEL[s], color: STATE_COLOR[s], n: count(s) })).filter(x => x.n > 0);

  let events: any[] = [];
  try { const { data } = await scope(admin.from("lifecycle_events").select("nurse_id, competency_id, from_state, to_state, reason, actor_name, occurred_at").order("occurred_at", { ascending: false }).limit(30)); events = (data ?? []) as any[]; } catch { events = []; }
  const cIds = [...new Set(events.map(e => e.competency_id).filter(Boolean))] as string[];
  const nIds = [...new Set(events.map(e => e.nurse_id).filter(Boolean))] as string[];
  const cName = new Map<string, string>(); if (cIds.length) { const { data } = await admin.from("framework_competencies").select("id, name").in("id", cIds.slice(0, 500)); ((data ?? []) as any[]).forEach(c => cName.set(c.id, c.name)); }
  const nName = new Map<string, string>(); if (nIds.length) { const { data } = await admin.from("profiles").select("id, full_name").in("id", nIds.slice(0, 500)); ((data ?? []) as any[]).forEach(p => nName.set(p.id, p.full_name)); }
  const recentTransitions = events.map(e => ({ person: nName.get(e.nurse_id) ?? "Worker", competency: cName.get(e.competency_id) ?? "Competency", from: e.from_state, to: e.to_state, reason: e.reason, actor: e.actor_name, when: e.occurred_at }));

  const now = Date.now();
  const kpis = {
    total,
    active: count("competent") + count("renewed") + count("competent_conditions"),
    attention: count("expired") + count("remediation_required") + count("suspended"),
    inProgress: count("draft") + count("assigned") + count("accepted") + count("in_progress") + count("evidence_submitted") + count("awaiting_assessment") + count("under_review"),
    renewed: count("renewed"),
    transitions30d: events.filter(e => e.occurred_at && now - new Date(e.occurred_at).getTime() < 30 * 86400000).length,
  };
  return { provisioned: true as const, empty: total === 0, kpis, distribution, recentTransitions };
}
