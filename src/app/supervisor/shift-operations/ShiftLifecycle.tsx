"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Shift-lifecycle state machine (SSW-002 Ch.3) with a real advance control. The
// six spec states are display states; the advance action drives the actual
// op_shifts status transition (planned → active → completed) through the audited
// shifts API. "Escalation Mode" and "Handover" are operational overlays derived
// server-side, not separate op_shifts statuses, so they have no manual button.
/* eslint-disable @typescript-eslint/no-explicit-any */

export default function ShiftLifecycle({ states, current, index, nextAction, shiftId }: {
  states: string[]; current: string; index: number;
  nextAction: { status: string; label: string } | null; shiftId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function advance() {
    if (!shiftId || !nextAction) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/operations/shifts?id=${shiftId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextAction.status }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Transition failed"); return; }
      router.refresh();
    } catch { setErr("Network error"); }
    finally { setBusy(false); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Shift Lifecycle</h2>
          <p className="text-[11px] text-gray-500">Planning → Pre-Shift → Active → Escalation → Handover → Closed — every transition authenticated, timestamped &amp; audited.</p>
        </div>
        {nextAction && shiftId ? (
          <button onClick={advance} disabled={busy}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 shrink-0">
            {busy ? "Working…" : nextAction.label}
          </button>
        ) : (
          <span className="text-[11px] text-gray-400 shrink-0">{shiftId ? "No manual transition" : "No open shift"}</span>
        )}
      </div>

      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {states.map((s, i) => {
          const done = i < index, active = i === index;
          return (
            <div key={s} className="flex items-center gap-1 shrink-0">
              <div className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium border ${
                active ? "bg-teal-600 text-white border-teal-600"
                : done ? "bg-teal-50 text-teal-700 border-teal-200"
                : "bg-gray-50 text-gray-400 border-gray-200"}`}>
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                  active ? "bg-white text-teal-700" : done ? "bg-teal-500 text-white" : "bg-gray-200 text-gray-400"}`}>
                  {done ? "✓" : i + 1}
                </span>
                {s}
              </div>
              {i < states.length - 1 && <span className={`text-sm ${done ? "text-teal-400" : "text-gray-300"}`}>→</span>}
            </div>
          );
        })}
      </div>
      {err && <p className="text-[11px] text-rose-600 mt-2">{err}</p>}
    </div>
  );
}
