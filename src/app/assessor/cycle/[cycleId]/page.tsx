import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import AssessmentForm from "./AssessmentForm";

export default async function CycleAssessPage({ params }: { params: Promise<{ cycleId: string }> }) {
  const { cycleId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await createAdminClient().from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["assessor","educator","hospital_admin","super_admin"].includes(profile.role)) redirect("/dashboard");

  const admin = createAdminClient();

  const { data: cycle } = await admin
    .from("competency_cycles")
    .select(`
      id, cycle_type, status, start_date, end_date, notes,
      profiles!nurse_id(id, full_name, role),
      cycle_frameworks(
        id, status, framework_score,
        frameworks(
          id, name, library,
          framework_domains(
            id, name, sort_order,
            framework_competencies(
              id, name, description, sort_order,
              performance_criteria(id, criterion, sort_order),
              competency_skills(id, name,
                skill_checklists(id, name,
                  checklist_items(id, item, is_critical, sort_order)
                )
              ),
              assessment_method_configs(id, method, is_required, min_assessors)
            )
          )
        )
      )
    `)
    .eq("id", cycleId)
    .single();

  if (!cycle) notFound();

  // Existing assessments for this cycle
  const { data: existing } = await admin
    .from("assessments")
    .select("id, competency_id, assessor_id, method, score, status, notes, assessed_at, profiles!assessor_id(full_name)")
    .eq("cycle_id", cycleId);

  // Scoring levels
  const { data: levels } = await admin
    .from("scoring_levels")
    .select("score, label, description, color, is_passing")
    .eq("scale_id", "00000000-0000-0000-0000-000000000001")
    .order("score");

  const nurse = cycle.profiles as unknown as { id: string; full_name: string } | null;

  return (
    <div className="max-w-5xl">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href="/assessor" className="hover:text-gray-600">Assessor</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{nurse?.full_name}</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{nurse?.full_name}</h1>
          <p className="text-gray-400 text-sm mt-0.5 capitalize">
            {cycle.cycle_type} cycle · {cycle.status} · started {new Date(cycle.start_date).toLocaleDateString()}
          </p>
        </div>
      </div>

      <AssessmentForm
        cycle={cycle as unknown as Parameters<typeof AssessmentForm>[0]["cycle"]}
        existingAssessments={(existing ?? []) as unknown as Parameters<typeof AssessmentForm>[0]["existingAssessments"]}
        levels={levels ?? []}
        assessorId={user.id}
      />
    </div>
  );
}
