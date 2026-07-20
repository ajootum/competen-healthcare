"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Admissions workflow (SSW-PO-001 §8) — registers an operational admission. This
// is the single entry point that adds a patient to the census: confirming it
// writes op_patients (which auto-logs an 'admission' movement event and occupies
// the bed), and every other Patient Operations view picks it up automatically.
/* eslint-disable @typescript-eslint/no-explicit-any */
const ACUITY = ["stable", "moderate", "high", "critical"];
const ISO = ["none", "contact", "droplet", "airborne", "protective"];
const STAGES = ["admitted", "in_care", "assessment", "treatment", "theatre", "recovery"];
const tc = (s: string) => (s ?? "").replace(/_/g, " ").split(" ").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
const input = "w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";

export default function AdmissionsWorkflow({ departments, beds }: { departments: any[]; beds: any[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const toast = (kind: "ok" | "err", text: string) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 5000); };
  const [f, setF] = useState<any>({ label: "", age_years: "", diagnosis: "", consultant: "", department_id: "", bed_id: "", acuity_level: "stable", isolation_status: "none", current_stage: "admitted" });
  const set = (k: string, v: string) => setF((p: any) => ({ ...p, [k]: v }));

  async function admit() {
    if (!f.label.trim()) { toast("err", "Operational label required"); return; }
    setBusy(true);
    const body: any = { label: f.label, acuity_level: f.acuity_level, isolation_status: f.isolation_status, current_stage: f.current_stage };
    if (f.age_years) body.age_years = f.age_years;
    if (f.diagnosis.trim()) body.diagnosis = f.diagnosis;
    if (f.consultant.trim()) body.consultant = f.consultant;
    if (f.department_id) body.department_id = f.department_id;
    if (f.bed_id) body.bed_id = f.bed_id;
    const r = await fetch("/api/operations/patients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (r.ok) { toast("ok", "Patient admitted — added to census"); setF({ label: "", age_years: "", diagnosis: "", consultant: "", department_id: "", bed_id: "", acuity_level: "stable", isolation_status: "none", current_stage: "admitted" }); router.refresh(); }
    else { const d = await r.json().catch(() => ({})); toast("err", d?.error || "Failed"); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">🆕 Admissions</h3>
          <p className="text-xs text-gray-500 mt-0.5">Register a new operational admission — the single entry point to the census.</p>
        </div>
        <button onClick={() => setOpen(o => !o)} className="text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-3.5 py-2">{open ? "Close" : "New admission"}</button>
      </div>
      {msg && <div className={`mt-3 text-sm rounded-lg px-4 py-2.5 ${msg.kind === "ok" ? "bg-green-50 text-green-800 border border-green-200" : "bg-amber-50 text-amber-800 border border-amber-200"}`}>{msg.text}</div>}
      {open && (
        <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <label className="text-xs text-gray-500">Operational label *<input className={input} placeholder="Bay 3 · J.M." value={f.label} onChange={e => set("label", e.target.value)} /></label>
          <label className="text-xs text-gray-500">Age (yrs)<input type="number" min={0} max={130} className={input} value={f.age_years} onChange={e => set("age_years", e.target.value)} /></label>
          <label className="text-xs text-gray-500">Working diagnosis<input className={input} value={f.diagnosis} onChange={e => set("diagnosis", e.target.value)} /></label>
          <label className="text-xs text-gray-500">Consultant<input className={input} value={f.consultant} onChange={e => set("consultant", e.target.value)} /></label>
          <label className="text-xs text-gray-500">Unit / department<select className={input} value={f.department_id} onChange={e => set("department_id", e.target.value)}><option value="">—</option>{departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label className="text-xs text-gray-500">Bed<select className={input} value={f.bed_id} onChange={e => set("bed_id", e.target.value)}><option value="">No bed yet…</option>{beds.map((b: any) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></label>
          <label className="text-xs text-gray-500">Initial acuity<select className={input} value={f.acuity_level} onChange={e => set("acuity_level", e.target.value)}>{ACUITY.map(a => <option key={a} value={a}>{tc(a)}</option>)}</select></label>
          <label className="text-xs text-gray-500">Isolation<select className={input} value={f.isolation_status} onChange={e => set("isolation_status", e.target.value)}>{ISO.map(a => <option key={a} value={a}>{tc(a)}</option>)}</select></label>
          <label className="text-xs text-gray-500">Stage<select className={input} value={f.current_stage} onChange={e => set("current_stage", e.target.value)}>{STAGES.map(a => <option key={a} value={a}>{tc(a)}</option>)}</select></label>
          <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
            <button disabled={busy || !f.label.trim()} onClick={admit} className="text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-4 py-2 disabled:opacity-50">Confirm admission</button>
          </div>
          <p className="sm:col-span-2 lg:col-span-3 text-[11px] text-gray-400">Operational identifier only (initials / bed alias) — not clinical documentation. Nurse assignment is done in Assignments.</p>
        </div>
      )}
    </div>
  );
}
