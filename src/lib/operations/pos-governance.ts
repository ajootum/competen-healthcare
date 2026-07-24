// Unit Manager Governance Mode loader (POS-106A §10). Governance is NOT a copy of Operational Mode —
// it is an oversight surface over the SAME shared POS-106 objects (op_form_instances) plus the two
// governance stores (op_exceptions, op_amendment_requests — migration 087). Reuses loadOpsCentre for
// the shared operational slices and adds the §10.1 governance dashboard + queues. Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadOpsCentre } from "@/lib/operations/pos-operations-centre";

const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => !!e && /does not exist|schema cache/i.test(e.message ?? "");

export async function loadGovernance(admin: any, hid: string | null, isSuper: boolean, userId: string) {
  const oc = await loadOpsCentre(admin, hid, isSuper, userId);
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  // Exceptions (§13.1) — open + recent decided. Fail-soft.
  let exProvisioned = true, exceptions: any[] = [], exceptionsRecent: any[] = [];
  const exRes = await scope(admin.from("op_exceptions")
    .select("id, exception_type, reason_category, reason, risk_level, status, expiry, created_at, patient_id, op_patients!patient_id(label), requester:profiles!requester_id(full_name)")
    .order("created_at", { ascending: false }).limit(80));
  if ((exRes as any).error) exProvisioned = !missing((exRes as any).error);
  else { const all = (exRes.data ?? []) as any[]; exceptions = all.filter(e => e.status === "requested"); exceptionsRecent = all.filter(e => e.status !== "requested").slice(0, 10); }

  // Amendment requests (§13.2) — open. Fail-soft.
  let amendProvisioned = true, amendments: any[] = [];
  const amRes = await scope(admin.from("op_amendment_requests")
    .select("id, form_instance_id, reason, status, created_at, patient_id, op_patients!patient_id(label), requester:profiles!requested_by(full_name), form:op_form_instances!form_instance_id(template_key)")
    .eq("status", "requested").order("created_at", { ascending: false }).limit(60));
  if ((amRes as any).error) amendProvisioned = !missing((amRes as any).error);
  else amendments = (amRes.data ?? []) as any[];

  // Documentation compliance (§10.1) — state tally over the shared form store. Fail-soft.
  let returned: any[] = [];
  const stateTally: Record<string, number> = {};
  const fiRes = await scope(admin.from("op_form_instances").select("id, template_key, state, due_at, created_at, patient_id, op_patients!patient_id(label), creator:profiles!created_by(full_name)").order("updated_at", { ascending: false }).limit(500));
  if (!(fiRes as any).error) {
    const rows = (fiRes.data ?? []) as any[];
    rows.forEach(r => { stateTally[r.state] = (stateTally[r.state] ?? 0) + 1; });
    returned = rows.filter(r => r.state === "returned").map(r => ({ ...r, patient: r.op_patients?.label ?? "—", by: r.creator?.full_name ?? "—" }));
  }

  // Audit activity (§10.1) — recent governance/operational mutations. Fail-soft.
  let audit: any[] = [];
  const auRes = await scope(admin.from("audit_log").select("id, action, entity_type, created_at, actor:profiles!actor_id(full_name)").order("created_at", { ascending: false }).limit(14));
  if (!(auRes as any).error) audit = (auRes.data ?? []) as any[];

  // Risk concentration (§10.1) — high-acuity clusters from the shared model.
  const riskZones = oc.ready ? (oc.po.zones ?? []).filter((z: any) => z.highRisk > 0).sort((a: any, b: any) => b.highRisk - a.highRisk).slice(0, 6) : [];

  // §10.1 governance dashboard widgets.
  const widgets = {
    exceptions: exceptions.length,
    amendmentRequests: amendments.length,
    returnedForms: returned.length,
    awaitingVerification: oc.ready ? oc.queues.awaitingVerification.length : 0,
    escalationOversight: oc.ready ? oc.queues.escalations.length : 0,
    overdueActions: oc.ready ? oc.widgets.overdueActions : 0,
    transferDelays: oc.ready ? oc.widgets.pendingTransfers : 0,
    dischargeBarriers: oc.ready ? oc.widgets.expectedDischarges : 0,
  };

  return {
    ready: oc.ready, po: oc.ready ? oc.po : null,
    exProvisioned: exProvisioned && amendProvisioned,
    widgets,
    exceptions, exceptionsRecent, amendments, returned, audit, riskZones,
    queues: oc.ready ? oc.queues : null,
    stateTally,
  };
}
