import { requireEducatorAccess } from "@/lib/educator-access";
import { loadCompetencyAnalytics } from "@/lib/competency-analytics";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import CompetencyNav from "../CompetencyNav";

// Module 5 — Domain Performance. Scorecards and comparison across clinical and
// professional domains from live scores.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";
const shortDom = (s: string) => s.replace(/^Domain \d+: /, "");

export default async function Domains() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadCompetencyAnalytics(admin, hospitalId ?? "")).domains;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Top Domain", value: C.highest ? `${C.highest.pct}%` : "—", sub: C.highest ? shortDom(C.highest.name) : "—" },
    { label: "Lowest Domain", value: C.lowest ? `${C.lowest.pct}%` : "—", sub: C.lowest ? shortDom(C.lowest.name) : "—", alert: !!C.lowest },
    { label: "Avg. Domain Score", value: pct(C.avgScore) },
    { label: "Critical Risks", value: String(C.criticalRisks), alert: C.criticalRisks > 0 },
    { label: "Readiness Index", value: pct(C.readiness) },
    { label: "Coverage", value: pct(C.coverage) },
  ];

  // Radar geometry
  const N = d.radar.length; const cx = 120, cy = 115, R = 88;
  const axis = (i: number) => { const a = (-90 + (i * 360) / Math.max(1, N)) * Math.PI / 180; return { ax: Math.cos(a), ay: Math.sin(a) }; };
  const poly = d.radar.map((r, i) => { const { ax, ay } = axis(i); const rad = (r.value / 100) * R; return `${cx + ax * rad},${cy + ay * rad}`; }).join(" ");

  return (
    <div className="max-w-[1200px]">
      <CompetencyNav active="domains" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
        {/* Scorecards */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Domain Scorecards</h2>
          {d.scorecards.length === 0 ? <p className="text-xs text-gray-400">No domains with competencies yet.</p> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {d.scorecards.map(dm => (
                <div key={dm.id} className="border border-gray-100 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1"><p className="text-[11px] font-bold text-gray-800 truncate" title={dm.name}>{shortDom(dm.name)}</p>{dm.trend && <span className={`text-[9px] font-bold ${dm.trend.dir === "up" ? "text-green-600" : "text-red-500"}`}>{dm.trend.dir === "up" ? "▲" : "▼"}{dm.trend.pct}%</span>}</div>
                  <div className="flex items-center gap-2 mb-1"><div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${(dm.avgScore ?? 0) >= 70 ? "bg-green-500" : (dm.avgScore ?? 0) >= 50 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${dm.avgScore ?? 0}%` }} /></div><span className="text-[10px] font-bold text-gray-700 w-9 text-right">{pct(dm.avgScore)}</span></div>
                  <div className="flex items-center gap-3 text-[9px] text-gray-400"><span>Cov {dm.coverage}%</span><span>Ach {pct(dm.achievement)}</span><span>Gaps {dm.gaps}</span>{dm.atRisk > 0 && <span className="text-red-500">{dm.atRisk} at-risk</span>}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {/* Radar */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-2">Domain Comparison</h2>
            {N === 0 ? <p className="text-xs text-gray-400 py-6 text-center">No domain scores to chart.</p> : (
              <svg viewBox="0 0 240 230" className="w-full">
                {[0.33, 0.66, 1].map(f => <circle key={f} cx={cx} cy={cy} r={R * f} fill="none" stroke="#f3f4f6" strokeWidth="1" />)}
                {d.radar.map((r, i) => { const { ax, ay } = axis(i); return <g key={r.domain}><line x1={cx} y1={cy} x2={cx + ax * R} y2={cy + ay * R} stroke="#f3f4f6" strokeWidth="1" /><text x={cx + ax * (R + 12)} y={cy + ay * (R + 12)} fontSize="7" fill="#9ca3af" textAnchor="middle" dominantBaseline="middle">{shortDom(r.domain).slice(0, 9)}</text></g>; })}
                <polygon points={poly} fill="#8b5cf6" fillOpacity="0.15" stroke="#8b5cf6" strokeWidth="1.5" />
              </svg>
            )}
            <p className="text-[9px] text-gray-300">Average score by domain.</p>
          </div>
          {/* AI insights */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">Domain Insights</h2></div>
            {d.insights.length === 0 ? <p className="text-xs text-gray-400">No domain concerns detected. ✅</p> : <ul className="space-y-1.5">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>}
            <p className="text-[9px] text-gray-300 mt-2">Facility benchmarking &amp; CPU drill-down need cross-tenant history — on the roadmap.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
