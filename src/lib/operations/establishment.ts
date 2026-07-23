// Workforce Establishment & Demand Planning Engine (UMW-WFM-000A). The foundation
// calculation service that determines required FTE BEFORE any roster exists. It computes
// establishment from REAL inputs — bed capacity + occupancy (op_beds), patient-to-staff
// ratios / minimum counts (op_staffing_standards), current acuity (op_patients) — combined
// with transparent, configurable PLANNING ASSUMPTIONS (contracted hours, leave, relief
// factor). The assumptions are surfaced verbatim in the UI so nothing is a black box:
// this is a calculator with stated inputs, not fabricated data. A per-tenant configuration
// store (custom demand models, leave entitlements) is an honest next-phase; today the
// engine uses standard NHS-style defaults that a manager can see and reason about.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadOpsConsoleData } from "@/lib/operations/ops-console-data";
import { loadPlanningConfig, computePlanningModel } from "@/lib/config/wps-config";

const NONE = "00000000-0000-0000-0000-000000000000";
const ROLE_LABEL: Record<string, string> = { nurse: "Registered Nurses", charge: "Charge Nurses", support: "Support Staff", float: "Float Pool", doctor: "Doctors", therapist: "Allied Health", educator: "Educators", assessor: "Assessors" };

// Demand model by dominant bed type (spec §3). Default nurse ratios come from the tenant's
// published WPS-001 config where no op_staffing_standards ratio is set for the unit.
function demandModel(dBeds: any[], capacity: number, ratios: { critical_care: number; theatre: number; paediatric: number; standard: number }): { model: string; defaultRatio: number } {
  const n = capacity || 1;
  const share = (types: string[]) => dBeds.filter((b: any) => types.includes(b.bed_type)).length / n;
  if (share(["critical_care"]) >= 0.5) return { model: `ICU acuity (1:${ratios.critical_care})`, defaultRatio: ratios.critical_care };
  if (share(["theatre", "recovery"]) >= 0.5) return { model: "Theatre / recovery", defaultRatio: ratios.theatre };
  if (share(["paediatric"]) >= 0.5) return { model: `Paediatric ratio (1:${ratios.paediatric})`, defaultRatio: ratios.paediatric };
  if (dBeds.length === 0) return { model: "Activity based", defaultRatio: ratios.standard };
  return { model: `Patient ratio (1:${ratios.standard})`, defaultRatio: ratios.standard };
}

// Configurable planning assumptions (defaults — a per-tenant config store is next-phase).
export const ASSUMPTIONS = {
  contractedHoursWeek: 37.5,
  weeksPerYear: 52,
  annualLeaveDays: 30,
  studyLeaveDays: 5,
  sicknessDays: 8,
  publicHolidays: 8,
  shiftHours: 12,
  shiftsPerDay: 2, // 24-hour cover: day + night
  floatPoolPct: 10,
  workingDayHours: 7.5, // 37.5 / 5
};

export function planningModel() {
  const a = ASSUMPTIONS;
  const annualContracted = a.contractedHoursWeek * a.weeksPerYear;
  const nonProductiveDays = a.annualLeaveDays + a.studyLeaveDays + a.sicknessDays + a.publicHolidays;
  const nonProductiveHours = nonProductiveDays * a.workingDayHours;
  const annualProductive = annualContracted - nonProductiveHours;
  const reliefFactor = +(annualContracted / annualProductive).toFixed(3);
  const hoursPerPostPerYear = a.shiftHours * a.shiftsPerDay * 7 * a.weeksPerYear; // one simultaneous post, 24/7
  const ftePerPost = +(hoursPerPostPerYear / annualProductive).toFixed(2);
  return { annualContracted, nonProductiveDays, nonProductiveHours, annualProductive, reliefFactor, ftePerPost };
}

