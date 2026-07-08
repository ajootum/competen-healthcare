import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import RecognitionsManager from "./RecognitionsManager";

export default async function RecognitionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["hospital_admin", "super_admin", "educator"].includes(profile.role)) redirect("/dashboard");

  const hospitalId = profile.hospital_id ?? "";
  const [{ data: workers }, { data: recognitions }] = await Promise.all([
    admin.from("profiles").select("id, full_name").eq("hospital_id", hospitalId).eq("role", "nurse").order("full_name"),
    admin.from("professional_recognitions")
      .select("id, nurse_id, recognition_type, title, description, awarded_by_name, awarded_at, profiles!nurse_id(full_name)")
      .eq("hospital_id", hospitalId)
      .order("awarded_at", { ascending: false }),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Professional Recognition</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Celebrate excellence — awards and recognitions appear on the worker&apos;s competency passport (Book II Ch.26).
        </p>
      </div>
      <RecognitionsManager
        workers={(workers ?? []).map(w => ({ id: w.id, full_name: w.full_name }))}
        recognitions={(recognitions ?? []) as never}
      />
    </div>
  );
}
