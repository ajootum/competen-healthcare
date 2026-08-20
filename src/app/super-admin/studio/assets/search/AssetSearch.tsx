"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

/* eslint-disable @typescript-eslint/no-explicit-any */
const TYPE_LABEL: Record<string, string> = { framework: "Framework", competency: "Competency", skill: "Skill", cpu: "CPU", resource: "Learning resource", domain: "Domain", practice: "Practice", policy: "Policy" };
function hrefFor(type: string, id: string) {
  if (type === "framework") return `/super-admin/content/${id}`;
  if (type === "competency") return "/super-admin/content";
  if (type === "skill") return "/super-admin/studio/skills";
  if (type === "cpu") return "/super-admin/studio/cpus";
  if (type === "resource") return "/admin/resources";
  return "/super-admin/studio/assets";
}

export default function AssetSearch() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<any[]>([]);
  const [semantic, setSemantic] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => { const r = await fetch("/api/admin/embeddings/reindex"); if (r.ok) setStatus(await r.json()); }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadStatus(); }, [loadStatus]);

  async function run() {
    if (!q.trim()) { setHits([]); setNote(null); return; }
    setSearching(true);
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const j = await r.json().catch(() => ({ hits: [] }));
    setSearching(false);
    setHits(j.hits ?? []); setSemantic(!!j.semantic); setNote(j.note ?? null);
  }
  async function reindex(action: "enqueue" | "embed") {
    setBusy(true);
    const r = await fetch("/api/admin/embeddings/reindex", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, limit: 64 }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (j.status) setStatus(j.status);
    if (j.error) setNote(j.error);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="flex gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && run()} placeholder="Search competency assets — natural language or keywords…" className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-teal-400" />
          <button onClick={run} disabled={searching} className="text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg px-5">{searching ? "…" : "Search"}</button>
        </div>
        {note && <p className="text-[11px] text-gray-500 mt-2">{note}</p>}
        {hits.length > 0 && (
          <div className="mt-3 flex flex-col divide-y divide-gray-50">
            <p className="text-[10px] text-gray-500 mb-1">{hits.length} result{hits.length === 1 ? "" : "s"} · {semantic ? "hybrid (keyword + semantic)" : "keyword"}</p>
            {hits.map((h, i) => (
              <Link key={i} href={hrefFor(h.objectType, h.objectId)} className="py-2.5 group">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[9px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">{TYPE_LABEL[h.objectType] ?? h.objectType}</span>
                  <span className="text-sm font-semibold text-gray-800 group-hover:text-teal-700 truncate">{h.title || "Untitled"}</span>
                  <span className="ml-auto flex items-center gap-1 shrink-0">
                    {h.matched?.includes("semantic") && <span className="text-[8px] font-bold uppercase text-violet-600 bg-violet-50 border border-violet-100 rounded px-1 py-0.5">semantic{h.similarity ? ` ${h.similarity}` : ""}</span>}
                    {h.matched?.includes("keyword") && <span className="text-[8px] font-bold uppercase text-[var(--cmp-text-information)] bg-[var(--cmp-surface-information)] border border-[var(--cmp-color-information)] rounded px-1 py-0.5">keyword</span>}
                  </span>
                </div>
                {h.snippet && <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-2">{h.snippet}</p>}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Indexing (super-admin) */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-gray-900 text-sm">Semantic index</h2>
          {status && <span className={`text-[10px] font-semibold ${status.configured ? "text-teal-600" : "text-[var(--cmp-text-warning)]"}`}>{status.configured ? "provider configured" : "no embedding provider"}</span>}
        </div>
        {status ? (
          <>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div><p className="text-lg font-bold text-gray-900">{status.total}</p><p className="text-[10px] text-gray-500">Indexed rows</p></div>
              <div><p className="text-lg font-bold text-teal-600">{status.embedded}</p><p className="text-[10px] text-gray-500">Embedded</p></div>
              <div><p className="text-lg font-bold text-[var(--cmp-text-warning)]">{status.queued}</p><p className="text-[10px] text-gray-500">Queued</p></div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => reindex("enqueue")} disabled={busy} className="text-xs font-semibold text-gray-700 border border-gray-200 hover:bg-gray-50 rounded-lg px-3 py-1.5">1 · Enqueue assets</button>
              <button onClick={() => reindex("embed")} disabled={busy || !status.configured} className="text-xs font-semibold text-teal-700 border border-teal-200 bg-teal-50 hover:bg-teal-100 disabled:opacity-40 rounded-lg px-3 py-1.5" title={status.configured ? "" : "Set an embedding provider key first"}>2 · Embed a batch</button>
            </div>
            <p className="text-[10px] text-gray-500 mt-2">Enqueue registers asset content for indexing; embedding runs only with a provider key (dormant otherwise). Repeat “Embed a batch” until the queue is drained. Search works on keyword alone until then.</p>
          </>
        ) : <p className="text-xs text-gray-500">Loading index status…</p>}
      </div>
    </div>
  );
}
