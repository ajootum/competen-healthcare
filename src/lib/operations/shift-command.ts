// Shared aggregates for the Shift Command modules (SSW-001 / Shift Command SS) —
// Current Shift, Today's Priorities and Shift Timeline. Everything here is derived
// from live Clinical Operations Engine (op_*) data plus the Director-of-Nursing
// ward config (op_staffing_standards / op_round_schedule). Fields the schema does
// not hold (staff activity, break clocking, fatigue, per-round execution status,
// Gantt scheduling) are intentionally NOT invented — the module pages surface
// honest placeholders for them.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";

const NONE = "00000000-0000-0000-0000-000000000000";
export const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "--:--";
export const titleCase = (s: string) => (s ?? "").replace(/_/g, " ").split(" ").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
const durH = (a: string | null, b: string | null) => (a && b) ? (new Date(b).getTime() - new Date(a).getTime()) / 3.6e6 : null;

export async function loadShiftCommand(admin: any, hid: string | null, isSuper: boolean) {
  const { ready, data } = await loadOpsConsoleData(admin, hid, isSuper);
  if (!ready) return { ready: false as const };
  const { shifts, shiftStaff, beds, patients, assignments, escalations, alerts, tasks, observations } = data;
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  // Ward config (defensive — needs migration 046) + handover.
  const [stdRes, roundRes, handRes] = await Promise.all([
    scope(admin.from("op_staffing_standards").select("shift_type, department_id, role, min_count, target_ratio")),
    scope(admin.from("op_round_schedule").select("shift_type, department_id, at_time, label")).order("at_time"),
    scope(admin.from("op_handovers").select("status, accepted_at, created_at")).order("created_at", { ascending: false }).limit(3),
  ]);

  const now = Date.now();
  const activeShift = shifts.find((s: any) => s.status === "active") ?? shifts.find((s: any) => s.status === "planned") ?? null;
  const shiftId = activeShift?.id ?? null;
  const applies = (row: any) =>
    (row.shift_type === "any" || !activeShift || row.shift_type === activeShift.shift_type) &&
    (row.department_id == null || !activeShift?.department_id || row.department_id === activeShift.department_id);
  const standards = ((stdRes as any).error ? [] : ((stdRes.data ?? []) as any[])).filter(applies);
  const rounds = ((roundRes as any).error ? [] : ((roundRes.data ?? []) as any[])).filter(applies);
  const handover = handRes.data?.[0] ?? null;

  // ── Workforce board ──────────────────────────────────────────────────────
  const rostered = activeShift ? shiftStaff.filter((s: any) => s.shift_id === activeShift.id) : [];
  const present = rostered.filter((s: any) => ["on_duty", "confirmed", "assigned"].includes(s.status));
  const roleMix = present.reduce((m: Record<string, number>, s: any) => ({ ...m, [s.role]: (m[s.role] ?? 0) + 1 }), {});
  const asgByStaff = new Map<string, any[]>();
  assignments.forEach((a: any) => { const k = a.staff_id; if (!asgByStaff.has(k)) asgByStaff.set(k, []); asgByStaff.get(k)!.push(a); });
  const staffBoard = rostered.map((s: any) => {
    const mine = asgByStaff.get(s.staff_id) ?? [];
    return {
      id: s.staff_id, name: s.profiles?.full_name ?? "Staff", role: s.role, status: s.status,
      patients: mine.length, competencyOk: mine.length === 0 ? null : mine.every((a: any) => a.competency_validated),
      beds: mine.map((a: any) => a.op_patients?.label).filter(Boolean),
    };
  });

  // ── Patient board (SSW-005 groupings) ────────────────────────────────────
  const latestObs = new Map<string, any>();
  observations.forEach((o: any) => {
    const t = new Date(o.recorded_at ?? o.created_at ?? 0).getTime();
    const cur = latestObs.get(o.patient_id);
    if (!cur || t > cur._t) latestObs.set(o.patient_id, { ...o, _t: t });
  });
  const nextDue = new Map<string, string>();
  observations.filter((o: any) => o.status === "due" && o.due_at).forEach((o: any) => {
    const cur = nextDue.get(o.patient_id);
    if (!cur || o.due_at < cur) nextDue.set(o.patient_id, o.due_at);
  });
  const nurseByPatient = new Map<string, string>();
  assignments.forEach((a: any) => { if (a.op_patients?.id ?? a.patient_id) nurseByPatient.set(a.patient_id, a.profiles?.full_name ?? ""); });
  const bedType = new Map<string, string>(beds.map((b: any) => [b.id, b.bed_type]));
  const alertsByPatient = new Map<string, number>();
  alerts.forEach((a: any) => a.patient_id && alertsByPatient.set(a.patient_id, (alertsByPatient.get(a.patient_id) ?? 0) + 1));

  const patientBoard = patients.map((p: any) => {
    const ews = latestObs.get(p.id)?.ews_score ?? null;
    const groups: string[] = [];
    if (p.acuity_level === "critical" || p.acuity_level === "high" || p.risk_level === "high") groups.push("High Risk");
    if (ews != null && ews >= 5) groups.push("PEWS Review");
    if (nextDue.has(p.id)) groups.push("Observation");
    if (p.isolation_status && p.isolation_status !== "none") groups.push("Isolation");
    if (p.operational_status === "discharge_pending") groups.push("Discharge Ready");
    if (p.bed_id && bedType.get(p.bed_id) === "theatre") groups.push("Theatre");
    if (groups.length === 0) groups.push("Stable");
    return {
      id: p.id, bed: p.op_beds?.label ?? null, label: p.label, pews: ews,
      nurse: nurseByPatient.get(p.id) ?? null, lastObs: latestObs.get(p.id)?.recorded_at ?? null,
      nextReview: nextDue.get(p.id) ?? null, alerts: alertsByPatient.get(p.id) ?? 0,
      acuity: p.acuity_level, risk: p.risk_level, isolation: p.isolation_status, status: p.operational_status, groups,
    };
  });
  const PATIENT_GROUPS = ["Stable", "Observation", "PEWS Review", "High Risk", "Isolation", "Theatre", "Discharge Ready"];
  const groupCounts = Object.fromEntries(PATIENT_GROUPS.map(g => [g, patientBoard.filter(p => p.groups.includes(g)).length]));

  // ── Overview stats ───────────────────────────────────────────────────────
  const byStatus = (s: string) => patients.filter((p: any) => p.operational_status === s).length;
  const openEsc = escalations.filter((e: any) => ["open", "acknowledged"].includes(e.status));
  const bedBy = (s: string) => beds.filter((b: any) => b.status === s).length;
  const totalBeds = beds.length, occupied = bedBy("occupied");
  const overview = {
    present: present.length, rostered: rostered.length,
    totalBeds, occupied, occPct: totalBeds ? Math.round((occupied / totalBeds) * 100) : 0,
    critical: patients.filter((p: any) => p.acuity_level === "critical").length,
    admissionsPending: byStatus("expected"), transfers: byStatus("transfer_pending"), discharges: byStatus("discharge_pending"),
    theatre: beds.filter((b: any) => b.bed_type === "theatre").length,
    escalations: openEsc.length, incidents: alerts.length,
    handoverPct: handover?.status === "accepted" ? 100 : (handover ? 60 : 0), handoverStatus: handover?.status ?? "pending",
  };

  // ── Mandatory-ratio compliance ───────────────────────────────────────────
  const ratioRows = standards.map((s: any) => ({ role: s.role, required: s.min_count, present: (roleMix as any)[s.role] ?? 0 }));
  const ratioCompliance = ratioRows.length ? Math.round((ratioRows.filter((r: any) => r.present >= r.required).length / ratioRows.length) * 100) : null;

  // ── Priorities (derived across the spec's five categories) ───────────────
  type Prio = { severity: "critical" | "high" | "medium"; category: string; title: string; sub?: string; owner?: string | null; due?: string | null; href: string };
  const priorities: Prio[] = [];
  escalations.filter((e: any) => e.level >= 4).forEach((e: any) => priorities.push({ severity: "critical", category: "Patient Safety", title: `Rapid response — ${e.op_patients?.label ?? "patient"}`, sub: e.summary, href: "/supervisor/operations?section=safety" }));
  patientBoard.filter(p => p.pews != null && p.pews >= 5).forEach(p => priorities.push({ severity: "critical", category: "Patient Safety", title: `PEWS review — ${p.label}${p.bed ? ` (${p.bed})` : ""}`, sub: `PEWS ${p.pews}`, owner: p.nurse, href: "/supervisor/operations?section=safety" }));
  observations.filter((o: any) => o.status === "overdue").forEach((o: any) => priorities.push({ severity: "high", category: "Patient Safety", title: `Observation overdue — ${o.op_patients?.label ?? "patient"}`, due: o.due_at, href: "/supervisor/operations?section=safety" }));
  alerts.filter((a: any) => a.category === "fall_risk" || a.category === "pressure_injury").forEach((a: any) => priorities.push({ severity: "medium", category: "Patient Safety", title: `${titleCase(a.category)} — ${a.op_patients?.label ?? "patient"}`, sub: a.note, href: "/supervisor/operations?section=safety" }));
  ratioRows.filter((r: any) => r.present < r.required).forEach((r: any) => priorities.push({ severity: "high", category: "Workforce", title: `Staff shortage — ${titleCase(r.role)}`, sub: `${r.present} of ${r.required} required`, href: "/supervisor/operations?section=assignments" }));
  if (overview.admissionsPending) priorities.push({ severity: "medium", category: "Operations", title: `${overview.admissionsPending} admission${overview.admissionsPending > 1 ? "s" : ""} pending`, href: "/supervisor/operations?section=ward" });
  if (overview.discharges) priorities.push({ severity: "medium", category: "Operations", title: `${overview.discharges} discharge${overview.discharges > 1 ? "s" : ""} to action`, href: "/supervisor/operations?section=ward" });
  if (overview.handoverStatus !== "accepted") priorities.push({ severity: "high", category: "Documentation", title: "Complete shift handover", sub: `Status: ${titleCase(overview.handoverStatus)}`, href: "/supervisor/handover" });
  tasks.filter((t: any) => t.priority === "urgent").forEach((t: any) => priorities.push({ severity: "critical", category: "Operations", title: t.description, owner: t.profiles?.full_name, due: t.due_at, href: "/supervisor/operations?section=care" }));
  tasks.filter((t: any) => t.priority === "high").forEach((t: any) => priorities.push({ severity: "high", category: "Operations", title: t.description, owner: t.profiles?.full_name, due: t.due_at, href: "/supervisor/operations?section=care" }));
  const rank = { critical: 0, high: 1, medium: 2 };
  priorities.sort((a, b) => rank[a.severity] - rank[b.severity]);

  // ── Operational Copilot (rule-based) ─────────────────────────────────────
  const copilot: { text: string; action: string; href: string }[] = [];
  staffBoard.filter(s => s.status !== "absent" && s.patients >= 6).forEach(s => copilot.push({ text: `${s.name} is carrying ${s.patients} patients — consider rebalancing`, action: "Reassign", href: "/supervisor/operations?section=assignments" }));
  patientBoard.filter(p => p.pews != null && p.pews >= 6).slice(0, 2).forEach(p => copilot.push({ text: `PEWS review overdue for ${p.bed ?? p.label} (PEWS ${p.pews})`, action: "Escalate", href: "/supervisor/operations?section=safety" }));
  staffBoard.filter(s => s.competencyOk === false).slice(0, 1).forEach(s => copilot.push({ text: `${s.name} has patients outside validated competency`, action: "Review", href: "/supervisor/operations?section=assignments" }));
  if (overview.occPct >= 85) copilot.push({ text: `Capacity ${overview.occPct}% — plan for admissions`, action: "Plan", href: "/supervisor/operations?section=ward" });

  // Real timeline events (milestones we actually have timestamps for).
  const timelineEvents: { at: string; label: string; done: boolean }[] = [];
  if (activeShift?.starts_at) timelineEvents.push({ at: activeShift.starts_at, label: "Shift start", done: activeShift.status !== "planned" });
  if (handover?.accepted_at) timelineEvents.push({ at: handover.accepted_at, label: "Handover accepted", done: true });
  escalations.slice(0, 4).forEach((e: any) => e.created_at && timelineEvents.push({ at: e.created_at, label: `Escalation — ${e.op_patients?.label ?? "patient"}`, done: true }));
  if (activeShift?.ends_at) timelineEvents.push({ at: activeShift.ends_at, label: "Shift end", done: activeShift.status === "completed" });

  const shift = activeShift ? {
    shift_type: activeShift.shift_type, starts_at: activeShift.starts_at, ends_at: activeShift.ends_at,
    status: activeShift.status, unit: activeShift.departments?.name ?? "Unit",
    supervisor: activeShift.profiles?.full_name ?? null,
    elapsedH: durH(activeShift.starts_at, new Date(now).toISOString()),
    remainingH: durH(new Date(now).toISOString(), activeShift.ends_at),
  } : null;

  return {
    ready: true as const, shift, shiftId, overview, staffBoard, roleMix, patientBoard, groupCounts, patientGroups: PATIENT_GROUPS,
    priorities, rounds, timelineEvents, ratioRows, ratioCompliance, copilot, tasks, handover,
    counts: {
      present: present.length, rostered: rostered.length,
      critical: priorities.filter(p => p.severity === "critical").length,
      high: priorities.filter(p => p.severity === "high").length,
      medium: priorities.filter(p => p.severity === "medium").length,
      overdue: observations.filter((o: any) => o.status === "overdue").length,
    },
  };
}
