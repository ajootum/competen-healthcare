import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadCurriculumAnalytics } from "@/lib/curriculum-analytics";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import CurriculumNav from "../CurriculumNav";

// Module 1 — Curriculum Effectiveness. Per-framework curricula quality,
// completion, attainment and lifecycle. Satisfaction & accreditation readiness
// need survey/accreditation stores — shown honestly.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";
const QUICK = [["Review Curriculum", "/educator/studio/curriculum"], ["Improvement Plan", "/educator/plans"], ["Compare Versions", "/educator/studio/versions"], ["Generate Report", "/educator/validation-analytics"]];

export default async function Effectiveness() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadCurriculumAnalytics(admin, hospitalId ?? "")).effectiveness;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Active Curricula", value: String(C.activeCurricula) },
    { label: "Effectiveness", value: pct(C.effectiveness) },
    { label: "Competency Attainment", value: pct(C.attainment) },
    { label: "Completion Rate", value: pct(C.completion) },
    { label: "Learner Satisfaction", value: "—", sub: "no survey store" },
    { label: "Accreditation Ready", value: "—", sub: "soon" },
    { label: "Quality Index", value: pct(C.qualityIndex) },
    { label: "Curricula Reviewed", value: String(d.lifecycle.reduce((s, l) => s + l.n, 0)) },
  ];
  const distTotal = d.distribution.reduce((s, x) => s + x.n, 0);
  const Circ = 2 * Math.PI * 40;
  const arcPcts = d.distribution.map(x => distTotal ? (x.n / distTotal) * 100 : 0);
  const arcs = d.distribution.map((x, i) => ({ ...x, off: arcPcts.slice(0, i).reduce((s, p) => s + p, 0), p: arcPcts[i] }));
  const effMax = Math.max(100, ...d.trend.map(t => t.value ?? 0));

  return (
    <div className="max-w-[1200px]">
      <CurriculumNav active="effectiveness" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-4 xl:grid-cols-8" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start mb-4">
        {/* Curriculum performance table */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Curriculum Performance Overview</h2>
          {d.table.length === 0 ? <p className="text-xs text-gray-400">No curricula with competencies yet.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-left border-collapse">
              <thead><tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">{["Curriculum", "Program", "Completion", "Comp. Attainment", "Quality Index"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
              <tbody>{d.table.map(c => (
                <tr key={c.id} className="border-b border-gray-50 text-[11px]">
                  <td className="py-2 pr-3 font-semibold text-gray-800 max-w-[200px] truncate" title={c.name}>{c.name}</td>
                  <td className="py-2 pr-3 text-gray-500 capitalize">{c.program}</td>
                  <td className="py-2 pr-3 text-gray-600">{pct(c.completion)}</td>
                  <td className="py-2 pr-3 text-gray-600">{pct(c.attainment)}</td>
                  <td className="py-2 pr-3"><span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${(c.quality ?? 0) >= 70 ? "bg-green-50 text-green-700" : (c.quality ?? 0) >= 50 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-600"}`}>{pct(c.quality)}</span></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>

        {/* Quality distribution donut */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Quality Distribution</h2>
          {distTotal === 0 ? <p className="text-xs text-gray-400 py-6 text-center">No curricula.</p> : (
            <div className="flex items-center gap-4">
              <div className="relative w-24 shrink-0"><svg viewBox="0 0 100 100" className="w-full -rotate-90"><circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="12" />{arcs.filter(a => a.p > 0).map(a => <circle key={a.label} cx="50" cy="50" r="40" fill="none" stroke={a.color} strokeWidth="12" strokeDasharray={`${(a.p / 100) * Circ} ${Circ}`} strokeDashoffset={-(a.off / 100) * Circ} />)}</svg><div className="absolute inset-0 flex flex-col items-center justify-center"><p className="text-lg font-extrabold text-gray-900">{distTotal}</p><p className="text-[8px] text-gray-400">curricula</p></div></div>
              <div className="flex flex-col gap-1 flex-1">{d.distribution.map(x => <div key={x.label} className="flex items-center gap-2 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: x.color }} /><span className="text-gray-500 flex-1 truncate">{x.label}</span><span className="font-bold text-gray-800">{x.n}</span></div>)}</div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* Trend */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-2">Effectiveness Trend <span className="font-normal text-gray-400 text-xs">(6 mo)</span></h2>
          {d.trend.every(t => t.value === null) ? <p className="text-xs text-gray-400 py-6 text-center">No history.</p> : (
            <svg viewBox="0 0 220 90" className="w-full">
              {[0, 50, 100].map(y => <line key={y} x1="20" x2="214" y1={72 - y * 0.6} y2={72 - y * 0.6} stroke="#f3f4f6" strokeWidth="1" />)}
              {(() => { const pts = d.trend.map((t, i) => ({ x: 34 + i * 34, y: t.value !== null ? 72 - (t.value / effMax) * 60 : null })); const line = pts.filter(p => p.y !== null) as { x: number; y: number }[]; return <>{line.length > 1 && <polyline fill="none" stroke="#9333ea" strokeWidth="1.5" points={line.map(p => `${p.x},${p.y}`).join(" ")} />}{line.map(p => <circle key={p.x} cx={p.x} cy={p.y} r="2.5" fill="#9333ea" />)}{d.trend.map((t, i) => <text key={i} x={34 + i * 34} y="84" fontSize="7" fill="#9ca3af" textAnchor="middle">{t.label}</text>)}</>; })()}
            </svg>
          )}
        </div>

        {/* AI insights */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2></div>
          {d.insights.length === 0 ? <p className="text-xs text-gray-400">Curricula look healthy. ✅</p> : <ul className="space-y-1.5">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>}
        </div>

        {/* Quick actions + lifecycle */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-2">Lifecycle &amp; Actions</h2>
          <div className="flex flex-wrap gap-1 mb-3">{d.lifecycle.map(l => <span key={l.label} className="text-[10px] bg-gray-50 border border-gray-100 rounded px-2 py-1 text-gray-600 capitalize">{l.label.replace("_", " ")}: <b>{l.n}</b></span>)}</div>
          <div className="grid grid-cols-2 gap-1.5">{QUICK.map(([l, h]) => <Link key={l} href={h} className="text-[10px] font-semibold text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-2 py-1.5 hover:border-purple-200 transition-colors">{l} →</Link>)}</div>
        </div>
      </div>
    </div>
  );
}
