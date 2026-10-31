"use client";

import { useEffect, useRef, useState } from "react";
import type { ExperienceKey } from "@/lib/individual/experiences";
import { QUESTION_MAX } from "@/lib/individual/assistant-limits";
import { AiRefusalNotice, aiActionProps } from "../../../_components/ai/AiAvailability";
import ClarifyPurpose from "../../../_components/ai/ClarifyPurpose";
import { clarifyFrom, type ClarifyPrompt } from "@/lib/individual/ai-availability";
import { DepthControl, FollowUpActions, PersonalAiAnswer, askPersonalAi, type OwnCardTarget } from "../../../_components/ai/PersonalAiAnswer";
import { FOLLOW_UP_LABEL, type FollowUp, type FollowUpKind, type PersonalAiDepth } from "@/lib/individual/personal-ai-options";

// The personal AI's question box. One question, one answer, held only in this page's state -- the
// server stores nothing (see src/lib/individual/assistant.ts). Earlier answers in this visit stay on
// screen for the person's convenience and are gone when they leave.
//
// AI operating modes: a clinical question that could be a study question or about a real patient comes back as a
// question (HTTP 409, code clarify_purpose), not a refusal. "For my studies" resends the SAME question with
// purpose "education"; "A real patient" shows its answer here and sends nothing.
//
// SCHOLAR-PAI-EXPERIENCE-01 (Scholar): the answer streams in as it is written and is shown structured (ScholarAnswer);
// a depth control; Simplify / Go deeper / Practise under a finished answer (the earlier question and answer are sent
// back, the server adds a fixed instruction); the newest answer in full and earlier ones folded to their question. A
// stream that fails part way is discarded, never shown as an answer. Professional is unchanged (plain text, no stream).

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

const STARTERS: Record<ExperienceKey, string[]> = {
  scholar: ["How should I plan revision for the next four weeks?", "Explain the difference between sepsis and SIRS in simple terms."],
  professional: ["What should I focus on in my CPD this year?", "Summarise what is on my Competen record."],
};

type Turn = { id: number; q: string; a: string; streaming: boolean; followUp?: FollowUpKind };
type Request = { q: string; followUp?: FollowUp };

