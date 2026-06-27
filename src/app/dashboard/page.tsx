import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

const SCORE_COLORS = ["#ef4444","#f97316","#eab308","#14b8a6","#0d9488","#3b82f6","#8b5cf6"];

const CYCLE_COLORS: Record<string, string> = {
  orientation: "bg-blue-100 text-blue-700",
  probation:   "bg-amber-100 text-amber-700",
  annual:      "bg-teal-100 text-teal-700",
  remediation: "bg-red-100 text-red-600",
  specialty:   "bg-violet-100 text-violet-700",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!profile) redirect("/login");

  if (profile.role === "super_admin") redirect("/super-admin");
  if (profile.role === "hospital_admin") redirect("/admin/dashboard");
  if (profile.role === "assessor") redirect("/assessor");
  if (profile.role === "educator") redirect("/educator");

  const admin = createAdminClient();
  const firstName = profile.full_name?.split(" ")[0] ?? "Nurse";

  const { data: cycles } = await admin
    .from("competency_cycles")
    .select(`
      id, cycle_type, status, start_date, end_date,
      cycle_frameworks(
        id, status, framework_score,
        frameworks(id, name, library)
      )
    `)
    .eq("nurse_id", user.id)
    .order("start_date", { ascending: false })
    .limit(5);

  const activeCycle = (cycles ?? []).find(c => c.status === "active") ?? null;

  const [domainResult, compResult] = await Promise.all([
    activeCycle ? admin
      .from("domain_scores")
      .select("domain_id, score, label, assessed_at, framework_domains(name, frameworks(name))")
      .eq("cycle_id", activeCycle.id)
      .order("score", { ascending: false }) : Promise.resolve({ data: null }),
    activeCycle ? admin
      .from("competency_scores")
      .select("competency_id, score, label, is_passing, assessed_at, framework_competencies(name, framework_domains(name))")
      .eq("cycle_id", activeCycle.id)
      .order("score", { ascending: false }) : Promise.resolve({ data: null }),
  ]);

  const domainScores = domainResult.data;
  const compScores = compResult.data;

  const totalCompetencies = compScores?.length ?? 0;
  const passingCount = compScores?.filter(cs => cs.is_passing).length ?? 0;
  const avgScore = totalCompetencies
    ? Math.round((compScores?.reduce((s, cs) => s + cs.score, 0) ?? 0) / totalCompetencies * 10) / 10
    : null;

  return (
    <>
      <div className="mb-8">
        <h1 className="text-xl font-bold text-gray-900">Good morning, {firstName}</h1>
        <p className="text-gray-500 text-sm mt-0.5">Your clinical competency overview</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Active Cycle",        value: activeCycle ? activeCycle.cycle_type : "None", sub: activeCycle ? "in progress" : "no active cycle", color: "text-teal-600" },
          { label: "Competencies Scored", value: totalCompetencies,  sub: "this cycle",         color: "text-blue-600" },
          { label: "Passing",             value: passingCount,        sub: `of ${totalCompetencies} scored`, color: "text-green-600" },
          { label: "Avg Score",           value: avgScore ?? "—",     sub: "Benner 0–6",         color: "text-violet-600" },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="bg-white rounded-xl p-5 border border-gray-100">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">{label}</p>
            <p className={`text-2xl font-bold capitalize ${color}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 text-sm">Current Cycle</h2>
            <Link href="/dashboard/passport" className="text-xs text-teal-600 hover:underline">Passport →</Link>
          </div>
          {activeCycle ? (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className={`text-[10px] font-bold px-2.5 py-1 rounded capitalize ${CYCLE_COLORS[activeCycle.cycle_type] ?? "bg-gray-100 text-gray-500"}`}>
                  {activeCycle.cycle_type}
                </span>
                {activeCycle.end_date && (
                  <span className="text-[10px] text-gray-400">
                    Due {new Date(activeCycle.end_date).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-3">
                {((activeCycle.cycle_frameworks ?? []) as unknown as { id: string; status: string; framework_score?: number; frameworks: { name: string; library: string } | null }[]).map(cf => (
                  <div key={cf.id} className="flex items-center gap-3">
                    <div className="flex-1">
                      <p className="text-sm text-gray-800 font-medium">{cf.frameworks?.name}</p>
                      <p className="text-[10px] text-gray-400 capitalize mt-0.5">{cf.frameworks?.library} · {cf.status}</p>
                    </div>
                    {cf.framework_score != null ? (
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold"
                        style={{ backgroundColor: SCORE_COLORS[Math.round(cf.framework_score)] ?? "#9ca3af" }}>
                        {cf.framework_score.toFixed(1)}
                      </div>
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-xs">—</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <p className="text-2xl mb-2">🔄</p>
              <p className="text-sm">No active cycle.</p>
              <p className="text-xs mt-1">Your hospital admin will assign you a competency cycle.</p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 text-sm">Domain Scores</h2>
          </div>
          {(domainScores ?? []).length > 0 ? (
            <div className="flex flex-col gap-3">
              {(domainScores ?? []).slice(0, 6).map(ds => {
                const domain = ds.framework_domains as unknown as { name: string; frameworks: { name: string } | null } | null;
                const score = Math.round(ds.score);
                return (
                  <div key={ds.domain_id} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 font-medium truncate">{domain?.name}</p>
                      <p className="text-[10px] text-gray-400 truncate">{domain?.frameworks?.name}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{
                          width: `${(ds.score / 6) * 100}%`,
                          backgroundColor: SCORE_COLORS[score] ?? "#9ca3af"
                        }} />
                      </div>
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ backgroundColor: SCORE_COLORS[score] ?? "#9ca3af" }}>
                        {ds.score.toFixed(1)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <p className="text-2xl mb-2">📊</p>
              <p className="text-sm">No scores yet.</p>
              <p className="text-xs mt-1">Scores appear after assessors submit evaluations.</p>
            </div>
          )}
        </div>
      </div>

      {(compScores ?? []).length > 0 && (
        <div className="mt-6 bg-white rounded-xl border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 text-sm">Competency Scores</h2>
            <Link href="/dashboard/passport" className="text-xs text-teal-600 hover:underline">View all</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {(compScores ?? []).slice(0, 8).map(cs => {
              const comp = cs.framework_competencies as unknown as { name: string; framework_domains: { name: string } | null } | null;
              return (
                <div key={cs.competency_id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{ backgroundColor: SCORE_COLORS[cs.score] ?? "#9ca3af" }}>{cs.score}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{comp?.name}</p>
                    <p className="text-[10px] text-gray-400">{comp?.framework_domains?.name}</p>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${cs.is_passing ? "text-green-600 bg-green-50" : "text-red-500 bg-red-50"}`}>
                    {cs.is_passing ? "Pass" : "Fail"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "My Passport",   href: "/dashboard/passport", icon: "🪪", color: "bg-teal-50 text-teal-700" },
          { label: "CPD Log",       href: "/dashboard/cpd",       icon: "⏱️", color: "bg-blue-50 text-blue-700" },
          { label: "AI Copilot",    href: "/dashboard/copilot",   icon: "🤖", color: "bg-purple-50 text-purple-700" },
          { label: "Knowledge Hub", href: "/dashboard/knowledge", icon: "🔬", color: "bg-amber-50 text-amber-700" },
        ].map(({ label, href, icon, color }) => (
          <Link key={label} href={href}
            className={`flex items-center gap-3 rounded-xl px-4 py-4 text-sm font-medium hover:opacity-80 transition-opacity ${color}`}>
            <span className="text-xl">{icon}</span>
            {label}
          </Link>
        ))}
      </div>
    </>
  );
}
