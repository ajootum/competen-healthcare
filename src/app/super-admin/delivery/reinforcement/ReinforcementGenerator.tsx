"use client";

import { useState } from "react";

// CDP-004 — generates reinforcement cards from achieved competency decisions (one per learner+competency,
// idempotent). Reloads on success so the coverage reflects the new cards.

export default function ReinforcementGenerator() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function gen() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/admin/delivery/reinforcement", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || j.ok === false) { setMsg(j.error ?? "Generate failed"); return; }
    setMsg(`Generated ${j.created} card${j.created === 1 ? "" : "s"}${j.skipped ? ` · ${j.skipped} already existed` : ""}.`);
    if (j.created) setTimeout(() => window.location.reload(), 1000);
  }

  return (
    <div className="flex items-center gap-3">
      <button onClick={gen} disabled={busy} className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg px-4 py-2">{busy ? "Generating…" : "Generate from achievements"}</button>
      {msg && <span className="text-[11px] text-gray-500">{msg}</span>}
    </div>
  );
}
