import Link from "next/link";
import { offerable } from "@/lib/individual/scholar/scenario-service";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import {
  countDue, dueCards, getAdaptiveSet, getRevisionSession, listAdaptiveExams, listMaterials, listRevisionSessions, listRevisionSets, mistakeToFixCount, readConsent, revisionInsightRows, revisionPool, sqieSchema, type QuestionRow, isUuid } from "@/lib/individual/scholar/store";
import { citeChunk } from "@/lib/individual/scholar/extract";
import { answerText, buildRevisionInsights } from "@/lib/individual/scholar/revision";
import { feedbackView, keptAttemptView, revisionItemView } from "@/lib/individual/scholar/revision-view";
import { loadLearnerCatalogue, competencyLabels } from "@/lib/individual/scholar/competency-view";
import { aiOffMessage, consentDocuments, consentStatus } from "@/lib/individual/scholar/consent-gate";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { ADAPTIVE_HELP, ADAPTIVE_RULE, REVISION_FORMATS, REVISION_MODE_LABEL, type Marking, type RevisionMode } from "@/lib/individual/scholar/config";
import { PageHeader, StatePanel, Unreadable, focusRing, BoundaryNotice, EmptyState } from "../../../../../_components/chrome";
import { PaneGrid } from "@/components/ui/pane-grid";
import StudyNav from "../_components/StudyNav";
import { ExamPapersSection } from "../_components/papers-section";
import { FORMATIVE_NOTICE, scholarSpace } from "@/lib/individual/scholar/spaces";
import { CardReview, type CardView } from "../_components/client";
import { adaptiveHref, sourceHref, studyHref } from "../_components/question-view";
import { RevisionRunner, RevisionStart, SavedSets } from "../_components/revision-client";
import { ReviseNav, flashcardsHref } from "../_components/revise-nav";
import { loadStudy } from "@/lib/individual/scholar/study-context";
import { revisePrefill, withStudy } from "@/lib/individual/scholar/study-carry";
import { headers } from "next/headers";
import { learnerToday } from "@/lib/individual/scholar/learning-definitions";
import { loadRetentionView } from "@/lib/individual/scholar/retention-data";
import { listTransferChecks } from "@/lib/individual/scholar/store";
import { TRANSFER_NOTE } from "@/lib/individual/scholar/transfer";
import { RetentionPanel } from "../_components/retention-panel";
import { FOLLOW_UP_LABEL, REVISION_INTENT, isRevisionIntent } from "@/lib/individual/scholar/revision-depth";
import { LearningSection } from "@/components/ui/scholar-learning";
import { sectionLead, toneAction } from "../_components/progress-parts";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// REVISION -- COMPETEN-SCHOLAR-REVISION-01 (Stage 4), on COMPETEN-IND-004 s4.
//
// The workspace: Start Today's Revision; Quick Practice, Spaced Revision, Weak Areas, Mock Practice, Flashcards;
// the student's own choice of scope, formats, quantity, difficulty and feedback; Saved Revision Sets; the review cards
// due (the 372 cards on the shared SM-2, self-graded, as before); and Revision Intelligence (R5): due and upcoming,
// recall and its trend, what keeps being missed, coverage, revision activity per competency -- practised, never
// achieved -- and recommendations from the student's own answers. ?session=<id> runs or resumes one session.
// Everything here is formative. Nothing needs new AI to be read: saved sets, cards and history stay available.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Revise" });
}

/** EVALUATION-01: a sitting started as an evaluation knowledge check carries its method and scope back here. */
function evaluationIntent(q: { evaluate?: string; evscope?: string }): { method: "fresh" | "combined"; scope: Record<string, unknown> } | null {
  if (q.evaluate !== "fresh" && q.evaluate !== "combined") return null;
  try {
    const scope = JSON.parse(q.evscope ?? "");
    return scope && typeof scope === "object" && typeof scope.kind === "string" ? { method: q.evaluate, scope } : null;
  } catch { return null; }
}

