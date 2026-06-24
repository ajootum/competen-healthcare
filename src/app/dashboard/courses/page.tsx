import { createClient } from "@/lib/supabase/server";
import CoursesClient from "./CoursesClient";

export default async function CoursesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: courses }, { data: enrollments }] = await Promise.all([
    supabase.from("courses").select("*").eq("is_published", true).order("category"),
    supabase.from("course_enrollments").select("course_id, progress, completed_at").eq("user_id", user!.id),
  ]);

  const totalCPD = enrollments?.reduce((sum, e) => {
    const course = courses?.find(c => c.id === e.course_id);
    return e.completed_at ? sum + (course?.cpd_points ?? 0) : sum;
  }, 0) ?? 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">CPD Academy</h1>
        <p className="text-gray-400 text-sm mt-0.5">Earn Continuing Professional Development points through accredited clinical courses.</p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: "Available Courses", value: courses?.length ?? 0, color: "text-teal-600" },
          { label: "Enrolled",          value: enrollments?.length ?? 0, color: "text-blue-600" },
          { label: "CPD Points Earned", value: totalCPD, color: "text-amber-500" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl p-4 border border-gray-100 text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <CoursesClient courses={courses ?? []} enrollments={enrollments ?? []} />
    </div>
  );
}
