"use client";

import Link from "next/link";
import { useState } from "react";
import type { Asset } from "@/lib/professional-tools";

// Module repository (spec "Main Workspace" → Repository + Search & Filters +
// core Grid/List views). Client-side search + view toggle over the live rows
// the server loaded. Honest empty states: an unbacked module shows a scaffold
// note and a link to the live tool rather than any placeholder rows.

const STATUS_CLS: Record<string, string> = {
  published: "bg-emerald-100 text-emerald-700", active: "bg-emerald-100 text-emerald-700", approved: "bg-emerald-100 text-emerald-700",
  draft: "bg-gray-100 text-gray-600", review: "bg-amber-100 text-amber-700", pending: "bg-amber-100 text-amber-700",
};
const cls = (s: string) => STATUS_CLS[s.toLowerCase()] ?? "bg-gray-100 text-gray-600";

export default function Repository({ assets, countLabel, live, launchHref, launchLabel, purpose, icon }: {
  assets: Asset[]; countLabel: string; live: boolean; launchHref?: string; launchLabel?: string; purpose: string; icon: string;
}) {
  const [q, setQ] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const shown = q ? assets.filter(a => a.title.toLowerCase().includes(q.toLowerCase())) : assets;

  if (!live) {
    return (
      <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-8 text-center">
        <p className="text-4xl mb-2">{icon}</p>
        <p className="text-sm font-bold text-gray-700">Repository store not provisioned yet</p>
        <p className="text-[12px] text-gray-500 max-w-md mx-auto mt-1">{purpose}</p>
        {launchHref && (
          <Link href={launchHref} className="inline-flex items-center gap-1 mt-4 text-[13px] font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-4 py-2 transition-colors">{launchLabel ?? "Open tool"} →</Link>
        )}
        <p className="text-[10px] text-gray-400 mt-3 max-w-md mx-auto">This workspace will populate once a dedicated store is connected — no placeholder data is shown.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search this repository…"
            className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-violet-400" />
        </div>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          <button onClick={() => setView("grid")} className={`px-2.5 py-2 text-sm ${view === "grid" ? "bg-violet-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`} title="Grid view">▦</button>
          <button onClick={() => setView("list")} className={`px-2.5 py-2 text-sm ${view === "list" ? "bg-violet-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`} title="List view">☰</button>
        </div>
        {launchHref && <Link href={launchHref} className="text-[12px] font-semibold text-violet-600 hover:text-violet-700 whitespace-nowrap px-2">{launchLabel ?? "Open editor"} →</Link>}
      </div>

      {shown.length === 0 ? (
        <p className="text-[12px] text-gray-400 py-8 text-center">{assets.length === 0 ? "No assets in this repository yet." : "No assets match your search."}</p>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {shown.map(a => (
            <div key={a.id} className="rounded-xl border border-gray-200 p-3.5 hover:border-violet-200 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <span className="text-lg">{icon}</span>
                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${cls(a.status)}`}>{a.status}</span>
              </div>
              <p className="text-[13px] font-semibold text-gray-800 mt-1.5 leading-tight line-clamp-2">{a.title}</p>
              <div className="flex items-center gap-2 mt-2 text-[10px] text-gray-400">
                {a.meta && <span className="capitalize">{a.meta}</span>}
                {a.version != null && <span>v{a.version}</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-gray-100">
          {shown.map(a => (
            <div key={a.id} className="flex items-center gap-3 py-2.5">
              <span className="text-base shrink-0">{icon}</span>
              <span className="flex-1 min-w-0 text-[13px] text-gray-800 truncate">{a.title}</span>
              {a.meta && <span className="text-[10px] text-gray-400 capitalize hidden sm:inline">{a.meta}</span>}
              {a.version != null && <span className="text-[10px] text-gray-400">v{a.version}</span>}
              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${cls(a.status)}`}>{a.status}</span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-gray-400 mt-3">{shown.length} of {assets.length} {countLabel.toLowerCase()} shown · live from your workspace records.</p>
    </div>
  );
}
