"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Incident list (SSW-QSE-001 §3) — advance the investigation lifecycle inline.
/* eslint-disable @typescript-eslint/no-explicit-any */

const SEV_TONE: Record<string, string> = { critical: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", high: "bg-[var(--cmp-surface-warning)] text-orange-700", medium: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", low: "bg-gray-100 text-gray-600" };
const NEXT: Record<string, { status: string; label: string }> = { reported: { status: "investigating", label: "investigate" }, investigating: { status: "awaiting_action", label: "awaiting action" }, awaiting_action: { status: "closed", label: "close" } };
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };

export default function IncidentList({ incidents, editable }: { incidents: any[]; editable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function move(id: string, status: string) {
    setBusy(id); setErr(null);
    try {
      const res = await fetch(`/api/operations/incidents?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Update failed"); return; }
      router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(null); }
  }
  if (incidents.length === 0) return <p className="text-xs text-gray-400">No incidents recorded this shift.</p>;
  return (
    <div className="space-y-1.5">
      {incidents.map((i: any) => {
        const nx = NEXT[i.status];
        return (
          <div key={i.id} className="rounded-lg border border-gray-100 px-2.5 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-semibold uppercase text-gray-400">{(i.type ?? "").replace(/_/g, " ")}</span>
              {i.nearMiss && <span className="text-[8px] px-1 rounded bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]">near miss</span>}
              <span className={`text-[8px] font-semibold px-1 py-0.5 rounded ${SEV_TONE[i.severity] ?? "bg-gray-100"}`}>{i.severity}</span>
              <span className="ml-auto text-[10px] text-gray-400">{relTime(i.at)}</span>
            </div>
            <p className="text-xs text-gray-800 mt-0.5 truncate">{i.patient ? `${i.patient} — ` : ""}{i.desc}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[9px] font-medium text-gray-500 capitalize">{(i.status ?? "").replace(/_/g, " ")}</span>
              {editable && nx && <button onClick={() => move(i.id, nx.status)} disabled={busy === i.id} className="text-[10px] font-semibold text-teal-700 hover:underline">→ {nx.label}</button>}
            </div>
          </div>
        );
      })}
      {err && <p className="text-[11px] text-[var(--cmp-text-error)] mt-1">{err}</p>}
    </div>
  );
}
