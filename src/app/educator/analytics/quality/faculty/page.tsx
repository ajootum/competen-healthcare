import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadProgramQuality } from "@/lib/program-quality";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import QualityNav from "../QualityNav";

// Module 2 — Faculty KPIs. Educator contribution measured by assessment
// activity; quality-score/satisfaction/turnaround need survey & timestamp stores.

export const dynamic = "force-dynamic";

export default async function Faculty() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadProgramQuality(admin, hospitalId ?? "")).faculty;
  const maxA = Math.max(1, ...d.ranking.map(f => f.assessments));
  const tiles: Tile[] = [
    { label: "Faculty", value: String(d.cards.count) },
    { label: "Quality Score", value: "—", sub: "no survey store" },
    { label: "Learner Satisfaction", value: "—", sub: "soon" },
    { label: "Assessment Turnaround", value: "—", sub: "no timestamps" },
    { label: "Teaching Effectiveness", value: "—", sub: "soon" },
    { label: "Feedback Quality", value: "—", sub: "soon" },
  ];

  return (
    <div className="max-w-[1200px]">
      <QualityNav active="faculty" />
      <div className="mb-2"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" /></div>
      <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-5">ℹ️ Faculty quality, satisfaction and turnaround need learner-feedback surveys and validation timestamps that aren&apos;t captured yet. Assessment activity below is live.</p>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-4">
        <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-bold text-gray-900">Faculty Assessment Activity</h2><Link href="/educator/analytics/learning/faculty" className="text-[11px] font-semibold text-purple-600 hover:underline">Full faculty analytics →</Link></div>
        {d.ranking.length === 0 ? <p className="text-xs text-gray-400">No faculty in your hospital yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left border-collapse">
            <thead><tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">{["Instructor", "Assessments", "Simulations", "Quality Score", "Satisfaction", "Turnaround"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
            <tbody>{d.ranking.map(f => (
              <tr key={f.id} className="border-b border-gray-50 text-[11px]">
                <td className="py-2 pr-3 font-semibold text-gray-800">{f.name}</td>
                <td className="py-2 pr-3"><span className="flex items-center gap-1.5"><span className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden inline-block"><span className="block h-full rounded-full bg-blue-400" style={{ width: `${(f.assessments / maxA) * 100}%` }} /></span><span className="text-gray-700 font-bold">{f.assessments}</span></span></td>
                <td className="py-2 pr-3 text-gray-600">{f.simulations}</td>
                <td className="py-2 pr-3 text-gray-300">—</td>
                <td className="py-2 pr-3 text-gray-300">—</td>
                <td className="py-2 pr-3 text-gray-300">—</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2></div>
        <ul className="space-y-1.5">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>
      </div>
    </div>
  );
}
