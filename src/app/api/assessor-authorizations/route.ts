import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isAdmin, assertProfileScope, assertRowScope } from "@/lib/api-auth";

// Assessor scope matrix (User Account Architecture §17) — grants and revokes
// who may assess which CPU, at which independence level, until when.

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();

  const { user_id, cpu_id, independence, valid_until, restrictions } = await req.json();
  if (!user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });
  // The user being authorized as an assessor must be in the caller's hospital.
  const scopeErr = await assertProfileScope(c, user_id);
  if (scopeErr) return scopeErr;

  const admin = c.admin;
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await admin.from("assessor_authorizations").insert({
    user_id,
    hospital_id: c.hospitalId ?? null,
    cpu_id: cpu_id || null,
    independence: independence ?? "independent",
    valid_until: valid_until || null,
    restrictions: restrictions?.trim() || null,
    authorized_by: c.userId,
    authorized_by_name: me?.full_name ?? null,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_log").insert({
    actor_id: c.userId, actor_name: me?.full_name ?? null,
    action: "grant_assessor_authorization", entity_type: "assessor_authorization", entity_id: data.id,
    new_value: { user_id, cpu_id: cpu_id ?? "all", independence },
  });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const scopeErr = await assertRowScope(c, "assessor_authorizations", id);
  if (scopeErr) return scopeErr;

  const admin = c.admin;
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { error } = await admin.from("assessor_authorizations").update({ status: "revoked" }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({
    actor_id: c.userId, actor_name: me?.full_name ?? null,
    action: "revoke_assessor_authorization", entity_type: "assessor_authorization", entity_id: id,
  });
  return NextResponse.json({ ok: true });
}
