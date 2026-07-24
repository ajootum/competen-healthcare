// Patient Operations Centre (POS-106) command-surface loader. Assembles the §5 operational
// summary widgets, the §6 workflow-catalogue counts and the §7 work queues from the shared
// operational model (loadPatientOps) plus the POS-106 form engine (op_form_instances /
// op_form_events, migration 084). Fail-soft: pre-migration the form-engine sections report
// provisioned:false and the surface degrades to an honest state rather than erroring.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadPatientOps } from "@/lib/operations/patient-ops";

const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => !!e && /does not exist|schema cache/i.test(e.message ?? "");
const OPEN_STATES = ["draft", "in_progress"];

export async function loadOpsCentre(admin: any, hid: string | null, isSuper: boolean, userId: string) {
  const po = await loadPatientOps(admin, hid, isSuper);
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const nowMs = Date.now();

  // ── Form engine (op_form_instances) — fail-soft pre-migration-084 ──────────────────────────
  let provisioned = true;
  let instances: any[] = [];
  const fiRes = await scope(admin.from("op_form_instances")
    .select("id, template_key, title, state, priority, due_at, patient_id, created_by, submitted_by, submitted_at, created_at, updated_at, op_patients!patient_id(label), creator:profiles!created_by(full_name)")
    .order("updated_at", { ascending: false }).limit(400));
  if ((fiRes as any).error) { provisioned = !missing((fiRes as any).error); instances = []; }
  else instances = (fiRes.data ?? []) as any[];

  // Recent form events (§7 recent events) — fail-soft.
  let recentEvents: any[] = [];
  const evRes = await scope(admin.from("op_form_events")
    .select("id, event_type, new_state, actor_role, created_at, patient_id, op_patients!patient_id(label), actor:profiles!actor_id(full_name)")
    .order("created_at", { ascending: false }).limit(20));
  if (!(evRes as any).error) recentEvents = (evRes.data ?? []) as any[];

  // Overdue operational tasks (op_tasks) — real; fail-soft.
  let overdueTasks = 0;
  const tkRes = await scope(admin.from("op_tasks").select("id, due_at, status")
    .not("status", "in", "(completed,verified,cancelled)").not("due_at", "is", null).limit(500));
  if (!(tkRes as any).error) overdueTasks = ((tkRes.data ?? []) as any[]).filter(t => new Date(t.due_at).getTime() < nowMs).length;

  // ── Derived form slices ─────────────────────────────────────────────────────────────────────
  const isOverdue = (i: any) => i.due_at && new Date(i.due_at).getTime() < nowMs && !["finalised", "verified", "cancelled"].includes(i.state);
  const open = instances.filter(i => OPEN_STATES.includes(i.state));
  const awaitingVerification = instances.filter(i => i.state === "awaiting_verification");
  const overdueForms = instances.map(i => ({ ...i, overdue: isOverdue(i) })).filter(i => i.overdue);

  // Counts by template_key (open + total) for the workflow catalogue.
  const countsByTemplate: Record<string, { open: number; total: number }> = {};
  instances.forEach(i => {
    const c = (countsByTemplate[i.template_key] ??= { open: 0, total: 0 });
    c.total++; if (OPEN_STATES.includes(i.state)) c.open++;
  });

  // ── Summary widgets (§5) ──────────────────────────────────────────────────────────────────
  const widgets = {
    activePatients: po.ready ? po.summary.total : 0,
    formsAwaiting: open.length,
    overdueActions: overdueTasks + overdueForms.length,
    activeEscalations: po.ready ? po.openEsc.length : 0,
    pendingTransfers: po.ready ? po.summary.transfersPending : 0,
    expectedDischarges: po.ready ? po.summary.dischargesExpected : 0,
  };

  // ── Work queues (§7) ──────────────────────────────────────────────────────────────────────
  const label = (i: any) => i.op_patients?.label ?? "—";
  const queues = {
    myPending: open.filter(i => i.created_by === userId).map(i => ({ ...i, patient: label(i), overdue: isOverdue(i) })),
    unitPending: open.map(i => ({ ...i, patient: label(i), by: i.creator?.full_name ?? "—", overdue: isOverdue(i) })),
    awaitingVerification: awaitingVerification.map(i => ({ ...i, patient: label(i), by: i.creator?.full_name ?? "—" })),
    overdue: overdueForms.map(i => ({ ...i, patient: label(i) })),
    escalations: po.ready ? po.openEsc.map((e: any) => ({ id: e.id, patient: e.op_patients?.label ?? "—", level: e.level, severity: e.severity, status: e.status, at: e.created_at })) : [],
    recentEvents,
  };

  return {
    ready: po.ready,
    po,
    provisioned,
    widgets,
    countsByTemplate,
    queues,
  };
}
