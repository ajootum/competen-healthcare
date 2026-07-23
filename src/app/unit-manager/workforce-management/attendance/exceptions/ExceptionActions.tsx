"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Attendance-exception actions (UMW-WFM-005 §18) — raise a derived exception into
// op_attendance_exceptions and progress its lifecycle via /api/operations/attendance-exceptions.
/* eslint-disable @typescript-eslint/no-explicit-any */

const SEV: Record<string, string> = { critical: "bg-rose-50 text-rose-700", high: "bg-amber-50 text-amber-700", moderate: "bg-sky-50 text-sky-700", low: "bg-gray-100 text-gray-500", informational: "bg-gray-100 text-gray-400" };
const ST: Record<string, string> = { new: "bg-amber-50 text-amber-700", under_review: "bg-sky-50 text-sky-700", awaiting_hr: "bg-sky-50 text-sky-700", corrected: "bg-emerald-50 text-emerald-700", approved_exception: "bg-emerald-50 text-emerald-700", rejected: "bg-gray-100 text-gray-500", escalated: "bg-orange-50 text-orange-700", closed: "bg-gray-100 text-gray-400" };

export function RaiseButtons({ derived }: { derived: any[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function raise(d: any) {
    setBusy(d.key); setErr(null);
    try {
      const res = await fetch("/api/operations/attendance-exceptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shift_id: d.shiftId, shift_staff_id: d.shiftStaffId, staff_id: d.staffId, staff_name: d.staff, category: d.category, severity: d.severity, operational_impact: d.detail }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error || `Failed (${res.status})`); } else router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(null); }
  }
  if (derived.length === 0) return <p className="text-sm text-gray-400">No new attendance exceptions detected. 🎉</p>;
  return (
    <div>
      {err && <div className="mb-2 text-xs text-rose-600">{err}</div>}
      <div className="space-y-1.5">{derived.map((d: any) => (
        <div key={d.key} className="flex items-center justify-between rounded-lg border border-gray-100 p-2.5">
          <div className="min-w-0"><div className="flex items-center gap-2"><span className={`text-[9px] px-1.5 py-0.5 rounded ${SEV[d.severity]}`}>{d.severity}</span><p className="text-xs font-semibold text-gray-800 truncate">{d.label}</p></div><p className="text-[11px] text-gray-500">{d.staff} · {d.unit} · {d.detail}</p></div>
          <button disabled={busy === d.key} onClick={() => raise(d)} className="shrink-0 text-[10px] font-semibold px-2.5 py-1 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">Raise</button>
        </div>))}</div>
    </div>
  );
}

export function ExceptionRegister({ rows }: { rows: any[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function progress(id: string, action: string) {
    setBusy(id); setErr(null);
    try {
      const res = await fetch(`/api/operations/attendance-exceptions?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error || `Failed (${res.status})`); } else router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(null); }
  }
  if (rows.length === 0) return <p className="text-sm text-gray-400">No open exceptions in the register. Raise one from the detected list.</p>;
  return (
    <div>
      {err && <div className="mb-2 text-xs text-rose-600">{err}</div>}
      <div className="overflow-x-auto"><table className="w-full text-xs">
        <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Category</th><th className="py-2 pr-3 font-medium">Staff</th><th className="py-2 pr-3 font-medium">Severity</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 font-medium">Actions</th></tr></thead>
        <tbody>{rows.map((e: any) => { const b = busy === e.id; return (
          <tr key={e.id} className="border-b border-gray-50">
            <td className="py-2 pr-3 text-gray-700">{(e.category ?? "").replace(/_/g, " ")}</td>
            <td className="py-2 pr-3 text-gray-800 font-medium">{e.staff_name ?? "—"}</td>
            <td className="py-2 pr-3"><span className={`text-[9px] px-1.5 py-0.5 rounded ${SEV[e.severity] ?? SEV.moderate}`}>{e.severity}</span></td>
            <td className="py-2 pr-3"><span className={`text-[9px] px-1.5 py-0.5 rounded ${ST[e.status] ?? "bg-gray-100 text-gray-500"}`}>{(e.status ?? "").replace(/_/g, " ")}</span></td>
            <td className="py-2"><div className="flex gap-1 flex-wrap">
              {e.status === "new" && <button disabled={b} onClick={() => progress(e.id, "review")} className="text-[10px] px-2 py-1 rounded border border-sky-200 text-sky-700 hover:bg-sky-50 disabled:opacity-40">Review</button>}
              <button disabled={b} onClick={() => progress(e.id, "resolve")} className="text-[10px] px-2 py-1 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">Resolve</button>
              <button disabled={b} onClick={() => progress(e.id, "escalate")} className="text-[10px] px-2 py-1 rounded border border-orange-200 text-orange-700 hover:bg-orange-50 disabled:opacity-40">Escalate</button>
            </div></td>
          </tr>); })}</tbody>
      </table></div>
    </div>
  );
}
