import Link from "next/link";
import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../../_components/shell-context";
import { PageHeader, StatePanel, focusRing } from "../../../../../../_components/chrome";
import StudyNav from "../../_components/StudyNav";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { countDue, libraryTopics, listEvaluations } from "@/lib/individual/scholar/store";
import { evaluateScope, type EvaluationScope } from "@/lib/individual/scholar/evaluation-data";
import { nextSteps, type NextRule } from "@/lib/individual/scholar/progress-next";
import { EVALUATION_CONFIDENCE_LABEL, EVALUATION_METHOD_LABEL, SELF_DIRECTED_LABEL } from "@/lib/individual/scholar/config";
import { EvaluationView } from "../../_components/evaluation-view";
import { nextHref } from "../../_components/progress-view";
import { evaluationHref, sourceHref, studyHref } from "../../_components/question-view";

// Request-time only: it reads the release gate and the evidence, and must never be prerendered at build.
export const dynamic = "force-dynamic";

// PROGRESS-01 (Progress, Stage 8 of 8) P3 and evidence transparency -- one area of the student's learning, opened:
// a competency, one of its learning outcomes, a material or a topic. Its separate indicators (Stage 7's evaluation
// of that scope), the material and sections behind them, the topics explored, how the evidence was marked, earlier
// evaluations of the same area, and what to do next. Without a catalogue, materials and topics are the way in.
// No AI. Not competence.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Progress in one area" });
}

type Q = { kind?: string; id?: string; outcome?: string; topic?: string };
function scopeOf(q: Q): EvaluationScope | null {
  if (q.kind === "competency" && q.id) return { kind: "competency", competencyId: q.id };
  if (q.kind === "outcome" && q.id && q.outcome) return { kind: "outcome", competencyId: q.id, outcome: q.outcome };
  if (q.kind === "document" && q.id) return { kind: "document", materialId: q.id };
  if (q.kind === "topic" && q.id) return { kind: "topic", topic: q.id };
  return null;
}

