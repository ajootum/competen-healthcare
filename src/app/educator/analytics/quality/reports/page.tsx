import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadProgramQuality } from "@/lib/program-quality";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import QualityNav from "../QualityNav";

// Module 8 — Quality Reports. Saved report definitions/schedules are empty and
// the executive report builder is on the roadmap; live CSV exports are real.

export const dynamic = "force-dynamic";

export default async function Reports() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadProgramQuality(admin, hospitalId ?? "")).reports;
  const tiles: Tile[] = [
    { label: "Reports Generated", value: "—", sub: "no store" },
    { label: "Scheduled Reports", value: "—", sub: "soon" },
    { label: "Shared Reports", value: "—", sub: "soon" },
    { label: "Live Exports", value: String(d.exports.length) },
  ];

  return (
    <div className="max-w-[1200px]">
      <QualityNav active="reports" />
      <div className="mb-2"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-4" /></div>
      <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-5">ℹ️ {d.note}</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* Templates */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Report Templates</h2>
          <div className="grid grid-cols-2 gap-1.5">{d.templates.map(t => (
            <span key={t} className="text-[11px] text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-2 flex items-center justify-between"><span>{t}</span><span className="text-[8px] font-bold uppercase text-gray-300">soon</span></span>
          ))}</div>
          <p className="text-[9px] text-gray-300 mt-3">The executive report builder (PDF/Word/Excel/Power&nbsp;BI) is on the roadmap.</p>
        </div>

        {/* Live exports */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Live Exports <span className="font-normal text-gray-400 text-xs">(available now)</span></h2>
          <div className="flex flex-col gap-1.5">{d.exports.map(e => (
            <a key={e.label} href={e.href} className="flex items-center justify-between text-[12px] rounded-lg border border-gray-100 px-3 py-2 text-gray-700 hover:border-purple-200 hover:bg-purple-50/40 transition-colors">
              <span>📄 {e.label}</span><span className="text-[10px] font-semibold text-purple-600">Download CSV →</span>
            </a>
          ))}</div>
          <Link href="/educator/validation-analytics" className="inline-block mt-3 text-[11px] font-semibold text-purple-600 hover:underline">Validation analytics →</Link>
        </div>
      </div>
    </div>
  );
}
