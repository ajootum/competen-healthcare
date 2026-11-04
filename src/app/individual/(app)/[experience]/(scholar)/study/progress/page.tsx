import Link from "next/link";
import { headers } from "next/headers";
import { learnerTimeZone, learnerToday } from "@/lib/individual/scholar/learning-definitions";
import type { Metadata } from "next";
import { loadStudy } from "@/lib/individual/scholar/study-context";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { experienceHref } from "@/lib/individual/experiences";
import { listPassportChoices, progressRows, reviewRows } from "@/lib/individual/scholar/store";
import { loadLearningIntelligence } from "@/lib/individual/scholar/intelligence-data";
import LearningIntelligence from "../_components/LearningIntelligence";
import { eligibleAchievements } from "@/lib/individual/scholar/passport-items";
import { isStudyPlanOn, loadIndividualPolicy } from "@/lib/individual/policy";
import { EVIDENCE_LABEL } from "@/lib/individual/passport";
import { PassportChoices } from "../_components/passport-choice";
import { buildProgress } from "@/lib/individual/scholar/progress";
import { SELF_DIRECTED_LABEL } from "@/lib/individual/scholar/config";
import { Notice, PageHeader, StatePanel, Unreadable, focusRing } from "../../../../../_components/chrome";
import StudyNav from "../_components/StudyNav";
import { FORMATIVE_NOTICE, scholarSpace } from "@/lib/individual/scholar/spaces";
import { LearningActivity, ProgressWorkspace } from "../_components/progress-view";
import { loadProgress } from "@/lib/individual/scholar/progress-data";
import type { PeriodKind } from "@/lib/individual/scholar/progress-history";
import { competencyProgressRows } from "@/lib/individual/scholar/store";
import { listProgrammes } from "@/lib/individual/scholar/store";
import { topicPractice, type TopicPractice } from "@/lib/individual/scholar/classify-view";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { CompetencySection } from "../_components/competency-section";
import { buildCompetencyProgress } from "@/lib/individual/scholar/competency-progress";
import { learningActivityByCompetency } from "@/lib/individual/scholar/store";
import { loadTopicProgress, mergeStudyNext, topicProgressEnabled } from "@/lib/individual/scholar/study-next";
import { isStudyId } from "@/lib/individual/scholar/study-carry";
import { StudyNextCard, TopicProgressSection } from "../_components/topic-progress-view";
import { LearningStateSection } from "../_components/learning-state-view";
import { loadLearningState, readStateInputs } from "@/lib/individual/scholar/learning-state-data";
import { loadRetentionView, withRetrieval } from "@/lib/individual/scholar/retention-data";
import { Fold, NotMeasuredLine } from "../_components/progress-parts";
import { activitySummary, enoughForTrend, listSummary, practisedDetail, TREND_NEEDS, withoutEngagementInsight, type ActivitySummary } from "@/lib/individual/scholar/progress-simplify";
import { getStudyPlan, studyPlanSchema } from "@/lib/individual/scholar/store";
import { buildStudyPlan, unstartedMappedSections } from "@/lib/individual/scholar/study-plan";
import { StudyPlanCard } from "../_components/study-plan-card";
import { StudyCalendar } from "../_components/study-calendar";
import { LastMonthlyReview, MonthlyBanner } from "../_components/monthly-progress";
import { loadStudyCalendar, monthFromQuery } from "@/lib/individual/scholar/study-calendar-data";
import { loadMonthlyOverview, monthlyReviewOn } from "@/lib/individual/scholar/monthly-review-data";
import { nextMonth, prevMonth, monthOf, weakTopics, type MonthlyBreakdown } from "@/lib/individual/scholar/monthly-review";
import { getEvaluation } from "@/lib/individual/scholar/store";

/**
 * P6 Option A: practice by TOPIC -- the topics Classify found in the sections, and practice on those sections. It needs
 * no programme or catalogue, so it reads well where none is configured. Practice, never knowledge or competence.
 */
