import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { TRANSFER_REASONS } from "@/lib/operations/shift-closure";

// Command transfer (SSW-002 §8 / §9.5 / §15.3). POST initiates a transfer of
// operational command to an incoming supervisor; PATCH accepts (updating the
// shift's command owner) or rejects. Supervisor tier, tenant-scoped, audit-logged;
// 409 until 067 runs. Answers vision Q10 "who accepted command for the next shift?".
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 067 to enable command transfer" }, { status: 409 }) : null;

async function shiftInScope(c: any, shiftId: string) {
  const { data } = await c.admin.from("op_shifts").select("hospital_id, supervisor_id").eq("id", shiftId).maybeSingle();
  if (!data) return { ok: false as const, res: NextResponse.json({ error: "Shift not found" }, { status: 404 }) };
  if (!isSuper(c) && data.hospital_id !== c.hospitalId) return { ok: false as const, res: forbidden("Shift out of scope") };
  return { ok: true as const, hospitalId: data.hospital_id, currentOwner: data.supervisor_id };
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  const shiftId = String(b.shift_id ?? "");
  if (!shiftId) return badRequest("shift_id required");
  if (!b.to_user_id) return badRequest("to_user_id required");
  const reason = TRANSFER_REASONS.includes(b.reason) ? b.reason : "scheduled_end";
  const scope = await shiftInScope(c, shiftId);
  if (!scope.ok) return scope.res;

  const { data: to } = await c.admin.from("profiles").select("id, full_name, hospital_id").eq("id", b.to_user_id).maybeSingle();
  if (!to) return NextResponse.json({ error: "Incoming supervisor not found" }, { status: 404 });
  if (!isSuper(c) && scope.hospitalId && to.hospital_id && to.hospital_id !== scope.hospitalId) return forbidden("Incoming supervisor out of scope");

  const { data: from } = scope.currentOwner ? await c.admin.from("profiles").select("full_name").eq("id", scope.currentOwner).maybeSingle() : { data: null };
  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("command_transfer_records").insert({
    shift_id: shiftId, hospital_id: scope.hospitalId ?? (isSuper(c) ? null : c.hospitalId ?? NONE),
    from_user_id: scope.currentOwner ?? null, from_name: from?.full_name ?? null,
    to_user_id: to.id, to_name: to.full_name ?? null, reason,
    outstanding_summary: typeof b.outstanding_summary === "string" && b.outstanding_summary.trim() ? b.outstanding_summary.trim() : null,
    initiated_by: c.userId,
  }).select("id, status").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: "command_transfer_initiated", entity_type: "command_transfer", entity_id: data.id, entity_name: to.full_name, hospital_id: scope.hospitalId ?? null });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const b = await req.json().catch(() => ({}));
  const action = b.action;
  if (!["accept", "reject", "cancel"].includes(action)) return badRequest("action must be accept, reject or cancel");
  if (action === "reject" && !String(b.rejected_reason ?? "").trim()) return badRequest("rejected_reason required to reject");

  const { data: row, error: rowErr } = await c.admin.from("command_transfer_records")
    .select("id, shift_id, hospital_id, to_user_id, to_name, status").eq("id", id).maybeSingle();
  if (rowErr) return migrationGate(rowErr) ?? NextResponse.json({ error: rowErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  if (row.status !== "initiated") return badRequest("transfer already resolved");

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const update: any = { updated_at: new Date().toISOString() };
  if (action === "accept") { update.status = "accepted"; update.accepted_at = new Date().toISOString(); }
  else if (action === "reject") { update.status = "rejected"; update.rejected_reason = String(b.rejected_reason).trim(); }
  else update.status = "cancelled";

  const { data, error } = await c.admin.from("command_transfer_records").update(update).eq("id", id).select("id, status").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  // Accepting transfers command: the incoming supervisor becomes the owner (§8.3).
  if (action === "accept" && row.to_user_id) {
    await c.admin.from("op_shifts").update({ supervisor_id: row.to_user_id }).eq("id", row.shift_id);
  }

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: `command_transfer_${data.status}`, entity_type: "command_transfer", entity_id: data.id, entity_name: row.to_name, hospital_id: row.hospital_id ?? null });
  return NextResponse.json(data);
}