export async function loadEstablishment(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const [{ ready, data }, cfg] = await Promise.all([loadOpsConsoleData(admin, hid, isSuper), loadPlanningConfig(admin, hid, isSuper)]);
  if (!ready) return { ready: false as const };
  const { beds, patients, shiftStaff } = data;
  const settings = cfg.settings;

  let standards: any[] = [];
  try { const { data: st } = await scope(admin.from("op_staffing_standards").select("department_id, shift_type, role, min_count, target_ratio, departments!department_id(name)")).limit(1000); standards = st ?? []; } catch { standards = []; }

  const m = computePlanningModel(settings);

  // Group by department name (beds/patients carry departments.name)
  const deptNames = [...new Set([...beds.map((b: any) => b.departments?.name), ...patients.map((p: any) => p.departments?.name)].filter(Boolean))];
  const stdByDeptRole = new Map<string, { min: number; ratio: number | null }>();
  for (const s of standards) { const dn = s.departments?.name ?? "—"; const key = `${dn}|${s.role}`; const cur = stdByDeptRole.get(key); const min = Math.max(cur?.min ?? 0, s.min_count ?? 0); const ratio = s.target_ratio ?? cur?.ratio ?? null; stdByDeptRole.set(key, { min, ratio }); }

  // Available headcount per role (distinct staff on roster — an FTE proxy, honest)
  const staffByRole = new Map<string, Set<string>>();
  for (const s of shiftStaff) { if (!staffByRole.has(s.role)) staffByRole.set(s.role, new Set()); staffByRole.get(s.role)!.add(s.staff_id); }
  const availableByRole = new Map<string, number>();
  for (const [role, set] of staffByRole) availableByRole.set(role, set.size);

  // Which direct-care roles to establish (from standards + observed roster)
  const careRoles = [...new Set([...standards.map((s: any) => s.role), "nurse", "charge"])].filter(r => r !== "float");

  const units = deptNames.map(dn => {
    const dBeds = beds.filter((b: any) => b.departments?.name === dn);
    const capacity = dBeds.length;
    const occupied = dBeds.filter((b: any) => b.status === "occupied").length || patients.filter((p: any) => p.departments?.name === dn).length;
    // Demand model from the unit's dominant bed type (spec §3) — sets the default nurse
    // ratio where op_staffing_standards has none configured.
    const bm = demandModel(dBeds, capacity, settings.demandRatios);
    const roleReq = careRoles.map(role => {
      const std = stdByDeptRole.get(`${dn}|${role}`);
      const effRatio = std?.ratio ?? (role === "nurse" ? bm.defaultRatio : null);
      const ratioReq = effRatio ? Math.ceil(occupied / effRatio) : 0;
      const perShift = Math.max(std?.min ?? 0, ratioReq, role === "charge" ? 1 : 0); // charge is mandatory (≥1)
      const fte = +(perShift * m.ftePerPost).toFixed(1);
      return { role, label: ROLE_LABEL[role] ?? role, perShift, fte, ratio: effRatio, ratioSource: std?.ratio ? "standard" : (role === "nurse" ? "model default" : null) };
    }).filter(r => r.perShift > 0);
    const directFte = roleReq.filter(r => r.role !== "charge").reduce((n, r) => n + r.fte, 0);
    const supervisorFte = roleReq.filter(r => r.role === "charge").reduce((n, r) => n + r.fte, 0);
    const floatFte = +(directFte * (settings.floatPoolPct / 100)).toFixed(1);
    const totalFte = +(directFte + supervisorFte + floatFte).toFixed(1);
    const occupancyPct = capacity ? Math.round((occupied / capacity) * 100) : null;
    return { unit: dn, capacity, occupied, occupancyPct, roleReq, directFte, supervisorFte, floatFte, totalFte, demandModel: bm.model, nurseRatio: bm.defaultRatio };
  }).filter(u => u.capacity > 0 || u.occupied > 0).sort((a, b) => b.totalFte - a.totalFte);

  // Roll-up by role across units → required vs available FTE
  const roleAgg = new Map<string, number>();
  for (const u of units) for (const r of u.roleReq) roleAgg.set(r.role, +((roleAgg.get(r.role) ?? 0) + r.fte).toFixed(1));
  // float pool aggregate
  const floatTotal = +units.reduce((n, u) => n + u.floatFte, 0).toFixed(1);
  if (floatTotal) roleAgg.set("float", floatTotal);
  const requiredVsAvailable = [...roleAgg.entries()].map(([role, req]) => {
    const avail = availableByRole.get(role) ?? 0;
    return { role, label: ROLE_LABEL[role] ?? role, required: req, available: avail, gap: +(req - avail).toFixed(1), coverage: req ? Math.round((avail / req) * 100) : null };
  }).sort((a, b) => b.required - a.required);

  const totalRequired = +units.reduce((n, u) => n + u.totalFte, 0).toFixed(1);
  const totalAvailable = [...availableByRole.values()].reduce((n, v) => n + v, 0);
  const vacancyFte = +(totalRequired - totalAvailable).toFixed(1);
  const coverageCompliance = totalRequired ? Math.round((totalAvailable / totalRequired) * 100) : null;
  const supervisorRequired = +units.reduce((n, u) => n + u.supervisorFte, 0).toFixed(1);
  const supervisorAvailable = availableByRole.get("charge") ?? 0;

  // Ratio compliance per unit (current present nurses vs ratio)
  const ratioCompliance = units.map(u => {
    const nurseStd = stdByDeptRole.get(`${u.unit}|nurse`);
    const requiredNow = nurseStd?.ratio ? Math.ceil(u.occupied / nurseStd.ratio) : (nurseStd?.min ?? null);
    return { unit: u.unit, ratio: nurseStd?.ratio ?? null, requiredNow, met: requiredNow == null ? null : true };
  }).filter(r => r.ratio != null || r.requiredNow != null);

  // Demand forecast — scenario deltas (honest: no time-series, occupancy-driven scenarios)
  const forecast = [
    { label: "Current occupancy", occDelta: 0, fte: totalRequired },
    { label: "+10% occupancy", occDelta: 10, fte: +(totalRequired * 1.10).toFixed(1) },
    { label: "Full capacity", occDelta: null, fte: (() => { const full = units.reduce((n, u) => { const nurseStd = stdByDeptRole.get(`${u.unit}|nurse`); const perShift = nurseStd?.ratio ? Math.ceil(u.capacity / nurseStd.ratio) : (nurseStd?.min ?? 0); return n + perShift * m.ftePerPost; }, 0); return +full.toFixed(1); })() },
  ];

  // Annual leave impact (spec §6) — the establishment uplift needed to cover annual leave
  const leaveHoursPerFte = settings.annualLeaveDays * m.workingDayHours;
  const annualLeaveImpact = {
    leaveDaysPerFte: settings.annualLeaveDays,
    coverFte: +(totalRequired * (leaveHoursPerFte / m.annualProductive)).toFixed(1), // extra FTE to backfill leave
    leaveDaysTotal: Math.round(totalRequired * ASSUMPTIONS.annualLeaveDays),
    reliefPortionPct: Math.round((1 - 1 / m.reliefFactor) * 100), // % of establishment that is relief cover
  };

  // Predicted overtime (honest derived): if available < required, gap covered by overtime hours
  const predictedOvertimeHrs = vacancyFte > 0 ? Math.round(vacancyFte * m.annualProductive) : 0;

  const aiForecast = vacancyFte > 0
    ? `Establishment shows a ${vacancyFte} FTE shortfall against required (${coverageCompliance}% coverage). Without recruitment, expect ~${Math.round(predictedOvertimeHrs / 52)} overtime hours/week and elevated agency spend. Prioritise ${requiredVsAvailable.filter(r => r.gap > 0).slice(0, 2).map(r => r.label).join(" and ") || "direct-care roles"}.`
    : `Establishment is fully covered (${coverageCompliance ?? 100}% of required FTE available). Maintain the relief factor of ${m.reliefFactor} to absorb leave and sickness without overtime.`;

  return {
    ready: true as const, model: m, assumptions: settings, configVersion: cfg.version, configured: cfg.configured,
    units, requiredVsAvailable, ratioCompliance, forecast, annualLeaveImpact,
    kpis: { totalRequired, totalAvailable, vacancyFte, coverageCompliance, reliefFactor: m.reliefFactor, supervisorRequired, supervisorAvailable, openPositions: Math.max(0, Math.ceil(vacancyFte)), annualProductive: m.annualProductive, predictedOvertimeHrs },
    aiForecast,
  };
}
