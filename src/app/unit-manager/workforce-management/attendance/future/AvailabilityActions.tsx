"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Record availability (UMW-WFM-005 §13) — a manager-confirmed availability declaration into
// op_staff_availability via /api/operations/availability.
/* eslint-disable @typescript-eslint/no-explicit-any */

const TYPES: { v: string; l: string }[] = [
  { v: "additional", l: "Available — additional shift" }, { v: "on_call", l: "On call" }, { v: "standby", l: "Standby" },
  { v: "redeployment", l: "Available — redeployment" }, { v: "overtime", l: "Available — overtime" },
  { v: "partial", l: "Partially available" }, { v: "temporarily_unavailable", l: "Temporarily unavailable" }, { v: "unavailable", l: "Unavailable" },
];

export default function AvailabilityActions({ picker }: { picker: any[] }) {
  const router = useRouter();
  const [staff, setStaff] = useState("");
  const [type, setType] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function submit() {
    if (!staff || !type) { setErr("Pick staff and availability"); return; }
    setBusy(true); setErr(null); setOk(false);
    try {
      const res = await fetch("/api/operations/availability", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ staff_id: staff, availability_type: type, period_start: start || null, period_end: end || null, expires_at: end || null }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error || `Failed (${res.status})`); }
      else { setOk(true); setStaff(""); setType(""); setStart(""); setEnd(""); router.refresh(); }
    } catch { setErr("Network error"); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select value={staff} onChange={e => setStaff(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-emerald-300"><option value="">— staff member —</option>{picker.map((p: any) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
        <select value={type} onChange={e => setType(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-emerald-300"><option value="">— availability —</option>{TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}</select>
        <label className="text-[10px] text-gray-400 flex items-center gap-1">From <input type="date" value={start} onChange={e => setStart(e.target.value)} className="text-xs border border-gray-200 rounded px-1.5 py-1 flex-1" /></label>
        <label className="text-[10px] text-gray-400 flex items-center gap-1">Until <input type="date" value={end} onChange={e => setEnd(e.target.value)} className="text-xs border border-gray-200 rounded px-1.5 py-1 flex-1" /></label>
      </div>
      <div className="flex items-center gap-2">
        <button disabled={busy} onClick={submit} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">{busy ? "Recording…" : "Record availability"}</button>
        {ok && <span className="text-[11px] text-emerald-600">Recorded ✓</span>}
        {err && <span className="text-[11px] text-rose-600">{err}</span>}
      </div>
    </div>
  );
}
