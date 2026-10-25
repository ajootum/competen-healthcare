import Link from "next/link";
import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../../_components/shell-context";
import { PageHeader, StatePanel, Unreadable, focusRing } from "../../../../../../_components/chrome";
import StudyNav from "../../_components/StudyNav";
import { countDue, getEvaluation } from "@/lib/individual/scholar/store";
import { EVALUATION_CONFIDENCE_LABEL, EVALUATION_LABEL, EVALUATION_METHOD_LABEL } from "@/lib/individual/scholar/config";
import { EvaluationView } from "../../_components/evaluation-view";
import { EvaluationActions, evaluationHref } from "../../_components/evaluation-client";
import { studyHref } from "../../_components/question-view";

// Request-time only: it reads the release gate and the record, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// EVALUATION-01 (Stage 6) E5 -- one kept evaluation, as it was made (426): its scope, method, the rules and the
// configuration version it applied, its results and their confidence and limitations, the evidence it read (by
// count; the evidence itself stays where it is), and any AI that marked answers it read. Opening it uses no AI,
// so it is always available. Evaluating again makes a NEW record that follows this one; this one never changes.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Evaluation" });
}

export default async function EvaluationRecordPage({ params }: { params: Promise<{ experience: string; id: string }> }) {
  const p = await params;
  const page = await experienceModulePage(p.experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const [due, r] = await Promise.all([countDue(ctx.admin, ctx.userId), getEvaluation(ctx.admin, ctx.userId, p.id)]);
  const header = (
    <>
      <PageHeader accent={x.accent} eyebrow="Evaluate" title={r.ok && r.data ? r.data.scope?.label ?? "Evaluation" : "Evaluation"} intro={EVALUATION_LABEL} />
      <StudyNav dueCount={due} />
    </>
  );
  if (!r.ok) return <>{header}<Unreadable what="this evaluation" /></>;
  if (!r.data) return <>{header}<StatePanel title="That evaluation could not be found" actions={<Link href={evaluationHref()} className={focusRing}>Back to Evaluate</Link>}><p>It may have been removed.</p></StatePanel></>;
  const e = r.data;
  const res = e.results;
  const counts = e.evidenceRefs?.counts ?? {};
  return (
    <>
      {header}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-gray-700">
          {e.kind === "continuous" ? "Kept from Evaluate my understanding" : EVALUATION_METHOD_LABEL[e.method]} · {new Date(e.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          {" · "}<span className="font-semibold">{EVALUATION_CONFIDENCE_LABEL[e.confidence as keyof typeof EVALUATION_CONFIDENCE_LABEL] ?? e.confidence}</span>
          {e.supersedesId ? <> · follows <Link href={evaluationHref(e.supersedesId)} className={`underline ${focusRing}`}>an earlier evaluation</Link></> : null}
        </p>
        <EvaluationActions id={e.id} scope={e.scope ?? { kind: "all" }} />
      </div>
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
