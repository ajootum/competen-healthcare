import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAccreditationStandards } from "@/lib/accreditation-standards";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";
import AccreditationNav from "../AccreditationNav";

// Module 3 — Evidence Repository. Uploaded evidence count + by-type are live;
// a standards-linked repository with validity/expiry lifecycle isn't built yet.

export const dynamic = "force-dynamic";

export default async function Evidence() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d = (await loadAccreditationStandards(admin, hospitalId ?? "")).evidence;
  const tiles: Tile[] = [
    { label: "Total Evidence", value: String(d.cards.total) },
    { label: "Valid", value: "—", sub: "no status field" },
    { label: "Awaiting Review", value: "—", sub: "soon" },
    { label: "Expired", value: "—", sub: "no expiry field" },
    { label: "Missing", value: "—", sub: "needs standards link" },
  ];
  const typeMax = Math.max(1, ...d.byType.map(x => x.n));

  return (
    <div className="max-w-[1200px]">
      <AccreditationNav active="evidence" />
      <div className="mb-5"><StatTiles tiles={tiles} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-5" /></div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Evidence by Type</h2>
          {d.byType.length === 0 ? <p className="text-xs text-gray-400">No evidence uploaded yet.</p> : (
            <div className="flex flex-col gap-1.5">{d.byType.map(x => (
              <div key={x.label} className="flex items-center gap-2"><span className="text-[11px] text-gray-500 w-32 truncate capitalize">{x.label}</span><div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-blue-400 rounded-full" style={{ width: `${(x.n / typeMax) * 100}%` }} /></div><span className="text-[10px] font-bold text-gray-600 w-6 text-right">{x.n}</span></div>
            ))}</div>
          )}
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Evidence Lifecycle</h2>
          <p className="text-[11px] text-gray-500 mb-3">{d.note}</p>
          <ul className="space-y-1.5 text-[11px] text-gray-600">
            <li className="flex gap-2"><span className="text-gray-300">·</span>Add validity/expiry fields to track evidence currency.</li>
            <li className="flex gap-2"><span className="text-gray-300">·</span>Link each item to standards/measurable elements for gap detection.</li>
            <li className="flex gap-2"><span className="text-gray-300">·</span>Validation workflow (awaiting → valid) and evidence packs.</li>
          </ul>
          <Link href="/educator/evidence" className="inline-block mt-3 text-[11px] font-semibold text-purple-600 hover:underline">Evidence review →</Link>
        </div>
      </div>
    </div>
  );
}
