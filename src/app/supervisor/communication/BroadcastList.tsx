"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Broadcast Centre list (SSW-COM-001) — active broadcasts with acknowledgement
// tracking (acked / target) and a one-click Acknowledge that records the recipient.
/* eslint-disable @typescript-eslint/no-explicit-any */

const PRIO_TONE: Record<string, string> = { critical: "bg-rose-50 text-rose-700", high: "bg-orange-50 text-orange-700", medium: "bg-amber-50 text-amber-700", low: "bg-gray-100 text-gray-600" };
const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "";

export default function BroadcastList({ broadcasts, editable }: { broadcasts: any[]; editable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function ack(id: string) {
    setBusy(id); setErr(null);
    try {
      const res = await fetch(`/api/operations/broadcasts?id=${id}`, { method: "PATCH" });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Ack failed"); return; }
      router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(null); }
  }

  if (broadcasts.length === 0) return <p className="text-sm text-gray-400">No active broadcasts.</p>;
  return (
    <div className="space-y-2">
      {broadcasts.map((b) => (
        <div key={b.id} className={`rounded-lg border px-2.5 py-1.5 ${b.emergency ? "border-rose-200 bg-rose-50/40" : "border-gray-100"}`}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-800 truncate flex-1">{b.emergency ? "🚨 " : ""}{b.title}</span>
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${PRIO_TONE[b.priority] ?? "bg-gray-100 text-gray-600"}`}>{b.priority}</span>
            <span className="text-[10px] text-gray-400 shrink-0">{fmt(b.at)}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-gray-400 flex-1 truncate">{b.audience}</span>
            <span className="text-[10px] font-semibold text-gray-600 tabular-nums">{b.acked} / {b.target || "—"}</span>
            {editable && (b.userAcked
              ? <span className="text-[10px] text-green-600 font-semibold shrink-0">✓ acknowledged</span>
              : <button onClick={() => ack(b.id)} disabled={busy === b.id} className="text-[10px] font-semibold text-teal-700 hover:underline shrink-0">{busy === b.id ? "…" : "Acknowledge"}</button>)}
          </div>
        </div>
      ))}
      {err && <p className="text-[11px] text-rose-600 mt-1">{err}</p>}
    </div>
  );
}
