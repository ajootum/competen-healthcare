import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

const LEVEL_LABELS: Record<number, { label: string; color: string; short: string }> = {
  0: { label: "Requires Training",           short: "Training",  color: "bg-red-100 text-red-700" },
  1: { label: "Novice",                       short: "Novice",    color: "bg-orange-100 text-orange-700" },
  2: { label: "Advanced Beginner",            short: "Adv. Beg.", color: "bg-yellow-100 text-yellow-700" },
  3: { label: "Competent",                    short: "Competent", color: "bg-teal-100 text-teal-700" },
  4: { label: "Competent (Speed & Quality)",  short: "Competent+",color: "bg-teal-100 text-teal-700" },
  5: { label: "Proficient",                   short: "Proficient",color: "bg-blue-100 text-blue-700" },
  6: { label: "Expert",                       short: "Expert",    color: "bg-purple-100 text-purple-700" },
};

const DOMAIN_ICONS: Record<string, string> = {
  "Assessment": "🔍", "Airway": "💨", "Breathing": "🫁", "Circulation": "🫀",
  "Disability": "🧠", "Exposure": "🩹", "Skin": "🩹", "Wound": "🩹",
  "Renal": "🔬", "GI": "🍽️", "Nutrition": "🍽️", "Medication": "💊",
  "Infection": "🧼", "IPC": "🧼", "Family": "🤝", "Psychosocial": "🤝",
  "Mental": "🤝", "Quality": "✅", "Safety": "✅", "Communication": "💬",
  "Teamwork": "💬", "End-of-Life": "🕊️", "Palliative": "🕊️", "Neonatal": "👶",
};

function domainIcon(name: string) {
  const upper = name.toUpperCase();
  for (const [key, icon] of Object.entries(DOMAIN_ICONS)) {
    if (upper.includes(key.toUpperCase())) return icon;
  }
  return "📋";
}

function avgScore(scores: number[]): number | null {
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10;
}

