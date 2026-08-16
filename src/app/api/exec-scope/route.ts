import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { estateRolesOf } from "@/lib/roles";
/* eslint-disable @typescript-eslint/no-explicit-any */

// Options for the header hospital-scope filter (QAW + HEX). super_admin may scope to any hospital or
// "all"; a hospital_admin is fixed to their own hospital (returned as a static label, canScope:false)
// — no privilege escalation, since only super_admin's selection is honoured by the guards.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = estateRolesOf(profile);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const current = (await cookies()).get("active_hospital")?.value ?? null;

  if (roles.includes("super_admin")) {
    const { data } = await admin.from("hospitals").select("id, name").order("name").limit(1000);
    return NextResponse.json({ hospitals: data ?? [], current: current ?? "all", canScope: true });
  }
  const hid = profile?.hospital_id ?? null;
  const { data } = hid ? await admin.from("hospitals").select("id, name").eq("id", hid).maybeSingle() : { data: null };
  return NextResponse.json({ hospitals: data ? [data] : [], current: hid ?? "all", canScope: false });
}
