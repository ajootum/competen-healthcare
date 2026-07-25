"use client";

import { useState } from "react";

// Report an Incident (Loop 6) — the frontline worker's incident/near-miss report. Any authenticated staff
// member may REPORT (a safety right); the report writes op_incidents (hospital_id + reported_by bound to the
// caller server-side), which the Shift Supervisor and Unit Manager quality lenses read. Investigation/closure
// stays supervisor-tier. Posts to /api/operations/incidents.
const TYPES: [string, string][] = [["medication", "Medication"], ["falls", "Fall"], ["pressure_injury", "Pressure injury"], ["infection", "Infection / HAI"], ["equipment", "Equipment / device"], ["behaviour", "Behaviour"], ["documentation", "Documentation"], ["sentinel", "Sentinel event"], ["other", "Other"]];
const SEV: [string, string][] = [["low", "Low"], ["medium", "Medium"], ["high", "High"], ["critical", "Critical"]];
const input = "w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";

export default function ReportIncident({ ready }: { ready: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ incident_type: "other", severity: "medium", near_miss: false, description: "" });
  const set = (k: string, v: string | boolean) => setF(p => ({ ...p, [k]: v }));

  async function submit() {
    if (!f.description.trim()) { setErr("Please describe what happened."); return; }
    setBusy(true); setErr(null);
    const r = await fetch("/api/operations/incidents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    setBusy(false);
    if (r.ok) { setDone(true); setF({ incident_type: "other", severity: "medium", near_miss: false, description: "" }); }
    else { const d = await r.json().catch(() => ({})); setErr(d?.error || "Could not submit — please try again."); }
  }

  const card = "bg-white rounded-xl border border-gray-100";

  if (done) return (
    <div className={`${card} p-5`}>
      <div className="flex items-start gap-3">
        <span className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center text-lg shrink-0">✓</span>
        <div>
          <p className="text-sm font-semibold text-gray-900">Incident reported — thank you</p>
          <p className="text-xs text-gray-500 mt-0.5">Your report has gone to the shift supervisor and quality team for review. Reporting is about learning, not blame.</p>
          <button onClick={() => { setDone(false); setOpen(true); }} className="text-xs text-teal-600 hover:underline mt-2">Report another</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className={`${card} p-5`}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-1.5"><span>🚩</span>Report an Incident or Near-Miss</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">See something unsafe? Report it — it reaches your supervisor and the quality team.</p>
        </div>
        {!open && <button onClick={() => setOpen(true)} disabled={!ready} className="text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg px-3 py-2 disabled:opacity-50 shrink-0">+ Report</button>}
      </div>

      {!ready && <p className="text-[11px] text-amber-600 mt-2">Incident reporting activates once the operations store (migration 073) is provisioned.</p>}

      {open && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-gray-500">Type<select className={input} value={f.incident_type} onChange={e => set("incident_type", e.target.value)}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="text-xs text-gray-500">Severity<select className={input} value={f.severity} onChange={e => set("severity", e.target.value)}>{SEV.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          </div>
          <label className="text-xs text-gray-500 block">What happened?<textarea className={input} rows={3} value={f.description} onChange={e => set("description", e.target.value)} placeholder="Describe the incident or near-miss — what, where, and any immediate action taken." /></label>
          <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={f.near_miss} onChange={e => set("near_miss", e.target.checked)} className="rounded" />This was a near-miss (no harm reached the patient)</label>
          {err && <p className="text-xs text-rose-600">{err}</p>}
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => { setOpen(false); setErr(null); }} className="text-xs text-gray-500 hover:underline">Cancel</button>
            <button onClick={submit} disabled={busy || !f.description.trim()} className="text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg px-4 py-2 disabled:opacity-50">{busy ? "Submitting…" : "Submit report"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
