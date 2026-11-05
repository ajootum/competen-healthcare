"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { RECALL, type RecallChoice } from "@/lib/individual/scholar/recall-choices";

// ONE RECOGNISABLE FLASHCARD (owner, 5 Nov 2026): every flashcard activity -- the Flashcards study session, Revise's cards due,
// a flashcard inside a Revise session, and the recall check inside a lesson -- shows this same card: the prompt on the front,
// the answer hidden until the learner flips it (tap, click, Space or Enter), the answer on the back, and the recall buttons only
// after the flip. This file is the single implementation; it imports nothing from the screens that use it (no import cycle).
// The default is Standard Recall: Remembered / Didn't remember, no typing, no AI. A recall rating is the learner's own judgement,
// formative evidence of practice -- never a mark and never verified competence.

export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

export const Icon = ({ d, size = 18, fill = false }: { d: React.ReactNode; size?: number; fill?: boolean }) => (
  <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
export const I = {
  prev: <path d="M15 18l-6-6 6-6" />, next: <path d="M9 18l6-6-6-6" />, flip: <><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />, check: <path d="M5 12l5 5 9-11" />, note: <><path d="M4 20h4l10-10-4-4L4 16z" /><path d="M14 6l4 4" /></>,
  bookmark: <path d="M6 3h12v18l-6-4-6 4z" />, source: <><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" /></>, flag: <><path d="M12 3l9 16H3z" /><path d="M12 10v4M12 17h.01" /></>,
  book: <><path d="M3 5a2 2 0 0 1 2-2h5v16H5a2 2 0 0 0-2 2z" /><path d="M21 5a2 2 0 0 0-2-2h-5v16h5a2 2 0 0 1 2 2z" /></>,
  play: <path d="M7 4l12 8-12 8z" />, layers: <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>, cal: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  pen: <><path d="M4 20h4l11-11-4-4L4 16z" /></>, down: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 21h16" /></>, spark: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
  doc: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>, target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  ask: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.4a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1 .9-1 1.7M12 17h.01" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  revise: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 8v4l3 2" /></>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />, gap: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><circle cx="12" cy="12" r="4" /></>, plus: <path d="M12 5v14M5 12h14" />,
};


/** One state label on a card: icon AND words, on the state's own tokens (globals.css --cmp-fc-*). Never colour alone. */
function StatePill({ tone, icon, label, fill = false }: { tone: "revise" | "bookmark"; icon: React.ReactNode; label: string; fill?: boolean }) {
  return (
    <span data-fc-state={tone} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12.5px] font-semibold leading-5"
      style={{ background: `var(--cmp-fc-${tone}-surface)`, borderColor: `var(--cmp-fc-${tone}-border)`, color: `var(--cmp-fc-${tone}-ink)` }}>
      <Icon d={icon} size={14} fill={fill} />{label}
    </span>
  );
}

/** The header row of a card face: its icon and name, then the state pills (words and icon, never colour alone). */
export function FaceHeader({ t, side, needsRevision, bookmarked }: { t: "question" | "answer"; side: "front" | "back"; needsRevision: boolean; bookmarked: boolean }) {
  return (
    <span className="relative flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: `var(--cmp-fc-${t}-chip)`, color: `var(--cmp-fc-${t}-label)` }}>
        <Icon d={side === "front" ? I.ask : I.eye} size={20} />
      </span>
      <span className="text-[15px] font-bold" style={{ color: `var(--cmp-fc-${t}-label)` }}>{side === "front" ? "Question" : "Answer"}</span>
      {(needsRevision || bookmarked) && (
        <span className="ml-auto flex flex-wrap justify-end gap-1.5">
          {needsRevision && <StatePill tone="revise" icon={I.revise} label="Needs revision" />}
          {bookmarked && <StatePill tone="bookmark" icon={I.bookmark} label="Bookmarked" fill />}
        </span>
      )}
    </span>
  );
}

/** A face of the card. Question: neutral surface. Answer: calm tinted surface. Needs revision: muted warm edge + label. Bookmarked: icon + label.
 *  With prefers-reduced-motion the faces swap in place (no 3D turn): the hidden one is simply not shown. */
export function CardFace({ side, text, hidden, footer, explanation = null, needsRevision, bookmarked }: { side: "front" | "back"; text: string; hidden: boolean; footer: string; explanation?: string | null; needsRevision: boolean; bookmarked: boolean }) {
  const t = side === "front" ? "question" : "answer";
  return (
    <span aria-hidden={hidden} data-fc-face={t}
      className={`absolute inset-0 flex flex-col overflow-hidden rounded-3xl border-2 p-4 shadow-[0_6px_24px_rgba(17,24,39,0.08)] [backface-visibility:hidden] motion-reduce:[backface-visibility:visible] md:p-7 ${side === "back" ? "[transform:rotateY(180deg)] motion-reduce:[transform:none]" : ""} ${hidden ? "motion-reduce:invisible" : ""}`}
      style={{ background: `var(--cmp-fc-${t}-surface)`, borderColor: needsRevision ? "var(--cmp-fc-revise-border)" : `var(--cmp-fc-${t}-border)`, color: `var(--cmp-fc-${t}-ink)` }}>
      <FaceHeader t={t} side={side} needsRevision={needsRevision} bookmarked={bookmarked} />
      <span className={`relative mt-3 block max-w-[60ch] flex-1 overflow-y-auto font-semibold leading-normal ${side === "front" ? "text-[22px] md:text-[30px]" : "text-[19px] md:text-[24px]"}`} aria-live={side === "back" ? "polite" : undefined}>
        {text}
        {explanation && <span className="mt-3 block text-[17px] font-normal leading-relaxed">{explanation}</span>}
      </span>
      <span className="relative mt-3 inline-flex items-center justify-center gap-2 self-center text-[15px]" style={{ color: `var(--cmp-fc-${t}-label)` }}><Icon d={I.flip} size={16} />{footer}</span>
    </span>
  );
}

