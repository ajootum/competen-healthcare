import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { generateAssessorQueue } from "@/lib/engines/tasks";
import SmartQueue from "../SmartQueue";

// Assessment Queue (Sidebar Redesign spec §Assessment Queue): the full
// generated workload plus everything formally assigned to this assessor.
// Prioritisation comes from the queue engine; there are no due dates on
// assessments, so "overdue" states aren't invented.

const METHOD_ICONS: Record<string, string> = {
  knowledge: "📝", direct_observation: "👁️", simulation: "🎮",
  osce: "🏥", concurrent_audit: "📋", retrospective_audit: "🗂️", logbook: "📓",
};

export default async function AssessmentQueuePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["assessor", "educator", "hospital_admin"].includes(profile.role)) redirect("/dashboard");

  const { data: myPending } = await admin.from("assessments")
    .select(`id, method, status, created_at,
      competency_cycles!cycle_id(id, cycle_type, profiles!nurse_id(full_name)),
      framework_competencies!competency_id(name, framework_domains!domain_id(name, frameworks!framework_id(name)))`)
    .eq("assessor_id", user.id).in("status", ["pending", "in_progress"])
    .order("created_at");

  let queue: Awaited<ReturnType<typeof generateAssessorQueue>> = { tasks: [], workload: { tasks: 0, estMinutes: 0, learners: 0, urgent: 0 } };
  try {
    queue = await generateAssessorQueue(admin, profile.hospital_id ?? "", user.id);
  } catch { /* requirement matrix not installed yet */ }

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Assessment Queue</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Your generated workload and formally assigned assessments, in priority order.
        </p>
      </div>

      <SmartQueue tasks={queue.tasks} workload={queue.workload} />

      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden mt-6">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Assigned to Me</h2>
            <p className="text-[10px] text-gray-400">Formal assessment records awaiting your score</p>
          </div>
          <Link href="/assessor/assess"
            className="text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition-colors">
            ＋ Conduct Assessment
          </Link>
        </div>
        {(myPending ?? []).length === 0 ? (
          <p className="px-5 py-10 text-center text-xs text-gray-400">
            Nothing formally assigned. Use the generated queue above, or start from Conduct Assessment.
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {(myPending ?? []).map(a => {
              const cyc = a.competency_cycles as unknown as { id: string; cycle_type: string | null; profiles: { full_name: string } | null } | null;
              const comp = a.framework_competencies as unknown as {
                name: string;
                framework_domains: { name: string; frameworks: { name: string } | null } | null;
              } | null;
              return (
                <Link key={a.id} href={cyc?.id ? `/assessor/cycle/${cyc.id}` : "/assessor/assess"}
                  className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors">
                  <span className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-base shrink-0">
                    {METHOD_ICONS[a.method] ?? "📄"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">
                      <b>{cyc?.profiles?.full_name ?? "—"}</b> · {comp?.name ?? "Competency"}
                    </p>
                    <p className="text-[10px] text-gray-400 capitalize truncate">
                      {a.method.replace(/_/g, " ")}
                      {comp?.framework_domains?.name ? ` · ${comp.framework_domains.name}` : ""}
                      {comp?.framework_domains?.frameworks?.name ? ` · ${comp.framework_domains.frameworks.name}` : ""}
                    </p>
                  </div>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                    a.status === "in_progress" ? "bg-blue-50 text-blue-600" : "bg-amber-50 text-amber-700"
                  }`}>
                    {a.status === "in_progress" ? "In progress" : "Pending"}
                  </span>
                  <span className="text-gray-300 shrink-0">›</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
