import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadLearningAnalytics } from "@/lib/learning-analytics";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import LearningNav from "../LearningNav";

// Module 3 — Course Analytics (Learning Analytics Workspace §Module 3).
// Course effectiveness, funnel and content analytics. Lesson-level telemetry
// (drop-off, confusing/skipped lessons) has no store — shown honestly as soon.

export const dynamic = "force-dynamic";

const pct = (v: number | null) => v !== null ? `${v}%` : "—";
const JOURNEY = ["Drop-off locations", "Confusing lessons", "Longest lessons", "Skipped lessons", "Repeated lessons"];

export default async function CourseAnalytics() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadLearningAnalytics(admin, hospitalId ?? "")).courses;
  const C = d.cards;
  const enrolled = d.funnel[0]?.n ?? 0;

  const tiles: Tile[] = [
    { label: "Courses", value: String(C.courses) },
    { label: "Active Learners", value: String(C.activeLearners) },
    { label: "Completion", value: pct(C.completion) },
    { label: "Avg. Score", value: "—", sub: "not course-linked" },
    { label: "Quiz Pass Rate", value: pct(C.passRate) },
    { label: "Avg. Duration", value: C.avgDuration !== null ? `${C.avgDuration}h` : "—" },
  ];

  return (
    <div className="max-w-[1200px]">
      <LearningNav active="courses" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 items-start">
        {/* Course funnel */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Course Completion Funnel</h2>
          {enrolled === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center">No enrolments yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {d.funnel.map((s, i) => (
                <div key={s.label} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 w-16 shrink-0">{s.label}</span>
                  <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
                    <div className="h-full rounded flex items-center px-1.5 text-[9px] font-bold text-white" style={{ width: `${enrolled ? Math.max(8, (s.n / enrolled) * 100) : 0}%`, background: `hsl(${262 - i * 8} 70% ${58 + i * 4}%)` }}>{s.n}</div>
                  </div>
                  <span className="text-[9px] text-gray-400 w-9 text-right">{enrolled ? Math.round((s.n / enrolled) * 100) : 0}%</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Learning journey (soon) */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Learning Journey</h2>
          <div className="flex flex-col gap-1.5">
            {JOURNEY.map(j => (
              <div key={j} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                <span className="text-[11px] text-gray-400">{j}</span>
                <span className="text-[8px] font-bold uppercase text-gray-300">soon</span>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-gray-300 mt-2">Needs lesson-level tracking (per-lesson views, dwell, replays) — not captured yet.</p>
        </div>

        {/* Content analytics */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Content Analytics</h2>
          <div className="flex flex-col gap-2">
            {d.content.map(c => (
              <div key={c.label} className="flex items-center justify-between">
                <span className="text-[11px] text-gray-500">{c.label}</span>
                {c.value !== null ? <span className="text-sm font-bold text-gray-900">{c.value}</span> : <span className="text-[8px] font-bold uppercase text-gray-300">soon</span>}
              </div>
            ))}
          </div>
          <p className="text-[9px] text-gray-300 mt-2">Quiz &amp; simulation usage are live; video/reading/download telemetry needs a content store.</p>
        </div>
      </div>

      {/* Course comparison */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-900">Course Performance Comparison</h2>
          <Link href="/educator/courses" className="text-[11px] font-semibold text-purple-600 hover:underline">Manage courses →</Link>
        </div>
        {d.comparison.length === 0 ? (
          <p className="text-xs text-gray-400">No courses with enrolments yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  {["Course", "Enrolled", "Completion", "Difficulty", "Competency", "Satisfaction", "Instructor"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {d.comparison.map(c => (
                  <tr key={c.id} className="border-b border-gray-50 text-[11px]">
                    <td className="py-2 pr-3 font-semibold text-gray-800">{c.title}</td>
                    <td className="py-2 pr-3 text-gray-600">{c.enrolled}</td>
                    <td className="py-2 pr-3 text-gray-600">{pct(c.completion)}</td>
                    <td className="py-2 pr-3 text-gray-500 capitalize">{c.level}</td>
                    <td className="py-2 pr-3 text-gray-300">—</td>
                    <td className="py-2 pr-3 text-gray-300">—</td>
                    <td className="py-2 pr-3 text-gray-300">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[9px] text-gray-300 mt-2">Difficulty = course level. Competency achieved, learner satisfaction &amp; instructor rating need course-linked scores and a survey store — not tracked.</p>
      </div>

      {/* AI recommendations */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Recommendations</h2><span className="ml-auto text-[8px] font-bold uppercase text-gray-300">rule-derived</span></div>
        {d.recs.length === 0 ? (
          <p className="text-xs text-gray-400">No content issues detected from live completion &amp; quiz data. ✅</p>
        ) : (
          <ul className="space-y-1.5">{d.recs.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>
        )}
      </div>
    </div>
  );
}
