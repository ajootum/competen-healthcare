"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// PPE-008 approval decision controls. Approve fires immediately; Reject / Request-changes reveal an inline reason
// field before confirming. PATCHes the approvals route then refreshes so the queue + audit trail re-render.

export default function ApprovalDecisions({ id }: { id: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "reject" | "request_changes">(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function decide(action: string, withReason?: string) {
    setBusy(action); setErr(null);
    const r = await fetch(`/api/priorities/approvals?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason: withReason }) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok || j.ok === false) { setErr(j.error ?? "Failed"); return; }
    router.refresh();
  }

  const btn = "text-[11px] font-semibold border rounded-md px-2 py-0.5 disabled:opacity-50 transition-colors";
  if (mode) {
    return (
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (optional)" autoFocus
          className="flex-1 min-w-[120px] border border-gray-200 rounded-md px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-teal-500/30" />
        <button onClick={() => decide(mode, reason)} disabled={!!busy} className={`${btn} ${mode === "reject" ? "text-[var(--cmp-text-error)] border-[var(--cmp-color-error)] hover:bg-[var(--cmp-surface-error)]" : "text-[var(--cmp-text-warning)] border-[var(--cmp-color-warning)] hover:bg-[var(--cmp-surface-warning)]"}`}>{busy ? "…" : "Confirm"}</button>
        <button onClick={() => { setMode(null); setReason(""); setErr(null); }} className="text-[11px] text-gray-500 hover:text-gray-600">Cancel</button>
        {err && <span className="text-[10px] text-[var(--cmp-text-error)]">{err}</span>}
      </div>
    );
  }
  return (
    <div className="mt-2 flex items-center gap-1.5">
      <button onClick={() => decide("approve")} disabled={!!busy} className={`${btn} text-emerald-700 border-[var(--cmp-color-success)] hover:bg-[var(--cmp-surface-success)]`}>{busy === "approve" ? "…" : "Approve"}</button>
      <button onClick={() => setMode("reject")} disabled={!!busy} className={`${btn} text-[var(--cmp-text-error)] border-[var(--cmp-color-error)] hover:bg-[var(--cmp-surface-error)]`}>Reject</button>
      <button onClick={() => setMode("request_changes")} disabled={!!busy} className={`${btn} text-[var(--cmp-text-warning)] border-[var(--cmp-color-warning)] hover:bg-[var(--cmp-surface-warning)]`}>Request changes</button>
      {err && <span className="text-[10px] text-[var(--cmp-text-error)]">{err}</span>}
    </div>
  );
}
