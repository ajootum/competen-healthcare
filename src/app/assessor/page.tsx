import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

const SCORE_COLORS = ["#ef4444","#f97316","#eab308","#14b8a6","#0d9488","#3b82f6","#8b5cf6"];
const SCORE_LABELS = ["Training Required","Novice","Advanced Beginner","Competent","Competent+","Proficient","Expert"];

export default async function AssessorDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, hospital_id, full_name").eq("id", user.id).single();
  if (!profile || !["assessor","educator","hospital_admin"].includes(profile.role)) redirect("/dashboard");

  const admin = createAdminClient();

  // All active cycles in this hospital
  const { data: cycles } = await admin
    .from("competency_cycles")
    .select(`
      id, cycle_type, status, start_date, end_date,
      profiles!nurse_id(id, full_name),
      cycle_frameworks(
        id, status,
        frameworks(id, name, library)
      )
    `)
    .eq("hospital_id", profile.hospital_id ?? "")
    .eq("status", "active")
    .order("start_date");

  // Assessments assigned to this assessor (pending/in_progress)
  const { data: myAssessments } = await admin
    .from("assessments")
    .select(`
      id, method, status, score, assessed_at,
      competency_cycles!cycle_id(id, cycle_type, profiles!nurse_id(full_name)),
      framework_competencies!competency_id(id, name,
        framework_domains!domain_id(name, frameworks!framework_id(name))
      )
    `)
    .eq("assessor_id", user.id)
    .in("status", ["pending","in_progress"])
    .order("created_at");

  // Recent assessments completed by this assessor
  const { data: recentDone } = await admin
    .from("assessments")
    .select("id, method, score, assessed_at, framework_competencies!competency_id(name)")
    .eq("assessor_id", user.id)
    .eq("status", "complete")
    .order("assessed_at", { ascending: false })
    .limit(5);

  const METHOD_ICONS: Record<string, string> = {
    knowledge: "📝", direct_observation: "👁️", simulation: "🎮",
    osce: "🏥", concurrent_audit: "📋", retrospective_audit: "🗂️", logbook: "📓",
  };

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Assessor Dashboard</h1>
        <p className="text-gray-400 text-sm mt-0.5">Welcome, {profile.full_name} — {(cycles ?? []).length} active cycles in your hospital</p>
      </div>

      {/* Pending assessments for this assessor */}
      {(myAssessments ?? []).length > 0 && (
        <div className="mb-8">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Your Pending Assessments</h2>
          <div className="flex flex-col gap-2">
            {(myAssessments ?? []).map(a => {
              const cycle = a.competency_cycles as unknown as { id: string; cycle_type: string; profiles: { full_name: string } | null } | null;
              const comp = a.framework_competencies as unknown as { id: string; name: string; framework_domains: { name: string; frameworks: { name: string } | null } | null } | null;
              return (
                <div key={a.id} className="bg-white rounded-xl border border-gray-100 px-5 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{METHOD_ICONS[a.method] ?? "•"}</span>
                    <div>
                      <p className="font-semibold text-sm text-gray-900">{comp?.name}</p>
                      <p className="text-[10px] text-gray-400">
                        {comp?.framework_domains?.frameworks?.name} · {comp?.framework_domains?.name}
                      </p>
                      <p className="text-[10px] text-teal-600 mt-0.5">
                        Nurse: {cycle?.profiles?.full_name ?? "—"} · {cycle?.cycle_type} cycle
                      </p>
                    </div>
                  </div>
                  <Link href={`/assessor/assess/${a.id}`}
                    className="px-4 py-2 bg-teal-600 text-white text-xs font-semibold rounded-lg hover:bg-teal-700">
                    {a.status === "in_progress" ? "Continue →" : "Start →"}
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* All active cycles */}
      <div className="mb-8">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Active Cycles ({(cycles ?? []).length})</h2>
        <div className="flex flex-col gap-3">
          {(cycles ?? []).map(c => {
            const nurse = c.profiles as unknown as { id: string; full_name: string } | null;
            const fws = (c.cycle_frameworks ?? []) as unknown as { id: string; status: string; frameworks: { id: string; name: string; library: string } | null }[];
            return (
              <div key={c.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-teal-50 flex items-center justify-center font-bold text-teal-700 text-sm">
                      {nurse?.full_name?.[0] ?? "?"}
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-gray-900">{nurse?.full_name}</p>
                      <p className="text-[10px] text-gray-400 capitalize">{c.cycle_type} cycle · started {new Date(c.start_date).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <Link href={`/assessor/cycle/${c.id}`}
                    className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 text-xs font-semibold rounded-lg hover:bg-gray-50">
                    Assess →
                  </Link>
                </div>
                {fws.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-5 pb-3">
                    {fws.map(f => (
                      <span key={f.id} className={`text-[10px] px-2 py-0.5 rounded ${
                        f.status === "complete" ? "bg-teal-50 text-teal-600" :
                        f.status === "in_progress" ? "bg-blue-50 text-blue-600" :
                        "bg-gray-100 text-gray-500"
                      }`}>{f.frameworks?.name}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {!(cycles ?? []).length && (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
              <p className="text-gray-400 text-sm">No active cycles in your hospital. Hospital admin creates cycles for nurses.</p>
            </div>
          )}
        </div>
      </div>

      {/* Recent completed */}
      {(recentDone ?? []).length > 0 && (
        <div>
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Recently Completed</h2>
          <div className="flex flex-col gap-2">
            {(recentDone ?? []).map(a => {
              const comp = a.framework_competencies as unknown as { name: string } | null;
              const score = a.score ?? 0;
              return (
                <div key={a.id} className="bg-white rounded-xl border border-gray-100 px-5 py-3 flex items-center gap-4">
                  <span className="text-lg">{METHOD_ICONS[a.method] ?? "•"}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">{comp?.name}</p>
                    <p className="text-[10px] text-gray-400">{a.assessed_at ? new Date(a.assessed_at).toLocaleDateString() : "—"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: SCORE_COLORS[score] ?? "#6b7280" }}>{score}</div>
                    <span className="text-xs text-gray-500">{SCORE_LABELS[score]}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
