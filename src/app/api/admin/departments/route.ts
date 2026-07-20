import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isAdmin, isSuper } from "@/lib/api-auth";

export async function GET(request: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();

  const { searchParams } = new URL(request.url);
  const requestedHospitalId = searchParams.get("hospital_id");
  // Tenant scope: super may query any hospital; everyone else is pinned to
  // their own hospital regardless of any client-supplied hospital_id.
  const hospitalId = isSuper(c) ? (requestedHospitalId ?? "") : (c.hospitalId ?? "__none__");

  const admin = c.admin;
  const { data } = await admin.from("departments").select("id, name").eq("hospital_id", hospitalId).order("name");
  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();

  const { name, specialty, hospital_id } = await request.json();
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

  // Force the tenant: super may target the supplied hospital_id; everyone else
  // inserts into their own hospital (client-supplied hospital_id ignored).
  const targetHospitalId = isSuper(c) ? (hospital_id ?? null) : c.hospitalId;
  if (!targetHospitalId) return NextResponse.json({ error: "hospital_id required" }, { status: 400 });

  const admin = c.admin;
  const { data, error } = await admin.from("departments").insert({ name, specialty, hospital_id: targetHospitalId }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, department: data });
}
