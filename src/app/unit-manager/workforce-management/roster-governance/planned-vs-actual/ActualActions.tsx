"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Planned-vs-actual confirmation (UMW-WFM-004 §17) — confirm actual attendance against a planned
// assignment into op_roster_actuals via /api/operations/roster-actuals. A SEPARATE record;
// never overwrites the planned roster (BR-EXA-013).
/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUSES: { v: string; l: string }[] = [
  { v: "attended", l: "Attended" }, { v: "approved_replacement", l: "Approved replacement" }, { v: "unapproved_replacement", l: "Unapproved replacement" },
  { v: "sickness", l: "Sickness" }, { v: "no_show", l: "No-show" }, { v: "late", l: "Late" }, { v: "early_departure", l: "Left early" },
  { v: "redeployed", l: "Redeployed" }, { v: "overtime_extension", l: "Overtime extension" }, { v: "cancelled", l: "Cancelled" },
];

export default function ActualActions({ rosterId, planned }: { rosterId: string; planned: any[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});

  async function confirm(p: any) {
    const status = pick[p.id];
    if (!status) { setErr("Pick an attendance status"); return; }
    setBusy(p.id); setErr(null);
    try {
      const res = await fetch("/api/operations/roster-actuals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roster_id: rosterId, roster_assignment_id: p.id, unit_name: p.unit, shift_date: p.date, shift_type: p.shift, staff_name: p.staff, attendance_status: status, variance_reason: reason[p.id] || null }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error || `Failed (${res.status})`); }
      else { setPick(x => ({ ...x, [p.id]: "" })); setReason(x => ({ ...x, [p.id]: "" })); router.refresh(); }
    } catch { setErr("Network error"); } finally { setBusy(null); }
  }

  if (planned.length === 0) return <p className="text-sm text-gray-400">No planned assignments to confirm.</p>;
  return (
    <div>
      {err && <div className="mb-2 text-xs text-rose-600">{err}</div>}
      <div className="overflow-x-auto"><table className="w-full text-xs">
        <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Staff</th><th className="py-2 pr-3 font-medium">Unit</th><th className="py-2 pr-3 font-medium">Date</th><th className="py-2 pr-3 font-medium">Actual</th><th className="py-2 font-medium">Confirm</th></tr></thead>
        <tbody>{planned.slice(0, 40).map((p: any) => { const b = busy === p.id; return (
          <tr key={p.id} className="border-b border-gray-50">
            <td className="py-2 pr-3 text-gray-800 font-medium">{p.staff ?? "—"}</td>
            <td className="py-2 pr-3 text-gray-500">{p.unit}</td>
            <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">{p.date ? new Date(p.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"} · {p.shift}</td>
            <td className="py-2 pr-3"><div className="flex gap-1"><select value={pick[p.id] ?? ""} onChange={e => setPick(x => ({ ...x, [p.id]: e.target.value }))} className="text-[10px] border border-gray-200 rounded px-1 py-0.5"><option value="">— status —</option>{STATUSES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}</select>{pick[p.id] && pick[p.id] !== "attended" && <input value={reason[p.id] ?? ""} onChange={e => setReason(x => ({ ...x, [p.id]: e.target.value }))} placeholder="reason" className="text-[10px] border border-gray-200 rounded px-1 py-0.5 w-20" />}</div></td>
            <td className="py-2"><button disabled={b || !pick[p.id]} onClick={() => confirm(p)} className="text-[10px] px-2 py-1 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">Confirm</button></td>
          </tr>); })}</tbody>
      </table></div>
    </div>
  );
}
