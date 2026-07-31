"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Approval & publication workflow (UMW-WFM-004 §15) — submit the approval chain, decide each
// step, and record publication over op_roster_approvals / op_roster_publications via
// /api/operations/roster-approvals.
/* eslint-disable @typescript-eslint/no-explicit-any */

const ST: Record<string, string> = { pending: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", approved: "bg-[var(--cmp-surface-success)] text-emerald-700", approved_with_conditions: "bg-[var(--cmp-surface-success)] text-emerald-700", rejected: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", returned: "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]", delegated: "bg-violet-50 text-violet-700" };

export default function ApprovalWorkflow({ rosterId, approvals, submitted, allApproved, publishable, published }: { rosterId: string; approvals: any[]; submitted: boolean; allApproved: boolean; publishable: boolean; published: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});

  async function post(action: string) {
    setBusy(action); setErr(null);
    try {
      const res = await fetch("/api/operations/roster-approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roster_id: rosterId, action }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error || `Failed (${res.status})`); } else router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(null); }
  }
  async function decide(id: string, action: string) {
    setBusy(id); setErr(null);
    const body: any = { action };
    if (["reject", "return"].includes(action)) { if (!comments[id]) { setErr("Comments required to reject/return"); setBusy(null); return; } body.comments = comments[id]; }
    try {
      const res = await fetch(`/api/operations/roster-approvals?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error || `Failed (${res.status})`); } else router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(null); }
  }

  return (
    <div>
      {err && <div className="mb-2 text-xs text-[var(--cmp-text-error)] bg-[var(--cmp-surface-error)] border border-[var(--cmp-color-error)] rounded-lg px-3 py-2">{err}</div>}
      {!submitted ? (
        <div><p className="text-sm text-gray-500 mb-2">The roster hasn&apos;t been submitted for approval.</p><button disabled={busy === "submit"} onClick={() => post("submit")} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[var(--cmp-color-success)] text-white hover:bg-emerald-700 disabled:opacity-40">Submit for approval</button></div>
      ) : (
        <ol className="space-y-0">{approvals.map((a: any) => { const b = busy === a.id; return (
          <li key={a.id} className="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
            <span className="shrink-0 w-5 h-5 rounded-full bg-gray-100 text-gray-500 text-[10px] font-bold flex items-center justify-center mt-0.5">{a.stage_order}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 flex-wrap"><p className="text-xs font-semibold text-gray-800">{a.approver_role}</p><span className={`text-[9px] px-1.5 py-0.5 rounded ${ST[a.status] ?? "bg-gray-100 text-gray-500"}`}>{(a.status ?? "").replace(/_/g, " ")}</span></div>
              {a.comments && <p className="text-[10px] text-gray-500 mt-0.5">{a.comments}{a.approver_name ? ` — ${a.approver_name}` : ""}</p>}
              {a.status === "pending" && <div className="mt-1.5 flex flex-col gap-1"><div className="flex gap-1 flex-wrap"><button disabled={b} onClick={() => decide(a.id, "approve")} className="text-[10px] px-2 py-1 rounded border border-[var(--cmp-color-success)] text-emerald-700 hover:bg-[var(--cmp-surface-success)] disabled:opacity-40">Approve</button><button disabled={b} onClick={() => decide(a.id, "return")} className="text-[10px] px-2 py-1 rounded border border-[var(--cmp-color-information)] text-[var(--cmp-text-information)] hover:bg-[var(--cmp-surface-information)] disabled:opacity-40">Return</button><button disabled={b} onClick={() => decide(a.id, "reject")} className="text-[10px] px-2 py-1 rounded border border-[var(--cmp-color-error)] text-[var(--cmp-text-error)] hover:bg-[var(--cmp-surface-error)] disabled:opacity-40">Reject</button></div><input value={comments[a.id] ?? ""} onChange={e => setComments(x => ({ ...x, [a.id]: e.target.value }))} placeholder="comments" className="text-[10px] border border-gray-200 rounded px-1.5 py-1 w-48 focus:outline-none focus:border-[var(--cmp-color-success)]" /></div>}
            </div>
          </li>); })}</ol>
      )}
      {submitted && !published && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <button disabled={busy === "publish" || !allApproved || !publishable} onClick={() => post("publish")} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[var(--cmp-color-success)] text-white hover:bg-emerald-700 disabled:opacity-40" title={!allApproved ? "All steps must be approved" : !publishable ? "Blocked by a critical rule" : ""}>Record publication</button>
          <span className="ml-2 text-[10px] text-gray-400">{!allApproved ? "Awaiting all approvals" : !publishable ? "Blocked by a critical rule" : "Ready to publish"}</span>
        </div>
      )}
    </div>
  );
}
