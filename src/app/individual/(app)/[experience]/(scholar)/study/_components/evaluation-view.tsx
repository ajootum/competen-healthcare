import Link from "next/link";
import { LearningIcon, LearningSectionHead, type LearningIconName } from "@/components/ui/scholar-learning";
import { EVALUATION_BAND_LABEL, EVALUATION_CONFIDENCE_LABEL, EVALUATION_DIMENSION_LABEL } from "@/lib/individual/scholar/config";
import { CASE_DIMENSION_LABEL } from "@/lib/individual/scholar/config";
import type { Area, Confidence, Evaluation, Recommendation } from "@/lib/individual/scholar/evaluation";
import { sourceHref, studyHref } from "./question-view";
import { FormativeAiLabel } from "./edu-notice";

// EVALUATION-01 (Stage 6) E1/E4: one evaluation as the student reads it -- the live, continuous one or a kept
// record. Six dimensions, each on its own card and never summed; what each could not say, said in its place; the
// strengths and gaps at the most specific level the evidence supports; next steps that open Scholar's own
// experiences; the limitations; and, always, that verified clinical competence is not assessed here.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[var(--learn-border)] bg-[var(--cmp-app-surface)] px-3 py-2 text-[14px] font-semibold text-[var(--learn-ink)] hover:bg-[var(--learn-surface)] pointer-coarse:min-h-[48px] ${focusRing}`;
// SCHOLAR LEARNING DESIGN SYSTEM (Evaluate): each dimension is a card in the check (lavender) tone; supporting cards take
// the record, sources, next and summary tones. Bands are formative, never punitive: words with a shape, never red or a
// reassuring green (strong: a ring with a tick in the check tone; developing and needs work: the calm revision amber,
// told apart by their words and by a half or dashed ring).
const BAND_TONE = {
  strong: "border-[var(--cmp-learn-check-border)] bg-[var(--cmp-learn-check-surface)] text-[var(--cmp-learn-check-ink)]",
  developing: "border-[var(--cmp-role-revision-accent)] bg-[var(--cmp-role-revision-soft)] text-[var(--cmp-role-revision-ink)]",
  needs_work: "border-[var(--cmp-role-revision-strong)] bg-[var(--cmp-role-revision-soft)] text-[var(--cmp-role-revision-ink)]",
} as const;
const BAND_MARK: Record<keyof typeof BAND_TONE, LearningIconName> = { strong: "check", developing: "layers", needs_work: "miss" };
// Plain class names, not learnBox(): this view also renders on the server, where a client module's functions cannot be called.
const head = (tone: "check" | "record" | "sources" | "next" | "summary") => `cmp-learn-${tone} cmp-learn-box p-4 sm:p-5`;

type Measured = { state: "measured" } & Record<string, unknown>;
type Absent = { state: "insufficient"; have: number; need: number; reason: string } | { state: "not_measured"; reason: string };
export type EvaluationResults = Pick<Evaluation, "knowledge" | "retention" | "application" | "reasoning" | "coverage" | "strengths" | "gaps" | "insufficientAreas" | "retentionDifficulties" | "reasoningWeaknesses" | "recommendations" | "verified">;

