"use client";

import { useEffect, useState, useCallback } from "react";

// POS-002 Infrastructure Status Bar — consumes /api/runtime/status live and
// refreshes on an interval (no page reload), the reference "widgets fed by
// standardized runtime APIs" pattern. Honest "n/a" tiles for infra this
// deployment doesn't run.
/* eslint-disable @typescript-eslint/no-explicit-any */

const DOT: Record<string, string> = { ok: "bg-green-500", warn: "bg-amber-500", down: "bg-rose-500", na: "bg-gray-300" };
const VAL: Record<string, string> = { ok: "text-gray-900", warn: "text-amber-600", down: "text-rose-600", na: "text-gray-400" };

export default function InfraStatusBar({ initial }: { initial: any }) {
  const [data, setData] = useState<any>(initial);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [stamp, setStamp] = useState<string>(initial?.generatedAt ?? "");

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/runtime/status", { cache: "no-store" });
      if (r.ok) { const j = await r.json(); setData(j); setStamp(j.generatedAt); }
    } catch { /* keep last good */ }
    setBusy(false);
  }, []);

  // POS-001J — live via SSE; the server pushes updates, EventSource auto-reconnects on drop.
  useEffect(() => {
    const es = new EventSource("/api/runtime/stream");
    es.onopen = () => setLive(true);
    es.onmessage = (e) => { try { const j = JSON.parse(e.data); setData(j); setStamp(j.generatedAt); } catch { /* ignore malformed frame */ } };
    es.onerror = () => setLive(false);
    return () => es.close();
  }, []);

  const widgets = data?.widgets ?? [];
  const time = stamp ? new Date(stamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 text-[15px]">Infrastructure Status Bar <span className="ml-2 text-[10px] font-medium text-gray-400">{data?.summary?.live}/{data?.summary?.total} live · POS-002</span></h2>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="inline-flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-green-500 animate-pulse" : "bg-amber-400"}`} />{live ? "live" : "reconnecting"}</span>
          {time && <span className="tabular-nums">· {time}</span>}
          <button onClick={refresh} disabled={busy} className="rounded-lg border border-gray-200 px-2 py-0.5 font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">↻</button>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {widgets.map((w: any) => (
          <div key={w.key} className="rounded-lg border border-gray-100 p-3" title={w.detail}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT[w.status] ?? "bg-gray-300"}`} />
              <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide truncate">{w.label}</span>
            </div>
            <p className={`text-lg font-bold tabular-nums capitalize leading-tight ${VAL[w.status] ?? "text-gray-900"}`}>{w.value}</p>
            <p className="text-[10px] text-gray-400 truncate mt-0.5">{w.detail}</p>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 mt-3">Streamed live over SSE from <code className="font-mono">/api/runtime/stream</code> — the server pushes updates, no client polling. Tiles marked grey are infrastructure this deployment does not self-manage.</p>
    </div>
  );
}
