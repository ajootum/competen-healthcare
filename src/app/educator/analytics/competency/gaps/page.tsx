import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadCompetencyAnalytics } from "@/lib/competency-analytics";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import CompetencyNav from "../CompetencyNav";

// Module 4 — Competency Gaps. Register, categories and prioritisation from live
// required-vs-demonstrated levels. Closure time & intervention workflow need a
// gap store — shown honestly.

export const dynamic = "force-dynamic";
const RISK_CLS: Record<string, string> = { High: "bg-red-50 text-red-600", Medium: "bg-amber-50 text-amber-600", Low: "bg-gray-100 text-gray-500" };
const QUICK = [["Create Improvement Plan", "/educator/plans"], ["Assign Remediation", "/educator/interventions"], ["Schedule Reassessment", "/educator/meetings"], ["Notify Learners", "/educator/communication"]];

export default async function Gaps() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadCompetencyAnalytics(admin, hospitalId ?? "")).gaps;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Total Gaps", value: String(C.total) },
    { label: "Critical Gaps", value: String(C.critical), alert: C.critical > 0 },
    { label: "High-Risk Learners", value: String(C.highRiskLearners) },
    { label: "High-Risk Depts", value: String(C.highRiskDepts) },
    { label: "Overdue", value: String(C.overdue) },
    { label: "Avg. Closure Time", value: "—", sub: "not tracked" },
  ];
  const catTotal = d.categories.reduce((s, x) => s + x.n, 0);
  const Circ = 2 * Math.PI * 40;
  const arcPcts = d.categories.map(x => catTotal ? (x.n / catTotal) * 100 : 0);
  const arcs = d.categories.map((x, i) => ({ ...x, off: arcPcts.slice(0, i).reduce((s, p) => s + p, 0), p: arcPcts[i] }));
  const maxLearners = Math.max(1, ...d.priority.map(p => p.learners));

  return (
    <div className="max-w-[1200px]">
      <CompetencyNav active="gaps" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" /></div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-4">
        <h2 className="text-sm font-bold text-gray-900 mb-3">Gap Register</h2>
        {d.register.length === 0 ? <p className="text-xs text-gray-400">No competency gaps detected. ✅</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead><tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">{["Competency", "Required", "Current", "Gap", "Learners", "Category", "Risk", "Status"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
              <tbody>
                {d.register.map(g => (
                  <tr key={g.id} className="border-b border-gray-50 text-[11px]">
                    <td className="py-2 pr-3 font-semibold text-gray-800 max-w-[220px] truncate" title={g.name}>{g.name}</td>
                    <td className="py-2 pr-3 text-gray-600">{g.required}</td>
                    <td className="py-2 pr-3 text-gray-600">{g.current ?? "—"}</td>
                    <td className="py-2 pr-3 font-bold text-gray-800">{g.gap}</td>
                    <td className="py-2 pr-3 text-gray-600">{g.learners}</td>
                    <td className="py-2 pr-3 text-gray-500">{g.category}</td>
                    <td className="py-2 pr-3"><span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${RISK_CLS[g.risk]}`}>{g.risk}</span></td>
                    <td className="py-2 pr-3 text-gray-500">{g.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[9px] text-gray-300 mt-2">Required level from competency risk tier (high = Advanced, standard = Proficient). Current = mean recorded score.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* Categories donut */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Gap by Category</h2>
          {catTotal === 0 ? <p className="text-xs text-gray-400 py-6 text-center">No gaps.</p> : (
            <div className="flex items-center gap-4">
              <div className="relative w-24 shrink-0"><svg viewBox="0 0 100 100" className="w-full -rotate-90"><circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="12" />{arcs.filter(a => a.p > 0).map(a => <circle key={a.label} cx="50" cy="50" r="40" fill="none" stroke={a.color} strokeWidth="12" strokeDasharray={`${(a.p / 100) * Circ} ${Circ}`} strokeDashoffset={-(a.off / 100) * Circ} />)}</svg><div className="absolute inset-0 flex items-center justify-center"><p className="text-lg font-extrabold text-gray-900">{catTotal}</p></div></div>
              <div className="flex flex-col gap-1 flex-1">{d.categories.map(x => <div key={x.label} className="flex items-center gap-2 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: x.color }} /><span className="text-gray-500 flex-1 truncate">{x.label}</span><span className="font-bold text-gray-800">{x.n}</span></div>)}</div>
            </div>
          )}
        </div>

        {/* Prioritisation matrix */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-2">Gap Prioritisation</h2>
          {d.priority.length === 0 ? <p className="text-xs text-gray-400 py-6 text-center">No gaps to prioritise.</p> : (
            <svg viewBox="0 0 200 130" className="w-full">
              <line x1="24" y1="110" x2="196" y2="110" stroke="#e5e7eb" strokeWidth="1" /><line x1="24" y1="10" x2="24" y2="110" stroke="#e5e7eb" strokeWidth="1" />
              <text x="110" y="126" fontSize="7" fill="#9ca3af" textAnchor="middle">Learners affected →</text>
              <text x="10" y="60" fontSize="7" fill="#9ca3af" textAnchor="middle" transform="rotate(-90 10 60)">Risk →</text>
              {d.priority.map((p, i) => <circle key={i} cx={24 + (p.learners / maxLearners) * 168} cy={110 - (p.risk / 3) * 96} r={3 + p.severity * 1.5} fill={p.risk >= 3 ? "#ef4444" : p.risk >= 2 ? "#f59e0b" : "#10b981"} fillOpacity="0.6"><title>{p.name}</title></circle>)}
            </svg>
          )}
          <p className="text-[9px] text-gray-300 mt-1">Bubble size = gap severity.</p>
        </div>

        {/* AI recs */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Recommendations</h2><span className="ml-auto text-[8px] font-bold uppercase text-gray-300">rule-derived</span></div>
          {d.recs.length === 0 ? <p className="text-xs text-gray-400 mb-3">No gaps needing intervention. ✅</p> : <ul className="space-y-1.5 mb-3">{d.recs.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>}
          <div className="grid grid-cols-2 gap-1.5">{QUICK.map(([l, h]) => <Link key={l} href={h} className="text-[10px] font-semibold text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-2 py-1.5 hover:border-purple-200 transition-colors">{l} →</Link>)}</div>
        </div>
      </div>
    </div>
  );
}
