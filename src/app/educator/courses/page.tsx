import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function EducatorCoursesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: courses } = await supabase
    .from("courses")
    .select("id, title, description, category, level, duration_hours, cpd_points, is_published, created_at")
    .order("created_at", { ascending: false });

  const { data: enrollments } = await supabase
    .from("course_enrollments")
    .select("course_id, completed_at");

  const rows = (courses ?? []).map(c => {
    const enrolled   = (enrollments ?? []).filter(e => e.course_id === c.id).length;
    const completed  = (enrollments ?? []).filter(e => e.course_id === c.id && e.completed_at).length;
    return { ...c, enrolled, completed };
  });

  const levelColors: Record<string, string> = {
    beginner:     "bg-green-100 text-green-700",
    intermediate: "bg-amber-100 text-amber-700",
    advanced:     "bg-red-100 text-red-700",
  };

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Courses</h1>
          <p className="text-gray-400 text-sm mt-0.5">{rows.length} course{rows.length !== 1 ? "s" : ""} in the library</p>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 text-xs text-purple-700">
          Course creation via dashboard coming soon
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-3xl mb-3">📚</p>
          <p className="text-gray-500 text-sm font-medium">No courses yet</p>
          <p className="text-gray-400 text-xs mt-1">Add courses via the Supabase dashboard or import them.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Course</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Level</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Duration</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">CPD Pts</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Enrolled</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Completed</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(c => (
                <tr key={c.id} className="hover:bg-gray-50/40">
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-gray-900">{c.title}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5 capitalize">{c.category}</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded capitalize ${levelColors[c.level] ?? "bg-gray-100 text-gray-600"}`}>{c.level}</span>
                  </td>
                  <td className="px-4 py-3.5 text-center text-xs text-gray-600">{c.duration_hours}h</td>
                  <td className="px-4 py-3.5 text-center text-xs text-gray-600">{c.cpd_points}</td>
                  <td className="px-4 py-3.5 text-center text-xs text-gray-600">{c.enrolled}</td>
                  <td className="px-4 py-3.5 text-center text-xs text-gray-600">{c.completed}</td>
                  <td className="px-4 py-3.5 text-center">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${c.is_published ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                      {c.is_published ? "Published" : "Draft"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
