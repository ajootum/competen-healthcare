import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { lessonContent } from "@/lib/lessonContent";
import LessonViewer from "./LessonViewer";

const levelColors: Record<string, string> = {
  beginner:     "bg-green-100 text-green-700",
  intermediate: "bg-blue-100 text-blue-700",
  advanced:     "bg-purple-100 text-purple-700",
};

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: course }, { data: enrollment }] = await Promise.all([
    supabase.from("courses").select("*").eq("id", id).single(),
    supabase.from("course_enrollments").select("progress, completed_at").eq("user_id", user!.id).eq("course_id", id).single(),
  ]);

  if (!course) notFound();

  const lessons = lessonContent[course.title] ?? [];
  const isEnrolled = !!enrollment;
  const progress = enrollment?.progress ?? 0;
  const isCompleted = !!enrollment?.completed_at;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link href="/dashboard/courses" className="text-xs text-teal-600 hover:underline flex items-center gap-1 mb-3">
          ← Back to CPD Academy
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{course.title}</h1>
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded capitalize ${levelColors[course.level] ?? "bg-gray-100 text-gray-500"}`}>{course.level}</span>
              <span className="text-xs text-gray-400">{course.category}</span>
              <span className="text-xs text-gray-400">⏱ {course.duration_hours}h</span>
              <span className="text-xs text-gray-400">🏅 {course.cpd_points} CPD points</span>
            </div>
          </div>
          {isCompleted && (
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2 text-center shrink-0">
              <p className="text-green-700 font-semibold text-sm">✓ Completed</p>
              <p className="text-green-500 text-xs">{course.cpd_points} CPD pts earned</p>
            </div>
          )}
        </div>
        {isEnrolled && !isCompleted && (
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 max-w-xs h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-xs text-gray-400">{progress}% complete</span>
          </div>
        )}
      </div>

      {!isEnrolled ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
          <p className="text-3xl mb-3">📚</p>
          <h2 className="font-semibold text-gray-900 mb-1">Enrol to access this course</h2>
          <p className="text-sm text-gray-400 mb-5">Free access to all CPD Academy courses</p>
          <Link href="/dashboard/courses"
            className="inline-flex bg-teal-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors">
            Enrol from CPD Academy
          </Link>
        </div>
      ) : lessons.length > 0 ? (
        <LessonViewer
          courseId={id}
          lessons={lessons}
          initialProgress={progress}
          initialCompleted={isCompleted}
        />
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400">
          <p className="text-3xl mb-2">🔧</p>
          <p className="font-medium text-gray-600">Content coming soon</p>
          <p className="text-sm mt-1">Lessons for this course are being prepared by our clinical team.</p>
        </div>
      )}
    </div>
  );
}
