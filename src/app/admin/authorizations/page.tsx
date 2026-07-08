import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AuthorizationsManager from "./AuthorizationsManager";

export default async function AuthorizationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["hospital_admin", "super_admin", "educator"].includes(profile.role)) redirect("/dashboard");

  const hospitalId = profile.hospital_id ?? "";

  const [{ data: workers }, { data: authorizations }] = await Promise.all([
    admin.from("profiles").select("id, full_name").eq("hospital_id", hospitalId).eq("role", "nurse").order("full_name"),
    admin.from("clinical_authorizations")
      .select("id, authorization_number, nurse_id, authorization_type, authorization_level, status, scope, conditions, effective_date, expiry_date, granted_by_name, profiles!nurse_id(full_name)")
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false }),
  ]);

  const workerIds = (workers ?? []).map(w => w.id);

  // Competent decisions that could justify an authorization (grouped per worker)
  const { data: decisions } = workerIds.length
    ? await admin.from("competency_decisions")
        .select("nurse_id, competency_id, outcome, framework_competencies(name)")
        .in("nurse_id", workerIds)
        .in("outcome", ["competent", "competent_with_conditions", "provisionally_competent"])
        .order("created_at", { ascending: false })
    : { data: [] as { nurse_id: string; competency_id: string; outcome: string; framework_competencies: { name: string } | null }[] };

  const decisionsByWorker: Record<string, { competency_id: string; name: string }[]> = {};
  const seen = new Set<string>();
  for (const d of decisions ?? []) {
    const key = `${d.nurse_id}:${d.competency_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = (d.framework_competencies as unknown as { name: string } | null)?.name ?? "Competency";
    (decisionsByWorker[d.nurse_id] ??= []).push({ competency_id: d.competency_id, name });
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Clinical Authorizations</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Grant permission to practise — separating demonstrated competency from organizational authorization (Book II Ch.24).
        </p>
      </div>
      <AuthorizationsManager
        workers={(workers ?? []).map(w => ({ id: w.id, full_name: w.full_name }))}
        authorizations={(authorizations ?? []) as never}
        decisionsByWorker={decisionsByWorker}
      />
    </div>
  );
}
