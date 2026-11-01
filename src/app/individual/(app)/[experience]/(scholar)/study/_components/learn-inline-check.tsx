"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isRated, type QuickMark, type RecallMark } from "@/lib/individual/scholar/learn-inline";
import { PracticeQuestion, ghost, btn, focusRing, lessonFlashcardsHref, req } from "./learn-practice";
import { carry } from "./study-active";

// SCHOLAR-INLINE-CHECKS-01 (owner GO, 1 Nov 2026): SHORT CHECKS INSIDE THE SCROLLING LESSON. Additive: the lesson's Check and
// Practise actions are unchanged. Nothing here calls AI by itself and nothing is generated on reopen.
//
//   RecallBlock  a block of cards, one per lesson it covers, each a question from that SAVED lesson (its check question or key points),
//                the answer behind "Show answer", the learner's OWN rating ("Your own judgement -- not a test score"), and after a
//                missed recall a "Save as a flashcard to revise" (ticked by policy; the learner's own card, saved when they continue or
//                press Save). Required: the next lesson and completion wait for it. Skippable only when optional.
//   QuickCheck   collapsed "Quick check: 1 question": reads a stored question (a GET), marked by code against the stored answer
//                on /attempts. Writing a question stays the learner's click and only when none is stored. A missed answer
//                already reaches the mistake notebook and Revise.
//   ApplyCard    once, after the last lesson: the existing Apply case link.
//
// Three different things, kept apart in the words: self-rated recall, code-marked checks, verified competence (neither of the
// first two is). The lesson's outcome is kept through the learning mark the page already writes (learn-journey.ts `mark`).

export const RECALL_LABEL: Record<RecallMark, string> = { remembered: "You remembered this", again: "You did not remember this", skipped: "Skipped" };

const cardStyle = { background: "var(--cmp-fc-question-surface)", borderColor: "var(--cmp-fc-question-border)", color: "var(--cmp-fc-question-ink)" } as const;
const answerStyle = { background: "var(--cmp-fc-answer-surface)", borderColor: "var(--cmp-fc-answer-border)", color: "var(--cmp-fc-answer-ink)" } as const;
const labelStyle = { color: "var(--cmp-fc-question-label)" } as const;
const touch = "pointer-coarse:min-h-[var(--cmp-touch-min)]";

function RecallIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M10 3a5 5 0 0 0-3 9c.6.5 1 1.2 1 2v.5h4V14c0-.8.4-1.5 1-2a5 5 0 0 0-3-9Z" /><path d="M8.5 17h3" />
    </svg>
  );
}

export type BlockCard = {
  step: number; label: string; front: string; back: string; why: string; sources: { citation: string }[];
  /** The learner's recorded rating for this lesson (any device), or null. */
  mark: RecallMark | null; materialId: string | null; chunkId: string | null;
};

/**
 * ONE BLOCK OF RECALL CARDS (owner, 1 Nov, addenda 2 and 3): one card for each lesson the block covers, each from that saved lesson's own
 * content. Unstarted it says the lesson text is hidden while the learner recalls and offers "Start recall"; starting hides the text (the
 * page does that through onStart) and shows the questions; each card: Show answer, then the learner's own rating. When every card is
 * rated the text returns (onEnd). `required`: no Skip, a skipped card still waits, and either rating counts (it is not a pass mark).
 */
