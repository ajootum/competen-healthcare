import Link from "next/link";
import type { Metadata } from "next";
import { loadStudy } from "@/lib/individual/scholar/study-context";
import { evaluationPrefill } from "@/lib/individual/scholar/study-carry";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { PageHeader, StatePanel, focusRing, BoundaryNotice } from "../../../../../_components/chrome";
import StudyNav from "../_components/StudyNav";
import { ExamPapersSection } from "../_components/papers-section";
import { FORMATIVE_NOTICE, scholarSpace } from "@/lib/individual/scholar/spaces";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { countDue, listEvaluations, listMaterials } from "@/lib/individual/scholar/store";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { evaluateScope } from "@/lib/individual/scholar/evaluation-data";
import { CASE_CONTEXT_LABEL, EVALUATION_CONFIDENCE_LABEL, EVALUATION_LABEL, EVALUATION_METHOD_LABEL } from "@/lib/individual/scholar/config";
import { EvaluationView } from "../_components/evaluation-view";
import { EvaluationStart, KeepContinuous } from "../_components/evaluation-client";
import { evaluationHref, studyHref } from "../_components/question-view";
import { MonthlyReviewPanel } from "../_components/monthly-review-panel";
import { loadMonthlyOverview, monthlyReviewOn } from "@/lib/individual/scholar/monthly-review-data";
import { monthOf } from "@/lib/individual/scholar/monthly-review";

// Request-time only: it reads the release gate and the evidence, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// EVALUATION-01 (Stage 6) E1 -- the Evaluation workspace.
//
// EVALUATE MY UNDERSTANDING is the continuous evaluation: everything the student's evidence says now, interpreted
// on each visit, with no examination asked of them and no AI call (A). START A NEW EVALUATION asks for one over a
// chosen scope, from existing evidence, a fresh knowledge check, or both, and keeps it (B). PREVIOUS EVALUATIONS
// are those records, each openable with no AI. It works with no competency catalogue: then everything is by
// section of the student's own notes.
// ⚠ FORMATIVE, AND SAID SO. Nothing here is an assessment, a pass mark or verified clinical competence.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Evaluate" });
}

