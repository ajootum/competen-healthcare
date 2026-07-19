import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadProgramQuality } from "@/lib/program-quality";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import QualityNav from "../QualityNav";

// Module 3 — Curriculum KPIs. Curriculum quality scorecard for the programme.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";

export default async function Curriculum() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadProgramQuality(admin, hospitalId ?? "")).curriculum;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Curriculum Coverage", value: pct(C.coverage) },
    { label: "Blueprint Integrity", value: pct(C.blueprintIntegrity) },
    { label: "LO Achievement", value: pct(C.loAchievement) },
    { label: "CPU Completion", value: pct(C.cpuCompletion) },
    { label: "Curriculum Quality", value: pct(C.quality) },
  ];
  const bars = [["Coverage", C.coverage], ["Blueprint Integrity", C.blueprintIntegrity], ["LO Achievement", C.loAchievement], ["CPU Completion", C.cpuCompletion]] as const;

  return (
    <div className="max-w-[1200px]">
      <QualityNav active="curriculum" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-5" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Curriculum Quality Scorecard</h2>
          <div className="flex flex-col gap-2">{bars.map(([l, v]) => (
            <div key={l} className="flex items-center gap-2 text-[11px]"><span className="text-gray-500 w-32">{l}</span><div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${(v ?? 0) >= 70 ? "bg-green-500" : (v ?? 0) >= 40 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${v ?? 0}%` }} /></div><span className="font-bold text-gray-700 w-9 text-right">{pct(v)}</span></div>
          ))}</div>
          <Link href="/educator/analytics/curriculum" className="inline-block mt-3 text-[11px] font-semibold text-purple-600 hover:underline">Full curriculum analytics →</Link>
        </div>

        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2></div>
          {d.insights.length === 0 ? <p className="text-xs text-gray-400 mb-3">Curriculum is well-aligned. ✅</p> : <ul className="space-y-1.5 mb-3">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>}
          <div className="flex flex-wrap gap-2">
            <Link href="/educator/studio/curriculum" className="text-[11px] font-semibold text-purple-600 hover:underline">Open curriculum →</Link>
            <span className="text-gray-300">·</span>
            <Link href="/educator/analytics/curriculum/gaps" className="text-[11px] font-semibold text-purple-600 hover:underline">Gap analysis →</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
