import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import CycleCreator from "./CycleCreator";

const CYCLE_COLORS: Record<string, string> = {
  orientation: "bg-blue-100 text-blue-700",
  probation:   "bg-yellow-100 text-yellow-700",
  annual:      "bg-green-100 text-green-700",
  remediation: "bg-red-100 text-red-700",
  specialty:   "bg-purple-100 text-purple-700",
};

const SCORE_LABELS: Record<number, string> = {
  0: "Training", 1: "Novice", 2: "Adv. Beginner",
  3: "Competent", 4: "Competent+", 5: "Proficient", 6: "Expert",
};

export default async function CompetenciesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, hospital_id")
    .eq("id", user.id)
    .single();

  if (!profile || !["hospital_admin", "super_admin"].includes(profile.role)) {
    redirect("/dashboard");
  }

  const hospitalId = profile.hospital_id;

  const [{ data: nurses }, { data: frameworks }, { data: cycles }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, specialization, email")
      .eq("hospital_id", hospitalId ?? "")
      .eq("role", "nurse")
      .order("full_name"),
    supabase
      .from("frameworks")
      .select("id, name, library, sort_order, pub_status")
      .eq("is_active", true)
      .order("library")
      .order("sort_order")
      .returns<{ id: string; name: string; library: string; sort_order: number; pub_status?: string | null }[]>(),
    supabase
      .from("competency_cycles")
      .select("id, nurse_id, cycle_type, status, start_date, end_date, cycle_framework_assignments(framework_id)")
      .eq("hospital_id", hospitalId ?? "")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  // Fetch assessment progress per cycle
  const cycleIds = (cycles ?? []).map(c => c.id);
  const nurseIds = (nurses ?? []).map(n => n.id);

  const [{ data: assessments }, { data: frameworkDomains }] = await Promise.all([
    cycleIds.length
      ? supabase.from("competency_assessments").select("cycle_id, nurse_id, score").in("cycle_id", cycleIds)
      : Promise.resolve({ data: [] as { cycle_id: string; nurse_id: string; score: number }[] }),
    supabase.from("framework_domains")
      .select("id, framework_id, framework_competencies(id)")
      .in("framework_id", (frameworks ?? []).map(f => f.id)),
  ]);

  // Count total competencies per framework
  const frameworkCompCount: Record<string, number> = {};
  (frameworkDomains ?? []).forEach(d => {
    if (!frameworkCompCount[d.framework_id]) frameworkCompCount[d.framework_id] = 0;
    frameworkCompCount[d.framework_id] += (d.framework_competencies ?? []).length;
  });

  // Build cycle rows with nurse + progress
  const nurseMap = Object.fromEntries((nurses ?? []).map(n => [n.id, n]));
  const frameworkMap = Object.fromEntries((frameworks ?? []).map(f => [f.id, f]));

  const cycleRows = (cycles ?? []).map(cycle => {
    const nurse = nurseMap[cycle.nurse_id];
    const cycleAssessments = (assessments ?? []).filter(a => a.cycle_id === cycle.id);
    const assignedFrameworkIds = (cycle.cycle_framework_assignments ?? []).map((a: { framework_id: string }) => a.framework_id);
    const totalComps = assignedFrameworkIds.reduce((sum: number, fid: string) => sum + (frameworkCompCount[fid] ?? 0), 0);
    const scoredCount = cycleAssessments.length;
    const pct = totalComps > 0 ? Math.round(scoredCount / totalComps * 100) : 0;
    const avgScore = scoredCount > 0
      ? Math.round(cycleAssessments.reduce((s, a) => s + a.score, 0) / scoredCount * 10) / 10
      : null;
    return { ...cycle, nurse, totalComps, scoredCount, pct, avgScore, assignedFrameworkIds };
  });

  const activeCycles = cycleRows.filter(c => c.status === "active");
  const historyCycles = cycleRows.filter(c => c.status !== "active");

  // Hospital-level stats
  const nursesWithCycles = new Set(cycleRows.filter(c => c.status === "active").map(c => c.nurse_id)).size;
  const allScores = (assessments ?? []).map(a => a.score);
  const hospitalAvg = allScores.length > 0
    ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length * 10) / 10
    : null;
  const competentCount = allScores.filter(s => s >= 3).length;

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Competency Cycles</h1>
          <p className="text-gray-400 text-sm mt-0.5">Manage nurse assessment cycles and track framework completion.</p>
        </div>
        <CycleCreator
          nurses={(nurses ?? []).map(n => ({ id: n.id, full_name: n.full_name, specialization: n.specialization ?? null }))}
          frameworks={(frameworks ?? []).map(f => ({ id: f.id, name: f.name, library: f.library }))}
        />
      </div>

      {/* Hospital stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {[
          { label: "Nurses on Cycle",     value: nursesWithCycles,                        color: "text-teal-600" },
          { label: "Total Nurses",         value: (nurses ?? []).length,                   color: "text-gray-600" },
          { label: "Competency Avg Score", value: hospitalAvg !== null ? hospitalAvg : "—", color: "text-indigo-600" },
          { label: "Competent+ Scores",    value: competentCount,                          color: "text-green-600" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Active cycles */}
      <div className="mb-8">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Active Cycles ({activeCycles.length})</h2>
        {activeCycles.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400">
            <p className="text-2xl mb-2">🔄</p>
            <p className="text-sm">No active cycles yet. Use &quot;+ Create Cycle&quot; to assign a nurse to a competency assessment cycle.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Nurse</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Cycle</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Frameworks</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Progress</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Avg Score</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {activeCycles.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50/40">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {row.nurse?.full_name?.[0] ?? "?"}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 text-sm">{row.nurse?.full_name ?? "Unknown"}</p>
                          <p className="text-[10px] text-gray-400">{row.nurse?.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded capitalize ${CYCLE_COLORS[row.cycle_type] ?? "bg-gray-100 text-gray-600"}`}>
                        {row.cycle_type}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-gray-500">
                      {row.assignedFrameworkIds.length === 0
                        ? <span className="text-gray-300">All frameworks</span>
                        : row.assignedFrameworkIds.map((fid: string) => frameworkMap[fid]?.name ?? fid).join(", ")}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${row.pct >= 75 ? "bg-green-500" : row.pct >= 40 ? "bg-amber-400" : "bg-gray-300"}`}
                            style={{ width: `${row.pct}%` }} />
                        </div>
                        <span className="text-xs text-gray-600">{row.scoredCount}/{row.totalComps}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      {row.avgScore !== null ? (
                        <div>
                          <span className="text-sm font-bold text-gray-800">{row.avgScore}</span>
                          <span className="text-[10px] text-gray-400 ml-1">{SCORE_LABELS[Math.floor(row.avgScore)]}</span>
                        </div>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-gray-400">{row.start_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Frameworks overview */}
      <div>
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Available Frameworks</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(frameworks ?? []).map(f => {
            const status = f.pub_status ?? "published";
            const statusCfg: Record<string, { label: string; cls: string }> = {
              draft:      { label: "Draft",      cls: "text-gray-500 bg-gray-100" },
              in_review:  { label: "In Review",  cls: "text-amber-700 bg-amber-50" },
              approved:   { label: "Approved",   cls: "text-blue-700 bg-blue-50" },
              published:  { label: "Published",  cls: "text-green-700 bg-green-50" },
              archived:   { label: "Archived",   cls: "text-red-500 bg-red-50" },
            };
            const sc = statusCfg[status] ?? statusCfg.published;
            return (
              <div key={f.id} className={`rounded-xl border p-4 ${
                f.library === "core" ? "border-teal-100 bg-teal-50/30"
                : f.library === "specialty" ? "border-indigo-100 bg-indigo-50/30"
                : "border-violet-100 bg-violet-50/30"
              }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[9px] font-bold uppercase tracking-wider ${
                        f.library === "core" ? "text-teal-500" : f.library === "specialty" ? "text-indigo-400" : "text-violet-400"
                      }`}>{f.library}</span>
                      {status !== "published" && (
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${sc.cls}`}>{sc.label}</span>
                      )}
                    </div>
                    <p className="font-semibold text-gray-900 text-sm mt-0.5">{f.name}</p>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">{frameworkCompCount[f.id] ?? 0} items</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* History */}
      {historyCycles.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Cycle History</h2>
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Nurse</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Cycle</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Score</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Period</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {historyCycles.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50/40 opacity-70">
                    <td className="px-5 py-3 font-medium text-gray-900">{row.nurse?.full_name ?? "Unknown"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded capitalize ${CYCLE_COLORS[row.cycle_type] ?? "bg-gray-100 text-gray-600"}`}>
                        {row.cycle_type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-400 capitalize">{row.status}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{row.avgScore ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{row.start_date}{row.end_date ? ` → ${row.end_date}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
