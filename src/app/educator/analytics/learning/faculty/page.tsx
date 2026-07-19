import { requireEducatorAccess } from "@/lib/educator-access";
import { loadLearningAnalytics } from "@/lib/learning-analytics";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import LearningNav from "../LearningNav";

// Module 4 — Faculty Analytics (Learning Analytics Workspace §Module 4).
// Educator effectiveness. Only assessment/simulation activity is captured;
// ratings, turnaround and satisfaction need survey/timestamp stores — soon.

export const dynamic = "force-dynamic";

const DASH = ["Teaching workload", "Learner engagement", "Assessment turnaround", "Discussion activity", "Content creation", "Course completion", "Learner satisfaction"];

export default async function FacultyAnalytics() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadLearningAnalytics(admin, hospitalId ?? "")).faculty;
  const C = d.cards;
  const maxAssess = Math.max(1, ...d.ranking.map(f => f.assessments));

  const tiles: Tile[] = [
    { label: "Faculty", value: String(C.faculty) },
    { label: "Courses", value: String(C.courses) },
    { label: "Learners", value: String(C.learners) },
    { label: "Avg. Rating", value: "—", sub: "no survey store" },
    { label: "Assessment Quality", value: "—", sub: "soon" },
    { label: "Feedback Time", value: "—", sub: "soon" },
  ];

  return (
    <div className="max-w-[1200px]">
      <LearningNav active="faculty" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 items-start">
        {/* Educator activity dashboard */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Educator Dashboard</h2>
          <div className="flex flex-col gap-2">
            {DASH.map(row => {
              const live = row === "Teaching workload";
              return (
                <div key={row} className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-500">{row}</span>
                  {live ? <span className="text-[11px] font-bold text-gray-900">{d.ranking.reduce((s, f) => s + f.assessments, 0)} assessments</span>
                    : <span className="text-[8px] font-bold uppercase text-gray-300">soon</span>}
                </div>
              );
            })}
          </div>
          <p className="text-[9px] text-gray-300 mt-2">Only assessment/simulation activity is captured; engagement, turnaround, discussion, content-creation and satisfaction need dedicated stores.</p>
        </div>

        {/* Faculty ranking */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 lg:col-span-2">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Faculty Ranking <span className="font-normal text-gray-400 text-xs">(by assessment activity)</span></h2>
          {d.ranking.length === 0 ? (
            <p className="text-xs text-gray-400">No faculty in your hospital yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">
                    {["Instructor", "Assessments", "Simulations", "Completion", "Competency Gain", "Satisfaction", "Response Time"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {d.ranking.map(f => (
                    <tr key={f.id} className="border-b border-gray-50 text-[11px]">
                      <td className="py-2 pr-3 font-semibold text-gray-800 whitespace-nowrap">{f.name}</td>
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-1.5">
                          <span className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden inline-block"><span className="block h-full rounded-full bg-orange-400" style={{ width: `${(f.assessments / maxAssess) * 100}%` }} /></span>
                          <span className="text-gray-700 font-bold">{f.assessments}</span>
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-gray-600">{f.simulations}</td>
                      <td className="py-2 pr-3 text-gray-300">—</td>
                      <td className="py-2 pr-3 text-gray-300">—</td>
                      <td className="py-2 pr-3 text-gray-300">—</td>
                      <td className="py-2 pr-3 text-gray-300">—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* AI insights */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Faculty Insights</h2><span className="ml-auto text-[8px] font-bold uppercase text-gray-300">rule-derived</span></div>
        {d.insights.length === 0 ? (
          <p className="text-xs text-gray-400">Not enough faculty activity to analyse yet.</p>
        ) : (
          <ul className="space-y-1.5">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>
        )}
        <p className="text-[9px] text-gray-300 mt-2">Teaching-style analysis, mentoring recommendations and quality scoring need learner-feedback and turnaround data — on the roadmap.</p>
      </div>
    </div>
  );
}
