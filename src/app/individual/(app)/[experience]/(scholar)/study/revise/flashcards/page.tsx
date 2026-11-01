import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { loadStudy } from "@/lib/individual/scholar/study-context";
import { flashcardPrefill, withStudy } from "@/lib/individual/scholar/study-carry";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../../_components/shell-context";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { countDue, getRevisionSession, listMaterials, readConsent } from "@/lib/individual/scholar/store";
import { applyContentReview, loadFlashcardGaps, loadFlashcards } from "@/lib/individual/scholar/flashcard-service";
import { REVIEW_STATE_LABEL, filterCards, recallOf, spacedViews, type CardOrigin, type DeckSummary, type FlashcardView, type ReviewState } from "@/lib/individual/scholar/flashcards";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { aiOffMessage, consentDocuments, consentStatus } from "@/lib/individual/scholar/consent-gate";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { PageHeader, StatePanel, Unreadable, focusRing, BoundaryNotice } from "../../../../../../_components/chrome";
import StudyNav from "../../_components/StudyNav";
import { FORMATIVE_NOTICE } from "@/lib/individual/scholar/spaces";
import { studyHref } from "../../_components/question-view";
import { ReviseNav, flashcardsHref, type ReviseNavKey } from "../../_components/revise-nav";
import {
  CardBrowser, CreateMore, DeckHeader, DeckList, DeckOptions, DeckStart, FlashcardStudy, HowItWorks,
  FlashcardsGrid, FLASHCARDS_MAIN, FLASHCARDS_NAV, FLASHCARDS_SIDE,
  type CardRow, type DeckRow, type ExportFormat, type StudyCard,
} from "../../_components/flashcards-client";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// FLASHCARDS -- SCHOLAR-FLASHCARDS-01 (owner, 31 Oct 2026), under Revise, to the owner mock-up.
//
// ?session=<id>[&deck=<key>]  study a session card by card (a 417 session in mode flashcards: resumable, its ratings on
//                              the existing SM-2 and the 391 log). ?deck=<key> chooses the deck the side column acts on.
// ?view=cards|decks|history    All cards (search, filter, bookmark, edit your own, combine and move between decks),
//                              My Decks (make, rename, organise, remove; several at once to study or download), and
//                              Revision History (due today, needs more practice, remembered, next review, history, gaps).
// Formative throughout; private to the learner; nothing is published. Rating and flipping never call AI.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Flashcards" });
}

/** 2026-10-12T... as 12 October 2026 (UTC), for a library card's clinically reviewed date. */
const ukDate = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); };

type Search = { session?: string; deck?: string; view?: string; q?: string; state?: string; origin?: string; bookmarked?: string; edit?: string; create?: string; made?: string; lib?: string; note?: string; study?: string };

const glyphOf = (title: string) => title.trim().slice(0, 1).toUpperCase() || "F";

