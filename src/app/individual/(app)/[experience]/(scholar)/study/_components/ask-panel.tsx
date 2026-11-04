"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { AiRefusalNotice, AiUnavailableNote } from "@/app/individual/_components/ai/AiAvailability";
import { useAiAvailability } from "@/app/individual/_components/ai/AiAvailabilityContext";
import ClarifyPurpose from "@/app/individual/_components/ai/ClarifyPurpose";
import { DepthControl, FollowUpActions, PersonalAiAnswer, askPersonalAi } from "@/app/individual/_components/ai/PersonalAiAnswer";
import { clarifyFrom, type ClarifyPrompt } from "@/lib/individual/ai-availability";
import { FOLLOW_UP_LABEL, type FollowUp, type FollowUpKind, type PersonalAiDepth, type PersonalAiSourceRef } from "@/lib/individual/personal-ai-options";
import { PERSONAL_AI_LABEL, QUESTION_MAX } from "@/lib/individual/scholar/config";
import { askRequestBody, type AskSurface } from "@/lib/individual/scholar/ask-context";
import { readSpellingChoice, spellingField } from "@/lib/individual/scholar/spelling-variant";
import { SCHOLAR } from "@/lib/individual/experiences";
import { DictateButton } from "@/app/individual/_components/speech/speech-buttons";
import { activeStudyId } from "./study-active";
import { recordHistory } from "@/lib/individual/scholar/search-history-capture";

// "ASK ABOUT THIS" -- SCHOLAR-CE-2026 CE-01. ONE panel, used from Revise feedback, a flashcard, a case debrief, OSCE feedback,
// My Plan's next step and a saved lesson. The learner stays on the page: a side drawer on a wide screen, a bottom sheet on a
// phone (a native modal <dialog> with the shared focus doctrine, like the picture dialog in learn-visuals.tsx).
//
// It posts to the SAME route Learn's "Ask" uses, with a typed context (scholar/ask-context.ts): the learner's own sections, the
// study session open on this page, and where the question is asked from. The server reads every id again by the caller's id.
// The answer is the same Personal AI answer: sources as chips, the "NOT COVERED" line, PERSONAL_AI_LABEL, the shared words when
// AI is not available. ⚠ NOTHING IS SAVED: the conversation lives in this panel and is gone when the page is left.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const touch = "min-h-[44px] pointer-coarse:min-h-[var(--cmp-touch-min)]";
const trigger = `inline-flex ${touch} items-center justify-center gap-1.5 rounded-xl border border-indigo-300 bg-white px-4 py-2 text-[13.5px] font-semibold text-indigo-950 hover:bg-indigo-50 disabled:opacity-50 ${focusRing}`;
/** LEARN SECTIONS HFE: the primary action of a section's action row, filled in Ask Scholar's identity (the `next` learning tone). */
const triggerPrimary = `inline-flex min-h-[40px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center justify-center gap-1.5 rounded-xl border border-[var(--cmp-learn-next-ink)] bg-[var(--cmp-learn-next-ink)] px-4 py-1.5 text-[13.5px] font-semibold text-[var(--cmp-learn-next-surface)] hover:opacity-90 disabled:opacity-50 ${focusRing}`;

export type AskAboutProps = {
  surface: AskSurface;
  /** The learner's own sections this question is about (at most six; the server checks every one belongs to them). */
  chunkIds?: readonly string[];
  materialId?: string | null;
  /** A Learn session (and step) whose sections ground the question, when that is what the page has. */
  sessionId?: string | null; step?: number | null;
  /** Where it is asked, in words ("Question feedback"): shown in the panel and used as framing only. */
  refLabel: string;
  /** The short question offered for the learner to edit. */
  prefill?: string;
  /** The button's words. */
  label?: string;
  className?: string;
  /** "primary": the filled trigger, for the one primary action of a section's action row. Default: as before. */
  variant?: "primary";
};

/** The "Ask about this" button and, once pressed, its panel. Disabled with the shared reason when AI is not available. */
export function AskAbout(props: AskAboutProps) {
  const [open, setOpen] = useState(false);
  const why = useId();
  const availability = useAiAvailability("ask");
  const off = !!availability && !availability.available;
  return (
    <div className={props.className}>
      <button type="button" className={props.variant === "primary" ? triggerPrimary : trigger} disabled={off} aria-haspopup="dialog" aria-describedby={off ? why : undefined} onClick={() => setOpen(true)}>
        <span aria-hidden>✦</span>{props.label ?? "Ask about this"}<span className="sr-only">: {props.refLabel}</span>
      </button>
      {off && availability && !availability.available && <AiUnavailableNote id={why} reason={availability.reason} experience="scholar" className="mt-2 max-w-xl" />}
      {open && <AskDialog {...props} onClose={() => setOpen(false)} />}
    </div>
  );
}

