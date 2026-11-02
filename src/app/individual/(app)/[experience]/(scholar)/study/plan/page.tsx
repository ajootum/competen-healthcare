import Link from "next/link";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { countDue, libraryTopics, listMaterials } from "@/lib/individual/scholar/store";
import { loadStudy } from "@/lib/individual/scholar/study-context";
import { learnerTimeZone, learnerToday } from "@/lib/individual/scholar/learning-definitions";
import { loadInsights, loadPlanCalendar, loadToday } from "@/lib/individual/scholar/plan-data";
import { startHref, startLabel } from "@/lib/individual/scholar/plan-today-view";
import { monthFromQuery } from "@/lib/individual/scholar/study-calendar-data";
import { nextMonth, prevMonth } from "@/lib/individual/scholar/monthly-review";
import { materialTopics } from "@/lib/individual/scholar/library";
import { FORMATIVE_NOTICE, scholarSpace } from "@/lib/individual/scholar/spaces";
import { addDay, agendaStart, linkOptions, monthsOfWeek, parsePlanView, planViewHref, weekAgenda, type AgendaDay } from "@/lib/individual/scholar/plan-view";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { BoundaryNotice, PageHeader, StatePanel, Unreadable } from "../../../../../_components/chrome";
import StudyNav from "../_components/StudyNav";
import { PlanViewNav } from "../_components/plan-view-nav";
import { ComingUp, DoneToday, DueAndReview, ExamOffers, MissedList, NotesList, ReflectionCard, StartingPlanNote, TodayNextCard } from "../_components/plan-today";
import { PlanAgenda, PlanMonth } from "../_components/plan-calendar-view";
import { InsightsView } from "../_components/plan-insights-view";
import { secondaryBtn } from "../_components/plan-style";

// Request-time only: it reads the release gate, the session and the learner's own records, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// MY PLAN -- PLP-01..04 (owner GO "Personal Learning & Development Planning Engine", 2 Nov 2026) and the My Plan calendar enhancement.
//
// The first tab of My Learning. Three views, one at a time (?view=today|calendar|insights): TODAY (one next activity, why, why now, if you
// postpone it; cards due; what moved by itself, with an undo), CALENDAR (7 days by default, or the month; the learner's own entries beside
// Scholar's plan) and INSIGHTS (study consistency, practice performance, retention evidence, each "Not measured yet" with its reason, never zero).
// Everything is computed on the server from the learner's own records by fixed rules: NO AI. Off, not set up (780) or unreadable is said
// calmly; learning never waits for a plan.
//
// ⚠ A PLAN IS A SUGGESTION AND A PERSONAL CHOICE ABOUT TIME. It is not an assessment and nothing here reaches the Passport.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "My Plan" });
}

