"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// CAPA-004 evidence verification controls — Verify / Reject / Flag a pending evidence item; PATCHes the
// verification API (which writes an immutable integrity event) then refreshes the queue.
export default function EvidenceActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run(action: string) {
    setBusy(action); setErr(null);
    const r = await fetch(`/api/assurance/evidence?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok || j.ok === false) { setErr(j.error ?? "Failed"); return; }
    router.refresh();
  }

  const btn = "text-[11px] font-semibold border rounded-md px-2 py-0.5 disabled:opacity-50 transition-colors";
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button onClick={() => run("verify")} disabled={!!busy} className={`${btn} text-emerald-700 border-[var(--cmp-color-success)] hover:bg-[var(--cmp-surface-success)]`}>{busy === "verify" ? "…" : "Verify"}</button>
      <button onClick={() => run("flag")} disabled={!!busy} className={`${btn} text-[var(--cmp-text-warning)] border-[var(--cmp-color-warning)] hover:bg-[var(--cmp-surface-warning)]`}>Flag</button>
      <button onClick={() => run("reject")} disabled={!!busy} className={`${btn} text-[var(--cmp-text-error)] border-[var(--cmp-color-error)] hover:bg-[var(--cmp-surface-error)]`}>Reject</button>
      {err && <span className="text-[10px] text-[var(--cmp-text-error)]">{err}</span>}
    </div>
  );
}
