"use client";

import { useState } from "react";
import type { ExperienceKey } from "@/lib/individual/experiences";
import { QUESTION_MAX } from "@/lib/individual/assistant-limits";
import { AiRefusalNotice, aiActionProps } from "../../../_components/ai/AiAvailability";
import ClarifyPurpose from "../../../_components/ai/ClarifyPurpose";
import { clarifyFrom, type ClarifyPrompt } from "@/lib/individual/ai-availability";

// The personal AI's question box. One question, one answer, held only in this page's state -- the
// server stores nothing (see src/lib/individual/assistant.ts). Earlier answers in this visit stay on
// screen for the person's convenience and are gone when they leave.
//
// AI operating modes: a clinical question that could be a study question or about a real patient comes back as a
// question (HTTP 409, code clarify_purpose), not a refusal. "For my studies" resends the SAME question with
// purpose "education"; "A real patient" shows its answer here and sends nothing.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

const STARTERS: Record<ExperienceKey, string[]> = {
  scholar: ["How should I plan revision for the next four weeks?", "Explain the difference between sepsis and SIRS in simple terms."],
  professional: ["What should I focus on in my CPD this year?", "Summarise what is on my Competen record."],
};

// HFE-01 Wave 1: `unavailable` (from the page's standing) disables asking, with the reason the page shows above
// (#ai-unavailable). A refusal that still comes back is shown in the shared words.
export default function AssistantPanel({ experience, accent, unavailable = false }: { experience: ExperienceKey; accent: string; unavailable?: boolean }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ body: unknown } | null>(null);
  const [clarify, setClarify] = useState<{ q: string; prompt: ClarifyPrompt } | null>(null);
  const off = aiActionProps(unavailable ? { available: false, reason: "unreadable" } : { available: true }, "ai-unavailable");
  const [turns, setTurns] = useState<{ q: string; a: string }[]>([]);
  // SCHOLAR-RISK-01 clarify-once: once the learner says this conversation is for study, later questions carry purpose
  // "education" without asking again. The server honours it only for an ambiguous request: real-patient evidence is
  // refused whatever the purpose. "A patient I'm caring for" ends it.
  const [studyConfirmed, setStudyConfirmed] = useState(false);

  async function ask(q: string, asked?: "education") {
    const text = q.trim();
    if (!text || busy || unavailable) return;
    if (asked === "education") setStudyConfirmed(true);
    const purpose = asked ?? (studyConfirmed ? "education" : undefined);
    setBusy(true); setError(null); setClarify(null);
    try {
      const res = await fetch("/api/individual/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ experience, question: text, ...(purpose ? { purpose } : {}) }),
      });
      const json = await res.json().catch(() => ({}));
      const prompt = res.status === 409 ? clarifyFrom(json) : null;
      if (prompt) { setClarify({ q: text, prompt }); return; }
      if (!res.ok) { setError({ body: json }); return; }
      setTurns(t => [{ q: text, a: String(json.answer ?? "") }, ...t]);
      setQuestion("");
    } catch {
      setError({ body: { error: "The assistant could not be reached. Check your connection and try again." } });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={e => { e.preventDefault(); ask(question); }} className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <label htmlFor="ind-q" className="text-[14px] font-semibold text-gray-900">Your question</label>
        <textarea id="ind-q" value={question} onChange={e => setQuestion(e.target.value)} maxLength={QUESTION_MAX} rows={3}
          className={`mt-2 w-full resize-y rounded-xl border border-gray-300 px-3 py-2.5 text-[15px] text-gray-900 ${focusRing}`}
          placeholder="Ask anything about your learning or development" />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy || !question.trim() || unavailable} {...off}
            className={`inline-flex min-h-[44px] items-center justify-center rounded-xl px-5 py-2.5 text-[14.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50 ${focusRing}`}
            style={{ background: accent }}>
            {busy ? "Thinking…" : "Ask"}
          </button>
          <span className="text-[12px] text-gray-500 tabular-nums">{question.length}/{QUESTION_MAX}</span>
        </div>
        {turns.length === 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {STARTERS[experience].map(s => (
              <button key={s} type="button" onClick={() => ask(s)} disabled={busy || unavailable} {...off}
                className={`rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-left text-[12.5px] text-gray-700 hover:bg-gray-100 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
                {s}
              </button>
            ))}
          </div>
        )}
      </form>

      {clarify && <ClarifyPurpose key={clarify.q} clarify={clarify.prompt} busy={busy} accent={accent} className="mt-3" onEducation={() => void ask(clarify.q, "education")} onPatient={() => setStudyConfirmed(false)} />}

      {error && <AiRefusalNotice body={error.body} fallback="The assistant could not answer just now." experience={experience} className="mt-3" />}

      <div aria-live="polite" className="mt-5 space-y-4">
        {turns.map((t, i) => (
          <article key={turns.length - i} className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
            <p className="text-[13px] font-semibold text-gray-500">You asked</p>
            <p className="text-[14.5px] text-gray-900">{t.q}</p>
            <p className="mt-3 text-[13px] font-semibold" style={{ color: accent }}>Personal AI</p>
            <div className="whitespace-pre-wrap text-[14.5px] leading-relaxed text-gray-800">{t.a}</div>
          </article>
        ))}
      </div>
    </div>
  );
}
