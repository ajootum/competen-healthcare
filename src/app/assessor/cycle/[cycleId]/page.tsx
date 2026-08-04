import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import AssessmentForm from "./AssessmentForm";
import { formatDateTime } from "@/lib/datetime";

// Overall recommendation labels (assessment_sessions.recommendation check constraint).
const REC: Record<string, { label: string; cls: string }> = {
  competent:                  { label: "Competent",                cls: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" },
  competent_with_supervision: { label: "Competent w/ Supervision", cls: "bg-teal-100 text-teal-700" },
  needs_development:          { label: "Needs Development",         cls: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]" },
  reassessment_required:      { label: "Reassessment Required",    cls: "bg-[var(--cmp-surface-warning)] text-orange-700" },
  critical_failure:           { label: "Critical Failure",         cls: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]" },
};

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

  // Conducted assessment sessions for this cycle — overall recommendation +
  // e-signed attestation (assessment_sessions, migration 032). Surfaced below.
  const { data: sessions } = await admin
    .from("assessment_sessions")
    .select("id, method, location, duration_seconds, scored_count, recommendation, strengths, improvements, assessor_signature_path, learner_signature_path, witness_name, witness_signature_path, created_at, profiles!assessor_id(full_name)")
    .eq("cycle_id", cycleId)
    .order("created_at", { ascending: false });

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

      {(sessions ?? []).length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Conducted Assessment Sessions</h2>
          <div className="space-y-3">
            {(sessions ?? []).map(s => {
              const rec = s.recommendation ? REC[s.recommendation] : null;
              const assessor = (s.profiles as unknown as { full_name: string } | null)?.full_name ?? "Assessor";
              const sigs = [
                s.assessor_signature_path && "Assessor",
                s.learner_signature_path && "Learner",
                s.witness_signature_path && (s.witness_name || "Witness"),
              ].filter(Boolean) as string[];
              const mins = s.duration_seconds ? Math.round(s.duration_seconds / 60) : null;
              return (
                <div key={s.id} className="bg-white border border-gray-100 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800">{assessor} · <span className="capitalize">{(s.method ?? "").replace(/_/g, " ")}</span></p>
                      <p className="text-[11px] text-gray-400">
                        {formatDateTime(s.created_at)} · {s.scored_count ?? 0} scored{mins ? ` · ${mins} min` : ""}{s.location ? ` · ${s.location}` : ""}
                      </p>
                    </div>
                    {rec && <span className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 ${rec.cls}`}>{rec.label}</span>}
                  </div>
                  {(s.strengths || s.improvements) && (
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-gray-600">
                      {s.strengths && <p><span className="font-semibold text-gray-500">Strengths:</span> {s.strengths}</p>}
                      {s.improvements && <p><span className="font-semibold text-gray-500">To develop:</span> {s.improvements}</p>}
                    </div>
                  )}
                  {sigs.length > 0 && <p className="text-[10px] text-gray-400 mt-2">✍️ Signed attestation: {sigs.join(", ")}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
