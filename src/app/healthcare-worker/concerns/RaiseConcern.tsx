"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Raise a bedside concern (HWW-ADD-001). Category/priority per the spec's
// dropdowns; ward-round + supervisor-review flags; patient list = the nurse's
// REAL active assignments (a concern is always about an assigned patient).

const CATS = ["clinical_deterioration", "pain", "wound", "medication", "nutrition", "family", "equipment", "discharge", "doctor_review", "allied_health", "infection_prevention", "other"];
const PRIOS = ["routine", "today", "urgent", "immediate"];
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";
const btn = "px-3.5 py-2 rounded-lg bg-[var(--cmp-color-success)] text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50";

export default function RaiseConcern({ patients }: { patients: { id: string; label: string; bed: string | null }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [patientId, setPatientId] = useState(patients[0]?.id ?? "");
  const [category, setCategory] = useState("clinical_deterioration");
  const [priority, setPriority] = useState("routine");
  const [description, setDescription] = useState("");
  const [wardRound, setWardRound] = useState(false);
  const [ssReview, setSsReview] = useState(false);

  async function submit() {
    if (!patientId || !description.trim()) { setMsg("Pick a patient and describe the concern."); return; }
    setBusy(true); setMsg(null);
    const r = await fetch("/api/operations/concerns", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patient_id: patientId, category, priority, description, ward_round: wardRound, ss_review: ssReview }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(d.error ?? "Failed to raise concern"); return; }
    setDescription(""); setWardRound(false); setSsReview(false); setPriority("routine"); setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <button className={btn} onClick={() => setOpen(true)} disabled={patients.length === 0}>🚩 Raise a concern</button>
        {patients.length === 0 && <span className="text-xs text-gray-400">You need an active patient assignment to raise a concern.</span>}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-[var(--cmp-color-success)] p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">🚩 Raise a concern</h3>
        <button className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setOpen(false)}>Close</button>
      </div>
      {msg && <p className="text-sm text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-lg px-3 py-2">{msg}</p>}
      <div className="grid sm:grid-cols-3 gap-2">
        <label className="text-sm"><span className="text-gray-600 text-xs">Patient</span>
          <select className={input} value={patientId} onChange={e => setPatientId(e.target.value)}>
            {patients.map(p => <option key={p.id} value={p.id}>{p.label}{p.bed ? ` · ${p.bed}` : ""}</option>)}
          </select>
        </label>
        <label className="text-sm"><span className="text-gray-600 text-xs">Category</span>
          <select className={input} value={category} onChange={e => setCategory(e.target.value)}>
            {CATS.map(x => <option key={x} value={x}>{titleCase(x)}</option>)}
          </select>
        </label>
        <label className="text-sm"><span className="text-gray-600 text-xs">Priority</span>
          <select className={input} value={priority} onChange={e => setPriority(e.target.value)}>
            {PRIOS.map(x => <option key={x} value={x}>{titleCase(x)}</option>)}
          </select>
        </label>
      </div>
      <textarea className={`${input} min-h-[70px]`} placeholder="Brief operational summary (not a medical note — diagnoses and prescriptions stay in the EMR)"
        value={description} onChange={e => setDescription(e.target.value)} />
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={wardRound} onChange={e => setWardRound(e.target.checked)} /> Discuss at ward round</label>
        <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={ssReview} onChange={e => setSsReview(e.target.checked)} /> Supervisor review requested</label>
        <span className="flex-1" />
        <button className={btn} disabled={busy} onClick={submit}>{busy ? "Raising…" : "Raise concern"}</button>
      </div>
      <p className="text-[11px] text-gray-400">Immediate/urgent priorities and supervisor-review requests notify your shift supervisor. All changes are audit-logged.</p>
    </div>
  );
}
