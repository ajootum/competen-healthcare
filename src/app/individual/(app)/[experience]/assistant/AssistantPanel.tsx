"use client";

import { useState } from "react";
import type { ExperienceKey } from "@/lib/individual/experiences";
import { QUESTION_MAX } from "@/lib/individual/assistant-limits";

// The personal AI's question box. One question, one answer, held only in this page's state -- the
// server stores nothing (see src/lib/individual/assistant.ts). Earlier answers in this visit stay on
// screen for the person's convenience and are gone when they leave.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

const STARTERS: Record<ExperienceKey, string[]> = {
  scholar: ["How should I plan revision for the next four weeks?", "Explain the difference between sepsis and SIRS in simple terms."],
  professional: ["What should I focus on in my CPD this year?", "Summarise what is on my Competen record."],
};

export default function AssistantPanel({ experience, accent }: { experience: ExperienceKey; accent: string }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [turns, setTurns] = useState<{ q: string; a: string }[]>([]);

  async function ask(q: string) {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/individual/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ experience, question: text }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "The assistant could not answer just now."); return; }
      setTurns(t => [{ q: text, a: String(json.answer ?? "") }, ...t]);
      setQuestion("");
    } catch {
      setError("The assistant could not be reached. Check your connection and try again.");
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
          <button type="submit" disabled={busy || !question.trim()}
            className={`inline-flex min-h-[44px] items-center justify-center rounded-xl px-5 py-2.5 text-[14.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50 ${focusRing}`}
            style={{ background: accent }}>
            {busy ? "Thinking…" : "Ask"}
          </button>
          <span className="text-[12px] text-gray-500 tabular-nums">{question.length}/{QUESTION_MAX}</span>
        </div>
        {turns.length === 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {STARTERS[experience].map(s => (
              <button key={s} type="button" onClick={() => ask(s)} disabled={busy}
                className={`rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-left text-[12.5px] text-gray-700 hover:bg-gray-100 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
                {s}
              </button>
            ))}
          </div>
        )}
      </form>

      {error && <p role="alert" className="mt-3 text-[13.5px] font-medium text-red-700">{error}</p>}

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
