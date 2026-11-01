"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ResizeHandle } from "@/components/ui/resizable";
import { usePaneGrid } from "@/components/ui/pane-grid";
import { sourceHref, studyHref } from "./question-view";
import { flashcardsHref } from "./revise-nav";
import { carry, studyField } from "./study-active";
import type { flashcardPrefill } from "@/lib/individual/scholar/study-carry";
import { DECK_SORT_LABEL, groupByOrganise, needsRevisionOf, scheduleAfterRating, searchDecks, sortDecks, type CardSchedule, type DeckSort } from "@/lib/individual/scholar/flashcard-decks";
import type { PersonalDeck } from "@/lib/individual/scholar/flashcards";

// SCHOLAR FLASHCARDS -- SCHOLAR-FLASHCARDS-01 (owner, 31 Oct 2026), to the owner mock-up.
//
// The card is the focus: deck header (title, cards, last revised, position and progress), the front large, tap or
// click (or Space) to reveal the back on the same card, previous and next either side, and two recall buttons:
// "Didn't remember / Review sooner" (key 1) and "Remembered / Review later" (key 2). Each rating goes to the SAME
// answer route every revision answer uses, which schedules it on the existing SM-2 and logs it (391). Flipping and
// rating never call AI. Then the action row (add note, bookmark, view source, report issue, and edit for a card the
// learner wrote), and the Source & Learning Link panel. Deck Options, Create More Flashcards and the Download menu
// sit in the side column, which drops below the card when the content area cannot hold both (page.tsx, by available
// width: a container query, never a viewport breakpoint). Touch targets grow on coarse pointers (CPR-MOB-001).
// SCHOLAR-FLASHCARDS-QA-01 (staging browser check): only the one md viewport edge here; everything else wraps by the
// width it has. In a study session the header is one line and the card with its two buttons is brought into view on
// start and on previous / next (and only then), so on a phone the card and both buttons fit the first screen.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const ghost = `inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const primary = `inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const field = `rounded-lg border border-gray-300 px-2.5 py-2 text-[14px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const indigo = "var(--cmp-role-indigo-strong)";

// SCHOLAR-FLASHCARDS-QA-01: the Flashcards page layout, by the content area's own width (Tailwind container queries on
// the @container wrapper in page.tsx), never a viewport breakpoint. Card column at least 22rem, Deck Options at least
// 16rem: under 39rem they stack. The 11.5rem Revise column appears from 56rem. Exported for the layout test.
export const FLASHCARDS_GRID = "grid grid-cols-1 items-start gap-4 @min-[39rem]:grid-cols-[minmax(22rem,1fr)_minmax(16rem,20rem)] @min-[56rem]:grid-cols-[var(--fc-nav,11.5rem)_auto_minmax(22rem,1fr)_auto_var(--fc-side,16rem)] @min-[56rem]:gap-0";
export const FLASHCARDS_NAV = "min-w-0 col-span-full @min-[56rem]:col-span-1 @min-[56rem]:col-start-1 @min-[56rem]:row-start-1";
export const FLASHCARDS_MAIN = "min-w-0 space-y-4 @min-[56rem]:col-start-3 @min-[56rem]:row-start-1";
export const FLASHCARDS_SIDE = "min-w-0 space-y-4 @min-[56rem]:col-start-5 @min-[56rem]:row-start-1";
const FLASHCARDS_HANDLE = "hidden @min-[56rem]:block @min-[56rem]:row-start-1 @min-[56rem]:self-stretch";

/** Drag-to-resize (owner, 1 Nov): from 56rem the Revise column and Deck Options can be resized (11.5rem / 16rem by default,
 *  at least 160px / 200px; the card column keeps 22rem). The two 20px dividers are columns of the grid, hidden below 56rem. */
export function FlashcardsGrid({ nav, main, side }: { nav: ReactNode; main: ReactNode; side: ReactNode }) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [, cols] = usePaneGrid({ container: box, minMain: 352,
    start: { storageKey: "scholar.flashcards.nav.w", defaultPx: 184, minPx: 160 },
    end: { storageKey: "scholar.flashcards.side.w", defaultPx: 256, minPx: 200 } });
  return (
    <div ref={setBox} className={FLASHCARDS_GRID}
      style={{ "--fc-nav": `${cols.start.size ?? 184}px`, "--fc-side": `min(${cols.end.size ?? 256}px, max(200px, calc(100cqw - 40px - 22rem - var(--fc-nav))))` } as CSSProperties}>
      {nav}
      <ResizeHandle {...cols.start.handleProps} label="Resize the Revise column" className={`${FLASHCARDS_HANDLE} @min-[56rem]:col-start-2`} />
      {main}
      <ResizeHandle {...cols.end.handleProps} label="Resize the Deck Options column" className={`${FLASHCARDS_HANDLE} @min-[56rem]:col-start-4`} />
      {side}
    </div>
  );
}

async function call(url: string, body?: unknown, method = "POST"): Promise<{ ok: boolean; status: number; json: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, status: 0, json: { error: "Competen could not be reached. Check your connection and try again." } };
  }
}

const Icon = ({ d, size = 18, fill = false }: { d: React.ReactNode; size?: number; fill?: boolean }) => (
  <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);
const I = {
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

export const ISSUE_CODES = [
  { value: "inaccurate", label: "Inaccurate" }, { value: "unclear", label: "Unclear" }, { value: "evidence", label: "Not supported by its source" },
  { value: "difficulty", label: "Wrong difficulty" }, { value: "relevance", label: "Not relevant" },
] as const;

const when = (iso: string | null) => {
  if (!iso) return "Not yet";
  const d = iso.slice(0, 10), today = new Date().toISOString().slice(0, 10);
  if (d === today) return "Today";
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: d.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric", timeZone: "UTC" });
};

// ── THE DECK HEADER ──

export function DeckHeader({ title, cards, lastRevised, position, total, answered, glyph, compact = false }: { title: string; cards: number; lastRevised: string | null; position?: number; total?: number; answered?: number; glyph?: string; compact?: boolean }) {
  const pct = total ? Math.round(((answered ?? 0) / total) * 100) : null;
  // A study session (focus mode): ONE line -- the deck's name, where you are and the progress -- so the card is near the top.
  if (compact && total) return (
    <div data-testid="deck-header-compact" className="flex min-w-0 items-center gap-3">
      <h1 className="min-w-0 flex-1 truncate text-[16px] font-bold text-gray-900 md:text-[18px]" title={`Flashcards: ${title}`}>Flashcards: {title}</h1>
      <p className="shrink-0 text-[13px] font-semibold text-gray-700 tabular-nums" aria-live="polite">Card {position} of {total}</p>
      <div className="h-1.5 w-16 shrink-0 rounded-full bg-gray-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0} aria-label="Cards rated in this session">
        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: "var(--cmp-role-progress-accent)" }} />
      </div>
    </div>
  );
  return (
    <div className="flex flex-wrap items-center gap-3 md:gap-4">
      <span aria-hidden className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--cmp-role-indigo-soft)] text-[20px] font-bold text-[var(--cmp-role-indigo-ink)] md:h-14 md:w-14">{glyph ?? title.slice(0, 1).toUpperCase()}</span>
      <div className="min-w-[12rem] flex-1">
        <h1 className="text-[19px] font-bold leading-tight text-gray-900 md:text-[22px]">Flashcards: {title}</h1>
        <p className="mt-0.5 text-[13px] text-gray-600">Deck · {cards} card{cards === 1 ? "" : "s"} · Last revised: {when(lastRevised)}</p>
      </div>
      {total ? (
        <div className="min-w-[11rem] grow basis-44 text-right" aria-live="polite">
          <p className="text-[13.5px] font-semibold text-gray-700 tabular-nums">Card {position} of {total}</p>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-gray-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0} aria-label="Cards rated in this session">
              <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: "var(--cmp-role-progress-accent)" }} />
            </div>
            <span className="text-[13px] text-gray-600 tabular-nums">{pct}%</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── STUDY: ONE CARD AT A TIME ──

export type StudyCard = {
  id: string; front: string; origin: "notes" | "library" | "learner"; originLabel: string; citation: string;
  materialId: string; materialTitle: string; chunkId: string; competency: string | null; topic: string | null;
  editable: boolean; bookmarked: boolean; note: string | null; issue: string | null;
  /** SCHOLAR-FLASHCARDS-QA-01: the clinically sensitive marker (flashcard-sensitive.ts), or null. Shown with the answer. */
  sensitive?: { marker: string; reviewed: boolean } | null;
  /** SCHOLAR-FLASHCARDS follow-up: the saved lesson this card's section belongs to, and the study session its deck is linked to (exact only). */
  links?: { lesson: { title: string; href: string } | null; study: { title: string; href: string } | null } | null;
  answered: { recall: "again" | "remembered"; nextReviewAt: string | null } | null;
  /** The card's schedule row (last_quality, next_review_at, status, reviews), kept current in the session: "Needs revision" is read from it (flashcard-decks.ts needsRevisionOf). */
  schedule?: CardSchedule | null;
  /** Only for a card already rated in this session: answers stay on the server until the learner reveals them. */
  back: { text: string; explanation: string | null; quote: string | null } | null;
};

