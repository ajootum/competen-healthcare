"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Pre-shift readiness checklist (SSW-002 §6.4 / §9.3). Mandatory items gate
// activation — completing them clears the READINESS_INCOMPLETE blocker on the
// lifecycle control. Each toggle writes through the audited readiness API; a
// documented exception (not-applicable-with-reason) also satisfies the gate.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Item = { code: string; label: string; mandatory: boolean; status: string; responsible: string | null; exception: string | null };

const DONE = new Set(["complete", "not_applicable", "exception"]);

export default function ReadinessChecklist({ shiftId, items, provisioned, mandatoryComplete, mandatoryTotal, editable }: {
  shiftId: string | null; items: Item[]; provisioned: boolean;
  mandatoryComplete: number; mandatoryTotal: number; editable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!provisioned) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-bold text-gray-900">Shift Readiness</h2>
        <div className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-4 text-center">
          <p className="text-sm text-gray-500">Readiness checklist not provisioned</p>
          <p className="text-[11px] text-gray-400 mt-1">Run migration <span className="font-mono">064-shift-readiness</span> to enable the formal pre-shift sign-off. Until then the activation gate uses inferred preconditions.</p>
        </div>
      </div>
    );
  }

  async function setStatus(code: string, status: string) {
    if (!shiftId || !editable) return;
    let body: any = { item_code: code, status };
    if (status === "exception") {
      const reason = typeof window !== "undefined" ? window.prompt("Reason for documented exception:") : "";
      if (!reason || !reason.trim()) return;
      body = { ...body, exception_reason: reason.trim() };
    }
    setBusy(code); setErr(null);
    try {
      const res = await fetch(`/api/operations/readiness?shift_id=${shiftId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Update failed"); return; }
      router.refresh();
    } catch { setErr("Network error"); }
    finally { setBusy(null); }
  }

  const pct = mandatoryTotal ? Math.round((mandatoryComplete / mandatoryTotal) * 100) : 100;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Shift Readiness</h2>
          <p className="text-[11px] text-gray-500">Mandatory items gate activation (SSW-002 §10.1)</p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-lg font-bold tabular-nums ${pct === 100 ? "text-green-600" : "text-amber-600"}`}>{mandatoryComplete}/{mandatoryTotal}</p>
          <p className="text-[10px] text-gray-400">mandatory ready</p>
        </div>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-3">
        <div className={`h-full rounded-full ${pct === 100 ? "bg-green-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="space-y-1">
        {items.map((it) => {
          const done = DONE.has(it.status);
          return (
            <div key={it.code} className="flex items-center gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5">
              <button
                onClick={() => setStatus(it.code, done ? "pending" : "complete")}
                disabled={!editable || busy === it.code}
                title={editable ? (done ? "Mark pending" : "Mark complete") : "Read-only"}
                className={`w-5 h-5 rounded-md border-2 flex items-center justify-center text-[11px] shrink-0 ${done ? "bg-teal-500 border-teal-500 text-white" : "border-gray-300 text-transparent hover:border-teal-400"} ${editable ? "cursor-pointer" : "cursor-default opacity-70"}`}>
                ✓
              </button>
              <div className="min-w-0 flex-1">
                <p className={`text-xs leading-tight ${done ? "text-gray-500 line-through decoration-gray-300" : "text-gray-800"}`}>{it.label}
                  {it.mandatory && <span className="ml-1.5 text-[8px] font-bold uppercase text-rose-500/70">req</span>}
                </p>
                {it.status === "exception" && it.exception && <p className="text-[10px] text-amber-600 truncate">Exception: {it.exception}</p>}
                {done && it.responsible && it.status !== "exception" && <p className="text-[10px] text-gray-400 truncate">{it.responsible}</p>}
              </div>
              {editable && !done && (
                <button onClick={() => setStatus(it.code, "exception")} disabled={busy === it.code}
                  className="text-[10px] text-amber-600 hover:underline shrink-0">exception</button>
              )}
              {editable && it.status === "exception" && (
                <button onClick={() => setStatus(it.code, "not_applicable")} disabled={busy === it.code}
                  className="text-[10px] text-gray-400 hover:underline shrink-0">N/A</button>
              )}
            </div>
          );
        })}
      </div>
      {err && <p className="text-[11px] text-rose-600 mt-2">{err}</p>}
      {!editable && <p className="text-[10px] text-gray-400 mt-2">Read-only — readiness is completed before the shift is activated.</p>}
    </div>
  );
}
