import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

async function authCheck() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await createAdminClient().from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") return null;
  return user;
}

export type ImportRow = {
  email: string;
  full_name?: string;
  hospital?: string;
  role?: string;
  org_role?: string;
};

export type ImportResult = {
  email: string;
  status: "updated" | "not_found" | "error";
  message: string;
};

export async function POST(req: Request) {
  if (!await authCheck()) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { rows }: { rows: ImportRow[] } = await req.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "No rows provided" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Fetch all hospitals for name matching
  const { data: hospitals } = await admin.from("hospitals").select("id, name");
  const hospitalByName = Object.fromEntries(
    (hospitals ?? []).map(h => [h.name.toLowerCase().trim(), h.id])
  );

  const results: ImportResult[] = [];

  for (const row of rows) {
    const email = row.email?.trim().toLowerCase();
    if (!email) continue;

    // Look up user by email
    const { data: profile } = await admin
      .from("profiles")
      .select("id, role, roles, hospital_id")
      .eq("email", email)
      .maybeSingle();

    if (!profile) {
      results.push({ email, status: "not_found", message: "No account found with this email" });
      continue;
    }

    const update: Record<string, unknown> = {};

    if (row.full_name?.trim()) update.full_name = row.full_name.trim();
    if (row.org_role?.trim()) {
      const { ORG_ROLE_CONFIG: cfg } = await import("@/lib/roles");
      const orgRoleVal = row.org_role.trim().toLowerCase();
      if (cfg[orgRoleVal as keyof typeof cfg]) {
        update.org_role = orgRoleVal;
        update.role = cfg[orgRoleVal as keyof typeof cfg].portalRole;
        update.roles = [update.role];
      }
    } else if (row.role?.trim()) {
      const role = row.role.trim().toLowerCase();
      update.role = role;
      update.roles = [role];
    }
    if (row.hospital?.trim()) {
      const hospitalId = hospitalByName[row.hospital.trim().toLowerCase()];
      if (hospitalId) {
        update.hospital_id = hospitalId;
      } else {
        results.push({ email, status: "error", message: `Hospital not found: "${row.hospital}"` });
        continue;
      }
    }

    if (Object.keys(update).length === 0) {
      results.push({ email, status: "error", message: "No valid fields to update" });
      continue;
    }

    const { error } = await admin.from("profiles").update(update).eq("id", profile.id);
    if (error) {
      results.push({ email, status: "error", message: error.message });
    } else {
      const parts = [];
      if (update.hospital_id) parts.push(`hospital linked`);
      if (update.role) parts.push(`role → ${update.role}`);
      if (update.org_role) parts.push(`sub-role → ${update.org_role}`);
      if (update.full_name) parts.push(`name updated`);
      results.push({ email, status: "updated", message: parts.join(", ") || "Updated" });
    }
  }

  return NextResponse.json({ results });
}
