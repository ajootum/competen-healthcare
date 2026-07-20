import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isAdmin, assertRowScope } from "@/lib/api-auth";

export async function POST(request: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();

  const { department_id, name, unit_type, bed_count } = await request.json();
  if (!department_id || !name) return NextResponse.json({ error: "Department and name required" }, { status: 400 });

  // The parent department must belong to the caller's hospital (super = any).
  const scopeErr = await assertRowScope(c, "departments", department_id);
  if (scopeErr) return scopeErr;

  const admin = c.admin;
  const { data, error } = await admin.from("units").insert({ department_id, name, unit_type, bed_count }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, unit: data });
}
