"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";

// Platform Search console (PFS-000 Search / PCS-000 Search Index). Debounced live
// search against /api/platform/search — results grouped by entity type, each a deep
// link. All work is server-side over Postgres ILIKE; this is a thin client.
type Hit = { type: string; icon: string; label: string; sub?: string | null; href: string };
type Group = { type: string; icon: string; hits: Hit[] };

export default function SearchConsole({ sources }: { sources: { type: string; icon: string }[] }) {
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async (term: string) => {
    if (term.trim().length < 2) { setGroups([]); setTotal(null); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/search?q=${encodeURIComponent(term)}`, { cache: "no-store" });
      const j = await res.json();
      setGroups(j.groups ?? []); setTotal(j.total ?? 0);
    } catch { setGroups([]); setTotal(0); }
    setBusy(false);
  }, []);

  function onChange(v: string) {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => run(v), 280);
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <input
          autoFocus value={q} onChange={e => onChange(e.target.value)}
          placeholder="Search tenants, users, organisations, frameworks, competencies, workspaces, activity…"
          className="w-full text-sm rounded-xl border border-gray-200 pl-10 pr-4 py-3 focus:border-teal-400 focus:outline-none"
        />
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
        {busy && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] text-gray-400">searching…</span>}
      </div>

      {total !== null && !busy && <p className="text-xs text-gray-400">{total} result{total === 1 ? "" : "s"} for “{q}”.</p>}

      {total === null ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-sm text-gray-500 mb-2">Searches across every indexed platform entity:</p>
          <div className="flex flex-wrap gap-2">{sources.map(s => <span key={s.type} className="text-xs text-gray-600 border border-gray-100 rounded-full px-2.5 py-1">{s.icon} {s.type}</span>)}</div>
        </div>
      ) : groups.length === 0 && !busy ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center"><p className="text-3xl mb-2">🔎</p><p className="text-sm text-gray-500">No matches. Try a different term (min 2 characters).</p></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {groups.map(g => (
            <div key={g.type} className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-bold text-gray-900 mb-2 flex items-center gap-1.5"><span>{g.icon}</span>{g.type}<span className="text-[10px] text-gray-400 font-normal">({g.hits.length})</span></h3>
              <div className="space-y-1">{g.hits.map((h, i) => (
                <Link key={i} href={h.href} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-teal-50/50 text-xs">
                  <span className="text-gray-800 font-medium flex-1 truncate">{h.label}</span>
                  {h.sub && <span className="text-gray-400 truncate max-w-[45%]">{h.sub}</span>}
                </Link>
              ))}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
