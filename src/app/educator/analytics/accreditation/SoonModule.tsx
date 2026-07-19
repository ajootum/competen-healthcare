import Link from "next/link";
import AccreditationNav from "./AccreditationNav";
import { StatTiles, type Tile } from "@/app/assessor/reports/ui";

// Honest shell for Accreditation modules that have no backing store yet
// (accreditation reports, regulatory mapping, quality documents). Renders the
// spec's KPI cards as not-tracked, an explanation of what store is needed, and
// links to the live parts of the workflow.
export default function SoonModule({ active, note, kpis, needs, links, cols = "grid-cols-2 md:grid-cols-3 xl:grid-cols-6" }: {
  active: string; note: string; kpis: string[]; needs: string[]; links: [string, string][]; cols?: string;
}) {
  const tiles: Tile[] = kpis.map(label => ({ label, value: "—", sub: "no store" }));
  return (
    <div className="max-w-[1200px]">
      <AccreditationNav active={active} />
      <div className="mb-2"><StatTiles tiles={tiles} cols={cols} /></div>
      <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-5">ℹ️ {note}</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="bg-white border border-gray-100 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">What this module needs</h2>
          <ul className="space-y-1.5 text-[11px] text-gray-600">{needs.map((n, i) => <li key={i} className="flex gap-2"><span className="text-gray-300">·</span>{n}</li>)}</ul>
        </div>
        {links.length > 0 && (
          <div className="bg-white border border-gray-100 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-3">Available now</h2>
            <div className="flex flex-col gap-1.5">{links.map(([l, h]) => <Link key={l} href={h} className="text-[11px] font-semibold text-purple-600 hover:underline">{l} →</Link>)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
