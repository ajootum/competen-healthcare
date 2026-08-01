import { NextResponse } from "next/server";
import { getCaller, isResponse, isAdmin, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { canTransition, allowedNext, isActiveState, STATE_LABEL } from "@/lib/ogs/lifecycle";

// OGS write-workflow — office lifecycle transition (activate / suspend / restructure / close / dissolve /
// archive). PATCH validates the move against the governance transition map, updates the office and records
// an immutable ogs_lifecycle_transitions row. Admin-tier, tenant-scoped, audit-logged.
/* eslint-disable @typescript-eslint/no-explicit-any */

const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migrations 116/117 to enable the office model" }, { status: 409 }) : null;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden("Changing an office's state requires admin authority");
  const id = (await params).id;

  const { data: office, error: readErr } = await c.admin.from("ogs_offices").select("id, name, status, hospital_id").eq("id", id).maybeSingle();
  if (readErr) return migrationGate(readErr) ?? NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!office) return NextResponse.json({ error: "Office not found" }, { status: 404 });
  if (!isSuper(c) && office.hospital_id && office.hospital_id !== c.hospitalId) return forbidden("Office out of scope");

  const b = await req.json().catch(() => ({}));
  const toState = String(b.to_state ?? "");
  if (!canTransition(office.status, toState)) {
    const opts = allowedNext(office.status).map(s => STATE_LABEL[s] ?? s).join(", ") || "none";
    return badRequest(`Cannot move from "${STATE_LABEL[office.status] ?? office.status}" to "${STATE_LABEL[toState] ?? (toState || "?")}". Allowed: ${opts}`);
  }
  const reason = typeof b.reason === "string" && b.reason.trim() ? b.reason.trim() : `Transitioned to ${STATE_LABEL[toState] ?? toState}`;

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const actor = me?.full_name ?? null;

  const { data: updated, error } = await c.admin.from("ogs_offices").update({ status: toState, is_active: isActiveState(toState) }).eq("id", id).select("id, status").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("ogs_lifecycle_transitions").insert({ office_id: id, from_state: office.status, to_state: toState, reason, actor_name: actor });
  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, actor_name: actor, action: `office_${toState}`, entity_type: "ogs_office", entity_id: id, hospital_id: office.hospital_id ?? null, old_value: { status: office.status }, new_value: { status: toState, reason } });
  return NextResponse.json(updated);
}