export default async function PassportPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: cycles }, { data: frameworks }] = await Promise.all([
    supabase.from("profiles").select("full_name, role, specialization, hospital_id").eq("id", user.id).single(),
    supabase.from("competency_cycles")
      .select("id, cycle_type, status, start_date, end_date")
      .eq("nurse_id", user.id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase.from("frameworks")
      .select("id, name, library, sort_order, framework_domains(id, name, sort_order, framework_competencies(id, name, sort_order))")
      .eq("is_active", true)
      .order("library")
      .order("sort_order"),
  ]);

  const activeCycle = cycles?.find(c => c.status === "active") ?? null;

  // Fetch cycle framework assignments + assessments
  let cycleFrameworkIds: string[] = [];
  let assessmentMap: Record<string, number> = {};

  if (activeCycle) {
    const [{ data: assignments }, { data: assessments }] = await Promise.all([
      supabase.from("cycle_framework_assignments")
        .select("framework_id")
        .eq("cycle_id", activeCycle.id),
      supabase.from("competency_assessments")
        .select("competency_id, score")
        .eq("cycle_id", activeCycle.id)
        .eq("nurse_id", user.id),
    ]);
    cycleFrameworkIds = (assignments ?? []).map(a => a.framework_id);
    assessmentMap = Object.fromEntries((assessments ?? []).map(a => [a.competency_id, a.score]));
  }

  const firstName = profile?.full_name?.split(" ")[0] ?? "Nurse";
  const initials = (profile?.full_name ?? "NN").split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();

  // Total assessed competencies
  const totalScores = Object.values(assessmentMap);
  const overallAvg = avgScore(totalScores);
  const overallLevelNum = overallAvg !== null ? Math.floor(overallAvg) : null;
  const overallLevel = overallLevelNum !== null ? LEVEL_LABELS[overallLevelNum] : null;

  const coreFrameworks = (frameworks ?? []).filter(f => f.library === "core");
  const specialtyFrameworks = (frameworks ?? []).filter(f => f.library === "specialty");
  const roleFrameworks = (frameworks ?? []).filter(f => f.library === "role");

  const CYCLE_COLORS: Record<string, string> = {
    orientation: "bg-blue-50 text-blue-700 border-blue-200",
    probation:   "bg-yellow-50 text-yellow-700 border-yellow-200",
    annual:      "bg-green-50 text-green-700 border-green-200",
    remediation: "bg-red-50 text-red-700 border-red-200",
    specialty:   "bg-purple-50 text-purple-700 border-purple-200",
  };

  return (
    <div className="max-w-5xl space-y-5">

      {/* PASSPORT HEADER */}
      <div className="bg-[#0a2e38] rounded-2xl overflow-hidden">
        <div className="bg-teal-500/20 border-b border-teal-500/20 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-teal-500 flex items-center justify-center text-white font-bold text-xs">C</div>
            <span className="text-teal-200 text-xs font-semibold tracking-widest uppercase">Competen Healthcare · Clinical Competency Passport</span>
          </div>
          {activeCycle && (
            <span className={`text-[10px] font-bold px-2.5 py-1 rounded border capitalize ${CYCLE_COLORS[activeCycle.cycle_type] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
              {activeCycle.cycle_type} Cycle · Active
            </span>
          )}
        </div>
        <div className="px-6 py-5 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-start">
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              {[
                { label: "Name",    value: profile?.full_name ?? "—" },
                { label: "Role",    value: profile?.role?.replace(/_/g, " ") ?? "—" },
                { label: "Specialty", value: profile?.specialization ?? "—" },
                { label: "Cycle",   value: activeCycle ? `${activeCycle.cycle_type} (${activeCycle.start_date})` : "No active cycle" },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-[9px] font-bold text-teal-400/60 tracking-widest uppercase mb-0.5">{label}</p>
                  <p className="text-white text-sm font-semibold capitalize truncate">{value}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3 pt-4 border-t border-teal-700/40">
              <div className="text-center">
                <p className="text-2xl font-bold text-white">{totalScores.length}</p>
                <p className="text-[9px] text-teal-400 font-semibold uppercase tracking-wider">Assessed</p>
              </div>
              <div className="text-center border-x border-teal-700/30">
                <p className="text-2xl font-bold text-white">{totalScores.filter(s => s >= 3).length}</p>
                <p className="text-[9px] text-teal-400 font-semibold uppercase tracking-wider">Competent+</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-white">{overallAvg ?? "—"}</p>
                <p className="text-[9px] text-teal-400 font-semibold uppercase tracking-wider">Avg Score</p>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="w-16 h-16 rounded-xl bg-teal-500 flex items-center justify-center text-white font-bold text-2xl">{initials}</div>
            {overallLevel ? (
              <span className={`text-[10px] font-bold px-2.5 py-1 rounded border ${overallLevel.color}`}>
                {overallLevel.short.toUpperCase()}
              </span>
            ) : (
              <span className="text-[10px] font-bold px-2.5 py-1 rounded border bg-gray-100 text-gray-400 border-gray-200">PENDING</span>
            )}
          </div>
        </div>
      </div>

      {/* NO CYCLE STATE */}
      {!activeCycle && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-center">
          <p className="text-amber-800 font-semibold mb-1">No active competency cycle</p>
          <p className="text-amber-600 text-sm">Your hospital administrator will assign you to a cycle (Orientation, Probation, or Annual). Once assigned, your competency progress will appear here.</p>
        </div>
      )}

      {/* SCORE LEGEND */}
      <div className="bg-white border border-gray-100 rounded-xl p-4">
        <p className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-3">Competency Scale</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {Object.entries(LEVEL_LABELS).map(([score, lvl]) => (
            <div key={score} className={`rounded-lg px-2 py-1.5 text-center ${lvl.color}`}>
              <p className="text-lg font-bold">{score}</p>
              <p className="text-[9px] font-semibold leading-tight">{lvl.short}</p>
            </div>
          ))}
        </div>
      </div>

      {/* CORE FRAMEWORK */}
      {coreFrameworks.map(framework => {
        const isInCycle = cycleFrameworkIds.includes(framework.id) || cycleFrameworkIds.length === 0;
        return (
          <div key={framework.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-teal-600 px-5 py-3 flex items-center justify-between">
              <div>
                <p className="text-[9px] font-bold text-teal-200 tracking-widest uppercase">Core Framework</p>
                <h2 className="text-white font-bold text-sm">{framework.name}</h2>
              </div>
              {activeCycle && (
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${isInCycle ? "bg-white/20 text-white" : "bg-white/10 text-teal-300"}`}>
                  {isInCycle ? "In Your Cycle" : "Not Assigned"}
                </span>
              )}
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(framework.framework_domains ?? [])
                .sort((a, b) => a.sort_order - b.sort_order)
                .map(domain => {
                  const comps = (domain.framework_competencies ?? []).sort((a, b) => a.sort_order - b.sort_order);
                  const domainScores = comps.map(c => assessmentMap[c.id]).filter(s => s !== undefined) as number[];
                  const avg = avgScore(domainScores);
                  const assessed = domainScores.length;
                  const total = comps.length;
                  const pct = total > 0 ? Math.round(assessed / total * 100) : 0;
                  const lvl = avg !== null ? LEVEL_LABELS[Math.floor(avg)] : null;
                  return (
                    <div key={domain.id} className="border border-gray-100 rounded-lg p-3 hover:border-teal-200 transition-colors">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-base shrink-0">{domainIcon(domain.name)}</span>
                          <p className="text-xs font-semibold text-gray-800 leading-tight truncate">{domain.name.replace(/^Domain \d+:\s*/, "")}</p>
                        </div>
                        {lvl && (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${lvl.color}`}>{lvl.short}</span>
                        )}
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1">
                        <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-[9px] text-gray-400">{assessed}/{total} assessed {avg !== null ? `· avg ${avg}` : ""}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {comps.map(comp => {
                          const s = assessmentMap[comp.id];
                          return (
                            <span key={comp.id} title={comp.name}
                              className={`inline-block w-5 h-5 rounded text-[9px] font-bold text-center leading-5 ${
                                s !== undefined ? (LEVEL_LABELS[s]?.color ?? "bg-gray-100 text-gray-400") : "bg-gray-100 text-gray-300"
                              }`}>
                              {s !== undefined ? s : "·"}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        );
      })}

      {/* SPECIALTY FRAMEWORKS */}
      {specialtyFrameworks.length > 0 && (
        <div className="space-y-3">
          <p className="text-[10px] font-bold text-gray-400 tracking-widest uppercase px-1">Specialty Frameworks</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {specialtyFrameworks.map(framework => {
              const isInCycle = cycleFrameworkIds.includes(framework.id);
              if (!isInCycle && activeCycle) return null;
              const allComps = (framework.framework_domains ?? []).flatMap(d => d.framework_competencies ?? []);
              const scores = allComps.map(c => assessmentMap[c.id]).filter(s => s !== undefined) as number[];
              const avg = avgScore(scores);
              const pct = allComps.length > 0 ? Math.round(scores.length / allComps.length * 100) : 0;
              const lvl = avg !== null ? LEVEL_LABELS[Math.floor(avg)] : null;
              return (
                <div key={framework.id} className="bg-white border border-indigo-100 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-[9px] font-bold text-indigo-400 tracking-widest uppercase">Specialty</p>
                      <p className="font-semibold text-gray-900 text-sm">{framework.name}</p>
                    </div>
                    {lvl ? (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${lvl.color}`}>{lvl.short}</span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-400">Pending</span>
                    )}
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1">
                    <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[9px] text-gray-400">{scores.length}/{allComps.length} assessed</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ROLE FRAMEWORKS */}
      {roleFrameworks.length > 0 && (
        <div className="space-y-3">
          <p className="text-[10px] font-bold text-gray-400 tracking-widest uppercase px-1">Role-Based Frameworks</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {roleFrameworks.map(framework => {
              const isInCycle = cycleFrameworkIds.includes(framework.id);
              if (!isInCycle && activeCycle) return null;
              const allComps = (framework.framework_domains ?? []).flatMap(d => d.framework_competencies ?? []);
              const scores = allComps.map(c => assessmentMap[c.id]).filter(s => s !== undefined) as number[];
              const avg = avgScore(scores);
              const pct = allComps.length > 0 ? Math.round(scores.length / allComps.length * 100) : 0;
              const lvl = avg !== null ? LEVEL_LABELS[Math.floor(avg)] : null;
              return (
                <div key={framework.id} className="bg-white border border-violet-100 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-[9px] font-bold text-violet-400 tracking-widest uppercase">Role</p>
                      <p className="font-semibold text-gray-900 text-sm">{framework.name}</p>
                    </div>
                    {lvl ? (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${lvl.color}`}>{lvl.short}</span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-400">Pending</span>
                    )}
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1">
                    <div className="h-full bg-violet-400 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[9px] text-gray-400">{scores.length}/{allComps.length} assessed</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="text-center py-4">
        <Link href="/dashboard" className="text-xs text-gray-400 hover:text-teal-600 transition-colors">← Back to Dashboard</Link>
      </div>
    </div>
  );
}
