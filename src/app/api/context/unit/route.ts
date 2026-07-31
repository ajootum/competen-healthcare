import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

// Unit / Location context (PUI-002, HWW-UI-002).
//
// The unit selector changes WHERE a user is working without changing WHO they are working as — it is
// deliberately independent of the workspace (role) switcher. Mirrors the active_role cookie pattern:
// httpOnly so client script can't forge it, and validated server-side against units that actually exist
// in the caller's own hospital, so a user cannot select their way into another tenant's ward.
//
// Passing unit: null clears the selection (back to "All units").

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const unitId: string | null = body?.unit ?? null;
  const cookieStore = await cookies();

  if (!unitId) {
    cookieStore.delete("active_unit");
    return NextResponse.json({ ok: true, unit: null });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = ((profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[]).filter(Boolean) as string[];

  // The unit must exist AND belong to the caller's hospital — super_admin excepted, since they legitimately
  // operate across tenants. Scoping off the SUBJECT row, never off the request body.
  //
  // A unit's hospital is reached THROUGH its department: `units` has department_id, and `departments` has
  // hospital_id. Selecting units.hospital_id directly (as this once did) errors, which made the endpoint
  // return 404 for every unit and silently disabled the whole selector. Found by
  // scripts/schema-drift-audit.ts.
  const { data: unit, error: unitErr } = await admin.from("units")
    .select("id, name, department_id, departments!department_id(hospital_id)")
    .eq("id", unitId).maybeSingle();
  if (unitErr) return NextResponse.json({ error: unitErr.message }, { status: 500 });
  if (!unit) return NextResponse.json({ error: "Unit not found" }, { status: 404 });
  const unitHospital = (unit as { departments?: { hospital_id?: string | null } | null }).departments?.hospital_id ?? null;
  if (!roles.includes("super_admin") && unitHospital !== profile?.hospital_id) {
    return NextResponse.json({ error: "That unit is not in your hospital" }, { status: 403 });
  }

  cookieStore.set("active_unit", unit.id, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7,
  });
  return NextResponse.json({ ok: true, unit: { id: unit.id, name: unit.name } });
}
