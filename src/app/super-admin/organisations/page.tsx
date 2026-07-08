import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import OrgManager from "./OrgManager";
import OrgList from "./OrgList";

export default async function OrganisationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const [{ data: orgs }, { data: hospitals }, { data: staff }] = await Promise.all([
    admin.from("organisations")
      .select("id, name, group_name, type, hq_country, region, description, website, email, phone, is_active")
      .order("name"),
    admin.from("hospitals")
      .select("id, name, type, country, city, tier, organisation_id")
      .order("country").order("name"),
    admin.from("profiles")
      .select("id, role, hospital_id")
      .in("role", ["nurse","assessor","educator","hospital_admin"]),
  ]);

  const staffByHospital = (staff ?? []).reduce((acc, s) => {
    if (!s.hospital_id) return acc;
    if (!acc[s.hospital_id]) acc[s.hospital_id] = { nurse: 0, assessor: 0, educator: 0, hospital_admin: 0 };
    acc[s.hospital_id][s.role as keyof typeof acc[string]]++;
    return acc;
  }, {} as Record<string, Record<string, number>>);

  const allCountries = [...new Set((hospitals ?? []).map(h => h.country).filter(Boolean))].sort();
  const totalFacilities = (hospitals ?? []).length;

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Organisations</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {(orgs ?? []).length} groups · {totalFacilities} facilities · {allCountries.length} countries
          </p>
        </div>
        <OrgManager orgs={orgs ?? []} />
      </div>

      <OrgList
        orgs={orgs ?? []}
        facilities={hospitals ?? []}
        staffByHospital={staffByHospital}
        allCountries={allCountries}
      />
    </div>
  );
}
