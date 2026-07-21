import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { TEMPLATE_TYPES, NEXT_STATUS } from "@/lib/enterprise/templates";
import { ORG_STATUSES } from "@/lib/enterprise/organisations";

// Enterprise Templates (ENT-001 §6) — registry + lifecycle + deployment.
// Super_admin only. Lifecycle transitions are validated against NEXT_STATUS.
// Deploy currently provisions ORGANISATION templates into a new organisation
// (a real minimal deployment); other types report an honest not-yet state.
/* eslint-disable @typescript-eslint/no-explicit-any */

const clean = (v: any, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  if (!clean(b.name)) return badRequest("name required");

  const insert = {
    name: clean(b.name), code: clean(b.code, 40), description: clean(b.description, 500),
    template_type: TEMPLATE_TYPES.includes(b.template_type) ? b.template_type : "organisation",
    version_major: 1, version_minor: 0, status: "draft", spec: {}, created_by: c.userId,
  };
  const { data, error } = await admin.from("ent_templates").insert(insert).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "create_template", entity_type: "template", entity_id: data.id, entity_name: data.name });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = c.admin as any;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const { data: row } = await admin.from("ent_templates").select("*").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = await req.json().catch(() => ({}));

  // Lifecycle transition (validated).
  if (b.action === "transition") {
    const allowed = (NEXT_STATUS[row.status] ?? []).some(t => t.to === b.to);
    if (!allowed) return badRequest(`cannot move from ${row.status} to ${b.to}`);
    const { error } = await admin.from("ent_templates").update({ status: b.to, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_log").insert({ actor_id: c.userId, action: `template_${b.to}`, entity_type: "template", entity_id: id, entity_name: row.name });
    return NextResponse.json({ ok: true, status: b.to });
  }

  // Version bump.
  if (b.action === "bump_minor" || b.action === "bump_major") {
    const update = b.action === "bump_major" ? { version_major: (row.version_major ?? 1) + 1, version_minor: 0 } : { version_minor: (row.version_minor ?? 0) + 1 };
    const { error } = await admin.from("ent_templates").update({ ...update, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, ...update });
  }

  // Deploy — organisation templates create a new organisation from local variables.
  if (b.action === "deploy") {
    if (row.status !== "published") return badRequest("only published templates can be deployed");
    if (row.template_type !== "organisation") return badRequest(`Deployment for ${row.template_type} templates activates with the deployment engine — organisation templates deploy now.`);
    if (!clean(b.org_name)) return badRequest("organisation name required");
    const status = ORG_STATUSES.includes(b.org_status) ? b.org_status : "onboarding";
    const { data: org, error } = await admin.from("organisations").insert({
      name: clean(b.org_name), org_code: clean(b.org_code, 40), hq_country: clean(b.hq_country, 80) ?? "Kenya", status, type: "private",
    }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // The template stays 'published' so a reusable template can be deployed to
    // more than one organisation; the deployment is recorded in the audit trail.
    await admin.from("ent_templates").update({ updated_at: new Date().toISOString() }).eq("id", id);
    await admin.from("audit_log").insert({ actor_id: c.userId, action: "deploy_template", entity_type: "template", entity_id: id, entity_name: row.name });
    await admin.from("audit_log").insert({ actor_id: c.userId, action: "create_organisation", entity_type: "organisation", entity_id: org.id, entity_name: org.name });
    return NextResponse.json({ ok: true, organisation_id: org.id });
  }

  // Plain edit.
  const update: any = {};
  if (b.name !== undefined) { const n = clean(b.name); if (!n) return badRequest("name cannot be empty"); update.name = n; }
  if (b.code !== undefined) update.code = clean(b.code, 40);
  if (b.description !== undefined) update.description = clean(b.description, 500);
  if (!Object.keys(update).length) return badRequest("no valid fields");
  update.updated_at = new Date().toISOString();
  const { data, error } = await admin.from("ent_templates").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "update_template", entity_type: "template", entity_id: id, entity_name: data.name });
  return NextResponse.json(data);
}
