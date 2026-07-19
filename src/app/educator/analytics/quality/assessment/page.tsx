import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadProgramQuality } from "@/lib/program-quality";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import QualityNav from "../QualityNav";

// Module 4 — Assessment KPIs. Assessment quality scorecard for the programme.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";

export default async function Assessment() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadProgramQuality(admin, hospitalId ?? "")).assessment;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Assessment Quality", value: pct(C.quality) },
    { label: "Reliability", value: "—", sub: "needs item matrices" },
    { label: "Validity", value: "—", sub: "soon" },
    { label: "Blueprint Alignment", value: pct(C.blueprintAlignment) },
    { label: "Pass Rate", value: pct(C.passRate) },
    { label: "Reassessment Rate", value: "—", sub: "not tracked" },
  ];

  return (
    <div className="max-w-[1200px]">
      <QualityNav active="assessment" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Top Assessment Types <span className="font-normal text-gray-400 text-xs">(avg score)</span></h2>
          {d.topTypes.every(t => t.pct === null) ? <p className="text-xs text-gray-400">No assessment activity yet.</p> : (
            <div className="flex flex-col gap-2">{d.topTypes.map(t => (
              <div key={t.label} className="flex items-center gap-2 text-[11px]"><span className="text-gray-500 w-32">{t.label}</span>{t.pct !== null ? <><div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-orange-400 rounded-full" style={{ width: `${t.pct}%` }} /></div><span className="font-bold text-gray-700 w-9 text-right">{t.pct}%</span></> : <span className="flex-1 text-right text-[8px] font-bold uppercase text-gray-300">no data</span>}</div>
            ))}</div>
          )}
          <Link href="/educator/analytics/assessment" className="inline-block mt-3 text-[11px] font-semibold text-purple-600 hover:underline">Full assessment analytics →</Link>
        </div>

        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2></div>
          {d.insights.length === 0 ? <p className="text-xs text-gray-400 mb-3">Assessments performing well. ✅</p> : <ul className="space-y-1.5 mb-3">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>}
          <Link href="/educator/analytics/assessment/reliability" className="text-[11px] font-semibold text-purple-600 hover:underline">Open psychometrics →</Link>
        </div>
      </div>
    </div>
  );
}
