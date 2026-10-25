import Link from "next/link";
import { EXPERIENCES, experienceHref } from "@/lib/individual/experiences";
import { EVIDENCE_LABEL } from "@/lib/individual/passport";
import { loadProfessionalRecord } from "@/lib/individual/professional/record";
import { cpdHoursByYear, evidenceCoverage, goalActivity, planProgress } from "@/lib/individual/professional/progress";
import { loadMappingView, professionalProgress } from "@/lib/individual/professional/mapping-store";
import { countedOnce, cpdYearsWithLearning, loadProfessionalLearning } from "@/lib/individual/professional/learning";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { GOAL_STATUS_LABEL, NEED_STATUS_LABEL } from "@/lib/individual/professional/vocabulary";
import type { Metadata } from "next";
import { experienceModulePage, gatedMetadata } from "../../../../_components/shell-context";
import { PageHeader, Unreadable, focusRing } from "../../../../_components/chrome";
import { NotProvisioned, Section, fmtDate } from "../../../../_components/professional/bits";
import { CareerView, CompetencyView, EventList, LearningStats, NextSteps, SaveView, TimeView } from "../../../../_components/professional/progress-views";
import { buckets, careerJourney, competencyProgress, learningProgress, nextSteps, overview, timeline } from "@/lib/individual/professional/progress-intel";
import { loadProgressInput } from "@/lib/individual/professional/progress-sources";
import { PERIODS, PROGRESS_VIEWS, type PeriodKind, type ProgressView } from "@/lib/individual/professional/progress-policy";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// MY PROFESSIONAL PROGRESS -- COMPETEN-PROFESSIONAL-PROGRESS-01 Stage 8 (PR1-PR6), grown from COMPETEN-IND-007 s6.
// In-page views (?view=), so the sidebar is unchanged: Overview (next actions first), Development over time (periods,
// professional phases), Competency progress (Domain, CPU, competency, outcome: five columns never combined), Learning &
// CPD, Career & professional journey, and links to My Professional Evaluation (Stage 6) and the Document Studio (PR7).
// The interpretation is src/lib/individual/professional/progress-intel.ts: pure, no score, nothing stored but the
// person's own preferences, views, decisions and requested snapshots (migration 550).
//
// PROGRESS -- COMPETEN-IND-007 s6. Plan progress, CPD hours by year and evidence coverage.
//
// ⚠ EVERY FIGURE IS A COUNT OF THE PERSON'S OWN ROWS (src/lib/individual/professional/progress.ts). There
// is no target, no score, no readiness percentage and no comparison with anyone. A ratio with nothing to
// count is "Not measured", with the reason, never 0%.
//
// ⚠ LEARNING COUNTS IN HOURS ONLY (COMPETEN-LEARNING-01 H1). Completed Competen Learning courses, read by reference,
// add to CPD hours by year, shown "of which from Competen Learning". They are NOT counted as evidence behind a
// development need: nothing here marks a need met because a course shares a competency with it. An entry of the
// person's own that is the same course is counted ONCE in these hours (countedOnce), the same figure the CPD log shows.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Progress" }); }

const pct = (r: number) => `${Math.round(r * 100)}%`;

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{value}</p>
      <p className="text-[12.5px] text-gray-600">{sub}</p>
    </div>
  );
}

function NotMeasured({ why, href, cta, accent }: { why: string; href: string; cta: string; accent: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 p-4">
      <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">Not measured</p>
      <p className="mt-1 text-[13.5px] text-gray-700">{why}</p>
      <Link href={href} className={`mt-2 inline-flex min-h-[44px] items-center text-[13.5px] font-semibold ${focusRing}`} style={{ color: accent }}>{cta} →</Link>
    </div>
  );
}

