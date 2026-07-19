"use client";

import Link from "next/link";
import { useState } from "react";
import { PROF_CATEGORIES, type HubModule, type ProfCategory } from "@/lib/professional-tools";

// Filterable grid of the eight Professional Tools module cards (mockup). Client
// component only for the category filter; the counts are live from the server.
// "My Favourites" and "Customise" have no backing store yet, so they render as
// honest muted controls rather than dead buttons.

export default function ToolGrid({ modules }: { modules: HubModule[] }) {
  const [cat, setCat] = useState<ProfCategory | "all">("all");
  const shown = cat === "all" ? modules : modules.filter(m => m.category === cat);

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {PROF_CATEGORIES.map(c => (
          <button key={c.key} onClick={() => setCat(c.key)}
            className={`text-[12px] font-semibold rounded-lg px-3 py-1.5 border transition-colors ${cat === c.key ? "bg-violet-600 border-violet-600 text-white" : "bg-white border-gray-200 text-gray-600 hover:border-violet-300"}`}>
            {c.label}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <span title="Favourites need a usage store — coming soon" className="text-[12px] text-gray-400 bg-gray-50 border border-dashed border-gray-200 rounded-lg px-3 py-1.5 cursor-default select-none">⭐ My Favourites</span>
          <span title="Dashboard customisation — coming soon" className="text-[12px] text-gray-400 bg-gray-50 border border-dashed border-gray-200 rounded-lg px-3 py-1.5 cursor-default select-none">⚙️ Customise</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {shown.map(m => (
          <div key={m.slug} className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5 flex flex-col hover:border-violet-200 hover:shadow-md transition-all">
            <div className="flex items-start justify-between mb-3">
              <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${m.tint}`}>{m.icon}</span>
              <span className="text-[11px] font-bold text-gray-200">{String(modules.indexOf(m) + 1).padStart(2, "0")}</span>
            </div>
            <p className="text-[15px] font-bold text-gray-900 leading-tight">{m.title}</p>
            <p className="text-[12px] text-gray-500 leading-snug mt-1 mb-3">{m.blurb}</p>
            <ul className="flex flex-col gap-1.5 mb-4 flex-1">
              {m.features.map(f => (
                <li key={f} className="flex items-start gap-2 text-[11px] text-gray-600 leading-tight"><span className="text-emerald-500 mt-px">✓</span>{f}</li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-gray-100 pt-3">
              <span className="text-[11px] text-gray-400">{m.live ? <span className="font-semibold text-gray-600">{(m.count ?? 0).toLocaleString()}</span> : "—"} {m.countLabel}</span>
              <Link href={`/educator/tools/professional/${m.slug}`} className="text-[12px] font-semibold text-violet-600 hover:text-violet-700 flex items-center gap-1">Open Tool →</Link>
            </div>
            {!m.live && <span className="mt-2 text-[9px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50 rounded px-1.5 py-0.5 self-start">scaffold · store soon</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
