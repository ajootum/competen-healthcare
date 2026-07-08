import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ResourceLibrary from "./ResourceLibrary";

export default async function ResourcesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (!["hospital_admin", "super_admin", "educator"].includes(profile?.role ?? "")) redirect("/dashboard");

  const [{ data: resources }, { data: links }, { data: comps }] = await Promise.all([
    admin.from("learning_resources").select("id, title, resource_type, url, is_active").order("created_at", { ascending: false }),
    admin.from("resource_competencies").select("resource_id, competency_id, framework_competencies(name)"),
    admin.from("framework_competencies").select("id, name, framework_domains(name, frameworks(name))").order("name").limit(500),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Learning Resources</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Governed resources linked to competencies — the source for auto-generated learning pathways (Book II Ch.19).
        </p>
      </div>
      <ResourceLibrary
        resources={(resources ?? []) as never}
        links={(links ?? []) as never}
        competencies={(comps ?? []).map(c => {
          const d = c.framework_domains as unknown as { name: string; frameworks: { name: string } | null } | null;
          return { id: c.id, name: c.name, framework: d?.frameworks?.name ?? "", domain: d?.name ?? "" };
        })}
      />
    </div>
  );
}
