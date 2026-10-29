"use client";

import Link from "next/link";
import { useState } from "react";

// CFCA-STUDIO-UX-02, the framework library: find a shared framework by name or code, filter by layer and status, open it.
// The cards show real counts read on the server, nothing simulated.

export type LibraryCard = { id: string; name: string; code: string | null; layer: string | null; status: string; statusLabel: string; profession: string | null; domains: number; competencies: number; criteria: number };

const select = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13.5px] pointer-coarse:min-h-[var(--cmp-touch-min)]";

export default function FrameworkLibrary({ cards }: { cards: LibraryCard[] }) {
  const [q, setQ] = useState("");
  const [layer, setLayer] = useState("all");
  const [status, setStatus] = useState("all");
  const layers = [...new Set(cards.map(c => c.layer).filter((l): l is string => !!l))].sort();
  const statuses = [...new Map(cards.map(c => [c.status, c.statusLabel])).entries()];
  const query = q.trim().toLowerCase();
  const shown = cards.filter(c => (!query || c.name.toLowerCase().includes(query) || (c.code ?? "").toLowerCase().includes(query))
    && (layer === "all" || c.layer === layer) && (status === "all" || c.status === status));
  return (
    <div>
      <div className="flex flex-wrap gap-3">
        <label className="sr-only" htmlFor="lib-q">Search frameworks</label>
        <input id="lib-q" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by framework name or code…" className={`${select} min-w-0 flex-1`} />
        <label className="sr-only" htmlFor="lib-layer">Layer</label>
        <select id="lib-layer" value={layer} onChange={e => setLayer(e.target.value)} className={select}>
          <option value="all">All layers</option>{layers.map(l => <option key={l} value={l}>{l[0].toUpperCase() + l.slice(1)}</option>)}
        </select>
        <label className="sr-only" htmlFor="lib-status">Status</label>
        <select id="lib-status" value={status} onChange={e => setStatus(e.target.value)} className={select}>
          <option value="all">All statuses</option>{statuses.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <p className="mt-3 text-[12.5px] text-gray-600" aria-live="polite">{shown.length} framework{shown.length === 1 ? "" : "s"}</p>
      {shown.length === 0 ? <p className="mt-3 rounded-xl border border-dashed border-gray-300 p-6 text-center text-[13.5px] text-gray-600">No framework matches. Clear the search or filters.</p> : (
        <ul className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map(c => (
            <li key={c.id} className="flex flex-col rounded-2xl border border-gray-200 bg-white p-5">
              <div className="flex items-start justify-between gap-2">
                <span aria-hidden className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-800">▤</span>
                <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[12px] font-semibold text-gray-800">{c.statusLabel}</span>
              </div>
              <h2 className="mt-3 text-[17px] font-bold text-gray-900">{c.name}</h2>
              <p className="mt-1 text-[12.5px] text-gray-600">{[c.code ?? "no code", c.layer ? c.layer[0].toUpperCase() + c.layer.slice(1) : null, c.profession].filter(Boolean).join(" · ")}</p>
              <p className="mt-3 text-[12.5px] text-gray-700">{c.domains} domains · {c.competencies} competencies{c.criteria ? ` · ${c.criteria} criteria` : ""}</p>
              <div className="mt-auto pt-4"><Link href={`/super-admin/competencies/authoring/${c.id}`} className="inline-flex items-center rounded-lg bg-teal-700 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-teal-800">Open framework →</Link></div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
