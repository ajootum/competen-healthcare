import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import SkillBuilder from "./SkillBuilder";

// Skill Builder — skills as standalone reusable objects ("latest competen" §3).
// One skill (e.g. "Verifies patient identity") attaches to many competencies.

export default async function SkillBuilderPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") redirect("/dashboard");

  const [{ data: skills }, { data: instances }, { data: competencies }] = await Promise.all([
    admin.from("skill_library")
      .select("id, name, description, skill_type, performance_criteria, required_knowledge")
      .eq("is_active", true).order("name"),
    admin.from("competency_skills")
      .select("id, library_skill_id, competency_id, framework_competencies!competency_id(name, framework_domains(name, frameworks(name)))")
      .not("library_skill_id", "is", null),
    admin.from("framework_competencies")
      .select("id, name, framework_domains(name, frameworks(name))")
      .order("name"),
  ]);

  type Inst = { id: string; library_skill_id: string; competency_id: string; competency_name: string; framework_name: string };
  const links: Inst[] = (instances ?? []).map(i => {
    const c = i.framework_competencies as unknown as { name: string; framework_domains: { name: string; frameworks: { name: string } | null } | null } | null;
    return {
      id: i.id, library_skill_id: i.library_skill_id as string, competency_id: i.competency_id,
      competency_name: c?.name ?? "—",
      framework_name: c?.framework_domains?.frameworks?.name ?? "—",
    };
  });

  const compOptions = (competencies ?? []).map(c => {
    const d = c.framework_domains as unknown as { name: string; frameworks: { name: string } | null } | null;
    return { id: c.id, label: `${c.name} — ${d?.frameworks?.name ?? "?"}` };
  });

  return (
    <div className="max-w-6xl">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href="/super-admin/studio" className="hover:text-gray-600">Studio</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Skill Builder</span>
      </div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Skill Builder</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Skills are reusable objects — define once, attach to every competency that needs them.
        </p>
      </div>
      <SkillBuilder skills={(skills ?? []) as never} links={links as never} competencies={compOptions as never} />
    </div>
  );
}
