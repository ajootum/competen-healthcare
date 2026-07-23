// Workforce Planning Studio config (WPS-001). The single source of truth for the tenant's
// workforce-planning parameters. loadPlanningConfig reads the published wps_config document
// (migration 081) and merges it over the platform defaults, so the Establishment engine and
// the WSE scheduling engines consume published configuration where set and fall back to
// documented defaults otherwise — no fabricated values. computePlanningModel derives the
// relief factor / productive hours / FTE-per-post from the effective settings.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";

export type PlanningSettings = {
  contractedHoursWeek: number;
  annualLeaveDays: number; studyLeaveDays: number; sicknessDays: number; publicHolidays: number;
  shiftHours: number; shiftsPerDay: number; floatPoolPct: number; maxShiftsWeek: number;
  demandRatios: { critical_care: number; theatre: number; paediatric: number; standard: number };
  roleRates: Record<string, number>;
  nightMultiplier: number; overtimeMultiplier: number; agencyMultiplier: number;
  currency: string;
};

// Platform defaults (NHS-style) — used verbatim until a tenant publishes overrides.
export const DEFAULT_PLANNING: PlanningSettings = {
  contractedHoursWeek: 37.5,
  annualLeaveDays: 30, studyLeaveDays: 5, sicknessDays: 8, publicHolidays: 8,
  shiftHours: 12, shiftsPerDay: 2, floatPoolPct: 10, maxShiftsWeek: 4,
  demandRatios: { critical_care: 2, theatre: 3, paediatric: 4, standard: 6 },
  roleRates: { charge: 32, nurse: 25, doctor: 45, therapist: 28, support: 15, float: 27, educator: 30, assessor: 30 },
  nightMultiplier: 1.3, overtimeMultiplier: 1.5, agencyMultiplier: 1.8,
  currency: "GBP",
};

// The parameters the editor exposes, grouped for the UI.
export const PLANNING_FIELDS = [
  { group: "Contract & shifts", keys: [["contractedHoursWeek", "Contracted hours / week", 1, 60, 0.5], ["shiftHours", "Shift length (hours)", 6, 13, 0.5], ["shiftsPerDay", "Shifts / day (cover)", 1, 3, 1], ["maxShiftsWeek", "Max shifts / week", 2, 7, 1]] },
  { group: "Leave & relief (days/yr)", keys: [["annualLeaveDays", "Annual leave", 0, 45, 1], ["studyLeaveDays", "Study leave", 0, 20, 1], ["sicknessDays", "Sickness allowance", 0, 20, 1], ["publicHolidays", "Public holidays", 0, 15, 1], ["floatPoolPct", "Float pool (% of direct)", 0, 30, 1]] },
  { group: "Pay premiums", keys: [["nightMultiplier", "Night differential ×", 1, 2, 0.05], ["overtimeMultiplier", "Overtime ×", 1, 2.5, 0.05], ["agencyMultiplier", "Agency ×", 1, 3, 0.1]] },
] as const;

export async function loadPlanningConfig(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  let row: any = null; let provisioned = true;
  try {
    const probe = await admin.from("wps_config").select("id").limit(1);
    if (probe.error && /does not exist|schema cache/i.test(probe.error.message ?? "")) provisioned = false;
    else { const { data } = await scope(admin.from("wps_config").select("*").order("updated_at", { ascending: false })).limit(1); row = (data ?? [])[0] ?? null; }
  } catch { provisioned = false; }

  const stored = (row?.settings ?? {}) as Partial<PlanningSettings>;
  const settings: PlanningSettings = {
    ...DEFAULT_PLANNING, ...stored,
    demandRatios: { ...DEFAULT_PLANNING.demandRatios, ...(stored.demandRatios ?? {}) },
    roleRates: { ...DEFAULT_PLANNING.roleRates, ...(stored.roleRates ?? {}) },
  };
  return { settings, provisioned, configured: !!row, version: row?.version ?? 0, updatedAt: row?.updated_at ?? null, updatedByName: row?.updated_by_name ?? null };
}

export function computePlanningModel(s: PlanningSettings) {
  const annualContracted = s.contractedHoursWeek * 52;
  const workingDayHours = s.contractedHoursWeek / 5;
  const nonProductiveDays = s.annualLeaveDays + s.studyLeaveDays + s.sicknessDays + s.publicHolidays;
  const nonProductiveHours = nonProductiveDays * workingDayHours;
  const annualProductive = Math.max(1, annualContracted - nonProductiveHours);
  const reliefFactor = +(annualContracted / annualProductive).toFixed(3);
  const hoursPerPostPerYear = s.shiftHours * s.shiftsPerDay * 7 * 52;
  const ftePerPost = +(hoursPerPostPerYear / annualProductive).toFixed(2);
  return { annualContracted, workingDayHours, nonProductiveDays, nonProductiveHours, annualProductive, reliefFactor, ftePerPost };
}