export default async function Flashcards({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<Search> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const q = await searchParams;
  const [due, policy] = await Promise.all([countDue(ctx.admin, ctx.userId), loadIndividualPolicy(ctx.admin)]);
  // SCHOLAR-SESSION-AI-02: the open study session (database reads only): its bar, carried links, and Create More chosen.
  const study = await loadStudy(ctx.admin, ctx.userId, q.study, "revise", policy);
  const sid = study?.session.id ?? null;
  const navKey: ReviseNavKey = q.view === "history" ? "history" : q.view === "decks" ? "decks" : "flashcards";
  const crumb = q.view === "history" ? "Revision History" : q.view === "decks" ? "My Decks" : q.view === "cards" ? "All cards" : null;
  const top = (
    <>
      <PageHeader accent={SCHOLAR.accent} eyebrow="Revise" title="Flashcards" />
      <StudyNav dueCount={due} study={study?.bar ?? null} />
    </>
  );
  const shell = (main: React.ReactNode, side: React.ReactNode, notice = true) => (
    <>
      {top}
      {/* SCHOLAR-FLASHCARDS-QA-01: laid out by the width the content area HAS (a container query), not the viewport:
          the shell sidebar takes its share first. Narrow: the Revise nav one row, then the card, then Deck Options.
          From 39rem the card column (22rem and up) and Deck Options (16rem and up) sit side by side; from 56rem the nav
          is its own column too. CPR-MOB-001's single md viewport edge is untouched. */}
      <div data-testid="flashcards-shell" className="@container">
      <FlashcardsGrid
        nav={<div className={FLASHCARDS_NAV}><ReviseNav current={navKey} adaptive={policy.scholarAdaptiveExams === "on"} container studyId={sid} /></div>}
        main={(
        <div className={FLASHCARDS_MAIN}>
          <nav aria-label="Breadcrumb" className="text-[13.5px] text-gray-600">
            <ol className="flex flex-wrap items-center gap-1.5">
              <li><Link href={withStudy(studyHref("revise"), sid)} className={`hover:underline ${focusRing}`}>Revise</Link></li>
              <li aria-hidden>›</li>
              <li>{crumb ? <Link href={flashcardsHref()} className={`hover:underline ${focusRing}`}>Flashcards</Link> : <span aria-current="page" className="font-semibold text-gray-900">Flashcards</span>}</li>
              {crumb && <><li aria-hidden>›</li><li aria-current="page" className="font-semibold text-gray-900">{crumb}</li></>}
            </ol>
          </nav>
          {main}
          {notice && <BoundaryNotice notice={FORMATIVE_NOTICE} />}
        </div>
        )}
        side={<aside aria-label="Deck options and new flashcards" className={FLASHCARDS_SIDE}>{side}</aside>} />
      </div>
    </>
  );

  if (policy.scholarFlashcards !== "on")
    return <>{top}<StatePanel title="Flashcards are not offered here"><p>Revision, your review cards and your saved sets are unaffected.</p></StatePanel></>;

  const [lib, materials, learner, consent, gaps] = await Promise.all([
    loadFlashcards(ctx), listMaterials(ctx.admin, ctx.userId), loadLearnerCatalogue(ctx.admin, ctx.userId), readConsent(ctx.admin, ctx.userId), loadFlashcardGaps(ctx),
  ]);
  if (!lib.ok) return <>{top}<Unreadable what="your flashcards" /></>;
  const { cards, decks, schema730 } = lib.data;
  const exports = policy.scholarFlashcardExports as ExportFormat[];
  const deck: DeckSummary = decks.find(d => d.key === q.deck) ?? decks.find(d => d.kind === "personal" && d.total > 0) ?? decks[0];

  // Where new cards can come from right now, said plainly (as Revise says it). Stored and library cards always work.
  const status = consent.ok ? consentStatus(consent.data, consentDocuments().published) : null;
  const standing = activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "questions");
  const aiNote = policy.scholarRevisionGeneration === "saved_only" ? "New cards are not written here: your saved and library cards are used."
    : status !== "on" ? `${status ? aiOffMessage(status) ?? "AI help is off." : "Your AI help setting could not be read just now."} Your saved and library cards are used.`
      : !standing.available ? `${standing.message ?? "New AI help is limited right now."} Your saved and library cards are used.` : null;
  const mats = materials.ok ? materials.data.filter(m => m.chunkCount > 0).map(m => ({ id: m.id, title: m.title })) : [];
  const personal = decks.filter(d => d.kind === "personal" && d.id).map(d => ({ id: d.id!, title: d.title }));
  const side = (preset: string | null = null) => (
    <>
      <DeckOptions deck={{ key: deck.key, id: deck.id, title: deck.title, total: deck.total, due: deck.due + deck.fresh }} exports={exports} />
      <CreateMore materials={mats} competencies={(learner.competencies ?? []).map(c => ({ id: c.id, title: c.title }))} decks={personal}
        sourceModes={policy.scholarFlashcardSourceModes} perGeneration={policy.scholarFlashcardsPerGeneration} aiNote={aiNote} gaps={gaps.length} marksOn={schema730}
        preset={preset === "notes" || preset === "competency" || preset === "topic" || preset === "gaps" || preset === "write" ? preset : null}
        scope={flashcardPrefill(study?.scope ?? null, { materialIds: mats.map(m => m.id), competencyIds: (learner.competencies ?? []).map(c => c.id) })} />
      {!schema730 && <p className="rounded-2xl border border-gray-200 bg-white p-4 text-[13px] text-gray-600">Decks of your own, cards you write yourself, bookmarks and notes are not available here yet. Flashcards from your notes and the Competen library work as usual.</p>}
    </>
  );

  // ── one study session: run it, or resume it where the learner left it ──
  if (q.session) {
    const s = await getRevisionSession(ctx.admin, ctx.userId, q.session);
    if (!s.ok) return shell(<Unreadable what="this study session" />, side());
    if (!s.data) return shell(<StatePanel title="That study session could not be found" actions={<Link href={flashcardsHref()} className={focusRing}>Back to Flashcards</Link>}><p>It may have been removed with the materials it used.</p></StatePanel>, side());
    if (s.data.session.mode !== "flashcards") redirect(`${studyHref("revise")}?session=${s.data.session.id}`);
    // The session's cards, flagged by the published clinical educational content review rules.
    const inSession = new Set(s.data.questionIds);
    const byId = new Map((await applyContentReview(ctx, cards.filter(c => inSession.has(c.id)), ukDate)).map(c => [c.id, c]));
    const rated = new Map(s.data.attempts.map(a => [a.questionId, a]));
    const studyCards: StudyCard[] = s.data.questionIds.map(id => byId.get(id)).filter((c): c is FlashcardView => !!c).map(c => {
      const a = rated.get(c.id);
      return {
        id: c.id, front: c.front, origin: c.origin, originLabel: c.originLabel, citation: c.sources[0]?.citation ?? c.material.title,
        materialId: c.material.id, materialTitle: c.material.title, chunkId: c.chunkId, competency: c.competency?.title ?? null, topic: c.topic,
        editable: c.editable, bookmarked: c.bookmarked, note: c.note, issue: c.issue,
        // SCHOLAR-FLASHCARDS-QA-01: flagged, never rewritten (flashcard-sensitive.ts); shown with the answer.
        sensitive: c.sensitive?.marker ? { marker: c.sensitive.marker, reviewed: c.sensitive.reviewed } : null,
        answered: a ? { recall: a.correct ? "remembered" : "again", nextReviewAt: c.review.nextReviewAt } : null,
        back: a ? { text: c.back, explanation: c.explanation, quote: c.sources.find(x => x.origin === "notes")?.quote ?? null } : null,
      };
    });
    const studyDeck = q.deck ? decks.find(d => d.key === q.deck) ?? null : null;
    const made = Number(q.made ?? 0), fromLib = Number(q.lib ?? 0);
    const madeNote = q.made !== undefined ? [made ? `${made} new card${made === 1 ? "" : "s"} written from your notes and checked against them.` : "No new cards were needed or written: your saved cards were used.", fromLib ? `${fromLib} from the Competen library (clinically reviewed).` : "", q.note ?? ""].filter(Boolean).join(" ") : null;
    return shell(
      <>
        {madeNote && <p role="status" className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[13.5px] text-gray-800">{madeNote}</p>}
        {studyCards.length < s.data.questionIds.length && <p className="text-[12.5px] text-gray-600">Some cards in this session are no longer stored (their material was removed, or a library card was withdrawn) and are left out.</p>}
        <FlashcardStudy sessionId={s.data.session.id} deckTitle={studyDeck?.title ?? "Study session"} deckKey={studyDeck?.key ?? null} deckCards={studyDeck?.total ?? studyCards.length}
          lastRevised={studyDeck?.lastStudiedAt ?? null} cards={studyCards} marksOn={schema730} completed={s.data.session.status === "completed"} />
      </>,
      side(), false,
    );
  }

  // ── All cards ──
  if (q.view === "cards") {
    const filtered = filterCards(cards, decks, { q: q.q ?? null, state: (q.state as ReviewState) || null, origin: (q.origin as CardOrigin) || null, bookmarked: q.bookmarked === "1", deck: q.deck ?? null });
    const rows: CardRow[] = filtered.map(c => ({
      id: c.id, front: c.front, origin: c.origin, originLabel: c.originLabel, materialTitle: c.material.title, topic: c.topic, competency: c.competency?.title ?? null,
      difficulty: c.difficulty, state: c.review.state, stateLabel: REVIEW_STATE_LABEL[c.review.state], nextReviewAt: c.review.nextReviewAt, lastReviewedAt: c.review.lastReviewedAt,
      reviews: c.review.reviews, intervalDays: c.review.intervalDays, ease: c.review.ease, recent: c.review.history.slice(0, 5).map(h => h.recall),
      bookmarked: c.bookmarked, note: c.note, issue: c.issue, editable: c.editable, deckIds: c.deckIds, createdAt: c.createdAt, version: c.version,
    }));
    return shell(
      <CardBrowser cards={rows} decks={personal} currentDeck={q.deck ? { key: deck.key, id: deck.id, title: deck.title } : null} marksOn={schema730}
        filters={{ q: q.q ?? "", state: q.state ?? "", bookmarked: q.bookmarked === "1", origin: q.origin ?? "" }} />,
      side(q.create ?? null),
    );
  }

  // ── My Decks ──
  if (q.view === "decks") {
    const rows: DeckRow[] = decks.map(d => {
      const p = lib.data.personal.find(x => x.id === d.id);
      return { key: d.key, id: d.id, kind: d.kind, title: d.title, subtitle: d.subtitle, total: d.total, due: d.due, fresh: d.fresh, needsPractice: d.needsPractice, remembered: d.remembered, lastStudiedAt: d.lastStudiedAt, organiseBy: p?.organiseBy, organiseRef: p?.organiseRef ?? null };
    });
    return shell(<DeckList decks={rows} marksOn={schema730} exports={exports} editId={q.edit ?? null} />, side(q.create ?? null));
  }

  // ── Revision History: the spaced repetition views, history and topic-level gaps ──
  if (q.view === "history") {
    const v = spacedViews(cards, lib.data.today);
    const count = (label: string, n: number, state: ReviewState) => (
      <Link href={flashcardsHref({ view: "cards", state })} className={`rounded-2xl border border-gray-200 bg-white p-3 hover:bg-gray-50 ${focusRing}`}>
        <span className="block text-[12px] font-semibold text-gray-500">{label}</span><span className="block text-[22px] font-bold tabular-nums text-gray-900">{n}</span>
      </Link>
    );
    return shell(
      <section aria-labelledby="hist-h" className="space-y-4">
        <h2 id="hist-h" className="text-[18px] font-bold text-gray-900">Revision History</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-2">
          {count("Due today", v.due.length, "due")}{count("Needs more practice", v.needsPractice.length, "needs_practice")}{count("Remembered", v.remembered.length, "remembered")}{count("Not studied yet", v.fresh.length, "new")}
        </div>
        <p className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-[14px] text-gray-800">
          <span className="font-semibold">Next recommended review: </span>{v.due.length ? "today" : v.nextReview ? new Date(`${v.nextReview}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) : "Not measured: no card has been reviewed yet."}
        </p>
        <section aria-labelledby="gaps-h" className="rounded-2xl border border-gray-200 bg-white p-4">
          <h3 id="gaps-h" className="text-[15px] font-bold text-gray-900">Topic-level gaps</h3>
          <p className="text-[12.5px] text-gray-600">From the questions you got wrong and the cards you did not remember. Practice, not a judgement of competence.</p>
          {gaps.length === 0 ? <p className="mt-2 text-[13.5px] text-gray-700">No gaps recorded yet.</p> : (
            <>
              <ul className="mt-2 space-y-2">
                {gaps.map(g => (
                  <li key={g.label} className="text-[13.5px]">
                    <span className="font-semibold text-gray-900">{g.label}</span> <span className="text-gray-600">· missed {g.missed} time{g.missed === 1 ? "" : "s"}</span>
                    {g.keyPoints.length > 0 && <span className="block text-[12.5px] text-gray-700">Key points: {g.keyPoints.slice(0, 3).join("; ")}</span>}
                    {g.misconceptions.length > 0 && <span className="block text-[12.5px] text-gray-700">Watch for: {g.misconceptions.slice(0, 2).join("; ")}</span>}
                    <Link href={`${studyHref("learn")}?section=${g.chunkIds[0]}`} className={`text-[12.5px] font-semibold underline ${focusRing}`}>Revise this topic in Learn</Link>
                  </li>
                ))}
              </ul>
              <Link href={flashcardsHref({ view: "history", create: "gaps" })} className={`mt-3 inline-flex text-[13.5px] font-semibold underline ${focusRing}`}>Make cards for my gaps</Link>
            </>
          )}
        </section>
        <section aria-labelledby="log-h" className="rounded-2xl border border-gray-200 bg-white p-4">
          <h3 id="log-h" className="text-[15px] font-bold text-gray-900">Your recent reviews</h3>
          {v.history.length === 0 ? <p className="mt-1 text-[13.5px] text-gray-700">No reviews recorded yet.</p> : (
            <table className="mt-2 w-full text-[13px]">
              <caption className="sr-only">Your most recent card reviews, newest first</caption>
              <thead><tr className="text-left text-[12px] text-gray-500"><th scope="col" className="font-semibold">Card</th><th scope="col" className="font-semibold">You said</th><th scope="col" className="font-semibold">When</th><th scope="col" className="hidden font-semibold md:table-cell">Next in</th></tr></thead>
              <tbody>{v.history.map((h, i) => (
                <tr key={`${h.cardId}-${i}`} className="border-t border-gray-100 align-top">
                  <td className="py-1.5 pr-2 text-gray-900">{h.front}</td>
                  <td className="py-1.5 pr-2">{recallOf(h.quality) === "remembered" ? "Remembered" : "Didn't remember"}</td>
                  <td className="py-1.5 pr-2 tabular-nums">{new Date(h.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</td>
                  <td className="hidden py-1.5 tabular-nums md:table-cell">{h.intervalDays === null ? "Not recorded" : `${h.intervalDays} day${h.intervalDays === 1 ? "" : "s"}`}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>
      </section>,
      side(q.create ?? null),
    );
  }

  // ── the deck: its header, where it stands, and study ──
  return shell(
    <>
      <section aria-label={`Deck ${deck.title}`} className="rounded-3xl border border-gray-200 bg-white p-4 md:p-6">
        <DeckHeader title={deck.title} cards={deck.total} lastRevised={deck.lastStudiedAt} glyph={glyphOf(deck.title)} />
        {deck.subtitle && <p className="mt-1 text-[12.5px] text-gray-500">{deck.subtitle}</p>}
        {cards.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-gray-300 p-6 text-center">
            <p className="text-[15px] font-semibold text-gray-900">No flashcards yet</p>
            <p className="mt-1 text-[13.5px] text-gray-600">Make cards from your notes, a competency, a topic or your learning gaps under Create More Flashcards, or write one yourself.</p>
          </div>
        ) : <DeckStart deck={{ key: deck.key, title: deck.title, total: deck.total }} perState={{ due: deck.due, fresh: deck.fresh, needsPractice: deck.needsPractice, remembered: deck.remembered }} />}
        {decks.length > 1 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {decks.filter(d => d.kind === "all" || d.kind === "personal" || d.kind === "bookmarked").slice(0, 8).map(d => (
              <Link key={d.key} href={flashcardsHref({ deck: d.key })} aria-current={d.key === deck.key ? "true" : undefined}
                className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing} ${d.key === deck.key ? "border-[var(--cmp-role-indigo-ink)] bg-[var(--cmp-role-indigo-soft)] text-[var(--cmp-role-indigo-ink)]" : "border-gray-200 text-gray-700 hover:bg-gray-50"}`}>{d.title} ({d.total})</Link>
            ))}
            <Link href={flashcardsHref({ view: "decks" })} className={`rounded-full px-3 py-1 text-[12.5px] font-semibold underline ${focusRing}`}>All decks</Link>
          </div>
        )}
      </section>
      <HowItWorks />
    </>,
    side(q.create ?? null),
  );
}