// HFE-01 Wave 1: `unavailable` (from the page's standing) disables asking, with the reason the page shows above
// (#ai-unavailable). A refusal that still comes back is shown in the shared words.
export default function AssistantPanel({ experience, accent, unavailable = false, ownCards = null }: {
  experience: ExperienceKey; accent: string; unavailable?: boolean;
  /** Scholar: where an "Edit and save as my card" may be filed (the learner's own materials); null hides saving. */
  ownCards?: OwnCardTarget | null;
}) {
  const scholar = experience === "scholar";
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ body: unknown } | null>(null);
  const [clarify, setClarify] = useState<{ req: Request; prompt: ClarifyPrompt } | null>(null);
  const off = aiActionProps(unavailable ? { available: false, reason: "unreadable" } : { available: true }, "ai-unavailable");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [depth, setDepth] = useState<PersonalAiDepth>("standard");
  const seq = useRef(0);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  // SCHOLAR-RISK-01 clarify-once: once the learner says this conversation is for study, later questions carry purpose
  // "education" without asking again. The server honours it only for an ambiguous request: real-patient evidence is
  // refused whatever the purpose. "A patient I'm caring for" ends it.
  const [studyConfirmed, setStudyConfirmed] = useState(false);

  async function ask(req: Request, asked?: "education") {
    const text = req.q.trim();
    if (!text || busy || unavailable) return;
    if (asked === "education") setStudyConfirmed(true);
    const purpose = asked ?? (studyConfirmed ? "education" : undefined);
    setBusy(true); setError(null); setClarify(null);
    const id = ++seq.current;
    const ctl = new AbortController(); abort.current = ctl;
    const update = (patch: Partial<Turn>) => setTurns(t => t.map(x => (x.id === id ? { ...x, ...patch } : x)));
    let shown = false;
    const r = await askPersonalAi("/api/individual/assistant", {
      experience, question: text, ...(purpose ? { purpose } : {}),
      ...(scholar ? { depth, ...(req.followUp ? { followUp: req.followUp } : {}) } : {}),
    }, soFar => {
      if (!shown) { shown = true; setTurns(t => [{ id, q: text, a: soFar, streaming: true, followUp: req.followUp?.kind }, ...t]); }
      else update({ a: soFar });
    }, ctl.signal);
    const drop = () => setTurns(t => t.filter(x => x.id !== id));
    try {
      if (r.kind === "stream") {
        // A failure after text began: the partial text is not an answer and is not kept.
        if (r.error) { drop(); setError({ body: { error: r.error.message } }); return; }
        update({ a: r.text, streaming: false });
        if (!req.followUp) setQuestion("");
        return;
      }
      const prompt = r.status === 409 ? clarifyFrom(r.json) : null;
      if (prompt) { setClarify({ req, prompt }); return; }
      if (!r.ok) { setError({ body: r.json }); return; }
      setTurns(t => [{ id, q: text, a: String(r.json.answer ?? ""), streaming: false, followUp: req.followUp?.kind }, ...t]);
      if (!req.followUp) setQuestion("");
    } finally {
      setBusy(false);
    }
  }

  const followUp = (t: Turn, kind: FollowUpKind) => void ask({ q: t.q, followUp: { kind, previousQuestion: t.q, previousAnswer: t.a } });
  const writing = turns[0]?.streaming;

  return (
    <div>
      <form onSubmit={e => { e.preventDefault(); void ask({ q: question }); }} className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <label htmlFor="ind-q" className="text-[14px] font-semibold text-gray-900">Your question</label>
        <textarea id="ind-q" value={question} onChange={e => setQuestion(e.target.value)} maxLength={QUESTION_MAX} rows={3}
          className={`mt-2 w-full resize-y rounded-xl border border-gray-300 px-3 py-2.5 text-[15px] text-gray-900 ${focusRing}`}
          placeholder="Ask anything about your learning or development" />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy || !question.trim() || unavailable} {...off}
            className={`inline-flex min-h-[44px] items-center justify-center rounded-xl px-5 py-2.5 text-[14.5px] font-semibold text-white hover:opacity-90 disabled:opacity-50 ${focusRing}`}
            style={{ background: accent }}>
            {busy ? (writing ? "Writing…" : "Thinking…") : "Ask"}
          </button>
          {scholar && <DepthControl value={depth} onChange={setDepth} disabled={busy} />}
          <span className="text-[12px] text-gray-500 tabular-nums">{question.length}/{QUESTION_MAX}</span>
        </div>
        {turns.length === 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {STARTERS[experience].map(s => (
              <button key={s} type="button" onClick={() => void ask({ q: s })} disabled={busy || unavailable} {...off}
                className={`rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-left text-[12.5px] text-gray-700 hover:bg-gray-100 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
                {s}
              </button>
            ))}
          </div>
        )}
      </form>

      {clarify && <ClarifyPurpose key={clarify.req.q} clarify={clarify.prompt} busy={busy} accent={accent} className="mt-3" onEducation={() => void ask(clarify.req, "education")} onPatient={() => setStudyConfirmed(false)} />}

      {error && <AiRefusalNotice body={error.body} fallback="The assistant could not answer just now." experience={experience} className="mt-3" />}

      <div aria-live="polite" className="mt-5 space-y-4">
        {turns.map((t, i) => {
          const asked = t.followUp ? `${FOLLOW_UP_LABEL[t.followUp]}: ${t.q}` : t.q;
          const answer = scholar
            ? <PersonalAiAnswer text={t.a} streaming={t.streaming} save={ownCards} />
            : <div className="whitespace-pre-wrap text-[14.5px] leading-relaxed text-gray-800">{t.a}</div>;
          if (i > 0) return (
            // Earlier turns fold to their question: the newest answer is the one being read.
            <details key={t.id} className="group rounded-2xl border border-gray-200 bg-white">
              <summary className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-2xl px-4 py-2.5 text-[14px] text-gray-800 sm:px-5 ${focusRing}`}>
                <span className="font-semibold text-gray-500">You asked</span>
                <span className="min-w-0 flex-1 truncate">{asked}</span>
                <span aria-hidden="true" className="text-gray-500 transition-transform group-open:rotate-180 motion-reduce:transition-none">▾</span>
              </summary>
              <div className="border-t border-gray-100 px-4 pb-4 pt-3 sm:px-5">{answer}</div>
            </details>
          );
          return (
            <article key={t.id} className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
              <p className="text-[13px] font-semibold text-gray-500">You asked</p>
              <p className="text-[14.5px] text-gray-900">{asked}</p>
              <p className="mt-3 text-[13px] font-semibold" style={{ color: accent }}>Personal AI</p>
              <div className="mt-1">{answer}</div>
              {scholar && !t.streaming && t.a && (
                <div className="mt-4 border-t border-gray-100 pt-3">
                  <FollowUpActions disabled={busy || unavailable} onPick={k => followUp(t, k)} />
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
