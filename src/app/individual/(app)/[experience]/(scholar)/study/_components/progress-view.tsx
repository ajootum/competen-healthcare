import Link from "next/link";
import { LearningSectionHead, SectionCard } from "@/components/ui/scholar-learning";
import { CASE_DIMENSION_LABEL, EVALUATION_BAND_LABEL, EVALUATION_CONFIDENCE_LABEL } from "@/lib/individual/scholar/config";
import type { ProgressView } from "@/lib/individual/scholar/progress-data";
import type { NextStep } from "@/lib/individual/scholar/progress-next";
import type { PeriodKind, Trend } from "@/lib/individual/scholar/progress-history";
import { enoughForTrend, listSummary, measureGroups, noMeasureLine, TREND_NEEDS, type ActivitySummary } from "@/lib/individual/scholar/progress-simplify";
import { evaluationHref, sourceHref, studyHref } from "./question-view";
import { Band } from "./evaluation-view";
import { Fold, NotMeasuredLine, toneAction } from "./progress-parts";

// PROGRESS-01 (Progress, Stage 8 of 8) P1-P4 -- the student's learning command centre, above the existing per-material
// detail. What to do next comes first. Each dimension stays on its own card with why it says what it says, and a
// way to the evidence. Development over time keeps new evidence apart from repeated practice. Engagement and
// coverage are labelled as what they are, never as understanding, and nothing here is verified competence.
// DS rollout: next in the next tone, each measure in the check tone (Evaluate's dimension cards), the record of activity and confidence in record,
// development over time in summary, the framework in sources. A band is words with a shape.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const TREND = { improving: "Improving", steady: "Steady", lower: "Lower than before" } as const;

/** Where a next step opens, with its context: the section, the material, the difficulty. */
export function nextHref(s: NextStep): string {
  switch (s.kind) {
    case "teach": return s.chunkId ? `${studyHref("learn")}?section=${s.chunkId}` : studyHref("learn");
    case "revise": return s.materialId ? `${studyHref("revise")}?material=${s.materialId}` : studyHref("revise");
    case "advance": return s.materialId ? `${studyHref("revise")}?material=${s.materialId}&difficulty=harder` : studyHref("revise");
    case "spaced": return studyHref("revise");
    case "case": return s.chunkId ? `${studyHref("apply")}?section=${s.chunkId}&from=revision` : studyHref("apply");
    case "evaluate": return `${evaluationHref()}#ev-start-h`;
    case "classify": return s.materialId ? studyHref(s.materialId) : studyHref();
    case "material": return s.materialId && s.chunkId ? sourceHref(s.materialId, s.chunkId) : studyHref();
  }
}
export const exploreHref = (kind: string, id: string, extra = "") => `${studyHref("progress/explore")}?kind=${kind}&id=${encodeURIComponent(id)}${extra}`;

function Card({ id, title, what, why, children, href, tone = "check" }: { id: string; title: string; what: string; why?: string | null; children: React.ReactNode; href?: string; tone?: "check" | "record" }) {
  return (
    <section aria-labelledby={id} className={`cmp-learn-${tone} cmp-learn-box p-4 sm:p-5`}>
      <h3 id={id} className="cmp-learn-ink text-[15.5px] font-bold">{title}</h3>
      <p className="mt-0.5 text-[13px] leading-relaxed text-gray-700">{what}</p>
      <div className="mt-2.5">{children}</div>
      {why ? <p className="mt-2.5 text-[13px] leading-relaxed text-gray-700"><span className="font-semibold">Why:</span> {why}</p> : null}
      {href ? <p className="mt-1.5 text-[13px]"><Link href={href} className={toneAction.link}>See the evidence</Link></p> : null}
    </section>
  );
}
type M = { state: string; percent?: number; correct?: number; independent?: number; band?: keyof typeof EVALUATION_BAND_LABEL; have?: number; need?: number; reason?: string };
function Dim({ m, noun }: { m: M; noun: string }) {
  if (m.state === "measured") return <p className="text-[13.5px] text-gray-900"><span className="text-[20px] font-bold tabular-nums">{m.percent}%</span> · {m.correct} of {m.independent} {noun} <Band band={m.band!} /></p>;
  return <p className="text-[13.5px] text-gray-700"><span className="font-semibold">{m.state === "insufficient" ? `Too little evidence to say (${m.have} of ${m.need})` : "Not measured"}.</span> {m.reason}</p>;
}
const trendText = (t: Trend) => (t ? TREND[t] : "Not enough evidence for a trend yet");