export function RecallBlock({ cards, required, skippable, saveMissed, ownCards, accent, onMark, onStart, onEnd, registerSave }: {
  cards: BlockCard[]; required: boolean; skippable: boolean; saveMissed: boolean; ownCards: boolean; accent: string;
  onMark: (step: number, m: RecallMark) => void; onStart: () => void; onEnd: () => void;
  registerSave: (step: number, fn: (() => Promise<void>) | null) => void;
}) {
  const [started, setStarted] = useState(false);
  const [reopened, setReopened] = useState(false);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const ref = useRef<HTMLElement>(null);
  const done = (m: RecallMark | null) => (required ? isRated(m) : m !== null);
  const allDone = cards.every(c => done(c.mark));
  const allSkipped = !required && cards.length > 0 && cards.every(c => c.mark === "skipped");
  // When the last card is rated, the lesson text comes back.
  const ended = useRef(false);
  useEffect(() => { if (started && allDone && !ended.current) { ended.current = true; onEnd(); } if (!allDone) ended.current = false; }, [started, allDone, onEnd]);
  if (!cards.length) return null;
  if (allSkipped && !reopened) {
    return (
      <p className="mt-4 flex flex-wrap items-center gap-x-2 rounded-xl border px-3 py-2 text-[13px]" style={cardStyle}>
        <span className="flex items-center gap-1.5 font-semibold" style={labelStyle}><RecallIcon />Recall check skipped</span>
        <button type="button" onClick={() => setReopened(true)} className={`inline-flex min-h-[44px] items-center font-semibold underline ${touch} ${focusRing}`}>Show</button>
      </p>
    );
  }
  const start = () => {
    setStarted(true); onStart();
    // After the lesson text collapses, bring the block into view without a jump.
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" })));
  };
  const rate = (step: number, m: RecallMark) => { setFresh(f => new Set(f).add(step)); onMark(step, m); };
  const showItems = started || allDone || reopened;
  return (
    <section ref={ref} aria-label="Check your recall" className="mt-4 w-full scroll-mt-4 rounded-xl border p-3 @sm:p-4" style={cardStyle}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[0.1em]" style={labelStyle}><RecallIcon />Check your recall{allDone ? " · complete" : ""}</p>
        {skippable && !required && !allDone && <button type="button" onClick={() => { cards.forEach(c => { if (c.mark === null) onMark(c.step, "skipped"); }); setReopened(false); setStarted(false); }} className={`inline-flex min-h-[44px] items-center text-[13px] font-semibold underline ${touch} ${focusRing}`}>Skip</button>}
      </div>
      {!showItems && (
        <div className="mt-1">
          <p className="text-[14.5px] font-semibold">Recall check — the lesson text is hidden while you recall</p>
          <p className="mt-0.5 text-[12.5px]" style={labelStyle}>{cards.length === 1 ? "1 question" : `${cards.length} questions, one from each lesson`}, from your saved lessons. You can show the lesson text at any time.</p>
          <button type="button" className={`${btn} mt-3 ${touch}`} style={{ background: accent }} onClick={start}>Start recall</button>
        </div>
      )}
      {showItems && (
        <div className="mt-2 space-y-3">
          {cards.map(c => <RecallItem key={c.step} card={c} multi={cards.length > 1} fresh={fresh.has(c.step)} saveMissed={saveMissed} ownCards={ownCards} onRate={m => rate(c.step, m)} registerSave={registerSave} />)}
        </div>
      )}
    </section>
  );
}

