"use client";

// SALE-2026-11 R1 (SALE-06 / SALE-07): "Your next step" after a lesson check. Presentational: the decision, its reason and its
// evidence come from the server (learning-need.ts, kept on the attempt). The learner chooses: run the suggested approach (the
// existing Learn action), then answer a DIFFERENT question, or skip. Nothing runs by itself. Formative, never competence.

import { APPROACH_LABEL, AI_APPROACHES, NEED_LABEL, type AdaptiveRecord } from "@/lib/individual/scholar/learning-need";
import { LearningSectionHead, learnBox } from "@/components/ui/scholar-learning";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

export type AdaptiveView = AdaptiveRecord & { earlierQuestions: string[] };
export type AdaptiveUi = { decision: AdaptiveView; attemptId: string; question: string; answer: string; ran: boolean; running: boolean; asked: boolean };

export const ADAPTIVE_NOTE = "A suggestion from your own answers, by a stated rule. Not a judgement of competence. You can always skip it.";

export function AdaptiveNext({ ui, step, accent, offReason, differentLabel, onRun, onDifferent, onSkip }: {
  ui: AdaptiveUi; step: number; accent: string;
  /** Why the suggested approach cannot run now (AI availability), or null. */
  offReason: string | null;
  /** What "a different question" will be: one of the lesson's own, an earlier one, or a new one (Ask me). Null: none offered. */
  differentLabel: string | null;
  onRun: () => void; onDifferent: () => void; onSkip: () => void;
}) {
  const d = ui.decision;
  const runs = d.approach !== "continue";
  const id = `adaptive-${step}`;
  return (
    <section aria-labelledby={`${id}-h`} data-adaptive-need={d.need} data-adaptive-approach={d.approach} className={`${learnBox("next")} mt-4 p-4`}>
      {/* LESSON REDESIGN: the suggested next step in the What next? identity (cyan); sky is kept for AI beyond the notes. */}
      <LearningSectionHead level={4} id={`${id}-h`} icon="target" title="Your next step" />
      <p className="mt-1 text-[14px] font-semibold text-gray-900">{NEED_LABEL[d.need]}{d.misconception ? `: ${d.misconception}` : ""}</p>
      <p className="mt-1 text-[14px] leading-relaxed text-gray-800" id={`${id}-why`}>{d.reason}</p>
      <details className="mt-1.5">
        <summary className={`cursor-pointer text-[12.5px] font-semibold text-gray-700 underline-offset-2 hover:underline pointer-coarse:py-2 ${focusRing}`}>Why Scholar suggests this</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px] text-gray-700">
          {d.evidence.map((e, i) => <li key={i}>{e}</li>)}
          <li>Rule {d.rule}: {NEED_LABEL[d.need].toLowerCase()} leads to {APPROACH_LABEL[d.approach].toLowerCase()}.{d.round > 0 ? ` Corrective step ${d.round} on this lesson.` : ""}</li>
        </ul>
        <p className="mt-1 text-[12px] text-gray-600">{ADAPTIVE_NOTE}</p>
      </details>
      {offReason && AI_APPROACHES.has(d.approach) && <p className="mt-1.5 text-[12.5px] text-gray-700">{offReason}</p>}
      <div className="mt-2.5 flex flex-wrap gap-2 pointer-coarse:flex-col" role="group" aria-label="Your next step">
        {runs && !ui.ran && (
          <button type="button" className={btn} style={{ background: accent }} aria-describedby={`${id}-why`} disabled={ui.running || (!!offReason && AI_APPROACHES.has(d.approach))} onClick={onRun}>
            {ui.running ? "Working…" : APPROACH_LABEL[d.approach]}
          </button>
        )}
        {d.differentQuestion && differentLabel && !ui.asked && (
          <button type="button" className={ui.ran ? btn : ghost} style={ui.ran ? { background: accent } : undefined} disabled={ui.running} onClick={onDifferent}>{differentLabel}</button>
        )}
        <button type="button" className={ghost} disabled={ui.running} onClick={onSkip}>{runs && !ui.ran ? "Skip" : "Close"}</button>
      </div>
      {ui.ran && d.differentQuestion && !ui.asked && <p role="status" className="mt-1.5 text-[12.5px] text-gray-700">Now try a different question: answering a new one well is better evidence than the same one again.</p>}
    </section>
  );
}
