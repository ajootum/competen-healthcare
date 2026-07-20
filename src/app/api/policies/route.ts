import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isAdmin, isStaff, isSuper } from "@/lib/api-auth";

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();

  const body = await req.json();
  const { title, policy_type, version, content, effective_date, review_date, framework_id, department_id } = body;
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  const { data, error } = await c.admin.from("policies").insert({
    title, policy_type: policy_type ?? "clinical", version: version ?? "1.0",
    content, created_by: c.userId,
    effective_date: effective_date || null,
    review_date: review_date || null,
    framework_id: framework_id ?? null,
    // Never trust a client-supplied hospital_id — bind to the caller's tenant.
    hospital_id: c.hospitalId,
    department_id: department_id ?? null,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();

  let q = c.admin.from("policies").select("id, title, policy_type, version, effective_date, review_date, is_active, created_at");
  // Tenant scope: the caller's hospital only (super = all). Any client-supplied
  // hospital_id is ignored in favour of the caller's own scope.
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? "__none__");
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
