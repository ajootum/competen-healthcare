import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadCurriculumAnalytics } from "@/lib/curriculum-analytics";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import CurriculumNav from "../CurriculumNav";

// Module 4 — CPU Analytics. Performance and lifecycle of Clinical Practice
// Units from live competency achievement, assessment and evidence links.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";

export default async function Cpus() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadCurriculumAnalytics(admin, hospitalId ?? "")).cpus;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Total CPUs", value: String(C.total) },
    { label: "Active CPUs", value: String(C.active) },
    { label: "High Performing", value: String(C.highPerforming) },
    { label: "Needs Review", value: String(C.needsReview), alert: C.needsReview > 0 },
    { label: "Completion", value: pct(C.completion) },
    { label: "Assessment Quality", value: pct(C.assessmentQuality) },
    { label: "Evidence Complete", value: pct(C.evidence) },
  ];
  const lifeTotal = d.lifecycle.reduce((s, x) => s + x.n, 0);
  const Circ = 2 * Math.PI * 40;
  const arcPcts = d.lifecycle.map(x => lifeTotal ? (x.n / lifeTotal) * 100 : 0);
  const arcs = d.lifecycle.map((x, i) => ({ ...x, off: arcPcts.slice(0, i).reduce((s, p) => s + p, 0), p: arcPcts[i] }));

  return (
    <div className="max-w-[1200px]">
      <CurriculumNav active="cpus" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-4 xl:grid-cols-7" /></div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-4">
        <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-bold text-gray-900">CPU Performance Overview</h2><Link href="/educator/studio/cpus" className="text-[11px] font-semibold text-purple-600 hover:underline">Manage CPUs →</Link></div>
        {d.table.length === 0 ? <p className="text-xs text-gray-400">No CPUs defined yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left border-collapse">
            <thead><tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">{["CPU", "Domain", "Completion", "Comp. Achievement", "Assessments", "Evidence", "AI Score"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
            <tbody>{d.table.map(c => (
              <tr key={c.id} className="border-b border-gray-50 text-[11px]">
                <td className="py-2 pr-3 font-semibold text-gray-800 max-w-[180px] truncate" title={c.name}>{c.name}</td>
                <td className="py-2 pr-3 text-gray-500">{c.domain}</td>
                <td className="py-2 pr-3 text-gray-600">{pct(c.completion)}</td>
                <td className="py-2 pr-3 text-gray-600">{pct(c.achievement)}</td>
                <td className="py-2 pr-3 text-gray-600">{c.assessments}</td>
                <td className="py-2 pr-3">{c.evidence ? <span className="text-green-500">●</span> : <span className="text-gray-200">○</span>}</td>
                <td className="py-2 pr-3"><span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${(c.score ?? 0) >= 70 ? "bg-green-50 text-green-700" : (c.score ?? 0) >= 50 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-600"}`}>{pct(c.score)}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* CPU comparison bars */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 lg:col-span-2">
          <h2 className="text-sm font-bold text-gray-900 mb-3">CPU Performance Comparison</h2>
          <div className="flex items-center gap-3 mb-2 text-[9px]"><span className="flex items-center gap-1 text-gray-500"><span className="w-2 h-2 rounded-full bg-purple-500" />Attainment</span><span className="flex items-center gap-1 text-gray-500"><span className="w-2 h-2 rounded-full bg-teal-500" />Evidence</span></div>
          {d.radar.length === 0 ? <p className="text-xs text-gray-400">No CPU data.</p> : (
            <div className="flex flex-col gap-3">{d.radar.map(c => (
              <div key={c.cpu}>
                <p className="text-[11px] font-semibold text-gray-700 mb-1 truncate">{c.cpu}</p>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2"><div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-purple-500 rounded-full" style={{ width: `${c.attainment}%` }} /></div><span className="text-[10px] font-bold text-gray-600 w-9 text-right">{c.attainment}%</span></div>
                  <div className="flex items-center gap-2"><div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-teal-500 rounded-full" style={{ width: `${c.evidence}%` }} /></div><span className="text-[10px] font-bold text-gray-600 w-9 text-right">{c.evidence}%</span></div>
                </div>
              </div>
            ))}</div>
          )}
        </div>

        {/* Lifecycle donut + insights */}
        <div className="flex flex-col gap-4">
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-3">CPU Lifecycle</h2>
            {lifeTotal === 0 ? <p className="text-xs text-gray-400">No CPUs.</p> : (
              <div className="flex items-center gap-4">
                <div className="relative w-20 shrink-0"><svg viewBox="0 0 100 100" className="w-full -rotate-90"><circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="12" />{arcs.filter(a => a.p > 0).map(a => <circle key={a.label} cx="50" cy="50" r="40" fill="none" stroke={a.color} strokeWidth="12" strokeDasharray={`${(a.p / 100) * Circ} ${Circ}`} strokeDashoffset={-(a.off / 100) * Circ} />)}</svg><div className="absolute inset-0 flex items-center justify-center"><p className="text-base font-extrabold text-gray-900">{lifeTotal}</p></div></div>
                <div className="flex flex-col gap-1 flex-1">{d.lifecycle.map(x => <div key={x.label} className="flex items-center gap-2 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: x.color }} /><span className="text-gray-500 flex-1 capitalize">{x.label.replace("_", " ")}</span><span className="font-bold text-gray-800">{x.n}</span></div>)}</div>
              </div>
            )}
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2></div>
            {d.insights.length === 0 ? <p className="text-xs text-gray-400">CPUs are healthy. ✅</p> : <ul className="space-y-1.5">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>}
          </div>
        </div>
      </div>
    </div>
  );
}
