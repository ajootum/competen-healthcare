import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import AssessClient from "./AssessClient";

type SearchParams = Promise<{ nurse?: string; cycle?: string }>;

export default async function AssessorAssessPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: assessor } = await supabase
    .from("profiles")
    .select("role, hospital_id, full_name")
    .eq("id", user.id)
    .single();

  if (!assessor || !["assessor", "hospital_admin", "super_admin"].includes(assessor.role)) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const nurseId = params.nurse;
  const cycleId = params.cycle;

  const hospitalId = assessor.hospital_id ?? null;

  // If no nurse selected, show nurse list
  if (!nurseId) {
    const { data: nurses } = hospitalId
      ? await supabase
          .from("profiles")
          .select("id, full_name, specialization, email")
          .eq("hospital_id", hospitalId)
          .eq("role", "nurse")
          .order("full_name")
      : { data: [] };

    // Fetch active cycles per nurse
    const nurseIds = (nurses ?? []).map(n => n.id);
    const { data: allCycles } = nurseIds.length
      ? await supabase
          .from("competency_cycles")
          .select("nurse_id, id, cycle_type, status")
          .in("nurse_id", nurseIds)
          .eq("status", "active")
      : { data: [] };

    return (
      <div className="max-w-4xl">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">Conduct Assessment</h1>
          <p className="text-gray-400 text-sm mt-0.5">Select a nurse to begin scoring their competencies.</p>
        </div>

        {!hospitalId ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-800">
            Your assessor account is not linked to a hospital. Ask a hospital administrator to link you.
          </div>
        ) : !(nurses ?? []).length ? (
          <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
            <p className="text-3xl mb-3">👩‍⚕️</p>
            <p className="text-gray-500 text-sm">No nurses in your hospital yet.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {(nurses ?? []).map((nurse, i) => {
              const activeCycle = (allCycles ?? []).find(c => c.nurse_id === nurse.id);
              return (
                <div key={nurse.id} className={`flex items-center gap-4 px-5 py-4 ${i > 0 ? "border-t border-gray-50" : ""}`}>
                  <div className="w-9 h-9 rounded-full bg-teal-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
                    {nurse.full_name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm">{nurse.full_name}</p>
                    <p className="text-xs text-gray-400">{nurse.email}</p>
                  </div>
                  {activeCycle ? (
                    <Link
                      href={`/assessor/assess?nurse=${nurse.id}&cycle=${activeCycle.id}`}
                      className="text-xs font-semibold text-indigo-600 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors capitalize">
                      {activeCycle.cycle_type} cycle →
                    </Link>
                  ) : (
                    <span className="text-xs text-gray-400 border border-gray-200 px-3 py-1.5 rounded-lg">No active cycle</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Nurse selected — load cycle and framework data
  const [{ data: nurse }, { data: cycle }] = await Promise.all([ createAdminClient().from("profiles").select("full_name, specialization").eq("id", nurseId).single(),
    cycleId
      ? supabase.from("competency_cycles").select("id, cycle_type, start_date, end_date").eq("id", cycleId).single()
      : supabase.from("competency_cycles").select("id, cycle_type, start_date, end_date").eq("nurse_id", nurseId).eq("status", "active").single(),
  ]);

  if (!cycle || !nurse) {
    return (
      <div className="max-w-2xl">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <p className="text-amber-800 font-semibold mb-1">No active cycle found</p>
          <p className="text-amber-700 text-sm mb-3">This nurse does not have an active competency cycle. Create one from the Admin panel before assessing.</p>
          <Link href="/assessor/assess" className="text-sm text-indigo-600 hover:underline">← Back to nurse list</Link>
        </div>
      </div>
    );
  }

  // Get frameworks assigned to this cycle
  const { data: assignments } = await supabase
    .from("cycle_framework_assignments")
    .select("framework_id")
    .eq("cycle_id", cycle.id);

  const frameworkIds = (assignments ?? []).map(a => a.framework_id);

  // Load frameworks with domains + competencies
  let frameworkQuery = supabase
    .from("frameworks")
    .select("id, name, library, sort_order, framework_domains(id, name, sort_order, framework_competencies(id, name, sort_order))")
    .eq("is_active", true)
    .order("library")
    .order("sort_order");

  if (frameworkIds.length > 0) {
    frameworkQuery = frameworkQuery.in("id", frameworkIds);
  }

  const { data: frameworks } = await frameworkQuery;

  // Load existing assessments
  const { data: existingAssessments } = await supabase
    .from("competency_assessments")
    .select("competency_id, score")
    .eq("cycle_id", cycle.id)
    .eq("nurse_id", nurseId);

  const existing: Record<string, number> = Object.fromEntries(
    (existingAssessments ?? []).map(a => [a.competency_id, a.score])
  );

  const sortedFrameworks = (frameworks ?? []).map(f => ({
    ...f,
    framework_domains: [...(f.framework_domains ?? [])].sort((a, b) => a.sort_order - b.sort_order).map(d => ({
      ...d,
      framework_competencies: [...(d.framework_competencies ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    })),
  }));

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <Link href="/assessor/assess" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">← Nurse List</Link>
        <span className="text-gray-200">/</span>
        <span className="text-xs text-gray-600 capitalize">{nurse.full_name} · {cycle.cycle_type} Cycle</span>
      </div>
      <AssessClient
        cycleId={cycle.id}
        nurseId={nurseId}
        nurseName={nurse.full_name}
        cycleType={cycle.cycle_type}
        frameworks={sortedFrameworks as Parameters<typeof AssessClient>[0]["frameworks"]}
        existing={existing}
      />
    </div>
  );
}