export default async function ProgressPage({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = await experienceModulePage((await params).experience, "progress");
  if (!page) return null;
  const { ctx } = page;
  const x = EXPERIENCES.professional;
  const today = new Date().toISOString().slice(0, 10);
  const [record, map, learning, policy] = await Promise.all([loadProfessionalRecord(ctx.admin, ctx.userId), loadMappingView(ctx.admin, ctx.userId), loadProfessionalLearning(ctx.admin, ctx.userId), loadIndividualPolicy(ctx.admin)]);
  const { needs, goals, cpd, evidence } = record;
  const plan = goals ? planProgress(goals, today) : null;
  const once = cpd ? countedOnce(cpd, learning, policy.professionalLearningMatchDays) : null;
  const years = cpd && once ? cpdYearsWithLearning(cpdHoursByYear(once.counted), learning.refs ?? []) : null;
  const withLearning = learning.enabled && (years ?? []).some(y => y.learningEntries > 0);
  const coverage = needs && goals && cpd && evidence ? evidenceCoverage(needs, goals, cpd, evidence) : null;
  const prog = professionalProgress(map, record);
  const activity = goals && cpd ? goalActivity(goals, cpd, today) : null;
  const goalTitle = new Map((goals ?? []).map(g => [g.id, g.title]));
  const href = (s: string) => experienceHref("professional", s);

  // Stage 8: the views, the period, and what the owners hold now.
  const sp = await searchParams;
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as string | undefined;
  const pp = policy.professionalProgress;
  const { input, extra, state } = await loadProgressInput(ctx.admin, ctx.userId, today);
  const views = PROGRESS_VIEWS.filter(([v]) => pp.views.includes(v));
  const view = (views.some(([v]) => v === one(sp.view)) ? one(sp.view) : views.some(([v]) => v === state.preference?.default_view) ? state.preference!.default_view : "overview") as ProgressView;
  const periods = PERIODS.filter(([p]) => pp.periods.includes(p));
  const period = (periods.some(([p]) => p === one(sp.period)) ? one(sp.period) : periods.some(([p]) => p === state.preference?.default_period) ? state.preference!.default_period : pp.defaultPeriod) as PeriodKind;
  const events = timeline(input, extra, pp);
  const steps = nextSteps(input, extra, pp, { profile: href("registration"), competencies: href("competencies"), learning: "/individual/learning" }, policy.professionalPlan.reviewDays);
  const ov = overview(input, events, pp);

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your development" title="My Professional Progress"
        intro="Your development over time, from your own records: what to do next, what you have done, and what it supports. No score, no invented targets, and anything with nothing to measure says so." />
      {!record.provisioned && <NotProvisioned />}
      <nav aria-label="Progress views" className="mb-5 flex flex-wrap gap-2">
        {views.map(([v, label]) => {
          const to = v === "evaluation" ? href("progress/evaluation") : v === "documents" ? href("progress/documents") : `?view=${v}`;
          return <Link key={v} href={to} aria-current={view === v ? "page" : undefined}
            className={`inline-flex min-h-[40px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center rounded-full border px-4 text-[13.5px] font-semibold ${focusRing} ${view === v ? "text-white" : "border-gray-300 bg-white text-gray-800"}`}
            style={view === v ? { background: x.accent, borderColor: x.accent } : undefined}>{label}</Link>;
        })}
      </nav>

      {view === "overview" && (
        <>
          <Section id="next-h" title={ov.newProfessional ? "Useful first steps" : "Next steps"} note="Each says the finding behind it and opens the module that owns the work. Nothing is created for you.">
            <NextSteps steps={steps} accent={x.accent} />
          </Section>
          <Section title="Active goals">
            {ov.activeGoals.length === 0 ? <p className="text-[13.5px] text-gray-600">No active goals. <Link href={href("development")} className="font-semibold underline" style={{ color: x.accent }}>Set one</Link> when you are ready.</p> : (
              <ul className="divide-y divide-gray-100">{ov.activeGoals.map(g => <li key={g.id} className="py-2 text-[14px]"><Link href={input.hrefs.goal(g.id)} className={`font-semibold text-gray-900 underline-offset-2 hover:underline ${focusRing}`}>{g.title}</Link> <span className="text-[12.5px] text-gray-500">· {GOAL_STATUS_LABEL[g.status] ?? g.status}{g.target_date ? ` · target ${fmtDate(g.target_date)}` : ""}</span></li>)}</ul>
            )}
          </Section>
          <Section title="Recent learning and achievements" note={`From the last ${pp.recentDays} days. Volume is activity, not verified competence.`}>
            {ov.achievements.length === 0 ? <p className="text-[13.5px] text-gray-600">Nothing recent.</p> : <EventList events={ov.achievements} />}
            <p className="mt-2 text-[12.5px] text-gray-600">{ov.competenciesWithEvidence} {ov.competenciesWithEvidence === 1 ? "competency has" : "competencies have"} supporting evidence linked. See Competency progress.</p>
          </Section>
          {ov.milestones.length > 0 && <Section title="Recent professional milestones"><EventList events={ov.milestones} /></Section>}
        </>
      )}
      {view === "time" && (
        <Section id="time-h" title="Development over time" note="Grouped by the period you choose. Original dates, recording dates, sources and versions are kept, and repeated practice is marked, never merged.">
          <TimeView buckets={buckets(events, period, extra.context)} periods={periods} period={period} accent={x.accent} />
        </Section>
      )}
      {view === "competencies" && (
        <Section id="comp-h" title="Competency progress" note="Domain, clinical practice unit, competency and outcome. Expected, self-assessed, evidence, formative evaluation and independent decision are separate columns, never averaged.">
          <CompetencyView {...competencyProgress(input, extra)} href={href("competencies")} />
        </Section>
      )}
      {view === "learning" && <Section id="learn-h" title="Learning & CPD progress"><LearningStats p={learningProgress(input, extra)} /></Section>}
      {view === "career" && (
        <Section id="career-h" title="Career & professional journey" note="Education, registration, practice, specialty, qualifications, teaching, research and quality improvement, transitions and aspirations, from your own profile.">
          <CareerView groups={careerJourney(input, extra, pp).groups} accent={x.accent} profileHref={href("registration")} />
        </Section>
      )}
      {(view === "overview" || view === "time") && state.provisioned && (
        <Section title="Keep this view"><SaveView view={view} period={period} accent={x.accent} />
          {(state.views ?? []).length > 0 && <p className="mt-2 text-[13px] text-gray-700">Saved views: {(state.views ?? []).map(v => <Link key={v.id} href={`?view=${v.view_code}&period=${v.period_code}`} className="mr-3 font-semibold underline" style={{ color: x.accent }}>{v.name}</Link>)}</p>}
        </Section>
      )}

      {view === "overview" && (<>
      {/* COMPETEN-PROFESSIONAL-EVALUATION-01 (Stage 6): reached from here, so the sidebar is unchanged. */}
      <Section title="My Professional Evaluation" note="What your records support, in six separate dimensions, where the evidence is thin, and what you might do next. Formative and private: never a score, never verification.">
        <Link href={href("progress/evaluation")} className={`inline-flex min-h-[44px] items-center text-[14px] font-semibold ${focusRing}`} style={{ color: x.accent }}>Open My Professional Evaluation →</Link>
      </Section>

      <Section title="Learning plan">
        {plan === null ? <Unreadable what="learning plan" /> : plan.completion === null ? (
          <NotMeasured accent={x.accent} href={href("development")} cta="Add a goal"
            why={plan.total ? "Every goal in your plan is dropped, so there is nothing to measure." : "You have no goals yet, so there is no plan to measure."} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Goals done" value={pct(plan.completion)} sub={`${plan.done} of ${plan.total - plan.dropped} (dropped goals not counted)`} />
            <Stat label="In progress" value={String(plan.inProgress)} sub={`${plan.planned} more planned`} />
            <Stat label="Past target date" value={String(plan.overdue)} sub="Planned or in progress, target date passed" />
          </div>
        )}
      </Section>

      <Section title="Goals and the CPD behind them" note="For each goal, the CPD you linked to it. This needs no framework: it is your own plan and your own activity.">
        {activity === null ? <Unreadable what="goals and CPD" /> : activity.length === 0 ? (
          <NotMeasured accent={x.accent} href={href("development")} cta="Add a goal" why="You have no goals that are not dropped, so there is nothing to show here." />
        ) : (
          <ul className="divide-y divide-gray-100">
            {activity.map(a => (
              <li key={a.goalId} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                <p className="text-[14px] font-semibold text-gray-900">{goalTitle.get(a.goalId) ?? "Goal"}{" "}
                  <span className="font-normal text-gray-500">· {GOAL_STATUS_LABEL[a.status] ?? a.status} · {a.targetDate ? `target ${fmtDate(a.targetDate)}` : "no target date"}</span>
                  {a.overdue && <span className="font-semibold text-amber-800"> · past target date</span>}
                </p>
                <p className={`text-[12.5px] ${a.entries ? "text-gray-700" : "font-semibold text-amber-800"}`}>
                  {a.entries
                    ? `${a.entries} CPD ${a.entries === 1 ? "entry" : "entries"} · ${a.hours} ${a.hours === 1 ? "hour" : "hours"} · ${a.withDocument} with a document · last ${fmtDate(a.lastActivity)}`
                    : "No CPD linked to this goal yet"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
      </>)}

      {view === "learning" && (<>
      <Section title="CPD hours by year" note={`Hours you recorded${learning.enabled ? ", and courses you completed on Competen Learning" : ""}. Competen sets no target.`}>
        {years === null ? <Unreadable what="CPD log" /> : years.length === 0 ? (
          <NotMeasured accent={x.accent} href={href("cpd")} cta="Record CPD" why="No CPD recorded yet." />
        ) : (
          <table className="w-full text-left text-[14px]">
            <caption className="sr-only">CPD hours by calendar year</caption>
            <thead><tr className="border-b border-gray-200 text-[12px] uppercase tracking-[0.1em] text-gray-500">
              <th scope="col" className="py-2 font-bold">Year</th><th scope="col" className="py-2 font-bold">Hours</th>
              <th scope="col" className="py-2 font-bold">Entries</th><th scope="col" className="py-2 font-bold">With a document</th>
              {withLearning && <th scope="col" className="py-2 font-bold">Of which from Competen Learning</th>}
            </tr></thead>
            <tbody>
              {years.map(y => (
                <tr key={y.year} className="border-b border-gray-100 tabular-nums">
                  <th scope="row" className="py-2 font-semibold text-gray-900">{y.year}</th>
                  <td className="py-2">{y.hours}</td><td className="py-2">{y.entries}</td><td className="py-2">{y.withDocument}</td>
                  {withLearning && <td className="py-2">{y.learningEntries ? `${y.fromLearning} h, ${y.learningEntries} ${y.learningEntries === 1 ? "course" : "courses"}${y.learningWithoutHours ? ` (${y.learningWithoutHours} gave no hours)` : ""}` : "None"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {learning.enabled && learning.refs === null && <p className="mt-2 text-[12.5px] text-gray-600">Your Competen Learning record could not be read just now, so courses from it are not included.</p>}
        {once && once.matches.size > 0 && <p className="mt-2 text-[12.5px] text-gray-600">{once.matches.size} of your own CPD {once.matches.size === 1 ? "entry is" : "entries are"} the same course as a Competen Learning record and counted once. See your CPD log.</p>}
        {once?.checkUnavailable && <p className="mt-2 text-[12.5px] font-semibold text-amber-900">The check for courses you logged twice could not run just now, so a course may be counted twice.</p>}
      </Section>

      <Section title="Evidence coverage" note="For each development need, the CPD (through a linked goal) and evidence you recorded against it.">
        {coverage === null ? <Unreadable what="record" /> : coverage.ratio === null ? (
          <NotMeasured accent={x.accent} href={href("development")} cta="Add a development need"
            why={coverage.needs.length ? "All your needs are set aside, so there is nothing to measure." : "You have no development needs yet, so coverage cannot be measured."} />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Needs with evidence" value={pct(coverage.ratio)} sub={`${coverage.covered} of ${coverage.counted} needs not set aside`} />
              <Stat label={EVIDENCE_LABEL.self_declared} value={String(coverage.byClass.self_declared)} sub="CPD entries and evidence items" />
              <Stat label={EVIDENCE_LABEL.source_linked} value={String(coverage.byClass.source_linked)} sub="CPD entries and evidence items" />
            </div>
            <ul className="mt-4 divide-y divide-gray-100">
              {coverage.needs.map(n => (
                <li key={n.needId} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                  <p className="text-[14px] font-semibold text-gray-900">{n.title} <span className="font-normal text-gray-500">· {NEED_STATUS_LABEL[n.status] ?? n.status}</span></p>
                  <p className={`text-[12.5px] font-semibold ${n.covered ? "text-gray-800" : "text-amber-800"}`}>
                    {n.covered ? "Has evidence" : "No evidence yet"} · {n.goals} {n.goals === 1 ? "goal" : "goals"} · {n.cpd} CPD · {n.evidence} evidence
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12.5px] text-gray-500">Coverage counts what you recorded. It does not mean anyone has assessed or verified the need as met.</p>
          </>
        )}
      </Section>
      </>)}

      {view === "competencies" && (<>
      <Section title="Competency coverage" note="The competencies Competen Professional offers, and which of them your CPD and evidence are linked to.">
        {prog.coverage.state !== "measured" ? (
          <NotMeasured accent={x.accent} href={href("cpd")} cta="Link CPD to competencies" why={prog.coverage.reason} />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Competencies linked" value={`${prog.coverage.covered} of ${prog.coverage.total}`} sub={prog.coverage.framework} />
              <Stat label="With a document" value={String(prog.coverage.coveredPositive)} sub="Linked to CPD or evidence that has a document attached" />
              <Stat label="Not linked yet" value={String(prog.coverage.gaps.length)} sub="Highest expected level first, below" />
            </div>
            {prog.coverage.gaps.length > 0 && (
              <ul className="mt-4 divide-y divide-gray-100">
                {prog.coverage.gaps.slice(0, 12).map(g => (
                  <li key={g.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                    <p className="text-[14px] font-semibold text-gray-900">{g.name}</p>
                    <p className="text-[12.5px] text-gray-600">{g.expected ? `Expected level: ${g.expected}` : "Expected level not set by the framework"}</p>
                  </li>
                ))}
              </ul>
            )}
            {/* Owner decision D1: the actual clinical review status of what is offered, always shown. */}
            <p className="mt-3 text-[12.5px] font-semibold text-amber-900">
              {(() => { const all = map.catalogue ?? []; const ok = all.filter(c => c.contentStatus === "approved").length;
                return ok === all.length ? `All ${all.length} offered competencies are clinically approved.` : `${ok} of ${all.length} offered competencies are clinically approved. The rest are not clinically reviewed yet.`; })()}
            </p>
            <p className="mt-1 text-[12.5px] text-gray-500">Linked means you connected a CPD entry or evidence item to the competency. It does not mean you have achieved it, and nobody has verified it.</p>
          </>
        )}
      </Section>

      <Section title="Goal gaps" note="Competencies your open goals aim at that no CPD or evidence is linked to yet.">
        {prog.goalGaps === null ? <Unreadable what="goals and competency links" /> : prog.coverage.state !== "measured" ? (
          <p className="text-[13.5px] text-gray-600">Not measured. {prog.coverage.reason}</p>
        ) : prog.goalGaps.length === 0 ? (
          <p className="text-[13.5px] text-gray-600">No gaps found. Either every competency an open goal is linked to has CPD or evidence linked too, or no open goal is linked to a competency yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {prog.goalGaps.map(g => (
              <li key={g.goalId} className="py-2.5">
                <p className="text-[14px] font-semibold text-gray-900">{g.title}</p>
                <ul className="mt-1 space-y-0.5">
                  {g.competencies.map(c => (
                    <li key={c.id} className="text-[12.5px] text-amber-900">No CPD or evidence linked: {c.name}{c.expected ? ` (expected level: ${c.expected})` : ""}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Section>
      </>)}
    </>
  );
}
