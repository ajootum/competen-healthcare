import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

const SCORE_COLORS = ["#ef4444","#f97316","#eab308","#14b8a6","#0d9488","#3b82f6","#8b5cf6"];
const SCORE_LABELS = ["Training Required","Novice","Advanced Beginner","Competent","Competent+","Proficient","Expert"];

export default async function WorkforcePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["hospital_admin","super_admin"].includes(profile.role)) redirect("/dashboard");

  const admin = createAdminClient();
  const hospitalId = profile.hospital_id ?? "";

  // All nurses in hospital
  const { data: nurses } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("hospital_id", hospitalId)
    .eq("role", "nurse")
    .order("full_name");

  const nurseIds = (nurses ?? []).map(n => n.id);

  // All cycles
  const { data: cycles } = nurseIds.length ? await admin
    .from("competency_cycles")
    .select("id, nurse_id, cycle_type, status, start_date")
    .in("nurse_id", nurseIds)
    .order("start_date", { ascending: false }) : { data: [] };

  // All competency scores (most recent per nurse×competency)
  const { data: allScores } = nurseIds.length ? await admin
    .from("competency_scores")
    .select(`
      nurse_id, competency_id, score, is_passing, educator_validated,
      framework_competencies!competency_id(
        name,
        framework_domains(name, frameworks(id, name, library))
      )
    `)
    .in("nurse_id", nurseIds)
    .order("assessed_at", { ascending: false }) : { data: [] };

  // Deduplicate: best (most recent) score per nurse×competency
  const seen = new Set<string>();
  const deduped = [];
  for (const s of allScores ?? []) {
    const key = `${s.nurse_id}:${s.competency_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
  }

  // Per-nurse stats
  type NurseStat = {
    id: string; full_name: string;
    totalScored: number; passing: number; avgScore: number | null;
    activeCycle: string | null; hasCycle: boolean;
  };
  const nurseMap = new Map<string, NurseStat>(
    (nurses ?? []).map(n => [n.id, {
      id: n.id, full_name: n.full_name,
      totalScored: 0, passing: 0, avgScore: null,
      activeCycle: null, hasCycle: false,
    }])
  );

  for (const s of deduped) {
    const ns = nurseMap.get(s.nurse_id);
    if (!ns) continue;
    ns.totalScored++;
    if (s.is_passing) ns.passing++;
  }

  // Compute averages
  const scoresByNurse = new Map<string, number[]>();
  for (const s of deduped) {
    if (!scoresByNurse.has(s.nurse_id)) scoresByNurse.set(s.nurse_id, []);
    scoresByNurse.get(s.nurse_id)!.push(s.score);
  }
  for (const [nid, scores] of scoresByNurse) {
    const ns = nurseMap.get(nid);
    if (ns && scores.length) ns.avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10;
  }

  // Active cycles
  for (const c of cycles ?? []) {
    const ns = nurseMap.get(c.nurse_id);
    if (!ns) continue;
    ns.hasCycle = true;
    if (c.status === "active") ns.activeCycle = c.cycle_type;
  }

  const nurseStats = [...nurseMap.values()];

  // Framework summary
  type FwStat = { name: string; library: string; totalAssessments: number; passing: number; avgScore: number; nurses: Set<string> };
  const fwMap = new Map<string, FwStat>();
  for (const s of deduped) {
    const comp = s.framework_competencies as unknown as {
      name: string;
      framework_domains: { name: string; frameworks: { id: string; name: string; library: string } | null } | null
    } | null;
    const fw = comp?.framework_domains?.frameworks;
    if (!fw) continue;
    if (!fwMap.has(fw.id)) fwMap.set(fw.id, { name: fw.name, library: fw.library, totalAssessments: 0, passing: 0, avgScore: 0, nurses: new Set() });
    const fs = fwMap.get(fw.id)!;
    fs.totalAssessments++;
    if (s.is_passing) fs.passing++;
    fs.nurses.add(s.nurse_id);
  }
  // Compute avgScore per framework
  const scoresByFw = new Map<string, number[]>();
  for (const s of deduped) {
    const comp = s.framework_competencies as unknown as { framework_domains: { frameworks: { id: string } | null } | null } | null;
    const fwId = comp?.framework_domains?.frameworks?.id;
    if (!fwId) continue;
    if (!scoresByFw.has(fwId)) scoresByFw.set(fwId, []);
    scoresByFw.get(fwId)!.push(s.score);
  }
  for (const [fwId, scores] of scoresByFw) {
    const fs = fwMap.get(fwId);
    if (fs) fs.avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10;
  }

  // Score distribution (0–6)
  const dist = Array(7).fill(0) as number[];
  for (const s of deduped) dist[s.score]++;

  const totalAssessments = deduped.length;
  const totalPassing = deduped.filter(s => s.is_passing).length;
  const activeCycleCount = (cycles ?? []).filter(c => c.status === "active").length;
  const nursesWithCycle = new Set((cycles ?? []).map(c => c.nurse_id)).size;

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Workforce Analysis</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          {(nurses ?? []).length} nurses · {totalAssessments} competencies assessed · {activeCycleCount} active cycles
        </p>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Total Nurses",      value: (nurses ?? []).length, color: "text-blue-600" },
          { label: "In Active Cycle",   value: activeCycleCount, color: "text-teal-600" },
          { label: "Competencies Assessed", value: totalAssessments, color: "text-violet-600" },
          { label: "Pass Rate",         value: totalAssessments ? `${Math.round((totalPassing / totalAssessments) * 100)}%` : "—", color: "text-green-600" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl p-5 border border-gray-100">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Score distribution */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Score Distribution (0–6)</p>
          <div className="flex flex-col gap-2">
            {dist.map((count, score) => (
              <div key={score} className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                  style={{ backgroundColor: SCORE_COLORS[score] }}>{score}</div>
                <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{
                      width: totalAssessments ? `${(count / totalAssessments) * 100}%` : "0%",
                      backgroundColor: SCORE_COLORS[score]
                    }} />
                </div>
                <div className="w-20 text-right">
                  <span className="text-xs font-semibold text-gray-700">{count}</span>
                  <span className="text-[10px] text-gray-400 ml-1">{totalAssessments ? `(${Math.round((count / totalAssessments) * 100)}%)` : ""}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-gray-50">
            <div className="flex gap-4 text-[10px] text-gray-400">
              {SCORE_LABELS.slice(3).map((l, i) => (
                <span key={i} style={{ color: SCORE_COLORS[i + 3] }}>■ {l}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Framework pass rates */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Framework Performance</p>
          {fwMap.size > 0 ? (
            <div className="flex flex-col gap-3">
              {[...fwMap.entries()].map(([fwId, fw]) => {
                const passRate = fw.totalAssessments ? Math.round((fw.passing / fw.totalAssessments) * 100) : 0;
                return (
                  <div key={fwId}>
                    <div className="flex items-center justify-between mb-1">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{fw.name}</p>
                        <p className="text-[10px] text-gray-400 capitalize">{fw.library} · {fw.nurses.size} nurses · avg {fw.avgScore}</p>
                      </div>
                      <span className="text-sm font-bold text-gray-700">{passRate}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-teal-500 rounded-full" style={{ width: `${passRate}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-gray-400 text-sm text-center py-6">No framework data yet.</p>
          )}
        </div>
      </div>

      {/* Nurse roster with scores */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 bg-gray-50/50 border-b border-gray-100">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Nurse Readiness Roster</p>
        </div>
        {nurseStats.length > 0 ? (
          <div className="divide-y divide-gray-50">
            {nurseStats.map(ns => {
              const passRate = ns.totalScored ? Math.round((ns.passing / ns.totalScored) * 100) : null;
              const scoreIdx = ns.avgScore != null ? Math.round(ns.avgScore) : null;
              return (
                <div key={ns.id} className="px-5 py-3.5 flex items-center gap-4">
                  <div className="w-9 h-9 rounded-full bg-teal-50 flex items-center justify-center text-teal-700 font-bold text-sm shrink-0">
                    {ns.full_name?.[0] ?? "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-900">{ns.full_name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {ns.activeCycle ? (
                        <span className="text-[10px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded capitalize font-semibold">{ns.activeCycle}</span>
                      ) : ns.hasCycle ? (
                        <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">no active cycle</span>
                      ) : (
                        <span className="text-[10px] bg-orange-50 text-orange-500 px-1.5 py-0.5 rounded">no cycle assigned</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <p className="text-xs font-bold text-gray-700">{ns.totalScored}</p>
                      <p className="text-[10px] text-gray-400">assessed</p>
                    </div>
                    {passRate != null && (
                      <div>
                        <p className="text-xs font-bold text-gray-700">{passRate}%</p>
                        <p className="text-[10px] text-gray-400">passing</p>
                      </div>
                    )}
                    {scoreIdx != null && ns.avgScore != null ? (
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold"
                        style={{ backgroundColor: SCORE_COLORS[scoreIdx] ?? "#9ca3af" }}>
                        {ns.avgScore}
                      </div>
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-300 text-xs">—</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-8 text-center text-gray-400">
            <p className="text-2xl mb-2">👩‍⚕️</p>
            <p className="text-sm">No nurses in this hospital yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
