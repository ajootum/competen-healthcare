"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import { useRouter } from "next/navigation";

// WPS-001 planning-parameter editor. Edits the tenant's workforce-planning config and
// publishes it via /api/config/planning — the Establishment + WSE engines then consume
// the published values (falling back to defaults for anything unset). Audited + versioned.
const FIELDS = [
  { group: "Contract & shifts", keys: [["contractedHoursWeek", "Contracted hours/week", 1, 60, 0.5], ["shiftHours", "Shift length (h)", 6, 13, 0.5], ["shiftsPerDay", "Shifts/day (cover)", 1, 3, 1], ["maxShiftsWeek", "Max shifts/week", 2, 7, 1]] },
  { group: "Leave & relief (days/yr, %)", keys: [["annualLeaveDays", "Annual leave", 0, 45, 1], ["studyLeaveDays", "Study leave", 0, 20, 1], ["sicknessDays", "Sickness", 0, 20, 1], ["publicHolidays", "Public holidays", 0, 15, 1], ["floatPoolPct", "Float pool %", 0, 30, 1]] },
  { group: "Pay premiums (×)", keys: [["nightMultiplier", "Night differential", 1, 2, 0.05], ["overtimeMultiplier", "Overtime", 1, 2.5, 0.05], ["agencyMultiplier", "Agency", 1, 3, 0.1]] },
] as const;
const RATIOS: [string, string][] = [["critical_care", "ICU / critical (1:n)"], ["theatre", "Theatre (1:n)"], ["paediatric", "Paediatric (1:n)"], ["standard", "General ward (1:n)"]];

export default function PlanningEditor({ initial, version }: { initial: any; version: number }) {
  const router = useRouter();
  const [s, setS] = useState<any>({ ...initial, demandRatios: { ...initial.demandRatios } });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function publish() {
    setBusy(true); setErr(null); setMsg(null);
    const res = await fetch("/api/config/planning", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: s }) });
    setBusy(false);
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? "Failed"); return; }
    const j = await res.json(); setMsg(`Published config v${j.version} — engines now consume it.`); router.refresh();
  }

  if (!open) return (
    <div className="flex items-center justify-between">
      <p className="text-xs text-gray-500">Config v{version || "—"} · engines consume published values, falling back to defaults.</p>
      <button onClick={() => setOpen(true)} className="text-xs font-semibold rounded-lg py-2 px-3 bg-blue-600 text-white">Edit planning parameters</button>
    </div>
  );

  return (
    <div className="space-y-3">
      {FIELDS.map(f => (
        <div key={f.group}>
          <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1.5">{f.group}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{f.keys.map(([k, label, min, max, step]: any) => (
            <label key={k} className="text-[11px]"><span className="text-gray-600 block mb-0.5">{label}</span><input type="number" min={min} max={max} step={step} value={s[k]} onChange={e => setS({ ...s, [k]: Number(e.target.value) })} className="w-full text-xs rounded border border-gray-200 px-2 py-1.5" /></label>
          ))}</div>
        </div>
      ))}
      <div>
        <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1.5">Default staffing ratios (where no unit standard set)</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{RATIOS.map(([k, label]) => (
          <label key={k} className="text-[11px]"><span className="text-gray-600 block mb-0.5">{label}</span><input type="number" min={1} max={12} step={1} value={s.demandRatios[k]} onChange={e => setS({ ...s, demandRatios: { ...s.demandRatios, [k]: Number(e.target.value) } })} className="w-full text-xs rounded border border-gray-200 px-2 py-1.5" /></label>
        ))}</div>
      </div>
      {err && <p className="text-[10px] text-rose-600">{err}</p>}
      {msg && <p className="text-[10px] text-emerald-600">{msg}</p>}
      <div className="flex gap-2">
        <button onClick={publish} disabled={busy} className="text-xs font-semibold rounded-lg py-2 px-4 bg-blue-600 text-white disabled:opacity-50">{busy ? "Publishing…" : "Validate & Publish"}</button>
        <button onClick={() => { setOpen(false); setMsg(null); setErr(null); }} className="text-xs font-semibold rounded-lg py-2 px-3 border border-gray-200 text-gray-600">Close</button>
      </div>
      <p className="text-[10px] text-gray-400">Publishing validates &amp; clamps values, bumps the version and audit-logs the change. Draft workflow &amp; version rollback are next-phase.</p>
    </div>
  );
}
