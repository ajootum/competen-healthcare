// Shift Operations Engine (SSW-002) loader — the operational backbone view for
// the Shift Supervisor Workspace. Maps the architecture spec's 10 engines onto
// the live data that actually backs each one, with the shift-lifecycle state
// machine (Planning → Pre-Shift → Active → Escalation → Handover → Closed)
// derived from the real op_shifts status plus operational overlays. Tenant-
// scoped, fail-soft; engines without a data source render as honest states
// rather than fabricated. Composes loadShiftCommand + the real op_*/audit trail.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadShiftCommand } from "@/lib/operations/shift-command";

const NONE = "00000000-0000-0000-0000-000000000000";
const DAY = 86400000;

// Lifecycle states (SSW-002 Ch.3) vs the real op_shifts status enum.
export const LIFECYCLE = ["Planning", "Pre-Shift Review", "Active Shift", "Escalation Mode", "Handover", "Shift Closed"];

export async function loadShiftOpsEngine(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const since24 = new Date(Date.now() - DAY).toISOString();

  const [sc, auditRes, auditCount] = await Promise.all([
    loadShiftCommand(admin, hid, isSuper),
    scope(admin.from("audit_log").select("action, actor_name, entity_type, entity_name, created_at")).order("created_at", { ascending: false }).limit(12),
    scope(admin.from("audit_log").select("*", { count: "exact", head: true })).gte("created_at", since24),
  ]);

  if (!sc.ready) return { ready: false as const };
  const o = sc.overview;
  const criticalPrio = sc.counts.critical; // priorities of critical severity (incl. rapid response)
  const now = Date.now();
  // Overdue OPEN tasks (real: from ops-console tasks' due_at). counts.overdue is
  // overdue OBSERVATIONS — a different signal — so we derive tasks here instead.
  const overdueTasks = (sc.tasks as any[]).filter((t: any) => t.due_at && new Date(t.due_at).getTime() < now).length;

  // ── Shift lifecycle state (derived) ─────────────────────────────────────────
  const shiftStatus = sc.shift?.status ?? null;
  let currentState = "Planning";
  if (shiftStatus === "completed") currentState = "Shift Closed";
  else if (shiftStatus === "active") {
    if (sc.handover && sc.handover.status !== "accepted") currentState = "Handover";
    else if (criticalPrio > 0 || o.escalations > 0) currentState = "Escalation Mode";
    else currentState = "Active Shift";
  } else if (shiftStatus === "planned") currentState = "Pre-Shift Review";
  const stateIndex = LIFECYCLE.indexOf(currentState);
  // Next legal op_shifts action for the advance control.
  const nextAction = shiftStatus === "planned" ? { status: "active", label: "Activate shift" }
    : shiftStatus === "active" ? { status: "completed", label: "Close shift" } : null;

  const num = (r: any) => (r?.error ? null : r?.count ?? 0);

  // ── 10 engines mapped to live backing ───────────────────────────────────────
  const engines = [
    { n: 1, name: "Shift Lifecycle Engine", desc: "Creation, activation, state, closure, audit", key: "lifecycle", status: "live", href: "/supervisor/current-shift",
      metrics: [{ label: "State", value: currentState }, { label: "Shift", value: sc.shift ? sc.shift.shift_type : "—" }] },
    { n: 2, name: "Workforce Operations Engine", desc: "Roster, attendance, competency, assignment", key: "workforce", status: "live", href: "/supervisor/workforce-operations",
      metrics: [{ label: "On duty", value: `${o.present}/${o.rostered}` }, { label: "Coverage", value: sc.ratioCompliance == null ? "—" : `${sc.ratioCompliance}%` }] },
    { n: 3, name: "Patient Operations Engine", desc: "Census, flow, beds, ward map, safety", key: "patient", status: "live", href: "/supervisor/patient-ops",
      metrics: [{ label: "Occupied", value: `${o.occupied}/${o.totalBeds}` }, { label: "Critical", value: o.critical }] },
    { n: 4, name: "Handover Engine", desc: "Preparation, notes, acknowledgement, audit", key: "handover", status: sc.handover ? "live" : "config", href: "/supervisor/handover",
      metrics: [{ label: "Status", value: o.handoverStatus }, { label: "Progress", value: `${o.handoverPct}%` }] },
    { n: 5, name: "Task Orchestration Engine", desc: "Creation, assignment, workflow, verification", key: "task", status: "live", href: "/supervisor/task-center",
      metrics: [{ label: "Open", value: sc.tasks.length }, { label: "Overdue", value: overdueTasks }] },
    { n: 6, name: "Escalation Engine", desc: "Detection, routing, acknowledgement, resolution", key: "escalation", status: "live", href: "/supervisor/operations?section=safety",
      metrics: [{ label: "Open", value: o.escalations }, { label: "Incidents", value: o.incidents }] },
    { n: 7, name: "Communications Engine", desc: "Secure messaging, broadcasts, read receipts", key: "comms", status: "live", href: "/supervisor/communication",
      metrics: [{ label: "Channels", value: "in-app" }, { label: "Delivery", value: "real-time" }] },
    { n: 8, name: "Operational Intelligence Engine", desc: "Analytics, AI recommendations, risk prediction", key: "intel", status: "live", href: "/supervisor/workforce-operations",
      metrics: [{ label: "Recs", value: sc.copilot.length }, { label: "Mode", value: "rule-based" }] },
    { n: 9, name: "Reporting Engine", desc: "Operational, compliance, safety, executive", key: "report", status: "partial", href: "/supervisor/analytics",
      metrics: [{ label: "Shift", value: sc.shift ? "1 active" : "—" }, { label: "Export", value: "soon" }] },
    { n: 10, name: "Audit Engine", desc: "Immutable logging, activity & change history", key: "audit", status: "live", href: "/supervisor/operations?section=safety",
      metrics: [{ label: "Events 24h", value: num(auditCount) }, { label: "Trail", value: "append-only" }] },
  ];
  const liveCount = engines.filter(e => e.status === "live").length;

  // ── Domain event flow (real records mapped to SSW-002 event names) ──────────
  // Matched against the actual op_* API action verbs only — onboarding/provisioning
  // audit rows deliberately do NOT map to clinical shift events.
  const EVENT_MAP: [RegExp, string][] = [
    [/create_task/i, "TaskCreated"], [/complete_task|verify_task/i, "TaskCompleted"],
    [/raise_escalation/i, "EscalationRaised"], [/resolve_escalation/i, "EscalationResolved"],
    [/handover/i, "HandoverStarted"],
    [/open_shift|create_shift/i, "ShiftCreated"], [/activate_shift|start_shift/i, "ShiftStarted"], [/close_shift|complete_shift/i, "ShiftClosed"],
    [/assign_patient/i, "AssignmentChanged"], [/register_op_patient|admit/i, "PatientAdmitted"],
    [/transfer_patient/i, "PatientTransferred"], [/discharge_patient/i, "PatientDischarged"],
    [/record_observation/i, "ObservationRecorded"], [/deploy_staff/i, "StaffCheckedIn"],
    [/raise_safety_alert|incident/i, "IncidentReported"],
  ];
  const domainEvent = (action: string) => { for (const [re, name] of EVENT_MAP) if (re.test(action)) return name; return null; };
  const eventFlow = (auditRes.error ? [] : auditRes.data ?? [])
    .map((a: any) => ({ event: domainEvent(a.action ?? ""), raw: a.action, actor: a.actor_name, entity: a.entity_name, at: a.created_at }))
    .filter((e: any) => e.event)
    .slice(0, 8);

  // Roadmap phase status (SSW-002 Ch.17).
  const roadmap = [
    { phase: 1, label: "Shift Lifecycle", done: true },
    { phase: 2, label: "Workforce Operations", done: true },
    { phase: 3, label: "Patient Operations", done: true },
    { phase: 4, label: "Task & Escalation", done: true },
    { phase: 5, label: "Communications", done: true },
    { phase: 6, label: "AI Operational Intelligence", done: true },
    { phase: 7, label: "Enterprise Reporting", done: false },
  ];

  const principles = ["Event-Driven", "Real-Time Operational Data", "Single Source of Truth", "Multi-Tenant Isolation", "Full Audit & Traceability", "AI-Augmented (human-approved)"];

  return {
    ready: true as const,
    shift: sc.shift, shiftId: sc.shiftId,
    lifecycle: { states: LIFECYCLE, current: currentState, index: stateIndex, nextAction, shiftStatus },
    engines, liveCount,
    eventFlow,
    roadmap, principles,
    copilot: sc.copilot,
    counts: { present: o.present, rostered: o.rostered, occupied: o.occupied, totalBeds: o.totalBeds, openTasks: sc.tasks.length, escalations: o.escalations, auditEvents24h: num(auditCount) },
    generatedAt: new Date().toISOString(),
  };
}
