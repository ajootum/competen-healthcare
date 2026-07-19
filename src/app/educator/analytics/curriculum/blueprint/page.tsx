import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadCurriculumAnalytics } from "@/lib/curriculum-analytics";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import CurriculumNav from "../CurriculumNav";

// Module 2 — Blueprint Analytics. Coverage matrix and integrity checks over
// live mappings. Course/lesson/clinical-placement columns need mapping stores.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";
const COLS = ["Assessment", "Simulation", "Evidence", "Knowledge", "Courses", "Clinical"];

export default async function Blueprint() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadCurriculumAnalytics(admin, hospitalId ?? "")).blueprint;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Blueprint Completion", value: pct(C.completion) },
    { label: "Alignment", value: pct(C.alignment) },
    { label: "Missing Links", value: String(C.missingLinks), alert: C.missingLinks > 0 },
    { label: "Assessment Quality", value: pct(C.assessmentQuality) },
    { label: "CPU Mapping", value: pct(C.cpuMapping) },
    { label: "Outcome Alignment", value: "—", sub: "no outcome store" },
  ];

  return (
    <div className="max-w-[1200px]">
      <CurriculumNav active="blueprint" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
        {/* Coverage matrix */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Blueprint Coverage Matrix</h2>
          <div className="overflow-x-auto"><table className="w-full text-left border-collapse">
            <thead><tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100"><th className="py-2 pr-3">Competency</th>{COLS.map(h => <th key={h} className="py-2 px-1 text-center">{h}</th>)}</tr></thead>
            <tbody>{d.matrix.map((r, i) => (
              <tr key={i} className="border-b border-gray-50 text-[11px]">
                <td className="py-2 pr-3 font-semibold text-gray-800 max-w-[240px] truncate" title={r.name}>{r.name}</td>
                {r.dims.map((ok, j) => <td key={j} className="py-2 px-1 text-center">{ok === null ? <span className="text-gray-200" title="no store">·</span> : ok ? <span className="text-green-500">●</span> : <span className="text-red-400">○</span>}</td>)}
              </tr>
            ))}</tbody>
          </table></div>
          <p className="text-[9px] text-gray-300 mt-2">● mapped · ○ missing · · no store. Courses &amp; clinical-placement mapping not yet captured.</p>
        </div>

        <div className="flex flex-col gap-4">
          {/* Integrity */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-3">Blueprint Integrity</h2>
            <div className="flex flex-col gap-2">
              {d.integrity.map(x => (
                <div key={x.label} className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-500">{x.label}</span>
                  <span className={`text-sm font-bold ${x.n > 0 ? "text-red-600" : "text-green-600"}`}>{x.n}</span>
                </div>
              ))}
            </div>
          </div>
          {/* AI insights */}
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2></div>
            {d.insights.length === 0 ? <p className="text-xs text-gray-400 mb-3">Blueprint is well-formed. ✅</p> : <ul className="space-y-1.5 mb-3">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>}
            <Link href="/educator/studio/mapping" className="text-[11px] font-semibold text-purple-600 hover:underline">Open blueprint →</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
