// Workforce Operations (SSW-004) loader — the Shift Supervisor's live staffing,
// rostering & deployment view for the current shift. Composes the shift-command
// aggregates (staff board, patient board, role mix, ratio compliance) with the
// competency-decision engine and professional-credential expiry, and derives the
// SSW-004 dashboard shapes: KPI strip, per-role staffing overview, skill-mix
// compliance, competency gaps, staff assignment board, workload & coverage,
// quick staff summary, staffing alerts. Everything is tenant-scoped and live from
// op_*/competency data. Fields with no store — shift clocking (late arrivals,
// check-in, overtime, worked hours), break scheduling/clocking, redeployment
// history, absence reasons, per-day trend — are surfaced as honest states.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadShiftCommand } from "@/lib/operations/shift-command";
import { loadUnitCapability } from "@/lib/operations/unit-manager-data";

const NONE = "00000000-0000-0000-0000-000000000000";
const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const tcRole = (s: string) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());
const ROLE_LABEL: Record<string, string> = { nurse: "Registered Nurses", charge: "Charge Nurse", support: "Healthcare Assistants", float: "Float Pool", doctor: "Doctors", educator: "Educators", assessor: "Assessors", therapist: "Therapists" };
const roleLabel = (r: string) => ROLE_LABEL[r] ?? tcRole(r);

const PRESENT = new Set(["on_duty", "confirmed", "assigned"]);
const CONFIRMED = new Set(["confirmed", "on_duty"]);

