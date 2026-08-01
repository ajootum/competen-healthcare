"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Record a procedure (HWW-UI-005 s1). The primary action the empty state points at.
//
// CONSENT IS A THREE-STATE FIELD, not a checkbox. A checkbox has no way to say "not recorded", so an
// unticked box means both "no consent" and "nobody filled this in" -- and the record would then assert the
// more serious of the two every time someone was simply in a hurry. Site and laterality are optional for
// the same reason a checkbox is wrong: forcing "not applicable" onto every dressing change trains people
// to click past the field on the day it is a limb.

const CATEGORIES = [
  { v: "clinical", label: "Clinical" },
  { v: "non_clinical", label: "Non-clinical" },
];
const LATERALITY = ["", "left", "right", "bilateral", "not_applicable"];
const STATUSES = ["completed", "in_progress", "planned", "abandoned"];
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";
const btn = "px-3.5 py-2 rounded-lg bg-[var(--cmp-color-success)] text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50";
const ghost = "px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50";

export default function RecordProcedure({ patients }: { patients: { id: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [patientId, setPatientId] = useState(patients[0]?.id ?? "");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("clinical");
  const [status, setStatus] = useState("completed");
  const [site, setSite] = useState("");
  const [laterality, setLaterality] = useState("");
  const [consent, setConsent] = useState<"" | "yes" | "no">("");
  const [outcome, setOutcome] = useState("");
  const [complications, setComplications] = useState("");

  async function submit() {
    if (!patientId || !name.trim()) { setMsg("Pick a patient and name the procedure."); return; }
    setBusy(true); setMsg(null);
    const r = await fetch("/api/operations/procedures", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patient_id: patientId, procedure_name: name.trim(), category, status,
        site: site.trim() || null, laterality: laterality || null,
        consent_obtained: consent === "" ? null : consent === "yes",
        outcome: outcome.trim() || null, complications: complications.trim() || null,
      }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(d.error ?? "Failed to record procedure"); return; }
    setName(""); setSite(""); setLaterality(""); setConsent(""); setOutcome(""); setComplications("");
    setOpen(false);
    router.refresh();
  }

  if (!open) return <button onClick={() => setOpen(true)} className={btn}>Record procedure</button>;

  return (
    <div className="w-full sm:w-[30rem] bg-white rounded-xl border border-gray-200 p-4 space-y-2.5">
      <p className="text-sm font-semibold text-gray-900">Record a procedure</p>

      <select value={patientId} onChange={e => setPatientId(e.target.value)} className={input} aria-label="Patient">
        {patients.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>

      <input value={name} onChange={e => setName(e.target.value)} placeholder="Procedure (e.g. Peripheral cannulation)" className={input} aria-label="Procedure name" />

      <div className="grid grid-cols-2 gap-2">
        <select value={category} onChange={e => setCategory(e.target.value)} className={input} aria-label="Category">
          {CATEGORIES.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} className={input} aria-label="Status">
          {STATUSES.map(s => <option key={s} value={s}>{titleCase(s)}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input value={site} onChange={e => setSite(e.target.value)} placeholder="Site (optional)" className={input} aria-label="Site" />
        <select value={laterality} onChange={e => setLaterality(e.target.value)} className={input} aria-label="Laterality">
          {LATERALITY.map(l => <option key={l || "none"} value={l}>{l ? titleCase(l) : "Laterality —"}</option>)}
        </select>
      </div>

      <div>
        <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Consent</label>
        <select value={consent} onChange={e => setConsent(e.target.value as "" | "yes" | "no")} className={input} aria-label="Consent obtained">
          <option value="">Not recorded</option>
          <option value="yes">Consent obtained</option>
          <option value="no">Not obtained</option>
        </select>
      </div>

      <input value={outcome} onChange={e => setOutcome(e.target.value)} placeholder="Outcome (optional)" className={input} aria-label="Outcome" />
      <input value={complications} onChange={e => setComplications(e.target.value)} placeholder="Complications (optional)" className={input} aria-label="Complications" />

      {msg && <p className="text-xs text-[var(--cmp-text-critical)]">{msg}</p>}
      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={busy} className={btn}>{busy ? "Saving…" : "Save procedure"}</button>
        <button onClick={() => { setOpen(false); setMsg(null); }} className={ghost}>Cancel</button>
      </div>
    </div>
  );
}
