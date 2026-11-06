"use client";

import { useEffect, useId, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { DisclaimerBadge, FeedbackParts, LearningCallout, LearningIcon, VerdictLine, learnAction, learnBox, learnTone, type FeedbackKind } from "@/components/ui/scholar-learning";
import { CHECK_VERDICT_LABEL, INFORMAL_CHECK_LABEL } from "@/lib/individual/scholar/config";
import { GO_DEEPER_COPY, deeperEvidenceStatement, parseDeeperAnswer, type DeeperParts } from "@/lib/individual/scholar/deeper-format";
import { CHECK_FEEDBACK_HEADING, parseCheckFeedback } from "@/lib/individual/scholar/learn-check";
import { GUIDE_COPY, GUIDE_HINT_LEVELS, STATUS_WORDS, followUpOf, isUncertainAnswer, mergeStatus, moveAfterVerdict, progressWords, resumeStep, type GuideTurn, type StepStatus } from "@/lib/individual/scholar/guide-me";
import { citedTags, questionText } from "@/lib/individual/scholar/teach-format";
import { Blocks, SectionNote, SourceChip } from "./go-deeper-view";

// SCHOLAR-GUIDE-ME-001: GUIDE ME ON THE PAGE. One concept and one question at a time, the answer box directly under the question, feedback beneath it. Separate controls for a hint, an
// example, an explanation and checking an answer, because they are different acts. Rendered once, here: nothing of it joins the lesson's thread. Every model call is the learner's click;
// opening a step that is already saved is not a model call. Kept by the page across a style switch.

type Source = { tag: string; chunkId: string; materialId: string; materialTitle: string; citation: string };
export type GuideReply = { answer?: string; sources?: Source[]; withheld?: boolean; message?: string; next?: { why?: string }; open?: string; verdict?: { value: string; label?: string } | null; salvage?: { note: string } | null; research?: { text?: string } | null; guide?: { step: number; of: number; turn: GuideTurn } | null; error?: string };
/** `json.clarify`: the clinical-risk gate asks whether this is study or a real patient. It is put to the learner here, where they are, and nothing has been sent to a model. */
export type GuideRun = (body: Record<string, unknown>) => Promise<{ ok: boolean; json: Record<string, unknown> } | null>;

type StepState = { reply: GuideReply | null; hints: GuideReply[]; example: GuideReply | null; explained: GuideReply | null; showExplained: boolean; question: string | null; answer: string; feedback: GuideReply | null; note: string | null };
export type GuideState = { of: number | null; current: number; status: StepStatus[]; steps: Record<number, StepState>; opened: boolean; finished: boolean };
export const GUIDE_FRESH: GuideState = { of: null, current: 0, status: [], steps: {}, opened: false, finished: false };
const FRESH_STEP: StepState = { reply: null, hints: [], example: null, explained: null, showExplained: false, question: null, answer: "", feedback: null, note: null };

export function GuideMePanel({ state, setState, run, busy, disabled, cite, answeredOf, renderResearch, renderClarify }: {
  renderClarify: (prompt: unknown, retry: () => void) => ReactNode;
  state: GuideState; setState: Dispatch<SetStateAction<GuideState>>; run: GuideRun; busy: boolean; disabled?: boolean;
  cite: (text: string, sources: readonly Source[]) => ReactNode;
  /** What this lesson's kept checks say about a question (guide-me.ts guideVerdictOf), so progress comes back on any device with no AI. */
  answeredOf: (question: string) => "understood" | "attempted" | null;
  renderResearch: (x: NonNullable<GuideReply["research"]>) => ReactNode;
}) {
  const id = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const here = state.steps[state.current] ?? FRESH_STEP;
  const [clarify, setClarify] = useState<{ prompt: unknown; retry: () => void } | null>(null);
  const patch = (step: number, p: Partial<StepState>) => setState(s => ({ ...s, steps: { ...s.steps, [step]: { ...(s.steps[step] ?? FRESH_STEP), ...p } } }));
  const setStatus = (step: number, now: StepStatus) => setState(s => { const status = [...s.status]; status[step] = mergeStatus(status[step] ?? "open", now); return { ...s, status }; });
  const ask = async (turn: GuideTurn, step: number, extra: Record<string, unknown> = {}, open = false, retry?: () => void): Promise<GuideReply | null> => {
    const r = await run({ action: "explain", guide: { turn, step, ...extra }, ...(open ? { open: true } : {}) });
    if (!r) return null;
    if (r.json.clarify) { setClarify({ prompt: r.json.clarify, retry: retry ?? (() => {}) }); return null; }
    const json = r.json as GuideReply;
    if (!r.ok && !json.withheld) { patch(step, { note: String(json.error ?? "Scholar could not answer just now.") }); return null; }
    if (json.guide?.of) setState(s => (s.of === json.guide!.of ? s : { ...s, of: json.guide!.of, status: Array.from({ length: json.guide!.of }, (_, i) => s.status[i] ?? "open") }));
    return json;
  };
  const partsOf = (r: GuideReply | null): DeeperParts | null => (r?.answer ? parseDeeperAnswer(r.answer) : null);
  const statusFromSaved = (r: GuideReply) => { const q = partsOf(r)?.questions[0]?.text; return q ? answeredOf(questionText(q)) : null; };

  // OPENING: every step already saved comes back with no AI, and the learner resumes where they were.
  const opening = useRef(false);
  useEffect(() => {
    if (state.opened || opening.current) return;
    opening.current = true;
    void (async () => {
      setState(s => ({ ...s, opened: true }));
      const first = await ask("teach", 0, {}, true);
      if (!first) return;
      const of = first.guide?.of ?? 1, got: Record<number, GuideReply> = {};
      if (first.answer) got[0] = first;
      for (let i = 1; i < of && got[i - 1]; i++) { const r = await ask("teach", i, {}, true); if (r?.answer) got[i] = r; }
      const status = Array.from({ length: of }, (_, i) => (got[i] ? statusFromSaved(got[i]) ?? "open" : "open") as StepStatus);
      const last = Object.keys(got).map(Number).sort((a, b) => b - a)[0];
      const resume = resumeStep(status);
      setState(s => ({ ...s, of, status, current: last === undefined ? 0 : Math.min(resume, last), finished: false,
        steps: { ...s.steps, ...Object.fromEntries(Object.entries(got).map(([k, v]) => [k, { ...FRESH_STEP, ...(s.steps[Number(k)] ?? {}), reply: v }])) } }));
    })();
    // Once per lesson, when the panel first opens. The page keeps what it finds, so leaving the style while it reads loses nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const teach = async (step: number) => {
    setState(s => ({ ...s, current: step, finished: false }));
    if (state.steps[step]?.reply?.answer) return;
    patch(step, { note: null });
    const r = await ask("teach", step, {}, false, () => void teach(step));
    if (!r) return;
    if (r.withheld) { patch(step, { note: r.next?.why ?? r.message ?? "This step could not be taught from your notes just now." }); return; }
    patch(step, { reply: r });
    setTimeout(() => box.current?.focus(), 50);
  };
  const parts = partsOf(here.reply);
  const baseQuestion = parts?.questions[0]?.text ?? (parts ? GUIDE_COPY.fallbackQuestion : "");
  const questionRaw = here.question ?? baseQuestion;
  const question = questionText(questionRaw);
  const sources = here.reply?.sources ?? [];
  const status = state.status[state.current] ?? "open";
  const of = state.of ?? 1;
  const lastStep = state.current >= of - 1;
  const thinking = isUncertainAnswer(here.answer);
  const fb = here.feedback, fbParts = fb?.answer ? parseCheckFeedback(fb.answer.replace(/^\s*\**VERDICT:[^\n]*\n?/i, "")) : null;
  const followUp = followUpOf(fbParts?.next);
  const move = fb?.verdict ? moveAfterVerdict(fb.verdict.value, followUp) : null;

  const check = async () => {
    const step = state.current, answer = here.answer.trim();
    if (!answer || thinking) return;
    const tag = citedTags(questionRaw)[0];
    const r = await run({ action: "clarify", checkQuestion: question, answer, guided: true, ...(tag ? { checkCited: tag } : {}) });
    if (!r) return;
    if (r.json.clarify) { setClarify({ prompt: r.json.clarify, retry: () => void check() }); return; }
    const json = r.json as GuideReply;
    if (!r.ok || json.withheld) { patch(step, { feedback: null, note: json.next?.why ?? json.message ?? json.error ?? "Your answer could not be checked just now." }); return; }
    patch(step, { feedback: json, note: null });
    if (json.verdict) setStatus(step, moveAfterVerdict(json.verdict.value, null).status);
  };
  const hint = async () => {
    const step = state.current, level = Math.min(GUIDE_HINT_LEVELS, here.hints.length + 1);
    const r = await ask("hint", step, { level, question }, false, () => void hint());
    if (r?.withheld) patch(step, { note: r.next?.why ?? r.message ?? "A hint could not be written just now." });
    else if (r?.answer) patch(step, { hints: [...here.hints, r] });
  };
  const example = async () => {
    const step = state.current;
    if (here.example) return;
    const r = await ask("example", step, { question }, false, () => void example());
    if (r?.withheld) patch(step, { note: r.next?.why ?? r.message ?? "An example could not be written just now." });
    else if (r?.answer) patch(step, { example: r });
  };
  const explain = async () => {
    const step = state.current;
    if (here.explained) { patch(step, { showExplained: true }); return; }
    const r = await ask("explain", step, { question }, false, () => void explain());
    if (r?.withheld) { patch(step, { note: r.next?.why ?? r.message ?? "This could not be explained from your notes just now." }); return; }
    if (r?.answer) { patch(step, { explained: r, showExplained: true }); if (status === "open") setStatus(step, "explained"); }
  };
  const nextStep = () => {
    if (lastStep) { setState(s => ({ ...s, finished: true })); return; }
    void teach(state.current + 1);
  };
  const skip = () => { if (status === "open") setStatus(state.current, "skipped"); nextStep(); };
  const retry = (newQuestion?: string) => { patch(state.current, { feedback: null, ...(newQuestion ? { question: newQuestion, answer: "" } : {}) }); setTimeout(() => box.current?.focus(), 50); };

  const body = (r: GuideReply, p: DeeperParts, sectionNotes = false) => p.sections.map((s, i) => (
    s.kind === "memory"
      ? <div key={i} className="mt-3"><LearningCallout tone="memory" icon="bulb" emphasis="prominent" label={`Memory aid: ${s.title}`}><Blocks blocks={s.blocks} cite={t => cite(t, r.sources ?? [])} /></LearningCallout></div>
      : (s.kind === "misconception" || s.kind === "safety")
        ? <div key={i} className="mt-3"><LearningCallout tone="caution" icon="warn" emphasis={s.kind === "safety" ? "safety" : "standard"} label={s.kind === "safety" ? `Safety: ${s.title}` : s.title}><p><SourceChip source={s.source} /></p><Blocks blocks={s.blocks} cite={t => cite(t, r.sources ?? [])} /></LearningCallout></div>
        : (
          <div key={i} className="mt-3 first:mt-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h5 className="text-[15px] font-bold text-gray-900">{s.title}</h5>
              <SourceChip source={s.source} />
            </div>
            <div className="mt-1 text-[15px] leading-relaxed text-gray-800"><Blocks blocks={s.blocks} cite={t => cite(t, r.sources ?? [])} /></div>
            {sectionNotes && <SectionNote anchor={`guide-${state.current}-s${i}`} label={s.title} chunkId={null} materialId={null} />}
          </div>
        )));
  const statement = deeperEvidenceStatement({ research: here.reply?.research?.text ? "shown" : here.reply?.research ? "looked" : "none", scholar: !!parts?.sections.some(s => s.source === "scholar") });

  return (
    <section aria-labelledby={`${id}-h`} data-testid="guide-me" className={`${learnBox("guide")} mt-3 p-4 sm:p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h4 id={`${id}-h`} className="cmp-learn-ink text-[18px] font-bold">{GUIDE_COPY.card}</h4>
        {state.of && !state.finished && (parts || here.note) && <span data-testid="guide-step" className="rounded-full border border-gray-300 bg-[var(--cmp-app-surface)] px-2.5 py-0.5 text-[12.5px] font-semibold text-gray-800">Step {state.current + 1} of {state.of}</span>}
      </div>
      {state.of && <p data-testid="guide-progress" className="mt-0.5 text-[12.5px] text-gray-700">{progressWords(state.status)}</p>}

      {!parts && !state.finished && (
        <div className="mt-3">
          {busy ? <p role="status" className="text-[14px] text-gray-700">Working…</p>
            : <button type="button" className={learnAction.primary} disabled={disabled} onClick={() => void teach(state.current)}>{GUIDE_COPY.start}</button>}
        </div>
      )}
      {clarify && <div className="mt-3">{renderClarify(clarify.prompt, () => { const go = clarify.retry; setClarify(null); go(); })}</div>}
      {here.note && <p role="status" className="mt-2 rounded-lg border border-gray-200 bg-[var(--cmp-app-surface)] px-3 py-2 text-[13.5px] text-gray-800">{here.note}</p>}

      {state.finished && (
        <div className="mt-3 text-[14.5px] text-gray-900" role="status">
          <p className="font-semibold">{GUIDE_COPY.finished}</p>
          <ul className="mt-1.5 space-y-0.5 text-[13.5px] text-gray-800">{state.status.map((s, i) => <li key={i}>Step {i + 1}: {STATUS_WORDS[s]}</li>)}</ul>
          <button type="button" className={`${learnAction.secondary} mt-2`} onClick={() => setState(st => ({ ...st, finished: false, current: Math.max(0, resumeStep(st.status) >= st.status.length ? 0 : resumeStep(st.status)) }))}>Go back through the steps</button>
        </div>
      )}

      {parts && !state.finished && (
        <>
          <div className="mt-3 rounded-xl bg-gray-100 px-4 py-3.5">
            <p className="break-words text-[17px] font-bold leading-snug text-gray-900">{parts.focus}</p>
            {parts.covers && <p className="mt-0.5 text-[13.5px] text-gray-700">{parts.covers}</p>}
            <div className="mt-2 break-words">{body(here.reply!, parts)}</div>
            {here.reply?.research?.text && <div className="mt-3">{renderResearch(here.reply.research)}</div>}
          </div>
          {here.reply?.salvage && <p className="mt-2 text-[12.5px] text-gray-700">{here.reply.salvage.note}</p>}
          <div className="mt-2"><DisclaimerBadge>{GO_DEEPER_COPY.ai}</DisclaimerBadge></div>

          {/* The question, and the answer directly under it. */}
          <div className="mt-4">
            <p className="cmp-learn-ink flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-[0.08em]"><LearningIcon name="question" className="h-4 w-4" />{GUIDE_COPY.think}</p>
            <p id={`${id}-q`} className="mt-1 break-words text-[16px] font-semibold leading-snug text-gray-900">{question}</p>
            <label htmlFor={`${id}-a`} className="mt-2 block text-[12.5px] font-semibold text-gray-700">Your reasoning</label>
            <textarea ref={box} id={`${id}-a`} aria-describedby={`${id}-q`} rows={4} maxLength={1500} value={here.answer} readOnly={busy || !!fb} placeholder={GUIDE_COPY.placeholder}
              onChange={e => patch(state.current, { answer: e.target.value })}
              className={`mt-1 w-full rounded-xl border border-gray-300 bg-[var(--cmp-app-surface)] px-3 py-2.5 text-[15px] leading-relaxed text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gray-900 ${fb ? "opacity-80" : ""}`} />
            {!fb && thinking && <p role="status" className="mt-1.5 text-[13.5px] text-gray-800">{GUIDE_COPY.uncertain}</p>}
            {!fb && !here.answer.trim() && <p className="mt-1 text-[12.5px] text-gray-700">{GUIDE_COPY.blank}</p>}
            {!fb && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <button type="button" className={learnAction.secondary} disabled={busy || disabled || !!here.example} onClick={() => void example()}>{GUIDE_COPY.example}</button>
                <button type="button" className={learnAction.primary} disabled={busy || disabled || !here.answer.trim() || thinking} onClick={() => void check()}>{busy ? "Working…" : GUIDE_COPY.check}</button>
              </div>
            )}
            {!fb && (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <button type="button" className={learnAction.link} disabled={busy || disabled || here.hints.length >= GUIDE_HINT_LEVELS} onClick={() => void hint()}>{here.hints.length ? GUIDE_COPY.biggerHint : GUIDE_COPY.hint}</button>
                <button type="button" className={learnAction.link} disabled={busy || disabled} onClick={() => void explain()}>{GUIDE_COPY.explain}</button>
                {/* Coming back to a step already dealt with: going on is simply the next step, not moving on without answering. */}
                <button type="button" className={learnAction.link} disabled={busy} onClick={skip}>{status === "open" || status === "attempted" ? GUIDE_COPY.moveOn : lastStep ? GUIDE_COPY.finish : GUIDE_COPY.next}</button>
              </div>
            )}
          </div>

          {here.hints.map((h, i) => { const p = partsOf(h); return p && (
            <div key={i} className="mt-3 rounded-xl border border-gray-200 bg-[var(--cmp-app-surface)] px-3.5 py-3">
              <p className="text-[12.5px] font-bold text-gray-800">Hint {i + 1}. <span className="font-normal">{GUIDE_COPY.hintNote}</span></p>
              <div className="mt-1.5 text-[14.5px]">{body(h, p)}</div>
            </div>
          ); })}
          {here.example && partsOf(here.example) && (
            <div className="mt-3 rounded-xl border border-gray-200 bg-[var(--cmp-app-surface)] px-3.5 py-3">
              <p className="text-[12.5px] font-bold text-gray-800">Example reasoning, on a similar case</p>
              <div className="mt-1.5 text-[14.5px]">{body(here.example, partsOf(here.example)!)}</div>
            </div>
          )}

          {here.explained && here.showExplained && partsOf(here.explained) && (
            <div data-testid="guide-explained" className="mt-3 rounded-xl border border-gray-200 bg-[var(--cmp-app-surface)] px-3.5 py-3">
              <p className="text-[13px] font-bold text-gray-900">{GUIDE_COPY.explain}</p>
              <div className="mt-1.5">{body(here.explained, partsOf(here.explained)!)}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={learnAction.secondary} onClick={() => { patch(state.current, { showExplained: false }); setTimeout(() => box.current?.focus(), 50); }}>{GUIDE_COPY.back}</button>
                <button type="button" className={learnAction.primary} disabled={busy} onClick={nextStep}>{lastStep ? GUIDE_COPY.finish : GUIDE_COPY.next}</button>
              </div>
            </div>
          )}

          {/* Feedback on what the learner actually wrote, then the next move that answer calls for. */}
          {fb && (
            <section aria-label="Feedback on your reasoning" aria-live="polite" className={`${learnTone("check")} mt-3 rounded-xl bg-[var(--learn-surface)] p-3.5 ring-1 ring-[var(--learn-border)]`} data-testid="guide-feedback">
              {fb.verdict && <VerdictLine value={fb.verdict.value} label={fb.verdict.label ?? CHECK_VERDICT_LABEL[fb.verdict.value as keyof typeof CHECK_VERDICT_LABEL] ?? fb.verdict.value} informal={INFORMAL_CHECK_LABEL} />}
              <div className="mt-2 text-[14px] leading-relaxed text-gray-800">
                {fbParts
                  ? <FeedbackParts level={5} parts={[
                      ...(["right", "missing", "misconceptions", "keyPoints"] as const).filter(k => fbParts[k].length > 0).map(k => ({ kind: k as FeedbackKind, heading: CHECK_FEEDBACK_HEADING[k], body: <ul className="mt-1 list-disc space-y-1 pl-5">{fbParts[k].map((x, i) => <li key={i}>{cite(x, fb.sources ?? [])}</li>)}</ul> })),
                      ...(fbParts.next && !followUp ? [{ kind: "next" as FeedbackKind, heading: CHECK_FEEDBACK_HEADING.next, body: <p className="mt-1">{cite(fbParts.next, fb.sources ?? [])}</p> }] : []),
                    ]} />
                  : <div className="whitespace-pre-wrap">{cite(fb.answer ?? "", fb.sources ?? [])}</div>}
              </div>
              {move?.primary === "new_question" && followUp && <p className="mt-3 text-[15px] font-semibold text-gray-900">{followUp}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {move?.primary === "next" && <button type="button" className={learnAction.primary} disabled={busy} onClick={nextStep}>{lastStep ? GUIDE_COPY.finish : GUIDE_COPY.next}</button>}
                {move?.primary === "new_question" && followUp && <button type="button" className={learnAction.primary} onClick={() => retry(followUp)}>{GUIDE_COPY.newQuestion}</button>}
                {move?.primary === "retry" && <button type="button" className={learnAction.primary} onClick={() => retry()}>{GUIDE_COPY.retry}</button>}
                {move && move.primary !== "next" && <button type="button" className={learnAction.secondary} disabled={busy} onClick={nextStep}>{lastStep ? GUIDE_COPY.finish : GUIDE_COPY.next}</button>}
              </div>
            </section>
          )}

          <p className="mt-3 text-[12.5px] leading-snug text-gray-700">{statement}</p>
          {/* COMPETEN-NOTEBOOK-001's My Ideas & Notes goes here, for the whole step, when it lands. */}
          <SectionNote anchor={`guide-${state.current}`} label={parts.focus} chunkId={sources.find(s => s.tag === `S${citedTags(baseQuestion)[0]}`)?.chunkId ?? null} materialId={sources[0]?.materialId ?? null} />
        </>
      )}
    </section>
  );
}
