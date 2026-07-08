import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { ORG_ROLE_CONFIG, type OrgRole } from "@/lib/roles";

export type ImportRow = {
  first_name: string;
  middle_name?: string;
  last_name: string;
  email: string;
  hospital: string; // required — facility name
  org_role?: string;
};

export type ImportResult = {
  seq: number;
  email: string;
  name: string;
  status: "updated" | "not_found" | "error";
  message: string;
};

async function getCallerScope() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role, hospital_id")
    .eq("id", user.id)
    .single();

  const { data: ext } = await admin
    .from("profiles")
    .select("org_role, organisation_id")
    .eq("id", user.id)
    .returns<{ org_role: string | null; organisation_id: string | null }[]>()
    .maybeSingle();

  if (!profile) return null;

  const role = profile.role as string;
  const orgRole = ext?.org_role ?? null;

  // super_admin: no restriction
  if (role === "super_admin") return { user, role, scope: "all" as const, orgId: null, hospitalId: null };

  // hospital_admin with org_admin org_role: their org's hospitals
  if (role === "hospital_admin" && orgRole === "org_admin") {
    return { user, role, scope: "org" as const, orgId: ext?.organisation_id ?? null, hospitalId: null };
  }

  // educator: only their own hospital
  if (role === "educator") {
    return { user, role, scope: "hospital" as const, orgId: null, hospitalId: profile.hospital_id ?? null };
  }

  return null; // access denied
}

export async function POST(req: Request) {
  const caller = await getCallerScope();
  if (!caller) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { rows }: { rows: ImportRow[] } = await req.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "No rows provided" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Build allowed hospital set for this caller
  let allowedHospitals: Map<string, string> = new Map(); // name.toLowerCase() → id

  if (caller.scope === "all") {
    const { data: hospitals } = await admin.from("hospitals").select("id, name");
    (hospitals ?? []).forEach(h => allowedHospitals.set(h.name.toLowerCase().trim(), h.id));
  } else if (caller.scope === "org" && caller.orgId) {
    const { data: hospitals } = await admin
      .from("hospitals").select("id, name").eq("organisation_id", caller.orgId);
    (hospitals ?? []).forEach(h => allowedHospitals.set(h.name.toLowerCase().trim(), h.id));
  } else if (caller.scope === "hospital" && caller.hospitalId) {
    const { data: hospital } = await admin
      .from("hospitals").select("id, name").eq("id", caller.hospitalId).maybeSingle();
    if (hospital) allowedHospitals.set(hospital.name.toLowerCase().trim(), hospital.id);
  }

  const results: ImportResult[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const seq = i + 1;
    const email = row.email?.trim().toLowerCase();
    const fullName = [row.first_name?.trim(), row.middle_name?.trim(), row.last_name?.trim()]
      .filter(Boolean).join(" ");

    if (!email) continue;

    // Resolve hospital
    const hospitalKey = row.hospital?.trim().toLowerCase();
    const hospitalId = hospitalKey ? allowedHospitals.get(hospitalKey) : undefined;

    if (!hospitalId) {
      results.push({ seq, email, name: fullName, status: "error", message: `Hospital not found or not accessible: "${row.hospital}"` });
      continue;
    }

    // Look up user by email
    const { data: profile } = await admin
      .from("profiles").select("id").eq("email", email).maybeSingle();

    if (!profile) {
      results.push({ seq, email, name: fullName, status: "not_found", message: "No account found with this email" });
      continue;
    }

    const update: Record<string, unknown> = { hospital_id: hospitalId };
    if (fullName) update.full_name = fullName;

    if (row.org_role?.trim()) {
      const orgRoleVal = row.org_role.trim().toLowerCase() as OrgRole;
      if (ORG_ROLE_CONFIG[orgRoleVal]) {
        update.org_role = orgRoleVal;
        update.role = ORG_ROLE_CONFIG[orgRoleVal].portalRole;
        update.roles = [update.role];
      }
    }

    const { error } = await admin.from("profiles").update(update).eq("id", profile.id);
    if (error) {
      results.push({ seq, email, name: fullName, status: "error", message: error.message });
    } else {
      const parts = [`assigned to ${row.hospital}`];
      if (update.org_role) parts.push(`role → ${update.org_role}`);
      if (update.full_name) parts.push(`name updated`);
      results.push({ seq, email, name: fullName, status: "updated", message: parts.join(", ") });
    }
  }

  return NextResponse.json({ results });
}
