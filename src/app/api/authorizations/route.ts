import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isEducator, assertProfileScope, assertRowScope } from "@/lib/api-auth";

// POST — grant a clinical authorization to a nurse
export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();

  const { nurse_id, authorization_type, authorization_level, scope, conditions, expiry_date, based_on_decision, activities } = await req.json();
  if (!nurse_id) return NextResponse.json({ error: "nurse_id required" }, { status: 400 });
  // The nurse being authorized must be in the caller's hospital.
  const scopeErr = await assertProfileScope(c, nurse_id);
  if (scopeErr) return scopeErr;

  const admin = c.admin;
  const { data: nurse } = await admin.from("profiles").select("hospital_id").eq("id", nurse_id).single();
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();

  const { data: cao, error } = await admin.from("clinical_authorizations").insert({
    nurse_id,
    hospital_id: nurse?.hospital_id ?? c.hospitalId ?? null,
    authorization_type: authorization_type ?? "clinical_privilege",
    authorization_level: authorization_level ?? "independent",
    status: "active",
    scope: scope ?? null,
    conditions: conditions ?? null,
    expiry_date: expiry_date ?? null,
    based_on_decision: based_on_decision ?? null,
    granted_by: c.userId,
    granted_by_name: me?.full_name ?? null,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (Array.isArray(activities) && activities.length) {
    await admin.from("authorization_activities").insert(
      activities.map((a: { cpu_id?: string; competency_id?: string; label: string }) => ({
        authorization_id: cao.id, cpu_id: a.cpu_id ?? null, competency_id: a.competency_id ?? null, label: a.label,
      }))
    );
  }

  await admin.from("audit_log").insert({
    actor_id: c.userId, actor_name: me?.full_name ?? null,
    action: "grant_authorization", entity_type: "authorization", entity_id: cao.id,
    new_value: { nurse_id, authorization_type, authorization_level },
  });

  return NextResponse.json(cao, { status: 201 });
}

// PATCH — change status (suspend / revoke / reactivate)
export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();

  const { id, status } = await req.json();
  if (!id || !["pending", "active", "suspended", "revoked", "expired"].includes(status)) {
    return NextResponse.json({ error: "id and valid status required" }, { status: 400 });
  }
  // The authorization must belong to the caller's hospital.
  const scopeErr = await assertRowScope(c, "clinical_authorizations", id);
  if (scopeErr) return scopeErr;

  const admin = c.admin;
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();
  await admin.from("clinical_authorizations").update({ status }).eq("id", id);
  await admin.from("audit_log").insert({
    actor_id: c.userId, actor_name: me?.full_name ?? null,
    action: "update_authorization", entity_type: "authorization", entity_id: id,
    new_value: { status },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const scopeErr = await assertRowScope(c, "clinical_authorizations", id);
  if (scopeErr) return scopeErr;
  await c.admin.from("clinical_authorizations").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
