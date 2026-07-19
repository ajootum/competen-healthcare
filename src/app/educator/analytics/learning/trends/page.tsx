import { requireEducatorAccess } from "@/lib/educator-access";
import { loadLearningAnalytics } from "@/lib/learning-analytics";
import type { Trend } from "@/lib/analytics-data";
import LearningNav from "../LearningNav";

// Module 5 — Trend Analytics (Learning Analytics Workspace §Module 5).
// Institutional time-series. Historical trends are live; AI forecasting and
// seasonality need longer history/models — a naive projection is shown and
// clearly labelled, the rest as soon.

export const dynamic = "force-dynamic";

const EXPLORER = ["Program", "Course", "Department", "Competency", "CPU", "Faculty", "Campus", "Country"];
const FORECAST_SOON = ["Risk projection", "Expected certification", "Learning demand", "AI prediction"];

function chip(t: Trend) {
  if (!t) return <span className="text-[10px] text-gray-300">— no trend</span>;
  return <span className={`text-[11px] font-bold ${t.dir === "up" ? "text-green-600" : "text-red-500"}`}>{t.dir === "up" ? "▲" : "▼"} {t.pct}%</span>;
}
// Naive one-step projection: last value + average recent delta. Labelled, not AI.
function project(series: (number | null)[]): number | null {
  const v = series.filter((x): x is number => x !== null);
  if (v.length < 2) return null;
  const deltas = v.slice(1).map((x, i) => x - v[i]);
  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return Math.max(0, Math.round(v[v.length - 1] + avgDelta));
}

export default async function TrendAnalytics() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadLearningAnalytics(admin, hospitalId ?? "")).trends;
  const last = d.monthly[d.monthly.length - 1];

  const cards = [
    { label: "Monthly Completions", value: String(last?.completion ?? 0), trend: d.cards.completion },
    { label: "Competency", value: last?.competency !== null && last?.competency !== undefined ? `${last.competency}%` : "—", trend: d.cards.competency },
    { label: "Engagement", value: last?.engagement !== null && last?.engagement !== undefined ? `${last.engagement}%` : "—", trend: d.cards.engagement },
    { label: "Certifications", value: String(last?.certifications ?? 0), trend: d.cards.certifications },
    { label: "Learning Hours", value: "—", trend: null as Trend, soon: true },
  ];

  const compMax = 100;
  const projComp = project(d.monthly.map(m => m.competency));
  const projEng = project(d.monthly.map(m => m.engagement));
  const hasSeries = d.monthly.some(m => m.competency !== null || m.engagement !== null);

  return (
    <div className="max-w-[1200px]">
      <LearningNav active="trends" />

      {/* Trend cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
        {cards.map(c => (
          <div key={c.label} className="bg-white border border-gray-100 rounded-2xl p-4">
            <p className="text-[11px] font-semibold text-gray-500">{c.label}</p>
            <p className={`text-2xl font-extrabold leading-tight mt-1 ${c.soon ? "text-gray-300" : "text-gray-900"}`}>{c.value}</p>
            <div className="mt-1">{c.soon ? <span className="text-[8px] font-bold uppercase text-gray-300">no store</span> : chip(c.trend)}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 items-start">
        {/* Performance trend */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 lg:col-span-2">
          <h2 className="text-sm font-bold text-gray-900 mb-1">Performance Trend <span className="font-normal text-gray-400 text-xs">(6 months)</span></h2>
          <div className="flex items-center gap-3 mb-2 text-[9px]">
            <span className="flex items-center gap-1 text-gray-500"><span className="w-2 h-2 rounded-full bg-purple-500" />Competency %</span>
            <span className="flex items-center gap-1 text-gray-500"><span className="w-2 h-2 rounded-full bg-green-500" />Engagement %</span>
          </div>
          {!hasSeries ? (
            <p className="text-xs text-gray-400 py-8 text-center">Not enough monthly history to chart yet.</p>
          ) : (
            <svg viewBox="0 0 320 120" className="w-full">
              {[0, 50, 100].map(y => <line key={y} x1="22" x2="314" y1={98 - y * 0.8} y2={98 - y * 0.8} stroke="#f3f4f6" strokeWidth="1" />)}
              {[0, 50, 100].map(y => <text key={y} x="18" y={101 - y * 0.8} fontSize="7" fill="#c4c4cc" textAnchor="end">{y}</text>)}
              {([["competency", "#9333ea"], ["engagement", "#10b981"]] as const).map(([key, col]) => {
                const pts = d.monthly.map((m, i) => ({ x: 40 + i * 48, y: m[key] !== null ? 98 - (m[key] as number) / compMax * 80 : null }));
                const line = pts.filter(p => p.y !== null) as { x: number; y: number }[];
                return <g key={key}>
                  {line.length > 1 && <polyline fill="none" stroke={col} strokeWidth="1.5" points={line.map(p => `${p.x},${p.y}`).join(" ")} />}
                  {line.map(p => <circle key={p.x} cx={p.x} cy={p.y} r="2.5" fill={col} />)}
                </g>;
              })}
              {d.monthly.map((m, i) => <text key={i} x={40 + i * 48} y="112" fontSize="7" fill="#9ca3af" textAnchor="middle">{m.label}</text>)}
            </svg>
          )}
        </div>

        {/* Forecasting (naive) */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-1">Forecasting</h2>
          <p className="text-[9px] text-gray-400 mb-3">Naive projection (recent trend), not an AI model.</p>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between rounded-lg bg-purple-50/60 border border-purple-100 px-3 py-2">
              <span className="text-[11px] text-gray-600">Projected competency</span>
              <span className="text-sm font-bold text-purple-700">{projComp !== null ? `${Math.min(100, projComp)}%` : "—"}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-green-50/60 border border-green-100 px-3 py-2">
              <span className="text-[11px] text-gray-600">Projected engagement</span>
              <span className="text-sm font-bold text-green-700">{projEng !== null ? `${Math.min(100, projEng)}%` : "—"}</span>
            </div>
            {FORECAST_SOON.map(f => (
              <div key={f} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                <span className="text-[11px] text-gray-400">{f}</span><span className="text-[8px] font-bold uppercase text-gray-300">soon</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Trend explorer */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <h2 className="text-sm font-bold text-gray-900 mb-1">Trend Explorer</h2>
        <p className="text-[10px] text-gray-400 mb-3">Currently showing: all learners · competency &amp; engagement over 6 months. Dimension drill-down is being wired.</p>
        <div className="flex flex-wrap gap-1.5">
          {EXPLORER.map(e => (
            <span key={e} className="text-[11px] text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5 select-none">{e} <span className="text-[8px] font-bold uppercase">soon</span></span>
          ))}
        </div>
        <p className="text-[9px] text-gray-300 mt-3">Rolling averages, seasonality and benchmark lines need longer history than currently recorded.</p>
      </div>
    </div>
  );
}
