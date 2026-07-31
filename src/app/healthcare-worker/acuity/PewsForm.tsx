"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { classifyPews } from "@/lib/hww/instruments";

// Rapid PEWS entry (HWW-WARD-ACU-001): score buttons 0-15, the category-3
// special trigger, live colour classification and the operational prompt.
// Competen records the ALREADY-CALCULATED total from the approved chart — it
// never computes PEWS from vitals. The server reclassifies authoritatively.

const btn = "px-3.5 py-2 rounded-lg bg-[var(--cmp-color-success)] text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50";
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";

export default function PewsForm({ patientId, patientLabel }: { patientId: string; patientLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [cat3, setCat3] = useState<boolean | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const band = useMemo(() => total == null ? null : classifyPews(total, cat3 === true), [total, cat3]);

  async function submit() {
    setBusy(true); setErr(null);
    const r = await fetch("/api/operations/assessments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "acuity", patient_id: patientId, framework: "pews", payload: { total, category3: cat3 === true }, notes }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d.error ?? "Failed"); return; }
    setOpen(false); setTotal(null); setCat3(null); setNotes("");
    router.refresh();
  }

  if (!open) return <button className="px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50" onClick={() => setOpen(true)}>+ Record PEWS</button>;

  return (
    <div className="mt-3 border border-[var(--cmp-color-success)] rounded-lg p-4 space-y-3 bg-[var(--cmp-surface-success)]/30 w-full">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-gray-800">Record PEWS — {patientLabel}</h4>
        {band && (
          <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${band.tone}`}>{total}{cat3 ? " + cat 3" : ""} · {band.label}</span>
        )}
        <button className="ml-auto text-xs text-gray-400 hover:text-gray-600" onClick={() => setOpen(false)}>Close</button>
      </div>

      <div>
        <p className="text-xs text-gray-600 mb-1.5">1 · Total PEWS score (from the approved chart)</p>
        <div className="grid grid-cols-8 gap-1.5">
          {Array.from({ length: 16 }, (_, n) => (
            <button key={n} onClick={() => setTotal(n)}
              className={`py-2 rounded-lg text-sm font-semibold tabular-nums border transition-colors ${total === n ? "bg-[var(--cmp-color-success)] text-white border-emerald-600" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}>
              {n}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs text-gray-600 mb-1.5">2 · Did any single PEWS category score 3?</p>
        <div className="flex gap-1.5">
          {[true, false].map(v => (
            <button key={String(v)} onClick={() => setCat3(v)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium border ${cat3 === v ? (v ? "bg-[var(--cmp-color-critical)] text-white border-red-600" : "bg-[var(--cmp-color-success)] text-white border-emerald-600") : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}>
              {v ? "Yes" : "No"}
            </button>
          ))}
        </div>
        {cat3 && <p className="text-[11px] text-[var(--cmp-text-critical)] mt-1">Special trigger — classification forces Critical (red) regardless of total.</p>}
      </div>

      {band && (
        <div className={`rounded-lg px-3 py-2 text-xs ${band.tone}`}>
          <span className="font-semibold">{band.label}:</span> {band.action} Reassessment due in {band.reassessMinutes >= 60 ? `${band.reassessMinutes / 60}h` : `${band.reassessMinutes} min`}.
        </div>
      )}

      <input className={input} placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
      {err && <p className="text-xs text-[var(--cmp-text-warning)]">{err}</p>}
      <button className={btn} disabled={busy || total == null || cat3 == null} onClick={submit}>{busy ? "Saving…" : "Save PEWS"}</button>
      <p className="text-[10px] text-gray-400">Vital signs and PEWS components stay on the approved clinical chart — this records the total for operational classification, escalation and reassessment tracking.</p>
    </div>
  );
}
