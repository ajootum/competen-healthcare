import { NextResponse } from "next/server";
import { getCaller, isResponse, isSupervisor, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { ASSIGNMENT_TYPES, ASSIGNMENT_SOURCES } from "@/lib/operations/supervisor-assignments";

// Shift supervisor assignments & confirmation (SSW-002 §6.3 / §8 / §9.2 / §15.3).
// POST assigns a supervisor (a new PRIMARY deactivates the prior active primary,
// preserving history). PATCH confirms or declines. Confirming a PRIMARY sets the
// shift's command owner (op_shifts.supervisor_id) and satisfies the
// supervisor_confirmed readiness item. Supervisor tier, tenant-scoped,
// audit-logged; 409 migration hint until 065 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 065 to enable supervisor assignments" }, { status: 409 }) : null;

async function shiftInScope(c: any, shiftId: string) {
  const { data } = await c.admin.from("op_shifts").select("hospital_id").eq("id", shiftId).maybeSingle();
  if (!data) return { ok: false as const, res: NextResponse.json({ error: "Shift not found" }, { status: 404 }) };
  if (!isSuper(c) && data.hospital_id !== c.hospitalId) return { ok: false as const, res: forbidden("Shift out of scope") };
  return { ok: true as const, hospitalId: data.hospital_id };
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  const shiftId = String(b.shift_id ?? "");
  if (!shiftId) return badRequest("shift_id required");
  if (!b.user_id) return badRequest("user_id required");
  const type = ASSIGNMENT_TYPES.includes(b.assignment_type) ? b.assignment_type : "primary";
  const source = ASSIGNMENT_SOURCES.includes(b.assignment_source) ? b.assignment_source : "manual";
  const scope = await shiftInScope(c, shiftId);
  if (!scope.ok) return scope.res;

  // Confirm the assignee is a real profile in the same tenant.
  const { data: assignee } = await c.admin.from("profiles").select("id, full_name, hospital_id").eq("id", b.user_id).maybeSingle();
  if (!assignee) return NextResponse.json({ error: "Assignee not found" }, { status: 404 });
  if (!isSuper(c) && scope.hospitalId && assignee.hospital_id && assignee.hospital_id !== scope.hospitalId) return forbidden("Assignee out of scope");

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();

  // A new PRIMARY replaces the prior active primary (preserve history, §9.2).
  if (type === "primary") {
    const deact = await c.admin.from("shift_supervisor_assignments").update({ active_status: false, updated_at: new Date().toISOString() })
      .eq("shift_id", shiftId).eq("assignment_type", "primary").eq("active_status", true);
    if (deact.error) return migrationGate(deact.error) ?? NextResponse.json({ error: deact.error.message }, { status: 500 });
  }

  const { data, error } = await c.admin.from("shift_supervisor_assignments").insert({
    shift_id: shiftId, hospital_id: scope.hospitalId ?? (isSuper(c) ? null : c.hospitalId ?? NONE),
    user_id: b.user_id, assignment_type: type, assignment_source: source,
    assigned_by: c.userId, assigned_by_name: me?.full_name ?? null,
  }).select("id, assignment_type, confirmation_status").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: `assign_supervisor_${type}`, entity_type: "shift_supervisor", entity_id: data.id, entity_name: assignee.full_name, hospital_id: scope.hospitalId ?? null });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const b = await req.json().catch(() => ({}));
  const action = b.action;
  if (!["confirm", "decline"].includes(action)) return badRequest("action must be confirm or decline");
  if (action === "decline" && !String(b.declined_reason ?? "").trim()) return badRequest("declined_reason required to decline");

  const { data: row, error: rowErr } = await c.admin.from("shift_supervisor_assignments")
    .select("id, shift_id, hospital_id, user_id, assignment_type").eq("id", id).maybeSingle();
  if (rowErr) return migrationGate(rowErr) ?? NextResponse.json({ error: rowErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const update: any = { updated_at: new Date().toISOString() };
  if (action === "confirm") { update.confirmation_status = "confirmed"; update.confirmed_at = new Date().toISOString(); update.declined_reason = null; }
  else { update.confirmation_status = "declined"; update.declined_reason = String(b.declined_reason).trim(); }

  const { data, error } = await c.admin.from("shift_supervisor_assignments").update(update).eq("id", id).select("id, confirmation_status, assignment_type").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  // Confirming the PRIMARY establishes command ownership + the readiness sign-off.
  if (action === "confirm" && row.assignment_type === "primary") {
    await c.admin.from("op_shifts").update({ supervisor_id: row.user_id }).eq("id", row.shift_id);
    await c.admin.from("shift_readiness_records").upsert({
      shift_id: row.shift_id, hospital_id: row.hospital_id, item_code: "supervisor_confirmed",
      status: "complete", responsible_user_id: c.userId, responsible_name: me?.full_name ?? null,
      completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: "shift_id,item_code" });
  }

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: `supervisor_${data.confirmation_status}`, entity_type: "shift_supervisor", entity_id: data.id, hospital_id: row.hospital_id ?? null });
  return NextResponse.json(data);
}
