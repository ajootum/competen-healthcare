"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Today's Attendance register (UMW-WFM-005 §11) — the primary operational attendance register
// with real, audited, TIMESTAMPED actions via /api/operations/attendance: each action logs an
// append-only op_attendance_events row (migration 083) and updates op_shift_staff, computing
// minutes-late from the shift start on check-in. Confirm present / acknowledge / mark absent /
// complete. Corrections that retain the original record (§12.1 / BR-ATT-003) are next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUS: Record<string, { label: string; badge: string; dot: string }> = {
  on_duty: { label: "Present", badge: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  confirmed: { label: "Confirmed", badge: "bg-sky-50 text-sky-700", dot: "bg-sky-500" },
  assigned: { label: "Not reported", badge: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  absent: { label: "Absent", badge: "bg-rose-50 text-rose-700", dot: "bg-rose-500" },
  off_duty: { label: "Completed", badge: "bg-gray-100 text-gray-500", dot: "bg-gray-400" },
};
const FILTERS = [
  { key: "all", label: "All" },
  { key: "on_duty", label: "Present" },
  { key: "assigned", label: "Not reported" },
  { key: "absent", label: "Absent" },
  { key: "confirmed", label: "Confirmed" },
];

export default function AttendanceActions({ rows }: { rows: any[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function record(row: any, action: string) {
    setBusy(row.id); setErr(null);
    try {
      const res = await fetch(`/api/operations/attendance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shift_staff_id: row.id, action, method: "supervisor" }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error || `Failed (${res.status})`); }
      else router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(null); }
  }

  const shown = rows.filter(r => (filter === "all" || r.status === filter) && (!q || r.name.toLowerCase().includes(q.toLowerCase()) || r.roleLabel.toLowerCase().includes(q.toLowerCase())));

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="flex gap-1">{FILTERS.map(f => (<button key={f.key} onClick={() => setFilter(f.key)} className={`text-[11px] px-2.5 py-1 rounded-full border ${filter === f.key ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>{f.label}</button>))}</div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search staff…" className="ml-auto text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 w-44 focus:outline-none focus:border-emerald-300" />
      </div>
      {err && <div className="mb-2 text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{err}</div>}
      <div className="overflow-x-auto"><table className="w-full text-xs">
        <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Staff</th><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium">Unit / shift</th><th className="py-2 pr-3 font-medium">Attendance</th><th className="py-2 pr-3 font-medium">Arrival</th><th className="py-2 font-medium">Actions</th></tr></thead>
        <tbody>{shown.length === 0 ? <tr><td colSpan={6} className="py-6 text-center text-gray-400">No staff match.</td></tr> : shown.map(r => { const s = STATUS[r.status] ?? STATUS.assigned; const b = busy === r.id; return (
          <tr key={r.id} className="border-b border-gray-50">
            <td className="py-2 pr-3 text-gray-800 font-medium">{r.name}{r.supervisor && <span className="ml-1 text-[9px] text-indigo-500">SUP</span>}</td>
            <td className="py-2 pr-3 text-gray-500">{r.roleLabel}</td>
            <td className="py-2 pr-3 text-gray-500 capitalize">{r.unit} · {r.shiftType}</td>
            <td className="py-2 pr-3"><span className="inline-flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} /><span className={`text-[9px] px-1.5 py-0.5 rounded ${s.badge}`}>{s.label}</span></span></td>
            <td className="py-2 pr-3 whitespace-nowrap">{r.arrivalAt ? <span className="text-gray-600">{new Date(r.arrivalAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}{(r.minutesLate ?? 0) > 0 && <span className="text-amber-600 font-semibold"> +{r.minutesLate}m</span>}</span> : <span className="text-gray-300">—</span>}</td>
            <td className="py-2"><div className="flex gap-1 flex-wrap">
              {r.status !== "on_duty" && <button disabled={b} onClick={() => record(r, "check_in")} className="text-[10px] px-2 py-1 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">Confirm present</button>}
              {r.status === "assigned" && <button disabled={b} onClick={() => record(r, "acknowledge")} className="text-[10px] px-2 py-1 rounded border border-sky-200 text-sky-700 hover:bg-sky-50 disabled:opacity-40">Acknowledge</button>}
              {r.status !== "absent" && <button disabled={b} onClick={() => record(r, "mark_absent")} className="text-[10px] px-2 py-1 rounded border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-40">Mark absent</button>}
              {r.status === "on_duty" && <button disabled={b} onClick={() => record(r, "check_out")} className="text-[10px] px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40">Completed</button>}
            </div></td>
          </tr>
        ); })}</tbody>
      </table></div>
    </div>
  );
}
