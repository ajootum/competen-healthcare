import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import DomainCompetencyBuilder from "./DomainCompetencyBuilder";

export default async function FrameworkDetailPage({ params }: { params: Promise<{ frameworkId: string }> }) {
  const { frameworkId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();

  const { data: framework } = await admin
    .from("frameworks")
    .select("id, name, library, description, is_active")
    .eq("id", frameworkId)
    .single();

  if (!framework) notFound();

  const { data: domains } = await admin
    .from("framework_domains")
    .select(`
      id, name, description, sort_order, is_active,
      framework_competencies(
        id, name, description, sort_order, is_active,
        performance_criteria(id, criterion, sort_order, is_active),
        competency_skills(
          id, name, sort_order, is_active,
          skill_checklists(id, name, is_active, checklist_items(id, item, is_critical, sort_order))
        ),
        assessment_method_configs(id, method, is_required, min_assessors, weight, is_active)
      )
    `)
    .eq("framework_id", frameworkId)
    .order("sort_order");

  const LIBRARY_LABEL: Record<string, string> = { core: "Core Nursing", specialty: "Specialty", role: "Role-Based" };

  return (
    <div className="max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href="/super-admin/content" className="hover:text-gray-600">Content Builder</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{framework.name}</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">{framework.name}</h1>
            <span className="text-[10px] bg-teal-100 text-teal-700 font-bold px-2 py-0.5 rounded capitalize">
              {LIBRARY_LABEL[framework.library] ?? framework.library}
            </span>
          </div>
          <p className="text-gray-400 text-sm mt-0.5">
            {(domains ?? []).length} domains · {(domains ?? []).reduce((s, d) => s + (d.framework_competencies?.length ?? 0), 0)} competencies
          </p>
        </div>
      </div>

      <DomainCompetencyBuilder frameworkId={frameworkId} domains={domains ?? []} />
    </div>
  );
}