function AbsentText({ m }: { m: Absent }) {
  return (
    <p className="mt-2 text-[14px] leading-relaxed text-gray-800">
      <span className="font-semibold">{m.state === "insufficient" ? `Too little evidence to say (${m.have} of ${m.need})` : "Not measured"}.</span> {m.reason}
    </p>
  );
}
function Band({ band }: { band: keyof typeof EVALUATION_BAND_LABEL }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-bold ${BAND_TONE[band]}`}><LearningIcon name={BAND_MARK[band]} className="h-3.5 w-3.5" />{EVALUATION_BAND_LABEL[band]}</span>;
}
function Card({ id, dim, children }: { id: string; dim: keyof typeof EVALUATION_DIMENSION_LABEL; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className={head("check")}>
      <h3 id={id} className="cmp-learn-ink text-[15.5px] font-bold">{EVALUATION_DIMENSION_LABEL[dim].title}</h3>
      <p className="mt-0.5 text-[13px] text-gray-700">{EVALUATION_DIMENSION_LABEL[dim].what}</p>
      {children}
    </section>
  );
}
function Figure({ m, noun }: { m: Measured & { correct?: number; independent?: number; percent?: number; band?: keyof typeof EVALUATION_BAND_LABEL; repeats?: number }; noun: string }) {
  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-2">
      <p className="text-[24px] font-bold tabular-nums text-gray-900">{m.percent}%</p>
      <p className="text-[14px] text-gray-800">{m.correct} of {m.independent} {noun} right</p>
      {m.band && <Band band={m.band} />}
      {m.repeats ? <p className="w-full text-[12.5px] text-gray-600">{m.repeats} repeated answer{m.repeats === 1 ? "" : "s"} on the same items: counted as practice, not as more evidence.</p> : null}
    </div>
  );
}

export function recommendationHref(r: Recommendation): string | null {
  if (r.kind === "teach") return r.chunkId ? `${studyHref("learn")}?section=${r.chunkId}` : studyHref("learn");
  if (r.kind === "revise" || r.kind === "spaced") return studyHref("revise");
  if (r.kind === "case") return r.chunkId ? `${studyHref("apply")}?section=${r.chunkId}&from=revision` : studyHref("apply");
  return r.materialId && r.chunkId ? sourceHref(r.materialId, r.chunkId) : r.materialId ? studyHref(r.materialId) : null;
}

const partHead = "flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.08em] text-gray-700";
function AreaList({ title, icon, areas, empty }: { title: string; icon: LearningIconName; areas: Area[]; empty: string }) {
  return (
    <div className="rounded-xl bg-[var(--cmp-app-surface)] p-3.5 ring-1 ring-[var(--learn-border)]">
      <h4 className={partHead}><span className="cmp-learn-accent"><LearningIcon name={icon} className="h-4 w-4" /></span>{title}</h4>
      {areas.length === 0 ? <p className="mt-1.5 text-[13.5px] text-gray-700">{empty}</p> : (
        <ul className="mt-1.5 space-y-2">{areas.map(a => (
          <li key={`${a.kind}${a.key}`} className="text-[14px] leading-relaxed text-gray-900">
            <span className="font-semibold">{a.label}</span>
            {a.context ? <span className="text-gray-600"> · {a.context}</span> : null}
            <span className="text-gray-600"> · {a.percent !== null ? `${a.correct} of ${a.n} right` : `${a.n} piece${a.n === 1 ? "" : "s"} of evidence`}</span>
            {a.expected ? <span className="text-gray-500"> · expected level: {a.expected}</span> : null}
            {a.band ? <> <Band band={a.band} /></> : null}
          </li>
        ))}</ul>
      )}
    </div>
  );
}

export function EvaluationView({ r, confidence, limitations, cfca }: { r: EvaluationResults; confidence: Confidence; limitations: string[]; cfca: Evaluation["cfca"] }) {
  const k = r.knowledge, ret = r.retention, app = r.application, rs = r.reasoning, cov = r.coverage;
  return (
    <div className="space-y-5">
      {/* SCHOLAR-EDU-AI-01 s4: once, above the results. */}
      <FormativeAiLabel evaluation />
      <section aria-labelledby="ev-conf" className={head("record")}>
        <LearningSectionHead icon="record" level={3} id="ev-conf" caps={false} title={`${EVALUATION_DIMENSION_LABEL.confidence.title}: ${EVALUATION_CONFIDENCE_LABEL[confidence.level]}`} />
        <p className="mt-1.5 text-[13px] text-gray-700">{EVALUATION_DIMENSION_LABEL.confidence.what}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] leading-relaxed text-gray-900">{confidence.reasons.map(x => <li key={x}>{x}</li>)}</ul>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Card id="ev-k" dim="knowledge">
          {k.state === "measured" ? <Figure m={k as unknown as Measured} noun="questions" /> : <AbsentText m={k as Absent} />}
          <p className="mt-2 text-[13px] text-gray-700">
            Shown apart, not counted: {k.aiEvaluated.n} evaluated by AI ({k.aiEvaluated.correct} judged right) · {k.selfReported.n} graded by you · Teach Me checks: {k.informalChecks.understood} understood, {k.informalChecks.partly} partly, {k.informalChecks.notYet} not yet.
          </p>
        </Card>
        <Card id="ev-r" dim="retention">
          {ret.state === "measured" ? (
            <div className="mt-2 flex flex-wrap items-baseline gap-2">
              <p className="text-[24px] font-bold tabular-nums text-gray-900">{ret.percent}%</p>
              <p className="text-[14px] text-gray-800">{ret.successful} of {ret.recalls} recalls held · longest gap {ret.longestIntervalDays} days</p>
              <Band band={ret.band} />
            </div>
          ) : <AbsentText m={ret} />}
        </Card>
        <Card id="ev-a" dim="application">
          {app.state === "measured" ? <Figure m={app as unknown as Measured} noun="scenario questions" /> : <AbsentText m={app} />}
        </Card>
        <Card id="ev-cr" dim="reasoning">
          {rs.state === "measured" ? (
            <>
              <Figure m={rs as unknown as Measured} noun="case decisions" />
              <ul className="mt-2 space-y-1 text-[14px] text-gray-900">{rs.byDimension.map(d => <li key={d.dimension}>{CASE_DIMENSION_LABEL[d.dimension] ?? d.dimension}: {d.correct} of {d.n}</li>)}</ul>
            </>
          ) : <AbsentText m={rs as Absent} />}
          <p className="mt-2 text-[13px] text-gray-700">Safety points missed: {rs.safetyMissed} · written answers shown apart: {rs.written.aiEvaluated} evaluated by AI, {rs.written.selfReviewed} reviewed by you.</p>
        </Card>
        <Card id="ev-c" dim="coverage">
          {cov.state === "measured" ? (
            <p className="mt-2 text-[14px] leading-relaxed text-gray-900">
              <span className="font-semibold tabular-nums">{cov.sections.worked} of {cov.sections.total}</span> sections worked on, across {cov.materials} material{cov.materials === 1 ? "" : "s"}
              {cov.outcomes ? <>; <span className="font-semibold tabular-nums">{cov.outcomes.worked} of {cov.outcomes.total}</span> linked learning outcomes</> : <>; no section here is linked to a learning outcome</>}.
            </p>
          ) : <AbsentText m={cov} />}
        </Card>
        <section aria-labelledby="ev-v" className="cmp-learn-summary rounded-2xl border-2 border-dashed border-[var(--learn-border)] bg-[var(--cmp-app-surface)] p-4 sm:p-5">
          <h3 id="ev-v" className="cmp-learn-ink flex items-center gap-2 text-[15.5px] font-bold"><span className="cmp-learn-accent"><LearningIcon name="warn" className="h-5 w-5" /></span>Verified clinical competence</h3>
          <p className="mt-1.5 text-[14px] leading-relaxed text-gray-800"><span className="font-semibold">Not assessed here.</span> {r.verified.reason}</p>
        </section>
      </div>

      <section aria-labelledby="ev-sg" className={head("check")}>
        <LearningSectionHead icon="target" level={3} id="ev-sg" caps={false} title="Strengths and learning gaps" />
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <AreaList title="Demonstrated strengths" icon="check" areas={r.strengths} empty="None shown yet: no area has enough evidence in the strong band." />
          <AreaList title="Learning gaps" icon="miss" areas={r.gaps} empty="None shown: no area with enough evidence is below the developing band." />
          <AreaList title="Too little evidence to say" icon="question" areas={r.insufficientAreas} empty="Every area worked on has enough evidence." />
          <div className="rounded-xl bg-[var(--cmp-app-surface)] p-3.5 ring-1 ring-[var(--learn-border)]">
            <h4 className={partHead}><span className="cmp-learn-accent"><LearningIcon name="layers" className="h-4 w-4" /></span>Retention difficulties and reasoning weaknesses</h4>
            {r.retentionDifficulties.length === 0 && r.reasoningWeaknesses.length === 0 ? <p className="mt-1.5 text-[13.5px] text-gray-700">None found in this evidence.</p> : (
              <ul className="mt-1.5 space-y-1.5 text-[14px] leading-relaxed text-gray-900">
                {r.retentionDifficulties.map(d => <li key={d.chunkId}>Recall did not hold {d.failed} time{d.failed === 1 ? "" : "s"}: {d.label}</li>)}
                {r.reasoningWeaknesses.map(d => <li key={d.dimension}>Weaker in {CASE_DIMENSION_LABEL[d.dimension] ?? d.dimension}: {d.correct} of {d.n}</li>)}
              </ul>
            )}
          </div>
        </div>
      </section>

      {cfca && (
        <section aria-labelledby="ev-cfca" className={head("sources")}>
          <LearningSectionHead icon="layers" level={3} id="ev-cfca" caps={false} title="By your competency framework" />
          <p className="mt-1.5 text-[13px] text-gray-700">Domain › practice unit › competency › learning outcome, where your notes are linked. Observed performance on your own practice: not the expected level, and not verified competence.</p>
          {cfca.map(d => (
            <div key={d.domain} className="mt-3">
              <p className="text-[14.5px] font-bold text-gray-900">{d.domain}</p>
              {d.units.map(u => (
                <div key={u.name} className="ml-3 mt-1">
                  <p className="text-[13.5px] font-semibold text-gray-800">{u.name}</p>
                  <ul className="ml-3 space-y-1 text-[14px] text-gray-900">
                    {u.competencies.map(c => <li key={c.key}>{c.label}: {c.percent !== null ? `${c.correct} of ${c.n}` : "too little evidence"}{c.expected ? ` · expected ${c.expected}` : ""}</li>)}
                    {u.outcomes.map(o => <li key={o.key} className="text-gray-700">↳ {o.label}: {o.percent !== null ? `${o.correct} of ${o.n}` : "too little evidence"}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      {r.recommendations.length > 0 && (
        <section aria-labelledby="ev-next" className={head("next")}>
          <LearningSectionHead icon="target" level={3} id="ev-next" caps={false} title="What to do next" />
          <ul className="mt-3 space-y-2.5">{r.recommendations.map((x, i) => {
            const href = recommendationHref(x);
            return (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {href ? <Link href={href} className={ghost}>{x.label}<LearningIcon name="arrow" className="ml-1.5 h-4 w-4" /></Link> : <span className="text-[14px] font-semibold">{x.label}</span>}
                <span className="min-w-0 flex-1 basis-[14rem] text-[13.5px] text-gray-700">{x.reason}</span>
              </li>
            );
          })}</ul>
        </section>
      )}

      <section aria-labelledby="ev-lim" className={head("summary")}>
        <LearningSectionHead icon="summary" level={3} id="ev-lim" caps={false} title="What this evaluation cannot say" />
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] leading-relaxed text-gray-800">{limitations.map(x => <li key={x}>{x}</li>)}</ul>
      </section>
    </div>
  );
}
