"use client";
import { useState } from "react";
import { Lesson } from "@/lib/lessonContent";

type Props = {
  courseId: string;
  lessons: Lesson[];
  initialProgress: number;
  initialCompleted: boolean;
};

export default function LessonViewer({ courseId, lessons, initialProgress, initialCompleted }: Props) {
  const [active, setActive] = useState(0);
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [courseCompleted, setCourseCompleted] = useState(initialCompleted);
  const [saving, setSaving] = useState(false);

  const lesson = lessons[active];
  const [expandedSection, setExpandedSection] = useState<number | null>(0);

  async function markComplete() {
    const newCompleted = new Set(completed).add(active);
    setCompleted(newCompleted);
    const progress = Math.round((newCompleted.size / lessons.length) * 100);
    const isFullyDone = newCompleted.size === lessons.length;
    setSaving(true);
    await fetch("/api/courses/progress", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ course_id: courseId, progress: isFullyDone ? 100 : progress }),
    });
    setSaving(false);
    if (isFullyDone) setCourseCompleted(true);
    if (active < lessons.length - 1) setActive(a => a + 1);
  }

  const overallProgress = courseCompleted ? 100 : Math.round((completed.size / lessons.length) * 100) || initialProgress;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Sidebar — lesson list */}
      <div className="lg:col-span-1">
        <div className="bg-white rounded-xl border border-gray-100 p-4 sticky top-4">
          <div className="mb-3">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-500">Course progress</span>
              <span className="font-medium text-teal-600">{overallProgress}%</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-teal-500 rounded-full transition-all duration-500" style={{ width: `${overallProgress}%` }} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            {lessons.map((l, i) => (
              <button key={i} onClick={() => setActive(i)}
                className={`flex items-center gap-3 p-2.5 rounded-lg text-left text-sm transition-colors w-full ${
                  active === i ? "bg-teal-50 text-teal-700 font-medium" : "text-gray-600 hover:bg-gray-50"
                }`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 font-semibold ${
                  completed.has(i) || courseCompleted ? "bg-green-500 text-white" : active === i ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-400"
                }`}>
                  {completed.has(i) || courseCompleted ? "✓" : i + 1}
                </div>
                <span className="truncate">{l.title}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main lesson content */}
      <div className="lg:col-span-2">
        <div className="bg-white rounded-xl border border-gray-100 p-6 mb-4">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center text-2xl">{lesson.icon}</div>
            <div>
              <h2 className="font-bold text-gray-900">{lesson.title}</h2>
              <p className="text-xs text-gray-400 mt-0.5">⏱ {lesson.duration}</p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {lesson.content.map((section, i) => (
              <div key={i} className="border border-gray-100 rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpandedSection(expandedSection === i ? null : i)}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors">
                  <span className="font-semibold text-gray-800 text-sm">{section.heading}</span>
                  <span className={`text-gray-400 transition-transform ${expandedSection === i ? "rotate-180" : ""}`}>▾</span>
                </button>
                {expandedSection === i && (
                  <div className="px-4 pb-4">
                    <p className="text-sm text-gray-700 leading-relaxed">{section.body}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <button
            onClick={() => setActive(a => Math.max(0, a - 1))}
            disabled={active === 0}
            className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-30 transition-colors px-4 py-2 rounded-lg border border-gray-200 hover:border-gray-300">
            ← Previous
          </button>

          {courseCompleted ? (
            <div className="flex items-center gap-2 text-green-600 font-semibold text-sm">
              <span className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-xs">✓</span>
              Course Complete — Certificate Earned
            </div>
          ) : completed.has(active) ? (
            <button
              onClick={() => active < lessons.length - 1 ? setActive(a => a + 1) : undefined}
              className="bg-gray-100 text-gray-600 px-6 py-2 rounded-lg text-sm font-medium">
              {active < lessons.length - 1 ? "Next Lesson →" : "All lessons done ✓"}
            </button>
          ) : (
            <button onClick={markComplete} disabled={saving}
              className="bg-teal-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-60 transition-colors">
              {saving ? "Saving…" : active < lessons.length - 1 ? "Mark Complete & Continue →" : "Complete Course ✓"}
            </button>
          )}

          <button
            onClick={() => setActive(a => Math.min(lessons.length - 1, a + 1))}
            disabled={active === lessons.length - 1}
            className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-30 transition-colors px-4 py-2 rounded-lg border border-gray-200 hover:border-gray-300">
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
