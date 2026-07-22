"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Shift-lifecycle state machine (SSW-002 §7) with a readiness-GATED transition
// control (§10 / §25 / §26). The engine computes the blocking reasons; the button
// is enabled only when no hard blocker exists, and the reasons are surfaced to the
// user rather than silently swallowed. ACTIVE sub-states (Degraded / Emergency,
// §7) and explicit command ownership (§5.2 / §8) are shown inline.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Blocker = { code: string; message: string; hard: boolean };
type Gate = { action: { status: string; label: string } | null; allowed: boolean; blockers: Blocker[] };
type Command = { owner: string | null; hasOwner: boolean; activeShifts: number; commandOwners: number; uncommanded: number };

export default function ShiftLifecycle({ states, index, subState, shiftStatus, gate, command, shiftId }: {
  states: string[]; index: number; subState: string | null; shiftStatus: string | null;
  gate: Gate; command: Command; shiftId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function advance() {
    if (!shiftId || !gate.action || !gate.allowed) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/operations/shifts?id=${shiftId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: gate.action.status }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Transition failed"); return; }
      router.refresh();
    } catch { setErr("Network error"); }
    finally { setBusy(false); }
  }

  const subTone = subState === "Emergency Operations" ? "bg-rose-100 text-rose-700 border-rose-200"
    : subState === "Degraded Operations" ? "bg-amber-100 text-amber-700 border-amber-200" : "";

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-gray-900">Shift Lifecycle</h2>
            {subState && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${subTone}`}>⚠ {subState}</span>}
          </div>
          <p className="text-[11px] text-gray-500">Scheduled → Pre-Shift → Ready → Active → Closure → Closed — every transition authenticated, timestamped &amp; audited.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {gate.action && shiftId ? (
            <button onClick={advance} disabled={busy || !gate.allowed}
              title={gate.allowed ? "" : "Blocked — see readiness reasons"}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg text-white ${gate.allowed ? "bg-teal-600 hover:bg-teal-700" : "bg-gray-300 cursor-not-allowed"} disabled:opacity-70`}>
              {busy ? "Working…" : gate.action.label}
            </button>
          ) : (
            <span className="text-[11px] text-gray-400">{shiftId ? "No manual transition" : "No open shift"}</span>
          )}
        </div>
      </div>

      {/* Command ownership (§5.2 / §8) */}
      <div className="flex items-center gap-2 mb-3 text-[11px]">
        {shiftStatus === "active" && !command.hasOwner ? (
          <span className="font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5">● No command owner — assign a supervisor</span>
        ) : (
          <span className="text-gray-600 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">👤 Command: <span className="font-semibold text-gray-800">{command.owner ?? "—"}</span></span>
        )}
        <span className="text-gray-400">·</span>
        <span className="text-gray-500">{command.activeShifts} active shift{command.activeShifts === 1 ? "" : "s"} · {command.commandOwners} owner{command.commandOwners === 1 ? "" : "s"}{command.uncommanded > 0 ? ` · ${command.uncommanded} uncommanded` : ""}</span>
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

      {/* Blocking reasons (§26) */}
      {gate.blockers.length > 0 && (
        <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
            {gate.allowed ? "Advisory before transition" : `${gate.action?.label ?? "Transition"} blocked`}
          </p>
          <div className="space-y-1">
            {gate.blockers.map((b) => (
              <div key={b.code} className="flex items-start gap-2 text-[11px]">
                <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${b.hard ? "bg-rose-500" : "bg-amber-500"}`} />
                <span className="text-gray-700"><span className="font-mono text-[10px] text-gray-400">{b.code}</span> — {b.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {err && <p className="text-[11px] text-rose-600 mt-2">{err}</p>}
    </div>
  );
}
