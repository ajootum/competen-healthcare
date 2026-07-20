import { NextResponse } from "next/server";
import { getCaller, isResponse, isAdmin, isSuper, forbidden, badRequest } from "@/lib/api-auth";

// Position Library — the catalogue of approved roles. Admin-managed, tenant-scoped.
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const admin = c.admin as any;
  let q = admin.from("position_library").select("*").order("created_at", { ascending: false });
  if (!isSuper(c)) q = q.or(`hospital_id.eq.${c.hospitalId ?? "00000000-0000-0000-0000-000000000000"},hospital_id.is.null`);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ positions: data ?? [] });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const { name, code, category, specialty, level } = await req.json().catch(() => ({}));
  if (!name?.trim()) return badRequest("name is required");
  const admin = c.admin as any;
  const { data, error } = await admin.from("position_library").insert({
    name: name.trim(), code: code?.trim() || null,
    category: category || "clinical", specialty: specialty?.trim() || null, level: level || "staff",
    hospital_id: isSuper(c) ? null : c.hospitalId, organisation_id: c.organisationId, created_by: c.userId,
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
  const { data: row } = await admin.from("position_library").select("hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const body = await req.json().catch(() => ({}));
  const allowed = ["name", "code", "category", "specialty", "level", "status"];
  const update = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(update).length) return badRequest("no valid fields");
  const { data, error } = await admin.from("position_library").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
