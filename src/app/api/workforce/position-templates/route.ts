import { NextResponse } from "next/server";
import { getCaller, isResponse, isAdmin, forbidden, badRequest } from "@/lib/api-auth";

// Position Templates — the version-controlled blueprint that drives provisioning.
/* eslint-disable @typescript-eslint/no-explicit-any */

const WORKSPACE_KEYS = ["nurse", "assessor", "educator", "hospital_admin"];

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const admin = c.admin as any;
  const libId = new URL(req.url).searchParams.get("library");
  let q = admin.from("position_templates").select("*").order("version", { ascending: false });
  if (libId) q = q.eq("position_library_id", libId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!b.position_library_id) return badRequest("position_library_id is required");
  const admin = c.admin as any;

  // Next version for this library entry.
  const { data: last } = await admin.from("position_templates").select("version").eq("position_library_id", b.position_library_id).order("version", { ascending: false }).limit(1).maybeSingle();
  const version = (last?.version ?? 0) + 1;

  const workspaces = Array.isArray(b.workspaces) ? b.workspaces.filter((w: string) => WORKSPACE_KEYS.includes(w)) : [];
  const { data, error } = await admin.from("position_templates").insert({
    position_library_id: b.position_library_id, version,
    workspaces,
    framework_ids: Array.isArray(b.framework_ids) ? b.framework_ids : [],
    resource_ids: Array.isArray(b.resource_ids) ? b.resource_ids : [],
    cpu_ids: Array.isArray(b.cpu_ids) ? b.cpu_ids : [],
    assessor_ids: Array.isArray(b.assessor_ids) ? b.assessor_ids : [],
    cycle_type: b.cycle_type || "orientation",
    assessment_programme: b.assessment_programme || "orientation",
    ai_context: b.ai_context?.trim() || null,
    change_summary: b.change_summary?.trim() || null,
    status: "draft", created_by: c.userId,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

// PATCH — edit a draft template, or publish it (?action=publish → status active,
// retiring the previously active version of the same library entry).
export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const action = url.searchParams.get("action");
  if (!id) return badRequest("id required");
  const admin = c.admin as any;
  const { data: tpl } = await admin.from("position_templates").select("id, position_library_id, status").eq("id", id).maybeSingle();
  if (!tpl) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (action === "publish") {
    await admin.from("position_templates").update({ status: "retired" }).eq("position_library_id", tpl.position_library_id).eq("status", "active");
    const { data, error } = await admin.from("position_templates").update({ status: "active" }).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_log").insert({ actor_id: c.userId, action: "publish_position_template", entity_type: "position_template", entity_id: id });
    return NextResponse.json(data);
  }

  const body = await req.json().catch(() => ({}));
  const allowed = ["workspaces", "framework_ids", "resource_ids", "cpu_ids", "assessor_ids", "cycle_type", "assessment_programme", "ai_context", "change_summary"];
  const update = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
  if (Array.isArray(update.workspaces)) update.workspaces = (update.workspaces as string[]).filter(w => WORKSPACE_KEYS.includes(w));
  if (!Object.keys(update).length) return badRequest("no valid fields");
  const { data, error } = await admin.from("position_templates").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
