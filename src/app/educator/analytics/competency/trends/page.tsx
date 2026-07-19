import { requireEducatorAccess } from "@/lib/educator-access";
import { loadCompetencyAnalytics } from "@/lib/competency-analytics";
import type { Trend } from "@/lib/analytics-data";
import CompetencyNav from "../CompetencyNav";

// Module 7 — Competency Trends. Historical achievement/coverage/mastery with a
// naive projection. Change-point detection & multi-factor forecasting need
// richer event history — shown honestly as soon.

export const dynamic = "force-dynamic";
const CHANGE_SOON = ["Curriculum revision", "New educator assignment", "New assessment method", "Framework version update"];

function chip(t: Trend, soon = false) {
  if (soon) return <span className="text-[8px] font-bold uppercase text-gray-300">soon</span>;
  if (!t) return <span className="text-[10px] text-gray-300">—</span>;
  return <span className={`text-[11px] font-bold ${t.dir === "up" ? "text-green-600" : "text-red-500"}`}>{t.dir === "up" ? "▲" : "▼"} {t.pct}%</span>;
}
function project(series: (number | null)[]): number | null {
  const v = series.filter((x): x is number => x !== null);
  if (v.length < 2) return null;
  const d = v.slice(1).map((x, i) => x - v[i]);
  return Math.max(0, Math.min(100, Math.round(v[v.length - 1] + d.reduce((a, b) => a + b, 0) / d.length)));
}

export default async function Trends() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadCompetencyAnalytics(admin, hospitalId ?? "")).trends;

  const cards = [
    { label: "Achievement Trend", trend: d.cards.achievement },
    { label: "Mastery Trend", trend: d.cards.mastery },
    { label: "Readiness Trend", trend: d.cards.readiness },
    { label: "Competency Velocity", value: `${d.cards.velocity}/mo`, trend: null as Trend },
    { label: "Gap Reduction", trend: null as Trend, soon: true },
    { label: "Expiry Trend", trend: null as Trend, soon: true },
    { label: "Reassess Success", trend: null as Trend, soon: true },
    { label: "Forecasted Achievement", value: project(d.monthly.map(m => m.achievement)) !== null ? `${project(d.monthly.map(m => m.achievement))}%` : "—", trend: null as Trend },
  ];
  const hasSeries = d.monthly.some(m => m.achievement !== null || m.coverage !== null || m.mastery !== null);

  return (
    <div className="max-w-[1200px]">
      <CompetencyNav active="trends" />

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-5">
        {cards.map(c => (
          <div key={c.label} className="bg-white border border-gray-100 rounded-2xl p-4">
            <p className="text-[10px] font-semibold text-gray-500 leading-tight">{c.label}</p>
            {"value" in c && c.value ? <p className="text-lg font-extrabold text-gray-900 mt-1">{c.value}</p> : <div className="mt-1">{chip(c.trend, c.soon)}</div>}
            {"value" in c && c.value && <div className="mt-0.5">{chip(c.trend, c.soon)}</div>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start mb-4">
        {/* Trend chart */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 lg:col-span-2">
          <h2 className="text-sm font-bold text-gray-900 mb-1">Competency Trend <span className="font-normal text-gray-400 text-xs">(6 months)</span></h2>
          <div className="flex items-center gap-3 mb-2 text-[9px]">
            <span className="flex items-center gap-1 text-gray-500"><span className="w-2 h-2 rounded-full bg-purple-500" />Achievement</span>
            <span className="flex items-center gap-1 text-gray-500"><span className="w-2 h-2 rounded-full bg-teal-500" />Coverage</span>
            <span className="flex items-center gap-1 text-gray-500"><span className="w-2 h-2 rounded-full bg-indigo-500" />Mastery</span>
          </div>
          {!hasSeries ? <p className="text-xs text-gray-400 py-8 text-center">Not enough monthly history to chart.</p> : (
            <svg viewBox="0 0 320 120" className="w-full">
              {[0, 50, 100].map(y => <line key={y} x1="22" x2="314" y1={98 - y * 0.8} y2={98 - y * 0.8} stroke="#f3f4f6" strokeWidth="1" />)}
              {[0, 50, 100].map(y => <text key={y} x="18" y={101 - y * 0.8} fontSize="7" fill="#c4c4cc" textAnchor="end">{y}</text>)}
              {([["achievement", "#9333ea"], ["coverage", "#14b8a6"], ["mastery", "#6366f1"]] as const).map(([key, col]) => {
                const pts = d.monthly.map((m, i) => ({ x: 40 + i * 48, y: m[key] !== null ? 98 - (m[key] as number) * 0.8 : null }));
                const line = pts.filter(p => p.y !== null) as { x: number; y: number }[];
                return <g key={key}>{line.length > 1 && <polyline fill="none" stroke={col} strokeWidth="1.5" points={line.map(p => `${p.x},${p.y}`).join(" ")} />}{line.map(p => <circle key={p.x} cx={p.x} cy={p.y} r="2.5" fill={col} />)}</g>;
              })}
              {d.monthly.map((m, i) => <text key={i} x={40 + i * 48} y="112" fontSize="7" fill="#9ca3af" textAnchor="middle">{m.label}</text>)}
            </svg>
          )}
        </div>

        {/* Change-point detection */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-1">Change-Point Detection</h2>
          <p className="text-[9px] text-gray-400 mb-3">Highlights performance shifts after key events.</p>
          <div className="flex flex-col gap-1.5">
            {CHANGE_SOON.map(e => <div key={e} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"><span className="text-[11px] text-gray-400">{e}</span><span className="text-[8px] font-bold uppercase text-gray-300">soon</span></div>)}
          </div>
          <p className="text-[9px] text-gray-300 mt-2">Needs event-tagged history (curriculum/policy/framework changes).</p>
        </div>
      </div>

      {/* AI insights */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">Trend Insights</h2><span className="ml-auto text-[8px] font-bold uppercase text-gray-300">rule-derived</span></div>
        <ul className="space-y-1.5">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>
      </div>
    </div>
  );
}
