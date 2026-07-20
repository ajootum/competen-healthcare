import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isAdmin, isEducator, isSuper } from "@/lib/api-auth";

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden(); // workflow automation is governance — admin only

  const { name, description, trigger_type, steps, hospital_id } = await req.json();
  if (!name || !trigger_type) return NextResponse.json({ error: "name and trigger_type required" }, { status: 400 });

  // Force the tenant: super may target any hospital (or null = global);
  // everyone else is pinned to their own hospital (client hospital_id ignored).
  const targetHospitalId = isSuper(c) ? (hospital_id ?? null) : c.hospitalId;

  const admin = c.admin;
  const { data, error } = await admin.from("workflow_templates").insert({
    name, description, trigger_type,
    steps: steps ?? [],
    hospital_id: targetHospitalId,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isEducator(c)) return forbidden();

  const admin = c.admin;
  let q = admin.from("workflow_templates").select("id, name, trigger_type, steps, is_active").order("trigger_type");
  // Tenant scope: super sees all; everyone else sees only their own hospital's
  // templates plus global (hospital_id null) platform defaults.
  if (!isSuper(c)) q = q.or(`hospital_id.eq.${c.hospitalId ?? "__none__"},hospital_id.is.null`);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
