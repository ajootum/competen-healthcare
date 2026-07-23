"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Roster exception actions (UMW-WFM-004 §14) — raise a derived constraint exception into
// op_roster_exceptions and progress its lifecycle via /api/operations/roster-exceptions.
/* eslint-disable @typescript-eslint/no-explicit-any */

const SEV: Record<string, string> = { critical: "bg-rose-50 text-rose-700", high: "bg-amber-50 text-amber-700", moderate: "bg-sky-50 text-sky-700", low: "bg-gray-100 text-gray-500" };
const ST: Record<string, string> = { detected: "bg-amber-50 text-amber-700", under_review: "bg-sky-50 text-sky-700", correction_proposed: "bg-sky-50 text-sky-700", awaiting_approval: "bg-violet-50 text-violet-700", accepted_with_mitigation: "bg-orange-50 text-orange-700", resolved: "bg-emerald-50 text-emerald-700", rejected: "bg-gray-100 text-gray-500", reopened: "bg-amber-50 text-amber-700" };

export function RaiseButtons({ rosterId, derived }: { rosterId: string; derived: any[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function raise(d: any) {
    setBusy(d.rule); setErr(null);
    try {
      const res = await fetch("/api/operations/roster-exceptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roster_id: rosterId, category: d.category, severity: d.severity, description: d.rule, resolution: d.resolution }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error || `Failed (${res.status})`); } else router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(null); }
  }
  if (derived.length === 0) return <p className="text-sm text-gray-400">No exceptions detected — the roster passes all governance checks. 🎉</p>;
  return (
    <div>
      {err && <div className="mb-2 text-xs text-rose-600">{err}</div>}
      <div className="space-y-1.5">{derived.map((d: any) => (
        <div key={d.rule} className="flex items-center justify-between rounded-lg border border-gray-100 p-2.5">
          <div className="min-w-0"><div className="flex items-center gap-2"><span className={`text-[9px] px-1.5 py-0.5 rounded ${SEV[d.severity]}`}>{d.severity}</span><p className="text-xs font-semibold text-gray-800 truncate">{d.rule}</p><span className="text-[10px] text-gray-400">×{d.count}</span></div><p className="text-[11px] text-gray-500 capitalize">{d.category.replace(/_/g, " ")} · {d.resolution}</p></div>
          <button disabled={busy === d.rule} onClick={() => raise(d)} className="shrink-0 text-[10px] font-semibold px-2.5 py-1 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">Raise</button>
        </div>))}</div>
    </div>
  );
}

export function ExceptionRegister({ rows }: { rows: any[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  async function progress(id: string, action: string) {
    setBusy(id); setErr(null);
    const body: any = { action };
    if (action === "override") { if (!reason[id]) { setErr("Override reason required"); setBusy(null); return; } body.override_reason = reason[id]; }
    try {
      const res = await fetch(`/api/operations/roster-exceptions?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error || `Failed (${res.status})`); } else router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(null); }
  }
  if (rows.length === 0) return <p className="text-sm text-gray-400">No open exceptions in the register. Raise one from the detected list.</p>;
  return (
    <div>
      {err && <div className="mb-2 text-xs text-rose-600">{err}</div>}
      <div className="overflow-x-auto"><table className="w-full text-xs">
        <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Category</th><th className="py-2 pr-3 font-medium">Exception</th><th className="py-2 pr-3 font-medium">Severity</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 font-medium">Actions</th></tr></thead>
        <tbody>{rows.map((e: any) => { const b = busy === e.id; return (
          <tr key={e.id} className="border-b border-gray-50 align-top">
            <td className="py-2 pr-3 text-gray-700 capitalize">{(e.category ?? "").replace(/_/g, " ")}</td>
            <td className="py-2 pr-3 text-gray-600">{e.description ?? "—"}</td>
            <td className="py-2 pr-3"><span className={`text-[9px] px-1.5 py-0.5 rounded ${SEV[e.severity] ?? SEV.moderate}`}>{e.severity}</span></td>
            <td className="py-2 pr-3"><span className={`text-[9px] px-1.5 py-0.5 rounded ${ST[e.status] ?? "bg-gray-100 text-gray-500"}`}>{(e.status ?? "").replace(/_/g, " ")}</span></td>
            <td className="py-2"><div className="flex flex-col gap-1">
              <div className="flex gap-1 flex-wrap">
                {e.status === "detected" && <button disabled={b} onClick={() => progress(e.id, "review")} className="text-[10px] px-2 py-1 rounded border border-sky-200 text-sky-700 hover:bg-sky-50 disabled:opacity-40">Review</button>}
                <button disabled={b} onClick={() => progress(e.id, "resolve")} className="text-[10px] px-2 py-1 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">Resolve</button>
                <button disabled={b} onClick={() => progress(e.id, "override")} className="text-[10px] px-2 py-1 rounded border border-orange-200 text-orange-700 hover:bg-orange-50 disabled:opacity-40">Override</button>
                <button disabled={b} onClick={() => progress(e.id, "reject")} className="text-[10px] px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40">Reject</button>
              </div>
              <input value={reason[e.id] ?? ""} onChange={ev => setReason(r => ({ ...r, [e.id]: ev.target.value }))} placeholder="override reason" className="text-[10px] border border-gray-200 rounded px-1.5 py-1 w-40 focus:outline-none focus:border-orange-300" />
            </div></td>
          </tr>); })}</tbody>
      </table></div>
    </div>
  );
}
