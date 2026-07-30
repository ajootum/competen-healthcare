import { NextResponse } from "next/server";
import { getCaller, isResponse, requireRole, badRequest, ADMIN_ROLES, isSuper } from "@/lib/api-auth";

// CGR-028 — Service profile write path (migration 151). A profile states what a SERVICE requires — which
// competencies, at what minimum level, held by how many staff, and which requirements are CRITICAL. Defining
// requirements is a governance act: admin-gated, every change audited, and the activation gate never evaluates
// a draft profile.
//
// Tenancy note (deliberate, NOT the caller-scoping bug): a profile is a NEW top-level record created by its
// owner and references no tenant-scoped subject — the audit's cleared pattern. hospital_id = the caller's;
// null (super_admin) = a SHARED template, same convention as the frameworks master library.
/* eslint-disable @typescript-eslint/no-explicit-any */

const LEVELS = new Set(["novice", "advanced_beginner", "competent", "proficient", "expert", "mentor", "authority"]);
const STATUSES = new Set(["draft", "active", "retired"]);
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Apply migration 151 to enable service profiles." }, { status: 503 }) : null;

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const gate = requireRole(c, ADMIN_ROLES);
  if (gate) return gate;

  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "").trim();
  if (!name) return badRequest("name required");
  const reqs = Array.isArray(b.requirements) ? b.requirements : [];
  if (!reqs.length) return badRequest("at least one required competency is needed — a profile with no requirements gates nothing");

  // Validate every competency id against reality before writing (the suggest-links lesson): a requirement
  // referencing a competency that doesn't exist would 500 on the FK — reject it cleanly instead.
  const ids = [...new Set(reqs.map((r: any) => r?.competency_id).filter(Boolean))];
  if (!ids.length || ids.length !== reqs.length) return badRequest("every requirement needs a distinct competency_id");
  const { data: comps } = await c.admin.from("framework_competencies").select("id").in("id", ids);
  const known = new Set((comps ?? []).map((x: any) => x.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) return badRequest(`Unknown competency id(s): ${unknown.map((x) => String(x).slice(0, 8)).join(", ")}…`);
  for (const r of reqs) {
    if (r.min_level && !LEVELS.has(r.min_level)) return badRequest(`Unknown min_level ${r.min_level}`);
    if (r.min_staff != null && (!Number.isInteger(r.min_staff) || r.min_staff < 1)) return badRequest("min_staff must be an integer >= 1");
  }

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data: profile, error } = await c.admin.from("service_profiles").insert({
    hospital_id: c.hospitalId,   // null for super = shared template (see tenancy note above)
    name, code: String(b.code ?? "").trim() || null, description: String(b.description ?? "").trim() || null,
    status: "draft", created_by: c.userId, created_by_name: me?.full_name ?? null,
  }).select("id, name").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  const { error: rerr } = await c.admin.from("service_required_competencies").insert(reqs.map((r: any) => ({
    profile_id: profile.id, competency_id: r.competency_id,
    min_staff: r.min_staff ?? 1, min_level: r.min_level ?? null,
    is_critical: !!r.is_critical, notes: String(r.notes ?? "").trim() || null,
  })));
  if (rerr) {
    await c.admin.from("service_profiles").delete().eq("id", profile.id);   // no half-written profiles
    return NextResponse.json({ error: rerr.message }, { status: 500 });
  }

  await c.admin.from("audit_log").insert({
    actor_id: c.userId, actor_name: me?.full_name ?? null, action: "service_profile_created",
    entity_type: "service_profile", entity_id: profile.id, entity_name: profile.name,
    hospital_id: c.hospitalId, new_value: { requirements: reqs.length, critical: reqs.filter((r: any) => r.is_critical).length },
  }).then((r: any) => r, () => {});

  return NextResponse.json({ ok: true, profile }, { status: 201 });
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
  await c.admin.from("audit_log").insert({
    actor_id: c.userId, actor_name: me?.full_name ?? null, action: `service_profile_${status}`,
    entity_type: "service_profile", entity_id: id, entity_name: existing.name,
    hospital_id: existing.hospital_id, old_value: { status: existing.status }, new_value: { status },
  }).then((r: any) => r, () => {});

  return NextResponse.json({ ok: true, profile: data });
}
