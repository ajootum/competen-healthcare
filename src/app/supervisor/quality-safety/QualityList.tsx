"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { QUALITY_TYPE_LABEL } from "@/lib/operations/quality-safety";

// Quality-action list (SSW-QSE-001 §5) — advance CAPA/audit/PDSA status inline.
/* eslint-disable @typescript-eslint/no-explicit-any */

const PRIO_TONE: Record<string, string> = { high: "bg-orange-50 text-orange-700", medium: "bg-amber-50 text-amber-700", low: "bg-gray-100 text-gray-600" };
const ST_TONE: Record<string, string> = { open: "text-gray-600", in_progress: "text-blue-600", overdue: "text-rose-600", completed: "text-green-600" };
const NEXT: Record<string, { status: string; label: string }> = { open: { status: "in_progress", label: "start" }, in_progress: { status: "completed", label: "complete" }, overdue: { status: "completed", label: "complete" } };

export default function QualityList({ actions, editable }: { actions: any[]; editable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function move(id: string, status: string) {
    setBusy(id); setErr(null);
    try {
      const res = await fetch(`/api/operations/quality-actions?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Update failed"); return; }
      router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(null); }
  }
  if (actions.length === 0) return <p className="text-xs text-gray-400">No open quality actions.</p>;
  return (
    <div className="space-y-1.5">
      {actions.map((a: any) => {
        const nx = NEXT[a.status];
        return (
          <div key={a.id} className="flex items-center gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5"><span className="text-xs font-medium text-gray-800 truncate">{a.title}</span><span className={`text-[8px] px-1 py-0.5 rounded ${PRIO_TONE[a.priority] ?? "bg-gray-100"}`}>{a.priority}</span></div>
              <p className="text-[10px] text-gray-400">{QUALITY_TYPE_LABEL[a.type] ?? a.type}{a.owner ? ` · ${a.owner}` : ""}</p>
            </div>
            <span className={`text-[9px] font-medium capitalize shrink-0 ${ST_TONE[a.status] ?? "text-gray-500"}`}>{(a.status ?? "").replace(/_/g, " ")}</span>
            {editable && nx && <button onClick={() => move(a.id, nx.status)} disabled={busy === a.id} className="text-[10px] font-semibold text-teal-700 hover:underline shrink-0">{nx.label}</button>}
          </div>
        );
      })}
      {err && <p className="text-[11px] text-rose-600 mt-1">{err}</p>}
    </div>
  );
}
