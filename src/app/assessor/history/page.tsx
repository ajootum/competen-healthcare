import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

// Assessment History — the assessor's completed assessments from the real
// records (this page was previously an empty placeholder), with CSV export.

const METHOD_ICONS: Record<string, string> = {
  knowledge: "📝", direct_observation: "👁️", simulation: "🎮",
  osce: "🏥", concurrent_audit: "📋", retrospective_audit: "🗂️", logbook: "📓",
};

export default async function AssessmentHistoryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !["assessor", "educator", "hospital_admin"].includes(profile.role)) redirect("/dashboard");

  const { data: rows } = await admin.from("assessments")
    .select(`id, method, status, score, assessed_at,
      competency_cycles!cycle_id(profiles!nurse_id(full_name)),
      framework_competencies!competency_id(name, framework_domains!domain_id(name))`)
    .eq("assessor_id", user.id).eq("status", "complete")
    .order("assessed_at", { ascending: false }).limit(200);

  const done = rows ?? [];

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Assessment History</h1>
          <p className="text-gray-400 text-sm mt-0.5">Every assessment you&apos;ve completed, most recent first.</p>
        </div>
        {done.length > 0 && (
          <a href="/api/reports/history"
            className="text-xs font-semibold text-indigo-700 border border-indigo-200 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors">
            ⬇ Export CSV
          </a>
        )}
      </div>

      {done.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-xl p-12 text-center">
          <p className="text-3xl mb-3">📁</p>
          <p className="text-gray-500 font-medium text-sm">No completed assessments yet</p>
          <a href="/assessor/assess"
            className="mt-4 inline-block text-sm text-indigo-600 border border-indigo-200 px-4 py-2 rounded-lg hover:bg-indigo-50 transition-colors">
            Start an assessment →
          </a>
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden divide-y divide-gray-50">
          {done.map(a => {
            const cyc = a.competency_cycles as unknown as { profiles: { full_name: string } | null } | null;
            const comp = a.framework_competencies as unknown as { name: string; framework_domains: { name: string } | null } | null;
            return (
              <div key={a.id} className="px-5 py-3 flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-base shrink-0">
                  {METHOD_ICONS[a.method] ?? "📄"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate">
                    <b>{cyc?.profiles?.full_name ?? "—"}</b> · {comp?.name ?? "Competency"}
                  </p>
                  <p className="text-[10px] text-gray-400 capitalize" suppressHydrationWarning>
                    {a.method.replace(/_/g, " ")}
                    {comp?.framework_domains?.name ? ` · ${comp.framework_domains.name}` : ""}
                    {a.assessed_at ? ` · ${new Date(a.assessed_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : ""}
                  </p>
                </div>
                {a.score !== null && (
                  <span className={`w-7 h-7 rounded-full text-white text-xs font-bold flex items-center justify-center shrink-0 ${
                    a.score >= 3 ? "bg-teal-500" : "bg-orange-400"
                  }`}>{a.score}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
