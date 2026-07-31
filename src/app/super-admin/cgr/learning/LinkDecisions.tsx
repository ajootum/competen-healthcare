"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// CGR-027 — governance decisions on a proposed learning link (migration 150). Confirming that a signal caused a
// competency change is a governance act, so the API restricts PATCH to admin roles; this UI simply reflects the
// lifecycle. "Implemented" is what closes the loop and stamps implemented_at — the end of the causal clock.

export default function LinkDecisions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function decide(next: string) {
    setBusy(next); setErr(null);
    const r = await fetch("/api/cgr/learning-links", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: next }) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok || j.ok === false) { setErr(j.error ?? "Failed"); return; }
    router.refresh();
  }

  if (status === "implemented" || status === "rejected") return null;

  const btn = "text-[10px] font-semibold border rounded px-1.5 py-0.5 disabled:opacity-40 transition-colors";
  return (
    <div className="flex items-center gap-1 mt-1">
      {status === "proposed" && (
        <button onClick={() => decide("confirmed")} disabled={!!busy} className={`${btn} text-blue-700 border-[var(--cmp-color-information)] hover:bg-[var(--cmp-surface-information)]`}>{busy === "confirmed" ? "…" : "Confirm"}</button>
      )}
      <button onClick={() => decide("implemented")} disabled={!!busy} className={`${btn} text-emerald-700 border-[var(--cmp-color-success)] hover:bg-[var(--cmp-surface-success)]`} title="Closes the loop and stamps the improvement date">
        {busy === "implemented" ? "…" : "Implemented"}
      </button>
      <button onClick={() => decide("rejected")} disabled={!!busy} className={`${btn} text-gray-500 border-gray-200 hover:bg-gray-50`}>{busy === "rejected" ? "…" : "Reject"}</button>
      {err && <span className="text-[10px] text-[var(--cmp-text-error)]">{err}</span>}
    </div>
  );
}
