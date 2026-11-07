"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { lessonAnchorId } from "@/lib/individual/scholar/learn-place";
import { LINK_NOT_COMPETENCE, PROPOSED_NOT_LINK, READ_MARK, RELATED_NONE, readerOpenByDefault, relatedAlternatives, relatedWords, type ReaderCompetency, type ReaderSection } from "@/lib/individual/scholar/learn-reader";
import type { LessonRelated } from "@/lib/individual/scholar/store";
import { experienceHref } from "@/lib/individual/experiences";
import { sourceHref, studyHref } from "./question-view";
import { SectionPictures, SourcePictureButton } from "./learn-visuals";
import { ReplayCase } from "./case-client";
import { lessonFlashcardsHref, req } from "./learn-practice";
import { AskAbout } from "./ask-panel";
import { carry } from "./study-active";
import { ActionRow, InlineNote, LearningDisclosure, LearningIcon, NotesText, RefChip, SectionCard, learnAction } from "@/components/ui/scholar-learning";
import { shortRef } from "@/lib/individual/scholar/notes-layout";
import { MyIdeasBox } from "./my-ideas-box";

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

export function LessonReader({ sessionId, step, index, current, hasLesson, aiAvailable, marked, markedNote, onLoaded, onMarkRead, ownCards, hidePictures, wordPictures }: {
  /** While the learner recalls the lesson, a picture must not give the answer away. */
  hidePictures?: boolean; wordPictures?: boolean;
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
    // SCHOLAR LEARNING DESIGN SYSTEM: the learner's own notes, a shared LearningDisclosure in the notes (cream) tone; no AI.
    // COMPETEN-NOTEBOOK-001: writing in a box here keeps the panel open, even when saved teaching arrives and would otherwise fold it away.
    <div onFocusCapture={e => { if (e.target instanceof HTMLTextAreaElement) setOpen(o => o ?? true); }}>
    <LearningDisclosure tone="notes" icon="notes" title={`Your notes${n !== null ? ` · ${n} ${n === 1 ? "section" : "sections"}` : ""}`} open={isOpen} onToggle={setOpen} className="mt-3"
      meta={marked ? <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-900">{READ_MARK.done}</span> : null}>

        {loaded === null && <p role="status" className="text-[13.5px] text-gray-700">Opening your notes…</p>}
        {loaded === "failed" && (
          <p role="status" className="text-[13.5px] text-gray-800">Your notes could not be read just now. They are unchanged.{" "}
            <button type="button" onClick={() => setTries(t => t + 1)} className={`font-semibold underline ${touch} ${focusRing}`}>Try again</button></p>
        )}
        {loaded && loaded !== "failed" && (
          <>
            {loaded.sections.length === 0 && <InlineNote>This lesson&apos;s sections are no longer in your materials.</InlineNote>}
            {/* LEARN SECTIONS HFE: each section of the notes is its own light card -- its heading, the slide or page as a chip that
                opens it in the material, the text laid out for reading (notes-layout.ts: never a word changed), and ONE action row
                with Ask about this first. A slide with no text is a calm note with its picture. */}
            <ol className="space-y-3">
              {loaded.sections.map((s, i, all) => {
                const ref = shortRef(s.unit, s.pageFrom, s.pageTo);
                // SCHOLAR-VISUAL-001: a long slide has several sections; its pictures come once, with the first of them.
                const sameSlide = (o: typeof s | undefined) => !!o && o.materialId === s.materialId && s.pageFrom !== null && o.pageFrom === s.pageFrom;
                const href = carry(sourceHref(s.materialId, s.chunkId));
                // A Word section has no page: its pictures are filed under its ordinal. Policy off: not even asked for.
                const picture = s.unit !== "section" || !!wordPictures;
                return (
                  <SectionCard as="li" key={s.chunkId} id={lessonAnchorId(step, s.anchor)} className="scroll-mt-4">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                      <h4 className={`min-w-0 flex-1 basis-[14rem] break-words leading-snug ${s.heading ? "text-[16px] font-bold text-gray-900" : "text-[14px] font-semibold text-gray-700"}`}>{s.heading ?? ref ?? s.citation}</h4>
                      <RefChip href={href} text={s.heading ? ref ?? "Open" : "Open"} citation={s.citation} />
                    </div>
                    {s.aiReadNote && <InlineNote kind="ai" className="mt-2">{s.aiReadNote}</InlineNote>}
                    {s.body ? <NotesText text={s.body} className="mt-2" />
                      : !s.notes && (
                        <InlineNote className="mt-2">
                          This {s.unit} holds no text (a picture, a title or a divider).
                          {s.unit === "page" && <div className="mt-1.5 flex flex-wrap items-center gap-2"><SourcePictureButton materialId={s.materialId} materialTitle={s.materialTitle} citation={s.citation} className={learnAction.secondary} /></div>}
                        </InlineNote>
                      )}
                    {s.notes && (
                      <details className="group/n mt-3">
                        <summary className={`inline-flex min-h-[40px] cursor-pointer list-none items-center gap-1.5 rounded text-[13.5px] font-semibold text-gray-800 ${touch} [&::-webkit-details-marker]:hidden ${focusRing}`}>
                          <span aria-hidden="true" className="cmp-learn-accent text-[10px] motion-safe:transition-transform group-open/n:rotate-90">▶</span>Speaker notes
                        </summary>
                        <div className="mt-1 border-l-2 border-[var(--learn-border)] pl-3"><NotesText text={s.notes} className="text-gray-800" /></div>
                      </details>
                    )}
                    {picture && !hidePictures && <SectionPictures materialId={s.materialId} materialTitle={s.materialTitle} from={s.pageFrom ?? s.ordinal} to={s.pageTo ?? s.ordinal} first={!sameSlide(all[i - 1])} last={!sameSlide(all[i + 1])} leading={s.ordinal === 1} />}
                    <ActionRow label={`For ${s.citation}`}>
                      <AskAbout surface="learn" chunkIds={[s.chunkId]} materialId={s.materialId} sessionId={sessionId} step={step} refLabel={`Your notes: ${s.citation}`} label="Ask about this" variant="primary" />
                      {s.unit === "page" && (s.body || s.notes) && <SourcePictureButton materialId={s.materialId} materialTitle={s.materialTitle} citation={s.citation} className={learnAction.secondary} />}
                    </ActionRow>
                    <MyIdeasBox chunkId={s.chunkId} materialId={s.materialId} sectionLabel={s.heading ?? s.citation} anchor={s.anchor} className="mt-3" />
                  </SectionCard>
                );
              })}
            </ol>
            {loaded.missing > 0 && <InlineNote className="mt-3">{loaded.missing === 1 ? "One section" : `${loaded.missing} sections`} of this lesson could not be read: the material may have been changed or removed.</InlineNote>}

            {/* Competencies linked to these sections: accepted links first, AI suggestions apart. Never practice, never competence. */}
            {loaded.competencies.length > 0 && (
              <section aria-labelledby={`reader-comp-${step}`} className="mt-5">
                <h4 id={`reader-comp-${step}`} className="cmp-learn-ink flex items-center gap-2 text-[12.5px] font-bold uppercase tracking-[0.08em]"><LearningIcon name="target" className="cmp-learn-accent h-4 w-4" />Competencies these notes are about</h4>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {loaded.competencies.map(c => (
                    <li key={c.id} className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] ${c.accepted ? "cmp-learn-ink border border-[var(--learn-accent)] bg-[var(--learn-surface)]" : "border border-dashed border-gray-400 bg-[var(--cmp-app-surface)] text-gray-700"}`} title={c.accepted ? LINK_NOT_COMPETENCE : PROPOSED_NOT_LINK}>
                      {c.accepted && <LearningIcon name="check" className="h-3.5 w-3.5" />}
                      {c.code && <span className="font-mono text-[11.5px]">{c.code}</span>}<span className="min-w-0 break-words">{c.title}</span>
                      {!c.accepted && <span className="text-[11.5px] italic">suggested</span>}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[12.5px] text-gray-700">{LINK_NOT_COMPETENCE}{loaded.competencies.some(c => !c.accepted) ? ` ${PROPOSED_NOT_LINK}` : ""}{" "}
                  <Link href={experienceHref("scholar", "my-competencies")} className={`font-semibold underline ${focusRing}`}>My competencies</Link></p>
              </section>
            )}

            {/* P1: what already exists for these sections, opened directly. Nothing here generates anything. */}
            <section aria-labelledby={`reader-have-${step}`} className="mt-5">
              <h4 id={`reader-have-${step}`} className="cmp-learn-ink flex items-center gap-2 text-[12.5px] font-bold uppercase tracking-[0.08em]"><LearningIcon name="cards" className="cmp-learn-accent h-4 w-4" />Practise with what you already have</h4>
              {words ? (
                <>
                  <p className="mt-1.5 text-[14px] text-gray-900">{words}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {loaded.related.cards > 0 && first && <Link href={carry(lessonFlashcardsHref(first.materialId, first.chunkId))} className={learnAction.secondary}>Review these flashcards</Link>}
                    {loaded.related.questions > 0 && first && <Link href={carry(`${studyHref("revise")}?material=${encodeURIComponent(first.materialId)}&sections=${encodeURIComponent(loaded.sections.map(x => x.chunkId).join(","))}`)} className={learnAction.secondary}>Answer these questions</Link>}
                    {loaded.related.stations.map(st => <Link key={st.id} href={carry(studyHref(`apply/osce/${encodeURIComponent(st.id)}`))} className={learnAction.secondary}>OSCE: {st.title}</Link>)}
                  </div>
                  {loaded.related.cases.length > 0 && (
                    <ul className="mt-2 space-y-1 text-[14px]">
                      {loaded.related.cases.map(c => <li key={c.id}>Replay your case: <ReplayCase caseId={c.id} title={c.title} /></li>)}
                    </ul>
                  )}
                </>
              ) : (
                <p className="mt-1.5 text-[14px] text-gray-800">{RELATED_NONE} {ownCards ? relatedAlternatives(aiAvailable) : aiAvailable ? "Ask Scholar to write questions from this lesson." : "Scholar can write questions from this lesson when AI help is available."}</p>
              )}
            </section>

            {/* The learner's own mark. A learning record, never assessment evidence. */}
            <ActionRow label="Your read mark" className="mt-5">
              <button type="button" disabled={marked || marking} onClick={async () => { setMarking(true); try { await onMarkRead(step); } finally { setMarking(false); } }}
                className={`${learnAction.primary} min-h-[44px]`} aria-describedby={`reader-mark-why-${step}`}>
                {marked ? `${READ_MARK.done} ✓` : marking ? "Marking…" : `${READ_MARK.label}: lesson ${index + 1}`}
              </button>
              <span id={`reader-mark-why-${step}`} className="text-[12.5px] text-gray-700">{markedNote ?? READ_MARK.note}</span>
            </ActionRow>
          </>
        )}
    </LearningDisclosure>
    </div>
  );
}
