import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

const SCORE_COLORS = ["#ef4444","#f97316","#eab308","#14b8a6","#0d9488","#3b82f6","#8b5cf6"];

export default async function SuperAdminDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "super_admin") redirect("/dashboard");

  const [
    { count: totalHospitals },
    { count: totalNurses },
    { count: totalAssessors },
    { count: totalEducators },
    { count: totalHospitalAdmins },
    { data: frameworks },
    { data: recentHospitals },
    { count: activeCycles },
    { count: totalAssessments },
    { data: orgs },
  ] = await Promise.all([
    admin.from("hospitals").select("*", { count: "exact", head: true }),
    admin.from("profiles").select("*", { count: "exact", head: true }).eq("role", "nurse"),
    admin.from("profiles").select("*", { count: "exact", head: true }).eq("role", "assessor"),
    admin.from("profiles").select("*", { count: "exact", head: true }).eq("role", "educator"),
    admin.from("profiles").select("*", { count: "exact", head: true }).eq("role", "hospital_admin"),
    admin.from("frameworks").select("id, name, library, is_active"),
    admin.from("hospitals").select("id, name, city, country, country_code, tier, created_at").order("created_at", { ascending: false }).limit(6),
    admin.from("competency_cycles").select("*", { count: "exact", head: true }).eq("status", "active"),
    admin.from("assessments").select("*", { count: "exact", head: true }).eq("status", "complete"),
    admin.from("organisations").select("id, name, hq_country"),
  ]);

  // Global pass rate
  const { data: passStats } = await admin
    .from("competency_scores")
    .select("is_passing");

  const totalScored = passStats?.length ?? 0;
  const totalPassing = passStats?.filter(s => s.is_passing).length ?? 0;
  const globalPassRate = totalScored ? Math.round((totalPassing / totalScored) * 100) : null;

  // Score distribution
  const { data: scoreRows } = await admin.from("competency_scores").select("score");
  const dist = Array(7).fill(0) as number[];
  for (const r of scoreRows ?? []) dist[r.score]++;

  const coreCount = (frameworks ?? []).filter(f => f.library === "core").length;
  const specialtyCount = (frameworks ?? []).filter(f => f.library === "specialty").length;
  const roleCount = (frameworks ?? []).filter(f => f.library === "role").length;
  const activeFrameworks = (frameworks ?? []).filter(f => f.is_active).length;

  const tierBadge: Record<string, string> = {
    free:         "bg-gray-100 text-gray-600",
    professional: "bg-blue-100 text-blue-700",
    enterprise:   "bg-purple-100 text-purple-700",
  };

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Platform Overview</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          {(orgs ?? []).length} organisation{(orgs ?? []).length !== 1 ? "s" : ""} · {totalHospitals ?? 0} facilities worldwide
        </p>
      </div>

      {/* People */}
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Platform Users</p>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
        {[
          { label: "Nurses",       value: totalNurses ?? 0,        icon: "👩‍⚕️", color: "text-teal-600" },
          { label: "Assessors",    value: totalAssessors ?? 0,     icon: "📋",  color: "text-indigo-600" },
          { label: "Educators",    value: totalEducators ?? 0,     icon: "📚",  color: "text-purple-600" },
          { label: "Hosp. Admins", value: totalHospitalAdmins ?? 0,icon: "🏛️",  color: "text-amber-600" },
          { label: "Hospitals",    value: totalHospitals ?? 0,     icon: "🏥",  color: "text-rose-600" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl p-4 border border-gray-100">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">{s.label}</p>
              <span className="text-base">{s.icon}</span>
            </div>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Assessment engine stats */}
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Assessment Engine</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {[
          { label: "Active Cycles",       value: activeCycles ?? 0,    color: "text-green-600" },
          { label: "Assessments Done",    value: totalAssessments ?? 0, color: "text-blue-600" },
          { label: "Competencies Scored", value: totalScored,           color: "text-violet-600" },
          { label: "Global Pass Rate",    value: globalPassRate != null ? `${globalPassRate}%` : "—", color: "text-teal-600" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl p-4 border border-gray-100">
            <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Frameworks */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Competency Frameworks</p>
            <Link href="/super-admin/content" className="text-xs text-teal-600 hover:underline">Configure →</Link>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            {[
              { label: "Core", value: coreCount, color: "text-teal-600" },
              { label: "Specialty", value: specialtyCount, color: "text-indigo-600" },
              { label: "Role", value: roleCount, color: "text-violet-600" },
            ].map(s => (
              <div key={s.label} className="text-center p-3 bg-gray-50 rounded-lg">
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] text-gray-400">{s.label}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 text-center">{activeFrameworks} active · {(frameworks ?? []).length} total</p>
        </div>

        {/* Score distribution */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Global Score Distribution</p>
          {totalScored > 0 ? (
            <div className="flex flex-col gap-1.5">
              {dist.map((count, score) => (
                <div key={score} className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0"
                    style={{ backgroundColor: SCORE_COLORS[score] }}>{score}</div>
                  <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full"
                      style={{ width: `${(count / totalScored) * 100}%`, backgroundColor: SCORE_COLORS[score] }} />
                  </div>
                  <span className="text-[10px] text-gray-500 w-8 text-right">{count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-gray-400 text-sm py-6">No scores recorded yet.</p>
          )}
        </div>
      </div>

      {/* Recent hospitals */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-gray-700">Recent Facilities</h2>
        <Link href="/super-admin/hospitals" className="text-xs text-rose-600 hover:underline">View all →</Link>
      </div>
      {!(recentHospitals ?? []).length ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
          <p className="text-2xl mb-2">🏥</p>
          <p>No hospitals registered yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {(recentHospitals ?? []).map((h, i) => (
            <div key={h.id} className={`flex items-center gap-3 px-5 py-3.5 ${i > 0 ? "border-t border-gray-50" : ""}`}>
              <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center text-base shrink-0">
                {h.country_code ? String.fromCodePoint(...[...h.country_code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : "🏥"}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{h.name}</p>
                <p className="text-[10px] text-gray-400">{h.city ? `${h.city}, ` : ""}{h.country}</p>
              </div>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded capitalize ${tierBadge[h.tier] ?? "bg-gray-100 text-gray-600"}`}>
                {h.tier}
              </span>
              <span className="text-xs text-gray-400">{new Date(h.created_at).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}

      {/* Quick admin links */}
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Content Builder", href: "/super-admin/content",            icon: "🧩", color: "bg-teal-50 text-teal-700" },
          { label: "Scoring Rules",   href: "/super-admin/scoring",            icon: "📊", color: "bg-violet-50 text-violet-700" },
          { label: "Organisations",   href: "/super-admin/organisations",      icon: "🌍", color: "bg-blue-50 text-blue-700" },
          { label: "All Users",       href: "/super-admin/users",              icon: "👥", color: "bg-amber-50 text-amber-700" },
        ].map(({ label, href, icon, color }) => (
          <Link key={label} href={href}
            className={`flex items-center gap-2.5 rounded-xl px-4 py-3.5 text-sm font-medium hover:opacity-80 transition-opacity ${color}`}>
            <span className="text-lg">{icon}</span>
            {label}
          </Link>
        ))}
      </div>
    </>
  );
}
