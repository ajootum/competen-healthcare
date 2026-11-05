import Link from "next/link";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { loadIndividualPolicyOnce } from "@/lib/individual/policy";
import { countDue, libraryTopics, listMaterials } from "@/lib/individual/scholar/store";
import { loadStudy } from "@/lib/individual/scholar/study-context";
import { learnerTimeZone, learnerToday } from "@/lib/individual/scholar/learning-definitions";
import { loadInsights, loadPlanCalendars, loadToday, warmPlanReads } from "@/lib/individual/scholar/plan-data";
import { entriesHorizon } from "@/lib/individual/scholar/study-calendar-data";
import { startHref, todaySchedule } from "@/lib/individual/scholar/plan-today-view";
import { materialTopics } from "@/lib/individual/scholar/library";
import { FORMATIVE_NOTICE } from "@/lib/individual/scholar/spaces";
import { linkOptions, monthsOfWeek, parsePlanView, planViewHref, resolveView, weekAgenda } from "@/lib/individual/scholar/plan-view";
import { calendarHref, hasPlansOn, mergeDueRevisionDays, resolveCalendarState } from "@/lib/individual/scholar/plan-workspace";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { ShellAction } from "../../../../../_components/Dialog";
import { StatePanel, Unreadable } from "../../../../../_components/chrome";
import StudyNav from "../_components/StudyNav";
import { PlanViewNav } from "../_components/plan-view-nav";
import { ComingUp, DoneToday, DueAndReview, ExamOffers, MissedList, NotesList, ReflectionCard, StartingPlanNote, TodayEmpty, TodayNextCard, TodaySchedule } from "../_components/plan-today";
import { PlanWorkspace } from "../_components/plan-workspace";
import { LiveAgendaRows } from "../_components/plan-agenda-rows";
import { PlanOptimistic } from "../_components/plan-optimistic";
import { InsightsView } from "../_components/plan-insights-view";
import { CalendarIcon, LearningOnlyNote } from "../_components/plan-ui";
import { secondaryBtn, squareBtn } from "../_components/plan-style";
// SALE-2026-11 R3 / SALE-11: next learning actions on Today (policy scholar_next_best_action, default off).
import { NextActionsCard } from "../_components/plan-next-actions";
import { loadNextActions } from "@/lib/individual/scholar/next-best-action-data";

// Request-time only: it reads the release gate, the session and the learner's own records, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// MY PLAN -- PLP-01..04 (owner GO "Personal Learning & Development Planning Engine", 2 Nov 2026), the My Plan calendar enhancement and CE-03 (mobile-first).
//
// The first tab of My Learning. Three views, one at a time (?view=calendar|today|insights; the Calendar is the default, and this device remembers the
// last one, read in the browser only when the address names none): CALENDAR (a month or week grid with a few dots per day, and the selected day's agenda
// under it), TODAY (what is planned or due today, ONE next suggestion, what is done) and INSIGHTS (study consistency, practice performance, retention
// evidence, each "Not measured yet" with its reason, never zero). Everything is computed on the server from the learner's own records by fixed rules: NO AI.
// Off, not set up (780) or unreadable is said calmly; learning never waits for a plan.
//
// ⚠ A PLAN IS A SUGGESTION AND A PERSONAL CHOICE ABOUT TIME. It is not an assessment and nothing here reaches the Passport.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "My Plan" });
}

type SP = { view?: string; date?: string; from?: string; span?: string; month?: string; study?: string; add?: string };

function NotReady({ reason }: { reason: "off" | "not_provisioned" | "unreadable" | "not_found" }) {
  if (reason === "unreadable") return <Unreadable what="plan" />;
  return (
    <StatePanel title={reason === "off" ? "My Plan is not offered here" : "My Plan is not available here yet"}
      actions={<Link href={experienceHref("scholar", "study/learn")} className={secondaryBtn}>Go to Learn</Link>}>
      <p>You can keep learning from your library in the meantime. Nothing you have done is affected.</p>
    </StatePanel>
  );
}