type SP = { view?: string; from?: string; span?: string; month?: string; study?: string };

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
  const view = parsePlanView(sp.view);
  const base = experienceHref("scholar", "study/plan");
  const [policy, due] = await Promise.all([loadIndividualPolicy(ctx.admin), countDue(ctx.admin, ctx.userId)]);
  const study = await loadStudy(ctx.admin, ctx.userId, sp.study, null, policy);
  const space = scholarSpace("plan");

  const q = (extra: Record<string, string | null | undefined> = {}) => (study ? { study: sp.study as string, ...extra } : extra);
  const head = (
    <>
      <PageHeader accent={x.accent} eyebrow={space.eyebrow} title={space.title} intro={space.intro} />
      <StudyNav dueCount={due} study={study?.bar ?? null} />
      {view !== "insights" && <BoundaryNotice notice={FORMATIVE_NOTICE} />}
      <PlanViewNav base={base} current={view} extra={q()} />
    </>
  );

  // ── TODAY ──
  if (view === "today") {
    const t = await loadToday(ctx, policy, o);
    if (!t.ok) return <>{head}<NotReady reason={t.reason} /></>;
    const flashcards = experienceHref("scholar", "study/revise/flashcards");
    const calendarHref = planViewHref(base, "calendar", q());
    const studyId = study ? (sp.study as string) : null;
    return (
      <>
        {head}
        {t.starting && <div className="mb-4"><StartingPlanNote accent={x.accent} today={today} settings={t.settings} extras={t.features.settingsExtras} /></div>}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <TodayNextCard accent={x.accent} today={today} next={t.next} alternatives={t.alternatives} canDecide={t.features.decisions}
              settings={t.settings} extras={t.features.settingsExtras} declinedHidden={t.declinedHidden} about={t.nextAbout}
              startHref={t.next ? startHref(t.next.href, studyId) : null} resume={t.next ? startLabel(t.next) === "Resume" : false} starting={t.starting} />
            <ComingUp accent={x.accent} today={today} items={t.comingUp} calendarHref={calendarHref} />
            <NotesList notes={t.notes} />
            <MissedList accent={x.accent} today={today} missed={t.missed} />
          </div>
          <div className="space-y-4">
            <DueAndReview accent={x.accent} dueCards={t.dueCards} flashcardsHref={flashcards} review={t.upcomingMonthlyReview} />
            <DoneToday items={t.doneToday} />
            {t.hasPlan && <ExamOffers accent={x.accent} offers={t.examOffers} />}
            {t.hasPlan && t.reflection.enabled && <ReflectionCard accent={x.accent} week={t.reflection.week} answered={t.reflection.answered} offer={t.reflection.offer} settings={t.settings} />}
          </div>
        </div>
      </>
    );
  }

  // ── INSIGHTS ──
  if (view === "insights") {
    const i = await loadInsights(ctx, policy, o);
    if (!i.ok) return <>{head}<NotReady reason={i.reason} /></>;
    return <>{head}<InsightsView view={i} progressHref={experienceHref("scholar", "study/progress")} accent={x.accent} /></>;
  }

  // ── CALENDAR ──
  const month = sp.span === "month";
  const [mats, topics] = await Promise.all([listMaterials(ctx.admin, ctx.userId), libraryTopics(ctx.admin, ctx.userId)]);
  const links = linkOptions(
    mats.ok ? mats.data.map(m => ({ id: m.id, title: m.title })) : [],
    materialTopics([...(topics?.values() ?? [])].flat(), 60).map(t => t.topic),
  );

  if (month) {
    const m = monthFromQuery(sp.month, today);
    const c = await loadPlanCalendar(ctx, policy, { ...o, month: m });
    if (!c.ok) return <>{head}<NotReady reason={c.reason} /></>;
    if (!c.calendar) return <>{head}<StatePanel title="The study calendar is not offered here"><p>Your plan is still available in Today.</p></StatePanel></>;
    const mHref = (mm: string | null) => planViewHref(base, "calendar", q({ span: "month", month: mm }));
    return (
      <>
        {head}
        <PlanMonth view={c.calendar.view} accent={x.accent} prevHref={mHref(prevMonth(m))} nextHref={mHref(nextMonth(m))} todayHref={mHref(null)}
          weekHref={planViewHref(base, "calendar", q())} canAdd={c.features.learnerCalendar} links={links} />
      </>
    );
  }

  const from = agendaStart(sp.from, today);
  const loads = await Promise.all(monthsOfWeek(from).map(m => loadPlanCalendar(ctx, policy, { ...o, month: m })));
  const failed = loads.find(l => !l.ok);
  if (failed && !failed.ok) return <>{head}<NotReady reason={failed.reason} /></>;
  const ready = loads.flatMap(l => (l.ok ? [l] : []));
  if (ready.some(l => !l.calendar)) return <>{head}<StatePanel title="The study calendar is not offered here"><p>Your plan is still available in Today.</p></StatePanel></>;
  const views = ready.flatMap(l => (l.calendar ? [l.calendar.view] : []));
  const days: AgendaDay[] = weekAgenda(views.flatMap(v => v.days), from, today);
  const wHref = (f: string | null) => planViewHref(base, "calendar", q({ from: f && f !== today ? f : null }));
  return (
    <>
      {head}
      <PlanAgenda accent={x.accent} today={today} days={days} prevHref={wHref(addDay(from, -7))} nextHref={wHref(addDay(from, 7))}
        thisWeekHref={from === today ? null : wHref(null)} monthHref={planViewHref(base, "calendar", q({ span: "month", month: from.slice(0, 7) }))}
        canAdd={ready[0].features.learnerCalendar} links={links} notes={views[0]?.notes ?? []} unattached={views[0]?.unattached ?? []} />
    </>
  );
}
