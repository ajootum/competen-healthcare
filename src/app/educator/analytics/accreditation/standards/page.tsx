import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAccreditationStandards } from "@/lib/accreditation-standards";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import AccreditationNav from "../AccreditationNav";

// Module 1 — Standards Compliance. Compliance from recorded audit measurable
// elements (met / not-met / n-a) and compliance-by-area.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";
const QUICK = [["View Matrix", "/educator/quality-flags"], ["Upload Evidence", "/educator/evidence"], ["Assign Action", "/educator/plans"], ["Generate Report", "/educator/validation-analytics"]];

export default async function Standards() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadAccreditationStandards(admin, hospitalId ?? "")).standards;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Compliant", value: String(C.compliant) },
    { label: "Partial", value: "—", sub: "not scored" },
    { label: "Non-Compliant", value: String(C.nonCompliant), alert: C.nonCompliant > 0 },
    { label: "Not Assessed", value: String(C.notAssessed) },
    { label: "Overall Compliance", value: pct(C.overall) },
  ];
  const distTotal = d.distribution.reduce((s, x) => s + x.n, 0);
  const Circ = 2 * Math.PI * 40;
  const arcPcts = d.distribution.map(x => distTotal ? (x.n / distTotal) * 100 : 0);
  const arcs = d.distribution.map((x, i) => ({ ...x, off: arcPcts.slice(0, i).reduce((s, p) => s + p, 0), p: arcPcts[i] }));

  return (
    <div className="max-w-[1200px]">
      <AccreditationNav active="standards" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-5" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* By area */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 lg:col-span-2">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Compliance by Area</h2>
          {d.byArea.length === 0 ? <p className="text-xs text-gray-400">No audits recorded yet.</p> : (
            <div className="flex flex-col gap-2">{d.byArea.map(a => (
              <div key={a.area} className="flex items-center gap-2"><span className="text-[11px] text-gray-500 w-36 truncate">{a.area}</span><div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${a.pct >= 80 ? "bg-green-500" : a.pct >= 60 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${a.pct}%` }} /></div><span className="text-[10px] font-bold text-gray-600 w-9 text-right">{a.pct}%</span></div>
            ))}</div>
          )}
          <p className="text-[9px] text-gray-300 mt-3">Derived from recorded audit measurable elements. A dedicated standards catalogue (with per-standard measurable elements) is on the roadmap.</p>
        </div>

        {/* Distribution + quick actions */}
        <div className="flex flex-col gap-4">
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-3">Status Distribution</h2>
            {distTotal === 0 ? <p className="text-xs text-gray-400 py-4 text-center">No data.</p> : (
              <div className="flex items-center gap-3">
                <div className="relative w-20 shrink-0"><svg viewBox="0 0 100 100" className="w-full -rotate-90"><circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="12" />{arcs.filter(a => a.p > 0).map(a => <circle key={a.label} cx="50" cy="50" r="40" fill="none" stroke={a.color} strokeWidth="12" strokeDasharray={`${(a.p / 100) * Circ} ${Circ}`} strokeDashoffset={-(a.off / 100) * Circ} />)}</svg><div className="absolute inset-0 flex items-center justify-center"><p className="text-base font-extrabold text-gray-900">{distTotal}</p></div></div>
                <div className="flex flex-col gap-1 flex-1">{d.distribution.map(x => <div key={x.label} className="flex items-center gap-1.5 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: x.color }} /><span className="text-gray-500 flex-1">{x.label}</span><span className="font-bold text-gray-800">{x.n}</span></div>)}</div>
              </div>
            )}
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-2">Quick Actions</h2>
            <div className="grid grid-cols-2 gap-1.5">{QUICK.map(([l, h]) => <Link key={l} href={h} className="text-[10px] font-semibold text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-2 py-1.5 hover:border-purple-200 transition-colors">{l} →</Link>)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
