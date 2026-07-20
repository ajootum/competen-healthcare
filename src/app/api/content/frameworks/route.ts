import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isStaff, isSuper } from "@/lib/api-auth";

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden(); // master-library authoring is super_admin only

  const body = await req.json();
  const { name, library, description } = body;
  if (!name || !library) return NextResponse.json({ error: "name and library required" }, { status: 400 });

  const { data, error } = await c.admin.from("frameworks").insert({ name, library, description, pub_status: "draft" }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();

  let q = c.admin.from("frameworks").select("id, name, library, sort_order, is_active").order("library").order("sort_order");
  // Tenant scope: the caller's own hospital frameworks + the shared master
  // library (hospital_id null). Super sees everything.
  if (!isSuper(c)) {
    q = c.hospitalId
      ? q.or(`hospital_id.eq.${c.hospitalId},hospital_id.is.null`)
      : q.is("hospital_id", null);
  }
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
