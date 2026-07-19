import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadCurriculumAnalytics } from "@/lib/curriculum-analytics";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import CurriculumNav from "../CurriculumNav";

// Module 6 — Gap Analysis. Curriculum gaps (assessment/content/CPU/simulation)
// from live mapping deficiencies. Accreditation & faculty gaps need those
// stores — shown honestly.

export const dynamic = "force-dynamic";
const SEV_CLS: Record<string, string> = { Critical: "bg-red-50 text-red-600", High: "bg-amber-50 text-amber-600", Medium: "bg-yellow-50 text-yellow-700", Low: "bg-green-50 text-green-600" };
const QUICK = [["Create Improvement Plan", "/educator/plans"], ["Assign Owner", "/educator/interventions"], ["Launch Curriculum Review", "/educator/studio/curriculum"], ["Generate Gap Report", "/educator/validation-analytics"]];

export default async function Gaps() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadCurriculumAnalytics(admin, hospitalId ?? "")).gaps;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Total Gaps", value: String(C.total) },
    { label: "Critical Gaps", value: String(C.critical), alert: C.critical > 0 },
    { label: "Assessment Gaps", value: String(C.assessment) },
    { label: "Content Gaps", value: String(C.content) },
    { label: "CPU Gaps", value: String(C.cpu) },
    { label: "Simulation Gaps", value: String(C.simulation) },
    { label: "Faculty Gaps", value: "—", sub: "soon" },
    { label: "Accreditation Gaps", value: "—", sub: "soon" },
  ];
  const catTotal = d.categories.reduce((s, x) => s + x.n, 0);
  const Circ = 2 * Math.PI * 40;
  const arcPcts = d.categories.map(x => catTotal ? (x.n / catTotal) * 100 : 0);
  const arcs = d.categories.map((x, i) => ({ ...x, off: arcPcts.slice(0, i).reduce((s, p) => s + p, 0), p: arcPcts[i] }));
  const sevMax = Math.max(1, ...d.severity.map(x => x.n));

  return (
    <div className="max-w-[1200px]">
      <CurriculumNav active="gaps" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-4 xl:grid-cols-8" /></div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-4">
        <h2 className="text-sm font-bold text-gray-900 mb-3">Curriculum Gaps Register</h2>
        {d.register.length === 0 ? <p className="text-xs text-gray-400">No curriculum gaps detected. ✅</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left border-collapse">
            <thead><tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">{["Gap", "Category", "Severity", "Learners", "Root Cause", "Status"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
            <tbody>{d.register.map(g => (
              <tr key={g.id} className="border-b border-gray-50 text-[11px]">
                <td className="py-2 pr-3 font-semibold text-gray-800 max-w-[200px] truncate" title={g.name}>{g.name}</td>
                <td className="py-2 pr-3 text-gray-500">{g.category}</td>
                <td className="py-2 pr-3"><span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${SEV_CLS[g.severity]}`}>{g.severity}</span></td>
                <td className="py-2 pr-3 text-gray-600">{g.learners}</td>
                <td className="py-2 pr-3 text-gray-500 max-w-[180px] truncate">{g.rootCause}</td>
                <td className="py-2 pr-3 text-gray-500">{g.status}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* Categories donut */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Gaps by Category</h2>
          {catTotal === 0 ? <p className="text-xs text-gray-400 py-6 text-center">No gaps.</p> : (
            <div className="flex items-center gap-4">
              <div className="relative w-24 shrink-0"><svg viewBox="0 0 100 100" className="w-full -rotate-90"><circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="12" />{arcs.filter(a => a.p > 0).map(a => <circle key={a.label} cx="50" cy="50" r="40" fill="none" stroke={a.color} strokeWidth="12" strokeDasharray={`${(a.p / 100) * Circ} ${Circ}`} strokeDashoffset={-(a.off / 100) * Circ} />)}</svg><div className="absolute inset-0 flex items-center justify-center"><p className="text-lg font-extrabold text-gray-900">{catTotal}</p></div></div>
              <div className="flex flex-col gap-1 flex-1">{d.categories.map(x => <div key={x.label} className="flex items-center gap-2 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: x.color }} /><span className="text-gray-500 flex-1 truncate">{x.label}</span><span className="font-bold text-gray-800">{x.n}</span></div>)}</div>
            </div>
          )}
        </div>

        {/* Severity distribution */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Gap Severity</h2>
          <div className="flex items-end justify-around gap-2 h-28">
            {d.severity.map(x => (
              <div key={x.label} className="flex flex-col items-center gap-1 flex-1">
                <span className="text-[10px] font-bold text-gray-700">{x.n}</span>
                <div className="w-full rounded-t" style={{ height: `${(x.n / sevMax) * 80}px`, background: x.color }} />
                <span className="text-[8px] text-gray-400">{x.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* AI insights + actions */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2></div>
          {d.insights.length === 0 ? <p className="text-xs text-gray-400 mb-3">No curriculum gaps. ✅</p> : <ul className="space-y-1.5 mb-3">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>}
          <div className="grid grid-cols-2 gap-1.5">{QUICK.map(([l, h]) => <Link key={l} href={h} className="text-[10px] font-semibold text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-2 py-1.5 hover:border-purple-200 transition-colors">{l} →</Link>)}</div>
        </div>
      </div>
    </div>
  );
}
