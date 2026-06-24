import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

const statusColors: Record<string, string> = {
  competent:   "bg-green-100 text-green-700",
  in_progress: "bg-blue-100 text-blue-700",
  pending:     "bg-gray-100 text-gray-500",
  expired:     "bg-red-100 text-red-600",
  required:    "bg-orange-100 text-orange-600",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    { data: profile },
    { data: enrollments },
    { data: competencies },
    { data: cpdLogs },
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase.from("course_enrollments").select("*, courses(title, category, duration_hours, cpd_points)").eq("user_id", user.id).order("enrolled_at", { ascending: false }).limit(5),
    supabase.from("nurse_competencies").select("*, competencies(name, category)").eq("user_id", user.id).order("created_at", { ascending: false }).limit(6),
    supabase.from("cpd_logs").select("hours").eq("user_id", user.id),
  ]);

  const totalCpdHours = cpdLogs?.reduce((sum, l) => sum + Number(l.hours), 0) ?? 0;
  const firstName = profile?.full_name?.split(" ")[0] ?? "Nurse";

  return (
    <>
      <div className="mb-8">
        <h1 className="text-xl font-bold text-gray-900">Good morning, {firstName} 👋</h1>
        <p className="text-gray-500 text-sm mt-0.5">Here&apos;s your clinical competency overview.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: "CPD Hours",        value: totalCpdHours.toFixed(1),                                           sub: "this year",   color: "text-teal-600" },
          { label: "Courses Enrolled", value: enrollments?.length ?? 0,                                           sub: "active",      color: "text-blue-600" },
          { label: "Competencies",     value: competencies?.filter(c => c.status === "competent").length ?? 0,    sub: "achieved",    color: "text-green-600" },
          { label: "Expiring Soon",    value: competencies?.filter(c => c.status === "expired").length ?? 0,      sub: "need renewal", color: "text-orange-500" },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="bg-white rounded-xl p-5 border border-gray-100">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 text-sm">Competency Passport</h2>
            <Link href="/dashboard/passport" className="text-xs text-teal-600 hover:underline">View all</Link>
          </div>
          {competencies && competencies.length > 0 ? (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-50">
                  <th className="text-left pb-2 font-medium">COMPETENCY</th>
                  <th className="text-left pb-2 font-medium">EXPIRY</th>
                  <th className="text-left pb-2 font-medium">STATUS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {competencies.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2.5 text-gray-700">{c.competencies?.name}</td>
                    <td className="py-2.5 text-gray-400">{c.expiry_date ?? "—"}</td>
                    <td className="py-2.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium capitalize ${statusColors[c.status] ?? "bg-gray-100 text-gray-500"}`}>
                        {c.status.replace("_", " ")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <p className="text-2xl mb-2">🪪</p>
              <p className="text-sm">No competencies yet.</p>
              <Link href="/dashboard/passport" className="text-xs text-teal-600 hover:underline mt-1 inline-block">View passport</Link>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 text-sm">My Courses</h2>
            <Link href="/dashboard/courses" className="text-xs text-teal-600 hover:underline">Browse all</Link>
          </div>
          {enrollments && enrollments.length > 0 ? (
            <div className="flex flex-col gap-3">
              {enrollments.map((e) => (
                <div key={e.id} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center text-teal-600 text-sm shrink-0">📚</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 font-medium truncate">{e.courses?.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-teal-500 rounded-full" style={{ width: `${e.progress}%` }} />
                      </div>
                      <span className="text-[10px] text-gray-400 shrink-0">{e.progress}%</span>
                    </div>
                  </div>
                  {e.completed_at && <span className="text-[10px] bg-green-50 text-green-600 px-2 py-0.5 rounded font-medium shrink-0">Done</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <p className="text-2xl mb-2">📚</p>
              <p className="text-sm">No courses enrolled yet.</p>
              <Link href="/dashboard/courses" className="text-xs text-teal-600 hover:underline mt-1 inline-block">Browse the CPD Academy</Link>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Take a Quiz",    href: "/dashboard/questions",  icon: "❓", color: "bg-orange-50 text-orange-600" },
          { label: "Log CPD Hours",  href: "/dashboard/cpd",        icon: "⏱️", color: "bg-blue-50 text-blue-600" },
          { label: "Ask AI Copilot", href: "/dashboard/copilot",    icon: "🤖", color: "bg-purple-50 text-purple-600" },
          { label: "Knowledge Hub",  href: "/dashboard/knowledge",  icon: "🔬", color: "bg-teal-50 text-teal-600" },
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
