import { requireEducatorAccess } from "@/lib/educator-access";
import { loadCompetencyAnalytics } from "@/lib/competency-analytics";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import CompetencyNav from "../CompetencyNav";

// Module 2 — Competency Achievement. Attainment by proficiency, learner and
// assessment method, with the assignment→validated→achieved journey.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";
const RISK_CLS: Record<string, string> = { "At Risk": "bg-red-50 text-red-600", "On Track": "bg-blue-50 text-blue-600", Excellent: "bg-green-50 text-green-600" };

export default async function Achievement() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadCompetencyAnalytics(admin, hospitalId ?? "")).achievement;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Overall Achievement", value: pct(C.overall) },
    { label: "Achieved", value: String(C.achieved) },
    { label: "In Progress", value: String(C.inProgress) },
    { label: "Not Started", value: String(C.notStarted) },
    { label: "Reassessment Due", value: String(C.reassessDue), alert: C.reassessDue > 0 },
    { label: "Avg. Proficiency", value: C.avgProficiency !== null ? `${C.avgProficiency}/5` : "—" },
    { label: "First-Attempt", value: pct(C.firstAttempt), sub: "not tracked" },
    { label: "Time to Comp.", value: C.timeToComp !== null ? `${C.timeToComp}d` : "—", sub: "not tracked" },
  ];
  const profTotal = d.byProficiency.reduce((s, x) => s + x.n, 0);
  const Circ = 2 * Math.PI * 40;
  const arcPcts = d.byProficiency.map(x => profTotal ? (x.n / profTotal) * 100 : 0);
  const arcs = d.byProficiency.map((x, i) => ({ ...x, off: arcPcts.slice(0, i).reduce((s, p) => s + p, 0), p: arcPcts[i] }));
  const jMax = d.journey[0]?.n ?? 1;

  return (
    <div className="max-w-[1200px]">
      <CompetencyNav active="achievement" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-4 xl:grid-cols-8" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 items-start">
        {/* By proficiency donut */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Achievement by Proficiency</h2>
          {profTotal === 0 ? <p className="text-xs text-gray-400 py-6 text-center">No achieved competencies yet.</p> : (
            <div className="flex items-center gap-4">
              <div className="relative w-24 shrink-0">
                <svg viewBox="0 0 100 100" className="w-full -rotate-90">
                  <circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="12" />
                  {arcs.filter(a => a.p > 0).map(a => <circle key={a.label} cx="50" cy="50" r="40" fill="none" stroke={a.color} strokeWidth="12" strokeDasharray={`${(a.p / 100) * Circ} ${Circ}`} strokeDashoffset={-(a.off / 100) * Circ} />)}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center"><p className="text-lg font-extrabold text-gray-900">{profTotal}</p><p className="text-[8px] text-gray-400">achieved</p></div>
              </div>
              <div className="flex flex-col gap-1 flex-1">
                {d.byProficiency.map(x => <div key={x.label} className="flex items-center gap-2 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: x.color }} /><span className="text-gray-500 flex-1">{x.label}</span><span className="font-bold text-gray-800">{x.n}</span></div>)}
              </div>
            </div>
          )}
        </div>

        {/* By method */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Achievement by Method</h2>
          {d.byMethod.length === 0 ? <p className="text-xs text-gray-400 py-6 text-center">No assessment method data yet.</p> : (
            <div className="flex items-end justify-around gap-2 h-32">
              {d.byMethod.map(m => (
                <div key={m.label} className="flex flex-col items-center gap-1 flex-1">
                  <span className="text-[10px] font-bold text-gray-700">{pct(m.pct)}</span>
                  <div className="w-full bg-blue-400 rounded-t" style={{ height: `${((m.pct ?? 0) / 100) * 90}px` }} />
                  <span className="text-[8px] text-gray-400 text-center leading-tight">{m.label}<br />({m.n})</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[9px] text-gray-300 mt-1">Pass rate by recorded assessment method.</p>
        </div>

        {/* Journey */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Competency Journey</h2>
          <div className="flex flex-col gap-1">
            {d.journey.map((s, i) => (
              <div key={s.label} className="flex items-center gap-2">
                <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden"><div className="h-full rounded flex items-center px-2 text-[9px] font-bold text-white" style={{ width: `${jMax ? Math.max(16, (s.n / jMax) * 100) : 0}%`, background: `hsl(${210 - i * 4} 65% ${58 + i * 3}%)` }}>{s.n}</div></div>
                <span className="text-[9px] text-gray-500 w-28 shrink-0">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* By learner table */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-4">
        <h2 className="text-sm font-bold text-gray-900 mb-3">Achievement by Learner</h2>
        {d.byLearner.length === 0 ? <p className="text-xs text-gray-400">No learners yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead><tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">{["Learner", "Program", "Assigned", "Achieved", "% Achieved", "Proficiency", "Overdue", "Status"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
              <tbody>
                {d.byLearner.map(l => (
                  <tr key={l.id} className="border-b border-gray-50 text-[11px]">
                    <td className="py-2 pr-3 font-semibold text-gray-800">{l.name}</td>
                    <td className="py-2 pr-3 text-gray-500">{l.program}</td>
                    <td className="py-2 pr-3 text-gray-600">{l.assigned}</td>
                    <td className="py-2 pr-3 text-gray-600">{l.achieved}</td>
                    <td className="py-2 pr-3 text-gray-700 font-semibold">{l.pctAchieved}%</td>
                    <td className="py-2 pr-3 text-gray-600">{l.proficiency !== null ? `${l.proficiency}/6` : "—"}</td>
                    <td className="py-2 pr-3 text-gray-600">{l.overdue}</td>
                    <td className="py-2 pr-3"><span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${RISK_CLS[l.status]}`}>{l.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* AI insights */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2><span className="ml-auto text-[8px] font-bold uppercase text-gray-300">rule-derived</span></div>
        {d.insights.length === 0 ? <p className="text-xs text-gray-400">No achievement issues detected. ✅</p> : <ul className="space-y-1.5">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>}
        <p className="text-[9px] text-gray-300 mt-2">First-attempt rate, time-to-competency and assessor-consistency analysis need attempt-level history — not yet tracked.</p>
      </div>
    </div>
  );
}
