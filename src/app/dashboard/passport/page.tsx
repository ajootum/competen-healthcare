import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

const SCORE_COLORS = ["#ef4444","#f97316","#eab308","#14b8a6","#0d9488","#3b82f6","#8b5cf6"];
const SCORE_LABELS = ["Training Required","Novice","Advanced Beginner","Competent","Competent+","Proficient","Expert"];

export default async function PassportPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("full_name, role, hospital_id").eq("id", user.id).single();
  if (!profile) redirect("/login");

  const admin = createAdminClient();

  const { data: cycles } = await admin
    .from("competency_cycles")
    .select("id, cycle_type, status, start_date, end_date")
    .eq("nurse_id", user.id)
    .order("start_date", { ascending: false });

  const { data: allCompScores } = await admin
    .from("competency_scores")
    .select(`
      competency_id, cycle_id, score, label, is_passing, assessed_at, educator_validated,
      framework_competencies(
        id, name,
        framework_domains(
          id, name,
          frameworks(id, name, library)
        )
      )
    `)
    .eq("nurse_id", user.id)
    .order("assessed_at", { ascending: false });

  type CompEntry = {
    competency_id: string; score: number; label: string; is_passing: boolean;
    assessed_at: string; educator_validated: boolean; name: string;
    domain_name: string; framework_name: string; framework_id: string; library: string;
  };

  const seen = new Set<string>();
  const best: CompEntry[] = [];
  for (const cs of allCompScores ?? []) {
    if (seen.has(cs.competency_id)) continue;
    seen.add(cs.competency_id);
    const comp = cs.framework_competencies as unknown as {
      id: string; name: string;
      framework_domains: { id: string; name: string; frameworks: { id: string; name: string; library: string } | null } | null
    } | null;
    if (!comp) continue;
    best.push({
      competency_id: cs.competency_id,
      score: cs.score,
      label: cs.label ?? SCORE_LABELS[cs.score] ?? "—",
      is_passing: cs.is_passing ?? false,
      assessed_at: cs.assessed_at,
      educator_validated: cs.educator_validated ?? false,
      name: comp.name,
      domain_name: comp.framework_domains?.name ?? "—",
      framework_name: comp.framework_domains?.frameworks?.name ?? "—",
      framework_id: comp.framework_domains?.frameworks?.id ?? "",
      library: comp.framework_domains?.frameworks?.library ?? "",
    });
  }

  const byFramework = new Map<string, { name: string; library: string; competencies: CompEntry[] }>();
  for (const entry of best) {
    if (!byFramework.has(entry.framework_id)) {
      byFramework.set(entry.framework_id, { name: entry.framework_name, library: entry.library, competencies: [] });
    }
    byFramework.get(entry.framework_id)!.competencies.push(entry);
  }

  const totalScored = best.length;
  const totalPassing = best.filter(b => b.is_passing).length;
  const validated = best.filter(b => b.educator_validated).length;
  const avgScore = totalScored ? Math.round(best.reduce((s, b) => s + b.score, 0) / totalScored * 10) / 10 : null;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href="/dashboard" className="hover:text-gray-600">Dashboard</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Competency Passport</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Competency Passport</h1>
          <p className="text-gray-400 text-sm mt-0.5">{profile.full_name} · {cycles?.length ?? 0} cycle{(cycles?.length ?? 0) !== 1 ? "s" : ""}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Assessed",        value: totalScored,   color: "text-blue-600" },
          { label: "Passing",         value: totalPassing,  color: "text-green-600" },
          { label: "Validated",       value: validated,     color: "text-teal-600" },
          { label: "Average Score",   value: avgScore ?? "—", color: "text-violet-600" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-xs text-gray-400 font-medium mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {byFramework.size > 0 ? (
        <div className="flex flex-col gap-6">
          {[...byFramework.entries()].map(([fwId, fw]) => {
            const byDomain = new Map<string, CompEntry[]>();
            for (const c of fw.competencies) {
              if (!byDomain.has(c.domain_name)) byDomain.set(c.domain_name, []);
              byDomain.get(c.domain_name)!.push(c);
            }
            const fwAvg = fw.competencies.reduce((s, c) => s + c.score, 0) / fw.competencies.length;
            const fwPassing = fw.competencies.filter(c => c.is_passing).length;
            return (
              <div key={fwId} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-5 py-4 bg-gray-50/50 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-gray-900">{fw.name}</p>
                    <p className="text-[10px] text-gray-400 capitalize mt-0.5">{fw.library} library</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-[10px] text-gray-400">Pass rate</p>
                      <p className="text-sm font-bold text-gray-900">{fwPassing}/{fw.competencies.length}</p>
                    </div>
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                      style={{ backgroundColor: SCORE_COLORS[Math.round(fwAvg)] ?? "#9ca3af" }}>
                      {fwAvg.toFixed(1)}
                    </div>
                  </div>
                </div>
                <div className="divide-y divide-gray-50">
                  {[...byDomain.entries()].map(([domainName, comps]) => (
                    <div key={domainName} className="px-5 py-4">
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">{domainName}</p>
                      <div className="flex flex-col gap-2">
                        {comps.map(c => (
                          <div key={c.competency_id} className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                              style={{ backgroundColor: SCORE_COLORS[c.score] ?? "#9ca3af" }}>{c.score}</div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-gray-800">{c.name}</p>
                              <p className="text-[10px] text-gray-400">{c.label} · {new Date(c.assessed_at).toLocaleDateString()}</p>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {c.is_passing && <span className="text-[10px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded font-semibold">✓ Pass</span>}
                              {c.educator_validated && <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-semibold">Validated</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-4xl mb-3">🪪</p>
          <p className="font-semibold text-gray-700">No scores yet</p>
          <p className="text-gray-400 text-sm mt-2">Your passport populates as assessors score you during your active cycle.</p>
        </div>
      )}

      {(cycles ?? []).length > 0 && (
        <div className="mt-6 bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Cycle History</p>
          <div className="flex flex-col gap-2">
            {cycles!.map(c => (
              <div key={c.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-gray-600 capitalize font-medium">{c.cycle_type}</span>
                  <span className="text-gray-300">·</span>
                  <span className="text-gray-400 text-xs">{new Date(c.start_date).toLocaleDateString()}</span>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded capitalize ${
                  c.status === "active" ? "bg-green-50 text-green-600" :
                  c.status === "complete" ? "bg-teal-50 text-teal-600" :
                  "bg-gray-100 text-gray-500"
                }`}>{c.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
