// Workforce Operations (SSW-001) loader — the Shift Supervisor's live view of
// the WORKFORCE during the current shift (people, not patients). Composes the
// existing shift-command aggregates (staff board, role mix, ratio compliance)
// with the competency-decision engine and professional-credential expiry, plus
// the escalation/safety signals for staff support. Everything is tenant-scoped
// and derived from live op_*/competency data. Fields the schema doesn't hold —
// worked hours, break clocking, fatigue, overtime, redeployment history,
// per-shift trend — are surfaced as honest states, never invented.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadShiftCommand } from "@/lib/operations/shift-command";
import { loadUnitCapability } from "@/lib/operations/unit-manager-data";

const NONE = "00000000-0000-0000-0000-000000000000";
const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

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

  // ── Module 1: Staff Assignment ──────────────────────────────────────────────
  const staffBoard = sc.staffBoard;
  const onDuty = sc.overview.present;
  const roleMix = sc.roleMix as Record<string, number>;
  const students = staffBoard.filter((s: any) => s.role === "educator" || s.role === "assessor").length; // proxy — no explicit student role in shift enum

  // ── Module 2: Staffing & Capacity ───────────────────────────────────────────
  const ratioRows = sc.ratioRows;
  const vacancies = ratioRows.reduce((n: number, r: any) => n + Math.max(0, r.required - r.present), 0);
  const sickCalls = sc.staffBoard.filter((s: any) => s.status === "absent").length;
  const coverage = sc.ratioCompliance;

  // ── Module 3: Competency & Compliance ───────────────────────────────────────
  const creds = (credRes.error ? [] : credRes.data ?? []) as any[];
  const credExpired = creds.filter(c => c.expiry_date && c.expiry_date < todayStr).length;
  const credExpiring = creds.filter(c => c.expiry_date && c.expiry_date >= todayStr && c.expiry_date <= soonStr).length;
  const comp = cap.summary;
  const compliance = {
    coverage: comp.coverage,
    total: comp.total, competent: comp.competent,
    expired: comp.expired + credExpired,
    expiring: comp.expiring + credExpiring,
    gaps: comp.gaps,
    credentials: creds.length, credExpired, credExpiring,
    // At-the-bedside validation from the assignment board.
    validatedCare: (() => { const withPts = staffBoard.filter((s: any) => s.competencyOk != null); return withPts.length ? Math.round((withPts.filter((s: any) => s.competencyOk).length / withPts.length) * 100) : null; })(),
    needsSupervision: staffBoard.filter((s: any) => s.competencyOk === false).length,
  };

  // ── Module 4: Staff Support & Escalation ────────────────────────────────────
  const esc = (escRes.error ? [] : escRes.data ?? []) as any[];
  const openEsc = esc.filter(e => ["open", "acknowledged"].includes(e.status));
  const support = {
    openEscalations: escRes.error ? null : esc.filter(e => e.status === "open").length,
    inProgress: escRes.error ? null : esc.filter(e => e.status === "acknowledged").length,
    resolvedToday: escRes.error ? null : esc.filter(e => e.status === "resolved" && e.created_at >= todayStr).length,
    safetyAlerts: safetyRes.error ? null : (safetyRes.data ?? []).length,
    recentEscalations: openEsc.slice(0, 5).map((e: any) => ({ summary: e.summary, severity: e.severity, level: e.level, at: e.created_at })),
  };

  // ── Module 5: Workforce Intelligence ────────────────────────────────────────
  // Real: patients-per-nurse; derived shift score. Not backed: utilisation,
  // overtime, missed breaks, redeployment history, per-shift trend.
  const nurses = staffBoard.filter((s: any) => ["nurse", "charge"].includes(s.role)).length;
  const totalPatients = staffBoard.reduce((n: number, s: any) => n + s.patients, 0);
  const avgPtsPerNurse = nurses ? +(totalPatients / nurses).toFixed(1) : null;
  const workloadByStaff = staffBoard.filter((s: any) => s.patients > 0).sort((a: any, b: any) => b.patients - a.patients).slice(0, 6)
    .map((s: any) => ({ name: s.name, role: s.role, patients: s.patients, ok: s.competencyOk }));

  // Shift score = mean of the measurable factors (coverage, competency, safety).
  const factors: number[] = [];
  if (coverage != null) factors.push(coverage);
  if (comp.total) factors.push(comp.coverage);
  factors.push(openEsc.length === 0 ? 100 : Math.max(0, 100 - openEsc.length * 15));
  const shiftScore = mean(factors);

  return {
    ready: true as const,
    shift: sc.shift,
    overview: sc.overview,
    // Module data
    staffAssignment: { onDuty, rostered: sc.overview.rostered, roleMix, staffBoard, students },
    staffing: { coverage, vacancies, sickCalls, ratioRows, present: sc.overview.present, rostered: sc.overview.rostered },
    compliance,
    support,
    intelligence: { avgPtsPerNurse, totalPatients, nurses, workloadByStaff, shiftScore, openEscalations: openEsc.length },
    copilot: sc.copilot,
    generatedAt: new Date().toISOString(),
  };
}
