import Link from "next/link";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { learnerTimeZone, learnerToday } from "@/lib/individual/scholar/learning-definitions";
import { loadStudy } from "@/lib/individual/scholar/study-context";
import { evaluationPrefill, withStudy } from "@/lib/individual/scholar/study-carry";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { PageHeader, StatePanel, focusRing, BoundaryNotice } from "../../../../../_components/chrome";
import StudyNav from "../_components/StudyNav";
import { ExamPapersSection } from "../_components/papers-section";
import { FORMATIVE_NOTICE, scholarSpace } from "@/lib/individual/scholar/spaces";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { countDue, listEvaluations, listMaterials } from "@/lib/individual/scholar/store";
import { evaluateScope } from "@/lib/individual/scholar/evaluation-data";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { CASE_CONTEXTS, CASE_CONTEXT_LABEL, EVALUATION_CONFIDENCE_LABEL, EVALUATION_LABEL, EVALUATION_METHOD_LABEL, type CaseContext } from "@/lib/individual/scholar/config";
import { METHOD_MEANING, parseEvaluateView, snapshotRow, unprovenOf } from "@/lib/individual/scholar/evaluate-goals";
import { EvaluateViewNav, GoalChip, Tile, WorkflowLine, evaluateHref, snapshotWhen } from "../_components/evaluate-parts";
import { HistoryDashboard, loadCompetencyRows, loadGoalCards } from "../_components/progress-dashboards";
import { loadNextActions } from "@/lib/individual/scholar/next-best-action-data";
import { NextActionsCard } from "../_components/plan-next-actions";
import { toneAction } from "../_components/progress-parts";
import { EvaluationStart } from "../_components/evaluation-client";
import { adaptiveHref, evaluationHref, studyHref } from "../_components/question-view";
import { MonthlyReviewPanel } from "../_components/monthly-review-panel";
import { loadMonthlyOverview, monthlyReviewOn } from "@/lib/individual/scholar/monthly-review-data";
import { monthOf } from "@/lib/individual/scholar/monthly-review";

// Request-time only: it reads the release gate and the evidence, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// EVALUATION-01 (Stage 6) E1 -- the Evaluation workspace, on SCHOLAR-EVALUATE-GOALS-01 (owner GO and final alignment, 5 Nov 2026). Evaluate is where an evaluation
// is taken: My Plan goals by default, My Competencies, My Learning, Clinical Reasoning and the Monthly Review, each one flow (what, how, complete, feedback, saved).
// The report of what the records show is My Progress, read only, from the same records, mappings and rules. The evaluation engine is unchanged.
// A review of existing evidence adds nothing new: it reads the records and keeps what they showed that day.
//
// A KEPT EVALUATION reads: everything the student's evidence says now, interpreted
// on each visit, with no examination asked of them and no AI call (A). START A NEW EVALUATION asks for one over a
// chosen scope, from existing evidence, a fresh knowledge check, or both, and keeps it (B). PREVIOUS EVALUATIONS
// are those records, each openable with no AI. It works with no competency catalogue: then everything is by
// section of the student's own notes.
// ⚠ FORMATIVE, AND SAID SO. Nothing here is an assessment, a pass mark or verified clinical competence.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Evaluate" });
}

