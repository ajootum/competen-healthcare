// Shift Planning & Activation Centre (SSW-SPA-001 / SPA-000 architecture) — the Shift
// Supervisor's operational orchestration hub. It orchestrates the SPA-001A–J services'
// data (shift identity, incoming team, attendance, census/acuity demand, workload,
// competency, demand calc, allocation, readiness, activation) from their authoritative
// owners — it duplicates no operational data. Composes op_shifts + published roster +
// op_shift_staff + op_patients + op_beds + op_movement_events + op_round_schedule +
// establishment demand + competency into the full planning dashboard, gating activation on
// the readiness checklist. Fail-soft; every section is traceable to a single source.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";
import { loadEstablishment } from "@/lib/operations/establishment";
import { loadRosterForWeek, mondayOf } from "@/lib/operations/roster-solver";

const NONE = "00000000-0000-0000-0000-000000000000";
const PRESENT = new Set(["on_duty", "confirmed"]);
const ACUITY_SCORE: Record<string, number> = { critical: 4, high: 3, moderate: 2, stable: 1 };
const ROLE_LABEL: Record<string, string> = { charge: "Charge Nurse", nurse: "Registered Nurse", support: "Support Staff", doctor: "Doctor", therapist: "Allied Health", float: "Float", educator: "Educator", assessor: "Assessor" };
const PASSING = ["competent", "competent_with_conditions", "provisionally_competent"];
const hhmm = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(11, 16) : null);