export default async function ExplorePage({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<Q> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const q = await searchParams;
  const scope = scopeOf(q);
  const [due, policy] = await Promise.all([countDue(ctx.admin, ctx.userId), loadIndividualPolicy(ctx.admin)]);
  const header = (title: string) => (
    <>
      <PageHeader accent={x.accent} eyebrow="Progress" title={title} intro="Why your progress here says what it says: the evidence behind it, how it was marked, and what to do next." />
      <StudyNav dueCount={due} />
      <p className="mb-5 text-[13px]"><Link href={studyHref("progress")} className={`underline ${focusRing}`}>Back to Progress</Link></p>
    </>
  );
  if (!scope) return <>{header("Progress")}<StatePanel title="Choose an area to explore"><p>Open a competency, a learning outcome or a material from Progress.</p></StatePanel></>;
  const r = await evaluateScope(ctx.admin, ctx.userId, policy, scope, { method: "existing", now: new Date().toISOString() });
  if (!r.ok) return <>{header("Progress")}<StatePanel title="That area could not be opened"><p>{r.error}</p></StatePanel></>;
  const e = r.evaluation;
  const [kept, topics] = await Promise.all([listEvaluations(ctx.admin, ctx.userId, 100), libraryTopics(ctx.admin, ctx.userId)]);
  const same = (kept.ok ? kept.data : []).filter(k => k.scope?.kind === r.scope.kind && JSON.stringify(k.scope?.ids ?? null) === JSON.stringify(r.scope.ids ?? null) && (k.scope?.outcome ?? null) === (r.scope.outcome ?? null));
  const materials = [...new Map(r.sections.map(s => [s.materialId, s.materialTitle])).entries()];
  const topicList = [...new Set(materials.flatMap(([id]) => (topics?.get(id) ?? []).flat()))].slice(0, 20);
  const steps = nextSteps(e, { unclassified: [], strongMaterials: [], rules: policy.scholarProgressNextRules as NextRule[], max: policy.scholarProgressNextMax });
  const c = e.evidence.counts;

  return (
    <>
      {header(r.scope.label)}
      <p className="mb-5 rounded-lg bg-gray-50 px-3 py-2 text-[12.5px] text-gray-700">{SELF_DIRECTED_LABEL} Observed practice on your own notes: not the level your framework expects, and not verified competence.</p>
      <div className="space-y-5">
        <section aria-labelledby="ex-ev-h" className="rounded-2xl border border-gray-200 bg-white p-4">
          <h2 id="ex-ev-h" className="text-[14px] font-bold text-gray-900">The evidence behind it</h2>
          <ul className="mt-2 space-y-1 text-[13.5px] text-gray-800">
            <li><span className="font-semibold">Relevant materials:</span> {materials.length ? materials.map(([id, t], i) => <span key={id}>{i ? ", " : ""}<Link href={studyHref(id)} className={`underline ${focusRing}`}>{t}</Link></span>) : "none linked yet"}</li>
            <li><span className="font-semibold">Sections:</span> {r.sections.slice(0, 12).map((s, i) => <span key={s.chunkId}>{i ? " · " : ""}<Link href={sourceHref(s.materialId, s.chunkId)} className={`underline ${focusRing}`}>{s.label}</Link></span>)}{r.sections.length > 12 ? ` and ${r.sections.length - 12} more` : ""}</li>
            <li><span className="font-semibold">Topics explored:</span> {topicList.length ? topicList.join(", ") : "none recorded for these materials yet"}</li>
            <li><span className="font-semibold">Revision:</span> {c.independentQuestions} questions answered ({c.attempts} answers in all) · {c.reviews} recalls after a gap</li>
            <li><span className="font-semibold">Clinical reasoning:</span> {c.independentDecisions} case decisions ({c.decisions} in all) · {e.reasoning.safetyMissed} safety points missed</li>
            <li><span className="font-semibold">How it was marked:</span> counted, by their key: {c.independentQuestions + c.independentDecisions} · evaluated by AI, shown apart: {e.knowledge.aiEvaluated.n + e.reasoning.written.aiEvaluated} · graded by you (self-reported), shown apart: {e.knowledge.selfReported.n + e.reasoning.written.selfReviewed} · Teach Me checks, informal: {c.checks}</li>
          </ul>
        </section>

        <EvaluationView r={{ ...e, recommendations: [] }} confidence={e.confidence} limitations={e.limitations} cfca={e.cfca} />

        <section aria-labelledby="ex-next-h" className="rounded-2xl border border-gray-200 bg-white p-4">
          <h2 id="ex-next-h" className="text-[14px] font-bold text-gray-900">What to do next here</h2>
          {steps.length === 0 ? <p className="mt-1 text-[13px] text-gray-600">Nothing to suggest from the evidence here.</p> : (
            <ul className="mt-2 space-y-2">{steps.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2"><Link href={nextHref(s)} className={`inline-flex min-h-[44px] items-center rounded-xl border border-gray-300 bg-white px-3 py-2 text-[13.5px] font-semibold pointer-coarse:min-h-[48px] ${focusRing}`} style={{ color: x.accent }}>{s.label}</Link><span className="text-[12.5px] text-gray-600">{s.reason}</span></li>
            ))}</ul>
          )}
        </section>

        <section aria-labelledby="ex-kept-h" className="rounded-2xl border border-gray-200 bg-white p-4">
          <h2 id="ex-kept-h" className="text-[14px] font-bold text-gray-900">Evaluations of this area</h2>
          {same.length === 0 ? <p className="mt-1 text-[13px] text-gray-600">None kept yet. You can evaluate it from Evaluate.</p> : (
            <ul className="mt-2 space-y-1 text-[13.5px]">{same.map(k => (
              <li key={k.id}><Link href={evaluationHref(k.id)} className={`underline ${focusRing}`}>{new Date(k.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</Link> <span className="text-gray-600">· {EVALUATION_METHOD_LABEL[k.method]} · {EVALUATION_CONFIDENCE_LABEL[k.confidence as keyof typeof EVALUATION_CONFIDENCE_LABEL] ?? k.confidence}</span></li>
            ))}</ul>
          )}
        </section>
      </div>
    </>
  );
}
