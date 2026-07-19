import { requireEducatorAccess } from "@/lib/educator-access";
import { loadCompetencyAnalytics } from "@/lib/competency-analytics";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import CompetencyNav from "../CompetencyNav";

// Module 3 — Competency Heatmaps. Learner × domain proficiency, colour-coded
// from live scores. Additional row/column pivots are being wired.

export const dynamic = "force-dynamic";
const VIEWS = ["By Cohort", "By Department", "By Domain", "By Program", "By Role", "By Assessment Method"];
const cellColor = (v: number | null) => v === null ? "#f3f4f6" : v >= 6 ? "#15803d" : v >= 5 ? "#22c55e" : v >= 4 ? "#86efac" : v >= 3 ? "#fbbf24" : "#f87171";
const LEGEND = [["Mastered", "#15803d"], ["Proficient", "#22c55e"], ["Developing", "#fbbf24"], ["Below standard", "#f87171"], ["Not assessed", "#f3f4f6"]] as const;

export default async function Heatmaps() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadCompetencyAnalytics(admin, hospitalId ?? "")).heatmap;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "High-Performing", value: String(C.highPerforming) },
    { label: "Critical Weak", value: String(C.criticalWeak), alert: C.criticalWeak > 0 },
    { label: "Unassessed", value: String(C.unassessed) },
    { label: "Expiring", value: String(C.expiring) },
    { label: "Risk Index", value: C.riskIndex !== null ? `${C.riskIndex}%` : "—" },
  ];

  return (
    <div className="max-w-[1200px]">
      <CompetencyNav active="heatmaps" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-5" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_260px] gap-4 items-start">
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Heatmap — Learners × Domains</h2>
          {d.domains.length === 0 || d.rows.length === 0 ? (
            <p className="text-xs text-gray-400 py-8 text-center">No competency scores to visualise yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <div className="grid gap-1 min-w-max" style={{ gridTemplateColumns: `120px repeat(${d.domains.length}, 28px)` }}>
                <span />
                {d.domains.map(dm => <span key={dm} className="text-[7px] text-gray-400 text-center leading-tight self-end pb-1" title={dm}>{dm.replace(/^Domain \d+: /, "").slice(0, 8)}</span>)}
                {d.rows.map(r => (
                  <div key={r.learner} className="contents">
                    <span className="text-[10px] text-gray-600 truncate pr-1 self-center" title={r.learner}>{r.learner}</span>
                    {r.cells.map((v, i) => <span key={i} className="h-6 rounded flex items-center justify-center text-[8px] font-bold text-white" style={{ background: cellColor(v) }} title={`${r.learner} · ${d.domains[i]}: ${v === null ? "not assessed" : v + "/6"}`}>{v ?? ""}</span>)}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-3 mt-3">
            {LEGEND.map(([l, c]) => <span key={l} className="flex items-center gap-1 text-[9px] text-gray-500"><span className="w-2.5 h-2.5 rounded" style={{ background: c }} />{l}</span>)}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-2">Heatmap Views</h2>
            <div className="flex flex-col gap-1">
              {VIEWS.map(v => <span key={v} className="flex items-center justify-between text-[11px] rounded-lg border border-gray-100 px-2.5 py-1.5 text-gray-400"><span>{v}</span><span className="text-[8px] font-bold uppercase text-gray-300">soon</span></span>)}
            </div>
            <p className="text-[9px] text-gray-300 mt-2">Learner × domain is live; other pivots are being wired.</p>
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">Heatmap Insights</h2></div>
            {d.insights.length === 0 ? <p className="text-xs text-gray-400">No concerning clusters detected. ✅</p> : <ul className="space-y-1.5">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>}
          </div>
        </div>
      </div>
    </div>
  );
}
