"use client";

import { useState } from "react";
import { secondaryBtn } from "../chrome";
import { AiNoticeText, aiNotice, type AiNotice } from "./ai-refusal";
import { AiGate } from "../ai/AiGate";

// "Draft my professional summary" (COMPETEN-PROFESSIONAL-PROFILE-01 GO s7). The Holdings Personal AI in its
// Professional development mode, through the foundation assistant route -- the same gateway, allowance and
// audit as every Professional AI request. Grounded on the person's own self-declared profile only, and told
// not to add any qualification, licence, employer or credential that is not on it. Advisory: the draft goes
// into the summary box only if the person chooses, and is saved only if they then save the form.

export const SUMMARY_REQUEST = "Draft a short professional summary of me, in the first person, under 120 words, from my recorded professional profile only. "
  + "Do not add any qualification, licence, registration, employer, role or credential that is not in my record. Where something useful is missing, leave a short [bracketed] prompt instead.";

export default function SummaryAssist({ accent, targetId }: { accent: string; targetId: string }) {
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [err, setErr] = useState<AiNotice | null>(null);

  async function ask() {
    setBusy(true); setErr(null); setAnswer(null);
    try {
      const res = await fetch("/api/individual/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ experience: "professional", mode: "development", question: SUMMARY_REQUEST }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(aiNotice(j, "The assistant could not answer just now."));
      else setAnswer(j.answer ?? "");
    } catch { setErr({ text: "The assistant could not be reached. Check your connection.", continuity: false }); } finally { setBusy(false); }
  }

  function use() {
    const box = document.getElementById(targetId) as HTMLTextAreaElement | null;
    if (box && answer) { box.value = answer.slice(0, 2000); box.focus(); }
  }

  return (
    <div>
      <AiGate activity="assistant" experience="professional">{g => (
      <button type="button" onClick={ask} disabled={busy || g.off} aria-describedby={g.describedBy} className={secondaryBtn} style={{ color: accent }}>
        {busy ? "Thinking…" : "✦ Draft a summary from my profile"}
      </button>)}</AiGate>
      {err && <AiNoticeText notice={err} className="mt-3" />}
      {answer !== null && (
        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4" aria-live="polite">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-gray-500">AI draft · advisory · not saved</p>
          <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-gray-800">{answer}</p>
          <button type="button" onClick={use} className="mt-3 text-[13.5px] font-semibold underline-offset-2 hover:underline" style={{ color: accent }}>Put this draft in my summary to edit</button>
          <p className="mt-2 text-[12.5px] text-gray-500">Written from your own profile only. Check every fact before you save it.</p>
        </div>
      )}
    </div>
  );
}
