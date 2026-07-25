"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// My Assigned Training (Loop 2) — the worker's own learning_enrolments, with self-service Start / Mark-complete.
// Completing here flips the enrolment status, which is exactly what the UMW mandatory-compliance lens reads —
// so a worker finishing their training now moves the manager's compliance numbers. Writes are self-scoped
// server-side (/api/learning/my-enrolments, user_id = caller).
/* eslint-disable @typescript-eslint/no-explicit-any */
const statusTone = (s: string) => (s === "completed" ? "bg-green-50 text-green-700" : s === "overdue" ? "bg-rose-50 text-rose-700" : s === "in_progress" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-500");
const statusLabel: Record<string, string> = { completed: "Completed", in_progress: "In Progress", not_started: "Not Started", overdue: "Overdue", exempt: "Exempt" };

export default function MandatoryLearning({ items }: { items: any[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const toast = (kind: "ok" | "err", text: string) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 4000); };

  async function act(id: string, action: string, label: string) {
    setBusy(id + action);
    const r = await fetch(`/api/learning/my-enrolments?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    setBusy(null);
    if (r.ok) { toast("ok", label); router.refresh(); } else { const d = await r.json().catch(() => ({})); toast("err", d?.error || "Failed"); }
  }

  const card = "bg-white rounded-xl border border-gray-100";
  return (
    <div className={`${card} p-5`}>
      {msg && <div className={`fixed bottom-4 right-4 z-50 text-sm rounded-lg px-4 py-2.5 shadow-lg ${msg.kind === "ok" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>{msg.text}</div>}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 text-sm">My Assigned Training</h2>
        <span className="text-[10px] text-gray-400">{items.filter(i => i.status === "completed").length}/{items.length} complete</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-6">No training assigned to you yet. Your manager assigns mandatory learning, which appears here to complete. 🎓</p>
      ) : (
        <div className="space-y-2">
          {items.map((e: any) => (
            <div key={e.id} className={`rounded-lg border p-3 ${e.overdue ? "border-rose-100 bg-rose-50/30" : "border-gray-100"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{e.title}{e.mandatory && <span className="ml-1.5 text-[9px] font-semibold text-rose-600 uppercase">mandatory</span>}</p>
                  <p className="text-[10px] text-gray-400">{e.courseType ? `${e.courseType} · ` : ""}{e.dueLabel ? `due ${e.dueLabel}` : "no due date"}</p>
                </div>
                <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0 ${statusTone(e.overdue && e.status !== "completed" ? "overdue" : e.status)}`}>{statusLabel[e.overdue && e.status !== "completed" ? "overdue" : e.status] ?? e.status}</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden mt-2"><div className="h-full rounded-full bg-teal-500" style={{ width: `${e.progress}%` }} /></div>
              {e.status !== "completed" && e.status !== "exempt" && (
                <div className="flex items-center gap-2 mt-2">
                  {e.status === "not_started" && <button onClick={() => act(e.id, "in_progress", "Marked in progress")} disabled={busy != null} className="text-[11px] text-blue-700 hover:underline disabled:opacity-50">Start</button>}
                  <button onClick={() => act(e.id, "complete", "Training completed ✓")} disabled={busy != null} className="text-[11px] font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-2.5 py-1 disabled:opacity-50 ml-auto">Mark complete</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