export default async function EvaluatePage({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<{ study?: string; view?: string; start?: string; startCompetency?: string; startContext?: string; method?: string; q?: string; from?: string; a?: string; b?: string }> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const sp = await searchParams;
  const policy = await loadIndividualPolicy(ctx.admin);
  const hdrs = await headers();
  const today = learnerToday(hdrs), tz = learnerTimeZone(hdrs), now = new Date();
  const [due, materials, learner] = await Promise.all([countDue(ctx.admin, ctx.userId), listMaterials(ctx.admin, ctx.userId), loadLearnerCatalogue(ctx.admin, ctx.userId)]);
  const mats = (materials.ok ? materials.data : []).filter(m => m.chunkCount > 0);
  const study = await loadStudy(ctx.admin, ctx.userId, sp.study, "evaluate", policy);
  const sid = study?.session.id ?? null;
  const view = parseEvaluateView(sp.view);
  const o = { now, tz, today };
  const progress = (tab: string) => `${studyHref("progress")}?tab=${tab}${sid ? `&study=${sid}` : ""}`;
  const header = (
    <>
      <PageHeader accent={x.accent} eyebrow={scholarSpace("evaluate").eyebrow} title="Evaluate" intro="Assess what you planned to learn, where your evidence stands, and what to do next." />
      <StudyNav dueCount={due} study={study?.bar ?? null} />
      <EvaluateViewNav current={view} study={sid} />
      <p className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1"><WorkflowLine /><Link href={progress("overview")} className={`text-[13.5px] ${toneAction.link}`}>View My Progress</Link></p>
    </>
  );
  const notice = <div className="mt-5"><BoundaryNotice notice={FORMATIVE_NOTICE} detail={EVALUATION_LABEL} /></div>;
  if (!mats.length) return (
    <>
      {header}
      <StatePanel title="Nothing to evaluate yet">
        <p>Evaluation reads what you have learned from your own notes. Upload a material, then learn, revise or practise a case from it.</p>
        <p><Link href={studyHref()} className={`font-semibold underline ${focusRing}`} style={{ color: x.accent }}>Go to your materials</Link></p>
      </StatePanel>
      {notice}
    </>
  );
  const row = "flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-3.5 py-3";
  const list = "divide-y divide-gray-100 overflow-hidden rounded-xl bg-[var(--cmp-app-surface)] ring-1 ring-gray-200";
  const defaultScope = sp.start ? { kind: "topic" as const, topic: sp.start.slice(0, 120) } : isUuidLike(sp.startCompetency) ? { kind: "competency" as const, competencyId: sp.startCompetency }
    : evaluationPrefill(study?.scope ?? null, { materialIds: mats.map(m => m.id), competencyIds: (learner.competencies ?? []).map(c => c.id) });
  const startForm = (scope: React.ComponentProps<typeof EvaluationStart>["defaultScope"]) => (
    <section aria-labelledby="ev-start-h">
      <details className="mb-2 rounded-xl bg-[var(--cmp-app-surface)] p-3.5 ring-1 ring-gray-200" suppressHydrationWarning data-method-meaning>
        <summary className={`cursor-pointer text-[13.5px] font-semibold text-gray-900 pointer-coarse:py-3.5 ${focusRing}`}>What each way of evaluating means</summary>
        <ul className="mt-1 space-y-1 text-[13px] text-gray-800">{(["existing", "fresh", "combined"] as const).map(m => <li key={m}><span className="font-semibold">{EVALUATION_METHOD_LABEL[m]}: </span>{METHOD_MEANING[m]}</li>)}</ul>
      </details>
      {/* Keyed on what was chosen: choosing a goal or competency here is the same page, and the form must start from that choice. */}
      <EvaluationStart key={`${JSON.stringify(scope)}|${sp.method ?? ""}`} methods={policy.scholarEvaluationMethods} materials={mats.map(m => ({ id: m.id, title: m.title }))}
        competencies={(learner.competencies ?? []).map(c => ({ id: c.id, title: `${c.code ? `${c.code} ` : ""}${c.title}`, outcomes: c.outcomes }))}
        contexts={policy.scholarCaseContexts.map(c => ({ value: c, label: CASE_CONTEXT_LABEL[c] }))} freshQuantity={policy.scholarEvaluationFreshQuantity}
        defaultScope={scope} defaultMethod={sp.method === "fresh" || sp.method === "combined" || sp.method === "existing" ? sp.method : undefined} />
    </section>
  );

  // ── My Plan goals, the default: the plan beside the start of an evaluation, then what is available, next steps and past evaluations ──
  if (view === "goals") {
    const [{ cards, planned }, nba, live, history] = await Promise.all([
      loadGoalCards(ctx, policy, o), loadNextActions(ctx, policy, { now, today }).catch(() => null),
      evaluateScope(ctx.admin, ctx.userId, policy, { kind: "all" }, { method: "existing", now: now.toISOString() }), listEvaluations(ctx.admin, ctx.userId, 5),
    ]);
    const e = live.ok ? live.evaluation : null;
    const c = e?.evidence.counts;
    const cov = e?.coverage.state === "measured" ? e.coverage : null;
    const past = history.ok ? history.data.map(snapshotRow) : [];
    const supported = cards.filter(g => g.supported > 0).length, more = cards.filter(g => g.status !== "outcome_supported").length;
    return (
      <>
        {header}
        <div className="space-y-4" data-evaluate-goals>
          <div className="grid gap-4 lg:grid-cols-2">
            <section aria-labelledby="eg-h" className="cmp-learn-next">
              <h2 id="eg-h" className="text-[18px] font-bold text-gray-900">My Plan comes first</h2>
              {cards.length === 0 ? (
                <div className="mt-2 rounded-xl bg-[var(--cmp-app-surface)] p-4 text-[14px] text-gray-800 ring-1 ring-gray-200">
                  <p>{planned ? "You have not set goals or priorities yet." : "My Plan could not be read just now."} You can still evaluate your learning here.</p>
                  {planned && <p className="mt-1"><Link href={withStudy(studyHref("plan"), sid)} className={toneAction.link}>Set a goal in My Plan</Link></p>}
                </div>
              ) : (
                <>
                  <p className="mt-1 text-[13.5px] text-gray-800">{supported} of {cards.length} {cards.length === 1 ? "goal has" : "goals have"} supporting evidence. {more} {more === 1 ? "needs" : "need"} more.</p>
                  <ul className={`mt-2 ${list}`}>
                    {cards.map(g => (
                      <li key={g.key} className={row} data-goal={g.title}>
                        <div className="min-w-0 flex-1 basis-[14rem]">
                          <p className="break-words text-[14.5px] font-bold text-gray-900">{g.title}</p>
                          <div className="mt-1"><GoalChip status={g.status} /></div>
                          <p className="mt-1 text-[13px] text-gray-700">{g.noMatch ? "Nothing in your materials matches this yet." : g.unproven.length ? `Not yet shown: ${g.unproven.join(", ")}.` : "All four outcome checks are supported by your evidence."}</p>
                        </div>
                        {!g.noMatch && <Link href={evaluateHref("goals", { start: g.key, study: sid }) + "#ev-start-h"} prefetch={false} className={toneAction.secondary}>Evaluate this goal</Link>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
            {startForm(defaultScope)}
          </div>
          <section aria-labelledby="eg-ev-h" className="cmp-learn-record">
            <h2 id="eg-ev-h" className="text-[16px] font-bold text-gray-900">Evidence already available</h2>
            <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Tile label="Sections with activity" value={cov ? `${cov.sections.worked} of ${cov.sections.total}` : "Not measured"} note="Coverage, not understanding" />
              <Tile label="Questions answered" value={String(c?.independentQuestions ?? 0)} note="Marked by the app" />
              <Tile label="Completed case decisions" value={String(c?.independentDecisions ?? 0)} note="Simulated practice" />
            </dl>
            <p className="mt-2 text-[12.5px] text-gray-700">{e ? EVALUATION_CONFIDENCE_LABEL[e.confidence.level] : "Your evidence could not be read just now"}. Reading, your own ratings, AI feedback and answers marked by the app are kept apart.</p>
          </section>
          {nba && nba.items.length > 0 && (
            <section aria-label="Next steps">
              <NextActionsCard title="Next steps" collapseAfter={1} items={nba.items.slice(0, 3)} canDecide={nba.canDecide} canPlan={nba.canPlan} dismissed={nba.dismissed} snoozed={nba.snoozed} studyId={sid} />
            </section>
          )}
          <section aria-labelledby="eg-past-h">
            <h2 id="eg-past-h" className="text-[16px] font-bold text-gray-900">Past evaluations</h2>
            {past.length === 0 ? <p className="mt-1 text-[13.5px] text-gray-700">None yet. An evaluation you complete is kept here and in My Progress.</p> : (
              <ul className={`mt-2 ${list}`}>{past.slice(0, 3).map(h => <li key={h.id} className="px-3.5 py-2.5 text-[14px]" data-snapshot={h.id}><Link href={evaluationHref(h.id)} prefetch={false} className={toneAction.link}>{h.label}</Link><span className="block text-[12.5px] text-gray-700">{h.methodLine} · {snapshotWhen(h.createdAt)}</span></li>)}</ul>
            )}
            <p className="mt-2 text-[13px]"><Link href={evaluateHref("history", { study: sid })} className={toneAction.link}>View evaluation history</Link></p>
          </section>
        </div>
        {notice}
      </>
    );
  }

  // ── Evaluation history: this screen owns the attempts it started ──
  if (view === "history") return (
    <>
      {header}
      <HistoryDashboard ctx={ctx} q={sp.q} from={sp.from} a={sp.a} b={sp.b} sid={sid} action={studyHref("evaluate")} hidden={{ name: "view", value: "history" }} />
      {notice}
    </>
  );

  // ── My Competencies ──
  if (view === "competencies") {
    const { rows, catalogue } = await loadCompetencyRows(ctx, policy, o);
    return (
      <>
        {header}
        <div className="grid gap-4 lg:grid-cols-2" data-evaluate-competencies>
          <section>
            <h2 className="text-[18px] font-bold text-gray-900">Evaluate my competencies</h2>
            <p className="mt-1 max-w-[70ch] text-[13.5px] text-gray-800">A formative check of your learning against a competency. It is not independent clinical verification, and it sets no stage.</p>
            {!catalogue.length ? <p className="mt-2 rounded-xl bg-[var(--cmp-app-surface)] p-4 text-[14px] text-gray-800 ring-1 ring-gray-200" data-no-framework>You have no competency framework applied yet. You can still evaluate your learning, or choose a programme in <Link href={experienceHref("scholar", "my-competencies")} className={toneAction.link}>My Competencies</Link>.</p>
              : rows.length === 0 ? <p className="mt-2 rounded-xl bg-[var(--cmp-app-surface)] p-4 text-[14px] text-gray-800 ring-1 ring-gray-200">None of your learning is linked to a competency yet. Link your notes from a material, then evaluate here.</p> : (
                <ul className={`mt-2 ${list}`}>
                  {rows.map(c => (
                    <li key={c.id} className={row} data-competency={c.title}>
                      <div className="min-w-0 flex-1 basis-[14rem]">
                        <p className="break-words text-[14.5px] font-bold text-gray-900">{c.title}</p>
                        <p className="mt-0.5 text-[13px] text-gray-700">Not yet shown: {unprovenOf(c.dims).join(", ") || "nothing"}.</p>
                      </div>
                      <Link href={evaluateHref("competencies", { startCompetency: c.id, study: sid }) + "#ev-start-h"} prefetch={false} className={toneAction.secondary}>Evaluate this</Link>
                    </li>
                  ))}
                </ul>
              )}
            <p className="mt-2 text-[13px]"><Link href={progress("competencies")} className={toneAction.link}>See your competency evidence in My Progress</Link></p>
          </section>
          {startForm(defaultScope)}
        </div>
        {notice}
      </>
    );
  }

  // ── My Learning: a topic, a material or an outcome ──
  if (view === "learning") return (
    <>
      {header}
      <div className="space-y-3" data-evaluate-learning>
        <h2 className="text-[18px] font-bold text-gray-900">Evaluate my learning</h2>
        {startForm(defaultScope)}
        <p className="text-[13px]"><Link href={progress("learning")} className={toneAction.link}>See your learning evidence in My Progress</Link></p>
      </div>
      {notice}
    </>
  );

  // ── Clinical Reasoning ──
  if (view === "reasoning") {
    const adaptive = policy.scholarAdaptiveExams === "on";
    return (
      <>
        {header}
        <div className="space-y-3" data-evaluate-reasoning>
          <h2 className="text-[18px] font-bold text-gray-900">Evaluate clinical reasoning</h2>
          <p className="max-w-[70ch] text-[13.5px] text-gray-800">Simulated practice, kept apart from verified clinical competence. Each attempt keeps its answers and feedback.</p>
          <ul className="grid gap-2 sm:grid-cols-3">
            <li className="rounded-xl bg-[var(--cmp-app-surface)] p-3.5 ring-1 ring-gray-200"><p className="text-[14.5px] font-bold text-gray-900">Clinical case</p><p className="text-[13px] text-gray-700">An unfolding patient case from what you studied.</p><Link href={withStudy(`${studyHref("apply")}?build=1#case-start-h`, sid)} prefetch={false} className={`mt-1 text-[13.5px] ${toneAction.link}`}>Start a case</Link></li>
            <li className="rounded-xl bg-[var(--cmp-app-surface)] p-3.5 ring-1 ring-gray-200"><p className="text-[14.5px] font-bold text-gray-900">OSCE station</p><p className="text-[13px] text-gray-700">Structured assessment and communication, against a checklist.</p><Link href={withStudy(studyHref("apply/osce"), sid)} prefetch={false} className={`mt-1 text-[13.5px] ${toneAction.link}`}>Open stations</Link></li>
            {adaptive && <li className="rounded-xl bg-[var(--cmp-app-surface)] p-3.5 ring-1 ring-gray-200"><p className="text-[14.5px] font-bold text-gray-900">Adaptive exam</p><p className="text-[13px] text-gray-700">Questions that respond to your answers.</p><Link href={withStudy(adaptiveHref(), sid)} prefetch={false} className={`mt-1 text-[13.5px] ${toneAction.link}`}>Set up an exam</Link></li>}
          </ul>
          {startForm(isCaseContext(sp.startContext) ? { kind: "context", context: sp.startContext } : { kind: "context", context: policy.scholarCaseContexts[0] ?? "general" })}
          <p className="text-[13px]"><Link href={`${studyHref("apply")}?view=library${sid ? `&study=${sid}` : ""}`} className={toneAction.link}>Earlier cases and attempts are in My Practice Library</Link></p>
        </div>
        {notice}
      </>
    );
  }

  // ── Monthly Review ──
  const monthlyOn = monthlyReviewOn(policy);
  const monthly = monthlyOn ? await loadMonthlyOverview(ctx.admin, ctx.userId, policy, today) : null;
  return (
    <>
      {header}
      <div className="space-y-5" data-evaluate-monthly>
        {!monthlyOn ? <p className="rounded-xl bg-[var(--cmp-app-surface)] p-4 text-[14px] text-gray-800 ring-1 ring-gray-200">Monthly reviews are not offered here.</p> : monthly ? (
          <MonthlyReviewPanel
            accent={x.accent} currentMonth={monthOf(today)} optedOut={monthly.optedOut} canOptOut={monthly.canOptOut} reminders={monthly.reminders}
            nudges={monthly.nudges.map(n => ({ month: n.month, recommended: n.recommended, late: n.late }))}
            panels={monthly.panels.map(p => ({
              month: p.month, lessons: p.lessons, sections: p.sections, materials: p.materials, subjects: p.subjects, estimated: p.estimated, hasActivity: p.hasActivity, state: p.state,
              original: p.original ? { id: p.original.id, createdAt: p.original.createdAt, late: p.original.late } : null,
              retakes: p.retakes.map(r => ({ id: r.id, createdAt: r.createdAt, late: r.late })), resumeHref: p.resumeHref, recommended: p.recommended, late: p.late,
            }))} />
        ) : <StatePanel title="Your monthly review could not be read just now"><p>Your study records could not be read. The rest of Evaluate is still here.</p></StatePanel>}
        <ExamPapersSection admin={ctx.admin} userId={ctx.userId} variant="evaluate" />
        <p className="text-[13px]"><Link href={progress("history")} className={toneAction.link}>Earlier evaluations and reviews are in My Progress</Link></p>
      </div>
      {notice}
    </>
  );
}

const isUuidLike = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const isCaseContext = (v: unknown): v is CaseContext => typeof v === "string" && (CASE_CONTEXTS as readonly string[]).includes(v);
