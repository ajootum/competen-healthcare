import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { ROLE_CONFIG, highestRole, type AppRole } from "@/lib/roles";

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

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("*").eq("id", user.id).single();
  if (!profile) redirect("/login");

  const userRoles: AppRole[] = (profile.roles?.length ? profile.roles : [profile.role]).filter(Boolean) as AppRole[];
  const cookieStore = await cookies();
  const activeRole = (cookieStore.get("active_role")?.value ?? highestRole(userRoles)) as AppRole;

  if (activeRole !== "nurse") redirect(ROLE_CONFIG[activeRole].portal);
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

  const activeCycle = (cycles ?? []).find(c => c.status === "active") ?? (cycles ?? [])[0] ?? null;

  // The five questions the dashboard must answer (Frontend User Structures spec)
  const [{ data: decisions }, { data: pathwayItems }, { data: pendingAssessments }] = await Promise.all([
    admin.from("competency_decisions")
      .select("competency_id, outcome, expiry_date, created_at")
      .eq("nurse_id", user.id).order("created_at", { ascending: false }),
    admin.from("pathway_items")
      .select("id, learning_pathways!inner(nurse_id, status)")
      .eq("learning_pathways.nurse_id", user.id).eq("learning_pathways.status", "active"),
    (cycles ?? []).length
      ? admin.from("assessments").select("id, status").in("cycle_id", (cycles ?? []).map(c => c.id)).in("status", ["pending", "in_progress"])
      : Promise.resolve({ data: [] }),
  ]);
  const dseen = new Set<string>();
  let competentNow = 0, gaps = 0, dueSoon = 0;
  for (const d of decisions ?? []) {
    if (dseen.has(d.competency_id)) continue;
    dseen.add(d.competency_id);
    const expired = d.expiry_date && new Date(d.expiry_date).getTime() < Date.now();
    const passing = ["competent", "provisionally_competent", "competent_with_conditions"].includes(d.outcome);
    if (passing && !expired) {
      competentNow++;
      if (d.expiry_date && (new Date(d.expiry_date).getTime() - Date.now()) / 86400000 <= 60) dueSoon++;
    } else gaps++;
  }

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
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Good morning, {firstName}</h1>
          <p className="text-gray-500 text-sm mt-0.5">Your professional growth dashboard</p>
        </div>
        {(pathwayItems ?? []).length > 0 && (
          <Link href="/dashboard/learning"
            className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors shrink-0">
            ▶ Continue where you left off
          </Link>
        )}
      </div>

      {/* The five questions, answered at a glance */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
        {[
          { label: "Competent in", value: competentNow, sub: "competencies current", color: "text-green-600", href: "/dashboard/passport" },
          { label: "Still to learn", value: gaps, sub: gaps ? "open gaps" : "no open gaps", color: gaps ? "text-amber-600" : "text-gray-400", href: "/dashboard/learning" },
          { label: "Pending assessments", value: (pendingAssessments ?? []).length, sub: "awaiting assessor", color: "text-blue-600", href: "/dashboard/assessments" },
          { label: "Due for renewal", value: dueSoon, sub: "within 60 days", color: dueSoon ? "text-red-500" : "text-gray-400", href: "/dashboard/certificates" },
          { label: "This cycle avg", value: avgScore ?? "—", sub: "Benner 0–6", color: "text-violet-600", href: "/dashboard/logbook" },
        ].map(({ label, value, sub, color, href }) => (
          <Link key={label} href={href} className="bg-white rounded-xl p-4 border border-gray-100 hover:border-teal-200 transition-colors">
            <p className="text-xs text-gray-400 font-medium mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>
          </Link>
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
          { label: "My CPUs",          href: "/dashboard/cpu",          icon: "🏥", color: "bg-teal-50 text-teal-700" },
          { label: "Skills Logbook",   href: "/dashboard/logbook",      icon: "📖", color: "bg-blue-50 text-blue-700" },
          { label: "Career Growth",    href: "/dashboard/career",       icon: "📈", color: "bg-purple-50 text-purple-700" },
          { label: "Clinical Library", href: "/dashboard/library",      icon: "🔎", color: "bg-amber-50 text-amber-700" },
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
