import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadCompetencyAnalytics } from "@/lib/competency-analytics";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import CompetencyNav from "../CompetencyNav";

// Module 1 — Competency Coverage. Coverage matrix, funnel and framework
// comparison from live mapping records. Learning-outcome/course/OSCE mapping
// have no store — shown honestly.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";
const DIMS = ["Learning", "Knowledge", "Simulation", "Assessment", "Evidence", "Reassess"];
const QUICK = [["Map Missing Competency", "/educator/studio/mapping"], ["Add Assessment", "/educator/assessments"], ["Add Learning Resource", "/educator/library"], ["Open Blueprint", "/educator/studio/mapping"]];

export default async function Coverage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadCompetencyAnalytics(admin, hospitalId ?? "")).coverage;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Total Competencies", value: String(C.total) },
    { label: "Fully Covered", value: String(C.fully), sub: C.total ? `${Math.round((C.fully / C.total) * 100)}%` : "" },
    { label: "Partially Covered", value: String(C.partial) },
    { label: "Uncovered", value: String(C.uncovered), alert: C.uncovered > 0 },
    { label: "Curriculum Rate", value: pct(C.curriculumRate) },
    { label: "Assessment Rate", value: pct(C.assessmentRate) },
    { label: "Evidence Rate", value: pct(C.evidenceRate) },
    { label: "Over-assessed", value: String(C.overAssessed) },
  ];
  const funMax = d.funnel[0]?.n ?? 1;

  return (
    <div className="max-w-[1200px]">
      <CompetencyNav active="coverage" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-4 xl:grid-cols-8" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start mb-4">
        {/* Coverage matrix */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Competency Coverage Matrix</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  <th className="py-2 pr-3">Competency / Domain</th>
                  {DIMS.map(h => <th key={h} className="py-2 px-1 text-center">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {d.matrix.map((r, i) => (
                  <tr key={i} className="border-b border-gray-50 text-[11px]">
                    <td className="py-2 pr-3"><span className="font-semibold text-gray-800 block truncate max-w-[220px]" title={r.name}>{r.name}</span><span className="text-[9px] text-gray-400">{r.domain}</span></td>
                    {r.dims.map((ok, j) => <td key={j} className="py-2 px-1 text-center">{ok ? <span className="text-green-500">●</span> : <span className="text-gray-200">○</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[9px] text-gray-300 mt-2">● covered · ○ missing. Learning-outcome, course &amp; OSCE columns need mapping stores not yet built.</p>
        </div>

        {/* Coverage funnel */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Coverage Funnel</h2>
          <div className="flex flex-col gap-1">
            {d.funnel.map((s, i) => (
              <div key={s.label} className="flex items-center gap-2">
                <div className="flex-1 h-6 bg-gray-100 rounded overflow-hidden">
                  <div className="h-full rounded flex items-center px-2 text-[9px] font-bold text-white" style={{ width: `${funMax ? Math.max(14, (s.n / funMax) * 100) : 0}%`, background: `hsl(${262 - i * 6} 65% ${56 + i * 4}%)` }}>{s.n}</div>
                </div>
                <span className="text-[9px] text-gray-500 w-24 shrink-0">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* Coverage by framework */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Coverage by Framework</h2>
          {d.byFramework.length === 0 ? <p className="text-xs text-gray-400">No frameworks installed.</p> : (
            <div className="flex flex-col gap-2">
              {d.byFramework.map(f => (
                <div key={f.name} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 w-36 truncate">{f.name}</span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${f.pct >= 70 ? "bg-green-500" : f.pct >= 40 ? "bg-amber-400" : "bg-purple-400"}`} style={{ width: `${f.pct}%` }} /></div>
                  <span className="text-[10px] font-bold text-gray-600 w-9 text-right">{f.pct}%</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AI insights + quick actions */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2><span className="ml-auto text-[8px] font-bold uppercase text-gray-300">rule-derived</span></div>
          {d.insights.length === 0 ? <p className="text-xs text-gray-400 mb-3">Coverage looks complete. ✅</p> : (
            <ul className="space-y-1.5 mb-3">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            {QUICK.map(([l, h]) => <Link key={l} href={h} className="text-[10px] font-semibold text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-2 py-1.5 hover:border-purple-200 transition-colors">{l} →</Link>)}
          </div>
        </div>
      </div>
    </div>
  );
}
