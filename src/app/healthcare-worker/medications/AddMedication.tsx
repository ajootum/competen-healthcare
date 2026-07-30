"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MED_ROUTES } from "@/lib/hww/medications";

// Add an operational schedule entry (HWW-MED-001) — name / dose DISPLAY /
// route / due time only. Not prescribing: this records what is already
// ordered so the shift can coordinate it.

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";
const btn = "px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50";

function nextHourLocal(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function AddMedication({ patients }: { patients: { id: string; label: string; bed: string | null }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [patientId, setPatientId] = useState(patients[0]?.id ?? "");
  const [drug, setDrug] = useState("");
  const [dose, setDose] = useState("");
  const [route, setRoute] = useState("oral");
  const [when, setWhen] = useState(nextHourLocal);
  const [highRisk, setHighRisk] = useState(false);
  const [doubleCheck, setDoubleCheck] = useState(false);
  const [allergy, setAllergy] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    const r = await fetch("/api/operations/medications", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "schedule", patient_id: patientId, drug_name: drug, dose_display: dose, route,
        scheduled_at: new Date(when).toISOString(), high_risk: highRisk, requires_double_check: doubleCheck, allergy_note: allergy,
      }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d.error ?? "Failed"); return; }
    setDrug(""); setDose(""); setAllergy(""); setHighRisk(false); setDoubleCheck(false); setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <button className={btn} onClick={() => setOpen(true)} disabled={patients.length === 0}>+ Add schedule entry</button>
        {patients.length === 0 && <span className="text-xs text-gray-400">You need an active patient assignment first.</span>}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-emerald-200 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">💊 Add schedule entry</h3>
        <button className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setOpen(false)}>Close</button>
      </div>
      {err && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{err}</p>}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <label className="text-sm"><span className="text-gray-600 text-xs">Patient</span>
          <select className={input} value={patientId} onChange={e => setPatientId(e.target.value)}>
            {patients.map(p => <option key={p.id} value={p.id}>{p.label}{p.bed ? ` · ${p.bed}` : ""}</option>)}
          </select>
        </label>
        <label className="text-sm"><span className="text-gray-600 text-xs">Medication name</span>
          <input className={input} placeholder="e.g. Amoxicillin" value={drug} onChange={e => setDrug(e.target.value)} />
        </label>
        <label className="text-sm"><span className="text-gray-600 text-xs">Dose (display only)</span>
          <input className={input} placeholder="e.g. 500 mg" value={dose} onChange={e => setDose(e.target.value)} />
        </label>
        <label className="text-sm"><span className="text-gray-600 text-xs">Route</span>
          <select className={input} value={route} onChange={e => setRoute(e.target.value)}>
            {MED_ROUTES.map(r => <option key={r} value={r}>{r.toUpperCase()}</option>)}
          </select>
        </label>
        <label className="text-sm"><span className="text-gray-600 text-xs">Due time</span>
          <input type="datetime-local" className={input} value={when} onChange={e => setWhen(e.target.value)} />
        </label>
        <label className="text-sm sm:col-span-2 lg:col-span-3"><span className="text-gray-600 text-xs">Allergy note (operational alert)</span>
          <input className={input} placeholder="e.g. penicillin allergy documented — verify before giving" value={allergy} onChange={e => setAllergy(e.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={highRisk} onChange={e => setHighRisk(e.target.checked)} /> High-risk medication</label>
        <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={doubleCheck} onChange={e => setDoubleCheck(e.target.checked)} /> Requires independent double-check</label>
        <span className="flex-1" />
        <button className={btn} disabled={busy || !drug.trim()} onClick={submit}>{busy ? "Adding…" : "Add to schedule"}</button>
      </div>
      <p className="text-[11px] text-gray-400">Operational coordination only — this records what is already ordered (name, route, due time). Prescribing and dose calculation remain in the EMR.</p>
    </div>
  );
}
