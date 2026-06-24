import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function SuperAdminDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    { count: totalHospitals },
    { count: totalNurses },
    { count: totalAssessors },
    { count: totalEducators },
    { count: totalHospitalAdmins },
    { count: totalCourses },
    { count: totalCompetencies },
    { data: hospitals },
  ] = await Promise.all([
    supabase.from("hospitals").select("*", { count: "exact", head: true }),
    supabase.from("profiles").select("*", { count: "exact", head: true }).eq("role", "nurse"),
    supabase.from("profiles").select("*", { count: "exact", head: true }).eq("role", "assessor"),
    supabase.from("profiles").select("*", { count: "exact", head: true }).eq("role", "educator"),
    supabase.from("profiles").select("*", { count: "exact", head: true }).eq("role", "hospital_admin"),
    supabase.from("courses").select("*", { count: "exact", head: true }),
    supabase.from("competencies").select("*", { count: "exact", head: true }),
    supabase.from("hospitals").select("id, name, city, country, tier, created_at").order("created_at", { ascending: false }).limit(5),
  ]);

  const tierBadge: Record<string, string> = {
    free:         "bg-gray-100 text-gray-600",
    professional: "bg-blue-100 text-blue-700",
    enterprise:   "bg-purple-100 text-purple-700",
  };

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Platform Overview</h1>
        <p className="text-gray-400 text-sm mt-0.5">Competen Healthcare — all hospitals and users.</p>
      </div>

      {/* User stats */}
      <div className="mb-2">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Platform Users</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
        {[
          { label: "Nurses",         value: totalNurses ?? 0,        icon: "👩‍⚕️", color: "text-teal-600"   },
          { label: "Assessors",      value: totalAssessors ?? 0,     icon: "📋",  color: "text-indigo-600" },
          { label: "Educators",      value: totalEducators ?? 0,     icon: "📚",  color: "text-purple-600" },
          { label: "Hosp. Admins",   value: totalHospitalAdmins ?? 0,icon: "🏛️",  color: "text-amber-600"  },
          { label: "Hospitals",      value: totalHospitals ?? 0,     icon: "🏥",  color: "text-rose-600"   },
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

      {/* Content stats */}
      <div className="mb-2">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Content</p>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-8">
        {[
          { label: "Courses in Library",     value: totalCourses ?? 0,      icon: "📚", color: "text-purple-600" },
          { label: "Global Competencies",    value: totalCompetencies ?? 0, icon: "🪪", color: "text-teal-600" },
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

      {/* Recent hospitals */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-700">Recently Joined Hospitals</h2>
          <Link href="/super-admin/hospitals" className="text-xs text-rose-600 hover:underline">View all →</Link>
        </div>
        {!hospitals?.length ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
            No hospitals registered yet. Note: super admin needs RLS access to view all hospitals.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {hospitals.map((h, i) => (
              <div key={h.id} className={`flex items-center gap-3 px-5 py-3.5 ${i > 0 ? "border-t border-gray-50" : ""}`}>
                <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center text-rose-600 text-base shrink-0">🏥</div>
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
      </div>
    </>
  );
}
