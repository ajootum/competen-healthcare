import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, isAdmin, isSuper } from "@/lib/api-auth";
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

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  // Bulk import assigns users to hospitals and can set portal roles — this is a
  // governance action, admin only (super_admin or hospital_admin).
  if (!isAdmin(c)) return forbidden();

  const { rows }: { rows: ImportRow[] } = await req.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "No rows provided" }, { status: 400 });
  }

  const admin = c.admin;

  // Build the set of hospitals this caller may import into. super = all;
  // an org-wide admin (org_role org_admin) = every hospital in their org;
  // a plain hospital_admin = only their own hospital. The admin client bypasses
  // RLS, so this set is the ONLY tenant boundary on the import.
  const allowedHospitals = new Map<string, string>(); // name.toLowerCase() → id
  const allowedHospitalIds = new Set<string>();
  const register = (id: string, name: string) => { allowedHospitals.set(name.toLowerCase().trim(), id); allowedHospitalIds.add(id); };

  if (isSuper(c)) {
    const { data: hospitals } = await admin.from("hospitals").select("id, name");
    (hospitals ?? []).forEach(h => register(h.id, h.name));
  } else {
    const { data: ext } = await admin
      .from("profiles").select("org_role, organisation_id").eq("id", c.userId)
      .returns<{ org_role: string | null; organisation_id: string | null }[]>()
      .maybeSingle();
    const orgRole = ext?.org_role ?? null;
    const orgId = ext?.organisation_id ?? c.organisationId ?? null;
    if (orgRole === "org_admin" && orgId) {
      const { data: hospitals } = await admin.from("hospitals").select("id, name").eq("organisation_id", orgId);
      (hospitals ?? []).forEach(h => register(h.id, h.name));
    } else if (c.hospitalId) {
      const { data: hospital } = await admin.from("hospitals").select("id, name").eq("id", c.hospitalId).maybeSingle();
      if (hospital) register(hospital.id, hospital.name);
    }
  }

  const results: ImportResult[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const seq = i + 1;
    const email = row.email?.trim().toLowerCase();
    const fullName = [row.first_name?.trim(), row.middle_name?.trim(), row.last_name?.trim()]
      .filter(Boolean).join(" ");

    if (!email) continue;

    // Resolve hospital — must be one this caller is allowed to import into.
    const hospitalKey = row.hospital?.trim().toLowerCase();
    const hospitalId = hospitalKey ? allowedHospitals.get(hospitalKey) : undefined;

    if (!hospitalId) {
      results.push({ seq, email, name: fullName, status: "error", message: `Hospital not found or not accessible: "${row.hospital}"` });
      continue;
    }

    // Look up user by email (global lookup — the email is a unique key).
    const { data: profile } = await admin
      .from("profiles").select("id, hospital_id").eq("email", email).maybeSingle();

    if (!profile) {
      results.push({ seq, email, name: fullName, status: "not_found", message: "No account found with this email" });
      continue;
    }

    // Tenant guard: never mutate a user who already belongs to a hospital
    // outside this caller's scope (prevents poaching another tenant's account).
    const currentHospital = (profile as { hospital_id: string | null }).hospital_id;
    if (currentHospital && !allowedHospitalIds.has(currentHospital)) {
      results.push({ seq, email, name: fullName, status: "error", message: "Account belongs to another organisation — not accessible" });
      continue;
    }

    const update: Record<string, unknown> = { hospital_id: hospitalId };
    if (fullName) update.full_name = fullName;

    if (row.org_role?.trim()) {
      const orgRoleVal = row.org_role.trim().toLowerCase() as OrgRole;
      const cfg = ORG_ROLE_CONFIG[orgRoleVal];
      if (cfg) {
        const portalRole = cfg.portalRole;
        // Privilege-escalation guard: only super_admin may confer an elevated
        // portal role (hospital_admin/super_admin) via import. A hospital_admin
        // importing an admin-tier org_role gets the hospital/name assignment but
        // NOT the elevated role.
        const elevated = portalRole === "hospital_admin" || portalRole === "super_admin";
        if (!(elevated && !isSuper(c))) {
          update.org_role = orgRoleVal;
          update.role = portalRole;
          update.roles = [portalRole];
        }
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
