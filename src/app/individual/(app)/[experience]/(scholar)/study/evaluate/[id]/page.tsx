import Link from "next/link";
import type { Metadata } from "next";
import { loadStudy } from "@/lib/individual/scholar/study-context";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../../_components/shell-context";
import { PageHeader, StatePanel, Unreadable, focusRing } from "../../../../../../_components/chrome";
import StudyNav from "../../_components/StudyNav";
import { countDue, getEvaluation, getStudyPlan, loadPassportEvaluations, studyPlanSchema } from "@/lib/individual/scholar/store";
import { isStudyPlanOn, loadIndividualPolicy } from "@/lib/individual/policy";
import { listMonthlyReviews, monthlyReviewOn } from "@/lib/individual/scholar/monthly-review-data";
import { monthStanding, weakTopics, type MonthlyBreakdown } from "@/lib/individual/scholar/monthly-review";
import { MonthlyResults, type MonthlyResultsView } from "../../_components/monthly-results";
import { EVALUATION_CONFIDENCE_LABEL, EVALUATION_LABEL, EVALUATION_METHOD_LABEL } from "@/lib/individual/scholar/config";
import { EvaluationView } from "../../_components/evaluation-view";
import { EvaluationActions, PassportEvaluationChoice } from "../../_components/evaluation-client";
import { evaluationHref, studyHref } from "../../_components/question-view";

// Request-time only: it reads the release gate and the record, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// EVALUATION-01 (Stage 6) E5 -- one kept evaluation, as it was made (426): its scope, method, the rules and the
// configuration version it applied, its results and their confidence and limitations, the evidence it read (by
// count; the evidence itself stays where it is), and any AI that marked answers it read. Opening it uses no AI,
// so it is always available. Evaluating again makes a NEW record that follows this one; this one never changes.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Evaluation" });
}

