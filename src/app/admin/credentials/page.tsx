import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import CredentialsManager from "./CredentialsManager";

export default async function CredentialsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["hospital_admin", "super_admin", "educator"].includes(profile.role)) redirect("/dashboard");

  const hospitalId = profile.hospital_id ?? "";
  const [{ data: workers }, { data: credentials }] = await Promise.all([
    admin.from("profiles").select("id, full_name").eq("hospital_id", hospitalId).eq("role", "nurse").order("full_name"),
    admin.from("professional_credentials")
      .select("id, credential_number, nurse_id, credential_type, title, issuing_body, issue_date, expiry_date, status, verified, profiles!nurse_id(full_name)")
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Professional Credentials</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Verified licenses, qualifications and certifications — complements the competency passport (Book II Ch.25).
        </p>
      </div>
      <CredentialsManager
        workers={(workers ?? []).map(w => ({ id: w.id, full_name: w.full_name }))}
        credentials={(credentials ?? []) as never}
      />
    </div>
  );
}
