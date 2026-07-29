"use client";

import { useState } from "react";

// CDP-015 — "Process events" control. Drains pending delivery events (auto-remediates failed assessments).

export default function EventConsumerRunner({ pending }: { pending: number }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/admin/delivery/events", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || j.ok === false) { setMsg(j.error ?? "Run failed"); return; }
    setMsg(`${j.processed} processed${j.remediated ? ` · ${j.remediated} remediation${j.remediated === 1 ? "" : "s"}` : ""}.`);
    if (j.processed) setTimeout(() => window.location.reload(), 1000);
  }

  return (
    <div className="flex items-center gap-3">
      <button onClick={run} disabled={busy} className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg px-4 py-2">{busy ? "Processing…" : `Process events${pending ? ` · ${pending} pending` : ""}`}</button>
      {msg && <span className="text-[11px] text-gray-500">{msg}</span>}
    </div>
  );
}
