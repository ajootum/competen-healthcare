"use client";

import { useState, useMemo } from "react";

// Log explorer (SYS-001.6) — client-side filter over the recent audit stream
// (actor, action, entity, category, free text). Operates on the real events the
// server already loaded — no extra query, instant filtering. A scoped
// server-side search over the full trail is a later phase.

const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const CAT_TONE: Record<string, string> = { Authentication: "bg-blue-50 text-blue-700", Authorization: "bg-violet-50 text-violet-700", "Admin Actions": "bg-amber-50 text-amber-700", "Data Access": "bg-rose-50 text-rose-700", System: "bg-gray-100 text-gray-600" };

type Event = { action: string; category: string; actor: string; entity: string; type: string; at: string };

export default function LogExplorer({ events }: { events: Event[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const categories = useMemo(() => [...new Set(events.map(e => e.category))].sort(), [events]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events.filter(e =>
      (!cat || e.category === cat) &&
      (!needle || `${e.action} ${e.actor} ${e.entity} ${e.type}`.toLowerCase().includes(needle))
    );
  }, [events, q, cat]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h2 className="font-semibold text-gray-900 text-[15px] mr-auto">Log Explorer</h2>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by actor, action, entity…" className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40 w-56" />
        <select value={cat} onChange={e => setCat(e.target.value)} className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40">
          <option value="">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-[10px] text-gray-400 tabular-nums">{filtered.length}/{events.length}</span>
      </div>
      {filtered.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No matching events.</p> : (
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white"><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
              <th className="px-3 py-2 font-semibold">Action</th><th className="px-3 py-2 font-semibold">Category</th><th className="px-3 py-2 font-semibold">Actor</th><th className="px-3 py-2 font-semibold">Target</th><th className="px-3 py-2 font-semibold text-right">When</th>
            </tr></thead>
            <tbody>
              {filtered.map((e, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="px-3 py-1.5 text-gray-700 capitalize">{(e.action ?? "").replace(/_/g, " ")}</td>
                  <td className="px-3 py-1.5"><span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${CAT_TONE[e.category] ?? "bg-gray-100 text-gray-600"}`}>{e.category}</span></td>
                  <td className="px-3 py-1.5 text-gray-500 text-[12px]">{e.actor}</td>
                  <td className="px-3 py-1.5 text-gray-500 text-[12px] truncate max-w-[220px]">{e.entity || <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-1.5 text-right text-[11px] text-gray-400 tabular-nums">{relTime(e.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[10px] text-gray-400 mt-2">Instant client-side filter over the most recent events. Scoped server-side search across the full immutable trail is a later phase.</p>
    </div>
  );
}