export async function loadWorkforceOps(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const todayStr = new Date().toISOString().slice(0, 10);
  const soonStr = (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); })();

  const [sc, cap, credRes, escRes, safetyRes] = await Promise.all([
    loadShiftCommand(admin, hid, isSuper),
    loadUnitCapability(admin, hid, isSuper).catch(() => ({ ready: false, summary: { total: 0, competent: 0, expired: 0, expiring: 0, gaps: 0, coverage: 0 }, perNurse: [] })),
    scope(admin.from("professional_credentials").select("credential_type, expiry_date, status, verified")).limit(5000),
    scope(admin.from("op_escalations").select("severity, level, status, summary, created_at")).neq("status", "cancelled").order("created_at", { ascending: false }).limit(400),
    scope(admin.from("op_safety_alerts").select("category, severity, active, created_at")).eq("active", true).limit(400),
  ]);

  if (!sc.ready) return { ready: false as const };

  const staffBoard = sc.staffBoard as any[];
  const patientBoard = (sc.patientBoard ?? []) as any[];
  const roleMix = sc.roleMix as Record<string, number>;
  const ratioRows = sc.ratioRows as any[];

  // Patients (with high-acuity) grouped by responsible nurse.
  const ptsByNurse = new Map<string, { total: number; high: number }>();
  patientBoard.forEach((p: any) => { if (!p.nurse) return; const e = ptsByNurse.get(p.nurse) ?? { total: 0, high: 0 }; e.total++; if (["high", "critical"].includes(p.acuity)) e.high++; ptsByNurse.set(p.nurse, e); });

  // ── KPI strip ──────────────────────────────────────────────────────────────
  const planned = staffBoard.length;
  const confirmed = staffBoard.filter(s => CONFIRMED.has(s.status)).length;
  const present = sc.overview.present;
  const absent = staffBoard.filter(s => s.status === "absent").length;
  const totalRequired = ratioRows.reduce((n: number, r: any) => n + r.required, 0);
  const variance = present - totalRequired;
  const criticalGaps = ratioRows.filter((r: any) => r.present < r.required).length;
  const kpis = {
    planned, confirmed, confirmedPct: planned ? Math.round((confirmed / planned) * 100) : null,
    present, presentPct: planned ? Math.round((present / planned) * 100) : null,
    absent, variance, criticalGaps,
    // Honest — no shift clocking / break store.
    late: null as number | null, avgLateMin: null as number | null, overdueBreaks: null as number | null,
  };

  // ── Staffing overview (by role) ─────────────────────────────────────────────
  const allRoles = [...new Set([...staffBoard.map(s => s.role), ...ratioRows.map((r: any) => r.role)])];
  const staffingOverview = allRoles.map(role => {
    const inRole = staffBoard.filter(s => s.role === role);
    const rPresent = inRole.filter(s => PRESENT.has(s.status)).length;
    const required = ratioRows.find((r: any) => r.role === role)?.required ?? null;
    const coverage = required ? Math.round((rPresent / required) * 100) : (rPresent > 0 ? 100 : null);
    const status = coverage == null ? "—" : coverage >= 100 ? "Good" : coverage >= 75 ? "At Risk" : "Below Required";
    return {
      role, label: roleLabel(role), planned: inRole.length,
      confirmed: inRole.filter(s => CONFIRMED.has(s.status)).length, present: rPresent,
      assigned: inRole.reduce((n, s) => n + s.patients, 0),
      required, variance: required == null ? null : rPresent - required, coverage, status,
    };
  }).sort((a, b) => b.planned - a.planned);
  const overviewTotal = { planned, confirmed, present, assigned: staffBoard.reduce((n, s) => n + s.patients, 0), required: totalRequired, variance, coverage: sc.ratioCompliance };

  // ── Skill-mix compliance (role-status distribution) ─────────────────────────
  const good = staffingOverview.filter(r => r.status === "Good").length;
  const atRisk = staffingOverview.filter(r => r.status === "At Risk").length;
  const below = staffingOverview.filter(r => r.status === "Below Required").length;
  const scored = good + atRisk + below;
  const skillMix = { compliant: good, minor: atRisk, major: below, total: scored, pct: scored ? Math.round((good / scored) * 100) : null };

  // ── Competency gaps (role shortfalls) ───────────────────────────────────────
  const competencyGaps = staffingOverview.filter(r => r.variance != null && r.variance < 0).map(r => ({ label: r.label, count: -(r.variance as number) }));

  // ── Staff assignment board ──────────────────────────────────────────────────
  const maxLoad = Math.max(6, ...staffBoard.map(s => s.patients));
  const assignmentBoard = staffBoard.map(s => {
    const pt = ptsByNurse.get(s.name) ?? { total: s.patients, high: 0 };
    const load = pt.total;
    return {
      id: s.id, name: s.name, role: s.role, status: s.status,
      assignment: s.beds?.length ? s.beds.slice(0, 2).join(", ") : (s.status === "absent" ? "—" : "Unassigned"),
      patients: load, highAcuity: pt.high, workloadPct: Math.round((load / maxLoad) * 100),
      workloadLevel: load >= 6 ? "High" : load >= 4 ? "Medium" : load > 0 ? "Low" : "—",
      competencyOk: s.competencyOk,
    };
  });
  const workloadCoverage = assignmentBoard.filter(s => s.patients > 0).sort((a, b) => b.patients - a.patients).slice(0, 8)
    .map(s => ({ name: s.name, total: s.patients, high: s.highAcuity, pct: s.workloadPct }));

  // ── Quick staff summary ─────────────────────────────────────────────────────
  const quickSummary = {
    requiringAssignment: staffBoard.filter(s => PRESENT.has(s.status) && s.patients === 0).length,
    unassigned: staffBoard.filter(s => PRESENT.has(s.status) && s.patients === 0).length,
    redeployed: staffBoard.filter(s => s.role === "float").length,
    onBreakNow: null as number | null, onBreakDue: null as number | null, inTransit: null as number | null,
  };

  // ── Competency & compliance (retained) ──────────────────────────────────────
  const creds = (credRes.error ? [] : credRes.data ?? []) as any[];
  const credExpired = creds.filter(c => c.expiry_date && c.expiry_date < todayStr).length;
  const credExpiring = creds.filter(c => c.expiry_date && c.expiry_date >= todayStr && c.expiry_date <= soonStr).length;
  const comp = cap.summary;
  const compliance = {
    coverage: comp.coverage, total: comp.total, competent: comp.competent,
    expired: comp.expired + credExpired, expiring: comp.expiring + credExpiring, gaps: comp.gaps,
    credentials: creds.length, credExpired, credExpiring,
    needsSupervision: staffBoard.filter(s => s.competencyOk === false).length,
  };

  // ── Staffing alerts (derived) ───────────────────────────────────────────────
  const staffingAlerts: { sev: string; text: string }[] = [];
  staffingOverview.filter(r => r.status === "Below Required").forEach(r => staffingAlerts.push({ sev: "critical", text: `${r.label} below required (${r.present}/${r.required})` }));
  staffingOverview.filter(r => r.status === "At Risk").forEach(r => staffingAlerts.push({ sev: "high", text: `${r.label} at risk (${r.present}/${r.required})` }));
  assignmentBoard.filter(s => s.patients >= 6).forEach(s => staffingAlerts.push({ sev: "medium", text: `${s.name} workload high (${s.patients} patients)` }));
  if (compliance.needsSupervision > 0) staffingAlerts.push({ sev: "medium", text: `${compliance.needsSupervision} staff caring outside validated competency` });
  if (absent > 0) staffingAlerts.push({ sev: "high", text: `${absent} staff absent — cover required` });

  // ── Support / intelligence (retained) ───────────────────────────────────────
  const esc = (escRes.error ? [] : escRes.data ?? []) as any[];
  const openEsc = esc.filter(e => ["open", "acknowledged"].includes(e.status));
  const support = {
    openEscalations: escRes.error ? null : esc.filter(e => e.status === "open").length,
    inProgress: escRes.error ? null : esc.filter(e => e.status === "acknowledged").length,
    safetyAlerts: safetyRes.error ? null : (safetyRes.data ?? []).length,
    recentEscalations: openEsc.slice(0, 5).map((e: any) => ({ summary: e.summary, severity: e.severity, level: e.level, at: e.created_at })),
  };
  const nurses = staffBoard.filter(s => ["nurse", "charge"].includes(s.role)).length;
  const totalPatients = staffBoard.reduce((n, s) => n + s.patients, 0);
  const factors: number[] = [];
  if (sc.ratioCompliance != null) factors.push(sc.ratioCompliance);
  if (comp.total) factors.push(comp.coverage);
  factors.push(openEsc.length === 0 ? 100 : Math.max(0, 100 - openEsc.length * 15));

  return {
    ready: true as const,
    shift: sc.shift,
    supervisor: { name: sc.shift?.supervisor ?? null, role: "Shift Supervisor" },
    overview: sc.overview,
    kpis, staffingOverview, overviewTotal, skillMix, competencyGaps,
    assignmentBoard, workloadCoverage, quickSummary, staffingAlerts,
    handoverStatus: { pct: sc.overview.handoverPct, status: sc.overview.handoverStatus },
    absence: { total: absent },
    compliance, support,
    intelligence: { avgPtsPerNurse: nurses ? +(totalPatients / nurses).toFixed(1) : null, nurses, totalPatients, shiftScore: mean(factors), openEscalations: openEsc.length },
    copilot: sc.copilot,
    generatedAt: new Date().toISOString(),
  };
}