export default async function EvaluatePage({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<{ study?: string }> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const policy = await loadIndividualPolicy(ctx.admin);
  const [due, materials, learner, history, live] = await Promise.all([
    countDue(ctx.admin, ctx.userId), listMaterials(ctx.admin, ctx.userId), loadLearnerCatalogue(ctx.admin, ctx.userId), listEvaluations(ctx.admin, ctx.userId, 20),
    evaluateScope(ctx.admin, ctx.userId, policy, { kind: "all" }, { method: "existing", now: new Date().toISOString() }),
  ]);
  const mats = (materials.ok ? materials.data : []).filter(m => m.chunkCount > 0);
  // SCHOLAR-MONTHLY-REVIEW-01: the optional monthly learning review (no migration; opt-out and resume need 830). Unreadable is said, never hidden.
  const today = new Date().toISOString().slice(0, 10);
  const monthlyOn = monthlyReviewOn(policy) && mats.length > 0;
  const monthly = monthlyOn ? await loadMonthlyOverview(ctx.admin, ctx.userId, policy, today) : null;
  // SCHOLAR-SESSION-AI-02: the open study session (database reads only) only chooses EvaluationStart's first scope (D5).
  const study = await loadStudy(ctx.admin, ctx.userId, (await searchParams).study, "evaluate", policy);
  const counts = live.ok ? live.evaluation.evidence.counts : null;

  return (
    <>
      <PageHeader accent={x.accent} eyebrow={scholarSpace("evaluate").eyebrow} title="Evaluate" intro={scholarSpace("evaluate").intro} />
      <StudyNav dueCount={due} study={study?.bar ?? null} />
      <BoundaryNotice notice={FORMATIVE_NOTICE} detail={EVALUATION_LABEL} />
      <ExamPapersSection admin={ctx.admin} userId={ctx.userId} variant="evaluate" />

      {!mats.length ? (
        <StatePanel title="Nothing to evaluate yet">
          <p>Evaluation reads what you have learned from your own notes. Upload a material, then learn, revise or practise a case from it.</p>
          <p><Link href={studyHref()} className={`font-semibold underline ${focusRing}`} style={{ color: x.accent }}>Go to your materials</Link></p>
        </StatePanel>
      ) : (
        <div className="space-y-8">
          {monthlyOn && (monthly ? (
            <MonthlyReviewPanel
              accent={x.accent} currentMonth={monthOf(today)} optedOut={monthly.optedOut} canOptOut={monthly.canOptOut} reminders={monthly.reminders}
              nudges={monthly.nudges.map(n => ({ month: n.month, recommended: n.recommended, late: n.late }))}
              panels={monthly.panels.map(p => ({
                month: p.month, lessons: p.lessons, sections: p.sections, materials: p.materials, subjects: p.subjects, estimated: p.estimated, hasActivity: p.hasActivity, state: p.state,
                original: p.original ? { id: p.original.id, createdAt: p.original.createdAt, late: p.original.late } : null,
                retakes: p.retakes.map(r => ({ id: r.id, createdAt: r.createdAt, late: r.late })), resumeHref: p.resumeHref, recommended: p.recommended, late: p.late,
              }))} />
          ) : <StatePanel title="Your monthly review could not be read just now"><p>Your study records could not be read. The rest of Evaluate is still here.</p></StatePanel>)}

          <section aria-labelledby="ev-now-h">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id="ev-now-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Evaluate my understanding</h2>
                <p className="mt-1 text-[13px] text-gray-600">All your learning, as your evidence shows it today. It updates as you learn: no extra examination, and no AI.</p>
              </div>
              {live.ok && <KeepContinuous />}
            </div>
            <div className="mt-3">
              {live.ok ? <EvaluationView r={live.evaluation} confidence={live.evaluation.confidence} limitations={live.evaluation.limitations} cfca={live.evaluation.cfca} />
                : <StatePanel title="Your evidence could not be read just now"><p>{live.error} Your earlier evaluations below are still available.</p></StatePanel>}
            </div>
          </section>

          <section aria-labelledby="ev-evidence-h">
            <h2 id="ev-evidence-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Review existing evidence</h2>
            {counts ? (
              <ul className="mt-2 grid gap-2 text-[13.5px] text-gray-800 sm:grid-cols-2">
                <li className="rounded-xl border border-gray-200 bg-white p-3"><span className="font-semibold tabular-nums">{counts.independentQuestions}</span> questions answered ({counts.attempts} answers in all) · <Link href={studyHref("revise")} className={`underline ${focusRing}`}>Revise</Link></li>
                <li className="rounded-xl border border-gray-200 bg-white p-3"><span className="font-semibold tabular-nums">{counts.reviews}</span> spaced recalls after a gap · <Link href={studyHref("revise")} className={`underline ${focusRing}`}>Review cards</Link></li>
                <li className="rounded-xl border border-gray-200 bg-white p-3"><span className="font-semibold tabular-nums">{counts.independentDecisions}</span> clinical case decisions ({counts.decisions} in all) · <Link href={studyHref("apply")} className={`underline ${focusRing}`}>Apply</Link></li>
                <li className="rounded-xl border border-gray-200 bg-white p-3"><span className="font-semibold tabular-nums">{counts.checks}</span> Teach Me checks (informal) · <Link href={studyHref("learn")} className={`underline ${focusRing}`}>Teach Me</Link></li>
              </ul>
            ) : <p className="mt-2 text-[13px] text-gray-600">Your evidence could not be read just now.</p>}
          </section>

          <section aria-labelledby="ev-start-h">
            <EvaluationStart methods={policy.scholarEvaluationMethods} materials={mats.map(m => ({ id: m.id, title: m.title }))}
              competencies={(learner.competencies ?? []).map(c => ({ id: c.id, title: `${c.code ? `${c.code} ` : ""}${c.title}`, outcomes: c.outcomes }))}
              contexts={policy.scholarCaseContexts.map(c => ({ value: c, label: CASE_CONTEXT_LABEL[c] }))} freshQuantity={policy.scholarEvaluationFreshQuantity}
              defaultScope={evaluationPrefill(study?.scope ?? null, { materialIds: mats.map(m => m.id), competencyIds: (learner.competencies ?? []).map(c => c.id) })} />
          </section>

          <section aria-labelledby="ev-hist-h">
            <h2 id="ev-hist-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Previous evaluations</h2>
            {!history.ok ? <p className="mt-2 text-[13px] text-gray-600">{history.notProvisioned ? "Evaluations are not kept here yet." : "Your evaluations could not be read just now."}</p>
              : history.data.length === 0 ? <p className="mt-2 text-[13px] text-gray-600">None yet. An evaluation you start, or one you keep, is listed here.</p> : (
                <ul className="mt-2 space-y-1.5">{history.data.map(h => (
                  <li key={h.id} className="text-[13.5px]">
                    <Link href={evaluationHref(h.id)} className={`font-semibold underline underline-offset-2 ${focusRing}`}>{h.scope?.label ?? "An evaluation"}</Link>
                    <span className="text-[12px] text-gray-500"> · {h.kind === "continuous" ? "kept from Evaluate my understanding" : EVALUATION_METHOD_LABEL[h.method]} · {EVALUATION_CONFIDENCE_LABEL[h.confidence as keyof typeof EVALUATION_CONFIDENCE_LABEL] ?? h.confidence} · {new Date(h.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                  </li>
                ))}</ul>
              )}
          </section>
        </div>
      )}
    </>
  );
}
