import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAssessmentAnalytics } from "@/lib/assessment-analytics";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import AssessmentNav from "../AssessmentNav";

// Module 3 — Reliability & Validity. Psychometric coefficients need multi-item
// score matrices and double-scored encounters that don't exist at this data
// volume — everything is shown honestly as insufficient-data rather than faked.

export const dynamic = "force-dynamic";

export default async function Reliability() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadAssessmentAnalytics(admin, hospitalId ?? "")).reliability;
  const tiles: Tile[] = [
    { label: "Reliability Coeff.", value: "—", sub: "insufficient data" },
    { label: "Validity Index", value: "—", sub: "review panel" },
    { label: "Inter-Rater", value: "—", sub: "needs double-scoring" },
    { label: "Internal Consistency", value: "—", sub: "soon" },
    { label: "Std. Error", value: "—", sub: "soon" },
    { label: "Confidence", value: d.cards.confidence, sub: "" },
  ];

  return (
    <div className="max-w-[1200px]">
      <AssessmentNav active="reliability" />
      <div className="mb-4"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" /></div>
      <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-5">ℹ️ Psychometric reliability (Cronbach&apos;s α, KR-20) needs many learners answering the same multi-item assessment; inter-rater agreement needs the same encounter scored by two assessors. Neither exists at the current data volume, so no coefficients are computed — they are shown honestly rather than fabricated.</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* Reliability indicators */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Reliability Indicators</h2>
          <div className="flex flex-col gap-2">
            {d.indicators.map(x => (
              <div key={x.label} className="flex items-center justify-between border-b border-gray-50 pb-1.5">
                <span className="text-[11px] text-gray-600">{x.label}</span>
                {x.value !== null ? <span className="text-sm font-bold text-gray-900">{x.value.toFixed(2)}</span> : <span className="text-[8px] font-bold uppercase text-gray-300">insufficient data</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Validity indicators */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Validity Evidence</h2>
          <div className="flex flex-col gap-2">
            {d.validity.map(x => (
              <div key={x.label} className="flex items-center justify-between border-b border-gray-50 pb-1.5">
                <span className="text-[11px] text-gray-600">{x.label}</span>
                <span className="text-[10px] font-semibold text-gray-400">{x.state}</span>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-gray-300 mt-3">Assessor calibration &amp; consistency (leniency/severity/halo/drift) need multi-assessor scoring records — on the roadmap.</p>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 mt-4">
        <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2></div>
        <ul className="space-y-1.5">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>
        <Link href="/educator/validations" className="inline-block mt-3 text-[11px] font-semibold text-purple-600 hover:underline">Go to Validation Centre →</Link>
      </div>
    </div>
  );
}
