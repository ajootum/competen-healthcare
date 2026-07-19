import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadProgramQuality } from "@/lib/program-quality";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import QualityNav from "../QualityNav";

// Module 7 — Annual Reviews. Formal review cycles need a review store; live
// corrective actions (CAPA) are shown as the improvement-action proxy.

export const dynamic = "force-dynamic";
const STATUS_CLS: Record<string, string> = { completed: "bg-green-50 text-green-600", closed: "bg-green-50 text-green-600", open: "bg-amber-50 text-amber-600", in_progress: "bg-blue-50 text-blue-600" };

export default async function Reviews() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadProgramQuality(admin, hospitalId ?? "")).annualReviews;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Reviews Completed", value: "—", sub: "no review store" },
    { label: "Reviews Pending", value: "—", sub: "soon" },
    { label: "Actions Closed", value: String(C.actionsClosed) },
    { label: "Actions Open", value: String(C.actionsOpen), alert: C.actionsOpen > 0 },
  ];

  return (
    <div className="max-w-[1200px]">
      <QualityNav active="reviews" />
      <div className="mb-2"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-4" /></div>
      <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-5">ℹ️ {d.note}</p>

      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-bold text-gray-900">Improvement Actions (CAPA)</h2><Link href="/educator/plans" className="text-[11px] font-semibold text-purple-600 hover:underline">Improvement plans →</Link></div>
        {d.capaItems.length === 0 ? <p className="text-xs text-gray-400">No corrective actions on record.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left border-collapse">
            <thead><tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">{["Action", "Status", "Due"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
            <tbody>{d.capaItems.map((c, i) => (
              <tr key={i} className="border-b border-gray-50 text-[11px]">
                <td className="py-2 pr-3 font-semibold text-gray-800">{c.title}</td>
                <td className="py-2 pr-3"><span className={`text-[9px] font-bold px-1.5 py-0.5 rounded capitalize ${STATUS_CLS[c.status] ?? "bg-gray-100 text-gray-500"}`}>{c.status.replace("_", " ")}</span></td>
                <td className="py-2 pr-3 text-gray-400">{c.due ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
