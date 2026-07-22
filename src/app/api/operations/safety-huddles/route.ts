import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { HUDDLE_STATUSES } from "@/lib/operations/shift-records";

// Pre-shift safety huddle (SSW-002 §6.7 / §15.5). POST upserts the shift's huddle
// (one per shift). Marking it completed sets completed_at and satisfies the
// safety_huddle_prepared readiness item. Supervisor tier, tenant-scoped,
// audit-logged; 409 migration hint until 066 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 066 to enable safety huddles" }, { status: 409 }) : null;
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);

async function shiftInScope(c: any, shiftId: string) {
  const { data } = await c.admin.from("op_shifts").select("hospital_id").eq("id", shiftId).maybeSingle();
  if (!data) return { ok: false as const, res: NextResponse.json({ error: "Shift not found" }, { status: 404 }) };
  if (!isSuper(c) && data.hospital_id !== c.hospitalId) return { ok: false as const, res: forbidden("Shift out of scope") };
  return { ok: true as const, hospitalId: data.hospital_id };
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  const shiftId = String(b.shift_id ?? "");
  if (!shiftId) return badRequest("shift_id required");
  const scope = await shiftInScope(c, shiftId);
  if (!scope.ok) return scope.res;
  const status = HUDDLE_STATUSES.includes(b.completion_status) ? b.completion_status : "in_progress";

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const nowIso = new Date().toISOString();
  const att = Number(b.attendance_count); const attCount = Number.isFinite(att) && att >= 0 ? Math.round(att) : 0;
  const row: any = {
    shift_id: shiftId, hospital_id: scope.hospitalId ?? (isSuper(c) ? null : c.hospitalId ?? NONE),
    facilitator_user_id: c.userId, facilitator_name: me?.full_name ?? null,
    started_at: nowIso, attendance_count: attCount,
    patient_safety_concerns: clean(b.patient_safety_concerns), staffing_concerns: clean(b.staffing_concerns),
    operational_risks: clean(b.operational_risks), high_risk_patients: clean(b.high_risk_patients),
    equipment_issues: clean(b.equipment_issues), infection_prevention_concerns: clean(b.infection_prevention_concerns),
    planned_actions: clean(b.planned_actions), acknowledged_by_team: !!b.acknowledged_by_team,
    completion_status: status, updated_at: nowIso,
  };
  if (status === "completed") { row.completed_at = nowIso; row.acknowledged_by_team = true; }

  const { data, error } = await c.admin.from("safety_huddles").upsert(row, { onConflict: "shift_id" }).select("id, completion_status").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  // Completing the huddle satisfies the readiness sign-off (best-effort).
  if (status === "completed") {
    await c.admin.from("shift_readiness_records").upsert({
      shift_id: shiftId, hospital_id: scope.hospitalId ?? null, item_code: "safety_huddle_prepared",
      status: "complete", responsible_user_id: c.userId, responsible_name: me?.full_name ?? null,
      completed_at: nowIso, updated_at: nowIso,
    }, { onConflict: "shift_id,item_code" });
  }

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: `safety_huddle_${status}`, entity_type: "safety_huddle", entity_id: data.id, hospital_id: scope.hospitalId ?? null });
  return NextResponse.json(data, { status: 201 });
}
