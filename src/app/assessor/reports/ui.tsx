import Link from "next/link";
import PrintButton from "./PrintButton";

// Shared UI primitives for the Analytics & Reports modules — one look across
// all 13 screens (Architecture spec §5 "shared analytics components").

export function ModuleHeader({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <>
      <Link href="/assessor/reports" className="no-print text-xs text-gray-400 hover:text-gray-600">← Assessment Dashboard</Link>
      <div className="mb-5 mt-1 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{icon} {title}</h1>
          <p className="text-gray-400 text-sm mt-0.5">{sub}</p>
        </div>
        <PrintButton />
      </div>
    </>
  );
}

export type Tile = { label: string; value: string; d?: string | null; sub?: string; alert?: boolean };

export function StatTiles({ tiles, cols = "grid-cols-2 md:grid-cols-4" }: { tiles: Tile[]; cols?: string }) {
  return (
    <div className={`grid ${cols} gap-2 mb-5`}>
      {tiles.map(k => (
        <div key={k.label} className={`bg-white border rounded-xl px-3 py-2.5 ${k.alert ? "border-red-200 bg-red-50/40" : "border-gray-200"}`}>
          <div className="flex items-baseline gap-1.5">
            <p className={`text-lg font-bold ${k.alert ? "text-red-600" : "text-gray-900"}`}>{k.value}</p>
            {k.d && <span className={`text-[9px] font-bold ${k.d.startsWith("▼") ? "text-red-500" : k.d.startsWith("▲") ? "text-green-600" : "text-gray-400"}`}>{k.d}</span>}
          </div>
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider leading-tight">{k.label}</p>
          {k.sub && <p className="text-[8px] text-gray-400 mt-0.5">{k.sub}</p>}
        </div>
      ))}
    </div>
  );
}

export function PctChip({ v }: { v: number | null }) {
  if (v == null) return <span className="text-gray-300">—</span>;
  return (
    <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${v >= 80 ? "bg-green-100 text-green-700" : v >= 60 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-600"}`}>
      {v}%
    </span>
  );
}

export function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-sm font-bold text-gray-900 mb-3">{title}{sub && <span className="text-[10px] font-normal text-gray-400 ml-1.5">{sub}</span>}</p>
      {children}
    </div>
  );
}
