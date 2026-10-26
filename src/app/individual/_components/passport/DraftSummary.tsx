"use client";

import { useState } from "react";
import { AiNoticeText, aiNotice, type AiNotice } from "../professional/ai-refusal";
import { AiGate } from "../ai/AiGate";

// AI help drafting a Passport view's summary (COMPETEN-PROFESSIONAL-PASSPORT-01). Advisory text only: "Use this" copies
// it into the summary field of the form on this page, where the person can change it. Nothing is saved or shared until
// the person creates the view themselves.

const small = "inline-flex min-h-[36px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center rounded-lg border border-gray-300 bg-white px-3 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50";

export default function DraftSummary({ targetId, purposeId, accent }: { targetId: string; purposeId: string; accent: string }) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [notice, setNotice] = useState<AiNotice | null>(null);
  async function ask() {
    setBusy(true); setNotice(null); setText(null);
    try {
      const purpose = (document.getElementById(purposeId) as HTMLSelectElement | null)?.value ?? "";
      const res = await fetch("/api/individual/professional/passport-suggestions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purpose }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setNotice(aiNotice(j, "The assistant could not answer just now.")); else setText(j.text ?? "");
    } catch { setNotice({ text: "The assistant could not be reached. Check your connection.", continuity: false }); } finally { setBusy(false); }
  }
  function use() {
    const el = document.getElementById(targetId) as HTMLTextAreaElement | null;
    if (el && text) el.value = text;
  }
  return (
    <div>
      <AiGate activity="assistant" experience="professional">{g => (<button type="button" onClick={ask} disabled={busy || g.off} aria-describedby={g.describedBy} className={small} style={{ color: accent }}>{busy ? "Thinking…" : "✦ Draft a summary with AI"}</button>)}</AiGate>
      {notice && <AiNoticeText notice={notice} className="mt-2" />}
      {text !== null && (
        <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-3" aria-live="polite">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-gray-500">AI draft · advisory · check every word</p>
          <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-gray-800">{text}</p>
          <button type="button" onClick={use} className={`${small} mt-2`}>Use this as my summary</button>
        </div>
      )}
    </div>
  );
}
