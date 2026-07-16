import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ChecklistBuilder from "./ChecklistBuilder";

// Checklist Builder — structured checklists with sections, scoring rules and
// critical-fail items ("latest competen" §4).

export default async function ChecklistBuilderPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") redirect("/dashboard");

  const [{ data: skills }, { data: checklists }, { data: items }] = await Promise.all([
    admin.from("competency_skills")
      .select("id, name, framework_competencies!competency_id(name, framework_domains(frameworks(name)))")
      .eq("is_active", true).order("name"),
    admin.from("skill_checklists")
      .select("id, skill_id, name, description, assessor_instructions")
      .eq("is_active", true).order("name"),
    admin.from("checklist_items")
      .select("id, checklist_id, item, section, is_critical, is_required, scoring_method, evidence_required, assessor_note, sort_order")
      .order("sort_order"),
  ]);

  const skillRows = (skills ?? []).map(s => {
    const c = s.framework_competencies as unknown as { name: string; framework_domains: { frameworks: { name: string } | null } | null } | null;
    return { id: s.id, name: s.name, competency: c?.name ?? "—", framework: c?.framework_domains?.frameworks?.name ?? "—" };
  });

  return (
    <div className="max-w-6xl">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href="/super-admin/studio" className="hover:text-gray-600">Studio</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Checklist Builder</span>
      </div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Checklist Builder</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Structured observation checklists — sections, scoring rules, critical-fail items and evidence capture.
        </p>
      </div>
      <ChecklistBuilder skills={skillRows as never} checklists={(checklists ?? []) as never} items={(items ?? []) as never} />
    </div>
  );
}