export function FlashcardStudy(props: {
  sessionId: string; today: string; deckTitle: string; deckKey: string | null; deckCards: number; lastRevised: string | null; cards: StudyCard[]; marksOn: boolean; completed: boolean;
}) {
  const router = useRouter();
  const [cards, setCards] = useState(props.cards);
  const [at, setAt] = useState(() => Math.max(0, props.cards.findIndex(c => !c.answered)));
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<"" | "note" | "source" | "issue" | "edit">("");
  const [status, setStatus] = useState("");
  const [finished, setFinished] = useState(props.completed);
  const card = cards[Math.min(at, cards.length - 1)];
  const answered = cards.filter(c => c.answered).length;
  const update = (id: string, patch: Partial<StudyCard>) => setCards(cs => cs.map(c => (c.id === id ? { ...c, ...patch } : c)));

  // The card and its two buttons: scrolled into view on session start and on previous / next, only when not already
  // fully visible below the sticky header and above the phone's bottom bar. The learner's own scrolling is left alone.
  const focusRef = useRef<HTMLDivElement>(null);
  const bringIntoView = useCallback(() => {
    const el = focusRef.current;
    if (!el || typeof window === "undefined") return;
    const r = el.getBoundingClientRect(), header = 56, bottomBar = 56;
    if (r.top < header || r.bottom > window.innerHeight - bottomBar)
      el.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, []);
  useEffect(() => { bringIntoView(); }, [bringIntoView]);
  const go = useCallback((n: number) => {
    setAt(Math.max(0, Math.min(cards.length - 1, n))); setFlipped(false); setPanel(""); setError(""); setStatus("");
    requestAnimationFrame(bringIntoView);
  }, [cards.length, bringIntoView]);

  const reveal = useCallback(async () => {
    if (!card || busy) return;
    if (card.back) { setFlipped(f => !f); return; }
    setBusy(true); setError("");
    const r = await call("/api/individual/scholar/revision/answer", { questionId: card.id, sessionId: props.sessionId, reveal: true });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "The answer could not be shown just now."); return; }
    update(card.id, { back: { text: r.json.back ?? "", explanation: r.json.card?.explanation ?? null, quote: r.json.source?.quote || null } });
    setFlipped(true);
  }, [card, busy, props.sessionId]);

  const rate = useCallback(async (choice: "again" | "remembered") => {
    if (!card || busy || card.answered) return;
    if (!card.back) { await reveal(); return; }
    setBusy(true); setError("");
    // SM-2 qualities (flashcards.ts RECALL): Didn't remember = 1 (a lapse), Remembered = 4 (a recall).
    const r = await call("/api/individual/scholar/revision/answer", { questionId: card.id, sessionId: props.sessionId, response: { quality: choice === "again" ? 1 : 4 } });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "Your rating could not be saved."); return; }
    update(card.id, { answered: { recall: choice, nextReviewAt: r.json.feedback?.nextReviewAt ?? null }, schedule: scheduleAfterRating(card.schedule, choice, r.json.feedback?.nextReviewAt ?? null) });
    setStatus(`${choice === "again" ? "Review sooner" : "Review later"}: next review ${when(r.json.feedback?.nextReviewAt ?? null).toLowerCase() === "today" ? "today" : when(r.json.feedback?.nextReviewAt ?? null)}.`);
    const next = cards.findIndex((c, i) => i > at && !c.answered);
    const any = next >= 0 ? next : cards.findIndex(c => !c.answered && c.id !== card.id);
    if (any >= 0) setTimeout(() => go(any), 450);
  }, [card, busy, cards, at, go, reveal, props.sessionId]);

  async function finish() {
    await call(`/api/individual/scholar/revision/sessions/${props.sessionId}`, { complete: true }, "PATCH");
    setFinished(true); router.refresh();
  }

  // Keyboard: Space or Enter flips, 1 Didn't remember, 2 Remembered, arrows previous and next. Never while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " " && t.tagName !== "BUTTON" && t.tagName !== "A") { e.preventDefault(); void reveal(); }
      else if (e.key === "1") void rate("again");
      else if (e.key === "2") void rate("remembered");
      else if (e.key === "ArrowLeft") go(at - 1);
      else if (e.key === "ArrowRight") go(at + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reveal, rate, go, at]);

  if (!card) return <p className="text-[14px] text-gray-600">This session has no cards.</p>;
  const allDone = cards.every(c => c.answered);
  // "Needs revision" is a schedule state, never a verdict: the last recall in this session was "Didn't remember", or (not yet rated
  // here) the card is due or flagged for more practice. Rated "Remembered" in this session clears it.
  const needsRevision = needsRevisionOf(card.schedule, props.today);
  const remembered = cards.filter(c => c.answered?.recall === "remembered").length;

  return (
    <section aria-label="Study flashcards" className="rounded-3xl border border-gray-200 bg-white p-4 md:p-6">
      <DeckHeader compact={!(finished || (allDone && props.completed))} title={props.deckTitle} cards={props.deckCards} lastRevised={props.lastRevised} position={at + 1} total={cards.length} answered={answered} />

      {finished || (allDone && props.completed) ? (
        <div className="mt-6 space-y-3 rounded-2xl border p-5" style={{ background: "var(--cmp-fc-answer-surface)", borderColor: "var(--cmp-fc-answer-border)" }}>
          <p className="text-[16px] font-bold text-gray-900">Session finished: you remembered {remembered} of {cards.length}.</p>
          <p className="text-[13.5px] text-gray-700">Cards you did not remember come back sooner; the rest come back later, on the spaced review schedule. This is practice, not an assessment.</p>
          <div className="flex flex-wrap gap-2">
            <Link href={flashcardsHref({ deck: props.deckKey })} className={ghost}>Back to the deck</Link>
            <Link href={flashcardsHref({ view: "history" })} className={ghost}>See your revision history</Link>
          </div>
        </div>
      ) : (
        <>
          <div ref={focusRef} data-testid="card-focus" className="mx-auto mt-4 w-full max-w-[40rem] scroll-mt-[4.5rem] md:scroll-mt-[6rem]">
            <div className="w-full [perspective:1400px]">
              <button type="button" onClick={() => void reveal()} aria-label={flipped ? "Show the question again" : "Reveal the answer"} aria-describedby="card-help card-state"
                className={`relative block min-h-[220px] w-full rounded-3xl text-left transition-transform duration-500 [transform-style:preserve-3d] motion-reduce:transition-none motion-reduce:[transform-style:flat] motion-reduce:[transform:none] md:min-h-[280px] ${focusRing} ${flipped ? "[transform:rotateY(180deg)]" : ""}`}>
                <CardFace side="front" hidden={flipped} text={card.front} footer={busy && !card.back ? "Showing the answer…" : "Tap to reveal answer"} needsRevision={needsRevision} bookmarked={card.bookmarked} />
                <CardFace side="back" hidden={!flipped} text={card.back?.text ?? ""} explanation={card.back?.explanation ?? null} footer="Tap to see the question" needsRevision={needsRevision} bookmarked={card.bookmarked} />
              </button>
            </div>
          {flipped && card.sensitive && (
            <p role="note" className="mx-auto mt-3 flex max-w-xl items-start gap-2 rounded-xl border px-3 py-2 text-[13px] font-semibold"
              style={{ background: "var(--cmp-surface-warning)", borderColor: "color-mix(in srgb, var(--cmp-color-warning) 35%, transparent)", color: "var(--cmp-text-warning)" }}>
              <span aria-hidden className="mt-px">⚠</span><span>{card.sensitive.marker}</span>
            </p>
          )}
          <p id="card-state" className="sr-only">{flipped ? "Answer side." : "Question side."}{needsRevision ? " Needs revision." : ""}{card.bookmarked ? " Bookmarked." : ""}</p>
          <p id="card-help" className="sr-only">Space or Enter reveals the answer. Then press 1 for didn&apos;t remember or 2 for remembered. Arrow keys move between cards.</p>

          {card.answered ? (
            <p role="status" className="mx-auto mt-4 max-w-xl rounded-xl bg-gray-50 px-4 py-2.5 text-center text-[14px] text-gray-800">
              You rated this card <span className="font-semibold">{card.answered.recall === "remembered" ? "Remembered" : "Didn't remember"}</span>. Next review: {when(card.answered.nextReviewAt)}.
            </p>
          ) : (
            <div className="mx-auto mt-4 grid max-w-xl grid-cols-2 gap-3">
              <button type="button" disabled={busy} onClick={() => void rate("again")} aria-keyshortcuts="1"
                className={`flex min-h-[56px] flex-col items-center justify-center rounded-2xl border px-2 py-2 text-center disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}
                style={{ background: "var(--cmp-fc-revise-surface)", borderColor: "var(--cmp-fc-revise-border)", color: "var(--cmp-fc-revise-ink)" }}>
                <span className="inline-flex items-center gap-1.5 text-[15px] font-bold"><Icon d={I.x} size={17} />Didn&apos;t remember</span>
                <span className="text-[12.5px] font-medium">Review sooner</span>
              </button>
              <button type="button" disabled={busy} onClick={() => void rate("remembered")} aria-keyshortcuts="2"
                className={`flex min-h-[56px] flex-col items-center justify-center rounded-2xl border px-2 py-2 text-center disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}
                style={{ background: "var(--cmp-fc-answer-surface)", borderColor: "var(--cmp-fc-answer-border)", color: "var(--cmp-fc-answer-label)" }}>
                <span className="inline-flex items-center gap-1.5 text-[15px] font-bold"><Icon d={I.check} size={17} />Remembered</span>
                <span className="text-[12.5px] font-medium">Review later</span>
              </button>
            </div>
          )}
          </div>
          {/* Previous and next under the buttons at every width, so they stay within reach and the card keeps the column. */}
          <div className="mx-auto mt-3 flex max-w-[40rem] justify-between">
            <button type="button" onClick={() => go(at - 1)} disabled={at === 0} aria-label="Previous card" className={ghost}><Icon d={I.prev} />Previous</button>
            <button type="button" onClick={() => go(at + 1)} disabled={at >= cards.length - 1} aria-label="Next card" className={ghost}>Next<Icon d={I.next} /></button>
          </div>
          {status && <p role="status" className="mt-2 text-center text-[13px] text-gray-700">{status}</p>}
          {error && <p role="alert" className="mt-2 text-center text-[13.5px] font-semibold text-red-800">{error}</p>}
          {allDone && <div className="mt-4 text-center"><button type="button" className={primary} style={{ background: indigo }} onClick={finish}>Finish and see how it went</button></div>}

          <div className="mx-auto mt-4 grid max-w-xl grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-1">
            <ActionButton icon={I.note} label={card.note ? "Your note" : "Add note"} on={panel === "note"} disabled={!props.marksOn} onClick={() => setPanel(p => (p === "note" ? "" : "note"))} />
            <ActionButton icon={I.bookmark} bookmark label={card.bookmarked ? "Bookmarked" : "Bookmark"} on={card.bookmarked} disabled={!props.marksOn}
              onClick={async () => { const r = await call(`/api/individual/scholar/flashcards/${card.id}`, { bookmarked: !card.bookmarked }, "PATCH"); if (r.ok) update(card.id, { bookmarked: !card.bookmarked }); else setError(r.json.error ?? "That could not be saved."); }} />
            <ActionButton icon={I.source} label="View source" on={panel === "source"} onClick={() => setPanel(p => (p === "source" ? "" : "source"))} />
            <ActionButton icon={I.flag} label={card.issue ? "Issue reported" : "Report issue"} on={panel === "issue"} disabled={!props.marksOn} onClick={() => setPanel(p => (p === "issue" ? "" : "issue"))} />
          </div>
          {!props.marksOn && <p className="mt-1 text-center text-[12px] text-gray-500">Notes, bookmarks and reports are not available here yet.</p>}
          {card.editable && <p className="mt-1 text-center"><button type="button" className={`inline-flex items-center text-[13px] font-semibold underline pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`} onClick={() => setPanel(p => (p === "edit" ? "" : "edit"))}>Edit this card</button></p>}

          {panel === "note" && <NotePanel card={card} onSaved={note => update(card.id, { note })} />}
          {panel === "issue" && <IssuePanel card={card} onSaved={issue => update(card.id, { issue })} />}
          {panel === "edit" && <EditCard id={card.id} front={card.front} back={card.back?.text ?? ""} onSaved={() => router.refresh()} />}
          {panel === "source" && (
            <div className="mt-3 rounded-2xl border border-gray-200 p-4 text-[13.5px]">
              <p className="font-semibold text-gray-900">{card.originLabel}</p>
              {card.origin === "notes" && <p className="mt-1 text-gray-700">{card.citation}{" "}<Link href={sourceHref(card.materialId, card.chunkId)} className={`font-semibold underline ${focusRing}`}>Open the section</Link></p>}
              {card.origin === "library" && <p className="mt-1 text-gray-700">{card.citation}</p>}
              {card.origin === "learner" && <p className="mt-1 text-gray-700">You wrote this card. It is filed with {card.materialTitle}.</p>}
              {card.back?.quote ? <blockquote className="mt-2 border-l-4 border-gray-200 pl-3 text-gray-700">“{card.back.quote}”</blockquote>
                : card.origin === "notes" && <p className="mt-2 text-[12.5px] text-gray-500">Reveal the answer to see the words from your notes it rests on.</p>}
            </div>
          )}
        </>
      )}

      <SourceLink card={card} />
      <p className="mt-3 text-center text-[12px] text-gray-500">Formative practice · private to you · not an assessment or verified competence.</p>
    </section>
  );
}

