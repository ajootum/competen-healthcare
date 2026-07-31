"use client";

import { useEffect, useState, useCallback } from "react";
import { cardClass } from "@/components/ui/primitives";

// POS-001 Mission Control widget board — consumes /api/platform/operations live
// and refreshes on an interval (no page reload). Each tile is one POS-001
// service output; grey tiles are metrics this deployment doesn't meter yet.
/* eslint-disable @typescript-eslint/no-explicit-any */

const DOT: Record<string, string> = { ok: "bg-[var(--cmp-color-success)]", warn: "bg-[var(--cmp-color-warning)]", down: "bg-[var(--cmp-color-error)]", na: "bg-gray-300" };
const VAL: Record<string, string> = { ok: "text-gray-900", warn: "text-[var(--cmp-text-warning)]", down: "text-[var(--cmp-text-error)]", na: "text-gray-400" };
const ICON: Record<string, string> = { health: "💚", alerts: "🚨", tenants: "🏢", users: "👥", ai: "🧠", approvals: "✅", deployments: "🚀", jobs: "⚙️" };

export default function MissionControlBoard({ initial }: { initial: any }) {
  const [data, setData] = useState<any>(initial);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/platform/operations", { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } catch { /* keep last good */ }
    setBusy(false);
  }, []);

  // POS-001J — live via SSE; the server pushes updates, EventSource auto-reconnects on drop.
  useEffect(() => {
    const es = new EventSource("/api/platform/operations/stream");
    es.onopen = () => setLive(true);
    es.onmessage = (e) => { try { setData(JSON.parse(e.data)); } catch { /* ignore malformed frame */ } };
    es.onerror = () => setLive(false);
    return () => es.close();
  }, []);

  const widgets = data?.widgets ?? [];
  const time = data?.generatedAt ? new Date(data.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 text-[15px]">Mission Control <span className="ml-2 text-[10px] font-medium text-gray-400">{data?.summary?.live}/{data?.summary?.total} live · POS-001</span></h2>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="inline-flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-[var(--cmp-color-success)] animate-pulse" : "bg-[var(--cmp-color-warning)]"}`} />{live ? "live" : "reconnecting"}</span>
          {time && <span className="tabular-nums">· {time}</span>}
          <button onClick={refresh} disabled={busy} className="rounded-lg border border-gray-200 px-2 py-0.5 font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">↻</button>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {widgets.map((w: any) => (
          <div key={w.key} className="rounded-lg border border-gray-100 p-3" title={w.service}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide truncate">{w.label}</span>
              <span className="text-sm shrink-0">{ICON[w.key] ?? "•"}</span>
            </div>
            <p className={`text-2xl font-bold tabular-nums capitalize leading-tight ${VAL[w.status] ?? "text-gray-900"}`}>{w.value}</p>
            <p className="text-[10px] text-gray-400 truncate mt-0.5 flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT[w.status] ?? "bg-gray-300"}`} />{w.detail}</p>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 mt-3">Streamed live over SSE from <code className="font-mono">/api/platform/operations/stream</code> — the server pushes updates, no client polling. Grey tiles are outputs this deployment does not yet meter.</p>
    </div>
  );
}
