import { createAdminClient, createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import BulkImport from "@/components/BulkImport";

export default async function AdminImportPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("role, hospital_id")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "hospital_admin") redirect("/admin/dashboard");

  const { data: ext } = await admin
    .from("profiles")
    .select("org_role, organisation_id")
    .eq("id", user.id)
    .returns<{ org_role: string | null; organisation_id: string | null }[]>()
    .maybeSingle();

  const orgRole = ext?.org_role ?? null;
  const organisationId = ext?.organisation_id ?? null;

  // Chief officer / org admin → all facilities in their organisation
  // Manager / generic admin → only their assigned facility
  let hospitals: { id: string; name: string; country: string }[] = [];

  if (["chief_officer", "org_admin"].includes(orgRole ?? "") && organisationId) {
    const { data } = await admin
      .from("hospitals")
      .select("id, name, country")
      .eq("organisation_id", organisationId)
      .order("name");
    hospitals = (data ?? []).map(h => ({
      id: h.id as string,
      name: h.name as string,
      country: (h as Record<string, string>).country ?? "",
    }));
  } else if (profile?.hospital_id) {
    const { data } = await admin
      .from("hospitals")
      .select("id, name, country")
      .eq("id", profile.hospital_id)
      .maybeSingle();
    if (data) {
      hospitals = [{
        id: data.id as string,
        name: data.name as string,
        country: (data as Record<string, string>).country ?? "",
      }];
    }
  } else {
    // No hospital assigned — show all hospitals (fallback for unscoped admins)
    const { data } = await admin.from("hospitals").select("id, name, country").order("name");
    hospitals = (data ?? []).map(h => ({
      id: h.id as string,
      name: h.name as string,
      country: (h as Record<string, string>).country ?? "",
    }));
  }

  const scopeLabel =
    ["chief_officer", "org_admin"].includes(orgRole ?? "") && organisationId
      ? `${hospitals.length} facilit${hospitals.length !== 1 ? "ies" : "y"} in your organisation`
      : profile?.hospital_id
        ? `your facility only`
        : `all facilities`;

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Bulk Import Users</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Assign users to facilities and update roles in bulk — scoped to {scopeLabel}.
        </p>
      </div>
      <BulkImport hospitals={hospitals} />
    </div>
  );
}