const fmt = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * ONE learning-activity block, from the shared definition of a study day: the progress workspace and Learning Intelligence each had one, saying
 * nearly the same thing with possibly different words. Activity, not understanding.
 */
export function LearningActivity({ a }: { a: ActivitySummary }) {
  return (
    <section aria-labelledby="pg-activity-h" className="cmp-learn-record cmp-learn-box p-4 sm:p-5" data-testid="learning-activity">
      <LearningSectionHead icon="record" level={2} id="pg-activity-h" caps={false} title="Your learning activity" />
      <p className="mt-1.5 text-[13.5px] text-gray-800">What you did in the last {a.windowDays} days. Activity, not understanding.</p>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><dt className="text-[12.5px] font-semibold text-gray-700">Study days</dt><dd className="text-[22px] font-bold tabular-nums text-gray-900">{a.studyDays}</dd></div>
        {a.activeWeeks !== null && <div><dt className="text-[12.5px] font-semibold text-gray-700">Active weeks</dt><dd className="text-[22px] font-bold tabular-nums text-gray-900">{a.activeWeeks} of {a.weeks}</dd></div>}
        <div><dt className="text-[12.5px] font-semibold text-gray-700">Answers</dt><dd className="text-[22px] font-bold tabular-nums text-gray-900">{a.answers}</dd></div>
        {a.reviews !== null && <div><dt className="text-[12.5px] font-semibold text-gray-700">Reviews</dt><dd className="text-[22px] font-bold tabular-nums text-gray-900">{a.reviews}</dd></div>}
      </dl>
      <p className="mt-2 text-[13px] text-gray-700">
        {a.lastStudied ? `Last studied ${fmt(a.lastStudied)}.` : "No study recorded yet."}
        {a.decisions ? ` ${a.decisions} case decision${a.decisions === 1 ? "" : "s"}.` : ""}{a.checks ? ` ${a.checks} Teach Me check${a.checks === 1 ? "" : "s"}.` : ""}
      </p>
    </section>
  );
}

