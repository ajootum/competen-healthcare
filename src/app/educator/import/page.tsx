import { createAdminClient, createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import BulkImport from "@/components/BulkImport";

export default async function EducatorImportPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("role, hospital_id")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "educator") redirect("/educator");
  if (!profile?.hospital_id) redirect("/educator");

  const { data: hospital } = await admin
    .from("hospitals")
    .select("id, name, country")
    .eq("id", profile.hospital_id)
    .maybeSingle();

  if (!hospital) redirect("/educator");

  const lockedHospital = {
    id: hospital.id as string,
    name: hospital.name as string,
  };

  const hospitalList = [{
    id: hospital.id as string,
    name: hospital.name as string,
    country: (hospital as Record<string, string>).country ?? "",
  }];

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Bulk Import Users</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Assign users to <strong>{lockedHospital.name}</strong> and update their roles in bulk.
        </p>
      </div>
      <BulkImport hospitals={hospitalList} lockedHospital={lockedHospital} />
    </div>
  );
}
