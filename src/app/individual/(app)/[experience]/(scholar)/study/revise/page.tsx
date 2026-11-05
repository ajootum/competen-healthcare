import Link from "next/link";
import { offerable } from "@/lib/individual/scholar/scenario-service";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import {
  countDue, dueCards, getAdaptiveSet, getRevisionSession, libraryTopics, listAdaptiveExams, listLearningSessions, listMappings, listMaterials, listRevisionSessions, listRevisionSets, mistakeToFixCount, readConsent, revisionInsightRows, revisionPool, sessionStepSummaries, sqieSchema, type QuestionRow, isUuid } from "@/lib/individual/scholar/store";
import { citeChunk } from "@/lib/individual/scholar/extract";
import { answerText, buildRevisionInsights } from "@/lib/individual/scholar/revision";
import { feedbackView, keptAttemptView, revisionItemView } from "@/lib/individual/scholar/revision-view";
import { loadLearnerCatalogue, competencyLabels } from "@/lib/individual/scholar/competency-view";
import { aiOffMessage, consentDocuments, consentStatus } from "@/lib/individual/scholar/consent-gate";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { ADAPTIVE_HELP, ADAPTIVE_RULE, REVISION_FORMATS, REVISION_MODE_LABEL, type Marking, type RevisionMode } from "@/lib/individual/scholar/config";
import { PageHeader, StatePanel, Unreadable, focusRing, BoundaryNotice, EmptyState } from "../../../../../_components/chrome";
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
import { learnerTimeZone, learnerToday, localDay } from "@/lib/individual/scholar/learning-definitions";
import { loadToday } from "@/lib/individual/scholar/plan-data";
import { materialTopics } from "@/lib/individual/scholar/library";
import { retrievalLine } from "@/lib/individual/scholar/retrieval-schedule";
import { planRefOfKey } from "@/lib/individual/scholar/plan-today-view";
import { CATALOGUE_STATUSES, CATALOGUE_STATUS_LABEL, buildCatalogue, buildStudiedThisMonth, buildTodayQueue, daysLeftLabel, filterCatalogue, hasCatalogueFilters, parseCatalogueFilters, parseReviseView, shortDate, type ReviseView } from "@/lib/individual/scholar/revise-workspace";
import { CatalogueRowView, ReviseShortcuts, ReviseViewNav, StudiedMonthView, TodayQueue, reviseHref } from "../_components/revise-workspace-parts";
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
// SCHOLAR-REVISE-WORKSPACE-01 (owner GO, 5 Nov 2026): one view at a time. TODAY opens on what needs attention, why, and how to
// begin: one queue (unfinished revision, due cards, due retrieval, weak areas, mistakes, today's plan, a suggestion), then how to
// revise. MY PRIORITIES reads My Plan and changes nothing. STUDIED THIS MONTH comes from records of learning, never upload dates.
// ALL TOPICS is the catalogue, with saved sets. REVISION INSIGHTS keeps Revision Intelligence (R5): due and upcoming, recall and its
// trend, what keeps being missed, coverage, revision activity per competency -- practised, never achieved. ?session=<id> runs or
// resumes one session. ?material, ?topic or ?competency chooses what, then how. Everything here is formative. Nothing needs new
// AI to be read: saved sets, cards and history stay available.

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

