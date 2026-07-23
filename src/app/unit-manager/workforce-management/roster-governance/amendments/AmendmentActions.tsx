"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Amendment actions (UMW-WFM-004 §16) — create a post-publication amendment and progress its
// lifecycle over op_roster_amendments via /api/operations/roster-amendments.
/* eslint-disable @typescript-eslint/no-explicit-any */

const TYPES: { v: string; l: string }[] = [
  { v: "swap", l: "Staff swap" }, { v: "reassignment", l: "Reassignment" }, { v: "sickness_replacement", l: "Sickness replacement" },
  { v: "leave_replacement", l: "Leave replacement" }, { v: "emergency_cover", l: "Emergency cover" }, { v: "supervisor_replacement", l: "Supervisor replacement" },
  { v: "cross_unit", l: "Cross-unit deployment" }, { v: "agency", l: "Agency" }, { v: "overtime", l: "Overtime" }, { v: "correction", l: "Correction" }, { v: "cancelled", l: "Cancelled shift" }, { v: "time_change", l: "Shift time change" }, { v: "role_change", l: "Role change" },
];
const ST: Record<string, string> = { requested: "bg-amber-50 text-amber-700", validated: "bg-sky-50 text-sky-700", approved: "bg-emerald-50 text-emerald-700", applied: "bg-emerald-50 text-emerald-700", rejected: "bg-gray-100 text-gray-500", cancelled: "bg-gray-100 text-gray-400" };

export function NewAmendment({ rosterId }: { rosterId: string }) {
  const router = useRouter();
  const [f, setF] = useState({ amendment_type: "", reason: "", from_staff_name: "", to_staff_name: "", emergency: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  async function submit() {
    if (!f.amendment_type) { setErr("Pick a type"); return; }
    setBusy(true); setErr(null); setOk(false);
    try {
      const res = await fetch("/api/operations/roster-amendments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roster_id: rosterId, ...f }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error || `Failed (${res.status})`); }
      else { setOk(true); setF({ amendment_type: "", reason: "", from_staff_name: "", to_staff_name: "", emergency: false }); router.refresh(); }
    } catch { setErr("Network error"); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select value={f.amendment_type} onChange={e => setF({ ...f, amendment_type: e.target.value })} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-emerald-300"><option value="">— amendment type —</option>{TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}</select>
        <input value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} placeholder="Reason" className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-emerald-300" />
        <input value={f.from_staff_name} onChange={e => setF({ ...f, from_staff_name: e.target.value })} placeholder="From staff (optional)" className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-emerald-300" />
        <input value={f.to_staff_name} onChange={e => setF({ ...f, to_staff_name: e.target.value })} placeholder="To staff (optional)" className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-emerald-300" />
      </div>
      <div className="flex items-center gap-3">
        <label className="text-[11px] text-gray-500 flex items-center gap-1"><input type="checkbox" checked={f.emergency} onChange={e => setF({ ...f, emergency: e.target.checked })} className="accent-rose-600" /> Emergency (retrospective review)</label>
        <button disabled={busy} onClick={submit} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">{busy ? "Creating…" : "Create amendment"}</button>
        {ok && <span className="text-[11px] text-emerald-600">Created ✓</span>}
        {err && <span className="text-[11px] text-rose-600">{err}</span>}
      </div>
    </div>
  );
}

export function AmendmentRegister({ rows }: { rows: any[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function progress(id: string, action: string) {
    setBusy(id); setErr(null);
    try {
      const res = await fetch(`/api/operations/roster-amendments?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error || `Failed (${res.status})`); } else router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(null); }
  }
  if (rows.length === 0) return <p className="text-sm text-gray-400">No open amendments. Create one above.</p>;
  return (
    <div>
      {err && <div className="mb-2 text-xs text-rose-600">{err}</div>}
      <div className="overflow-x-auto"><table className="w-full text-xs">
        <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Type</th><th className="py-2 pr-3 font-medium">Detail</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 font-medium">Actions</th></tr></thead>
        <tbody>{rows.map((a: any) => { const b = busy === a.id; return (
          <tr key={a.id} className="border-b border-gray-50">
            <td className="py-2 pr-3 text-gray-700">{(a.amendment_type ?? "").replace(/_/g, " ")}{a.emergency && <span className="ml-1 text-[9px] text-rose-500">EMERGENCY</span>}</td>
            <td className="py-2 pr-3 text-gray-500">{a.from_staff_name && a.to_staff_name ? `${a.from_staff_name} → ${a.to_staff_name}` : (a.reason ?? "—")}</td>
            <td className="py-2 pr-3"><span className={`text-[9px] px-1.5 py-0.5 rounded ${ST[a.approval_status] ?? "bg-gray-100 text-gray-500"}`}>{a.approval_status}</span></td>
            <td className="py-2"><div className="flex gap-1 flex-wrap">
              {a.approval_status === "requested" && <button disabled={b} onClick={() => progress(a.id, "validate")} className="text-[10px] px-2 py-1 rounded border border-sky-200 text-sky-700 hover:bg-sky-50 disabled:opacity-40">Validate</button>}
              {["requested", "validated"].includes(a.approval_status) && <button disabled={b} onClick={() => progress(a.id, "approve")} className="text-[10px] px-2 py-1 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">Approve</button>}
              {a.approval_status === "approved" && <button disabled={b} onClick={() => progress(a.id, "apply")} className="text-[10px] px-2 py-1 rounded border border-emerald-300 text-emerald-800 hover:bg-emerald-50 disabled:opacity-40">Apply</button>}
              <button disabled={b} onClick={() => progress(a.id, "reject")} className="text-[10px] px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40">Reject</button>
            </div></td>
          </tr>); })}</tbody>
      </table></div>
    </div>
  );
}
