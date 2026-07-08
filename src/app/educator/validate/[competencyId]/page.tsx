import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import ValidationActions from "./ValidationActions";

const SCORE_COLORS = ["#ef4444","#f97316","#eab308","#14b8a6","#0d9488","#3b82f6","#8b5cf6"];
const SCORE_LABELS = ["Training Required","Novice","Advanced Beginner","Competent","Competent+","Proficient","Expert"];

export default async function ValidatePage({
  params,
  searchParams,
}: {
  params: Promise<{ competencyId: string }>;
  searchParams: Promise<{ cycle?: string; nurse?: string }>;
}) {
  const { competencyId } = await params;
  const { cycle: cycleId, nurse: nurseId } = await searchParams;
  if (!cycleId || !nurseId) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await createAdminClient().from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["educator","hospital_admin","super_admin"].includes(profile.role)) redirect("/dashboard");

  const admin = createAdminClient();

  // The aggregated competency score
  const { data: compScore } = await admin
    .from("competency_scores")
    .select(`
      id, score, label, is_passing, assessed_at, educator_validated,
      framework_competencies!competency_id(
        id, name, description,
        performance_criteria(id, criterion, sort_order),
        framework_domains(name, frameworks(name))
      )
    `)
    .eq("competency_id", competencyId)
    .eq("cycle_id", cycleId)
    .eq("nurse_id", nurseId)
    .single();

  // All individual assessments for this competency in this cycle
  const { data: assessments } = await admin
    .from("assessments")
    .select("id, method, score, notes, assessed_at, profiles!assessor_id(full_name)")
    .eq("competency_id", competencyId)
    .eq("cycle_id", cycleId)
    .order("assessed_at");

  // Nurse profile
  const { data: nurse } = await admin
    .from("profiles")
    .select("full_name, role")
    .eq("id", nurseId)
    .single();

  if (!compScore) notFound();

  const comp = compScore.framework_competencies as unknown as {
    id: string; name: string; description?: string;
    performance_criteria: { id: string; criterion: string; sort_order: number }[];
    framework_domains: { name: string; frameworks: { name: string } | null } | null;
  } | null;

  const METHOD_LABELS: Record<string, string> = {
    knowledge: "Knowledge", direct_observation: "Direct Obs.", simulation: "Simulation",
    osce: "OSCE", concurrent_audit: "Concurrent Audit", retrospective_audit: "Retro. Audit", logbook: "Logbook",
  };

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href="/educator" className="hover:text-gray-600">Educator</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Validate Assessment</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{comp?.name}</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {comp?.framework_domains?.frameworks?.name} · {comp?.framework_domains?.name}
          </p>
          <p className="text-teal-600 text-sm mt-1 font-medium">Nurse: {nurse?.full_name}</p>
        </div>
        <div className="text-center">
          <div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-2xl font-bold mx-auto"
            style={{ backgroundColor: SCORE_COLORS[compScore.score] ?? "#9ca3af" }}>
            {compScore.score}
          </div>
          <p className="text-[10px] text-gray-400 mt-1">{SCORE_LABELS[compScore.score]}</p>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded mt-1 inline-block ${compScore.is_passing ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"}`}>
            {compScore.is_passing ? "Passing" : "Not Passing"}
          </span>
        </div>
      </div>

      {/* Aggregated score card */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Aggregated Score</p>
        <p className="text-sm text-gray-700">
          Score of <strong>{compScore.score}</strong> ({SCORE_LABELS[compScore.score] ?? "—"}) was computed by averaging
          scores from <strong>{(assessments ?? []).length}</strong> assessor{(assessments ?? []).length !== 1 ? "s" : ""}.
        </p>
      </div>

      {/* Individual assessor scores */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mb-4">
        <div className="px-5 py-3.5 bg-gray-50/50 border-b border-gray-100">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Individual Assessments ({(assessments ?? []).length})</p>
        </div>
        <div className="divide-y divide-gray-50">
          {(assessments ?? []).map(a => {
            const assessor = a.profiles as unknown as { full_name: string } | null;
            return (
              <div key={a.id} className="px-5 py-3 flex items-start gap-4">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                  style={{ backgroundColor: SCORE_COLORS[a.score ?? 0] ?? "#9ca3af" }}>
                  {a.score ?? "?"}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-800">{assessor?.full_name ?? "Unknown"}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {METHOD_LABELS[a.method] ?? a.method} · {a.assessed_at ? new Date(a.assessed_at).toLocaleDateString() : "—"}
                  </p>
                  {a.notes && <p className="text-xs text-gray-600 mt-1 italic">&ldquo;{a.notes}&rdquo;</p>}
                </div>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: SCORE_COLORS[a.score ?? 0] ?? "#9ca3af" }}>
                  {a.score ?? "?"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Performance criteria */}
      {(comp?.performance_criteria ?? []).length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Performance Criteria</p>
          <div className="flex flex-col gap-2">
            {(comp?.performance_criteria ?? []).sort((a, b) => a.sort_order - b.sort_order).map((c, i) => (
              <p key={c.id} className="text-sm text-gray-600 flex gap-2">
                <span className="text-gray-300 shrink-0">{i + 1}.</span>{c.criterion}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Validation action */}
      <ValidationActions
        competencyScoreId={compScore.id}
        alreadyValidated={compScore.educator_validated}
        nurseId={nurseId}
        cycleId={cycleId}
      />
    </div>
  );
}
