import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { loadPlanningConfig, DEFAULT_PLANNING } from "@/lib/config/wps-config";

// Workforce Planning Studio config API (WPS-001) over wps_config. GET returns the tenant's
// effective planning parameters (published config merged over defaults). PUT publishes an
// updated config document (validated + clamped), bumps the version and audit-logs it — the
// Establishment engine + WSE engines then consume the published values. Unit-Manager /
// Workforce-Admin tier. 409 hint until migration 081 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const isManager = (c: any) => isSuper(c) || (c.roles ?? []).includes("hospital_admin");
const migrationGate = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 081 to enable planning configuration" }, { status: 409 }) : null;
const clamp = (v: any, min: number, max: number, def: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const cfg = await loadPlanningConfig(c.admin as any, c.hospitalId ?? null, isSuper(c));
  return NextResponse.json(cfg, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isManager(c)) return forbidden("Workforce Admin access required");
  if (!c.hospitalId && !isSuper(c)) return badRequest("hospital context required");
  const b = await req.json().catch(() => ({}));
  const s = b.settings ?? {};
  const d = DEFAULT_PLANNING;

  // Validate + clamp
  const settings = {
    contractedHoursWeek: clamp(s.contractedHoursWeek, 1, 60, d.contractedHoursWeek),
    annualLeaveDays: clamp(s.annualLeaveDays, 0, 45, d.annualLeaveDays),
    studyLeaveDays: clamp(s.studyLeaveDays, 0, 20, d.studyLeaveDays),
    sicknessDays: clamp(s.sicknessDays, 0, 20, d.sicknessDays),
    publicHolidays: clamp(s.publicHolidays, 0, 15, d.publicHolidays),
    shiftHours: clamp(s.shiftHours, 6, 13, d.shiftHours),
    shiftsPerDay: clamp(s.shiftsPerDay, 1, 3, d.shiftsPerDay),
    floatPoolPct: clamp(s.floatPoolPct, 0, 30, d.floatPoolPct),
    maxShiftsWeek: clamp(s.maxShiftsWeek, 2, 7, d.maxShiftsWeek),
    nightMultiplier: clamp(s.nightMultiplier, 1, 2, d.nightMultiplier),
    overtimeMultiplier: clamp(s.overtimeMultiplier, 1, 2.5, d.overtimeMultiplier),
    agencyMultiplier: clamp(s.agencyMultiplier, 1, 3, d.agencyMultiplier),
    demandRatios: {
      critical_care: clamp(s.demandRatios?.critical_care, 1, 4, d.demandRatios.critical_care),
      theatre: clamp(s.demandRatios?.theatre, 1, 8, d.demandRatios.theatre),
      paediatric: clamp(s.demandRatios?.paediatric, 1, 8, d.demandRatios.paediatric),
      standard: clamp(s.demandRatios?.standard, 1, 12, d.demandRatios.standard),
    },
    roleRates: d.roleRates,
    currency: typeof s.currency === "string" ? s.currency.slice(0, 8) : d.currency,
  };

  const admin = c.admin as any;
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data: existing } = await admin.from("wps_config").select("id, version").eq("hospital_id", c.hospitalId ?? NONE).maybeSingle();
  const version = (existing?.version ?? 0) + 1;
  const { error } = await admin.from("wps_config").upsert(
    { hospital_id: c.hospitalId ?? NONE, settings, version, status: "published", updated_by: c.userId, updated_by_name: me?.full_name ?? null, updated_at: new Date().toISOString() },
    { onConflict: "hospital_id" },
  );
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: "publish_planning_config", entity_type: "wps_config", entity_name: `v${version}`, hospital_id: c.hospitalId ?? null, new_value: settings });
  return NextResponse.json({ ok: true, version });
}