export default async function EvaluationRecordPage({ params, searchParams }: { params: Promise<{ experience: string; id: string }>; searchParams: Promise<{ study?: string }> }) {
  const p = await params;
  const page = await experienceModulePage(p.experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const [due, r, policy, inPassport] = await Promise.all([countDue(ctx.admin, ctx.userId), getEvaluation(ctx.admin, ctx.userId, p.id), loadIndividualPolicy(ctx.admin), loadPassportEvaluations(ctx.admin, ctx.userId)]);
  // SCHOLAR-SESSION-AI-02: an open study session is carried by the tabs only; the record itself is unchanged.
  const study = await loadStudy(ctx.admin, ctx.userId, (await searchParams).study, "evaluate", policy);
  const header = (
    <>
      <PageHeader accent={x.accent} eyebrow="Evaluate" title={r.ok && r.data ? r.data.scope?.label ?? "Evaluation" : "Evaluation"} intro={EVALUATION_LABEL} />
      <StudyNav dueCount={due} study={study?.bar ?? null} />
    </>
  );
  if (!r.ok) return <>{header}<Unreadable what="this evaluation" /></>;
  if (!r.data) return <>{header}<StatePanel title="That evaluation could not be found" actions={<Link href={evaluationHref()} className={focusRing}>Back to Evaluate</Link>}><p>It may have been removed.</p></StatePanel></>;
  const e = r.data;
  const res = e.results;
  const counts = e.evidenceRefs?.counts ?? {};
  // SCHOLAR-MONTHLY-REVIEW-01: a monthly learning review shows its results by topic first. The six dimensions below are unchanged.
  const mr = e.context?.monthlyReview as { month: string; late: boolean; retakeOf?: string | null; blueprint?: { length: number; totals: { core: number; application: number; gaps: number }; sections: unknown[]; omittedSections: number } } | undefined;
  const breakdown = res?.monthly as MonthlyBreakdown | undefined;
  let monthlyView: MonthlyResultsView | null = null;
  if (mr && breakdown) {
    const all = await listMonthlyReviews(ctx.admin, ctx.userId);
    const standing = monthStanding(all ?? [], mr.month);
    const planOn = policy.scholarStudyPlan && isStudyPlanOn(policy, await studyPlanSchema(ctx.admin, ctx.userId));
    const plan = planOn ? await getStudyPlan(ctx.admin, ctx.userId) : null;
    const weak = weakTopics(breakdown);
    monthlyView = {
      month: mr.month, breakdown, planned: mr.blueprint?.length ?? breakdown.overall.asked, late: mr.late === true,
      original: all ? standing.original?.id === e.id : (mr.retakeOf ?? null) === null, originalId: standing.original?.id ?? mr.retakeOf ?? null,
      retakes: standing.retakes.map(x => ({ id: x.id, createdAt: x.createdAt })),
      blueprint: mr.blueprint ? { sections: mr.blueprint.sections.length, core: mr.blueprint.totals.core, application: mr.blueprint.totals.application, gaps: mr.blueprint.totals.gaps, omitted: mr.blueprint.omittedSections } : null,
      canRetake: monthlyReviewOn(policy), weak,
      plan: plan?.ok ? { priorities: plan.data?.priorities ?? [], settings: plan.data ? { examDate: plan.data.examDate ?? "", examLabel: plan.data.examLabel ?? "", weeklyMinutes: plan.data.weeklyMinutes, daysPerWeek: plan.data.daysPerWeek, goal: plan.data.goal ?? "" } : null } : null,
      progressHref: studyHref("progress"),
    };
  }
  return (
    <>
      {header}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-gray-700">
          {e.kind === "continuous" ? "Kept from Evaluate my understanding" : EVALUATION_METHOD_LABEL[e.method]} · {new Date(e.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          {" · "}<span className="font-semibold">{EVALUATION_CONFIDENCE_LABEL[e.confidence as keyof typeof EVALUATION_CONFIDENCE_LABEL] ?? e.confidence}</span>
          {e.supersedesId ? <> · follows <Link href={evaluationHref(e.supersedesId)} className={`underline ${focusRing}`}>an earlier evaluation</Link></> : null}
        </p>
        {mr ? null : <EvaluationActions id={e.id} scope={e.scope ?? { kind: "all" }} />}
      </div>
      {/* PROGRESS-01 P5: the student chooses whether this evaluation appears in their Passport. Fail-closed without 427. */}
      {policy.scholarPassportEvaluations === "offer" && inPassport.ok && (
        <div className="mb-5"><PassportEvaluationChoice evaluationId={e.id} shown={inPassport.data.some(x => x.evaluationId === e.id)} suggested={`Evaluation: ${e.scope?.label ?? "my learning"}`} /></div>
      )}
      {monthlyView && <MonthlyResults v={monthlyView} accent={x.accent} />}
      <EvaluationView r={res} confidence={res.confidenceDetail} limitations={e.limitations} cfca={e.cfca?.tree ?? null} />
      <section aria-labelledby="ev-prov-h" className="mt-5 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 id="ev-prov-h" className="text-[14px] font-bold text-gray-900">How this evaluation was made</h2>
        <ul className="mt-2 space-y-0.5 text-[13px] text-gray-700">
          <li>Evidence read: {counts.independentQuestions ?? 0} questions ({counts.attempts ?? 0} answers), {counts.reviews ?? 0} recalls, {counts.independentDecisions ?? 0} case decisions, {counts.checks ?? 0} Teach Me checks{counts.fresh ? `; ${counts.fresh} answers from the knowledge check` : ""}. The evidence stays where it is: this record names it.</li>
          <li>Interpretation: by fixed rules, with no AI. {e.aiProvenance?.aiEvaluatedAnswers ? `${e.aiProvenance.aiEvaluatedAnswers} answer${e.aiProvenance.aiEvaluatedAnswers === 1 ? " it read was" : "s it read were"} evaluated by AI${(e.aiProvenance.models ?? []).length ? ` (${e.aiProvenance.models.join(", ")})` : ""}, shown apart.` : "No answer it read was evaluated by AI."}</li>
          <li>Rules applied: evidence needed {e.criteria?.rules?.minEvidence}, breadth {e.criteria?.rules?.minSources} sections, recent within {e.criteria?.rules?.recencyDays} days, strong from {e.criteria?.rules?.bands?.strong}% and developing from {e.criteria?.rules?.bands?.developing}%. Configuration {e.configVersion}.</li>
          {e.context?.programme ? <li>Educational context: {e.context.programme}{e.context.level ? `, ${e.context.level}` : ""}.</li> : <li>No programme chosen: no competency catalogue applied.</li>}
          {e.freshSessionId ? <li><Link href={`${studyHref("revise")}?session=${e.freshSessionId}`} className={`underline ${focusRing}`}>The knowledge check</Link></li> : null}
        </ul>
      </section>
    </>
  );
}
