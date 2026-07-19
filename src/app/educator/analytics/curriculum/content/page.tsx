import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadCurriculumAnalytics } from "@/lib/curriculum-analytics";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import CurriculumNav from "../CurriculumNav";

// Module 5 — Content Effectiveness. Content inventory by type and course
// completion are live; view/time/engagement telemetry needs a content-tracking
// store — shown honestly.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";

export default async function Content() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadCurriculumAnalytics(admin, hospitalId ?? "")).content;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Learning Items", value: String(C.documents + C.simulations + C.courses) },
    { label: "Documents", value: String(C.documents) },
    { label: "Simulations", value: String(C.simulations) },
    { label: "Courses", value: String(C.courses) },
    { label: "Interactive", value: "—", sub: "soon" },
    { label: "Engagement", value: "—", sub: "not tracked" },
    { label: "Completion", value: pct(C.completion) },
    { label: "Quality Score", value: "—", sub: "soon" },
  ];
  const typeMax = Math.max(1, ...d.byType.map(x => x.n));
  const trMax = Math.max(1, ...d.trend.flatMap(t => [t.enrolled, t.completed]));

  return (
    <div className="max-w-[1200px]">
      <CurriculumNav active="content" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-4 xl:grid-cols-8" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4 items-start">
        {/* By type bars */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Content by Type</h2>
          <div className="flex items-end justify-around gap-2 h-32">
            {d.byType.map(x => (
              <div key={x.label} className="flex flex-col items-center gap-1 flex-1">
                <span className="text-[10px] font-bold text-gray-700">{x.n}</span>
                <div className="w-full bg-rose-400 rounded-t" style={{ height: `${(x.n / typeMax) * 90}px` }} />
                <span className="text-[8px] text-gray-400 text-center leading-tight">{x.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Engagement trend */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-1">Enrolment &amp; Completion Trend <span className="font-normal text-gray-400 text-xs">(6 mo)</span></h2>
          <div className="flex items-center gap-3 mb-2 text-[9px]"><span className="flex items-center gap-1 text-gray-500"><span className="w-2 h-2 rounded-full bg-purple-500" />Enrolled</span><span className="flex items-center gap-1 text-gray-500"><span className="w-2 h-2 rounded-full bg-green-500" />Completed</span></div>
          {d.trend.every(t => t.enrolled + t.completed === 0) ? <p className="text-xs text-gray-400 py-6 text-center">No enrolment activity yet.</p> : (
            <svg viewBox="0 0 220 90" className="w-full">
              {[0, 0.5, 1].map(f => <line key={f} x1="14" x2="214" y1={72 - f * 60} y2={72 - f * 60} stroke="#f3f4f6" strokeWidth="1" />)}
              {([["enrolled", "#9333ea"], ["completed", "#10b981"]] as const).map(([key, col]) => { const pts = d.trend.map((t, i) => ({ x: 28 + i * 34, y: 72 - (t[key] / trMax) * 60 })); return <g key={key}><polyline fill="none" stroke={col} strokeWidth="1.5" points={pts.map(p => `${p.x},${p.y}`).join(" ")} />{pts.map(p => <circle key={p.x} cx={p.x} cy={p.y} r="2" fill={col} />)}</g>; })}
              {d.trend.map((t, i) => <text key={i} x={28 + i * 34} y="84" fontSize="7" fill="#9ca3af" textAnchor="middle">{t.label}</text>)}
            </svg>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* Top content */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-bold text-gray-900">Top Content by Enrolment</h2><Link href="/educator/library" className="text-[11px] font-semibold text-purple-600 hover:underline">Manage →</Link></div>
          {d.top.length === 0 ? <p className="text-xs text-gray-400">No content with enrolments yet.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-left border-collapse">
              <thead><tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">{["Content", "Type", "Enrolled", "Completion"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
              <tbody>{d.top.map((c, i) => (
                <tr key={i} className="border-b border-gray-50 text-[11px]"><td className="py-2 pr-3 font-semibold text-gray-800">{c.title}</td><td className="py-2 pr-3 text-gray-500">{c.type}</td><td className="py-2 pr-3 text-gray-600">{c.enrolled}</td><td className="py-2 pr-3 text-gray-600">{pct(c.completion)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          <p className="text-[9px] text-gray-300 mt-2">Views, time-spent and per-item engagement need a content-tracking store — not yet captured.</p>
        </div>
        {/* AI insights */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2></div>
          <ul className="space-y-1.5">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>
        </div>
      </div>
    </div>
  );
}