function TopicSection({ topics, unreadable, accent }: { topics: TopicPractice[] | null; unreadable: boolean; accent: string }) {
  if (!topics && !unreadable) return null;
  return (
    <section aria-labelledby="topics-h" className="mt-8">
      <h2 id="topics-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">By topic</h2>
      <p className="mt-1 text-[13px] text-gray-600">The topics Scholar found in your notes, and your practice on the sections they appear in.</p>
      <div className="mt-3">
        {unreadable ? <Unreadable what="practice by topic" />
          : !topics?.length ? (
            <StatePanel title="No topics found yet">
              <p>Topics appear once Scholar has looked at a material, which it does with AI help on. Open a material to see what it found.</p>
            </StatePanel>
          ) : (
            <Fold summary={listSummary({ one: "topic" }, topics.length, practisedDetail(topics.filter(t => t.answered > 0).length, topics.length))}>
            <ul className="divide-y divide-gray-200">
              {topics.map(t => (
                <li key={t.name} className="flex flex-wrap items-baseline justify-between gap-2 p-4">
                  <span className="min-w-0">
                    <span className="block text-[14.5px] font-semibold text-gray-900">{t.name}</span>
                    <span className="text-[12.5px] text-gray-600">{t.sections} section{t.sections === 1 ? "" : "s"} · {t.questions} practice question{t.questions === 1 ? "" : "s"}</span>
                  </span>
                  <span className="flex items-baseline gap-3 text-[13px]">
                    {t.answered === 0 ? <span className="font-semibold text-gray-500">Not practised yet</span>
                      : <span className="font-semibold tabular-nums text-gray-900">{t.rightLatest} of {t.answered} right on the latest try</span>}
                    <Link href={experienceHref("scholar", `study/learn?topic=${encodeURIComponent(t.name)}`)} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: accent }}>Learn</Link>
                  </span>
                </li>
              ))}
            </ul>
            </Fold>
          )}
      </div>
    </section>
  );
}

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// IMPROVE -- COMPETEN-IND-004 s6. Per-material mastery, cards due and the weekly trend, built from the
// person's own rows (src/lib/individual/scholar/progress.ts).
//
// ⚠ SELF-DIRECTED STUDY, AND LABELLED SO. Nothing here is verified, assessed or visible to an employer.
// Nothing reaches the Passport unless the person chooses it, one achievement at a time, in "Your Passport"
// below (migration 375). What can be chosen is a count of practice answered, never accuracy.
// ⚠ NOT MEASURED IS SHOWN AS NOT MEASURED. A material with no answers has no mastery figure, and a week
// with no answers has no accuracy bar -- never a 0.

// The title only when Individual is live: with the release gate off, a 404 must not name the route.
export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Progress" });
}

