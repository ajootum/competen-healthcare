import { requireEducatorAccess } from "@/lib/educator-access";
import { loadCurriculumAnalytics } from "@/lib/curriculum-analytics";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import CurriculumNav from "../CurriculumNav";

// Module 3 — Learning Outcomes Analytics. No dedicated learning_outcomes store
// exists, so domains stand in as outcome proxies (achievement from live scores).
// True outcome→assessment mapping and evidence quality are shown honestly.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";
const STATUS_CLS: Record<string, string> = { Achieved: "bg-green-50 text-green-600", Partial: "bg-amber-50 text-amber-600", "Not Achieved": "bg-red-50 text-red-600", "Not assessed": "bg-gray-100 text-gray-400" };

export default async function Outcomes() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadCurriculumAnalytics(admin, hospitalId ?? "")).outcomes;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Outcomes Achieved", value: String(C.achieved) },
    { label: "Partially Achieved", value: String(C.partial) },
    { label: "Not Achieved", value: String(C.notAchieved), alert: C.notAchieved > 0 },
    { label: "Avg. Attainment", value: pct(C.avgAttainment) },
    { label: "Assessment Rate", value: pct(C.assessmentRate) },
    { label: "Evidence Quality", value: "—", sub: "not tracked" },
  ];

  return (
    <div className="max-w-[1200px]">
      <CurriculumNav active="outcomes" />
      <div className="mb-2"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" /></div>
      <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-5">ℹ️ No dedicated learning-outcomes store exists yet — competency <b>domains</b> are used as outcome proxies, with achievement computed from live scores.</p>

      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <h2 className="text-sm font-bold text-gray-900 mb-3">Learning Outcomes Performance <span className="font-normal text-gray-400 text-xs">(by domain proxy)</span></h2>
        {d.table.length === 0 ? <p className="text-xs text-gray-400">No outcomes to report yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left border-collapse">
            <thead><tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">{["Outcome (Domain)", "Competencies", "Attainment", "Assessment", "Status"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
            <tbody>{d.table.map(o => (
              <tr key={o.id} className="border-b border-gray-50 text-[11px]">
                <td className="py-2 pr-3 font-semibold text-gray-800 max-w-[260px] truncate" title={o.name}>{o.name}</td>
                <td className="py-2 pr-3 text-gray-600">{o.competencies}</td>
                <td className="py-2 pr-3">
                  <span className="flex items-center gap-2"><span className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden inline-block"><span className={`block h-full rounded-full ${(o.achievement ?? 0) >= 70 ? "bg-green-500" : (o.achievement ?? 0) >= 40 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${o.achievement ?? 0}%` }} /></span><span className="text-gray-700 font-semibold">{pct(o.achievement)}</span></span>
                </td>
                <td className="py-2 pr-3 text-gray-600">{pct(o.assessment)}</td>
                <td className="py-2 pr-3"><span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${STATUS_CLS[o.status]}`}>{o.status}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 mt-4">
        <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2></div>
        <ul className="space-y-1.5">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>
        <p className="text-[9px] text-gray-300 mt-2">Outcome→assessment mapping, evidence quality per outcome and clinical-performance linkage need a learning-outcomes store — on the roadmap.</p>
      </div>
    </div>
  );
}
