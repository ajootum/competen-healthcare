import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadImprovementCenter } from "@/lib/improvement-center";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import ImprovementNav from "../ImprovementNav";

// Module 3 — Educational Risks. Risks derived live from competency decisions
// (critical failures, not-yet-competent, expired) and audit findings. The
// configurable 5×5 impact×likelihood register is on the roadmap.

export const dynamic = "force-dynamic";
const SEV_CLS: Record<string, string> = { Critical: "bg-red-50 text-red-600", High: "bg-amber-50 text-amber-600", Medium: "bg-yellow-50 text-yellow-700", Low: "bg-green-50 text-green-600" };

export default async function Risks() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadImprovementCenter(admin, hospitalId ?? "")).risks;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Critical Risks", value: String(C.critical), alert: C.critical > 0 },
    { label: "High Risks", value: String(C.high), alert: C.high > 0 },
    { label: "Medium Risks", value: String(C.medium) },
    { label: "Low Risks", value: String(C.low) },
    { label: "Total Risks", value: String(C.total) },
  ];
  const catTotal = d.byCategory.reduce((s, x) => s + x.n, 0);
  const Circ = 2 * Math.PI * 40;
  const catPcts = d.byCategory.map(x => catTotal ? (x.n / catTotal) * 100 : 0);
  const catArcs = d.byCategory.map((x, i) => ({ ...x, off: catPcts.slice(0, i).reduce((s, p) => s + p, 0), p: catPcts[i] }));
  const sevMax = Math.max(1, ...d.bySeverity.map(x => x.n));

  return (
    <div className="max-w-[1200px]">
      <ImprovementNav active="risks" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-5" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 items-start">
        {/* By category donut */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Risks by Category</h2>
          {catTotal === 0 ? <p className="text-xs text-gray-400 py-6 text-center">No risks detected. 🎉</p> : (
            <div className="flex items-center gap-3">
              <div className="relative w-20 shrink-0"><svg viewBox="0 0 100 100" className="w-full -rotate-90"><circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="12" />{catArcs.filter(a => a.p > 0).map(a => <circle key={a.label} cx="50" cy="50" r="40" fill="none" stroke={a.color} strokeWidth="12" strokeDasharray={`${(a.p / 100) * Circ} ${Circ}`} strokeDashoffset={-(a.off / 100) * Circ} />)}</svg><div className="absolute inset-0 flex items-center justify-center"><p className="text-base font-extrabold text-gray-900">{catTotal}</p></div></div>
              <div className="flex flex-col gap-1 flex-1">{d.byCategory.map(x => <div key={x.label} className="flex items-center gap-1.5 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: x.color }} /><span className="text-gray-500 flex-1 truncate">{x.label}</span><span className="font-bold text-gray-800">{x.n}</span></div>)}</div>
            </div>
          )}
        </div>

        {/* By severity */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Risks by Severity</h2>
          <div className="flex items-end justify-around gap-2 h-28">{d.bySeverity.map(x => (
            <div key={x.label} className="flex flex-col items-center gap-1 flex-1"><span className="text-[10px] font-bold text-gray-700">{x.n}</span><div className="w-full rounded-t" style={{ height: `${(x.n / sevMax) * 80}px`, background: x.color }} /><span className="text-[8px] text-gray-400">{x.label}</span></div>
          ))}</div>
        </div>

        {/* Treatment (soon) */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-2">Risk Register (5×5)</h2>
          <p className="text-[11px] text-gray-500 mb-2">{d.note}</p>
          <div className="flex flex-col gap-1">
            {["Impact × Likelihood matrix", "Residual risk & KRIs", "Treatment tracking"].map(x => (
              <div key={x} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-1.5"><span className="text-[10px] text-gray-400">{x}</span><span className="text-[8px] font-bold uppercase text-gray-300">soon</span></div>
            ))}
          </div>
        </div>
      </div>

      {/* Top risks */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-bold text-gray-900">Top Risks</h2><Link href="/educator/at-risk" className="text-[11px] font-semibold text-purple-600 hover:underline">At-risk learners →</Link></div>
        {d.top.length === 0 ? <p className="text-xs text-gray-400">No risks flagged. 🎉</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left border-collapse">
            <thead><tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">{["Risk (Learner)", "Category", "Severity", "Flags", "Owner"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
            <tbody>{d.top.map((r, i) => (
              <tr key={i} className="border-b border-gray-50 text-[11px]">
                <td className="py-2 pr-3 font-semibold text-gray-800">{r.name}</td>
                <td className="py-2 pr-3 text-gray-500">{r.category}</td>
                <td className="py-2 pr-3"><span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${SEV_CLS[r.severity]}`}>{r.severity}</span></td>
                <td className="py-2 pr-3 text-gray-600">{r.flags}</td>
                <td className="py-2 pr-3 text-gray-500">{r.owner}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
