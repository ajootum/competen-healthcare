import { NextResponse } from "next/server";
import { getCaller, isResponse, requireRole, badRequest, ADMIN_ROLES, isSuper } from "@/lib/api-auth";
import { createServiceProfile } from "@/lib/cgr/service-profiles";

// CGR-028 — Service profile write path (migration 151). A profile states what a SERVICE requires — which
// competencies, at what minimum level, held by how many staff, and which requirements are CRITICAL. Defining
// requirements is a governance act: admin-gated, every change audited, and the activation gate never evaluates
// a draft profile.
//
// Tenancy note (deliberate, NOT the caller-scoping bug): a profile is a NEW top-level record created by its
// owner and references no tenant-scoped subject — the audit's cleared pattern. hospital_id = the caller's;
// null (super_admin) = a SHARED template, same convention as the frameworks master library.
/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUSES = new Set(["draft", "active", "retired"]);
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Apply migration 151 to enable service profiles." }, { status: 503 }) : null;

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const gate = requireRole(c, ADMIN_ROLES);
  if (gate) return gate;

  const b = await req.json().catch(() => ({}));
  const reqs = Array.isArray(b.requirements) ? b.requirements : [];
  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();

  // The creation engine (validation, insert, rollback) lives in @/lib/cgr/service-profiles so the shipped
  // logic is directly exercisable; this route owns auth + tenancy + audit.
  const r = await createServiceProfile(c.admin, {
    name: b.name, code: b.code, description: b.description, requirements: reqs,
    hospitalId: c.hospitalId,   // null for super = shared template (see tenancy note above)
    createdBy: c.userId, createdByName: me?.full_name ?? null,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  await c.admin.from("audit_log").insert({ trace_id: c.traceId,
    actor_id: c.userId, actor_name: me?.full_name ?? null, action: "service_profile_created",
    entity_type: "service_profile", entity_id: r.profile.id, entity_name: r.profile.name,
    hospital_id: c.hospitalId, new_value: { requirements: reqs.length, critical: reqs.filter((x: any) => x.is_critical).length },
  }).then((x: any) => x, () => {});

  return NextResponse.json({ ok: true, profile: r.profile }, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const gate = requireRole(c, ADMIN_ROLES);
  if (gate) return gate;

  const b = await req.json().catch(() => ({}));
  const { id, status } = b ?? {};
  if (!id) return badRequest("Missing profile id");
  if (!STATUSES.has(status)) return badRequest("status must be draft | active | retired");

  const { data: existing } = await c.admin.from("service_profiles").select("id, name, status, hospital_id").eq("id", id).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Shared templates (hospital_id null) are super-only to change; tenant profiles need tenant match.
  if (!isSuper(c) && existing.hospital_id !== c.hospitalId) return NextResponse.json({ error: "Out of scope" }, { status: 403 });

  const { data, error } = await c.admin.from("service_profiles").update({ status }).eq("id", id).select("id, name, status").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  await c.admin.from("audit_log").insert({ trace_id: c.traceId,
    actor_id: c.userId, actor_name: me?.full_name ?? null, action: `service_profile_${status}`,
    entity_type: "service_profile", entity_id: id, entity_name: existing.name,
    hospital_id: existing.hospital_id, old_value: { status: existing.status }, new_value: { status },
  }).then((r: any) => r, () => {});

  return NextResponse.json({ ok: true, profile: data });
}