export async function loadShiftActivation(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const [ops, est, roster] = await Promise.all([
    loadOpsConsoleData(admin, hid, isSuper),
    loadEstablishment(admin, hid, isSuper) as Promise<any>,
    loadRosterForWeek(admin, hid, isSuper, mondayOf()),
  ]);
  if (!ops.ready) return { ready: false as const };
  const { shifts, shiftStaff, patients, escalations, alerts, tasks, beds } = ops.data;

  const planned = shifts.find((s: any) => s.status === "planned");
  const active = shifts.find((s: any) => s.status === "active");
  const shift = planned ?? active ?? shifts[0] ?? null;
  const phase = shift?.status === "active" ? "activated" : "planning";
  const publishedRoster = (roster as any).roster ?? null;

  // ── Shift identity (SPA-001A) ─────────────────────────────────────────────
  const identity = {
    unit: shift?.departments?.name ?? "Unit", shiftType: shift?.shift_type ? `${shift.shift_type[0].toUpperCase()}${shift.shift_type.slice(1)} Shift` : "—",
    date: shift?.shift_date ?? null, time: shift?.starts_at && shift?.ends_at ? `${hhmm(shift.starts_at)} – ${hhmm(shift.ends_at)}` : "—",
    supervisor: shift?.profiles?.full_name ?? "Unassigned", rosterVersion: publishedRoster ? `v${publishedRoster.version} (Published)` : "No published roster",
    updated: shift?.created_at ?? null,
  };

  // ── Workforce availability (SPA-001C) ─────────────────────────────────────
  const roster0 = shiftStaff.filter((s: any) => !shift || s.shift_id === shift.id);
  const rostered = roster0.length;
  const confirmed = roster0.filter((s: any) => PRESENT.has(s.status)).length;
  const expectedLater = roster0.filter((s: any) => s.status === "assigned").length;
  const unavailable = roster0.filter((s: any) => s.status === "absent").length;
  const attendancePct = rostered ? Math.round((confirmed / rostered) * 100) : null;
  const attendance = roster0.map((s: any) => ({ id: s.id, name: s.profiles?.full_name ?? "Staff", role: ROLE_LABEL[s.role] ?? s.role, status: s.status, statusLabel: s.status === "absent" ? "Sick Call" : s.status === "assigned" ? "Expected" : s.status === "on_duty" ? "Present" : "Confirmed" })).sort((a: any, b: any) => a.name.localeCompare(b.name));

  // ── Patient census (SPA-001D) — operational_status drives forecast ────────
  const activePatients = patients.filter((p: any) => p.operational_status !== "expected");
  const expectedAdmissions = patients.filter((p: any) => p.operational_status === "expected").length;
  const plannedDischarges = patients.filter((p: any) => p.operational_status === "discharge_pending").length;
  const totalPatients = activePatients.length;
  const projectedPeak = totalPatients + expectedAdmissions - plannedDischarges;
  const totalBeds = beds.length; const occupiedBeds = beds.filter((b: any) => b.status === "occupied").length || totalPatients;
  const occupancyPct = totalBeds ? Math.round((occupiedBeds / totalBeds) * 100) : null;

  // ── Patient acuity ────────────────────────────────────────────────────────
  const acuityLevels = [
    { label: "Level 4 · Critical", key: "critical", n: activePatients.filter((p: any) => p.acuity_level === "critical").length, tone: "red" },
    { label: "Level 3 · High", key: "high", n: activePatients.filter((p: any) => p.acuity_level === "high").length, tone: "orange" },
    { label: "Level 2 · Moderate", key: "moderate", n: activePatients.filter((p: any) => p.acuity_level === "moderate").length, tone: "amber" },
    { label: "Level 1 · Low", key: "stable", n: activePatients.filter((p: any) => p.acuity_level === "stable").length, tone: "green" },
  ];
  const oneToOne = activePatients.filter((p: any) => p.acuity_level === "critical" && p.dependency_level === "level_3").length;
  const avgAcuity = totalPatients ? +(activePatients.reduce((n: number, p: any) => n + (ACUITY_SCORE[p.acuity_level] ?? 1), 0) / totalPatients).toFixed(1) : null;
  const highAcuity = acuityLevels[0].n + acuityLevels[1].n;

  // ── Demand calculation (SPA-001G) — per-shift posts ───────────────────────
  const minRequired = est.ready ? est.units.reduce((n: number, u: any) => n + u.roleReq.reduce((m: number, r: any) => m + r.perShift, 0), 0) : null;
  const availableFte = confirmed;
  const recommended = minRequired != null ? Math.ceil(minRequired * 1.1) : null;
  const minGap = minRequired != null ? Math.max(0, minRequired - availableFte) : null;
  const recGap = recommended != null ? Math.max(0, recommended - availableFte) : null;
  const coverage = minRequired ? Math.round((Math.min(availableFte, minRequired) / minRequired) * 100) : null;

  // ── Competency readiness (SPA-001F) — role-based required vs current ──────
  let stdByRole = new Map<string, number>();
  try { const { data } = await scope(admin.from("op_staffing_standards").select("role, min_count, target_ratio")); for (const s of data ?? []) stdByRole.set(s.role, Math.max(stdByRole.get(s.role) ?? 0, s.min_count ?? 1)); } catch { stdByRole = new Map(); }
  const validSet = new Set<string>();
  try { const today = new Date().toISOString().slice(0, 10); const { data } = await scope(admin.from("competency_decisions").select("nurse_id, outcome, expiry_date").in("outcome", PASSING)); for (const d of data ?? []) if (d.nurse_id && (!d.expiry_date || d.expiry_date >= today)) validSet.add(d.nurse_id); } catch { /* honest */ }
  const rosterRoles = [...new Set(roster0.map((s: any) => s.role))];
  const competencyReadiness = rosterRoles.map(role => {
    const present = roster0.filter((s: any) => s.role === role && PRESENT.has(s.status));
    const current = present.filter((s: any) => validSet.has(s.staff_id)).length;
    const required = stdByRole.get(role) ?? 1;
    return { role: ROLE_LABEL[role] ?? role, required, available: current, ok: current >= required };
  }).sort((a, b) => (a.ok === b.ok ? 0 : a.ok ? 1 : -1));

  // ── Operational workload (SPA-001E) — movements today + rounds ────────────
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  let movements: Record<string, number> = {}; let rounds = 0;
  try { const { data } = await scope(admin.from("op_movement_events").select("event_type").gte("created_at", startToday.toISOString())); for (const m of data ?? []) movements[m.event_type] = (movements[m.event_type] ?? 0) + 1; } catch { movements = {}; }
  try { const q = admin.from("op_round_schedule").select("id", { count: "exact", head: true }); const { count } = await (isSuper ? q : q.eq("hospital_id", hid ?? NONE)); rounds = count ?? 0; } catch { rounds = 0; }
  const workload = [
    { label: "Ward Rounds", n: rounds, icon: "🩺" },
    { label: "Theatre Cases", n: movements.theatre ?? 0, icon: "🔪" },
    { label: "New Admissions", n: (movements.admission ?? 0) || expectedAdmissions, icon: "➕" },
    { label: "Discharges", n: (movements.discharge ?? 0) || plannedDischarges, icon: "🏠" },
    { label: "Transfers", n: movements.transfer ?? 0, icon: "🔀" },
    { label: "Bed Changes", n: movements.bed_change ?? 0, icon: "🛏️" },
  ];

  // ── Alerts & gaps ─────────────────────────────────────────────────────────
  const openEsc = escalations.filter((e: any) => ["open", "acknowledged"].includes(e.status));
  const highAlerts = alerts.filter((a: any) => a.severity === "high");
  const activeAssign = ops.data.assignments.filter((a: any) => a.status === "active");
  const assignedPatients = new Set(activeAssign.map((a: any) => a.patient_id)).size;
  const unassignedHigh = activePatients.filter((p: any) => ["critical", "high"].includes(p.acuity_level) && !activeAssign.some((a: any) => a.patient_id === p.id)).length;
  const alertsGaps: { label: string; detail: string; sev: string }[] = [];
  competencyReadiness.filter(c => !c.ok).forEach(c => alertsGaps.push({ label: `${c.role} gap`, detail: "Minimum requirement not met", sev: "High" }));
  let breaksScheduled = 0;
  try { const q = admin.from("op_staff_breaks").select("id", { count: "exact", head: true }).in("status", ["scheduled", "on_break"]); const { count } = await (isSuper ? q : q.eq("hospital_id", hid ?? NONE)); breaksScheduled = count ?? 0; } catch { /* honest */ }
  if (breaksScheduled === 0 && totalPatients > 0) alertsGaps.push({ label: "Break coverage incomplete", detail: "No breaks scheduled", sev: "Medium" });
  if (unassignedHigh) alertsGaps.push({ label: `${unassignedHigh} patient(s) unassigned`, detail: "High-acuity patient", sev: "High" });
  highAlerts.slice(0, 2).forEach((a: any) => alertsGaps.push({ label: a.category ?? "Safety alert", detail: a.message ?? "Active alert", sev: "Medium" }));

  // ── Handover summary + accepted? ──────────────────────────────────────────
  let handoverAccepted = false;
  try { const { data } = await scope(admin.from("op_handovers").select("status").order("created_at", { ascending: false })).limit(1); handoverAccepted = (data ?? [])[0]?.status === "accepted"; } catch { /* honest */ }
  const handoverSummary = [
    { label: "Next shift team prepared", value: publishedRoster ? "Yes" : "No", ok: !!publishedRoster },
    { label: "Expected gaps communicated", value: alertsGaps.length ? "Yes" : "None", ok: true },
    { label: "Risks documented", value: String(openEsc.length + highAlerts.length), ok: true },
    { label: "Critical tasks handover", value: tasks.filter((t: any) => t.priority === "urgent").every((t: any) => t.assigned_to) ? "Completed" : "Pending", ok: tasks.filter((t: any) => t.priority === "urgent").every((t: any) => t.assigned_to) },
    { label: "Handover notes added", value: handoverAccepted ? "Yes" : "Pending", ok: handoverAccepted },
  ];

  // ── Readiness checklist (SPA-001I) ────────────────────────────────────────
  const check = (label: string, ok: boolean, mandatory = true) => ({ label, ok, mandatory });
  const checklist = [
    check("Workforce confirmed", attendancePct != null && attendancePct >= 90),
    check("Patient census confirmed", totalPatients > 0),
    check("Acuity completed", avgAcuity != null),
    check("Competency coverage", competencyReadiness.every(c => c.ok)),
    check("Minimum staffing met", minGap === 0),
    check("Break coverage complete", breaksScheduled > 0, false),
    check("All patients assigned", totalPatients === 0 || assignedPatients >= totalPatients),
    check("No critical alerts", highAlerts.length === 0, false),
  ];
  const mandatoryDone = checklist.filter(c => c.mandatory).every(c => c.ok);
  const readinessPct = Math.round((checklist.filter(c => c.ok).length / checklist.length) * 100);

  return {
    ready: true as const, phase, shift, identity,
    workforce: { rostered, confirmed, expectedLater, unavailable, replacements: 0, attendance, attendancePct },
    census: { totalPatients, expectedAdmissions, plannedDischarges, projectedPeak, occupiedBeds, totalBeds, occupancyPct },
    acuity: { levels: acuityLevels, oneToOne, avgAcuity, highAcuity },
    demand: { minRequired, recommended, availableFte, minGap, recGap, coverage },
    competencyReadiness, workload, alertsGaps, handoverSummary,
    checklist, mandatoryDone, readinessPct,
    rosterProvisioned: (roster as any).provisioned, publishedRoster,
  };
}
