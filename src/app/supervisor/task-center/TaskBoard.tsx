"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Task Board (SSW-TSK-001 §Task Board) — Kanban over the real op_tasks lifecycle.
// Columns map to statuses (New → Accepted → In Progress → Awaiting Review →
// Completed). Cards advance with a click (drag-and-drop is a follow-up); each move
// is the audited PATCH /api/operations/tasks with legal-transition enforcement
// (verify requires a coordinator who didn't perform the task).
/* eslint-disable @typescript-eslint/no-explicit-any */

const PRIO_TONE: Record<string, string> = { Critical: "bg-rose-50 text-rose-700", High: "bg-orange-50 text-orange-700", Medium: "bg-amber-50 text-amber-700", Low: "bg-blue-50 text-blue-600" };
const COL_TONE: Record<string, string> = { new: "text-gray-600", accepted: "text-blue-600", in_progress: "text-violet-600", awaiting: "text-amber-600", completed: "text-green-600" };
const NEXT_LABEL: Record<string, string> = { accepted: "Accept", in_progress: "Start", completed: "Complete", verified: "Verify" };
const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "";

export default function TaskBoard({ columns, editable }: { columns: any[]; editable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function move(id: string, status: string) {
    setBusy(id); setErr(null);
    try {
      const res = await fetch(`/api/operations/tasks?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Move failed"); return; }
      router.refresh();
    } catch { setErr("Network error"); }
    finally { setBusy(null); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-gray-900">Task Board <span className="text-gray-400 font-normal">· all active tasks</span></h2>
        <span className="text-[10px] text-gray-400">click a card action to advance · drag-and-drop is a follow-up</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {columns.map((col) => (
          <div key={col.key} className="rounded-lg bg-gray-50/60 border border-gray-100 p-2">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className={`text-xs font-bold ${COL_TONE[col.key] ?? "text-gray-600"}`}>{col.label}</span>
              <span className="text-[10px] font-semibold text-gray-400 bg-white rounded-full px-1.5">{col.cards.length}</span>
            </div>
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
              {col.cards.length === 0 && <p className="text-[10px] text-gray-300 text-center py-3">—</p>}
              {col.cards.map((c: any) => (
                <div key={c.id} className={`rounded-lg border bg-white p-2 ${c.overdue ? "border-rose-200" : "border-gray-100"}`}>
                  <p className="text-[11px] font-medium text-gray-800 leading-tight line-clamp-2">{c.desc}</p>
                  <div className="flex items-center gap-1 mt-1">
                    {c.bed && <span className="text-[9px] text-gray-400">{c.bed}</span>}
                    <span className={`ml-auto text-[8px] font-semibold px-1 py-0.5 rounded ${PRIO_TONE[c.prioLabel] ?? "bg-gray-100 text-gray-600"}`}>{c.prioLabel}</span>
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    {c.due && <span className={`text-[9px] ${c.overdue ? "text-rose-600 font-semibold" : "text-gray-400"}`}>{c.overdue ? "⏱ " : ""}{fmt(c.due)}</span>}
                    {editable && col.next && (
                      <button onClick={() => move(c.id, col.next)} disabled={busy === c.id}
                        className="ml-auto text-[9px] font-semibold text-teal-700 hover:underline disabled:opacity-50">
                        {busy === c.id ? "…" : NEXT_LABEL[col.next]} →
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {err && <p className="text-[11px] text-rose-600 mt-2">{err}</p>}
    </div>
  );
}
