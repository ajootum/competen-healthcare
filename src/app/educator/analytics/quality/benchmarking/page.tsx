import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadProgramQuality } from "@/lib/program-quality";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import QualityNav from "../QualityNav";

// Module 6 — Benchmarking. External/percentile benchmarking needs cross-org
// datasets that don't exist in a single tenant — shown honestly. Internal
// programme comparison is available via Learning Analytics › Cohorts.

export const dynamic = "force-dynamic";

export default async function Benchmarking() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadProgramQuality(admin, hospitalId ?? "")).benchmarking;
  const tiles: Tile[] = [
    { label: "National Ranking", value: "—", sub: "no external data" },
    { label: "Internal Ranking", value: "—", sub: "single programme" },
    { label: "Improvement Rate", value: "—", sub: "soon" },
    { label: "Benchmark Score", value: "—", sub: "soon" },
    { label: "Quality Percentile", value: "—", sub: "soon" },
  ];

  return (
    <div className="max-w-[1200px]">
      <QualityNav active="benchmarking" />
      <div className="mb-2"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-5" /></div>
      <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-5">ℹ️ {d.note}</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-2">What benchmarking needs</h2>
          <ul className="space-y-1.5 text-[11px] text-gray-600">
            <li className="flex gap-2"><span className="text-gray-300">·</span>Anonymised peer-hospital and national datasets to compute percentiles.</li>
            <li className="flex gap-2"><span className="text-gray-300">·</span>Multiple programmes/cohorts to rank internally.</li>
            <li className="flex gap-2"><span className="text-gray-300">·</span>Historical periods to compute improvement rate.</li>
          </ul>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-2">Available now — internal comparison</h2>
          <p className="text-[11px] text-gray-600 mb-3">You can compare cohorts and programmes within your hospital using live data.</p>
          <div className="flex flex-col gap-1.5">
            <Link href="/educator/analytics/learning/cohorts" className="text-[11px] font-semibold text-purple-600 hover:underline">Cohort comparison &amp; radar →</Link>
            <Link href="/educator/analytics/outcomes/success" className="text-[11px] font-semibold text-purple-600 hover:underline">Success by programme →</Link>
            <Link href="/educator/analytics/competency/domains" className="text-[11px] font-semibold text-purple-600 hover:underline">Domain performance →</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
