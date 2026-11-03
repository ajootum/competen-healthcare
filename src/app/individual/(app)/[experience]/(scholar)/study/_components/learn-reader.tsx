"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { lessonAnchorId } from "@/lib/individual/scholar/learn-place";
import { LINK_NOT_COMPETENCE, PROPOSED_NOT_LINK, READ_MARK, RELATED_NONE, readerOpenByDefault, relatedAlternatives, relatedWords, type ReaderCompetency, type ReaderSection } from "@/lib/individual/scholar/learn-reader";
import type { LessonRelated } from "@/lib/individual/scholar/store";
import { experienceHref } from "@/lib/individual/experiences";
import { sourceHref, studyHref } from "./question-view";
import { SourcePictureButton } from "./learn-visuals";
import { ReplayCase } from "./case-client";
import { lessonFlashcardsHref, req } from "./learn-practice";
import { AskAbout } from "./ask-panel";
import { carry } from "./study-active";

// SCHOLAR-INDEPENDENT-LEARNING-01 P0: YOUR NOTES, INSIDE THE LESSON. The lesson's own sections as the learner uploaded them
// (GET learn/sessions/[id]/read?step=: a read of their own chunks, no AI, no allowance), each cited, each an anchor the 790
// position saves (`lesson-<step>:s<ordinal>`), so the exact place in the ORIGINAL text is found again on any device. Under
// them: the competencies linked to these sections (a link is never practice or competence), what already exists to practise
// with (opened directly, never regenerated), and the learner's own "Mark as read". AI teaching, where it is on, follows
// below this panel: the notes come first, AI second. Highlights and notes on this text use the lesson's LibraryNotes (820).
// P1 (connected activities): every link carries the open study session (study-active carry); Revise opens narrowed to the
// lesson's own sections (?sections=); "Ask about this" on a section is the CE-01 in-place panel (an AI enhancement that says
// why when it is not available, and never blocks reading).

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const touch = "pointer-coarse:min-h-[var(--cmp-touch-min)]";
const chip = `inline-flex min-h-[36px] items-center rounded-full border border-gray-300 bg-white px-3 py-1 text-[12.5px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${touch} ${focusRing}`;

export type ReaderReply = { step: number; sections: ReaderSection[]; missing: number; competencies: ReaderCompetency[]; related: LessonRelated };
const cache = new Map<string, Promise<ReaderReply | null>>();
/** One read per session and lesson per visit (the notes do not change while the learner reads them). */
export function loadReader(sessionId: string, step: number): Promise<ReaderReply | null> {
  const k = `${sessionId}:${step}`;
  let p = cache.get(k);
  if (!p) {
    p = req(`/api/individual/scholar/learn/sessions/${encodeURIComponent(sessionId)}/read?step=${step}`).then(r => (r.ok && Array.isArray(r.json.sections) ? (r.json as ReaderReply) : null));
    cache.set(k, p);
    void p.then(v => { if (!v) cache.delete(k); });
  }
  return p;
}