export default async function Revise({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<{ session?: string; evaluate?: string; evscope?: string; material?: string; difficulty?: string; study?: string; sections?: string; intent?: string; followUp?: string; view?: string; topic?: string; competency?: string; practice?: string; review?: string; resume?: string; q?: string; m?: string; t?: string; c?: string; status?: string; from?: string; page?: string }> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const q = await searchParams;
  const [due, navPolicy] = await Promise.all([countDue(ctx.admin, ctx.userId, learnerToday(await headers())), loadIndividualPolicy(ctx.admin)]);
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

  // ── the workspace ── SCHOLAR-REVISE-WORKSPACE-01: one view at a time, opening on what needs attention ──
  const hdrs = await headers();
  const today = learnerToday(hdrs), tz = learnerTimeZone(hdrs), now = new Date();
  const [policy, materials, sets, sessions, rows, cards, learner, consent, sqie, exams] = await Promise.all([
    loadIndividualPolicy(ctx.admin), listMaterials(ctx.admin, ctx.userId), listRevisionSets(ctx.admin, ctx.userId), listRevisionSessions(ctx.admin, ctx.userId, 10),
    revisionInsightRows(ctx.admin, ctx.userId), dueCards(ctx.admin, ctx.userId, today), loadLearnerCatalogue(ctx.admin, ctx.userId), readConsent(ctx.admin, ctx.userId),
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
    today, windowDays: policy.scholarInsightWindowDays, minAnswers: policy.scholarInsightMinAnswers,
    attempts: rows.data.attempts, questions: rows.data.questions, reviews: rows.data.reviews, cards: rows.data.cards, materials: mats,
  }) : null;
  const active = sessions.ok ? sessions.data.filter(s => s.status === "active" && s.mode !== "adaptive" && !examIds.has(s.id)) : [];
  const carryOn = [
    ...active.map(s => ({ key: s.id, title: REVISION_MODE_LABEL[s.mode as RevisionMode] ?? "Revision", position: s.position, total: s.total as number | null, lastActiveAt: s.lastActiveAt, href: `${studyHref("revise")}?session=${s.id}` })),
    ...examsActive.map(e => ({ key: e.session.id, title: `Adaptive exam: ${e.title}`, position: e.session.position, total: null, lastActiveAt: e.session.lastActiveAt, href: adaptiveHref(e.session.id) })),
  ].sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));

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

  const shortcuts = [
    { label: "Flashcards", href: withStudy(flashcardsHref(), sid) }, { label: "Practice Questions", href: withStudy(reviseHref("today", { practice: "1" }), sid) },
    ...(policy.scholarAdaptiveExams === "on" ? [{ label: "Adaptive Exams", href: withStudy(adaptiveHref(), sid) }] : []),
    { label: "Revision History", href: flashcardsHref({ view: "history" }) },
    ...(policy.scholarMistakeNotebook === "on" ? [{ label: "Mistake Notebook", href: withStudy(studyHref("revise/mistakes"), sid) }] : []),
    { label: "My Decks", href: flashcardsHref({ view: "decks" }) },
  ];
  const view = parseReviseView(q.view);
  const frame = (current: ReviseView | null, body: React.ReactNode) => (
    <>
      <PageHeader accent={x.accent} eyebrow={scholarSpace("revise").eyebrow} title="Revise" />
      <StudyNav dueCount={due} study={study?.bar ?? null} />
      <ReviseViewNav current={current} carry={sid} />
      <ReviseShortcuts items={shortcuts} />
      {body}
      <div className="mt-5"><BoundaryNotice notice={FORMATIVE_NOTICE} /></div>
    </>
  );
  const startForm = (formOpen: boolean, title: string, preset: React.ComponentProps<typeof RevisionStart>["preset"], scope: React.ComponentProps<typeof RevisionStart>["scope"]) => (
    <RevisionStart modes={policy.scholarRevisionModes} formats={formats} quantity={policy.scholarRevisionQuantity}
      difficulty={policy.scholarRevisionDifficulty} feedback={policy.scholarRevisionFeedback} materials={mats}
      competencies={(learner.competencies ?? []).map(c => ({ id: c.id, title: c.title }))} aiNote={aiNote}
      preset={preset} scope={scope} heading={title} compact formOpen={formOpen} />
  );

  // ── choose what, then how: a material, topic or competency the learner picked, or a lesson's notes ──
  const chosenTopic = (q.topic ?? "").trim().slice(0, 120);
  const chosenCompetency = isUuid(q.competency) ? q.competency : null;
  if (q.material || chosenTopic || chosenCompetency || q.practice) {
    const name = q.material ? mats.find(m => m.id === q.material)?.title ?? null : chosenTopic || (chosenCompetency ? (learner.competencies ?? []).find(c => c.id === chosenCompetency)?.title ?? null : null);
    return frame(null, (
      <div className="space-y-3" data-revise-choose>
        <p className="text-[14px] text-gray-800"><Link href={withStudy(reviseHref("today"), sid)} className={`font-semibold underline underline-offset-2 ${focusRing}`}>Back to Today</Link>{name ? <> · Revising <span className="font-semibold text-gray-900">{name}</span></> : null}</p>
        {/* SCHOLAR-INDEPENDENT-LEARNING-01 P1: from a Learn lesson's notes, only that lesson's sections (the learner may widen it to the material). */}
        {startForm(!!q.practice || !!q.sections, name ? "How do you want to revise it?" : "How do you want to revise?",
          q.material ? { materialId: q.material, difficulty: q.difficulty ?? null, chunkIds: (q.sections ?? "").split(",").filter(isUuid).slice(0, 24) } : null,
          chosenTopic ? { kind: "topic", topic: chosenTopic } : chosenCompetency ? { kind: "competency", competencyId: chosenCompetency } : q.material ? null
            : revisePrefill(study?.scope ?? null, { materialIds: mats.map(m => m.id), competencyIds: (learner.competencies ?? []).map(c => c.id) }))}
      </div>
    ));
  }

  // ── every unfinished session, from the queue's "See them all" ──
  if (q.resume === "all") {
    return frame("today", (
      <section aria-labelledby="carry-h" className="space-y-2" data-revise-resume-all>
        <p className="text-[14px]"><Link href={withStudy(reviseHref("today"), sid)} className={`font-semibold text-gray-900 underline underline-offset-2 ${focusRing}`}>Back to Today</Link></p>
        <h2 id="carry-h" className="text-[17px] font-bold text-gray-900">Carry on where you left off</h2>
        {carryOn.length === 0 ? <p className="text-[14px] text-gray-800">Nothing is unfinished.</p> : (
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl bg-[var(--cmp-app-surface)] ring-1 ring-gray-200">
            {carryOn.map(s => (
              <li key={s.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3.5 py-3">
                <div className="min-w-0 flex-1 basis-[14rem]">
                  <p className="break-words text-[14.5px] font-semibold text-gray-900">{s.title}</p>
                  <p className="text-[13px] text-gray-700">{s.total === null ? `${s.position} answered` : `${s.position} of ${s.total} answered`}, last worked on {shortDate(localDay(s.lastActiveAt, tz))}.</p>
                </div>
                <Link href={s.href} prefetch={false} className={toneAction.secondary}>Resume</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    ));
  }

  // ── the due cards, on their own: the one queue's "Review cards" ──
  if (q.review === "cards") {
    const cardViews: CardView[] = cards.ok ? cards.data.map(c => ({
      id: c.id, stem: c.question.stem, answer: answerText(c.question), rationale: c.question.rationale, quote: c.question.sourceQuote,
      citation: `${c.question.materialTitle}, ${c.question.ordinal !== null ? citeChunk({ ordinal: c.question.ordinal, pageFrom: c.question.pageFrom, pageTo: c.question.pageTo }, c.question.unit) : "source section"}`,
      href: sourceHref(c.question.materialId, c.question.chunkId),
    })) : [];
    return frame("today", (
      <section aria-labelledby="cards-h" className="space-y-2">
        <p className="text-[14px]"><Link href={withStudy(reviseHref("today"), sid)} className={`font-semibold text-gray-900 underline underline-offset-2 ${focusRing}`}>Back to Today</Link></p>
        <h2 id="cards-h" className="text-[17px] font-bold text-gray-900">Review cards due</h2>
        {!cards.ok ? (cards.notProvisioned
          ? <StatePanel title="Revision is not set up here yet"><p>The study store it needs has not been installed here.</p></StatePanel>
          : <Unreadable what="review cards" />)
          : <CardReview cards={cardViews} />}
      </section>
    ));
  }

  const planToday = view === "today" || view === "priorities" ? await loadToday(ctx, policy, { now, tz, today, readOnly: true }).catch(() => null) : null;
  const plan = planToday?.ok ? planToday : null;

  // ── Today ──
  if (view === "today") {
    const toFix = policy.scholarMistakeNotebook === "on" ? await mistakeToFixCount(ctx.admin, ctx.userId) : null;
    // SALE-2026-11 R2: due retrieval (SALE-08). Null while its key is off. Prerequisite reviews and transfer checks are in Insights.
    const retention = await loadRetentionView(ctx.admin, ctx.userId, policy, now.toISOString(), { today });
    const titles = new Map(mats.map(m => [m.id, m.title]));
    const dueNow = (retention?.schedule?.due ?? []).filter(i => i.suggestedOn <= today);
    const later = (retention?.schedule?.due ?? []).filter(i => i.suggestedOn > today);
    const planItems = (plan?.todayItems ?? []).filter(i => (i.kind === "planned" && !!i.href) || (i.kind === "personal" && i.occurrence?.entryType !== "busy" && i.occurrence?.entryType !== "placement"));
    const queue = buildTodayQueue({
      resume: carryOn.map(s => ({ ...s, lastActiveDay: localDay(s.lastActiveAt, tz) })), resumeAllHref: withStudy(reviseHref("today", { resume: "all" }), sid),
      dueCards: cards.ok ? cards.data.length : 0, dueCardsHref: withStudy(reviseHref("today", { review: "cards" }), sid),
      retrieval: dueNow.slice(0, 5).map(i => ({ key: i.topicKey, label: i.label, status: retrievalLine(i, today), why: i.reasons[0], more: [...i.reasons.slice(1), `Rules ${i.rules.join(", ")}.`], href: i.action.href, actionLabel: i.action.label, priorityFlag: i.flags.priority })),
      repeated: (insights?.repeatedDifficulties ?? []).map(d => ({ materialTitle: titles.get(d.materialId) ?? null })),
      weakOffered: policy.scholarRevisionModes.includes("weak"),
      mistakes: toFix?.ok ? toFix.data : null, mistakesHref: withStudy(studyHref("revise/mistakes"), sid),
      // The cards are already one row: a plan activity or suggestion about the same cards would only say it again.
      plan: planItems.filter(i => !planRefOfKey(i.key)?.startsWith("revise:due") && !/\b(flash)?cards?\b/i.test(i.title)).slice(0, 3).map(i => ({ key: i.key, title: i.title, why: `On your plan for today${i.minutes ? `, about ${i.minutes} min` : ""}.`, href: i.href ?? studyHref("plan") })),
      recommended: policy.scholarRevisionRecommendations === "on" ? (insights?.recommendations ?? []).filter(r => !["due", "spaced", "weak", "difficult"].includes(r.id)).slice(0, 1).map(r => ({
        key: r.id, title: r.title, why: r.reason,
        action: "learnSection" in r.action ? { kind: "link" as const, href: `${studyHref("learn")}?section=${r.action.learnSection}`, label: "Teach me this" } : { kind: "link" as const, href: withStudy(reviseHref("today", { practice: "1" }), sid), label: "Choose how" },
      })) : [],
      priorities: plan?.settings.priorities ?? [],
    });
    return frame("today", (
      <div className="space-y-4">
        {!rows.ok && <Unreadable what="your revision history" />}
        <TodayQueue items={queue}
          clear={<>{insights && insights.upcoming7 > 0 ? `${insights.upcoming7} ${insights.upcoming7 === 1 ? "card comes" : "cards come"} due in the next 7 days. ` : ""}You can revise anything you like below.</>} />
        {later.length > 0 && <p className="text-[13px] text-gray-700">{later.length} more {later.length === 1 ? "topic is" : "topics are"} placed on a later day, so today stays manageable. See them in <Link href={withStudy(reviseHref("insights"), sid)} className={toneAction.link}>Revision Insights</Link>.</p>}
        {(() => {
          // SCHOLAR-SESSION-AI-02: a study session's focus is chosen already, so the form opens on it, as it always has.
          const scope = revisePrefill(study?.scope ?? null, { materialIds: mats.map(m => m.id), competencyIds: (learner.competencies ?? []).map(c => c.id) });
          return startForm(!!scope, "Or choose how to revise", null, scope);
        })()}
      </div>
    ));
  }

  // ── My Priorities: the learner's own, from My Plan. Read here, changed only there ──
  if (view === "priorities") {
    const planHref = withStudy(studyHref("plan"), sid);
    if (!planToday?.ok) return frame("priorities", <StatePanel title="My Plan is not available here" actions={<Link href={withStudy(reviseHref("today"), sid)} className={toneAction.secondary}>Back to Today</Link>}><p>{planToday ? "Your priorities come from My Plan, which is not offered here." : "Your plan could not be read just now."} Revision itself is not affected.</p></StatePanel>);
    const s = planToday.settings, exam = s.examDate && s.examDate >= today ? s.examDate : null;
    return frame("priorities", (
      <div className="space-y-4" data-revise-priorities>
        <LearningSection tone="next" icon="target" title="What you are working towards" level={2} headingId="goal-h" caps={false}>
          {planToday.starting ? <p className={sectionLead}>You have not set a plan yet, so nothing here is yours to prioritise. <Link href={planHref} className={toneAction.link}>Set your goal and exam date in My Plan</Link></p> : (
            <dl className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="cmp-learn-box p-3"><dt className="text-[12.5px] font-semibold text-gray-700">Goal</dt><dd className="text-[14.5px] font-semibold text-gray-900">{s.goal ?? "None set"}</dd></div>
              <div className="cmp-learn-box p-3" data-revise-exam><dt className="text-[12.5px] font-semibold text-gray-700">{s.examLabel ?? "Exam or assessment"}</dt>
                <dd className="text-[14.5px] font-semibold text-gray-900">{exam ? `${shortDate(exam)}, ${daysLeftLabel(exam, today)}` : "No date set"}</dd></div>
            </dl>
          )}
          {s.priorities.length > 0 && (
            <>
              <h3 className="mt-3 text-[14px] font-bold text-gray-900">Your priority topics</h3>
              <ul className="mt-1.5 flex flex-wrap gap-2" data-revise-priority-topics>
                {s.priorities.map(p => <li key={p}><Link href={withStudy(reviseHref("today", { topic: p }), sid)} prefetch={false} className={toneAction.secondary}>{p}</Link></li>)}
              </ul>
            </>
          )}
          {!planToday.starting && <p className="mt-2 text-[13px]"><Link href={planHref} className={toneAction.link}>Change these in My Plan</Link></p>}
        </LearningSection>
        <LearningSection tone="summary" icon="clock" title="Coming up in the next 7 days" level={2} headingId="soon-h" caps={false}>
          {planToday.comingUp.length === 0 && !planToday.upcomingMonthlyReview ? <p className={sectionLead}>Nothing is scheduled. Add revision or a deadline in <Link href={planHref} className={toneAction.link}>My Plan</Link>.</p> : (
            <ul className="mt-2 divide-y divide-gray-100 overflow-hidden rounded-xl bg-[var(--cmp-app-surface)] ring-1 ring-gray-200">
              {planToday.upcomingMonthlyReview && <li className="px-3.5 py-2.5 text-[14px]"><Link href={planToday.upcomingMonthlyReview.startHref} className={toneAction.link}>Monthly review</Link><span className="text-[13px] text-gray-700"> · {planToday.upcomingMonthlyReview.late ? "Overdue" : shortDate(planToday.upcomingMonthlyReview.recommendedDate)}</span></li>}
              {planToday.comingUp.map(i => (
                <li key={i.key} className="px-3.5 py-2.5 text-[14px]">
                  {i.href ? <Link href={i.href} prefetch={false} className={toneAction.link}>{i.title}</Link> : <span className="font-semibold text-gray-900">{i.title}</span>}
                  <span className="text-[13px] text-gray-700"> · {shortDate(i.date)}{i.when ? ` · ${i.when}` : ""} · {i.label}</span>
                </li>
              ))}
            </ul>
          )}
        </LearningSection>
        {(planToday.next || planToday.alternatives.length > 0) && (
          <LearningSection tone="quickCheck" icon="compass" title="Suggestions" level={2} headingId="suggest-h" caps={false}>
            <p className={sectionLead}>From your plan and your records. Nothing here changes your plan unless you choose it there.</p>
            <ul className="mt-2 space-y-2">
              {[planToday.next, ...planToday.alternatives].filter((r): r is NonNullable<typeof r> => !!r).slice(0, 3).map(r => (
                <li key={r.ref} className="text-[14px]">{r.href ? <Link href={r.href} prefetch={false} className={toneAction.link}>{r.title}</Link> : <span className="font-semibold text-gray-900">{r.title}</span>}<span className="block text-[13px] text-gray-800">{r.why}</span></li>
              ))}
            </ul>
          </LearningSection>
        )}
      </div>
    ));
  }

  // ── Studied This Month ──
  if (view === "month") {
    if (!rows.ok || !materials.ok) return frame("month", <Unreadable what="your learning this month" />);
    const learning = await listLearningSessions(ctx.admin, ctx.userId, 100);
    const list = learning.ok ? learning.data : [];
    const steps = await sessionStepSummaries(ctx.admin, ctx.userId, list.map(s => s.id));
    const v = buildStudiedThisMonth({
      today, tz, materials: materials.data, questions: rows.data.questions, attempts: rows.data.attempts, reviews: rows.data.reviews, cards: rows.data.cards,
      sessions: list.map(s => ({ id: s.id, title: s.title, status: s.status, lastActiveAt: s.lastActiveAt, materialIds: steps.get(s.id)?.materialIds ?? [] })),
    });
    return frame("month", <StudiedMonthView v={v} today={today} />);
  }

  // ── All Topics ──
  if (view === "topics") {
    if (!rows.ok || !materials.ok) return frame("topics", <Unreadable what="your revision catalogue" />);
    const [topics, maps] = await Promise.all([libraryTopics(ctx.admin, ctx.userId), listMappings(ctx.admin, ctx.userId)]);
    const f = parseCatalogueFilters(q as Record<string, string | undefined>);
    const accepted = new Map<string, Set<string>>();
    if (maps.ok) for (const m of maps.data.mappings) if (m.state !== "rejected") { if (!accepted.has(m.materialId)) accepted.set(m.materialId, new Set()); accepted.get(m.materialId)!.add(m.competencyId); }
    const catalogue = buildCatalogue({
      today, tz, materials: materials.data, questions: rows.data.questions, attempts: rows.data.attempts, reviews: rows.data.reviews, cards: rows.data.cards,
      topicsOf: id => materialTopics(topics?.get(id) ?? []).map(t => t.topic), competenciesOf: id => [...(accepted.get(id) ?? [])],
    });
    const shown = filterCatalogue(catalogue, f);
    const allTopics = [...new Set(catalogue.flatMap(r => r.topics))].sort((a, b) => a.localeCompare(b)).slice(0, 200);
    const compIds = [...new Set(catalogue.flatMap(r => r.competencyIds))];
    const compNames = compIds.length ? await competencyLabels(ctx.admin, learner.competencies, compIds, new Map()) : new Map();
    const field = `w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-[14px] text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
    const page = Math.min(f.page, shown.pages);
    const pageHref = (n: number) => reviseHref("topics", { q: f.q, m: f.material, t: f.topic, c: f.competency, status: f.status, from: f.from, page: n > 1 ? String(n) : null, study: sid });
    return frame("topics", (
      <section aria-labelledby="topics-h" className="cmp-learn-sources space-y-3">
        <h2 id="topics-h" className="text-[18px] font-bold text-gray-900">All topics</h2>
        <form method="get" action={studyHref("revise")} className="space-y-2" role="search">
          <input type="hidden" name="view" value="topics" />
          {sid && <input type="hidden" name="study" value={sid} />}
          <div className="flex gap-2">
            <input name="q" defaultValue={f.q} aria-label="Search your topics and materials" placeholder="Search your topics and materials" className={field} />
            <button type="submit" className={`${toneAction.primary} shrink-0`}>Search</button>
          </div>
          <details open={hasCatalogueFilters(f) && !f.q} className="text-[13.5px]" suppressHydrationWarning>
            <summary className={`cursor-pointer font-semibold text-gray-800 pointer-coarse:py-3.5 ${focusRing}`}>Filters</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <label className="block text-[12.5px] font-semibold text-gray-700">Material<select name="m" defaultValue={f.material ?? ""} className={`${field} mt-0.5 font-normal`}><option value="">Any</option>{mats.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select></label>
              <label className="block text-[12.5px] font-semibold text-gray-700">Topic<select name="t" defaultValue={f.topic ?? ""} className={`${field} mt-0.5 font-normal`}><option value="">Any</option>{allTopics.map(t => <option key={t} value={t}>{t}</option>)}</select></label>
              <label className="block text-[12.5px] font-semibold text-gray-700">Competency<select name="c" defaultValue={f.competency ?? ""} className={`${field} mt-0.5 font-normal`}><option value="">Any</option>{compIds.map(id => <option key={id} value={id}>{compNames.get(id)?.title ?? "A competency"}</option>)}</select></label>
              <label className="block text-[12.5px] font-semibold text-gray-700">Review status<select name="status" defaultValue={f.status ?? ""} className={`${field} mt-0.5 font-normal`}><option value="">Any</option>{CATALOGUE_STATUSES.map(st => <option key={st} value={st}>{CATALOGUE_STATUS_LABEL[st]}</option>)}</select></label>
              <label className="block text-[12.5px] font-semibold text-gray-700">Studied since<input type="date" name="from" defaultValue={f.from ?? ""} className={`${field} mt-0.5 font-normal`} /></label>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3"><button type="submit" className={toneAction.secondary}>Apply filters</button>{hasCatalogueFilters(f) && <Link href={reviseHref("topics", { study: sid })} className={toneAction.link}>Clear</Link>}</div>
          </details>
        </form>
        <p className="text-[13px] text-gray-700" role="status">{shown.total} {shown.total === 1 ? "material" : "materials"}, oldest learning included.</p>
        {shown.rows.length === 0 ? <p className="rounded-xl bg-[var(--cmp-app-surface)] p-4 text-[14px] text-gray-800 ring-1 ring-gray-200">Nothing matches. Try fewer words or clear the filters.</p> : (
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl bg-[var(--cmp-app-surface)] ring-1 ring-gray-200">{shown.rows.map(r => <CatalogueRowView key={r.materialId} r={r} />)}</ul>
        )}
        {shown.pages > 1 && <nav aria-label="Pages" className="flex items-center justify-between text-[13.5px]">{page > 1 ? <Link href={pageHref(page - 1)} className={toneAction.link}>Previous</Link> : <span />}<span className="text-gray-700">Page {page} of {shown.pages}</span>{page < shown.pages ? <Link href={pageHref(page + 1)} className={toneAction.link}>Next</Link> : <span />}</nav>}
        <details className="rounded-xl bg-[var(--cmp-app-surface)] p-3.5 ring-1 ring-gray-200" suppressHydrationWarning data-revise-sets>
          <summary className={`cursor-pointer text-[14px] font-semibold text-gray-900 pointer-coarse:py-3.5 ${focusRing}`}>Saved revision sets{sets.ok ? ` (${sets.data.length})` : ""}</summary>
          <p className="mt-1 text-[13px] text-gray-700">Revising a saved set again uses its stored questions and answers: no new AI, so it is always available.</p>
          {!sets.ok ? (sets.notProvisioned ? <p className="mt-2 text-[13.5px] text-gray-800">Saved sets are not available here yet.</p> : <Unreadable what="saved revision sets" />)
            : sets.data.length === 0 ? <p className="mt-2 text-[13.5px] text-gray-800">None yet. After a session, you can save its questions as a set.</p>
              : <SavedSets sets={sets.data.map(s => ({ id: s.id, title: s.title, questions: s.questionIds.length, lastUsedAt: s.lastUsedAt }))} />}
        </details>
      </section>
    ));
  }

  // ── Revision Insights: the detail, apart ──
  const retentionAll = await loadRetentionView(ctx.admin, ctx.userId, policy, now.toISOString(), { today });
  const compNames = insights?.competencyActivity.length
    ? await competencyLabels(ctx.admin, learner.competencies, insights.competencyActivity.map(c => c.competencyId), new Map()) : new Map();
  return frame("insights", (
    <div className="space-y-4" data-revise-insights>
      <h2 className="text-[18px] font-bold text-gray-900">How your revision is going</h2>
      <p className="max-w-[68ch] text-[13px] leading-relaxed text-gray-700">From your own answers and reviews. Revision is practice: none of this is an assessment or evidence of competence.</p>
      <p className="text-[13.5px]"><Link href={flashcardsHref({ view: "history" })} className={toneAction.link}>Open Revision History</Link></p>
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
          <dl className="cmp-learn-summary grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label="Cards due now" value={String(insights.due)} />
            <Stat label="Due in the next 7 days" value={String(insights.upcoming7)} />
            <Stat label={`Reviews, last ${policy.scholarInsightWindowDays} days`} value={insights.completedReviews.state === "measured" ? String(insights.completedReviews.reviews) : "Not measured"} note={insights.completedReviews.state === "measured" ? null : insights.completedReviews.reason} />
            <Stat label="Recall" value={insights.recall.state === "measured" ? `${insights.recall.recalledShare}%` : insights.recall.state === "insufficient" ? "Not enough yet" : "Not measured"}
              note={insights.recall.state === "measured" ? `of ${insights.recall.reviews} reviews graded Okay or better` : insights.recall.state === "insufficient" ? `${insights.recall.have} of ${insights.recall.need} reviews needed` : insights.recall.reason} />
            <Stat label="Materials revised" value={`${insights.coverage.revised} of ${insights.coverage.of}`} />
            <Stat label="Answers marked" value={`${insights.marking.deterministic + insights.marking.self_graded + insights.marking.ai_evaluation}`}
              note={`by code ${insights.marking.deterministic} · by you ${insights.marking.self_graded} · by AI evaluation ${insights.marking.ai_evaluation}`} />
          </dl>
          {retentionAll && <RetentionPanel v={retentionAll} />}
          <div className="grid gap-4 lg:grid-cols-2">
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
            {policy.scholarAdaptiveExams === "on" && (
              <LearningSection tone="check" icon="question" title="Adaptive exams" level={2} headingId="adaptive-h" caps={false}>
                <details className="mt-1" suppressHydrationWarning><summary className={`cursor-pointer text-[13px] font-semibold text-gray-800 pointer-coarse:py-3.5 ${focusRing}`}>How it adapts</summary><p className="mt-1 text-[13px] text-gray-800">{ADAPTIVE_HELP} {ADAPTIVE_RULE}</p></details>
                <Link href={withStudy(adaptiveHref(), sid)} className={`mt-2 ${toneAction.secondary}`}>Set up an adaptive exam</Link>
              </LearningSection>
            )}
          </div>
        </>
      )}
      {papers}
    </div>
  ));
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