/** The card itself: one button holding both faces. Controlled -- the caller owns `revealed` and what flipping does. */
export function FlipCard({ front, back, explanation = null, revealed, onFlip, loadingBack = false, needsRevision = false, bookmarked = false, describedBy }: {
  front: string; back: string | null; explanation?: string | null; revealed: boolean; onFlip: () => void; loadingBack?: boolean;
  needsRevision?: boolean; bookmarked?: boolean; describedBy?: string;
}) {
  return (
    <div className="w-full [perspective:1400px]">
      <button type="button" onClick={onFlip} aria-label={revealed ? "Show the question again" : "Reveal the answer"} aria-describedby={describedBy}
        className={`relative block min-h-[240px] w-full rounded-3xl text-left transition-transform duration-500 [transform-style:preserve-3d] motion-reduce:transition-none motion-reduce:[transform-style:flat] motion-reduce:[transform:none] md:min-h-[340px] ${focusRing} ${revealed ? "[transform:rotateY(180deg)]" : ""}`}>
        <CardFace side="front" hidden={revealed} text={front} footer={loadingBack && !back ? "Showing the answer…" : "Tap to reveal answer"} needsRevision={needsRevision} bookmarked={bookmarked} />
        <CardFace side="back" hidden={!revealed} text={back ?? ""} explanation={explanation} footer="Tap to see the question" needsRevision={needsRevision} bookmarked={bookmarked} />
      </button>
    </div>
  );
}

/** The two recall buttons (Standard Recall): Didn't remember = quality 1, Remembered = quality 4 (flashcards.ts RECALL). */
export function RatingButtons({ busy = false, onRate }: { busy?: boolean; onRate: (choice: RecallChoice) => void }) {
  return (
    <div className="mx-auto mt-4 grid max-w-xl grid-cols-2 gap-3">
      <button type="button" disabled={busy} onClick={() => onRate("again")} aria-keyshortcuts="1"
        className={`flex min-h-[56px] flex-col items-center justify-center rounded-2xl border px-2 py-2 text-center disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}
        style={{ background: "var(--cmp-fc-revise-surface)", borderColor: "var(--cmp-fc-revise-border)", color: "var(--cmp-fc-revise-ink)" }}>
        <span className="inline-flex items-center gap-1.5 text-[15px] font-bold"><Icon d={I.x} size={17} />{RECALL.again.label}</span>
        <span className="text-[12.5px] font-medium">{RECALL.again.sub}</span>
      </button>
      <button type="button" disabled={busy} onClick={() => onRate("remembered")} aria-keyshortcuts="2"
        className={`flex min-h-[56px] flex-col items-center justify-center rounded-2xl border px-2 py-2 text-center disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}
        style={{ background: "var(--cmp-fc-answer-surface)", borderColor: "var(--cmp-fc-answer-border)", color: "var(--cmp-fc-answer-label)" }}>
        <span className="inline-flex items-center gap-1.5 text-[15px] font-bold"><Icon d={I.check} size={17} />{RECALL.remembered.label}</span>
        <span className="text-[12.5px] font-medium">{RECALL.remembered.sub}</span>
      </button>
    </div>
  );
}

/**
 * The card with its recall buttons, for the screens that are not the Flashcards study session. `revealed` is the caller's
 * (the answer has been fetched or shown) and `onFlip` is called to reveal it (so a caller can fetch the back first); once
 * revealed, tapping the card turns it back to the question and again to the answer, in here; `onRate` gets "again" or "remembered" and the caller sends
 * RECALL[choice].quality. The recall buttons appear only once the card is flipped, and not at all when `rated` (already answered).
 * Keys 1 and 2 rate while focus is inside this card (scoped, so several cards on one page never fight over them).
 */
export function RecallCard({ front, back, explanation = null, revealed, onFlip, onRate, busy = false, loadingBack = false, rated = false, footer, nav, needsRevision = false, bookmarked = false }: {
  front: string; back: string | null; explanation?: string | null; revealed: boolean; onFlip: () => void; onRate: (choice: RecallChoice) => void;
  busy?: boolean; loadingBack?: boolean; rated?: boolean; footer?: ReactNode; nav?: ReactNode; needsRevision?: boolean; bookmarked?: boolean;
}) {
  const help = useId();
  // Once the answer is revealed, the card can be turned back to the question and forward again without the caller.
  // Kept against the front it was turned on, so the next card never opens on its question side.
  const [peekFor, setPeekFor] = useState<string | null>(null);
  const peek = revealed && peekFor === front;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!revealed || rated || busy) return;
    if (e.key === "1") onRate("again"); else if (e.key === "2") onRate("remembered");
  };
  return (
    <div onKeyDown={onKeyDown} data-recall-card>
      <FlipCard front={front} back={back} explanation={explanation} revealed={revealed && !peek} onFlip={revealed ? () => setPeekFor(peek ? null : front) : onFlip} loadingBack={loadingBack} needsRevision={needsRevision} bookmarked={bookmarked} describedBy={help} />
      <p id={help} className="sr-only">Space or Enter reveals the answer. Then press 1 for didn&apos;t remember or 2 for remembered.</p>
      {revealed && !rated && <RatingButtons busy={busy} onRate={onRate} />}
      {footer}
      {nav}
    </div>
  );
}