export function LessonReader({ sessionId, step, index, current, hasLesson, aiAvailable, marked, markedNote, accent, onLoaded, onMarkRead, ownCards }: {
  sessionId: string; step: number; index: number;
  /** The active lesson: its notes are read at once (a saved place inside them must be findable), others only when opened. */
  current: boolean;
  /** AI teaching is on the page for this lesson: the notes then start collapsed (one click away). */
  hasLesson: boolean;
  /** New AI teaching is available now: when not, the notes open by themselves and nothing is offered that would need AI. */
  aiAvailable: boolean;
  /** The learner's own read mark is recorded for this lesson (server records or this visit). */
  marked: boolean;
  /** What the last mark answered: recorded on the server, or kept on this device only (migration 920 absent). */
  markedNote: string | null;
  accent: string;
  /** The notes are on the page: the saved place inside them can be found now. */
  onLoaded: (step: number) => void;
  onMarkRead: (step: number) => Promise<void>;
  ownCards: boolean;
}) {
  // `reply` is keyed by what it was read for (session, lesson, try), so a stale answer is never shown and no state is reset in the effect.
  const [reply, setReply] = useState<{ key: string; value: ReaderReply | "failed" } | null>(null);
  const [open, setOpen] = useState<boolean | null>(null);
  const [marking, setMarking] = useState(false);
  const [tries, setTries] = useState(0);
  const key = `${sessionId}:${step}:${tries}`;
  const isOpen = open ?? readerOpenByDefault({ hasLesson, aiAvailable });
  // CE-07: one read per lesson, and only for the active lesson or one the learner opened -- never every lesson of a long session at once.
  const wanted = isOpen || current;
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void loadReader(sessionId, step).then(r => { if (!live) return; setReply({ key, value: r ?? "failed" }); if (r) onLoaded(step); });
    return () => { live = false; };
  }, [sessionId, step, key, wanted, onLoaded]);
  const loaded = reply?.key === key ? reply.value : null;
  const n = loaded && loaded !== "failed" ? loaded.sections.length : null;
  const first = loaded && loaded !== "failed" ? loaded.sections[0] : null;
  const words = loaded && loaded !== "failed" ? relatedWords({ cards: loaded.related.cards, questions: loaded.related.questions, attempts: loaded.related.attempts, cases: loaded.related.cases.length, stations: loaded.related.stations.length, savedLessons: loaded.related.savedLessons }) : null;
  return (
    <details open={isOpen} onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)} className="group mt-3 rounded-xl border border-gray-200 bg-white">
      <summary className={`flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 text-[13.5px] font-semibold text-gray-900 ${touch} [&::-webkit-details-marker]:hidden ${focusRing}`}>
        <span aria-hidden="true" className="text-[10px] text-gray-500 transition-transform group-open:rotate-90">▶</span>
        Your notes{n !== null ? ` · ${n} ${n === 1 ? "section" : "sections"}` : ""}
        {marked && <span className="ml-auto inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-900">{READ_MARK.done}</span>}
      </summary>
      <div className="border-t border-gray-200 px-3 py-3 sm:px-4">
        {loaded === null && <p role="status" className="text-[13.5px] text-gray-700">Opening your notes…</p>}
        {loaded === "failed" && (
          <p role="status" className="text-[13.5px] text-gray-800">Your notes could not be read just now. They are unchanged.{" "}
            <button type="button" onClick={() => setTries(t => t + 1)} className={`font-semibold underline ${touch} ${focusRing}`}>Try again</button></p>
        )}
        {loaded && loaded !== "failed" && (
          <>
            {loaded.sections.length === 0 && <p className="text-[13.5px] text-gray-800">This lesson&apos;s sections are no longer in your materials.</p>}
            <ol className="space-y-5">
              {loaded.sections.map(s => (
                <li key={s.chunkId} id={lessonAnchorId(step, s.anchor)} className="scroll-mt-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h4 className="min-w-0 break-words text-[15px] font-bold text-gray-900">{s.heading ?? s.citation}</h4>
                    <span className="text-[12px] text-gray-600">{s.citation}</span>
                  </div>
                  {s.aiReadNote && <p className="mt-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[12px] text-amber-950">{s.aiReadNote}</p>}
                  {s.body ? <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-gray-900">{s.body}</p>
                    : !s.notes && <p className="mt-1.5 text-[13px] italic text-gray-600">This {s.unit} holds no text (a picture, a title or a divider). Open the original to see it.</p>}
                  {s.notes && (
                    <details className="group/n mt-2 rounded-lg border border-gray-200 bg-gray-50">
                      <summary className={`flex min-h-[36px] cursor-pointer list-none items-center gap-2 px-2.5 text-[12.5px] font-semibold text-gray-800 ${touch} [&::-webkit-details-marker]:hidden ${focusRing}`}>
                        <span aria-hidden="true" className="text-[10px] text-gray-500 transition-transform group-open/n:rotate-90">▶</span>Speaker notes
                      </summary>
                      <p className="whitespace-pre-wrap break-words border-t border-gray-200 px-2.5 py-2 text-[13.5px] leading-relaxed text-gray-800">{s.notes}</p>
                    </details>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                    <Link href={carry(sourceHref(s.materialId, s.chunkId))} className={`font-semibold underline underline-offset-2 ${focusRing}`}>Open in the material</Link>
                    {s.unit !== "section" && <SourcePictureButton materialId={s.materialId} materialTitle={s.materialTitle} citation={s.citation} />}
                    <AskAbout surface="learn" chunkIds={[s.chunkId]} materialId={s.materialId} sessionId={sessionId} step={step} refLabel={`Your notes: ${s.citation}`} label="Ask about this" />
                  </div>
                </li>
              ))}
            </ol>
            {loaded.missing > 0 && <p className="mt-3 text-[12.5px] text-gray-600">{loaded.missing === 1 ? "One section" : `${loaded.missing} sections`} of this lesson could not be read: the material may have been changed or removed.</p>}

            {/* Competencies linked to these sections: accepted links first, AI suggestions apart. Never practice, never competence. */}
            {loaded.competencies.length > 0 && (
              <div className="mt-4 border-t border-gray-100 pt-3">
                <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">Competencies these notes are about</p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {loaded.competencies.map(c => (
                    <li key={c.id} className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-[12.5px] ${c.accepted ? "border-gray-800 bg-gray-900 text-white" : "border-dashed border-gray-400 bg-white text-gray-700"}`} title={c.accepted ? LINK_NOT_COMPETENCE : PROPOSED_NOT_LINK}>
                      {c.code && <span className="font-mono text-[11px] opacity-80">{c.code}</span>}<span className="min-w-0 break-words">{c.title}</span>
                      {!c.accepted && <span className="text-[11px] italic">suggested</span>}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[12px] text-gray-600">{LINK_NOT_COMPETENCE}{loaded.competencies.some(c => !c.accepted) ? ` ${PROPOSED_NOT_LINK}` : ""}{" "}
                  <Link href={experienceHref("scholar", "my-competencies")} className={`underline ${focusRing}`}>My competencies</Link></p>
              </div>
            )}

            {/* P1: what already exists for these sections, opened directly. Nothing here generates anything. */}
            <div className="mt-4 border-t border-gray-100 pt-3">
              <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">Practise with what you already have</p>
              {words ? (
                <>
                  <p className="mt-1 text-[13.5px] text-gray-900">{words}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {loaded.related.cards > 0 && first && <Link href={carry(lessonFlashcardsHref(first.materialId, first.chunkId))} className={chip}>Review these flashcards</Link>}
                    {loaded.related.questions > 0 && first && <Link href={carry(`${studyHref("revise")}?material=${encodeURIComponent(first.materialId)}&sections=${encodeURIComponent(loaded.sections.map(x => x.chunkId).join(","))}`)} className={chip}>Answer these questions</Link>}
                    {loaded.related.stations.map(st => <Link key={st.id} href={carry(studyHref(`apply/osce/${encodeURIComponent(st.id)}`))} className={chip}>OSCE: {st.title}</Link>)}
                  </div>
                  {loaded.related.cases.length > 0 && (
                    <ul className="mt-2 space-y-1 text-[13.5px]">
                      {loaded.related.cases.map(c => <li key={c.id}>Replay your case: <ReplayCase caseId={c.id} title={c.title} /></li>)}
                    </ul>
                  )}
                </>
              ) : (
                <p className="mt-1 text-[13.5px] text-gray-800">{RELATED_NONE} {ownCards ? relatedAlternatives(aiAvailable) : aiAvailable ? "Ask Scholar to write questions from this lesson." : "Scholar can write questions from this lesson when AI help is available."}</p>
              )}
            </div>

            {/* The learner's own mark. A learning record, never assessment evidence. */}
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-100 pt-3">
              <button type="button" disabled={marked || marking} onClick={async () => { setMarking(true); try { await onMarkRead(step); } finally { setMarking(false); } }}
                className={`inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-60 ${touch} ${focusRing}`} style={{ background: accent }}
                aria-describedby={`reader-mark-why-${step}`}>
                {marked ? `${READ_MARK.done} ✓` : marking ? "Marking…" : `${READ_MARK.label}: lesson ${index + 1}`}
              </button>
              <span id={`reader-mark-why-${step}`} className="text-[12px] text-gray-600">{markedNote ?? READ_MARK.note}</span>
            </div>
          </>
        )}
      </div>
    </details>
  );
}
