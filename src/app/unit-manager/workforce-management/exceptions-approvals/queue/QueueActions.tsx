"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// My Approval Queue actions (UMW-WFM-006 §10) — per-row decisions over approval_requests via
// the existing audited /api/operations/approvals PATCH (approve / reject / return / escalate).
// A rejection records a reason (BR-EXA-007); the requester can't approve their own request
// (BR-EXA-003, enforced server-side).
/* eslint-disable @typescript-eslint/no-explicit-any */

const PRI: Record<string, string> = { critical: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", high: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", medium: "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]", low: "bg-gray-100 text-gray-500" };
const ST: Record<string, string> = { waiting: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", pending_info: "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]", returned: "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]", delegated: "bg-violet-50 text-violet-700", escalated: "bg-[var(--cmp-surface-warning)] text-orange-700" };
const AI: Record<string, string> = { approve: "text-[var(--cmp-text-success)]", reject: "text-[var(--cmp-text-error)]", review: "text-[var(--cmp-text-warning)]", escalate: "text-[var(--cmp-text-warning)]", request_info: "text-[var(--cmp-text-information)]" };

export default function QueueActions({ rows }: { rows: any[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  async function decide(id: string, action: string) {
    if ((action === "reject" || action === "return") && !note[id]) { setErr("A reason is required to reject/return"); return; }
    setBusy(id); setErr(null);
    try {
      const res = await fetch("/api/operations/approvals", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, note: note[id] || "" }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error || `Failed (${res.status})`); } else router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(null); }
  }

  if (rows.length === 0) return <p className="text-sm text-gray-400">No requests awaiting your decision. 🎉</p>;
  return (
    <div>
      {err && <div className="mb-2 text-xs text-[var(--cmp-text-error)] bg-[var(--cmp-surface-error)] border border-[var(--cmp-color-error)] rounded-lg px-3 py-2">{err}</div>}
      <div className="overflow-x-auto"><table className="w-full text-xs">
        <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Request</th><th className="py-2 pr-3 font-medium">Category</th><th className="py-2 pr-3 font-medium">Priority</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 pr-3 font-medium">AI</th><th className="py-2 font-medium">Decision</th></tr></thead>
        <tbody>{rows.map((r: any) => { const b = busy === r.id; return (
          <tr key={r.id} className="border-b border-gray-50 align-top">
            <td className="py-2 pr-3 text-gray-800 font-medium">{r.title}<span className="block text-[10px] text-gray-400">{r.requester_name ?? "—"}</span></td>
            <td className="py-2 pr-3 text-gray-500 capitalize">{r.category}</td>
            <td className="py-2 pr-3"><span className={`text-[9px] px-1.5 py-0.5 rounded ${PRI[r.priority] ?? PRI.medium}`}>{r.priority}</span></td>
            <td className="py-2 pr-3"><span className={`text-[9px] px-1.5 py-0.5 rounded ${ST[r.status] ?? "bg-gray-100 text-gray-500"}`}>{(r.status ?? "").replace(/_/g, " ")}</span></td>
            <td className="py-2 pr-3"><span className={`text-[10px] font-medium capitalize ${AI[r.ai_recommendation] ?? "text-gray-400"}`}>{r.ai_recommendation ?? "—"}</span></td>
            <td className="py-2"><div className="flex flex-col gap-1">
              <div className="flex gap-1 flex-wrap">
                <button disabled={b} onClick={() => decide(r.id, "approve")} className="text-[10px] px-2 py-1 rounded border border-[var(--cmp-color-success)] text-emerald-700 hover:bg-[var(--cmp-surface-success)] disabled:opacity-40">Approve</button>
                <button disabled={b} onClick={() => decide(r.id, "reject")} className="text-[10px] px-2 py-1 rounded border border-[var(--cmp-color-error)] text-[var(--cmp-text-error)] hover:bg-[var(--cmp-surface-error)] disabled:opacity-40">Reject</button>
                <button disabled={b} onClick={() => decide(r.id, "return")} className="text-[10px] px-2 py-1 rounded border border-[var(--cmp-color-information)] text-[var(--cmp-text-information)] hover:bg-[var(--cmp-surface-information)] disabled:opacity-40">Return</button>
                <button disabled={b} onClick={() => decide(r.id, "escalate")} className="text-[10px] px-2 py-1 rounded border border-[var(--cmp-color-warning)] text-orange-700 hover:bg-[var(--cmp-surface-warning)] disabled:opacity-40">Escalate</button>
              </div>
              <input value={note[r.id] ?? ""} onChange={e => setNote(n => ({ ...n, [r.id]: e.target.value }))} placeholder="note / reason" className="text-[10px] border border-gray-200 rounded px-1.5 py-1 w-44 focus:outline-none focus:border-[var(--cmp-color-success)]" />
            </div></td>
          </tr>); })}</tbody>
      </table></div>
    </div>
  );
}
