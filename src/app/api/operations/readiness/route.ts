import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { READINESS_CODES, READINESS_STATUSES } from "@/lib/operations/readiness";

// Shift readiness records (SSW-002 §6.4 / §15.4). GET lists the checklist for a
// shift; PATCH upserts one item's status (a documented exception requires a
// reason, per §10.1). Operational staff (supervisor tier) only, tenant-scoped,
// audit-logged; 409 migration hint until 064 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 064 to enable shift readiness records" }, { status: 409 }) : null;

// Confirm the shift is in the caller's tenant before touching its readiness rows.
async function shiftInScope(c: any, shiftId: string) {
  const { data } = await c.admin.from("op_shifts").select("hospital_id").eq("id", shiftId).maybeSingle();
  if (!data) return { ok: false as const, res: NextResponse.json({ error: "Shift not found" }, { status: 404 }) };
  if (!isSuper(c) && data.hospital_id !== c.hospitalId) return { ok: false as const, res: forbidden("Shift out of scope") };
  return { ok: true as const, hospitalId: data.hospital_id };
}

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const shiftId = new URL(req.url).searchParams.get("shift_id");
  if (!shiftId) return badRequest("shift_id required");
  const scope = await shiftInScope(c, shiftId);
  if (!scope.ok) return scope.res;

  const { data, error } = await c.admin.from("shift_readiness_records").select("*").eq("shift_id", shiftId);
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const url = new URL(req.url);
  const shiftId = url.searchParams.get("shift_id");
  if (!shiftId) return badRequest("shift_id required");
  const scope = await shiftInScope(c, shiftId);
  if (!scope.ok) return scope.res;

  const b = await req.json().catch(() => ({}));
  const itemCode = String(b.item_code ?? url.searchParams.get("item_code") ?? "");
  if (!READINESS_CODES.includes(itemCode)) return badRequest("valid item_code required");
  if (!READINESS_STATUSES.includes(b.status)) return badRequest("valid status required");
  if (b.status === "exception" && !String(b.exception_reason ?? "").trim()) return badRequest("exception_reason required for an exception");

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const done = b.status === "complete" || b.status === "not_applicable" || b.status === "exception";
  const row = {
    shift_id: shiftId, hospital_id: scope.hospitalId ?? (isSuper(c) ? null : c.hospitalId ?? NONE),
    item_code: itemCode, status: b.status,
    responsible_user_id: c.userId, responsible_name: me?.full_name ?? null,
    completed_at: done ? new Date().toISOString() : null,
    exception_reason: b.status === "exception" ? String(b.exception_reason).trim() : null,
    escalation_required: !!b.escalation_required,
    notes: b.notes ? String(b.notes).trim() : null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await c.admin.from("shift_readiness_records")
    .upsert(row, { onConflict: "shift_id,item_code" }).select("id, item_code, status").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: `readiness_${b.status}`, entity_type: "shift_readiness", entity_id: data.id, entity_name: itemCode, hospital_id: scope.hospitalId ?? null, new_value: { status: b.status } });
  return NextResponse.json(data);
}
