import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAssessmentAnalytics } from "@/lib/assessment-analytics";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import AssessmentNav from "../AssessmentNav";

// Module 5 — Difficulty Analysis. Difficulty mix from author-assigned labels
// and by category. True proportion-correct difficulty needs more attempts.

export const dynamic = "force-dynamic";

export default async function Difficulty() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadAssessmentAnalytics(admin, hospitalId ?? "")).difficulty;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Avg. Difficulty Index", value: C.avgIndex !== null ? C.avgIndex.toFixed(2) : "—", sub: "facility (0–1)" },
    { label: "Easy Items", value: String(C.easy) },
    { label: "Moderate Items", value: String(C.moderate) },
    { label: "Difficult Items", value: String(C.difficult) },
    { label: "Very Difficult", value: String(C.veryDifficult), sub: "not labelled" },
  ];
  const distTotal = d.distribution.reduce((s, x) => s + x.n, 0);
  const Circ = 2 * Math.PI * 40;
  const arcPcts = d.distribution.map(x => distTotal ? (x.n / distTotal) * 100 : 0);
  const arcs = d.distribution.map((x, i) => ({ ...x, off: arcPcts.slice(0, i).reduce((s, p) => s + p, 0), p: arcPcts[i] }));

  return (
    <div className="max-w-[1200px]">
      <AssessmentNav active="difficulty" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-5" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-4 items-start">
        {/* Distribution donut */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Difficulty Distribution</h2>
          {distTotal === 0 ? <p className="text-xs text-gray-400 py-6 text-center">No questions.</p> : (
            <div className="flex items-center gap-4">
              <div className="relative w-24 shrink-0"><svg viewBox="0 0 100 100" className="w-full -rotate-90"><circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="12" />{arcs.filter(a => a.p > 0).map(a => <circle key={a.label} cx="50" cy="50" r="40" fill="none" stroke={a.color} strokeWidth="12" strokeDasharray={`${(a.p / 100) * Circ} ${Circ}`} strokeDashoffset={-(a.off / 100) * Circ} />)}</svg><div className="absolute inset-0 flex flex-col items-center justify-center"><p className="text-lg font-extrabold text-gray-900">{distTotal}</p><p className="text-[8px] text-gray-400">items</p></div></div>
              <div className="flex flex-col gap-1 flex-1">{d.distribution.map(x => <div key={x.label} className="flex items-center gap-2 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: x.color }} /><span className="text-gray-500 flex-1">{x.label}</span><span className="font-bold text-gray-800">{x.n}</span></div>)}</div>
            </div>
          )}
        </div>

        {/* Difficulty by category */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Difficulty by Category</h2>
          {d.byCategory.length === 0 ? <p className="text-xs text-gray-400">No categorised questions.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-left border-collapse">
              <thead><tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">{["Category", "Easy", "Moderate", "Difficult", "Mix"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
              <tbody>{d.byCategory.map(c => { const tot = c.easy + c.medium + c.hard; return (
                <tr key={c.label} className="border-b border-gray-50 text-[11px]">
                  <td className="py-2 pr-3 font-semibold text-gray-800">{c.label}</td>
                  <td className="py-2 pr-3 text-green-600">{c.easy}</td>
                  <td className="py-2 pr-3 text-amber-600">{c.medium}</td>
                  <td className="py-2 pr-3 text-red-600">{c.hard}</td>
                  <td className="py-2 pr-3 w-40">
                    <span className="flex h-2 rounded-full overflow-hidden bg-gray-100">
                      {tot > 0 && <><span className="bg-green-500" style={{ width: `${(c.easy / tot) * 100}%` }} /><span className="bg-amber-400" style={{ width: `${(c.medium / tot) * 100}%` }} /><span className="bg-red-400" style={{ width: `${(c.hard / tot) * 100}%` }} /></>}
                    </span>
                  </td>
                </tr>
              ); })}</tbody>
            </table></div>
          )}
          <p className="text-[9px] text-gray-300 mt-2">Difficulty labels are author-assigned. True item difficulty (proportion-correct) and difficulty-by-CPU need more learner attempts.</p>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 mt-4">
        <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2><span className="ml-auto text-[8px] font-bold uppercase text-gray-300">rule-derived</span></div>
        <ul className="space-y-1.5">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>
      </div>
    </div>
  );
}
