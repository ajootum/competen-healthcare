"use client";

import { useState } from "react";

// "Generate AI Recommendations" — real Claude analysis of the live competency
// coverage profile (grounded, quota-limited, audit-logged).
export default function GenerateRecs() {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true); setError(null);
    const res = await fetch("/api/ai/insights", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "competency" }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.answer) setText(d.answer); else setError(d.error ?? "AI request failed");
    setBusy(false);
  }

  return (
    <div>
      <button onClick={go} disabled={busy}
        className="w-full text-[11px] font-bold text-white bg-purple-600 rounded-lg px-3 py-2 hover:bg-purple-700 disabled:opacity-50 transition-colors">
        {busy ? "Analysing…" : "✨ Generate AI Recommendations"}
      </button>
      {error && <p className="text-[10px] text-red-600 mt-1.5">{error}</p>}
      {text && (
        <div className="mt-2 bg-purple-50/60 border border-purple-100 rounded-lg p-2.5">
          <p className="text-[11px] text-gray-700 whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">{text}</p>
          <p className="text-[8px] text-gray-400 mt-1.5">Claude, grounded in live coverage figures — advisory. Audit-logged.</p>
        </div>
      )}
    </div>
  );
}
