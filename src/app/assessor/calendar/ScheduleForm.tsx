"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type NurseOpt = { id: string; full_name: string };

const METHODS = [
  { value: "direct_observation",  label: "Direct Observation" },
  { value: "knowledge",           label: "Knowledge Assessment" },
  { value: "simulation",          label: "Simulation" },
  { value: "osce",                label: "OSCE" },
  { value: "concurrent_audit",    label: "Concurrent Audit" },
  { value: "retrospective_audit", label: "Chart Audit" },
];

const EMPTY = { nurse_id: "", method: "direct_observation", date: "", time: "09:00", location: "", note: "" };

export default function ScheduleForm({ nurses }: { nurses: NurseOpt[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await fetch("/api/schedule", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nurse_id: form.nurse_id, method: form.method,
        scheduled_for: `${form.date}T${form.time || "09:00"}:00`,
        location: form.location, note: form.note,
      }),
    });
    if (res.ok) { setForm(EMPTY); setOpen(false); router.refresh(); }
    else setError((await res.json().catch(() => ({}))).error ?? "Could not schedule");
    setBusy(false);
  }

  const input = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500";

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Schedule an Assessment</h2>
          <p className="text-[10px] text-gray-400">The nurse is notified as soon as you save.</p>
        </div>
        <button onClick={() => setOpen(o => !o)}
          className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition-colors">
          {open ? "Cancel" : "＋ Schedule"}
        </button>
      </div>

      {open && (
        <form onSubmit={submit} className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 border-t border-gray-50 pt-4">
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Nurse *</label>
            <select required value={form.nurse_id} onChange={e => setForm({ ...form, nurse_id: e.target.value })} className={input}>
              <option value="">Select nurse…</option>
              {nurses.map(n => <option key={n.id} value={n.id}>{n.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Method</label>
            <select value={form.method} onChange={e => setForm({ ...form, method: e.target.value })} className={input}>
              {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Date *</label>
              <input type="date" required value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className={input} />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Time</label>
              <input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} className={input} />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Location</label>
            <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="e.g. Paediatric ICU" className={input} />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Note</label>
            <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Optional context for the session" className={input} />
          </div>
          {error && <p className="sm:col-span-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
          <div className="sm:col-span-3">
            <button type="submit" disabled={busy}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors">
              {busy ? "Scheduling…" : "Schedule assessment"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
