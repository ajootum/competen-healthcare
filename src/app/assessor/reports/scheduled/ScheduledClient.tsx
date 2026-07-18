"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DATASET_LABELS } from "@/lib/report-datasets";

// Scheduled Reports client: create schedules (saved report or built-in
// dataset, frequency, in-app recipients), toggle active, delete.

export type ScheduleRow = {
  id: string; name: string; dataset: string | null; definition_id: string | null;
  frequency: string; recipients: string[]; active: boolean;
  next_run_at: string; last_run_at: string | null; last_status: string | null;
};
export type Option = { id: string; name: string };
export type DefOption = { id: string; name: string };

export default function ScheduledClient({ rows, definitions, staff }: {
  rows: ScheduleRow[]; definitions: DefOption[]; staff: Option[];
}) {
  const router = useRouter();
  const [showNew, setShowNew] = useState(rows.length === 0);
  const [name, setName] = useState("");
  const [source, setSource] = useState("dataset:assessments");
  const [frequency, setFrequency] = useState("weekly");
  const [recipients, setRecipients] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) { setError("Name the schedule first."); return; }
    if (!recipients.size) { setError("Pick at least one recipient."); return; }
    setBusy("new"); setError(null);
    const [kind, id] = source.split(":");
    const res = await fetch("/api/reports/schedules", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, frequency,
        definition_id: kind === "def" ? id : undefined,
        dataset: kind === "dataset" ? id : undefined,
        recipient_ids: [...recipients],
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) { setShowNew(false); setName(""); setRecipients(new Set()); router.refresh(); }
    else setError(d.error ?? "Could not create the schedule");
    setBusy(null);
  }

  async function toggle(row: ScheduleRow) {
    setBusy(row.id);
    await fetch("/api/reports/schedules", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id, active: !row.active }),
    });
    setBusy(null);
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("Delete this schedule?")) return;
    await fetch(`/api/reports/schedules?id=${id}`, { method: "DELETE" });
    router.refresh();
  }

  const nameOf = new Map(staff.map(s => [s.id, s.name]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{rows.filter(r => r.active).length} active · {rows.length} total</p>
        <button onClick={() => setShowNew(v => !v)}
          className="text-xs font-semibold text-white bg-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors">
          {showNew ? "Close" : "＋ New schedule"}
        </button>
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      {showNew && (
        <div className="bg-white border border-indigo-200 rounded-xl p-4">
          <div className="grid md:grid-cols-3 gap-2 mb-3">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Schedule name *"
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:border-indigo-400" />
            <select value={source} onChange={e => setSource(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-600 focus:outline-none focus:border-indigo-400">
              <optgroup label="Saved reports">
                {definitions.map(d => <option key={d.id} value={`def:${d.id}`}>{d.name}</option>)}
              </optgroup>
              <optgroup label="Built-in datasets">
                {Object.entries(DATASET_LABELS).map(([k, l]) => <option key={k} value={`dataset:${k}`}>{l}</option>)}
              </optgroup>
            </select>
            <select value={frequency} onChange={e => setFrequency(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-600 focus:outline-none focus:border-indigo-400">
              <option value="daily">Daily</option>
              <option value="weekly">Weekly (Mondays)</option>
              <option value="monthly">Monthly (1st)</option>
            </select>
          </div>
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Recipients ({recipients.size})</p>
          <div className="flex flex-wrap gap-1.5 mb-3 max-h-28 overflow-y-auto">
            {staff.map(s => (
              <button key={s.id}
                onClick={() => setRecipients(prev => { const x = new Set(prev); if (x.has(s.id)) x.delete(s.id); else x.add(s.id); return x; })}
                className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
                  recipients.has(s.id) ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"}`}>
                {s.name}
              </button>
            ))}
          </div>
          <button onClick={create} disabled={busy === "new"}
            className="text-xs font-bold text-white bg-indigo-600 rounded-lg px-4 py-2 hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {busy === "new" ? "Creating…" : "Create schedule"}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {rows.map(r => (
          <div key={r.id} className={`bg-white border rounded-xl px-4 py-3 ${r.active ? "border-gray-200" : "border-gray-100 opacity-60"}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <p className="text-sm font-medium text-gray-800">{r.name}</p>
                <p className="text-[10px] text-gray-400 mt-0.5" suppressHydrationWarning>
                  {r.definition_id ? "saved report" : (DATASET_LABELS[r.dataset ?? ""] ?? r.dataset)} · {r.frequency} · {r.recipients.length} recipient{r.recipients.length === 1 ? "" : "s"}
                  {" "}({r.recipients.slice(0, 3).map(id => nameOf.get(id) ?? "—").join(", ")}{r.recipients.length > 3 ? "…" : ""})
                  {" · next "}{new Date(r.next_run_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  {r.last_run_at ? ` · last: ${r.last_status ?? "run"}` : " · never run"}
                </p>
              </div>
              <button onClick={() => toggle(r)} disabled={busy === r.id}
                className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-40 ${
                  r.active ? "text-green-700 border-green-300 bg-green-50" : "text-gray-400 border-gray-200"}`}>
                {r.active ? "● Active" : "○ Paused"}
              </button>
              <button onClick={() => remove(r.id)} className="text-[10px] text-gray-300 hover:text-red-500 px-1">✕</button>
            </div>
          </div>
        ))}
        {!rows.length && !showNew && (
          <p className="bg-white border border-gray-200 rounded-xl px-4 py-8 text-center text-xs text-gray-400">No schedules yet.</p>
        )}
      </div>
    </div>
  );
}