export default async function Revise({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<{ session?: string; evaluate?: string; evscope?: string; material?: string; difficulty?: string; study?: string; sections?: string; intent?: string; followUp?: string }> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const q = await searchParams;
  const [due, navPolicy] = await Promise.all([countDue(ctx.admin, ctx.userId), loadIndividualPolicy(ctx.admin)]);
  const reviseNavAdaptive = navPolicy.scholarAdaptiveExams === "on";
  // SCHOLAR-SESSION-AI-02: the open study session (database reads only): its bar, carried links, and "what to revise" chosen.
  const study = await loadStudy(ctx.admin, ctx.userId, q.study, "revise", navPolicy);
  const sid = study?.session.id ?? null;
  const header = (
    <>
      <PageHeader accent={x.accent} eyebrow={scholarSpace("revise").eyebrow} title="Revise" intro={scholarSpace("revise").intro} />
      <StudyNav dueCount={due} study={study?.bar ?? null} />
      <ReviseNav current="practice" adaptive={reviseNavAdaptive} row studyId={sid} />
      <BoundaryNotice notice={FORMATIVE_NOTICE} />
    </>
  );
  const papers = <ExamPapersSection admin={ctx.admin} userId={ctx.userId} variant="revise" />;

  // ── one session: run it, or resume it where the student left it ──
  if (q.session) {
    const [s, pool] = await Promise.all([getRevisionSession(ctx.admin, ctx.userId, q.session, { integrity: true }), revisionPool(ctx.admin, ctx.userId, { kinds: [...REVISION_FORMATS, "case"] })]);
    if (!s.ok || !pool.ok) return <>{header}<Unreadable what="this revision session" /></>;
    // SCHOLAR-PRACTICE-EXAMS-01: an adaptive exam runs on its own page (its questions are chosen one at a time).
    // SCHOLAR-FLASHCARDS-01: a flashcards session runs on the Flashcards page (the card-flipping study view).
    if (s.data && s.data.session.mode === "flashcards") redirect(flashcardsHref({ session: s.data.session.id }));
    if (s.data && (s.data.session.mode === "adaptive" || await getAdaptiveSet(ctx.admin, ctx.userId, s.data.session.setId))) redirect(adaptiveHref(s.data.session.id));
    if (!s.data) return <>{header}<StatePanel title="That revision session could not be found" actions={<Link href={studyHref("revise")} className={focusRing}>Back to Revision</Link>}><p>It may have been removed with the materials it used.</p></StatePanel></>;
    const byId = new Map(pool.data.questions.map(qq => [qq.id, qq]));
    // CE-05: a scenario that is no longer offered (an earlier prompt, or failing today's checks) leaves a session that has not answered it; one answered stays, with its history.
    const doneIds = new Set([...s.data.attempts.map(a => a.questionId), ...s.data.held.map(h => h.questionId)]);
    const questions = (await offerable(ctx.admin, ctx.userId, s.data.questionIds.map(id => byId.get(id)).filter((qq): qq is QuestionRow => !!qq), doneIds)).questions;
    const show = s.data.session.feedback === "immediate" || s.data.session.status === "completed";
    const answered = s.data.attempts.filter(a => byId.has(a.questionId)).map(a => ({
      questionId: a.questionId, ...(show ? { feedback: feedbackView(byId.get(a.questionId)!, { correct: a.correct, score: a.score, marking: a.marking as Marking, ...keptAttemptView(byId.get(a.questionId)!, a) }) } : {}),
    // 425, owner decision R4: a short answer held unmarked until the end is answered, and kept on resume. Its grading
    // comes with the end of the session (PATCH complete), never before.
    })).concat(s.data.held.filter(h => byId.has(h.questionId)).map(h => ({ questionId: h.questionId, held: true })));
    // SALE-2026-11 R2 / SALE-10: a session recorded as a transfer check says so (its topic, and why it is asked).
    const transfer = navPolicy.scholarTransferChecks === "on" ? await listTransferChecks(ctx.admin, ctx.userId, { sessionId: s.data.session.id }).catch(() => null) : null;
    const transferTopic = transfer?.ok ? transfer.data[0]?.topic ?? null : null;
    return (
      <>
        {header}
        <RevisionRunner key={s.data.session.id} session={{ id: s.data.session.id, mode: s.data.session.mode, feedback: s.data.session.feedback, status: s.data.session.status, total: questions.length, position: s.data.session.position }}
          items={questions.map(revisionItemView)} answered={answered} evaluation={evaluationIntent(q)}
          followUpOf={isUuid(q.followUp) ? q.followUp : null}
          label={transferTopic ? `Transfer check on ${transferTopic}. ${TRANSFER_NOTE}` : isUuid(q.followUp) ? FOLLOW_UP_LABEL : isRevisionIntent(q.intent) ? `${REVISION_INTENT[q.intent].label}. ${REVISION_INTENT[q.intent].help}` : null} />
      </>
    );
  }

  // ── the workspace ──
  const [policy, materials, sets, sessions, rows, cards, learner, consent, sqie, exams] = await Promise.all([
    loadIndividualPolicy(ctx.admin), listMaterials(ctx.admin, ctx.userId), listRevisionSets(ctx.admin, ctx.userId), listRevisionSessions(ctx.admin, ctx.userId, 10),
    revisionInsightRows(ctx.admin, ctx.userId), dueCards(ctx.admin, ctx.userId), loadLearnerCatalogue(ctx.admin, ctx.userId), readConsent(ctx.admin, ctx.userId),
    sqieSchema(ctx.admin, ctx.userId), listAdaptiveExams(ctx.admin, ctx.userId, 5),
  ]);
  // SCHOLAR-PRACTICE-EXAMS-01: adaptive exams are resumed from their own card, not from "Carry on".
  const examIds = new Set(exams.ok ? exams.data.map(x => x.session.id) : []);
  const examsActive = exams.ok ? exams.data.filter(x => x.session.status === "active") : [];
  // SCHOLAR-SQIE-CLOSE-01: structured (multi-part) is offered only where migration 710 stores it.
  const formats = policy.scholarRevisionFormats.filter(x => x !== "structured" || sqie);
  const status = consent.ok ? consentStatus(consent.data, consentDocuments().published) : null;
  const standing = activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "questions");
  const aiNote = policy.scholarRevisionGeneration === "saved_only" ? "New questions are not written here: revision uses your saved questions."
    : status !== "on" ? `${status ? aiOffMessage(status) ?? "AI help is off." : "Your AI help setting could not be read just now."} Revision uses your saved questions.`
      : !standing.available ? `${standing.message ?? "New AI help is limited right now."} Revision uses your saved questions, cards and sets.` : null;
  const mats = materials.ok ? materials.data.map(m => ({ id: m.id, title: m.title })) : [];
  const insights = rows.ok ? buildRevisionInsights({
    today: new Date().toISOString().slice(0, 10), windowDays: policy.scholarInsightWindowDays, minAnswers: policy.scholarInsightMinAnswers,
    attempts: rows.data.attempts, questions: rows.data.questions, reviews: rows.data.reviews, cards: rows.data.cards, materials: mats,
  }) : null;
  const compNames = insights?.competencyActivity.length
    ? await competencyLabels(ctx.admin, learner.competencies, insights.competencyActivity.map(c => c.competencyId), new Map()) : new Map();
  const cardViews: CardView[] = cards.ok ? cards.data.map(c => ({
    id: c.id, stem: c.question.stem, answer: answerText(c.question), rationale: c.question.rationale, quote: c.question.sourceQuote,
    citation: `${c.question.materialTitle}, ${c.question.ordinal !== null ? citeChunk({ ordinal: c.question.ordinal, pageFrom: c.question.pageFrom, pageTo: c.question.pageTo }, c.question.unit) : "source section"}`,
    href: sourceHref(c.question.materialId, c.question.chunkId),
  })) : [];
  const active = sessions.ok ? sessions.data.filter(s => s.status === "active" && s.mode !== "adaptive" && !examIds.has(s.id)).slice(0, 5) : [];

  // HFE-01 Wave 4 (F10): before there is anything to revise, one message and one action -- not a dashboard of zeros.
  const nothingYet = materials.ok && mats.length === 0 && rows.ok && rows.data.attempts.length === 0
    && cards.ok && cards.data.length === 0 && sets.ok && sets.data.length === 0 && active.length === 0;
  if (nothingYet) {
    return (
      <>
        {header}
        {papers}
        <EmptyState title="Nothing to revise yet" action={<Link href={studyHref("")} className={`inline-flex min-h-[44px] items-center rounded-xl px-5 text-[14.5px] font-semibold text-white ${focusRing}`} style={{ background: x.accent }}>Go to My Learning</Link>}>
          Revision works from questions on your own material. Upload a material and answer a few questions on it, and your revision appears here.
        </EmptyState>
      </>
    );
  }

  // SCHOLAR-COMPANION-01 P1: the mistake notebook's entry (database reads only; absent when the policy is off or unreadable).
  const toFix = policy.scholarMistakeNotebook === "on" ? await mistakeToFixCount(ctx.admin, ctx.userId) : null;
  // SALE-2026-11 R2: due retrieval (SALE-08), prerequisite reviews (SALE-09) and transfer checks (SALE-10). Null while all three keys are off.
  const retention = await loadRetentionView(ctx.admin, ctx.userId, policy, new Date().toISOString(), { today: learnerToday(await headers()) });

  return (
    <>
      {header}
      {papers}
      <PaneGrid bp="lg" fallbackMain="minmax(0,3fr)"
        end={{ storageKey: "scholar.revise.side.w", defaultPx: { ratio: 0.4 }, fallback: "minmax(0,2fr)", label: "Resize the revision progress panel", node: (
        <aside aria-labelledby="intel-h" className="space-y-4">
          <h2 id="intel-h" className="text-[17px] font-bold text-gray-900">How your revision is going</h2>
          <p className="text-[13px] leading-relaxed text-gray-700">From your own answers and reviews. Revision is practice: none of this is an assessment or evidence of competence.</p>
          {!insights ? <Unreadable what="your revision history" /> : (
            <>
              {policy.scholarRevisionRecommendations === "on" && insights.recommendations.length > 0 && (
                <LearningSection tone="next" icon="target" title="What to revise next" headingId="rec-h" caps={false}>
                  <ul className="mt-2 space-y-2">
                    {insights.recommendations.map(r => (
                      <li key={r.id} className="text-[13.5px]">
                        {"learnSection" in r.action
                          ? <Link href={`${studyHref("learn")}?section=${r.action.learnSection}`} className={toneAction.link}>{r.title}</Link>
                          : <span className="font-semibold text-gray-900">{r.title}</span>}
                        <span className="block text-[13px] text-gray-800">{r.reason}</span>
                      </li>
                    ))}
                  </ul>
                </LearningSection>
              )}
              <dl className="cmp-learn-summary grid grid-cols-2 gap-3">
                <Stat label="Cards due now" value={String(insights.due)} />
                <Stat label="Due in the next 7 days" value={String(insights.upcoming7)} />
                <Stat label={`Reviews, last ${policy.scholarInsightWindowDays} days`} value={insights.completedReviews.state === "measured" ? String(insights.completedReviews.reviews) : "Not measured"} note={insights.completedReviews.state === "measured" ? null : insights.completedReviews.reason} />
                <Stat label="Recall" value={insights.recall.state === "measured" ? `${insights.recall.recalledShare}%` : insights.recall.state === "insufficient" ? "Not enough yet" : "Not measured"}
                  note={insights.recall.state === "measured" ? `of ${insights.recall.reviews} reviews graded Okay or better` : insights.recall.state === "insufficient" ? `${insights.recall.have} of ${insights.recall.need} reviews needed` : insights.recall.reason} />
                <Stat label="Materials revised" value={`${insights.coverage.revised} of ${insights.coverage.of}`} />
                <Stat label="Answers marked" value={`${insights.marking.deterministic + insights.marking.self_graded + insights.marking.ai_evaluation}`}
                  note={`by code ${insights.marking.deterministic} · by you ${insights.marking.self_graded} · by AI evaluation ${insights.marking.ai_evaluation}`} />
              </dl>
              <LearningSection tone="summary" icon="clock" title="Recall over six weeks" headingId="ret-h" caps={false}>
                {insights.retention.state !== "measured" ? <p className="mt-1 text-[13px] text-gray-600">{insights.retention.state === "insufficient" ? `Not enough reviews yet (${insights.retention.have} of ${insights.retention.need}).` : insights.retention.reason}</p> : (
                  <table className="mt-2 w-full rounded-lg bg-[var(--cmp-app-surface)] text-[13px]">
                    <caption className="sr-only">Reviews and the share graded Okay or better, by week</caption>
                    <thead><tr className="text-left text-[12px] text-gray-700"><th scope="col" className="font-semibold">Week of</th><th scope="col" className="font-semibold">Reviews</th><th scope="col" className="font-semibold">Recalled</th></tr></thead>
                    <tbody>{insights.retention.weeks.map(w => (
                      <tr key={w.weekStart} className="border-t border-gray-100"><td>{new Date(`${w.weekStart}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</td>
                        <td className="tabular-nums">{w.reviews}</td><td className="tabular-nums">{w.recalledShare === null ? "No reviews" : `${w.recalledShare}%`}</td></tr>
                    ))}</tbody>
                  </table>
                )}
              </LearningSection>
              <LearningSection tone="record" icon="record" title="What you keep missing" headingId="hard-h" caps={false}>
                {insights.repeatedDifficulties.length === 0 ? <p className="mt-1 text-[13px] text-gray-600">Nothing missed more than once.</p> : (
                  <ul className="mt-2 space-y-2">{insights.repeatedDifficulties.map(d => (
                    <li key={d.questionId} className="text-[13px]"><span className="text-gray-900">{d.stem}</span> <span className="text-gray-700">· missed {d.misses} times</span>
                      <Link href={`${studyHref("learn")}?section=${d.chunkId}`} className={`ml-2 ${toneAction.link}`}>Teach me this</Link></li>
                  ))}</ul>
                )}
              </LearningSection>
              <LearningSection tone="sources" icon="library" title="Revision by competency" headingId="comp-h" caps={false}>
                <p className="mt-2 text-[13px] text-gray-700">Questions answered on competencies your notes are linked to. Practised, not achieved.</p>
                {insights.competencyActivity.length === 0 ? <p className="mt-1 text-[13px] text-gray-600">Not measured: none of your revision questions is linked to a competency yet. Revision works without a catalogue.</p> : (
                  <ul className="mt-2 space-y-1">{insights.competencyActivity.slice(0, 8).map(c => (
                    <li key={c.competencyId} className="flex justify-between gap-2 text-[13px]"><span className="text-gray-900">{compNames.get(c.competencyId)?.title ?? "A competency"}</span><span className="tabular-nums text-gray-600">{c.answered} answered</span></li>
                  ))}</ul>
                )}
              </LearningSection>
            </>
          )}
        </aside>
        ) }}>
        <div className="space-y-5">
          {retention && <RetentionPanel v={retention} />}
          <RevisionStart modes={policy.scholarRevisionModes} formats={formats} quantity={policy.scholarRevisionQuantity}
            difficulty={policy.scholarRevisionDifficulty} feedback={policy.scholarRevisionFeedback} materials={mats}
            competencies={(learner.competencies ?? []).map(c => ({ id: c.id, title: c.title }))} aiNote={aiNote}
            // SCHOLAR-INDEPENDENT-LEARNING-01 P1: from a Learn lesson's notes, only that lesson's sections (the learner may widen it to the material).
            preset={q.material ? { materialId: q.material, difficulty: q.difficulty ?? null, chunkIds: (q.sections ?? "").split(",").filter(isUuid).slice(0, 24) } : null}
            scope={q.material ? null : revisePrefill(study?.scope ?? null, { materialIds: mats.map(m => m.id), competencyIds: (learner.competencies ?? []).map(c => c.id) })} />

          {toFix?.ok && (
            <Link href={withStudy(studyHref("revise/mistakes"), sid)} className={`cmp-learn-record cmp-learn-box flex min-h-[44px] flex-wrap items-center justify-between gap-x-3 gap-y-1 px-5 py-3 hover:opacity-90 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
              <span className="cmp-learn-ink text-[14.5px] font-semibold">Mistake notebook ({toFix.data} to fix)</span>
              <span className="text-[13px] text-gray-800">Your wrong answers, with the answer and why</span>
            </Link>
          )}

          {policy.scholarAdaptiveExams === "on" && (
            <LearningSection tone="check" icon="question" title="Adaptive exam" level={2} headingId="adaptive-h" caps={false}>
              <p className={sectionLead}>{ADAPTIVE_HELP}</p>
              <p className="mt-2 rounded-lg bg-[var(--cmp-app-surface)] ring-1 ring-[var(--learn-border)] px-3 py-2 text-[13px] text-gray-800"><span className="font-semibold">How it adapts: </span>{ADAPTIVE_RULE}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Link href={withStudy(adaptiveHref(), sid)} className={toneAction.primary}>Set up an adaptive exam</Link>
                {examsActive.map(e => (
                  <Link key={e.session.id} href={adaptiveHref(e.session.id)} className={`text-[13.5px] ${toneAction.link}`}>Carry on: {e.title} ({e.session.position} answered)</Link>
                ))}
              </div>
            </LearningSection>
          )}

          {policy.scholarFlashcards === "on" && (
            <LearningSection tone="quickCheck" icon="cards" title="Flashcards" level={2} headingId="flashcards-h" caps={false}>
              <p className={sectionLead}>Recall the answer, flip the card, and say whether you remembered: it comes back sooner or later on your spaced review schedule. From your notes, the Competen library and your learning gaps, or cards you write yourself, in decks you can download.</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Link href={withStudy(flashcardsHref(), sid)} className={toneAction.primary}>Open Flashcards</Link>
                <Link href={flashcardsHref({ view: "decks" })} className={toneAction.secondary}>My Decks</Link>
              </div>
            </LearningSection>
          )}

          {active.length > 0 && (
            <LearningSection tone="next" icon="arrow" title="Carry on where you left off" level={2} headingId="resume-h" caps={false}>
              <ul className="mt-2 space-y-1.5">
                {active.map(s => (
                  <li key={s.id}><Link href={`${studyHref("revise")}?session=${s.id}`} className={`text-[14px] ${toneAction.link}`}>{REVISION_MODE_LABEL[s.mode as RevisionMode] ?? "Revision"}</Link>
                    <span className="text-[13px] text-gray-700"> · {s.position} of {s.total} answered · {new Date(s.lastActiveAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></li>
                ))}
              </ul>
            </LearningSection>
          )}

          <LearningSection tone="notes" icon="layers" title="Saved revision sets" level={2} headingId="sets-h" caps={false}>
            <p className={sectionLead}>Revising a saved set again uses its stored questions and answers: no new AI, so it is always available.</p>
            {!sets.ok ? (sets.notProvisioned ? <p className="mt-2 text-[13.5px] text-gray-800">Saved sets are not available here yet.</p> : <Unreadable what="saved revision sets" />)
              : sets.data.length === 0 ? <p className="mt-2 text-[13.5px] text-gray-800">None yet. After a session, you can save its questions as a set.</p>
                : <SavedSets sets={sets.data.map(s => ({ id: s.id, title: s.title, questions: s.questionIds.length, lastUsedAt: s.lastUsedAt }))} />}
          </LearningSection>

          <section aria-labelledby="cards-h">
            <h2 id="cards-h" className="mb-2 text-[17px] font-bold text-gray-900">Review cards due</h2>
            {!cards.ok ? (cards.notProvisioned
              ? <StatePanel title="Revision is not set up here yet"><p>The study store it needs has not been installed here.</p></StatePanel>
              : <Unreadable what="review cards" />)
              : <CardReview cards={cardViews} />}
          </section>
        </div>
      </PaneGrid>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div className="cmp-learn-box p-3">
      <dt className="text-[12.5px] font-semibold text-gray-700">{label}</dt>
      <dd className="cmp-learn-ink mt-0.5 text-[18px] font-bold tabular-nums">{value}</dd>
      {note && <dd className="text-[12px] text-gray-700">{note}</dd>}
    </div>
  );
}
