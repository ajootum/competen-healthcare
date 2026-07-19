import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAccreditationStandards } from "@/lib/accreditation-standards";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import AccreditationNav from "../AccreditationNav";

// Module 7 — Improvement Tracking. Corrective & preventive actions (CAPA):
// open / critical / overdue / completed, by source and status.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";
const STATUS_CLS: Record<string, string> = { completed: "bg-green-50 text-green-600", closed: "bg-green-50 text-green-600", verified: "bg-green-50 text-green-600", open: "bg-amber-50 text-amber-600", in_progress: "bg-blue-50 text-blue-600" };

export default async function Improvement() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadAccreditationStandards(admin, hospitalId ?? "")).improvement;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Open Actions", value: String(C.open), alert: C.open > 0 },
    { label: "Critical", value: String(C.critical), alert: C.critical > 0 },
    { label: "Overdue", value: String(C.overdue), alert: C.overdue > 0 },
    { label: "Completed", value: String(C.completed) },
    { label: "Closure Rate", value: pct(C.closureRate) },
  ];
  const srcMax = Math.max(1, ...d.bySource.map(x => x.n));
  const stTotal = d.status.reduce((s, x) => s + x.n, 0);
  const Circ = 2 * Math.PI * 40;
  const arcPcts = d.status.map(x => stTotal ? (x.n / stTotal) * 100 : 0);
  const arcs = d.status.map((x, i) => ({ ...x, off: arcPcts.slice(0, i).reduce((s, p) => s + p, 0), p: arcPcts[i] }));

  return (
    <div className="max-w-[1200px]">
      <AccreditationNav active="improvement" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-5" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 items-start">
        {/* By source */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Actions by Source</h2>
          {d.bySource.length === 0 ? <p className="text-xs text-gray-400">No actions recorded.</p> : (
            <div className="flex flex-col gap-2">{d.bySource.map(x => (
              <div key={x.label} className="flex items-center gap-2"><span className="text-[10px] text-gray-500 w-32 truncate">{x.label}</span><div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-amber-400 rounded-full" style={{ width: `${(x.n / srcMax) * 100}%` }} /></div><span className="text-[10px] font-bold text-gray-600 w-6 text-right">{x.n}</span></div>
            ))}</div>
          )}
        </div>

        {/* Status donut */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Action Status</h2>
          {stTotal === 0 ? <p className="text-xs text-gray-400 py-4 text-center">No actions.</p> : (
            <div className="flex items-center gap-3">
              <div className="relative w-20 shrink-0"><svg viewBox="0 0 100 100" className="w-full -rotate-90"><circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="12" />{arcs.filter(a => a.p > 0).map(a => <circle key={a.label} cx="50" cy="50" r="40" fill="none" stroke={a.color} strokeWidth="12" strokeDasharray={`${(a.p / 100) * Circ} ${Circ}`} strokeDashoffset={-(a.off / 100) * Circ} />)}</svg><div className="absolute inset-0 flex items-center justify-center"><p className="text-base font-extrabold text-gray-900">{stTotal}</p></div></div>
              <div className="flex flex-col gap-1 flex-1">{d.status.map(x => <div key={x.label} className="flex items-center gap-1.5 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ background: x.color }} /><span className="text-gray-500 flex-1 capitalize">{x.label}</span><span className="font-bold text-gray-800">{x.n}</span></div>)}</div>
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-2">Quick Actions</h2>
          <div className="flex flex-col gap-1.5">
            <Link href="/educator/plans" className="text-[11px] font-semibold text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 hover:border-purple-200 transition-colors">Improvement plans →</Link>
            <Link href="/educator/quality-flags" className="text-[11px] font-semibold text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 hover:border-purple-200 transition-colors">Quality flags →</Link>
            <Link href="/educator/analytics/accreditation/audit" className="text-[11px] font-semibold text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 hover:border-purple-200 transition-colors">Audit readiness →</Link>
          </div>
        </div>
      </div>

      {/* CAPA register */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <h2 className="text-sm font-bold text-gray-900 mb-3">Corrective &amp; Preventive Actions (CAPA)</h2>
        {d.items.length === 0 ? <p className="text-xs text-gray-400">No corrective actions on record.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left border-collapse">
            <thead><tr className="text-[9px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100">{["Action", "Priority", "Status", "Due"].map(h => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
            <tbody>{d.items.map((c, i) => (
              <tr key={i} className="border-b border-gray-50 text-[11px]">
                <td className="py-2 pr-3 font-semibold text-gray-800">{c.title}</td>
                <td className="py-2 pr-3 text-gray-500 capitalize">{c.priority}</td>
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