/** One state label on a card: icon AND words, on the state's own tokens (globals.css --cmp-fc-*). Never colour alone. */
function StatePill({ tone, icon, label, fill = false }: { tone: "revise" | "bookmark"; icon: React.ReactNode; label: string; fill?: boolean }) {
  return (
    <span data-fc-state={tone} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12.5px] font-semibold leading-5"
      style={{ background: `var(--cmp-fc-${tone}-surface)`, borderColor: `var(--cmp-fc-${tone}-border)`, color: `var(--cmp-fc-${tone}-ink)` }}>
      <Icon d={icon} size={14} fill={fill} />{label}
    </span>
  );
}

/** A face of the card. Question: neutral surface. Answer: calm tinted surface. Needs revision: muted warm edge + label. Bookmarked: icon + label.
 *  With prefers-reduced-motion the faces swap in place (no 3D turn): the hidden one is simply not shown. */
function CardFace({ side, text, hidden, footer, explanation = null, needsRevision, bookmarked }: { side: "front" | "back"; text: string; hidden: boolean; footer: string; explanation?: string | null; needsRevision: boolean; bookmarked: boolean }) {
  const t = side === "front" ? "question" : "answer";
  return (
    <span aria-hidden={hidden} data-fc-face={t}
      className={`absolute inset-0 flex flex-col overflow-hidden rounded-3xl border-2 p-4 shadow-[0_6px_24px_rgba(17,24,39,0.08)] [backface-visibility:hidden] motion-reduce:[backface-visibility:visible] md:p-7 ${side === "back" ? "[transform:rotateY(180deg)] motion-reduce:[transform:none]" : ""} ${hidden ? "motion-reduce:invisible" : ""}`}
      style={{ background: `var(--cmp-fc-${t}-surface)`, borderColor: needsRevision ? "var(--cmp-fc-revise-border)" : `var(--cmp-fc-${t}-border)`, color: `var(--cmp-fc-${t}-ink)` }}>
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
      <span className={`relative mt-3 block max-w-[60ch] flex-1 overflow-y-auto font-semibold leading-normal ${side === "front" ? "text-[20px] md:text-[27px]" : "text-[18px] md:text-[22px]"}`} aria-live={side === "back" ? "polite" : undefined}>
        {text}
        {explanation && <span className="mt-3 block text-[17px] font-normal leading-relaxed">{explanation}</span>}
      </span>
      <span className="relative mt-3 inline-flex items-center justify-center gap-2 self-center text-[15px]" style={{ color: `var(--cmp-fc-${t}-label)` }}><Icon d={I.flip} size={16} />{footer}</span>
    </span>
  );
}

