// Shift Operations Engine (SSW-002) loader — the operational backbone view for
// the Shift Supervisor Workspace. Maps the architecture spec's 10 engines onto
// the live data that actually backs each one, with the shift-lifecycle state
// machine (Planning → Pre-Shift → Active → Escalation → Handover → Closed)
// derived from the real op_shifts status plus operational overlays. Tenant-
// scoped, fail-soft; engines without a data source render as honest states
// rather than fabricated. Composes loadShiftCommand + the real op_*/audit trail.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadShiftCommand } from "@/lib/operations/shift-command";
import { loadReadiness } from "@/lib/operations/readiness";

const NONE = "00000000-0000-0000-0000-000000000000";
const DAY = 86400000;

// Canonical Shift Instance state model (SSW-002 §7). op_shifts.status carries only
// four real values (planned|active|completed|cancelled), so the current state is
// derived from that plus operational overlays; the fuller model is shown as the
// reference line and we only LAND on states we can actually determine.
export const LIFECYCLE = ["Scheduled", "Pre-Shift Review", "Ready for Activation", "Active", "Closure", "Closed"];

export async function loadShiftOpsEngine(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const since24 = new Date(Date.now() - DAY).toISOString();

  const [sc, auditRes, auditCount, activeShiftsRes] = await Promise.all([
    loadShiftCommand(admin, hid, isSuper),
    scope(admin.from("audit_log").select("action, actor_name, entity_type, entity_name, created_at")).order("created_at", { ascending: false }).limit(12),
    scope(admin.from("audit_log").select("*", { count: "exact", head: true })).gte("created_at", since24),
    scope(admin.from("op_shifts").select("supervisor_id")).eq("status", "active"),
  ]);

  if (!sc.ready) return { ready: false as const };
  const o = sc.overview;
  const criticalPrio = sc.counts.critical; // priorities of critical severity (incl. rapid response)
  const now = Date.now();
  // Overdue OPEN tasks (real: from ops-console tasks' due_at). counts.overdue is
  // overdue OBSERVATIONS — a different signal — so we derive tasks here instead.
  const overdueTasks = (sc.tasks as any[]).filter((t: any) => t.due_at && new Date(t.due_at).getTime() < now).length;

  const num = (r: any) => (r?.error ? null : r?.count ?? 0);
  const shiftStatus = sc.shift?.status ?? null;

  // Formal pre-shift readiness checklist (SSW-002 §6.4) — drives the gate when
  // migration 064 is applied; falls back to inferred preconditions until then.
  const readiness: any = await loadReadiness(admin, sc.shiftId);
  const rdyProvisioned = readiness.provisioned === true && !readiness.error && Array.isArray(readiness.items);

  // ── Transition gate (SSW-002 §10 / §26) — the engine computes the blocking
  // reasons the UI must surface; activation/closure buttons derive from these.
  const blockers: { code: string; message: string; hard: boolean }[] = [];
  let gateAction: { status: string; label: string } | null = null;
  if (shiftStatus === "planned") {
    gateAction = { status: "active", label: "Activate shift" };
    if (rdyProvisioned) {
      // Authoritative: the explicit readiness sign-off (mandatory items).
      if (!readiness.allComplete) blockers.push({ code: "READINESS_INCOMPLETE", message: `${readiness.mandatoryTotal - readiness.mandatoryComplete} mandatory readiness item(s) outstanding.`, hard: true });
    } else {
      // Fallback (pre-migration): infer readiness from live data.
      if (!sc.shift?.supervisor) blockers.push({ code: "SUPERVISOR_NOT_ASSIGNED", message: "No supervisor holds command of this shift.", hard: true });
      if ((o.rostered ?? 0) === 0) blockers.push({ code: "STAFFING_REVIEW_INCOMPLETE", message: "No staff rostered / attendance not confirmed.", hard: true });
      if ((o.totalBeds ?? 0) === 0) blockers.push({ code: "CENSUS_UNAVAILABLE", message: "No patient census or bed context for the unit.", hard: true });
    }
    if (sc.handover && sc.handover.status !== "accepted") blockers.push({ code: "HANDOVER_NOT_ACCEPTED", message: "Incoming handover not yet accepted (override needs authorisation).", hard: false });
  } else if (shiftStatus === "active") {
    gateAction = { status: "completed", label: "Begin closure" };
    if (criticalPrio > 0) blockers.push({ code: "CRITICAL_ITEMS_UNRESOLVED", message: `${criticalPrio} critical safety item(s) unresolved — resolve or formally transfer.`, hard: true });
    if (overdueTasks > 0) blockers.push({ code: "OVERDUE_TASKS_OPEN", message: `${overdueTasks} overdue task(s) outstanding.`, hard: false });
    if (sc.handover && sc.handover.status !== "accepted") blockers.push({ code: "HANDOVER_INCOMPLETE", message: "Outgoing handover not accepted by incoming supervisor.", hard: false });
  }
  const gateAllowed = !blockers.some(b => b.hard);
  const gate = { action: gateAction, allowed: gateAllowed, blockers };

  // ── Current state + ACTIVE sub-state (SSW-002 §7) ───────────────────────────
  let currentState = "Scheduled";
  let activeSubState: string | null = null;
  if (shiftStatus === "completed") currentState = "Closed";
  else if (shiftStatus === "active") {
    currentState = "Active";
    if (criticalPrio > 0) activeSubState = "Emergency Operations";
    else if (o.escalations > 0) activeSubState = "Degraded Operations";
  } else if (shiftStatus === "planned") {
    currentState = gateAllowed ? "Ready for Activation" : "Pre-Shift Review";
  }
  const stateIndex = LIFECYCLE.indexOf(currentState);

  // ── Command ownership (SSW-002 §5.2 / §8) — one accountable owner per shift ──
  const activeRows = activeShiftsRes.error ? [] : (activeShiftsRes.data ?? []);
  const command = {
    owner: sc.shift?.supervisor ?? null,
    hasOwner: !!sc.shift?.supervisor,
    activeShifts: activeRows.length,
    commandOwners: new Set(activeRows.map((r: any) => r.supervisor_id).filter(Boolean)).size,
    uncommanded: activeRows.filter((r: any) => !r.supervisor_id).length,
  };

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
    lifecycle: { states: LIFECYCLE, current: currentState, index: stateIndex, subState: activeSubState, shiftStatus },
    gate, command, readiness,
    engines, liveCount,
    eventFlow,
    roadmap, principles,
    copilot: sc.copilot,
    counts: {
      present: o.present, rostered: o.rostered, occupied: o.occupied, totalBeds: o.totalBeds, occPct: o.occPct,
      openTasks: sc.tasks.length, overdueTasks, escalations: o.escalations, critical: criticalPrio,
      activeShifts: command.activeShifts, commandOwners: command.commandOwners, auditEvents24h: num(auditCount),
    },
    generatedAt: new Date().toISOString(),
  };
}
