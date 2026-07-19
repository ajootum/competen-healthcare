import { requireEducatorAccess } from "@/lib/educator-access";
import { loadCompetencyAnalytics } from "@/lib/competency-analytics";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import CompetencyNav from "../CompetencyNav";

// Module 6 — Skill Mastery. Procedural/behavioural mastery from the workplace
// logbook (supervision level, recency, verification). Skill-decay windows need
// per-skill validity config — shown honestly.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";
const STATUS_CLS: Record<string, string> = { verified: "bg-green-50 text-green-600", pending: "bg-amber-50 text-amber-600", escalated: "bg-red-50 text-red-600" };

export default async function Skills() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadCompetencyAnalytics(admin, hospitalId ?? "")).skills;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Total Skills", value: String(C.total) },
    { label: "Logged", value: String(C.logged) },
    { label: "Independent", value: String(C.independent) },
    { label: "Supervised", value: String(C.supervised) },
    { label: "Verified", value: String(C.verified) },
    { label: "Pending", value: String(C.pending), alert: C.pending > 0 },
    { label: "Independent Rate", value: pct(C.independentRate) },
    { label: "Avg. Attempts", value: "—", sub: "not tracked" },
  ];
  const distMax = Math.max(1, ...d.distribution.map(x => x.n));

  return (
    <div className="max-w-[1200px]">
      <CompetencyNav active="skills" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-4 xl:grid-cols-8" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
        {/* Skill mastery table */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Skill Mastery Overview</h2>
          {d.table.length === 0 ? <p className="text-xs text-gray-400">No skills logged in the workplace logbook yet — {C.total} skills defined in the library.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead><tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">{["Skill", "Competency", "Learner", "Supervision", "Last Performed", "Status"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
                <tbody>
                  {d.table.map(s => (
                    <tr key={s.id} className="border-b border-gray-50 text-[11px]">
                      <td className="py-2 pr-3 font-semibold text-gray-800 max-w-[200px] truncate" title={s.skill}>{s.skill}</td>
                      <td className="py-2 pr-3 text-gray-500 max-w-[140px] truncate">{s.competency}</td>
                      <td className="py-2 pr-3 text-gray-600">{s.learner}</td>
                      <td className="py-2 pr-3 text-gray-600">{s.supervision}</td>
                      <td className="py-2 pr-3 text-gray-400">{s.lastPerformed ?? "—"}</td>
                      <td className="py-2 pr-3"><span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${STATUS_CLS[s.status] ?? "bg-gray-100 text-gray-500"}`}>{s.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {/* Mastery distribution */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-3">Mastery Level Distribution</h2>
            {C.logged === 0 ? <p className="text-xs text-gray-400">No logged skills yet.</p> : (
              <div className="flex items-end justify-around gap-2 h-28">
                {d.distribution.map(x => (
                  <div key={x.label} className="flex flex-col items-center gap-1 flex-1">
                    <span className="text-[10px] font-bold text-gray-700">{x.n}</span>
                    <div className="w-full bg-indigo-400 rounded-t" style={{ height: `${(x.n / distMax) * 80}px` }} />
                    <span className="text-[8px] text-gray-400 text-center leading-tight">{x.label}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[9px] text-gray-300 mt-2">Observe → Assist → Supervised → Independent (from logbook supervision level).</p>
          </div>
          {/* AI insights */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">Skill Insights</h2></div>
            {d.insights.length === 0 ? <p className="text-xs text-gray-400">No skill concerns detected. ✅</p> : <ul className="space-y-1.5">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>}
            <p className="text-[9px] text-gray-300 mt-2">Skill-decay alerts &amp; revalidation windows need per-skill validity config — on the roadmap.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
