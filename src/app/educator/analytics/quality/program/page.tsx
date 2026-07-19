import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadProgramQuality } from "@/lib/program-quality";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import QualityNav from "../QualityNav";

// Module 1 — Program KPIs. Executive programme overview: quality index,
// attainment, pass rate, accreditation and CQI, with quality-by-domain.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";
const QUICK = [["Compare Programmes", "/educator/analytics/learning/cohorts"], ["Generate Report", "/educator/validation-analytics"], ["Launch Improvement Plan", "/educator/plans"], ["Schedule Review", "/educator/meetings"]];

export default async function Program() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadProgramQuality(admin, hospitalId ?? "")).program;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Program Quality Index", value: pct(C.qualityIndex) },
    { label: "Active Learners", value: String(C.activeLearners) },
    { label: "Graduation Rate", value: "—", sub: "no cohort store" },
    { label: "Competency Attainment", value: pct(C.attainment) },
    { label: "Pass Rate", value: pct(C.passRate) },
    { label: "Faculty Effectiveness", value: "—", sub: "no survey store" },
    { label: "Accreditation Readiness", value: pct(C.accreditation) },
    { label: "CQI Score", value: pct(C.cqi), sub: "CAPA closure" },
  ];
  const trMax = 100;

  return (
    <div className="max-w-[1200px]">
      <QualityNav active="program" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-4 xl:grid-cols-8" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4 items-start">
        {/* Trend */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Program Quality Trend <span className="font-normal text-gray-400 text-xs">(6 mo)</span></h2>
          {d.trend.every(t => t.value === null) ? <p className="text-xs text-gray-400 py-8 text-center">No history.</p> : (
            <svg viewBox="0 0 320 100" className="w-full">
              {[0, 50, 100].map(y => <line key={y} x1="22" x2="314" y1={82 - y * 0.7} y2={82 - y * 0.7} stroke="#f3f4f6" strokeWidth="1" />)}
              {(() => { const pts = d.trend.map((t, i) => ({ x: 40 + i * 48, y: t.value !== null ? 82 - (t.value / trMax) * 70 : null })); const line = pts.filter(p => p.y !== null) as { x: number; y: number }[]; return <>{line.length > 1 && <polyline fill="none" stroke="#9333ea" strokeWidth="1.5" points={line.map(p => `${p.x},${p.y}`).join(" ")} />}{line.map(p => <circle key={p.x} cx={p.x} cy={p.y} r="2.5" fill="#9333ea" />)}{d.trend.map((t, i) => <text key={i} x={40 + i * 48} y="96" fontSize="7" fill="#9ca3af" textAnchor="middle">{t.label}</text>)}</>; })()}
            </svg>
          )}
        </div>

        {/* By domain */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Quality Score by Domain</h2>
          <div className="flex flex-col gap-1.5">{d.byDomain.map(b => (
            <div key={b.label} className="flex items-center gap-2 text-[10px]"><span className="text-gray-500 w-32 truncate">{b.label}</span>{b.backed && b.pct !== null ? <><div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${b.pct >= 80 ? "bg-green-500" : b.pct >= 60 ? "bg-blue-500" : b.pct >= 40 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${b.pct}%` }} /></div><span className="font-bold text-gray-700 w-8 text-right">{b.pct}%</span></> : <span className="flex-1 text-right text-[8px] font-bold uppercase text-gray-300">soon</span>}</div>
          ))}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2></div>
          {d.insights.length === 0 ? <p className="text-xs text-gray-400">Programme performing well. ✅</p> : <ul className="space-y-1.5">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>}
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-1.5">{QUICK.map(([l, h]) => <Link key={l} href={h} className="text-[10px] font-semibold text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-2 py-2 hover:border-purple-200 transition-colors">{l} →</Link>)}</div>
        </div>
      </div>
    </div>
  );
}
