import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function EducatorDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, hospital_id")
    .eq("id", user.id)
    .single();

  const [{ data: courses }, { data: questions }, { data: enrollments }] = await Promise.all([
    supabase.from("courses").select("id, title, level, is_published, created_at").order("created_at", { ascending: false }).limit(5),
    supabase.from("questions").select("id, topic").limit(1),
    supabase.from("course_enrollments").select("id, completed_at").limit(1),
  ]);

  const [{ count: totalCourses }, { count: totalQuestions }, { count: totalEnrollments }, { count: completions }] = await Promise.all([
    supabase.from("courses").select("*", { count: "exact", head: true }),
    supabase.from("questions").select("*", { count: "exact", head: true }),
    supabase.from("course_enrollments").select("*", { count: "exact", head: true }),
    supabase.from("course_enrollments").select("*", { count: "exact", head: true }).not("completed_at", "is", null),
  ]);

  const levelColors: Record<string, string> = {
    beginner:     "bg-green-100 text-green-700",
    intermediate: "bg-amber-100 text-amber-700",
    advanced:     "bg-red-100 text-red-700",
  };

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Educator Dashboard</h1>
        <p className="text-gray-400 text-sm mt-0.5">Welcome back, {profile?.full_name?.split(" ")[0]}. Manage your content.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {[
          { label: "Total Courses",    value: totalCourses ?? 0,    icon: "📚", color: "text-purple-600" },
          { label: "Question Bank",    value: totalQuestions ?? 0,  icon: "❓", color: "text-indigo-600" },
          { label: "Enrollments",      value: totalEnrollments ?? 0,icon: "👩‍⚕️", color: "text-teal-600" },
          { label: "Completions",      value: completions ?? 0,     icon: "✅", color: "text-green-600" },
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

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        <Link href="/educator/courses"
          className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl p-4 transition-colors">
          <p className="text-lg mb-1">📚</p>
          <p className="font-semibold text-sm">Manage Courses</p>
          <p className="text-xs text-purple-200 mt-0.5">View, edit, and publish content</p>
        </Link>
        <Link href="/educator/questions"
          className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl p-4 transition-colors">
          <p className="text-lg mb-1">❓</p>
          <p className="font-semibold text-sm">Question Bank</p>
          <p className="text-xs text-indigo-200 mt-0.5">Create and manage quiz questions</p>
        </Link>
        <Link href="/educator/students"
          className="bg-teal-600 hover:bg-teal-700 text-white rounded-xl p-4 transition-colors">
          <p className="text-lg mb-1">📈</p>
          <p className="font-semibold text-sm">Student Progress</p>
          <p className="text-xs text-teal-200 mt-0.5">See who's enrolled and how they're doing</p>
        </Link>
        <Link href="/educator/library"
          className="bg-slate-600 hover:bg-slate-700 text-white rounded-xl p-4 transition-colors">
          <p className="text-lg mb-1">🗂️</p>
          <p className="font-semibold text-sm">Content Library</p>
          <p className="text-xs text-slate-300 mt-0.5">Upload and organise learning materials</p>
        </Link>
      </div>

      {/* Recent courses */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-700">Recent Courses</h2>
          <Link href="/educator/courses" className="text-xs text-purple-600 hover:underline">View all →</Link>
        </div>
        {!courses?.length ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
            No courses yet. Add content in the Supabase dashboard or via the course API.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {courses.map((c, i) => (
              <div key={c.id} className={`flex items-center gap-3 px-5 py-3.5 ${i > 0 ? "border-t border-gray-50" : ""}`}>
                <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center text-purple-600 text-sm shrink-0">📚</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{c.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded capitalize ${levelColors[c.level] ?? "bg-gray-100 text-gray-600"}`}>{c.level}</span>
                    {!c.is_published && <span className="text-[10px] text-amber-600 font-medium">Draft</span>}
                  </div>
                </div>
                <span className="text-xs text-gray-400">{new Date(c.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
