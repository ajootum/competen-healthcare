import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAccreditationStandards } from "@/lib/accreditation-standards";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import AccreditationNav from "../AccreditationNav";

// Module 5 — Audit Readiness. Readiness from recorded audits + open findings
// (CAPA). Mock audits, calendar and evidence room need their stores.

export const dynamic = "force-dynamic";
const pct = (v: number | null) => v !== null ? `${v}%` : "—";

export default async function Audit() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadAccreditationStandards(admin, hospitalId ?? "")).audit;
  const C = d.cards;
  const tiles: Tile[] = [
    { label: "Readiness Score", value: pct(C.readinessScore) },
    { label: "Audits Run", value: String(C.auditsRun) },
    { label: "Open Findings", value: String(C.openFindings), alert: C.openFindings > 0 },
    { label: "Days to Next Audit", value: "—", sub: "no calendar store" },
  ];

  return (
    <div className="max-w-[1200px]">
      <AccreditationNav active="audit" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-4" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Readiness by Domain</h2>
          {d.byDomain.length === 0 ? <p className="text-xs text-gray-400">No audits recorded yet.</p> : (
            <div className="flex flex-col gap-2">{d.byDomain.map(a => (
              <div key={a.area} className="flex items-center gap-2"><span className="text-[11px] text-gray-500 w-32 truncate">{a.area}</span><div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${a.pct >= 80 ? "bg-green-500" : a.pct >= 60 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${a.pct}%` }} /></div><span className="text-[10px] font-bold text-gray-600 w-9 text-right">{a.pct}%</span></div>
            ))}</div>
          )}
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Audit Calendar &amp; Mock Audits</h2>
          <p className="text-[11px] text-gray-500 mb-3">{d.note}</p>
          <div className="flex flex-col gap-1">
            {["Internal Audit", "Mock Accreditation", "External Survey"].map(x => (
              <div key={x} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"><span className="text-[11px] text-gray-400">{x}</span><span className="text-[8px] font-bold uppercase text-gray-300">soon</span></div>
            ))}
          </div>
          <Link href="/educator/analytics/accreditation/improvement" className="inline-block mt-3 text-[11px] font-semibold text-purple-600 hover:underline">Track findings → improvement</Link>
        </div>
      </div>
    </div>
  );
}