// `label` is what the SERVER says the answer is (ask-grounding.ts: sections given and cited). Until it arrives, and when it does not, the cautious PERSONAL_AI_LABEL.
type Turn = { id: number; q: string; a: string; streaming: boolean; followUp?: FollowUpKind; sources?: PersonalAiSourceRef[]; label?: string; error?: string };

function AskDialog({ surface, chunkIds, materialId, sessionId, step, refLabel, prefill, onClose }: AskAboutProps & { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const uid = useId();
  const [question, setQuestion] = useState(prefill ?? "");
  const [depth, setDepth] = useState<PersonalAiDepth>("standard");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<{ body: unknown } | null>(null);
  const [clarify, setClarify] = useState<{ q: string; followUp?: FollowUp; prompt: ClarifyPrompt } | null>(null);
  const [studyConfirmed, setStudyConfirmed] = useState(false);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const seq = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const grounded = (chunkIds?.length ?? 0) > 0 || !!sessionId;
  // Declared first so it records the trigger before showModal() moves focus into the dialog; the native dialog already traps focus.
  useModalFocus(true, panel, () => ref.current?.close());
  // Opened once. No close() in a cleanup (close() fires onClose, which unmounts this dialog -- under React's development double-run
  // of effects that closed it before it was seen). An in-flight answer is cancelled on leaving.
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => abort.current?.abort();
  }, []);

  async function send(q: string, followUp?: FollowUp, asked?: "education") {
    const text = q.trim();
    if (!text || busy) return;
    if (asked === "education") setStudyConfirmed(true);
    const purpose = asked ?? (studyConfirmed ? "education" : undefined);
    setBusy(true); setError(null); setClarify(null);
    const id = ++seq.current;
    const ctl = new AbortController(); abort.current = ctl;
    let shown = false;
    const body = askRequestBody({
      question: text, context: { surface, chunkIds, materialId, studyId: activeStudyId(), refLabel, prefill }, sessionId, step,
      depth, purpose, followUp, spelling: spellingField(readSpellingChoice()),
    });
    const patch = (p: Partial<Turn>) => setTurns(t => t.map(x => (x.id === id ? { ...x, ...p } : x)));
    const r = await askPersonalAi("/api/individual/scholar/learn/assistant", body, soFar => {
      if (!shown) { shown = true; setTurns(t => [{ id, q: text, a: soFar, streaming: true, followUp: followUp?.kind }, ...t]); } else patch({ a: soFar });
    }, ctl.signal);
    setBusy(false);
    if (r.kind === "stream") {
      // A failure after text began: the partial text is not an answer and is not kept.
      if (r.error) { setTurns(t => t.filter(x => x.id !== id)); setError({ body: { error: r.error.message } }); return; }
      patch({ a: r.text, streaming: false, sources: r.done?.sources, label: r.done?.label });
      if (!followUp) { setQuestion(""); keep(text); }
      return;
    }
    const prompt = r.status === 409 ? clarifyFrom(r.json) : null;
    if (prompt) { setClarify({ q: text, followUp, prompt }); return; }
    if (!r.ok) { setError({ body: r.json }); return; }
    setTurns(t => [{ id, q: text, a: String(r.json.answer ?? ""), streaming: false, followUp: followUp?.kind, sources: Array.isArray(r.json.sources) ? r.json.sources as PersonalAiSourceRef[] : undefined, label: typeof r.json.label === "string" ? r.json.label : undefined }, ...t]);
    if (!followUp) { setQuestion(""); keep(text); }
  }
  // SCHOLAR-SEARCH-HISTORY-01: a question Scholar replied to (never a follow-up, which repeats it) is kept once in the learner's own history:
  // their words and where they asked, never the reply. The server keeps nothing while HQ has the history off.
  function keep(text: string) {
    void recordHistory({ activity: "ask", query: text, sessionId: sessionId ?? null, step: sessionId ? step ?? null : null, materialId: materialId ?? null, chunkId: chunkIds?.[0] ?? null });
  }

  return (
    <dialog ref={ref} aria-modal="true" aria-labelledby={`${uid}-h`} onClose={onClose} onCancel={onClose}
      onClick={e => { if (e.target === ref.current) ref.current?.close(); }}
      className="cmp-dialog fixed inset-x-0 bottom-0 top-auto m-0 max-h-[88vh] w-full max-w-none rounded-t-2xl border border-gray-200 bg-white p-0 text-left text-gray-900 shadow-xl backdrop:bg-black/40 md:inset-y-0 md:left-auto md:right-0 md:top-0 md:h-full md:max-h-none md:w-[30rem] md:rounded-none md:rounded-l-2xl">
      <div ref={panel} tabIndex={-1} className="flex max-h-[88vh] flex-col outline-none md:h-full md:max-h-none">
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-4">
          <div className="min-w-0">
            <h2 id={`${uid}-h`} className="text-[16px] font-bold text-gray-900">Ask about this</h2>
            <p className="mt-0.5 break-words text-[12.5px] font-semibold text-gray-700">About: {refLabel}</p>
          </div>
          <button type="button" aria-label="Close" onClick={() => ref.current?.close()}
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-[15px] font-semibold hover:bg-gray-50 pointer-coarse:h-[var(--cmp-touch-min)] pointer-coarse:w-[var(--cmp-touch-min)] ${focusRing}`}>{"✕"}</button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12.5px] leading-relaxed text-gray-700">
            {grounded ? "Your Personal AI is given the sections of your notes linked to this and asked to cite them. The label above each answer says whether it did. " : "No section of your notes is linked to this, so the answer is a general explanation. "}
            The answer is not saved: it is gone when you leave this page. Where My search history is offered, your question is kept there, private to you, until you remove it.
          </p>
          <form onSubmit={e => { e.preventDefault(); void send(question); }}>
            <label htmlFor={`${uid}-q`} className="text-[13.5px] font-semibold text-gray-900">Your question <span className="font-normal text-gray-600">(change it if you like)</span></label>
            <textarea id={`${uid}-q`} ref={questionRef} value={question} onChange={e => setQuestion(e.target.value)} maxLength={QUESTION_MAX} rows={4}
              className={`mt-1 w-full resize-y rounded-xl border border-gray-300 px-3 py-2.5 text-[14.5px] text-gray-900 ${focusRing}`} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="submit" disabled={busy || !question.trim()}
                className={`inline-flex ${touch} items-center justify-center rounded-xl bg-gray-900 px-5 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 ${focusRing}`}>
                {busy ? (turns[0]?.streaming ? "Writing…" : "Thinking…") : "Ask"}
              </button>
              <DepthControl value={depth} onChange={setDepth} disabled={busy} />
              <DictateButton inputRef={questionRef} onValue={setQuestion} disabled={busy} />
            </div>
          </form>

          {clarify && <ClarifyPurpose key={clarify.q} clarify={clarify.prompt} busy={busy} accent={SCHOLAR.accent} onEducation={() => void send(clarify.q, clarify.followUp, "education")} onPatient={() => setStudyConfirmed(false)} />}
          {error && <AiRefusalNotice body={error.body} fallback="The assistant could not answer just now." experience="scholar" />}

          <div aria-live="polite" className="space-y-3">
            {turns.map((t, i) => {
              const asked = t.followUp ? `${FOLLOW_UP_LABEL[t.followUp]}: ${t.q}` : t.q;
              const body = <div className="mt-1.5"><PersonalAiAnswer text={t.a} streaming={t.streaming} sources={t.sources} /></div>;
              if (i > 0) return (
                <details key={t.id} className="rounded-xl border-2 border-indigo-200 bg-indigo-50/50">
                  <summary className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-[12.5px] text-gray-700 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
                    <span className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-indigo-900">Earlier</span>
                    <span className="min-w-0 flex-1 truncate"><span className="font-semibold">You:</span> {asked}</span>
                  </summary>
                  <div className="px-3 pb-3">{body}</div>
                </details>
              );
              return (
                <article key={t.id} className="rounded-xl border-2 border-indigo-200 bg-indigo-50/50 p-3">
                  <p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-indigo-900">{t.label ?? PERSONAL_AI_LABEL}</p>
                  <p className="mt-1 text-[12.5px] text-gray-600"><span className="font-semibold">You:</span> {asked}</p>
                  {body}
                  {!t.streaming && t.a && (
                    <div className="mt-3 border-t border-indigo-100 pt-2">
                      <FollowUpActions disabled={busy} onPick={k => void send(t.q, { kind: k, previousQuestion: t.q, previousAnswer: t.a })} />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </dialog>
  );
}