export default async function MyPlanPage({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<SP> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const sp = await searchParams;
  const hdrs = await headers();
  const o = { now: new Date(), tz: learnerTimeZone(hdrs), today: learnerToday(hdrs) };
  const today = o.today;
  // changes with every render of this page: the instant updates (plan-optimistic.tsx) give way to the server's answer when it arrives
  const stamp = String(o.now.getTime());
  const view = parsePlanView(sp.view);
  const explicit = resolveView(sp.view, null).remember !== null;
  const base = experienceHref("scholar", "study/plan");
  const cs = resolveCalendarState(sp, today);
  // read the plan's rows while HQ's policy is read (the loaders below find them already asked for)
  const warmMonths = view === "calendar" ? cs.months : view === "today" ? monthsOfWeek(today, 7) : [];
  warmPlanReads(ctx, { now: o.now, today, months: warmMonths, entriesTo: warmMonths[0] ? entriesHorizon(warmMonths[0], today) : undefined });
  const [policy, due] = await Promise.all([loadIndividualPolicyOnce(ctx.admin), countDue(ctx.admin, ctx.userId)]);
  const study = await loadStudy(ctx.admin, ctx.userId, sp.study, null, policy);
  const studyId = study ? (sp.study as string) : null;
  const keep: Record<string, string> = studyId ? { study: studyId } : {};
  const loadLinks = async () => {
    const [mats, topics] = await Promise.all([listMaterials(ctx.admin, ctx.userId), libraryTopics(ctx.admin, ctx.userId)]);
    return linkOptions(
      mats.ok ? mats.data.map(m => ({ id: m.id, title: m.title })) : [],
      materialTopics([...(topics?.values() ?? [])].flat(), 60).map(t => t.topic),
    );
  };

  // One white card holds the title, the one-line boundary, the three view tiles and (on the Calendar) the workspace itself.
  const frame = (inner?: React.ReactNode) => (
    <>
      <StudyNav dueCount={due} study={study?.bar ?? null} />
      <section aria-label="My Plan" className="mb-4 rounded-2xl border border-gray-200 bg-white p-3 sm:p-5">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[24px] font-bold leading-tight tracking-[-0.02em] text-gray-900 md:text-[28px]">My Plan</h1>
            <p className="text-[13.5px] text-gray-600">Your learning, your time</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ShellAction />
            <Link href={calendarHref(base, { span: cs.span, date: today, today, extra: keep })} className={squareBtn} aria-label="Go to today in the calendar"><CalendarIcon size={18} /></Link>
          </div>
        </header>
        <PlanViewNav base={base} current={view} explicit={explicit} extra={keep} />
        {inner && <div className="mt-4">{inner}</div>}
        <div className="mt-4"><LearningOnlyNote notice={FORMATIVE_NOTICE} /></div>
      </section>
    </>
  );

  // ── TODAY ──
  if (view === "today") {
    const [t, nba] = await Promise.all([loadToday(ctx, policy, o), loadNextActions(ctx, policy, { now: o.now, today }).catch(() => null)]);
    if (!t.ok) return <>{frame()}<NotReady reason={t.reason} /></>;
    const flashcards = experienceHref("scholar", "study/revise/flashcards");
    const calHref = calendarHref(base, { span: "month", date: today, today, extra: keep });
    const scheduled = todaySchedule(t.todayItems ?? [], t.next?.ref ?? null).filter(i => i.kind !== "completed");
    const planned = hasPlansOn(t.todayItems, t.dueCards, !!t.next);
    const links = scheduled.some(i => i.kind === "personal") ? await loadLinks() : [];
    const learn = experienceHref("scholar", "study/learn");
    const studyNow = (t.next ? startHref(t.next.href, studyId) : null) ?? learn;
    return (
      <PlanOptimistic stamp={stamp}>
        {frame()}
        {t.starting && <div className="mb-4"><StartingPlanNote accent={x.accent} today={today} settings={t.settings} extras={t.features.settingsExtras} /></div>}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            {planned ? (
              <>
                {scheduled.length > 0 && (
                  <TodaySchedule>
                    <LiveAgendaRows items={scheduled} ctx={{ date: today, today, accent: x.accent, links, studyId, canDecide: t.features.decisions, elseHref: planViewHref(base, "today", keep) }} />
                  </TodaySchedule>
                )}
                <TodayNextCard accent={x.accent} today={today} next={t.next} alternatives={t.alternatives} canDecide={t.features.decisions}
                  settings={t.settings} extras={t.features.settingsExtras} declinedHidden={t.declinedHidden} about={t.nextAbout}
                  startHref={t.next ? startHref(t.next.href, studyId) : null} resume={t.next ? t.next.rule === "unfinished" : false} starting={t.starting} />
              </>
            ) : (
              <TodayEmpty planHref={calendarHref(base, { span: "month", date: today, today, extra: { ...keep, add: "1" } })} studyNowHref={studyNow} calendarHref={calHref} />
            )}
            {nba && <NextActionsCard items={nba.items} canDecide={nba.canDecide} canPlan={nba.canPlan} dismissed={nba.dismissed} snoozed={nba.snoozed} studyId={studyId} />}
            <ComingUp today={today} items={t.comingUp} calendarHref={calHref} />
            <NotesList notes={t.notes} />
            <MissedList today={today} missed={t.missed} />
          </div>
          <div className="space-y-4">
            <DueAndReview dueCards={t.dueCards} flashcardsHref={flashcards} review={t.upcomingMonthlyReview} hideCards={t.todayItems !== null} />
            <DoneToday items={t.doneToday} studyId={studyId} />
            {t.hasPlan && <ExamOffers accent={x.accent} offers={t.examOffers} />}
            {t.hasPlan && t.reflection.enabled && <ReflectionCard week={t.reflection.week} answered={t.reflection.answered} offer={t.reflection.offer} settings={t.settings} />}
          </div>
        </div>
      </PlanOptimistic>
    );
  }

  // ── INSIGHTS ──
  if (view === "insights") {
    const i = await loadInsights(ctx, policy, o);
    if (!i.ok) return <>{frame()}<NotReady reason={i.reason} /></>;
    return <>{frame()}<InsightsView view={i} progressHref={experienceHref("scholar", "study/progress")} accent={x.accent} /></>;
  }

  // ── CALENDAR ── the selected month (and the next one only when the week shown crosses a month end)
  const [links, loads] = await Promise.all([loadLinks(), loadPlanCalendars(ctx, policy, { ...o, months: cs.months })]);
  const failed = loads.find(l => !l.ok);
  if (failed && !failed.ok) return <>{frame()}<NotReady reason={failed.reason} /></>;
  const ready = loads.flatMap(l => (l.ok ? [l] : []));
  if (ready.some(l => !l.calendar)) return <>{frame()}<StatePanel title="The study calendar is not offered here"><p>Your plan is still available in Today.</p></StatePanel></>;
  const views = ready.flatMap(l => (l.calendar ? [l.calendar.view] : []));
  const days = mergeDueRevisionDays(weekAgenda(views.flatMap(v => v.days), cs.gridDates[0], today, cs.gridDates.length));
  const notes = [...new Set(views.flatMap(v => v.notes))];
  const unattached = [...new Map(views.flatMap(v => v.unattached).map(u => [u.ref, u])).values()];
  const canAdd = ready[0].features.learnerCalendar;
  return (
    <PlanOptimistic stamp={stamp}>
      {frame(
        <PlanWorkspace accent={x.accent} today={today} base={base} extra={keep} studyId={studyId} span={cs.span} date={cs.date} month={cs.month}
          days={days} canAdd={canAdd} canDecide={ready[0].features.decisions} links={links} notes={notes} unattached={unattached} openAdd={sp.add === "1" && canAdd} />,
      )}
    </PlanOptimistic>
  );
}
