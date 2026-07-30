"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Record an observation against the existing /api/operations/observations
// (nurse-permitted for assigned patients). Completing a DUE row passes its
// observation_id; ad-hoc recording creates a new row. EWS >= 5 or the concern
// flag auto-escalates server-side.

const OBS_TYPES = ["vital_signs", "neuro", "respiratory", "cardiovascular", "fluid_balance", "pain", "sedation", "pews", "gcs", "specialty"];
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";
const btn = "px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50";
const btnGhost = "px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50";

export default function RecordObs({ patientId, patientLabel, observationId, defaultType, compact }: {
  patientId: string; patientLabel: string; observationId?: string; defaultType?: string; compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(defaultType && OBS_TYPES.includes(defaultType) ? defaultType : "vital_signs");
  const [ews, setEws] = useState("");
  const [concern, setConcern] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/operations/observations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "record", patient_id: patientId, observation_id: observationId,
        observation_type: type, ews_score: ews === "" ? undefined : Number(ews),
        concern, findings: note ? { note } : {},
      }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(d.error ?? "Failed"); return; }
    setEws(""); setConcern(false); setNote(""); setOpen(false);
    if (d.escalation_triggered) setMsg("Recorded — deterioration auto-escalated to your coordinator.");
    router.refresh();
  }

  if (!open) {
    return (
      <span className="flex items-center gap-2">
        {msg && <span className="text-[10px] text-amber-700">{msg}</span>}
        <button className={btnGhost} onClick={() => setOpen(true)}>{compact ? "Record" : "+ Record observation"}</button>
      </span>
    );
  }

  return (
    <div className="mt-2 w-full border border-emerald-200 bg-emerald-50/30 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-800">{observationId ? "Complete due observation" : "Record observation"} — {patientLabel}</span>
        <button className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setOpen(false)}>Close</button>
      </div>
      <div className="grid sm:grid-cols-3 gap-2">
        <label className="text-xs text-gray-600">Type
          <select className={input} value={type} onChange={e => setType(e.target.value)}>{OBS_TYPES.map(t => <option key={t} value={t}>{titleCase(t)}</option>)}</select>
        </label>
        <label className="text-xs text-gray-600">PEWS / EWS (0–20)
          <input type="number" min={0} max={20} className={input} value={ews} onChange={e => setEws(e.target.value)} />
        </label>
        <label className="text-xs text-gray-600">Findings note
          <input className={input} placeholder="e.g. RR 22, SpO2 94%" value={note} onChange={e => setNote(e.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={concern} onChange={e => setConcern(e.target.checked)} /> Cause for concern (auto-escalates)</label>
        <span className="flex-1" />
        <button className={btn} disabled={busy} onClick={submit}>{busy ? "Recording…" : "Record"}</button>
      </div>
      {msg && <p className="text-xs text-amber-700">{msg}</p>}
    </div>
  );
}