function RecallItem({ card, multi, fresh, saveMissed, ownCards, onRate, registerSave }: {
  card: BlockCard; multi: boolean; fresh: boolean; saveMissed: boolean; ownCards: boolean; onRate: (m: RecallMark) => void;
  registerSave: (step: number, fn: (() => Promise<void>) | null) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const mark = card.mark;
  const rated = isRated(mark);
  const showAnswer = revealed || rated;
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: "var(--cmp-fc-question-border)" }}>
      {multi && <p className="text-[12px] font-semibold" style={labelStyle}>{card.label}</p>}
      <p className="whitespace-pre-wrap break-words text-[15px] font-semibold">{card.front}</p>
      {!showAnswer && <button type="button" className={`${ghost} mt-3 ${touch}`} onClick={() => setRevealed(true)}>Show answer</button>}
      {showAnswer && (
        <div className="mt-3 rounded-lg border px-3 py-2.5" style={answerStyle}>
          <p className="text-[11.5px] font-bold uppercase tracking-[0.1em]" style={{ color: "var(--cmp-fc-answer-label)" }}>Answer</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-[14.5px]">{card.back}</p>
          {(card.why || card.sources.length > 0) && (
            <details className="group mt-2">
              <summary className={`flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-[13px] font-semibold ${touch} [&::-webkit-details-marker]:hidden ${focusRing}`}>
                <span aria-hidden="true" className="text-[10px] transition-transform group-open:rotate-90">▶</span>Why / source
              </summary>
              {card.why && <p className="break-words text-[13.5px]">{card.why}</p>}
              {card.sources.length > 0 && (
                <ul className="mt-1.5 space-y-1 text-[12.5px]">
                  {card.sources.map((x, i) => <li key={i} className="break-words">From {x.citation}</li>)}
                </ul>
              )}
            </details>
          )}
        </div>
      )}
      {showAnswer && !rated && (
        <div className="mt-3">
          <div role="group" aria-label="How well did you remember?" className="flex flex-wrap gap-2">
            <button type="button" className={`${ghost} ${touch}`} onClick={() => onRate("remembered")}>Remembered</button>
            <button type="button" className={`${ghost} ${touch}`} onClick={() => onRate("again")}>Didn&apos;t remember</button>
          </div>
          <p className="mt-2 text-[12px]" style={labelStyle}>Your own judgement — not a test score.</p>
        </div>
      )}
      {rated && mark && (
        <div className="mt-3" aria-live="polite">
          <p className="text-[13.5px] font-semibold">{RECALL_LABEL[mark]} <span className="font-normal" style={labelStyle}>· your own judgement, not a test score</span></p>
          {mark === "again" && ownCards && card.materialId && (
            <MissedCardSave step={card.step} materialId={card.materialId} chunkId={card.chunkId} front={card.front} back={card.back} initiallyTicked={fresh && saveMissed} registerSave={registerSave} />
          )}
          {ownCards && card.materialId && <p className="mt-2"><Link href={lessonFlashcardsHref(card.materialId, card.chunkId)} className={`inline-flex min-h-[44px] items-center font-semibold underline ${touch} ${focusRing}`}>Study flashcards from this lesson</Link></p>}
        </div>
      )}
    </div>
  );
}

/**
 * "Save as a flashcard to revise" after a missed recall: the learner's OWN card (existing POST /flashcards, no AI), drafted from the
 * saved lesson. Ticked to begin with when policy says so; the learner may untick or edit. It is saved when they continue or press Save.
 * Failing to save never blocks them.
 */
