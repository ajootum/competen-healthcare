"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Replacement & Redeployment actions (UMW-WFM-005 §17) — raise a request for a gap, and
// fill / cancel an open request with a selected candidate, over op_replacement_requests via
// /api/operations/replacement (POST create, PATCH ?id= progress).
/* eslint-disable @typescript-eslint/no-explicit-any */

const ROLE_LABEL: Record<string, string> = { charge: "Charge Nurse", nurse: "Registered Nurse", support: "Healthcare Assistant", float: "Float / Bank", doctor: "Doctor", therapist: "Therapist" };
const PRI: Record<string, string> = { critical: "bg-rose-50 text-rose-700", high: "bg-amber-50 text-amber-700", normal: "bg-gray-100 text-gray-600", low: "bg-gray-100 text-gray-400" };
const ST: Record<string, string> = { identified: "bg-amber-50 text-amber-700", candidates_generated: "bg-sky-50 text-sky-700", offered: "bg-sky-50 text-sky-700", accepted: "bg-emerald-50 text-emerald-700", filled: "bg-emerald-50 text-emerald-700", redeployed: "bg-emerald-50 text-emerald-700", declined: "bg-gray-100 text-gray-500", cancelled: "bg-gray-100 text-gray-400", escalated: "bg-orange-50 text-orange-700" };

export default function ReplacementActions({ gaps, open, pool }: { gaps: any[]; open: any[]; pool: any[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});

  async function raise(g: any) {
    setBusy(g.id); setErr(null);
    try {
      const res = await fetch("/api/operations/replacement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shift_id: g.shiftId, absent_staff_id: g.staffId, role: g.role, priority: ["charge", "nurse"].includes(g.role) ? "high" : "normal", reason: "Attendance gap" }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error || `Failed (${res.status})`); } else router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(null); }
  }
  async function progress(reqId: string, action: string) {
    setBusy(reqId); setErr(null);
    const sel = pool.find(p => p.id === pick[reqId]);
    try {
      const res = await fetch(`/api/operations/replacement?id=${reqId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, selected_staff_id: sel?.id, selected_staff_name: sel?.full_name }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error || `Failed (${res.status})`); } else router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      {err && <div className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{err}</div>}

      {gaps.filter((g: any) => !g.hasRequest).length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-gray-500 uppercase mb-2">Gaps without a request</p>
          <div className="space-y-1.5">{gaps.filter((g: any) => !g.hasRequest).map((g: any) => (
            <div key={g.id} className="flex items-center justify-between rounded-lg border border-rose-100 bg-rose-50/30 p-2.5">
              <div><p className="text-xs font-semibold text-gray-800">{g.name}</p><p className="text-[11px] text-gray-500">{g.roleLabel} · {g.unit} · absent</p></div>
              <button disabled={busy === g.id} onClick={() => raise(g)} className="text-[10px] font-semibold px-2.5 py-1 rounded border border-rose-300 text-rose-700 hover:bg-rose-100 disabled:opacity-40">Raise replacement</button>
            </div>))}</div>
        </div>
      )}

      <div>
        <p className="text-[11px] font-semibold text-gray-500 uppercase mb-2">Requests</p>
        {open.length === 0 ? <p className="text-sm text-gray-400">No open replacement requests.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium">Priority</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 pr-3 font-medium">Candidate</th><th className="py-2 font-medium">Actions</th></tr></thead>
            <tbody>{open.map((r: any) => { const b = busy === r.id; return (
              <tr key={r.id} className="border-b border-gray-50">
                <td className="py-2 pr-3 text-gray-700">{r.roleLabel ?? ROLE_LABEL[r.role] ?? r.role}{r.is_redeployment && <span className="ml-1 text-[9px] text-violet-500">REDEPLOY</span>}</td>
                <td className="py-2 pr-3"><span className={`text-[9px] px-1.5 py-0.5 rounded ${PRI[r.priority] ?? PRI.normal}`}>{r.priority}</span></td>
                <td className="py-2 pr-3"><span className={`text-[9px] px-1.5 py-0.5 rounded ${ST[r.status] ?? "bg-gray-100 text-gray-500"}`}>{r.status.replace(/_/g, " ")}</span></td>
                <td className="py-2 pr-3"><select value={pick[r.id] ?? ""} onChange={e => setPick(p => ({ ...p, [r.id]: e.target.value }))} className="text-[11px] border border-gray-200 rounded px-1.5 py-1 max-w-[9rem] focus:outline-none focus:border-emerald-300"><option value="">— candidate —</option>{pool.map((p: any) => <option key={p.id} value={p.id}>{p.full_name} ({ROLE_LABEL[p.role] ?? p.role})</option>)}</select></td>
                <td className="py-2"><div className="flex gap-1"><button disabled={b || !pick[r.id]} onClick={() => progress(r.id, "fill")} className="text-[10px] px-2 py-1 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">Fill</button><button disabled={b} onClick={() => progress(r.id, "cancel")} className="text-[10px] px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40">Cancel</button></div></td>
              </tr>); })}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
