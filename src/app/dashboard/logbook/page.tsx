import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

// Clinical Skills Logbook — every skill-level score the nurse has received,
// grouped by competency, with Benner levels and assessor verification.

const SCORE_COLORS = ["#ef4444", "#f97316", "#eab308", "#14b8a6", "#0d9488", "#3b82f6", "#8b5cf6"];
const LEVEL_HINT = [
  "Requires training", "Constant supervision", "Some supervision",
  "Independent", "Independent+", "Adapts to complex cases", "Can lead others",
];

export default async function SkillsLogbookPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: cycles } = await admin.from("competency_cycles").select("id").eq("nurse_id", user.id);
  const cycleIds = (cycles ?? []).map(c => c.id);

  const { data: skillScores } = cycleIds.length
    ? await admin.from("skill_scores")
        .select("skill_id, competency_id, score, notes, assessed_at, competency_skills(name), framework_competencies!competency_id(name), profiles!assessor_id(full_name)")
        .in("cycle_id", cycleIds)
        .order("assessed_at", { ascending: false })
    : { data: [] };

  // Latest score per skill
  const seen = new Set<string>();
  type Row = { skill: string; competency: string; score: number; assessor: string; date: string | null; notes: string | null };
  const rows: Row[] = [];
  for (const s of skillScores ?? []) {
    if (seen.has(s.skill_id)) continue;
    seen.add(s.skill_id);
    rows.push({
      skill: (s.competency_skills as unknown as { name: string } | null)?.name ?? "—",
      competency: (s.framework_competencies as unknown as { name: string } | null)?.name ?? "—",
      score: s.score,
      assessor: (s.profiles as unknown as { full_name: string } | null)?.full_name ?? "—",
      date: s.assessed_at,
      notes: s.notes,
    });
  }

  const byCompetency = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byCompetency.has(r.competency)) byCompetency.set(r.competency, []);
    byCompetency.get(r.competency)!.push(r);
  }
  const independent = rows.filter(r => r.score >= 3).length;
  const supervised = rows.filter(r => r.score > 0 && r.score < 3).length;

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Clinical Skills Logbook</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Your verified record of clinical skills — from supervised practice to independent performance.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Skills logged", value: rows.length, color: "text-blue-600" },
          { label: "Independent (≥3)", value: independent, color: "text-green-600" },
          { label: "Under supervision", value: supervised, color: "text-amber-600" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-xs text-gray-400 font-medium mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-4xl mb-3">📖</p>
          <p className="font-semibold text-gray-700">No skills logged yet</p>
          <p className="text-gray-400 text-sm mt-2">
            Your logbook fills as assessors score individual skills during your competency cycles.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {[...byCompetency.entries()].map(([competency, skills]) => (
            <div key={competency} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 bg-gray-50/50 border-b border-gray-100">
                <p className="text-sm font-bold text-gray-800">{competency}</p>
              </div>
              <div className="divide-y divide-gray-50">
                {skills.map((s, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ backgroundColor: SCORE_COLORS[s.score] ?? "#9ca3af" }}>{s.score}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800">{s.skill}</p>
                      <p className="text-[10px] text-gray-400">
                        {LEVEL_HINT[s.score]} · verified by {s.assessor}
                        {s.date ? ` · ${new Date(s.date).toLocaleDateString()}` : ""}
                      </p>
                      {s.notes && <p className="text-[11px] text-gray-500 italic mt-0.5">&ldquo;{s.notes}&rdquo;</p>}
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 ${
                      s.score >= 3 ? "bg-green-50 text-green-600" : "bg-amber-50 text-amber-700"}`}>
                      {s.score >= 3 ? "Independent" : "Supervised"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-6">
        Skill evidence supports your competency decisions on the <Link href="/dashboard/passport" className="text-teal-600 hover:underline">Passport</Link>.
      </p>
    </div>
  );
}