function ActionButton({ icon, label, on, disabled, onClick, bookmark = false }: { icon: React.ReactNode; label: string; on?: boolean; disabled?: boolean; onClick: () => void; bookmark?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={on}
      className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl px-2 text-[13.5px] font-semibold disabled:opacity-40 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing} ${on && !bookmark ? "bg-[var(--cmp-role-indigo-soft)] text-[var(--cmp-role-indigo-ink)]" : on ? "" : "text-gray-800 hover:bg-gray-50"}`}
      style={on && bookmark ? { background: "var(--cmp-fc-bookmark-surface)", color: "var(--cmp-fc-bookmark-ink)" } : undefined}>
      <Icon d={icon} size={17} fill={!!(on && bookmark)} />{label}
    </button>
  );
}

function NotePanel({ card, onSaved }: { card: StudyCard; onSaved: (note: string | null) => void }) {
  const [text, setText] = useState(card.note ?? "");
  const [msg, setMsg] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = await call(`/api/individual/scholar/flashcards/${card.id}`, { note: text.trim() || null }, "PATCH");
    setMsg(r.ok ? "Saved. Only you can see it." : r.json.error ?? "Your note could not be saved.");
    if (r.ok) onSaved(text.trim() || null);
  }
  return (
    <form onSubmit={save} className="mt-3 rounded-2xl border border-gray-200 p-4">
      <label className="block text-[13px] font-semibold text-gray-800">Your private note on this card
        <textarea value={text} onChange={e => setText(e.target.value)} maxLength={1000} rows={3} className={`${field} mt-1 block w-full`} placeholder="For example: ask about this in the tutorial" />
      </label>
      <p className="mt-1 text-[12px] text-gray-500">Do not include anything that identifies a patient.</p>
      <div className="mt-2 flex items-center gap-2"><button type="submit" className={ghost}>Save note</button>{msg && <span role="status" className="text-[13px] text-gray-700">{msg}</span>}</div>
    </form>
  );
}

function IssuePanel({ card, onSaved }: { card: StudyCard; onSaved: (issue: string | null) => void }) {
  const [code, setCode] = useState(card.issue ?? "");
  const [msg, setMsg] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = await call(`/api/individual/scholar/flashcards/${card.id}`, { issue: code || null }, "PATCH");
    if (!r.ok) { setMsg(r.json.error ?? "That could not be saved."); return; }
    // An AI-written card from the notes also goes to the existing feedback path, as codes only (it changes nothing by itself).
    if (code && card.origin === "notes") await call("/api/individual/scholar/feedback", { target: "question", ref: card.id, rating: "negative", reasons: [code] });
    onSaved(code || null);
    setMsg(code ? "Reported. It is on your own list of cards to check; nothing is changed or published." : "Report withdrawn.");
  }
  return (
    <form onSubmit={save} className="mt-3 rounded-2xl border border-gray-200 p-4">
      <fieldset>
        <legend className="text-[13px] font-semibold text-gray-800">What is wrong with this card?</legend>
        <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-1.5">
          {ISSUE_CODES.map(c => <label key={c.value} className="inline-flex items-center gap-2 text-[13.5px]"><input type="radio" name="issue" checked={code === c.value} onChange={() => setCode(c.value)} />{c.label}</label>)}
          {card.issue && <label className="inline-flex items-center gap-2 text-[13.5px]"><input type="radio" name="issue" checked={code === ""} onChange={() => setCode("")} />Withdraw my report</label>}
        </div>
      </fieldset>
      <div className="mt-2 flex items-center gap-2"><button type="submit" className={ghost} disabled={!code && !card.issue}>Save</button>{msg && <span role="status" className="text-[13px] text-gray-700">{msg}</span>}</div>
    </form>
  );
}

export function EditCard({ id, front, back, onSaved }: { id: string; front: string; back: string; onSaved: () => void }) {
  const [f, setF] = useState(front);
  const [b, setB] = useState(back);
  const [msg, setMsg] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = await call(`/api/individual/scholar/flashcards/${id}`, { front: f, back: b }, "PATCH");
    setMsg(r.ok ? "Saved. Its review history is kept." : r.json.error ?? "Your card could not be saved.");
    if (r.ok) onSaved();
  }
  return (
    <form onSubmit={save} className="mt-3 space-y-2 rounded-2xl border border-gray-200 p-4">
      <label className="block text-[13px] font-semibold text-gray-800">Front (a question, or a term to recall)
        <input value={f} onChange={e => setF(e.target.value)} maxLength={300} className={`${field} mt-1 block w-full`} />
      </label>
      <label className="block text-[13px] font-semibold text-gray-800">Back (the answer, in a sentence or two)
        <textarea value={b} onChange={e => setB(e.target.value)} maxLength={600} rows={3} className={`${field} mt-1 block w-full`} placeholder={back ? undefined : "Reveal the card first to edit its answer"} />
      </label>
      <div className="flex items-center gap-2"><button type="submit" className={ghost} disabled={!f.trim() || !b.trim()}>Save card</button>{msg && <span role="status" className="text-[13px] text-gray-700">{msg}</span>}</div>
    </form>
  );
}

function SourceLink({ card }: { card: StudyCard }) {
  const from = card.origin === "library" ? "The Competen library (clinically reviewed)" : card.origin === "learner" ? `Your own card (filed with ${card.materialTitle})` : `Your uploaded notes (${card.materialTitle})`;
  return (
    <div className="mt-4 rounded-2xl border border-[var(--cmp-role-indigo-soft)] bg-[color-mix(in_srgb,var(--cmp-role-indigo-soft)_45%,white)] p-4">
      <p className="inline-flex items-center gap-2 text-[14.5px] font-bold text-gray-900"><Icon d={I.book} />Source &amp; Learning Link</p>
      <p className="mt-1 text-[13.5px] text-gray-700">
        {card.competency ? <>CFCA: {card.competency} · </> : null}{card.topic ? <>Topic: {card.topic} · </> : null}From: {from}
      </p>
      {card.links?.lesson && <p className="mt-1 text-[13.5px] text-gray-700">From lesson: <Link href={card.links.lesson.href} className={`font-semibold underline ${focusRing}`}>{card.links.lesson.title}</Link></p>}
      {card.links?.study && <p className="mt-1 text-[13.5px] text-gray-700">Study session: <Link href={card.links.study.href} className={`font-semibold underline ${focusRing}`}>{card.links.study.title}</Link></p>}
      {card.origin !== "library" && (
        <Link href={`${studyHref("learn")}?section=${card.chunkId}`} className={`mt-1 inline-flex items-center gap-1 text-[13.5px] font-semibold text-[var(--cmp-role-indigo-ink)] underline-offset-2 hover:underline ${focusRing}`}>Revise this topic in Learn →</Link>
      )}
    </div>
  );
}

// ── THE SIDE COLUMN: DECK OPTIONS, DOWNLOAD, CREATE MORE ──

export type ExportFormat = "deck" | "print" | "guide";
/** SCHOLAR-FLASHCARDS-QA-01: the five downloads, each a format the policy offers with its variant (guide, layout). */
export const EXPORT_CHOICES: readonly { key: string; format: ExportFormat; extra?: Readonly<Record<string, string>>; label: string }[] = [
  { key: "deck", format: "deck", label: "This deck (flashcards) – PDF" },
  { key: "guide", format: "guide", label: "Revision guide, comprehensive – PDF" },
  { key: "guide-concise", format: "guide", extra: { guide: "concise" }, label: "Revision guide, concise – PDF" },
  { key: "print", format: "print", label: "Printable cards, double-sided – PDF" },
  { key: "print-fold", format: "print", extra: { layout: "fold" }, label: "Printable cards, single-sided foldable – PDF" },
];
export const exportHref = (format: ExportFormat, decks: readonly string[], extra: Readonly<Record<string, string>> = {}) => {
  const q = new URLSearchParams({ format, ...extra });
  for (const d of decks) q.append("deck", d);
  return `/api/individual/scholar/flashcards/export?${q.toString()}`;
};

/** The Download menu. Each download is offered by policy; one whose route is not deployed yet says so and is disabled. */
export function DownloadMenu({ decks, formats, label = "Download" }: { decks: readonly string[]; formats: readonly ExportFormat[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    // The route is absent only when the server answers with its not-found page (404, not JSON).
    fetch("/api/individual/scholar/flashcards/export?format=deck", { method: "HEAD" })
      .then(r => { if (live) setReady(!(r.status === 404 && !(r.headers.get("content-type") ?? "").includes("json"))); })
      .catch(() => { if (live) setReady(false); });
    return () => { live = false; };
  }, []);
  return (
    <div className="relative">
      <button type="button" className={`${ghost} w-full justify-between`} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(o => !o)}>
        <span className="inline-flex items-center gap-2"><Icon d={I.down} />{label}</span><Icon d={<path d="M6 9l6 6 6-6" />} size={16} />
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
          {EXPORT_CHOICES.filter(x => formats.includes(x.format)).map(x => (
            <li key={x.key}>
              {ready && decks.length ? (
                <a href={exportHref(x.format, decks, x.extra)} className={`flex min-h-[40px] items-center gap-2 rounded-lg px-2.5 text-[13.5px] font-medium text-gray-800 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}><Icon d={I.doc} size={16} />{x.label}</a>
              ) : (
                <span aria-disabled className="flex min-h-[40px] items-center gap-2 rounded-lg px-2.5 text-[13.5px] text-gray-400"><Icon d={I.doc} size={16} />{x.label}<span className="ml-auto text-[11.5px]">{ready === null ? "Checking…" : !decks.length ? "Choose a deck" : "Coming in this release"}</span></span>
              )}
            </li>
          ))}
          {!formats.length && <li className="px-2.5 py-2 text-[13px] text-gray-500">Downloads are not offered here.</li>}
        </ul>
      )}
    </div>
  );
}