const fmtWeek = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export default async function ProgressPage({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<{ period?: string; study?: string; month?: string }> }) {
  const sp = await searchParams;
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const [rows, reviews] = await Promise.all([progressRows(ctx.admin, ctx.userId), reviewRows(ctx.admin, ctx.userId)]);
  // PLP-01..04: today is the learner's own local day (x-vercel-ip-timezone, UTC when absent), the same one My Plan uses.
  const hdrs = await headers();
  const tz = learnerTimeZone(hdrs);
  const today = learnerToday(hdrs);
  const policy = await loadIndividualPolicy(ctx.admin);
  // SCHOLAR-SESSION-AI-02: an open study session is carried by the tabs (Progress is not a stage of it).
  const study = await loadStudy(ctx.admin, ctx.userId, sp.study, null, policy);
  // COMPETEN-SCHOLAR-01 S5: the four measures, from the rows already read (nothing is read twice).
  const li = rows.ok ? await loadLearningIntelligence(ctx.admin, ctx.userId, policy, today, { pre: { rows, reviews }, tz }) : null;
  const reviewRefs = reviews.ok && reviews.data ? reviews.data : [];
  const p = rows.ok ? buildProgress({ ...rows.data, today }) : null;
  const choices = rows.ok ? await listPassportChoices(ctx.admin, ctx.userId) : null;
  const allEligible = rows.ok && choices?.ok ? eligibleAchievements({ ...rows.data, choices: choices.data, reviews: reviewRefs }) : [];
  // Which kinds may be newly chosen is Individual policy (COMPETEN-CONFIG-002). One already chosen stays listed,
  // so the person can still see it and take it off: switching a kind off never rewrites their Passport.
  const offered = new Set<string>(policy.passportAchievementKinds);
  const eligible = allEligible.filter(a => a.chosenLabel !== null || offered.has(a.achievement));

  // COMPETEN-SCHOLAR-01 S4: progress by competency, through the catalogue interface. Absent where 387/388
  // are not applied (fail closed). Unreadable is said, never shown as an empty list.
  const learner = rows.ok ? await loadLearnerCatalogue(ctx.admin, ctx.userId) : null;
  // P6: the same rows feed practice by TOPIC, which needs no programme -- so they are read whenever 387/388 exist.
  const allRows = learner?.provisioned ? await competencyProgressRows(ctx.admin, ctx.userId) : null;
  const cRows = learner?.provisioned && learner.programme && learner.competencies ? allRows : null;
  const topics = allRows?.ok ? topicPractice(allRows.data.concepts, allRows.data.questions, allRows.data.attempts) : null;
  const programmes = learner?.provisioned && !learner.programme ? await listProgrammes(ctx.admin) : null;
  const programmesOffered = programmes ? (programmes.ok ? programmes.data.length : null) : null;
  const cp = cRows?.ok && learner?.competencies
    ? buildCompetencyProgress({
      competencies: learner.competencies,
      mappings: cRows.data.mappings.map(m => ({ competencyId: m.competencyId, chunkId: m.chunkId, state: m.state })),
      questions: cRows.data.questions, attempts: cRows.data.attempts,
    })
    : null;
  const cUnreadable = !!learner?.programme && (learner.competencies === null || (cRows !== null && !cRows.ok));
  // LEARN-01 L4: learning activity per competency, read from the structured history (null where 414 is absent).
  const activity = cp ? await learningActivityByCompetency(ctx.admin, ctx.userId) : null;
  // PROGRESS-01 (Stage 8): one read of the evidence for the workspace. No AI.
  const period: PeriodKind = sp.period === "week" || sp.period === "month" || sp.period === "programme" ? sp.period : policy.scholarProgressPeriod;
  const pv = rows.ok && p && p.materials.length > 0 ? await loadProgress(ctx.admin, ctx.userId, policy, new Date().toISOString(), { period, tz }) : null;
  // SCHOLAR-COMPANION-01 P1: "Study next" and learning progress by topic, from the same rows plus one bounded evidence read.
  // No AI. Gated by an option of scholar_progress_sections (topicProgressEnabled). Merged with Learning Intelligence's recommendations:
  // the ones the card already says (same place, or covered) are dropped from its own list below.
  const showTopicProgress = topicProgressEnabled(policy);
  // SCHOLAR-COMPANION-01 (780): the study plan. On only where HQ switched it on AND 780 is present (fails closed). It reads the same topic evidence.
  const planOn = policy.scholarStudyPlan && isStudyPlanOn(policy, await studyPlanSchema(ctx.admin, ctx.userId));
  const planRead = planOn ? await getStudyPlan(ctx.admin, ctx.userId) : null;
  // PLP-01..04: where My Plan is on, the plan card and the calendar live in My Plan (this page links there); where it is off, Progress is unchanged.
  const myPlan = planOn && policy.scholarMyPlan === "on";
  const tp = (showTopicProgress || (planRead?.ok === true && !myPlan)) && rows.ok && p && p.materials.length > 0
    ? await loadTopicProgress(ctx.admin, ctx.userId, policy, new Date().toISOString(), {
      materials: rows.data.materials,
      linked: allRows?.ok ? { mappings: allRows.data.mappings, concepts: allRows.data.concepts } : null,
      competencies: learner?.programme && learner.competencies ? learner.competencies.map(c => ({ id: c.id, title: c.title })) : null,
      studyId: study && isStudyId(sp.study) ? sp.study : null,
    })
    : null;
  // SALE-2026-11 R1 (SALE-04): the learning state per topic, from the same evidence read (request-cached) plus the learning events. No AI, nothing stored.
  // SALE-2026-11 R2: the same join feeds due retrieval (SALE-08), prerequisite reviews (SALE-09) and transfer offers (SALE-10), each behind its own key (default off).
  const stateSources = rows.ok && p && p.materials.length > 0 ? { materials: rows.data.materials, concepts: allRows?.ok ? allRows.data.concepts : null } : null;
  const r2On = policy.scholarRetrievalSchedule === "on" || policy.scholarPrerequisiteSuggestions === "on" || policy.scholarTransferChecks === "on";
  const stateInputs = stateSources && (policy.scholarLearningState === "on" || r2On) ? await readStateInputs(ctx.admin, ctx.userId, policy, new Date().toISOString(), stateSources).catch(() => null) : null;
  const ls = policy.scholarLearningState === "on" && stateSources
    ? await loadLearningState(ctx.admin, ctx.userId, policy, new Date().toISOString(), { ...stateSources, inputs: stateInputs?.ok ? stateInputs.data : undefined }).catch(() => null)
    : null;
  const retention = stateSources && r2On && stateInputs?.ok ? await loadRetentionView(ctx.admin, ctx.userId, policy, new Date().toISOString(), { today, sources: stateSources, inputs: stateInputs.data }) : null;
  const ownNext = tp?.ok ? withRetrieval(tp.data.studyNext, retention?.schedule ?? null) : [];
  // SCHOLAR-MONTHLY-REVIEW-01: the study calendar (one calendar, extending the plan) and the monthly review's banner and last-result card.
  // The calendar reads the plan the card above is built from; both fail closed, and an unreadable one is said, never drawn empty.
  const calendarOn = policy.scholarStudyCalendar === "on" && !myPlan;
  const calMonth = monthFromQuery(sp.month, today);
  const calPlan = planRead?.ok && planRead.data && tp?.ok
    ? {
      settings: { examDate: planRead.data.examDate, examLabel: planRead.data.examLabel, weeklyMinutes: planRead.data.weeklyMinutes, daysPerWeek: planRead.data.daysPerWeek, goal: planRead.data.goal, priorities: planRead.data.priorities },
      entries: tp.data.topics, studyId: study && isStudyId(sp.study) ? sp.study : null,
      unstarted: allRows?.ok && learner?.programme && learner.competencies
        ? unstartedMappedSections({ mappings: allRows.data.mappings, concepts: allRows.data.concepts, questions: allRows.data.questions, attempts: allRows.data.attempts, competencies: learner.competencies.map(c => ({ id: c.id, title: c.title })) })
        : [],
    }
    : null;
  const calendar = calendarOn && rows.ok ? await loadStudyCalendar({ admin: ctx.admin, userId: ctx.userId, policy, month: calMonth, today, plan: calPlan }) : null;
  const monthlyOverview = rows.ok && monthlyReviewOn(policy) ? await loadMonthlyOverview(ctx.admin, ctx.userId, policy, today) : null;
  const lastReview = monthlyOverview?.latest ? await getEvaluation(ctx.admin, ctx.userId, monthlyOverview.latest.id) : null;
  const lastBreakdown = lastReview?.ok && lastReview.data ? (lastReview.data.results?.monthly as MonthlyBreakdown | undefined) : undefined;
  const calHref = (m: string | null) => {
    const q = new URLSearchParams();
    if (sp.period) q.set("period", sp.period);
    if (sp.study) q.set("study", sp.study);
    if (m && m !== monthOf(today)) q.set("month", m);
    const s = q.toString();
    return s ? `?${s}` : "?";
  };

  const merged = showTopicProgress && !myPlan && tp?.ok && li?.ok ? mergeStudyNext(ownNext, li.data.recommendations, 5, study && isStudyId(sp.study) ? sp.study : null) : null;
  // What to do next lives in My Plan when it is on: Learning Intelligence keeps its measures and does not repeat the list.
  const liBase = li?.ok ? { ...li.data, insights: withoutEngagementInsight(li.data.insights) } : null;
  const liShown = liBase ? (myPlan ? { ...liBase, recommendations: [] } : merged ? { ...liBase, recommendations: merged.rest } : liBase) : null;
  // ONE learning-activity block, from the shared definition of a study day (the workspace's engagement, and Learning Intelligence's active weeks).
  const liEng = li?.ok && li.data.engagement.state === "measured" ? li.data.engagement : null;
  const learnActivity: ActivitySummary | null = pv?.ok && policy.scholarProgressSections.includes("engagement")
    ? activitySummary(pv.engagement, liEng ? { activeWeeks: liEng.activeWeeks, weeks: liEng.weeks } : null)
    : !pv?.ok && liEng
      ? activitySummary({ windowDays: liEng.windowDays, studyDays: liEng.studyDays, answers: liEng.answered, reviews: liEng.reviews, decisions: null, checks: null, lastStudied: liEng.lastStudied }, { activeWeeks: liEng.activeWeeks, weeks: liEng.weeks })
      : null;

  return (
    <>
      <PageHeader accent={x.accent} eyebrow={scholarSpace("progress").eyebrow} title="Progress" intro={scholarSpace("progress").intro} />
      <StudyNav dueCount={p?.totals.cardsDue ?? null} study={study?.bar ?? null} />
      <Notice>
        {FORMATIVE_NOTICE} · <span className="font-semibold">{SELF_DIRECTED_LABEL}</span> This is observed practice on your own notes, not an assessment of competence and not verified competence: that is decided only by an independently governed assessment. None of it is added to your Passport or shared with anyone unless you choose an achievement below.
      </Notice>

      {!rows.ok ? (rows.notProvisioned
        ? <StatePanel title="Progress is not set up here yet"><p>The study store it needs has not been installed here.</p></StatePanel>
        : <Unreadable what="study progress" />)
        : p && p.materials.length === 0 ? (
          <StatePanel title="Nothing to measure yet">
            <p>Progress appears once you have uploaded material and answered questions from it.</p>
            <p><Link href={experienceHref("scholar", "study")} className={`font-semibold underline ${focusRing}`} style={{ color: x.accent }}>Go to your materials</Link></p>
          </StatePanel>
        ) : p && (
          <>
            {/* PROGRESS-01 (Stage 8 of 8): the learning command centre, above the detail by material. */}
            {myPlan ? (
              <Link href={experienceHref("scholar", "study/plan")} data-testid="plan-moved"
                className={`mb-6 flex min-h-[44px] items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-5 py-3 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
                <span className="text-[14.5px] font-semibold text-gray-900">Your plan, calendar and what to study next are in My Plan</span>
                <span className="text-[13px] font-semibold underline underline-offset-2" style={{ color: x.accent }}>Open My Plan</span>
              </Link>
            ) : (<>
            {planRead?.ok ? (tp?.ok
              ? <StudyPlanCard
                accent={x.accent} today={today} topics={tp.data.topics.map(t => ({ label: t.label }))}
                settings={planRead.data ? { examDate: planRead.data.examDate, examLabel: planRead.data.examLabel, weeklyMinutes: planRead.data.weeklyMinutes, daysPerWeek: planRead.data.daysPerWeek, goal: planRead.data.goal, priorities: planRead.data.priorities } : null}
                result={planRead.data ? buildStudyPlan({
                  plan: { examDate: planRead.data.examDate, examLabel: planRead.data.examLabel, weeklyMinutes: planRead.data.weeklyMinutes, daysPerWeek: planRead.data.daysPerWeek, goal: planRead.data.goal, priorities: planRead.data.priorities },
                  entries: tp.data.topics, dueCards: p.totals.cardsDue, today, studyId: study && isStudyId(sp.study) ? sp.study : null,
                  unstarted: allRows?.ok && learner?.programme && learner.competencies
                    ? unstartedMappedSections({ mappings: allRows.data.mappings, concepts: allRows.data.concepts, questions: allRows.data.questions, attempts: allRows.data.attempts, competencies: learner.competencies.map(c => ({ id: c.id, title: c.title })) })
                    : [],
                }) : null} />
              : <div className="mb-6"><Unreadable what="your study plan" /></div>)
              : planRead ? (planRead.notProvisioned ? null : <div className="mb-6"><Unreadable what="your study plan" /></div>) : null}
            </>)}
            {monthlyOverview && monthlyOverview.nudges.length > 0 && !monthlyOverview.optedOut && (
              <MonthlyBanner nudges={monthlyOverview.nudges.map(n => ({ month: n.month, recommended: n.recommended, late: n.late }))} evaluateHref={experienceHref("scholar", "study/evaluate")} />
            )}
            {monthlyOverview?.latest && lastBreakdown && !monthlyOverview.optedOut && (
              <LastMonthlyReview
                resultsHref={experienceHref("scholar", `study/evaluate/${monthlyOverview.latest.id}`)} evaluateHref={experienceHref("scholar", "study/evaluate")}
                last={{
                  id: monthlyOverview.latest.id, month: monthlyOverview.latest.month, createdAt: monthlyOverview.latest.createdAt, late: monthlyOverview.latest.late,
                  retakes: monthlyOverview.latestRetakes,
                  score: lastBreakdown.overall.percent !== null ? { correct: lastBreakdown.overall.correct, answered: lastBreakdown.overall.answered } : null,
                  weak: weakTopics(lastBreakdown, 3),
                }} />
            )}
            {calendarOn && (calendar
              ? <StudyCalendar view={calendar.view} accent={x.accent} prevHref={calHref(prevMonth(calMonth))} nextHref={calHref(nextMonth(calMonth))} todayHref={calHref(null)} />
              : <div className="mb-6"><Unreadable what="your study calendar" /></div>)}
            {showTopicProgress && !myPlan && (tp?.ok ? <StudyNextCard items={merged ? merged.items : ownNext} accent={x.accent} />
              : tp ? <div className="mb-6"><Unreadable what="what to study next" /></div> : null)}
            {pv?.ok ? <ProgressWorkspace v={pv} sections={policy.scholarProgressSections} period={period} activity={learnActivity} hideNext={myPlan} />
              : pv ? <StatePanel title="Your learning progress could not be read just now"><p>{pv.error} The detail below is still shown.</p></StatePanel> : null}
            {!pv?.ok && learnActivity && <div className="mb-6"><LearningActivity a={learnActivity} /></div>}
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { k: "Questions answered", v: `${p.totals.answered} of ${p.totals.questions}` },
                { k: "Answers given", v: String(p.totals.attempts) },
                { k: "Cards due now", v: String(p.totals.cardsDue) },
                { k: "Cards on long intervals", v: `${p.totals.cardsLongInterval} of ${p.totals.cardsActive + p.totals.cardsLongInterval}` },
              ].map(s => (
                <div key={s.k} className="rounded-2xl border border-gray-200 bg-white p-4">
                  <dt className="text-[12.5px] font-semibold text-gray-500">{s.k}</dt>
                  <dd className="mt-1 text-[22px] font-bold text-gray-900 tabular-nums">{s.v}</dd>
                </div>
              ))}
            </dl>

            <TopicSection topics={topics} unreadable={!!allRows && !allRows.ok} accent={x.accent} />
            <CompetencySection learner={learner} progress={cp} coverage={li?.ok ? li.data.coverage : null} unreadable={cUnreadable} accent={x.accent} activity={activity} offered={programmesOffered} />

            {showTopicProgress && tp?.ok && <TopicProgressSection m={tp.data} />}
            {ls?.ok && rows.ok && <LearningStateSection states={ls.data} concepts={allRows?.ok ? allRows.data.concepts : null} materials={new Map(rows.data.materials.map(m => [m.id, m.title]))} retention={retention} accent={x.accent} />}

            {liShown ? <LearningIntelligence li={liShown} accent={x.accent} /> : <div className="mt-8"><Unreadable what="learning intelligence" /></div>}

            <section aria-labelledby="accuracy-h" className="mt-8">
              <h2 id="accuracy-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">By material</h2>
              <p className="mt-1 text-[13px] text-gray-600">Practice accuracy is the share of a material&apos;s AI-written practice questions you got right the last time you answered them.</p>
              <div className="mt-3 space-y-3">
                {!p.materials.some(m => m.latestAccuracy !== null) && <NotMeasuredLine text="No material has a practice accuracy yet. It appears once you have answered its questions." />}
                <Fold summary={listSummary({ one: "material" }, p.materials.length, practisedDetail(p.materials.filter(m => m.latestAccuracy !== null).length, p.materials.length))}>
                  <ul className="divide-y divide-gray-200">
                    {p.materials.map(m => (
                      <li key={m.id} className="p-4 sm:p-5">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <Link href={experienceHref("scholar", `study/${m.id}`)} className={`text-[15px] font-semibold text-gray-900 underline-offset-2 hover:underline ${focusRing}`}>{m.title}</Link>
                          {m.latestAccuracy !== null && <span className="text-[14px] font-bold tabular-nums" style={{ color: x.accent }}>{`${m.latestAccuracy}% practice accuracy`}</span>}
                        </div>
                        {m.latestAccuracy !== null && (
                          <div className="mt-2 h-2 rounded-full bg-gray-100" role="img" aria-label={`${m.latestAccuracy}% practice accuracy`}>
                            <div className="h-2 rounded-full" style={{ width: `${m.latestAccuracy}%`, background: x.accent }} />
                          </div>
                        )}
                        <p className="mt-2 text-[12.5px] text-gray-600 tabular-nums">
                          {m.questions === 0 ? "No questions written yet" : `${m.answered} of ${m.questions} question${m.questions === 1 ? "" : "s"} answered${m.latestCorrect !== null ? `, ${m.latestCorrect} right on the latest try` : ""}`}
                          {" · "}{m.cardsDue} card{m.cardsDue === 1 ? "" : "s"} due · {m.cardsLongInterval} on long intervals
                        </p>
                      </li>
                    ))}
                  </ul>
                </Fold>
              </div>
            </section>

            <section aria-labelledby="passport-h" className="mt-8">
              <h2 id="passport-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Your Passport</h2>
              <p className="mt-1 text-[13px] text-gray-600">
                You can choose to show what you have practised in your Competen Passport, one achievement at a time. It is labelled
                &ldquo;{EVIDENCE_LABEL.self_directed}&rdquo;. Only the title you give it, the number you answered and when you last studied are shown. Your notes, your answers, whether they were right and anything the AI wrote are never shown.
                Choosing it only puts it on your Passport. It reaches someone else only if you tick it on a Passport link you share (from the Share page in Scholar, or in Competen Professional), and only on that link: links you made before do not show it. Removing it takes it off your Passport and off any link that carries it, and your study history stays as it is.
              </p>
              {!choices?.ok ? (choices?.notProvisioned
                ? <p className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-[14px] text-gray-600">Showing study achievements in your Passport is not available here yet.</p>
                : <div className="mt-3"><Unreadable what="Passport choices" /></div>)
                : eligible.length === 0 && allEligible.length > 0 ? (
                  <p className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-[14px] text-gray-600">Adding study achievements to your Passport is not offered at the moment. Your study history is unchanged.</p>
                ) : eligible.length === 0 ? (
                  <p className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-[14px] text-gray-600">Nothing to show yet. Answer multiple-choice, multiple-response, matching or sequencing questions, or scenarios, from a material and it can be shown here. Written answers marked by the AI or by you stay private feedback and are not counted.</p>
                ) : <PassportChoices items={eligible} />}
            </section>

            {enoughForTrend(p.trend.map(w => w.attempts)) ? (
            <section aria-labelledby="trend-h" className="mt-8">
              <h2 id="trend-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Last 8 weeks</h2>
              <p className="mt-1 text-[13px] text-gray-600">Answers given each week, and the share that were right. A week with no answers has no bar.</p>
              <table className="mt-3 w-full overflow-hidden rounded-2xl border border-gray-200 bg-white text-left text-[13.5px]">
                <caption className="sr-only">Answers and accuracy by week</caption>
                <thead className="bg-gray-50 text-[12px] font-semibold text-gray-600">
                  <tr><th scope="col" className="px-3 py-2">Week of</th><th scope="col" className="px-3 py-2 text-right">Answers</th><th scope="col" className="px-3 py-2">Right</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {p.trend.map(w => (
                    <tr key={w.weekStart}>
                      <th scope="row" className="whitespace-nowrap px-3 py-2 font-medium text-gray-800">{fmtWeek(w.weekStart)}</th>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-800">{w.attempts}</td>
                      <td className="w-1/2 px-3 py-2">
                        {w.accuracy === null ? <span className="text-gray-400">No answers</span> : (
                          <div className="flex items-center gap-2">
                            <div className="h-2 flex-1 rounded-full bg-gray-100"><div className="h-2 rounded-full" style={{ width: `${w.accuracy}%`, background: x.accent }} /></div>
                            <span className="w-10 text-right tabular-nums text-gray-800">{w.accuracy}%</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            ) : (
              <section aria-labelledby="trend-h" className="mt-8">
                <h2 id="trend-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Last 8 weeks</h2>
                <div className="mt-2"><NotMeasuredLine text={TREND_NEEDS} /></div>
              </section>
            )}
          </>
        )}
    </>
  );
}
