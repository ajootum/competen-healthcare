"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Absence classification (UMW-WFM-005 §15) — records the OPERATIONAL classification of an
// absent staff member into op_leave_records via /api/operations/leave. Operational only — no
// medical detail (§15.4). Each save is a new record; the register shows the latest.
/* eslint-disable @typescript-eslint/no-explicit-any */

const TYPES: { v: string; l: string }[] = [
  { v: "sick", l: "Sick leave" }, { v: "annual", l: "Annual leave" }, { v: "emergency", l: "Emergency" },
  { v: "compassionate", l: "Compassionate" }, { v: "study", l: "Study leave" }, { v: "training", l: "Training" },
  { v: "official_duty", l: "Official duty" }, { v: "maternity_parental", l: "Maternity / parental" },
  { v: "unpaid", l: "Unpaid leave" }, { v: "administrative", l: "Administrative" },
  { v: "occupational_restriction", l: "Occupational restriction" }, { v: "suspension", l: "Suspension" },
  { v: "unauthorised", l: "Unauthorised" }, { v: "no_show", l: "No-show" }, { v: "unknown", l: "Unclassified" },
];

function Row({ r }: { r: any }) {
  const router = useRouter();
  const [type, setType] = useState<string>(r.leave?.absence_type ?? "");
  const [repl, setRepl] = useState<boolean>(!!r.leave?.replacement_required);
  const [ret, setRet] = useState<string>(r.leave?.expected_return ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (!type) { setErr("Pick a type"); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/operations/leave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ staff_id: r.staffId, shift_id: r.shiftId, absence_type: type, replacement_required: repl, expected_return: ret || null }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error || `Failed (${res.status})`); }
      else { setSaved(true); router.refresh(); }
    } catch { setErr("Network error"); } finally { setBusy(false); }
  }

  return (
    <tr className="border-b border-gray-50 align-top">
      <td className="py-2 pr-3 text-gray-800 font-medium">{r.name}</td>
      <td className="py-2 pr-3 text-gray-500">{r.roleLabel}</td>
      <td className="py-2 pr-3 text-gray-500 capitalize">{r.unit}</td>
      <td className="py-2 pr-3"><select value={type} onChange={e => setType(e.target.value)} className="text-[11px] border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:border-emerald-300"><option value="">— classify —</option>{TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}</select></td>
      <td className="py-2 pr-3"><input type="date" value={ret} onChange={e => setRet(e.target.value)} className="text-[11px] border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:border-emerald-300" /></td>
      <td className="py-2 pr-3 text-center"><input type="checkbox" checked={repl} onChange={e => setRepl(e.target.checked)} className="accent-emerald-600" /></td>
      <td className="py-2"><button disabled={busy} onClick={save} className="text-[10px] px-2 py-1 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">{busy ? "…" : saved ? "Saved ✓" : "Save"}</button>{err && <span className="block text-[9px] text-rose-600">{err}</span>}</td>
    </tr>
  );
}

export default function LeaveActions({ rows }: { rows: any[] }) {
  if (rows.length === 0) return <p className="text-sm text-gray-400">No confirmed absences on active shifts. 🎉</p>;
  return (
    <div className="overflow-x-auto"><table className="w-full text-xs">
      <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Staff</th><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium">Unit</th><th className="py-2 pr-3 font-medium">Absence type</th><th className="py-2 pr-3 font-medium">Expected return</th><th className="py-2 pr-3 font-medium">Repl?</th><th className="py-2 font-medium"></th></tr></thead>
      <tbody>{rows.map(r => <Row key={r.id} r={r} />)}</tbody>
    </table></div>
  );
}