function MissedCardSave({ step, materialId, chunkId, front, back, initiallyTicked, registerSave }: {
  step: number; materialId: string; chunkId: string | null; front: string; back: string; initiallyTicked: boolean;
  registerSave: (step: number, fn: (() => Promise<void>) | null) => void;
}) {
  const id = useId();
  const [ticked, setTicked] = useState(initiallyTicked);
  const [f, setF] = useState(front.slice(0, 300));
  const [b, setB] = useState(back.slice(0, 600));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    if (!ticked || state === "saving" || state === "saved" || !f.trim() || !b.trim()) return;
    setState("saving"); setMsg(null);
    const r = await req("/api/individual/scholar/flashcards", { body: { materialId, ...(chunkId ? { chunkId } : {}), front: f.trim(), back: b.trim() } });
    if (!r.ok) { setMsg(String(r.json.error ?? "Your card could not be saved just now.")); setState("error"); return; }
    setMsg(String(r.json.note ?? "Saved to your flashcards as your own card.")); setState("saved");
  };
  const latest = useRef(save);
  useEffect(() => { latest.current = save; });
  const pending = ticked && state === "idle";
  useEffect(() => {
    registerSave(step, pending ? () => latest.current() : null);
    return () => registerSave(step, null);
  }, [pending, step, registerSave]);
  if (state === "saved") return <p role="status" className="mt-2 text-[13px] font-semibold">{msg}</p>;
  return (
    <div className="mt-2">
      <label htmlFor={`${id}-t`} className={`flex cursor-pointer items-start gap-3 text-[13.5px] font-semibold ${touch}`}>
        <input id={`${id}-t`} type="checkbox" checked={ticked} onChange={e => setTicked(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" />
        <span>Save as a flashcard to revise<span className="block text-[12px] font-normal" style={labelStyle}>Your own card, saved when you continue or press Save. Untick to skip it.</span></span>
      </label>
      {ticked && (
        <>
          <details className="group mt-1">
            <summary className={`flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-[13px] font-semibold ${touch} [&::-webkit-details-marker]:hidden ${focusRing}`}><span aria-hidden="true" className="text-[10px] transition-transform group-open:rotate-90">▶</span>Edit the card first</summary>
            <label htmlFor={`${id}-f`} className="block text-[13px] font-semibold">Front (a question)</label>
            <textarea id={`${id}-f`} rows={2} maxLength={300} value={f} onChange={e => setF(e.target.value)} className={`w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-[14px] text-gray-900 ${focusRing}`} />
            <label htmlFor={`${id}-b`} className="mt-1 block text-[13px] font-semibold">Back</label>
            <textarea id={`${id}-b`} rows={3} maxLength={600} value={b} onChange={e => setB(e.target.value)} className={`w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-[14px] text-gray-900 ${focusRing}`} />
          </details>
          <button type="button" className={`${ghost} mt-1 ${touch}`} disabled={state === "saving" || !f.trim() || !b.trim()} onClick={() => void save()}>{state === "saving" ? "Saving…" : "Save now"}</button>
        </>
      )}
      {msg && state === "error" && <p role="alert" className="mt-1 text-[13px] text-red-800">{msg}</p>}
    </div>
  );
}

export function QuickCheck({ chunkId, aiAllowed, result, onResult, onPractised, accent }: {
  chunkId: string; aiAllowed: boolean; result: QuickMark | null; onResult: (m: QuickMark) => void; onPractised: () => void; accent: string;
}) {
  return (
    <details className="group mt-3 rounded-xl border border-gray-200 bg-white">
      <summary className={`flex min-h-[44px] cursor-pointer list-none flex-wrap items-center gap-x-2 px-3 text-[13.5px] font-semibold text-gray-900 ${touch} [&::-webkit-details-marker]:hidden ${focusRing}`}>
        <span aria-hidden="true" className="text-[10px] text-gray-500 transition-transform group-open:rotate-90">▶</span>Quick check: 1 question
        {result && <span className="text-[12px] font-normal text-gray-600">· {result === "correct" ? "answered, matched your notes" : "answered, did not match your notes"}</span>}
      </summary>
      <div className="border-t border-gray-200 px-3 pb-3">
        <PracticeQuestion variant="quick" chunkId={chunkId} aiAllowed={aiAllowed} accent={accent} onPractised={onPractised} onResult={c => onResult(c ? "correct" : "wrong")} />
        <p className="mt-2 text-[12px] text-gray-600">Marked against the stored answer · formative, not verified competence.</p>
      </div>
    </details>
  );
}

export function ApplyCard({ href, skippable, onApplied }: { href: string; skippable: boolean; onApplied: () => void }) {
  const router = useRouter();
  const [skipped, setSkipped] = useState(false);
  if (skipped) return null;
  return (
    <section aria-label="Apply it" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5">
      <p className="min-w-0 text-[13.5px] text-gray-900"><span className="font-semibold">Apply it: try a short case.</span> <span className="text-gray-600">Optional practice on this topic, not an assessment.</span></p>
      <span className="flex flex-wrap gap-2">
        <a href={href} className={`${ghost} ${touch}`} onClick={e => { e.preventDefault(); onApplied(); router.push(carry(href)); }}>Try a case</a>
        {skippable && <button type="button" className={`${ghost} ${touch}`} onClick={() => setSkipped(true)}>Skip</button>}
      </span>
    </section>
  );
}
