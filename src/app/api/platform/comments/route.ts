import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { loadThread, loadCollaboration } from "@/lib/platform/collaboration";

// Collaboration Service API (PCS-000 Collaboration) over plat_comments. GET returns a
// single-entity thread (?entity_type=&entity_id=) or the platform activity feed. POST
// creates a comment/reply (with @-mentions); PATCH edits your own; DELETE soft-deletes
// your own (super can moderate any). Staff tier, tenant-scoped, audit-logged. 409 hint
// until migration 078 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 078 to enable collaboration" }, { status: 409 }) : null;

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const url = new URL(req.url);
  const et = url.searchParams.get("entity_type"), eid = url.searchParams.get("entity_id");
  if (et && eid) return NextResponse.json(await loadThread(c.admin as any, et, eid), { headers: { "Cache-Control": "no-store" } });
  const feed = await loadCollaboration(c.admin as any, c.hospitalId ?? null, isSuper(c));
  return NextResponse.json(feed, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!String(b.body ?? "").trim()) return badRequest("body required");
  const mentions = Array.isArray(b.mentions) ? b.mentions.filter((x: any) => typeof x === "string").slice(0, 50) : [];

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("plat_comments").insert({
    hospital_id: c.hospitalId ?? (isSuper(c) ? null : NONE),
    entity_type: String(b.entity_type ?? "platform_note").slice(0, 60),
    entity_id: b.entity_id ?? c.hospitalId ?? NONE,
    parent_id: b.parent_id ?? null, body: String(b.body).trim(), mentions,
    author_id: c.userId, author_name: me?.full_name ?? null,
  }).select("id, entity_type, entity_id, parent_id").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: b.parent_id ? "reply_comment" : "create_comment", entity_type: "plat_comment", entity_id: data.id, entity_name: `${data.entity_type}:${String(data.entity_id).slice(0, 8)}`, hospital_id: c.hospitalId ?? null });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const b = await req.json().catch(() => ({}));
  if (!String(b.body ?? "").trim()) return badRequest("body required");
  const { data: row } = await c.admin.from("plat_comments").select("author_id, hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  if (row.author_id !== c.userId && !isSuper(c)) return forbidden("You can only edit your own comments");

  const { data, error } = await c.admin.from("plat_comments").update({ body: String(b.body).trim(), edited_at: new Date().toISOString() }).eq("id", id).select("id").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "edit_comment", entity_type: "plat_comment", entity_id: id, hospital_id: row.hospital_id ?? null });
  return NextResponse.json(data);
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const { data: row } = await c.admin.from("plat_comments").select("author_id, hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  if (row.author_id !== c.userId && !isSuper(c)) return forbidden("You can only delete your own comments");

  const { error } = await c.admin.from("plat_comments").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: "delete_comment", entity_type: "plat_comment", entity_id: id, hospital_id: row.hospital_id ?? null });
  return NextResponse.json({ ok: true });
}
