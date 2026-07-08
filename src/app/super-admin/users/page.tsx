import { createAdminClient, createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import UsersTable from "./UsersTable";

type ProfileRow = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  roles: string[] | null;
  hospital_id: string | null;
  specialization: string | null;
  created_at: string;
};

type ExtRow = {
  id: string;
  org_role: string | null;
  org_roles: string[] | null;
  organisation_id: string | null;
  platform_role: string | null;
  department_id: string | null;
};

export default async function AllUsersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const [
    { data: rawProfiles },
    { data: hospitals },
    { data: organisations },
    { data: rawExt },
    { data: rawDepts },
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, email, role, roles, hospital_id, specialization, created_at")
      .order("created_at", { ascending: false })
      .returns<ProfileRow[]>(),

    admin.from("hospitals").select("id, name, country"),

    admin.from("organisations").select("id, name"),

    // Use returns<> to handle new columns not yet in generated types
    admin
      .from("profiles")
      .select("id, org_role, org_roles, organisation_id, platform_role, department_id")
      .returns<ExtRow[]>(),

    admin.from("departments").select("id, name, hospital_id"),
  ]);

  const hospitalMap = Object.fromEntries((hospitals ?? []).map(h => [h.id, h.name as string]));
  const orgMap = Object.fromEntries((organisations ?? []).map(o => [o.id, o.name as string]));
  const extMap = Object.fromEntries((rawExt ?? []).map(r => [r.id, r]));

  const profiles = (rawProfiles ?? []).map(p => ({
    ...p,
    roles: (p.roles as string[] | null) ?? null,
    org_role: extMap[p.id]?.org_role ?? null,
    org_roles: extMap[p.id]?.org_roles ?? null,
    organisation_id: extMap[p.id]?.organisation_id ?? null,
    platform_role: extMap[p.id]?.platform_role ?? null,
    department_id: extMap[p.id]?.department_id ?? null,
  }));

  const departmentList = (rawDepts ?? []).map(d => ({
    id: d.id as string,
    name: d.name as string,
    hospital_id: (d as Record<string, string>).hospital_id ?? "",
  }));

  const hospitalList = (hospitals ?? []).map(h => ({
    id: h.id as string,
    name: h.name as string,
    country: (h as Record<string, string>).country ?? "",
  }));

  const orgList = (organisations ?? []).map(o => ({
    id: o.id as string,
    name: o.name as string,
  }));

  return (
    <UsersTable
      profiles={profiles}
      hospitalMap={hospitalMap}
      orgMap={orgMap}
      hospitals={hospitalList}
      organisations={orgList}
      departments={departmentList}
    />
  );
}