export function DeckOptions({ deck, exports }: { deck: { key: string; id: string | null; title: string; total: number; due: number }; exports: ExportFormat[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function study(only?: "due") {
    setBusy(only ?? "all"); setError("");
    const r = await call("/api/individual/scholar/revision/sessions", { ...studyField(), mode: "flashcards", deck: deck.key, ...(only ? { only } : {}) });
    setBusy("");
    if (!r.ok || !r.json.session?.id) { setError(r.json.error ?? "Studying could not start just now."); return; }
    router.push(carry(flashcardsHref({ session: r.json.session.id, deck: deck.key })));
  }
  const row = `flex min-h-[44px] w-full items-center gap-3 rounded-xl px-2 text-left text-[14.5px] text-gray-900 hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
  return (
    <section aria-labelledby="deck-options-h" className="rounded-3xl border border-gray-200 bg-white p-4 md:p-5">
      <h2 id="deck-options-h" className="text-[17px] font-bold text-gray-900">Deck Options</h2>
      <p className="text-[12.5px] text-gray-600">{deck.title}</p>
      <ul className="mt-2 space-y-0.5">
        <li><button type="button" className={row} disabled={!!busy || !deck.total} onClick={() => study()}><Icon d={I.play} /><span><span className="font-semibold">{busy === "all" ? "Starting…" : "Study"}</span> (Active recall)</span></button></li>
        <li><Link href={flashcardsHref({ view: "cards", deck: deck.key })} className={row}><Icon d={I.layers} /><span className="font-semibold">All cards ({deck.total})</span></Link></li>
        <li><button type="button" className={row} disabled={!!busy || !deck.due} onClick={() => study("due")}><Icon d={I.cal} /><span className="flex-1 font-semibold">{busy === "due" ? "Starting…" : "Spaced review"}</span>
          <span className="rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: "var(--cmp-fc-answer-surface)", color: "var(--cmp-fc-answer-label)" }}>{deck.due ? `Active · ${deck.due} due` : "Nothing due"}</span></button></li>
        <li><Link href={deck.id ? flashcardsHref({ view: "decks", edit: deck.id }) : flashcardsHref({ view: "cards", deck: deck.key })} className={row}><Icon d={I.pen} /><span className="font-semibold">Edit deck</span></Link></li>
      </ul>
      <div className="mt-2"><DownloadMenu decks={[deck.key]} formats={exports} /></div>
      {error && <p role="alert" className="mt-2 text-[13px] font-semibold text-red-800">{error}</p>}
    </section>
  );
}

export function CreateMore(props: {
  materials: { id: string; title: string }[]; competencies: { id: string; title: string }[]; decks: { id: string; title: string }[];
  sourceModes: ("notes" | "notes_and_references")[]; perGeneration: number; aiNote: string | null; gaps: number; marksOn: boolean;
  /** OSCE gaps left out because they map to none of the learner's own sections (flashcard-service.ts osceSkippedNote). */
  gapNote?: string | null; preset?: "notes" | "competency" | "topic" | "gaps" | "write" | null;
  /** SCHOLAR-SESSION-AI-02: the open study session's focus, on its existing row (the learner may change it). */
  scope?: ReturnType<typeof flashcardPrefill>;
}) {
  const router = useRouter();
  const sc = props.preset ? null : props.scope ?? null;
  const [open, setOpen] = useState<"" | "notes" | "competency" | "topic" | "gaps" | "write">(props.preset ?? sc?.open ?? "");
  const [materials, setMaterials] = useState<string[]>(sc?.materialIds ?? []);
  const [competency, setCompetency] = useState(sc?.competencyId ?? "");
  const [topic, setTopic] = useState(sc?.topic ?? "");
  const [deckId, setDeckId] = useState("");
  const [source, setSource] = useState<"notes" | "notes_and_references">("notes");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function make(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg("");
    const scope = open === "notes" ? { kind: "documents", materialIds: materials } : open === "competency" ? { kind: "competency", competencyId: competency } : open === "topic" ? { kind: "topic", topic } : { kind: "gaps" };
    const r = await call("/api/individual/scholar/revision/sessions", { ...studyField(), mode: "flashcards", scope, quantity: props.perGeneration, source, ...(deckId ? { deckId } : {}) });
    setBusy(false);
    if (!r.ok || !r.json.session?.id) { setMsg(r.json.error ?? "Cards could not be made just now."); return; }
    const deck = deckId ? `deck:${deckId}` : null;
    router.push(carry(flashcardsHref({ session: r.json.session.id, deck, made: String(r.json.generated ?? 0), lib: String(r.json.library ?? 0), note: r.json.note ?? null })));
  }
  const row = (k: typeof open, icon: React.ReactNode, label: string, disabled = false) => (
    <li><button type="button" disabled={disabled} aria-expanded={open === k} onClick={() => setOpen(o => (o === k ? "" : k))}
      className={`flex min-h-[44px] w-full items-center gap-3 rounded-xl px-2 text-left text-[14.5px] text-gray-900 hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing} ${open === k ? "bg-gray-50" : ""}`}><Icon d={icon} />{label}</button></li>
  );
  return (
    <section aria-labelledby="create-more-h" className="rounded-3xl border border-gray-200 bg-white p-4 md:p-5">
      <h2 id="create-more-h" className="inline-flex items-center gap-2 text-[17px] font-bold text-gray-900"><span style={{ color: indigo }}><Icon d={I.spark} /></span>Create More Flashcards</h2>
      {props.aiNote && <p className="mt-1 text-[12.5px] text-gray-600">{props.aiNote}</p>}
      <ul className="mt-2 space-y-0.5">
        {row("notes", I.doc, "From my notes", !props.materials.length)}
        {row("competency", I.target, "From a competency", !props.competencies.length)}
        {row("topic", I.list, "From a topic")}
        {row("gaps", I.gap, props.gaps ? `From my learning gaps (${props.gaps})` : "From my learning gaps", !props.gaps)}
        {row("write", I.plus, "Write a card myself", !props.marksOn || !props.materials.length)}
      </ul>
      {open && open !== "write" && (
        <form onSubmit={make} className="mt-3 space-y-3 rounded-2xl border border-gray-200 p-3">
          {open === "notes" && (
            <fieldset><legend className="text-[13px] font-semibold text-gray-800">Which notes</legend>
              <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto">{props.materials.map(m => <li key={m.id}><label className="inline-flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={materials.includes(m.id)} onChange={() => setMaterials(x => (x.includes(m.id) ? x.filter(y => y !== m.id) : [...x, m.id]))} />{m.title}</label></li>)}</ul>
            </fieldset>
          )}
          {open === "competency" && (
            <select aria-label="Competency" value={competency} onChange={e => setCompetency(e.target.value)} className={`${field} w-full`}>
              <option value="">Choose a competency</option>{props.competencies.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          )}
          {open === "topic" && <input aria-label="Topic" value={topic} maxLength={120} onChange={e => setTopic(e.target.value)} placeholder="For example: renal system" className={`${field} w-full`} />}
          {open === "gaps" && (
            <div className="space-y-1">
              <p className="text-[13px] text-gray-700">Cards on what you missed: the key points and mistaken ideas from the questions you got wrong, the cards you did not remember and your recent OSCE practice, from your own notes.</p>
              {props.gapNote && <p role="note" className="text-[12.5px] text-gray-600">{props.gapNote}</p>}
            </div>
          )}
          {props.sourceModes.length > 1 && (
            <label className="block text-[13px] font-semibold text-gray-800">New cards from
              <select value={source} onChange={e => setSource(e.target.value as typeof source)} className={`${field} mt-1 block w-full`}>
                <option value="notes">My notes only</option><option value="notes_and_references">My notes and approved references</option>
              </select>
            </label>
          )}
          {props.decks.length > 0 && (
            <label className="block text-[13px] font-semibold text-gray-800">Put them in a deck
              <select value={deckId} onChange={e => setDeckId(e.target.value)} className={`${field} mt-1 block w-full`}>
                <option value="">No deck (they stay under their document and topic)</option>{props.decks.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </label>
          )}
          <p className="text-[12px] text-gray-600">Your saved cards and Competen library cards are used first. At most {props.perGeneration} new ones are written, each checked against your notes.</p>
          <button type="submit" className={primary} style={{ background: indigo }}
            disabled={busy || (open === "notes" && !materials.length) || (open === "competency" && !competency) || (open === "topic" && topic.trim().length < 2)}>{busy ? "Preparing your cards…" : "Make and study cards"}</button>
          {msg && <p role="status" className="text-[13px] text-gray-800">{msg}</p>}
        </form>
      )}
      {open === "write" && <WriteCard materials={props.materials} decks={props.decks} />}
    </section>
  );
}

export function WriteCard({ materials, decks }: { materials: { id: string; title: string }[]; decks: { id: string; title: string }[] }) {
  const router = useRouter();
  const [material, setMaterial] = useState(materials[0]?.id ?? "");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [deckId, setDeckId] = useState("");
  const [msg, setMsg] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = await call("/api/individual/scholar/flashcards", { materialId: material, front, back, ...(deckId ? { deckId } : {}) });
    if (!r.ok) { setMsg(r.json.error ?? "Your card could not be saved."); return; }
    setMsg(r.json.note ?? "Saved. It is due for review today."); setFront(""); setBack(""); router.refresh();
  }
  return (
    <form onSubmit={save} className="mt-3 space-y-2 rounded-2xl border border-gray-200 p-3">
      <p className="text-[12.5px] text-gray-600">Your own card: no AI. It is labelled as yours and never shown as clinically reviewed.</p>
      <label className="block text-[13px] font-semibold text-gray-800">Filed with
        <select value={material} onChange={e => setMaterial(e.target.value)} className={`${field} mt-1 block w-full`}>{materials.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
      </label>
      <label className="block text-[13px] font-semibold text-gray-800">Front (a question, or a term to recall)
        <input value={front} onChange={e => setFront(e.target.value)} maxLength={300} className={`${field} mt-1 block w-full`} placeholder="For example: What does the loop of Henle set up?" />
      </label>
      <label className="block text-[13px] font-semibold text-gray-800">Back (the answer, in a sentence or two)
        <textarea value={back} onChange={e => setBack(e.target.value)} maxLength={600} rows={3} className={`${field} mt-1 block w-full`} />
      </label>
      {decks.length > 0 && (
        <label className="block text-[13px] font-semibold text-gray-800">Add to a deck
          <select value={deckId} onChange={e => setDeckId(e.target.value)} className={`${field} mt-1 block w-full`}><option value="">No deck</option>{decks.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}</select>
        </label>
      )}
      <p className="text-[12px] text-gray-500">Do not include anything that identifies a patient.</p>
      <button type="submit" className={ghost} disabled={!material || front.trim().length < 3 || !back.trim()}>Save card</button>
      {msg && <p role="status" className="text-[13px] text-gray-800">{msg}</p>}
    </form>
  );
}

// ── MY DECKS: create, rename, organise, remove; select several to study or download ──

export type DeckRow = { key: string; id: string | null; kind: string; title: string; subtitle: string | null; total: number; due: number; fresh: number; needsPractice: number; remembered: number; lastStudiedAt: string | null; organiseBy?: PersonalDeck["organiseBy"]; organiseRef?: string | null; updatedAt?: string | null; archived?: boolean };

export function DeckList({ decks, marksOn, archiveOn, exports, editId }: { decks: DeckRow[]; marksOn: boolean; archiveOn: boolean; exports: ExportFormat[]; editId: string | null }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [title, setTitle] = useState("");
  const [organiseBy, setOrganiseBy] = useState("personal");
  const [organiseRef, setOrganiseRef] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<DeckSort>("recent");
  const [showArchived, setShowArchived] = useState(false);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const r = await call("/api/individual/scholar/flashcards/decks", { ...studyField(), title, organiseBy, organiseRef: organiseBy === "personal" ? null : organiseRef });
    setMsg(r.ok ? "Deck made. Add cards to it from All cards, or make new cards into it." : r.json.error ?? "The deck could not be made.");
    if (r.ok) { setTitle(""); setOrganiseRef(""); router.refresh(); }
  }
  async function studyChosen() {
    const all = decks.filter(d => chosen.includes(d.key));
    const r = await call("/api/individual/scholar/revision/sessions", { ...studyField(), mode: "flashcards", decks: all.map(d => d.key) });
    if (r.ok && r.json.session?.id) router.push(carry(flashcardsHref({ session: r.json.session.id, deck: all.length === 1 ? all[0].key : null })));
    else setMsg(r.json.error ?? "Studying could not start just now.");
  }
  async function copy(d: DeckRow) {
    const r = await call(`/api/individual/scholar/flashcards/decks/${d.id}`, undefined, "POST");
    setMsg(r.ok ? `Copied as "${r.json.title}". The cards and their review history are shared with the original.` : r.json.error ?? "The deck could not be copied.");
    if (r.ok) router.refresh();
  }
  async function archive(d: DeckRow, archived: boolean) {
    const r = await call(`/api/individual/scholar/flashcards/decks/${d.id}`, { archived }, "PATCH");
    setMsg(r.ok ? (archived ? `"${d.title}" is archived. Find it again under Show archived.` : `"${d.title}" is back in your list.`) : r.json.error ?? "The deck could not be changed.");
    if (r.ok) router.refresh();
  }
  const personal = decks.filter(d => d.kind === "personal");
  const archivedCount = personal.filter(d => d.archived).length;
  const keep = (ds: DeckRow[]) => sortDecks(searchDecks(ds.filter(d => showArchived || !d.archived), search), sort);
  const bookmarked = decks.find(d => d.kind === "bookmarked") ?? null;
  const groups: [string, DeckRow[]][] = [
    ["All cards", decks.filter(d => d.kind === "all")],
    ...groupByOrganise(keep(personal)).map((g): [string, DeckRow[]] => [`Your decks: ${g.label.toLowerCase()}`, g.decks]),
    ["By document", keep(decks.filter(d => d.kind === "document"))], ["By topic", keep(decks.filter(d => d.kind === "topic"))], ["By competency", keep(decks.filter(d => d.kind === "competency"))],
  ];
  const visible = groups.filter(([, ds]) => ds.length);
  const others = personal.filter(d => !d.archived).map(d => ({ id: d.id!, title: d.title }));
  return (
    <section aria-labelledby="decks-h" className="space-y-4">
      <h2 id="decks-h" className="text-[18px] font-bold text-gray-900">My Decks</h2>
      <div role="search" className="flex flex-wrap items-end gap-2 rounded-2xl border border-gray-200 bg-white p-3">
        <label className="min-w-0 flex-1 text-[12.5px] font-semibold text-gray-700">Search decks
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} className={`${field} mt-1 block w-full`} placeholder="Part of a deck name" />
        </label>
        <label className="text-[12.5px] font-semibold text-gray-700">Sort by
          <select value={sort} onChange={e => setSort(e.target.value as DeckSort)} className={`${field} mt-1 block`}>
            {(Object.keys(DECK_SORT_LABEL) as DeckSort[]).map(k => <option key={k} value={k}>{DECK_SORT_LABEL[k]}</option>)}
          </select>
        </label>
        {archiveOn && (
          <label className="inline-flex min-h-[40px] items-center gap-1.5 text-[13px] font-semibold text-gray-700 pointer-coarse:min-h-[var(--cmp-touch-min)]">
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />Show archived{archivedCount ? ` (${archivedCount})` : ""}
          </label>
        )}
      </div>
      {chosen.length > 0 && (
        <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
          <span className="text-[13.5px] font-semibold text-gray-800">{chosen.length} deck{chosen.length === 1 ? "" : "s"} chosen</span>
          <button type="button" className={primary} style={{ background: indigo }} onClick={studyChosen}>Study them together</button>
          <div className="w-64 max-w-full"><DownloadMenu decks={chosen} formats={exports} label="Download them" /></div>
          <button type="button" className={`text-[13px] underline ${focusRing}`} onClick={() => setChosen([])}>Clear</button>
        </div>
      )}
      {msg && <p role="status" className="text-[13.5px] text-gray-800">{msg}</p>}
      {bookmarked && (
        <section aria-labelledby="bm-h" className="rounded-2xl border border-gray-200 bg-white p-3">
          <h3 id="bm-h" className="inline-flex items-center gap-2 text-[15px] font-bold text-gray-900"><Icon d={I.bookmark} size={17} />Bookmarked</h3>
          <p className="mt-0.5 text-[12.5px] text-gray-600 tabular-nums">{bookmarked.total} card{bookmarked.total === 1 ? "" : "s"} · {bookmarked.due} due · {bookmarked.fresh} new{marksOn ? "" : " · bookmarks are not available here yet"}</p>
          {bookmarked.total === 0 && marksOn && <p className="mt-1 text-[12.5px] text-gray-600">Nothing is bookmarked yet. Bookmark a card while you study or in All cards, and it appears here.</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {bookmarked.total > 0 ? (
              <>
                <Link href={flashcardsHref({ view: "cards", bookmarked: "1" })} className={ghost}>Browse bookmarked cards</Link>
                <Link href={flashcardsHref({ deck: bookmarked.key })} className={ghost}>Review them</Link>
              </>
            ) : null}
          </div>
        </section>
      )}
      {visible.length === 0 && <p className="rounded-2xl border border-dashed border-gray-300 p-4 text-center text-[13.5px] text-gray-600">{search.trim() ? "No deck name matches that search." : "No decks to show."}</p>}
      {visible.map(([label, ds]) => (
        <div key={label}>
          <h3 className="mb-1.5 text-[12.5px] font-bold uppercase tracking-[0.12em] text-gray-500">{label}</h3>
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] gap-2">
            {ds.map(d => (
              <li key={d.key} className={`rounded-2xl border border-gray-200 bg-white p-3 ${d.archived ? "opacity-80" : ""}`}>
                <div className="flex items-start gap-2">
                  <input type="checkbox" aria-label={`Choose ${d.title}`} className="mt-1.5" checked={chosen.includes(d.key)} onChange={() => setChosen(c => (c.includes(d.key) ? c.filter(x => x !== d.key) : [...c, d.key]))} />
                  <div className="min-w-0 flex-1">
                    <Link href={flashcardsHref({ deck: d.key })} className={`text-[14.5px] font-semibold text-gray-900 underline-offset-2 hover:underline ${focusRing}`}>{d.title}</Link>
                    {d.archived && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[11.5px] font-semibold text-gray-700">Archived</span>}
                    {d.subtitle && <p className="text-[12px] text-gray-500">{d.subtitle}</p>}
                    <p className="mt-0.5 text-[12.5px] text-gray-600 tabular-nums">{d.total} cards · {d.due} due · {d.fresh} new · {d.needsPractice} need practice · last revised {when(d.lastStudiedAt).toLowerCase() === "today" ? "today" : when(d.lastStudiedAt)}</p>
                  </div>
                </div>
                {d.id && editId === d.id && <EditDeck deck={d} others={others.filter(o => o.id !== d.id)} />}
                {d.id && editId !== d.id && (
                  <p className="mt-1 flex flex-wrap justify-end gap-x-3 gap-y-1">
                    {marksOn && <button type="button" className={`text-[12.5px] font-semibold underline ${focusRing}`} onClick={() => copy(d)}>Copy</button>}
                    {archiveOn && <button type="button" className={`text-[12.5px] font-semibold underline ${focusRing}`} onClick={() => archive(d, !d.archived)}>{d.archived ? "Unarchive" : "Archive"}</button>}
                    <Link href={flashcardsHref({ view: "decks", edit: d.id })} className={`text-[12.5px] font-semibold underline ${focusRing}`}>Edit deck</Link>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {marksOn ? (
        <form onSubmit={create} className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
          <h3 className="text-[15px] font-bold text-gray-900">Make a deck</h3>
          <div className="flex flex-wrap gap-2">
            <input aria-label="Deck name" value={title} maxLength={120} onChange={e => setTitle(e.target.value)} placeholder="For example: Renal system" className={`${field} min-w-0 flex-1`} />
            <select aria-label="Organise by" value={organiseBy} onChange={e => setOrganiseBy(e.target.value)} className={field}>
              <option value="personal">My own deck</option><option value="module">By module</option><option value="topic">By topic</option><option value="document">By document</option><option value="competency">By competency</option>
            </select>
            {organiseBy !== "personal" && <input aria-label={`Which ${organiseBy}`} value={organiseRef} maxLength={200} onChange={e => setOrganiseRef(e.target.value)} placeholder={organiseBy === "module" ? "For example: NUR201" : `Which ${organiseBy}`} className={`${field} min-w-0 flex-1`} />}
          </div>
          <button type="submit" className={ghost} disabled={!title.trim() || (organiseBy !== "personal" && !organiseRef.trim())}>Make deck</button>
        </form>
      ) : <p className="text-[13px] text-gray-600">Making your own decks is not available here yet. Your cards are already grouped by document, topic and competency above.</p>}
    </section>
  );
}

function EditDeck({ deck, others }: { deck: DeckRow; others: { id: string; title: string }[] }) {
  const router = useRouter();
  const [title, setTitle] = useState(deck.title);
  const [msg, setMsg] = useState("");
  const [into, setInto] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = await call(`/api/individual/scholar/flashcards/decks/${deck.id}`, { title }, "PATCH");
    setMsg(r.ok ? "Saved." : r.json.error ?? "The deck could not be saved."); if (r.ok) router.refresh();
  }
  async function remove() {
    if (!window.confirm(`Remove the deck "${deck.title}"? Its cards and their review history stay.`)) return;
    const r = await call(`/api/individual/scholar/flashcards/decks/${deck.id}`, undefined, "DELETE");
    if (r.ok) router.push(flashcardsHref({ view: "decks" })); else setMsg(r.json.error ?? "The deck could not be removed.");
  }
  async function merge() {
    const target = others.find(o => o.id === into);
    if (!target || !window.confirm(`Merge "${deck.title}" into "${target.title}"? Its cards are added there (any already there are skipped) and this deck is removed. The cards and their review history stay.`)) return;
    const r = await call(`/api/individual/scholar/flashcards/decks/${into}`, { mergeFrom: deck.id }, "PATCH");
    if (r.ok) router.push(flashcardsHref({ view: "decks" })); else setMsg(r.json.error ?? "The decks could not be merged.");
  }
  return (
    <div className="mt-2 space-y-2 border-t border-gray-100 pt-2">
      <form onSubmit={save} className="flex flex-wrap items-center gap-2">
        <input aria-label="Deck name" value={title} maxLength={120} onChange={e => setTitle(e.target.value)} className={`${field} min-w-0 flex-1`} />
        <button type="submit" className={ghost}>Rename</button>
        <button type="button" className={`${ghost} text-red-800`} onClick={remove}>Remove deck</button>
      </form>
      {others.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Merge into deck" value={into} onChange={e => setInto(e.target.value)} className={`${field} min-w-0 flex-1`}>
            <option value="">Merge this deck into…</option>{others.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
          </select>
          <button type="button" className={ghost} disabled={!into} onClick={merge}>Merge</button>
        </div>
      )}
      {msg && <p role="status" className="text-[12.5px] text-gray-700">{msg}</p>}
    </div>
  );
}

// ── ALL CARDS: search, filter, bookmark, edit or remove your own, combine into a deck, move between decks ──

export type CardRow = {
  id: string; front: string; origin: "notes" | "library" | "learner"; originLabel: string; materialTitle: string; topic: string | null; competency: string | null;
  difficulty: number | null; state: string; stateLabel: string; nextReviewAt: string | null; lastReviewedAt: string | null; reviews: number; intervalDays: number | null; ease: number | null;
  recent: ("again" | "remembered")[]; bookmarked: boolean; note: string | null; issue: string | null; editable: boolean; deckIds: string[]; createdAt: string; version: string;
};

export function CardBrowser({ cards, decks, currentDeck, marksOn, filters }: {
  cards: CardRow[]; decks: { id: string; title: string }[]; currentDeck: { key: string; id: string | null; title: string } | null; marksOn: boolean;
  filters: { q: string; state: string; bookmarked: boolean; origin: string };
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [newDeck, setNewDeck] = useState("");
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const allChosen = chosen.length === cards.length && cards.length > 0;
  const toggle = (id: string) => setChosen(c => (c.includes(id) ? c.filter(x => x !== id) : [...c, id]));
  const base = useMemo(() => ({ view: "cards", deck: currentDeck?.key ?? null }), [currentDeck]);

  async function addTo() {
    const r = target === "__new"
      ? await call("/api/individual/scholar/flashcards/decks", { ...studyField(), title: newDeck, cardIds: chosen })
      : await call(`/api/individual/scholar/flashcards/decks/${target}`, { add: chosen }, "PATCH");
    setMsg(r.ok ? `Added ${chosen.length} card${chosen.length === 1 ? "" : "s"}. Their review history goes with them.` : r.json.error ?? "That could not be done.");
    if (r.ok) { setChosen([]); setNewDeck(""); router.refresh(); }
  }
  async function moveOut(to: string | null) {
    if (!currentDeck?.id) return;
    const r = await call(`/api/individual/scholar/flashcards/decks/${currentDeck.id}`, { remove: chosen, ...(to ? { moveTo: to } : {}) }, "PATCH");
    setMsg(r.ok ? (to ? "Moved. Their review history is unchanged." : "Taken out of this deck. The cards and their history stay.") : r.json.error ?? "That could not be done.");
    if (r.ok) { setChosen([]); router.refresh(); }
  }
  async function bookmark(c: CardRow) {
    const r = await call(`/api/individual/scholar/flashcards/${c.id}`, { bookmarked: !c.bookmarked }, "PATCH");
    if (r.ok) router.refresh(); else setMsg(r.json.error ?? "That could not be saved.");
  }
  async function remove(c: CardRow) {
    if (!window.confirm("Remove this card you wrote? Its review history goes with it.")) return;
    const r = await call(`/api/individual/scholar/flashcards/${c.id}`, undefined, "DELETE");
    if (r.ok) router.refresh(); else setMsg(r.json.error ?? "The card could not be removed.");
  }
  async function studyChosen() {
    const r = await call("/api/individual/scholar/revision/sessions", { ...studyField(), mode: "flashcards", cardIds: chosen });
    if (r.ok && r.json.session?.id) router.push(carry(flashcardsHref({ session: r.json.session.id }))); else setMsg(r.json.error ?? "Studying could not start just now.");
  }

  return (
    <section aria-labelledby="cards-h" className="space-y-3">
      <h2 id="cards-h" className="text-[18px] font-bold text-gray-900">{currentDeck ? `Cards in ${currentDeck.title}` : "All cards"}</h2>
      <form ref={formRef} role="search" className="flex flex-wrap items-end gap-2 rounded-2xl border border-gray-200 bg-white p-3"
        onSubmit={e => { e.preventDefault(); const f = new FormData(formRef.current!); router.push(flashcardsHref({ ...base, q: String(f.get("q") ?? "") || null, state: String(f.get("state") ?? "") || null, origin: String(f.get("origin") ?? "") || null, bookmarked: f.get("bookmarked") ? "1" : null })); }}>
        <label className="min-w-0 flex-1 text-[12.5px] font-semibold text-gray-700">Search cards<input name="q" defaultValue={filters.q} className={`${field} mt-1 block w-full`} placeholder="Words on the card, a topic, a document" /></label>
        <label className="text-[12.5px] font-semibold text-gray-700">Status
          <select name="state" defaultValue={filters.state} className={`${field} mt-1 block`}><option value="">Any</option><option value="due">Due today</option><option value="needs_practice">Needs more practice</option><option value="remembered">Remembered</option><option value="new">Not studied yet</option></select>
        </label>
        <label className="text-[12.5px] font-semibold text-gray-700">From
          <select name="origin" defaultValue={filters.origin} className={`${field} mt-1 block`}><option value="">Anywhere</option><option value="notes">My notes</option><option value="library">Competen library</option><option value="learner">Written by me</option></select>
        </label>
        <label className="inline-flex min-h-[40px] items-center gap-1.5 text-[13px] font-semibold text-gray-700"><input type="checkbox" name="bookmarked" defaultChecked={filters.bookmarked} />Bookmarked</label>
        <button type="submit" className={ghost}>Filter</button>
      </form>

      {chosen.length > 0 && (
        <div className="sticky top-16 z-10 space-y-2 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
          <p className="text-[13.5px] font-semibold text-gray-800">{chosen.length} card{chosen.length === 1 ? "" : "s"} chosen</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={primary} style={{ background: indigo }} onClick={studyChosen}>Study them</button>
            {marksOn && (
              <>
                <select aria-label="Add to deck" value={target} onChange={e => setTarget(e.target.value)} className={field}>
                  <option value="">Add to a deck…</option>{decks.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}<option value="__new">A new deck…</option>
                </select>
                {target === "__new" && <input aria-label="New deck name" value={newDeck} maxLength={120} onChange={e => setNewDeck(e.target.value)} placeholder="Deck name" className={field} />}
                <button type="button" className={ghost} disabled={!target || (target === "__new" && !newDeck.trim())} onClick={addTo}>{target === "__new" ? "Combine into a deck" : "Add"}</button>
                {currentDeck?.id && (
                  <>
                    <select aria-label="Move to deck" defaultValue="" onChange={e => { if (e.target.value) void moveOut(e.target.value); }} className={field}>
                      <option value="">Move to…</option>{decks.filter(d => d.id !== currentDeck.id).map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
                    </select>
                    <button type="button" className={ghost} onClick={() => moveOut(null)}>Take out of this deck</button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {msg && <p role="status" className="text-[13.5px] text-gray-800">{msg}</p>}

      {cards.length === 0 ? <p className="rounded-2xl border border-dashed border-gray-300 p-6 text-center text-[14px] text-gray-600">No cards match. Make some from your notes, or write one yourself.</p> : (
        <>
          <label className="inline-flex items-center gap-2 text-[13px] font-semibold text-gray-700"><input type="checkbox" checked={allChosen} onChange={() => setChosen(allChosen ? [] : cards.map(c => c.id))} />Choose all {cards.length}</label>
          <ul className="space-y-2">
            {cards.map(c => (
              <li key={c.id} className="rounded-2xl border border-gray-200 bg-white p-3">
                <div className="flex items-start gap-2">
                  <input type="checkbox" aria-label="Choose this card" className="mt-1.5" checked={chosen.includes(c.id)} onChange={() => toggle(c.id)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14.5px] font-semibold text-gray-900">{c.front}</p>
                    <p className="mt-0.5 text-[12px] text-gray-600">{c.originLabel} · {c.materialTitle}{c.topic ? ` · ${c.topic}` : ""}{c.competency ? ` · ${c.competency}` : ""}</p>
                    <p className="mt-1 text-[12.5px] text-gray-700 tabular-nums">
                      <span className="font-semibold">{c.stateLabel}</span> · next review {when(c.nextReviewAt)} · last revised {when(c.lastReviewedAt)} · {c.reviews} review{c.reviews === 1 ? "" : "s"}
                      {c.intervalDays !== null && c.reviews > 0 ? ` · every ${c.intervalDays} day${c.intervalDays === 1 ? "" : "s"}, ease ${c.ease?.toFixed(2)}` : ""}
                    </p>
                    {c.recent.length > 0 && <p className="mt-0.5 text-[12px] text-gray-600">Recent: {c.recent.map(r => (r === "remembered" ? "✓" : "✕")).join(" ")}<span className="sr-only"> ({c.recent.map(r => (r === "remembered" ? "remembered" : "not remembered")).join(", ")})</span></p>}
                    {c.note && <p className="mt-1 rounded-lg bg-gray-50 px-2 py-1 text-[12.5px] text-gray-700">Your note: {c.note}</p>}
                    {c.issue && <p className="mt-1 text-[12px] font-semibold text-amber-800">You reported: {ISSUE_CODES.find(x => x.value === c.issue)?.label ?? c.issue}</p>}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                  {marksOn && <button type="button" className={`${ghost} min-h-[34px] px-2.5 text-[12.5px]`} aria-pressed={c.bookmarked} onClick={() => bookmark(c)}><Icon d={I.bookmark} size={15} />{c.bookmarked ? "Bookmarked" : "Bookmark"}</button>}
                  {c.editable && <button type="button" className={`${ghost} min-h-[34px] px-2.5 text-[12.5px]`} onClick={() => setEditing(e => (e === c.id ? null : c.id))}><Icon d={I.pen} size={15} />Edit</button>}
                  {c.editable && <button type="button" className={`${ghost} min-h-[34px] px-2.5 text-[12.5px] text-red-800`} onClick={() => remove(c)}>Remove</button>}
                </div>
                {editing === c.id && <EditCardLoader id={c.id} front={c.front} />}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** A card the learner wrote is edited with its back, which is read from the selection route (their own card only). */
function EditCardLoader({ id, front }: { id: string; front: string }) {
  const router = useRouter();
  const [back, setBack] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    call(`/api/individual/scholar/flashcards?card=${id}`, undefined, "GET").then(r => { if (live) setBack(r.ok ? String(r.json.cards?.[0]?.back ?? "") : ""); });
    return () => { live = false; };
  }, [id]);
  if (back === null) return <p className="mt-2 text-[13px] text-gray-600">Loading the card…</p>;
  return <EditCard id={id} front={front} back={back} onSaved={() => router.refresh()} />;
}

// ── STUDY START: the selected deck, before a session ──

export function DeckStart({ deck, perState }: { deck: { key: string; title: string; total: number }; perState: { due: number; fresh: number; needsPractice: number; remembered: number } }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function study(only?: "due" | "practice") {
    setBusy(only ?? "all"); setError("");
    const r = await call("/api/individual/scholar/revision/sessions", { ...studyField(), mode: "flashcards", deck: deck.key, ...(only ? { only } : {}) });
    setBusy("");
    if (!r.ok || !r.json.session?.id) { setError(r.json.error ?? "Studying could not start just now."); return; }
    router.push(carry(flashcardsHref({ session: r.json.session.id, deck: deck.key })));
  }
  const stat = (label: string, n: number, tone?: string) => (
    <div className="rounded-2xl border border-gray-200 bg-white p-3"><p className="text-[12px] font-semibold text-gray-500">{label}</p><p className="text-[22px] font-bold tabular-nums" style={tone ? { color: tone } : undefined}>{n}</p></div>
  );
  return (
    <div className="mt-5 space-y-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-2">
        {stat("Due today", perState.due, "var(--cmp-role-revision-strong)")}{stat("Not studied yet", perState.fresh)}{stat("Needs more practice", perState.needsPractice, "var(--cmp-fc-revise-ink)")}{stat("Remembered", perState.remembered, "var(--cmp-fc-answer-label)")}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} style={{ background: indigo }} disabled={!!busy || !deck.total} onClick={() => study()}><Icon d={I.play} />{busy === "all" ? "Starting…" : `Study ${deck.title}`}</button>
        <button type="button" className={ghost} disabled={!!busy || !(perState.due + perState.fresh)} onClick={() => study("due")}>{busy === "due" ? "Starting…" : "Spaced review: due and new"}</button>
        <button type="button" className={ghost} disabled={!!busy || !perState.needsPractice} onClick={() => study("practice")}>{busy === "practice" ? "Starting…" : "Practise what I missed"}</button>
      </div>
      {error && <p role="alert" className="text-[13.5px] font-semibold text-red-800">{error}</p>}
    </div>
  );
}

export function HowItWorks() {
  const steps = [
    { icon: I.doc, title: "Generate or select flashcards", text: "From your notes, the library or your learning gaps" },
    { icon: I.layers, title: "Study & rate recall", text: "Flip, answer and mark “Remembered” or “Review again”" },
    { icon: I.cal, title: "Revise smarter", text: "Cards are scheduled using spaced repetition to strengthen memory" },
  ];
  return (
    <section aria-labelledby="how-h" className="rounded-3xl border border-gray-200 bg-white p-4 md:p-6">
      <h2 id="how-h" className="inline-flex items-center gap-2 text-[17px] font-bold text-gray-900"><span style={{ color: indigo }}><Icon d={<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>} /></span>How it works</h2>
      <ol className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-4">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span aria-hidden className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--cmp-role-indigo-soft)] text-[var(--cmp-role-indigo-ink)]"><Icon d={s.icon} /></span>
            <span><span className="block text-[15px] font-bold text-gray-900"><span className="mr-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--cmp-role-indigo-ink)] text-[12px] text-[var(--cmp-role-indigo-ink)]">{i + 1}</span>{s.title}</span>
              <span className="mt-0.5 block text-[13.5px] text-gray-600">{s.text}</span></span>
          </li>
        ))}
      </ol>
    </section>
  );
}
