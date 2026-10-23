"use client";

import { useState } from "react";
import { secondaryBtn } from "../chrome";

// "Suggest a CPD plan" -- the personal AI, grounded on the person's own needs, goals and CPD
// (POST /api/individual/professional/assistant, task cpd_plan). Advisory: the suggestion is shown here and
// saved nowhere. To act on it, the person adds goals themselves.

export default function AssistPanel({ accent }: { accent: string }) {
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function ask() {
    setBusy(true); setErr(null); setAnswer(null);
    try {
      const res = await fetch("/api/individual/professional/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: "cpd_plan" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j?.error ?? "The assistant could not answer just now.");
      else setAnswer(j.answer ?? "");
    } catch { setErr("The assistant could not be reached. Check your connection."); } finally { setBusy(false); }
  }

  return (
    <div>
      <button type="button" onClick={ask} disabled={busy} className={secondaryBtn} style={{ color: accent }}>
        {busy ? "Thinking…" : "✦ Suggest a CPD plan from my needs"}
      </button>
      {err && <p role="alert" className="mt-3 text-[13.5px] text-red-700">{err}</p>}
      {answer !== null && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4" aria-live="polite">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-gray-500">AI suggestion · advisory · not saved</p>
          <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-gray-800">{answer}</p>
          <p className="mt-3 text-[12.5px] text-gray-500">Generated from your own record only. It does not know your regulator&apos;s requirements. Add any goal you want to keep to your plan yourself.</p>
        </div>
      )}
    </div>
  );
}
