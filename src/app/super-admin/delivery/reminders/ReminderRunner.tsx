"use client";

import { useState } from "react";

// CDP-011 — "Run reminder scan" control. POSTs the scan (fires deduped expiry reminders), shows the outcome.

export default function ReminderRunner({ upcoming }: { upcoming: number }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/admin/delivery/reminders", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || j.ok === false) { setMsg(j.error ?? "Scan failed"); return; }
    setMsg(`${j.sent} reminder${j.sent === 1 ? "" : "s"} sent.`);
    if (j.sent) setTimeout(() => window.location.reload(), 1000);
  }

  return (
    <div className="flex items-center gap-3">
      <button onClick={run} disabled={busy} className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg px-4 py-2">{busy ? "Scanning…" : `Run reminder scan${upcoming ? ` · ${upcoming} due` : ""}`}</button>
      {msg && <span className="text-[11px] text-gray-500">{msg}</span>}
    </div>
  );
}
