import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import CurriculaManager from "./CurriculaManager";

export default async function CurriculaPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["hospital_admin", "super_admin", "educator"].includes(profile.role)) redirect("/dashboard");

  const [{ data: curricula }, { data: comps }] = await Promise.all([
    admin.from("curricula")
      .select("id, title, programme_type, target_role, duration_weeks, is_active, curriculum_modules(id, title, sort_order), curriculum_competencies(id, relation, framework_competencies(name))")
      .order("created_at", { ascending: false }),
    admin.from("framework_competencies").select("id, name").order("name").limit(500),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Curricula</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Competency-driven educational programmes — every curriculum maps to the competencies it develops (Book II Ch.18).
        </p>
      </div>
      <CurriculaManager
        curricula={(curricula ?? []) as never}
        competencies={(comps ?? []).map(c => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
