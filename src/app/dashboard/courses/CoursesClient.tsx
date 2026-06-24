"use client";
import { useState } from "react";

type Course = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  level: string;
  duration_hours: number;
  cpd_points: number;
};

type Enrollment = {
  course_id: string;
  progress: number;
  completed_at: string | null;
};

const levelColors: Record<string, string> = {
  beginner:     "bg-green-100 text-green-700",
  intermediate: "bg-blue-100 text-blue-700",
  advanced:     "bg-purple-100 text-purple-700",
};

const categoryIcons: Record<string, string> = {
  Emergency:     "🚨",
  Safety:        "🛡️",
  Pediatrics:    "👶",
  Pharmacology:  "💊",
  "Critical Care": "❤️",
  Clinical:      "🩺",
};

export default function CoursesClient({ courses, enrollments }: { courses: Course[]; enrollments: Enrollment[] }) {
  const [enrolledMap, setEnrolledMap] = useState<Record<string, Enrollment>>(() =>
    Object.fromEntries(enrollments.map(e => [e.course_id, e]))
  );
  const [loading, setLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState("All");

  const categories = ["All", ...Array.from(new Set(courses.map(c => c.category)))];
  const filtered = filter === "All" ? courses : courses.filter(c => c.category === filter);

  async function enroll(courseId: string) {
    setLoading(courseId);
    const res = await fetch("/api/courses/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ course_id: courseId }),
    });
    if (res.ok) {
      setEnrolledMap(prev => ({ ...prev, [courseId]: { course_id: courseId, progress: 0, completed_at: null } }));
    }
    setLoading(null);
  }

  return (
    <div>
      {/* Category filter */}
      <div className="flex gap-2 flex-wrap mb-6">
        {categories.map(cat => (
          <button key={cat} onClick={() => setFilter(cat)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === cat ? "bg-teal-600 text-white" : "bg-white text-gray-600 border border-gray-200 hover:border-teal-300"
            }`}>
            {cat}
          </button>
        ))}
      </div>

      {/* Course grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(course => {
          const enrollment = enrolledMap[course.id];
          const icon = categoryIcons[course.category] ?? "📚";
          return (
            <div key={course.id} className="bg-white rounded-xl border border-gray-100 p-5 flex flex-col gap-3 hover:border-teal-200 transition-colors">
              <div className="flex items-start justify-between">
                <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center text-xl">{icon}</div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded capitalize ${levelColors[course.level] ?? "bg-gray-100 text-gray-600"}`}>
                  {course.level}
                </span>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 text-sm leading-tight">{course.title}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{course.category}</p>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <span>⏱ {course.duration_hours}h</span>
                <span>🏅 {course.cpd_points} CPD pts</span>
              </div>
              {enrollment ? (
                <div className="mt-auto">
                  {enrollment.completed_at ? (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full"><div className="h-full bg-green-500 rounded-full w-full" /></div>
                        <span className="text-[10px] bg-green-50 text-green-600 px-2 py-0.5 rounded font-medium">Done</span>
                      </div>
                      <a href={`/dashboard/courses/${course.id}`} className="block w-full text-center text-xs bg-green-50 text-green-700 font-medium py-2 rounded-lg hover:bg-green-100 transition-colors">
                        Review course →
                      </a>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${enrollment.progress}%` }} />
                        </div>
                        <span className="text-[10px] text-gray-400">{enrollment.progress}%</span>
                      </div>
                      <a href={`/dashboard/courses/${course.id}`} className="block w-full text-center text-xs bg-teal-50 text-teal-700 font-medium py-2 rounded-lg hover:bg-teal-100 transition-colors">
                        Continue learning →
                      </a>
                    </div>
                  )}
                </div>
              ) : (
                <button onClick={() => enroll(course.id)} disabled={loading === course.id}
                  className="mt-auto w-full text-xs bg-teal-600 text-white font-medium py-2 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-60">
                  {loading === course.id ? "Enrolling…" : "Enroll free"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-3xl mb-2">📚</p>
          <p>No courses in this category yet.</p>
        </div>
      )}
    </div>
  );
}
