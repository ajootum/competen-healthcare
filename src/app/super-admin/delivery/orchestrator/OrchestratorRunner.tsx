"use client";

import { useState } from "react";

// CDP-001 — "Run orchestration" control. POSTs to the orchestrator (materialises pending rule deliveries +
// emits events), shows the outcome, and reloads if anything changed.

export default function OrchestratorRunner({ pending }: { pending: number }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/admin/delivery/orchestrate", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || j.ok === false) { setMsg(j.error ?? "Run failed"); return; }
    setMsg(`Materialised ${j.created} deliver${j.created === 1 ? "y" : "ies"}${j.skipped ? `, ${j.skipped} skipped` : ""} · ${j.events} event(s) emitted.`);
    if (j.created) setTimeout(() => window.location.reload(), 1000);
  }

  return (
    <div className="flex items-center gap-3">
      <button onClick={run} disabled={busy} className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg px-4 py-2">
        {busy ? "Orchestrating…" : `Run orchestration${pending ? ` · ${pending} pending` : ""}`}
      </button>
      {msg && <span className="text-[11px] text-gray-500">{msg}</span>}
    </div>
  );
}
