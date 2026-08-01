import { NextResponse } from "next/server";
import { getCaller, isResponse, isAdmin, isSuper, forbidden, badRequest, assertProfileScope, assertRowScope, subjectHospital } from "@/lib/api-auth";

// OGS write-workflow — delegate authority (OGS-003). POST records a delegation of a position/authority to a
// person for a period (adm_delegations, the same store the delegation centre reads). PATCH revokes one.
// Admin-tier, tenant-scoped, audit-logged. Delegations are hospital/position-scoped today (office-linking is
// the next-phase office-scoped delegation instrument).
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 110 to enable delegations" }, { status: 409 }) : null;
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);
const today = () => new Date().toISOString().slice(0, 10);

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden("Delegating authority requires admin authority");

  const b = await req.json().catch(() => ({}));
  const position = clean(b.position);
  if (!position) return badRequest("Position / authority title required");
  const delegateId = typeof b.delegate_id === "string" ? b.delegate_id : "";
  if (!delegateId) return badRequest("delegate_id required");
  const scope = await assertProfileScope(c, delegateId);
  if (scope) return scope;

  const validFrom = clean(b.valid_from) ?? today();
  const validTo = clean(b.valid_to);
  if (validTo && validTo < validFrom) return badRequest("valid_to must be on or after valid_from");
  const status = validFrom > today() ? "scheduled" : "active";
  // Delegated authority belongs to the DELEGATE's tenant. assertProfileScope returns early for super_admin, so
  // without this a platform-level delegation lands unscoped and shows up in every tenant's delegation centre.
  const delegateHospital = await subjectHospital(c, "profiles", delegateId);
  const hospitalId = isSuper(c) ? (delegateHospital ?? clean(b.hospital_id) ?? null) : (c.hospitalId ?? NONE);

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("adm_delegations").insert({
    hospital_id: hospitalId, position, delegate_id: delegateId, delegated_by: c.userId,
    valid_from: validFrom, valid_to: validTo, status,
  }).select("id, position, status").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, actor_name: me?.full_name ?? null, action: "delegate_authority", entity_type: "adm_delegation", entity_id: data.id, hospital_id: hospitalId, new_value: { position, status } });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden("Revoking a delegation requires admin authority");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const guard = await assertRowScope(c, "adm_delegations", id);
  if (guard) return guard;

  const { data, error } = await c.admin.from("adm_delegations").update({ status: "revoked" }).eq("id", id).select("id, status").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  await c.admin.from("audit_log").insert({ trace_id: c.traceId, actor_id: c.userId, actor_name: me?.full_name ?? null, action: "revoke_delegation", entity_type: "adm_delegation", entity_id: id });
  return NextResponse.json(data);
}
