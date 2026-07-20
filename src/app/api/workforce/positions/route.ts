import { NextResponse } from "next/server";
import { getCaller, isResponse, isAdmin, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Positions — real organisational positions inside a department, bound to an
// active Position Template. Admin-managed, tenant-scoped.
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const admin = c.admin as any;
  let q = admin.from("positions").select("*, position_templates!template_id(id, version, workspaces, status), departments!department_id(name)").order("created_at", { ascending: false });
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? "00000000-0000-0000-0000-000000000000");
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ positions: data ?? [] });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  if (!b.title?.trim()) return badRequest("title is required");
  if (!b.template_id) return badRequest("template_id is required");
  const admin = c.admin as any;

  // The template must exist and be active before a position can use it.
  const { data: tpl } = await admin.from("position_templates").select("id, status").eq("id", b.template_id).maybeSingle();
  if (!tpl) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  if (tpl.status !== "active") return badRequest("Template must be published (active) before positions can use it");

  // A supplied department must be in the caller's hospital.
  const hospitalId = isSuper(c) ? (b.hospital_id ?? c.hospitalId) : c.hospitalId;
  if (b.department_id) {
    const { data: dept } = await admin.from("departments").select("hospital_id").eq("id", b.department_id).maybeSingle();
    if (!dept) return NextResponse.json({ error: "Department not found" }, { status: 404 });
    if (!isSuper(c) && dept.hospital_id !== c.hospitalId) return forbidden("Department out of scope");
  }

  const { data, error } = await admin.from("positions").insert({
    hospital_id: hospitalId, department_id: b.department_id ?? null, template_id: b.template_id,
    code: b.code?.trim() || null, title: b.title.trim(), supervisor_position_id: b.supervisor_position_id ?? null,
    created_by: c.userId,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const admin = c.admin as any;
  const { data: row } = await admin.from("positions").select("hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const body = await req.json().catch(() => ({}));
  const allowed = ["title", "code", "department_id", "supervisor_position_id", "status", "template_id"];
  const update = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(update).length) return badRequest("no valid fields");
  const { data, error } = await admin.from("positions").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