export function ProgressWorkspace({ v, sections, period, activity, hideNext = false }: {
  v: Extract<ProgressView, { ok: true }>; sections: readonly string[]; period: PeriodKind;
  /** The one learning-activity block (the shared definition of a study day), or null. */
  activity: ActivitySummary | null;
  /** My Plan is on: what to study next lives there, so the next-step list is not repeated here. */
  hideNext?: boolean;
}) {
  const e = v.evaluation, show = (s: string) => sections.includes(s);
  const k = e.knowledge, app = e.application, rs = e.reasoning, ret = e.retention, cov = e.coverage;
  const evidence = evaluationHref();
  const cards = [
    { id: "coverage", title: "Knowledge coverage", state: cov.state },
    { id: "understanding", title: "Understanding", state: k.state },
    { id: "retention", title: "Retention", state: ret.state },
    { id: "application", title: "Application and clinical reasoning", state: app.state === "measured" || rs.state === "measured" ? "measured" : app.state },
  ].filter(c => show(c.id));
  const groups = measureGroups(cards);
  const has = (id: string) => groups.measured.includes(id);
  return (
    <div className="mb-6 space-y-6">
      <section aria-labelledby="pg-mine-h" className="cmp-learn-next cmp-learn-box p-4 sm:p-5">
        <LearningSectionHead icon="target" level={2} id="pg-mine-h" caps={false} title="My learning progress" />
        <p className="mt-1.5 text-[13.5px] text-gray-800">
          {v.context.programme ? <>{v.context.programme}{v.context.level ? `, ${v.context.level}` : ""} · </> : "No programme chosen: progress is by material and section · "}
          {v.engagement.lastStudied ? `last studied ${new Date(v.engagement.lastStudied).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "not studied yet"} · {EVALUATION_CONFIDENCE_LABEL[e.confidence.level]}
        </p>
        {!hideNext && (
          <>
            <h3 className="cmp-learn-ink mt-4 text-[13px] font-bold uppercase tracking-[0.08em]">Recommended next steps</h3>
            {v.next.length === 0 ? <p className="mt-1 text-[13.5px] text-gray-800">Nothing to suggest from your evidence right now. Keep learning, and suggestions appear as your evidence grows.</p> : (
              <ul className="mt-2 space-y-2">{v.next.map((s, i) => (
                <SectionCard key={i} as="li" className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Link href={nextHref(s)} className={i === 0 ? toneAction.primary : toneAction.secondary}>{s.label}</Link>
                  <span className="min-w-0 flex-1 basis-[14rem] text-[13.5px] leading-relaxed text-gray-800">{s.reason}</span>
                </SectionCard>
              ))}</ul>
            )}
          </>
        )}
      </section>

      {activity && <LearningActivity a={activity} />}


      {groups.none && <NotMeasuredLine text={noMeasureLine("coverage, understanding, retention or application")} href={evidence} />}
      <div className="grid gap-4 md:grid-cols-2">
        {has("coverage") && cov.state === "measured" && (
          <Card id="pg-cov" title="Knowledge coverage" what="Which sections and learning outcomes you have worked on. Not what you know." href={evidence}
            why={`${cov.sections.worked} of ${cov.sections.total} sections have an answer, a check or a case on them.`}>
            <p className="text-[13.5px] text-gray-900"><span className="font-semibold tabular-nums">{cov.sections.worked} of {cov.sections.total}</span> sections{cov.outcomes ? <> · <span className="font-semibold tabular-nums">{cov.outcomes.worked} of {cov.outcomes.total}</span> linked learning outcomes</> : null}</p>
          </Card>
        )}
        {has("understanding") && (
          <Card id="pg-und" title="Understanding" what="Structured questions, each counted once on its latest answer, marked by its key." href={evidence}
            why={`${k.aiEvaluated.n} answers evaluated by AI and ${k.selfReported.n} graded by you are shown apart and not counted here.`}>
            <Dim m={k as M} noun="questions right" />
          </Card>
        )}
        {has("retention") && ret.state === "measured" && (
          <Card id="pg-ret" title="Retention" what="What you recalled after a gap of a day or more." href={evidence}
            why={`${ret.successful} of ${ret.recalls} recalls held; the longest gap was ${ret.longestIntervalDays} days.`}>
            <p className="text-[13.5px] text-gray-900"><span className="text-[20px] font-bold tabular-nums">{ret.percent}%</span> · {ret.successful} of {ret.recalls} recalls <Band band={ret.band} /></p>
          </Card>
        )}
        {has("application") && (
          <Card id="pg-app" title="Application and clinical reasoning" what="Scenario questions, and decisions in your clinical cases by reasoning dimension." href={evidence}
            why={`Safety points missed in cases: ${rs.safetyMissed}. Written case answers are shown apart.`}>
            {app.state === "measured" && (<><p className="text-[12.5px] font-semibold text-gray-800">Application</p><Dim m={app as M} noun="scenario questions right" /></>)}
            {rs.state === "measured" && (
              <>
                <p className="mt-2 text-[12.5px] font-semibold text-gray-800">Clinical reasoning</p>
                <Dim m={rs as M} noun="case decisions right" />
                <p className="mt-1 text-[12.5px] text-gray-700">{rs.byDimension.map(d => `${CASE_DIMENSION_LABEL[d.dimension] ?? d.dimension} ${d.correct}/${d.n}`).join(" · ")}</p>
              </>
            )}
          </Card>
        )}
        {show("confidence") && (
          <Card id="pg-conf" tone="record" title="Evidence confidence" what="How far your progress can be relied on: amount, breadth, recency and how it was marked." href={evidence}>
            <p className="text-[13.5px] font-semibold text-gray-900">{EVALUATION_CONFIDENCE_LABEL[e.confidence.level]}</p>
            <ul className="mt-1 list-disc pl-5 text-[13px] leading-relaxed text-gray-800">{e.confidence.reasons.map(x => <li key={x}>{x}</li>)}</ul>
          </Card>
        )}
      </div>
      {groups.line && <NotMeasuredLine text={groups.line} href={evidence} />}

      {show("history") && (
        <section aria-labelledby="pg-hist-h" className="cmp-learn-summary cmp-learn-box p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <LearningSectionHead icon="summary" level={2} id="pg-hist-h" caps={false} title="Development over time" className="min-w-[14rem] flex-1" />
            <nav aria-label="Period" className="flex flex-wrap gap-1 text-[13px]">{(["week", "month", "programme"] as const).map(p => (
              <Link key={p} href={`${studyHref("progress")}?period=${p}`} aria-current={p === period ? "page" : undefined}
                className={`inline-flex min-h-[36px] items-center rounded-lg border px-2.5 py-1.5 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing} ${p === period ? "border-[var(--learn-ink)] bg-[var(--learn-ink)] font-semibold text-[var(--learn-surface)]" : "border-[var(--learn-border)] bg-[var(--cmp-app-surface)] text-gray-800"}`}>
                {p === "week" ? "By week" : p === "month" ? "By month" : "By programme"}
              </Link>
            ))}</nav>
          </div>
          <p className="mt-2 text-[13.5px] leading-relaxed text-gray-800">
            New questions: {trendText(v.history.trends.knowledge)} · Recall: {trendText(v.history.trends.retention)} · Case decisions: {trendText(v.history.trends.reasoning)}
          </p>
          {(() => {
            const table = (
          <div className="mt-2 overflow-x-auto rounded-xl bg-[var(--cmp-app-surface)] px-3 py-1 ring-1 ring-[var(--learn-border)]">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead><tr className="border-b border-gray-200 text-gray-600">
                <th scope="col" className="py-1.5 pr-2 font-semibold">Period</th>
                <th scope="col" className="py-1.5 pr-2 font-semibold">New questions (first try)</th>
                <th scope="col" className="py-1.5 pr-2 font-semibold">Practised again</th>
                <th scope="col" className="py-1.5 pr-2 font-semibold">Recall held</th>
                <th scope="col" className="py-1.5 pr-2 font-semibold">New case decisions</th>
                <th scope="col" className="py-1.5 pr-2 font-semibold">Evaluations</th>
              </tr></thead>
              <tbody>{v.history.rows.map(r => (
                <tr key={r.key} className="border-b border-gray-100">
                  <th scope="row" className="py-1.5 pr-2 font-semibold text-gray-900">{r.label}</th>
                  <td className="py-1.5 pr-2 tabular-nums">{r.knowledge.n ? `${r.knowledge.correct} of ${r.knowledge.n}${r.knowledge.percent !== null ? ` (${r.knowledge.percent}%)` : ""}` : "—"}</td>
                  <td className="py-1.5 pr-2 tabular-nums text-gray-600">{r.exposure.answers ? `${r.exposure.correct} of ${r.exposure.answers}` : "—"}</td>
                  <td className="py-1.5 pr-2 tabular-nums">{r.retention.n ? `${r.retention.correct} of ${r.retention.n}${r.retention.percent !== null ? ` (${r.retention.percent}%)` : ""}` : "—"}</td>
                  <td className="py-1.5 pr-2 tabular-nums">{r.reasoning.n ? `${r.reasoning.correct} of ${r.reasoning.n}${r.reasoning.percent !== null ? ` (${r.reasoning.percent}%)` : ""}` : "—"}</td>
                  <td className="py-1.5 pr-2">{r.evaluations.length ? r.evaluations.map(x => <Link key={x.id} href={evaluationHref(x.id)} className={`mr-1 underline ${focusRing}`}>{EVALUATION_CONFIDENCE_LABEL[x.confidence as keyof typeof EVALUATION_CONFIDENCE_LABEL] ?? x.confidence}</Link>) : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
            );
            return enoughForTrend(v.history.rows.map(r => r.knowledge.n + r.exposure.answers + r.retention.n + r.reasoning.n))
              ? table
              : (<><p className="mt-2 text-[13.5px] text-gray-800" data-testid="trend-needs">{TREND_NEEDS}</p><div className="mt-2"><Fold summary={listSummary({ one: "period" }, v.history.rows.length)}><div className="px-4 pb-3">{table}</div></Fold></div></>);
          })()}
          <ul className="mt-2 list-disc pl-5 text-[13px] leading-relaxed text-gray-700">{v.history.notes.map(n => <li key={n}>{n}</li>)}</ul>
        </section>
      )}

      {show("competencies") && (
        <section aria-labelledby="pg-cfca-h" className="cmp-learn-sources cmp-learn-box p-4 sm:p-5">
          <LearningSectionHead icon="layers" level={2} id="pg-cfca-h" caps={false} title={e.cfca ? "By your competency framework" : "By material"} />
          <div className="mt-3"><Fold summary={e.cfca ? listSummary({ one: "domain" }, e.cfca.length, `${v.topics.length} topics`) : listSummary({ one: "material" }, v.materials.length, `${v.topics.length} topics`)}>
          <div className="p-4">
          {e.cfca ? (
            <>
              <p className="text-[13px] leading-relaxed text-gray-700">Domain › practice unit › competency › learning outcome. Open one to see its evidence. Observed practice, not verified competence.</p>
              {e.cfca.map(d => (
                <div key={d.domain} className="mt-2">
                  <p className="text-[13.5px] font-bold text-gray-900">{d.domain}</p>
                  {d.units.map(u => (
                    <div key={u.name} className="ml-3">
                      <p className="text-[13px] font-semibold text-gray-700">{u.name}</p>
                      <ul className="ml-3 space-y-1 text-[13.5px] pointer-coarse:space-y-3">
                        {u.competencies.map(c => <li key={c.key}><Link href={exploreHref("competency", c.key)} className={`underline ${focusRing}`}>{c.label}</Link> <span className="text-gray-600">· {c.percent !== null ? `${c.correct} of ${c.n}` : "too little evidence"}</span></li>)}
                        {u.outcomes.map(o => <li key={o.key} className="text-gray-700">↳ <Link href={exploreHref("outcome", o.key.split("::")[0], `&outcome=${encodeURIComponent(o.label)}`)} className={`underline ${focusRing}`}>{o.label}</Link> <span className="text-gray-600">· {o.percent !== null ? `${o.correct} of ${o.n}` : "too little evidence"}</span></li>)}
                      </ul>
                    </div>
                  ))}
                </div>
              ))}
            </>
          ) : (
            <>
              <p className="text-[13px] leading-relaxed text-gray-700">No competency catalogue applies, so progress is by your own materials and their topics.</p>
              <ul className="mt-2 space-y-1 text-[13.5px] pointer-coarse:space-y-3">{v.materials.map(m => (
                <li key={m.id}><Link href={exploreHref("document", m.id)} className={`underline ${focusRing}`}>{m.title}</Link>{!m.classified ? <span className="text-gray-600"> · not classified yet</span> : null}</li>
              ))}</ul>
            </>
          )}
          {/* Topics: the classification of the notes, each opening its evidence -- with or without a catalogue. */}
          {v.topics.length > 0 && (
            <nav aria-labelledby="pg-topics-h" className="mt-4">
              <h3 id="pg-topics-h" className="cmp-learn-ink text-[13.5px] font-bold">Explore by topic</h3>
              <ul className="mt-1 flex flex-wrap gap-2">{v.topics.map(t => (
                <li key={t}><Link href={exploreHref("topic", t)} className={`inline-flex min-h-[36px] items-center rounded-full border border-[var(--learn-border)] bg-[var(--cmp-app-surface)] px-3 text-[13px] text-gray-800 hover:bg-[var(--learn-surface)] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>{t}</Link></li>
              ))}</ul>
            </nav>
          )}
          </div>
          </Fold></div>
        </section>
      )}
    </div>
  );
}
