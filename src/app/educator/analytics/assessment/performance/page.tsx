import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAssessmentAnalytics } from "@/lib/assessment-analytics";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import AssessmentNav from "../AssessmentNav";

// Module 1 — Assessment Performance. Performance by type, program, trend and
// the published→awarded journey from live assessments & scores.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";

export default async function Performance() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadAssessmentAnalytics(admin, hospitalId ?? "")).performance;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Total Assessments", value: String(C.total) },
    { label: "Completed", value: String(C.completed) },
    { label: "Avg. Score", value: pct(C.avg) },
    { label: "Pass Rate", value: pct(C.passRate) },
    { label: "First-Attempt", value: "—", sub: "not tracked" },
    { label: "Reassessment", value: "—", sub: "not tracked" },
    { label: "Competency Ach.", value: pct(C.competencyAch) },
    { label: "Quality Index", value: pct(C.qualityIndex) },
  ];
  const trMax = 100;
  const jMax = d.journey[0]?.n ?? 1;

  return (
    <div className="max-w-[1200px]">
      <AssessmentNav active="performance" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-4 xl:grid-cols-8" /></div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-4">
        <h2 className="text-sm font-bold text-gray-900 mb-3">Performance by Assessment Type</h2>
        {d.byType.length === 0 ? <p className="text-xs text-gray-400">No recorded assessments yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left border-collapse">
            <thead><tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">{["Type", "Records", "Learners", "Avg Score", "Pass Rate", "Median", "Std Dev"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
            <tbody>{d.byType.map(t => (
              <tr key={t.type} className="border-b border-gray-50 text-[11px]">
                <td className="py-2 pr-3 font-semibold text-gray-800">{t.label}</td>
                <td className="py-2 pr-3 text-gray-600">{t.n}</td>
                <td className="py-2 pr-3 text-gray-600">{t.learners || "—"}</td>
                <td className="py-2 pr-3 text-gray-600">{pct(t.avg)}</td>
                <td className="py-2 pr-3"><span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${(t.passRate ?? 0) >= 70 ? "bg-green-50 text-green-700" : (t.passRate ?? 0) >= 50 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-600"}`}>{pct(t.passRate)}</span></td>
                <td className="py-2 pr-3 text-gray-600">{pct(t.median)}</td>
                <td className="py-2 pr-3 text-gray-600">{t.sd ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* Trend */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 lg:col-span-2">
          <h2 className="text-sm font-bold text-gray-900 mb-1">Performance Trend <span className="font-normal text-gray-400 text-xs">(6 mo)</span></h2>
          <div className="flex items-center gap-3 mb-2 text-[9px]"><span className="flex items-center gap-1 text-gray-500"><span className="w-2 h-2 rounded-full bg-purple-500" />Avg Score</span><span className="flex items-center gap-1 text-gray-500"><span className="w-2 h-2 rounded-full bg-green-500" />Pass Rate</span></div>
          {d.trend.every(t => t.avg === null && t.pass === null) ? <p className="text-xs text-gray-400 py-8 text-center">No history.</p> : (
            <svg viewBox="0 0 320 100" className="w-full">
              {[0, 50, 100].map(y => <line key={y} x1="22" x2="314" y1={82 - y * 0.7} y2={82 - y * 0.7} stroke="#f3f4f6" strokeWidth="1" />)}
              {([["avg", "#9333ea"], ["pass", "#10b981"]] as const).map(([key, col]) => { const pts = d.trend.map((t, i) => ({ x: 40 + i * 48, y: t[key] !== null ? 82 - (t[key] as number) / trMax * 70 : null })); const line = pts.filter(p => p.y !== null) as { x: number; y: number }[]; return <g key={key}>{line.length > 1 && <polyline fill="none" stroke={col} strokeWidth="1.5" points={line.map(p => `${p.x},${p.y}`).join(" ")} />}{line.map(p => <circle key={p.x} cx={p.x} cy={p.y} r="2.5" fill={col} />)}</g>; })}
              {d.trend.map((t, i) => <text key={i} x={40 + i * 48} y="96" fontSize="7" fill="#9ca3af" textAnchor="middle">{t.label}</text>)}
            </svg>
          )}
        </div>

        {/* Journey + program */}
        <div className="flex flex-col gap-4">
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-3">Assessment Journey</h2>
            <div className="flex flex-col gap-1">{d.journey.map((s, i) => (
              <div key={s.label} className="flex items-center gap-2"><div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden"><div className="h-full rounded flex items-center px-2 text-[9px] font-bold text-white" style={{ width: `${jMax ? Math.max(16, (s.n / jMax) * 100) : 0}%`, background: `hsl(${262 - i * 8} 65% ${58 + i * 3}%)` }}>{s.n}</div></div><span className="text-[9px] text-gray-500 w-28 shrink-0">{s.label}</span></div>
            ))}</div>
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2></div>
            {d.insights.length === 0 ? <p className="text-xs text-gray-400">No issues detected. ✅</p> : <ul className="space-y-1.5">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>}
          </div>
        </div>
      </div>
    </div>
  );
}
