import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadProgramQuality } from "@/lib/program-quality";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import QualityNav from "../QualityNav";

// Module 5 — Compliance KPIs. Accreditation & clinical compliance from live
// audits plus corrective-action (CAPA) tracking. Policy/documentation
// compliance need their stores.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";

export default async function Compliance() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadProgramQuality(admin, hospitalId ?? "")).compliance;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Accreditation", value: pct(C.accreditation) },
    { label: "Clinical", value: pct(C.clinical) },
    { label: "Policy", value: "—", sub: "no policy store" },
    { label: "Assessment", value: "—", sub: "soon" },
    { label: "Documentation", value: "—", sub: "soon" },
    { label: "Open Actions", value: String(d.capa.open), alert: d.capa.open > 0 },
  ];

  return (
    <div className="max-w-[1200px]">
      <QualityNav active="compliance" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* Compliance matrix */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 lg:col-span-2">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Compliance Matrix</h2>
          <div className="flex flex-col gap-2">{d.matrix.map(b => (
            <div key={b.label} className="flex items-center gap-2 text-[11px]"><span className="text-gray-500 w-36">{b.label}</span>{b.backed && b.pct !== null ? <><div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${b.pct >= 80 ? "bg-green-500" : b.pct >= 60 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${b.pct}%` }} /></div><span className="font-bold text-gray-700 w-9 text-right">{b.pct}%</span></> : <span className="flex-1 text-right text-[8px] font-bold uppercase text-gray-300">no store</span>}</div>
          ))}</div>
          <p className="text-[9px] text-gray-300 mt-3">Only clinical audits are recorded; policy, documentation &amp; assessment compliance need dedicated stores.</p>
        </div>

        {/* CAPA */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Corrective Actions (CAPA)</h2>
          <div className="grid grid-cols-3 gap-2 mb-3 text-center">
            {[["Open", d.capa.open, "text-amber-600"], ["Closed", d.capa.closed, "text-green-600"], ["Total", d.capa.total, "text-gray-900"]].map(([l, n, c]) => (
              <div key={l as string} className="rounded-lg bg-gray-50 p-2"><p className={`text-lg font-bold ${c}`}>{n as number}</p><p className="text-[8px] font-bold uppercase text-gray-400">{l as string}</p></div>
            ))}
          </div>
          {d.alerts.length === 0 ? <p className="text-[11px] text-gray-400">No open compliance alerts. ✅</p> : (
            <div className="flex flex-col gap-1">{d.alerts.map((a, i) => <div key={i} className="flex items-center gap-2 text-[10px]"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /><span className="text-gray-600 flex-1 truncate">{a.label}</span></div>)}</div>
          )}
          <Link href="/educator/quality-flags" className="inline-block mt-3 text-[11px] font-semibold text-purple-600 hover:underline">Quality flags →</Link>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-5 mt-4">
        <div className="flex items-center gap-1.5 mb-2"><span>✨</span><h2 className="text-sm font-bold text-gray-900">AI Insights</h2></div>
        <ul className="space-y-1.5">{d.insights.map((x, i) => <li key={i} className="text-[11px] text-gray-700 flex gap-2"><span className="text-purple-500">›</span>{x}</li>)}</ul>
      </div>
    </div>
  );
}
