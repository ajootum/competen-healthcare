import Link from "next/link";
import { SCHOLAR } from "@/lib/individual/experiences";
import { CASE_DIMENSION_LABEL, EVALUATION_BAND_LABEL, EVALUATION_CONFIDENCE_LABEL } from "@/lib/individual/scholar/config";
import type { ProgressView } from "@/lib/individual/scholar/progress-data";
import type { NextStep } from "@/lib/individual/scholar/progress-next";
import type { PeriodKind, Trend } from "@/lib/individual/scholar/progress-history";
import { evaluationHref, sourceHref, studyHref } from "./question-view";

// PROGRESS-01 (Progress, Stage 8 of 8) P1-P4 -- the student's learning command centre, above the existing per-material
// detail. What to do next comes first. Each dimension stays on its own card with why it says what it says, and a
// way to the evidence. Development over time keeps new evidence apart from repeated practice. Engagement and
// coverage are labelled as what they are, never as understanding, and nothing here is verified competence.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-3 py-2 text-[13.5px] font-semibold text-gray-800 hover:bg-gray-50 pointer-coarse:min-h-[48px] ${focusRing}`;
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

function Card({ id, title, what, why, children, href }: { id: string; title: string; what: string; why?: string | null; children: React.ReactNode; href?: string }) {
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-gray-200 bg-white p-4">
      <h3 id={id} className="text-[14px] font-bold text-gray-900">{title}</h3>
      <p className="text-[12px] text-gray-600">{what}</p>
      <div className="mt-2">{children}</div>
      {why ? <p className="mt-2 text-[12px] text-gray-600"><span className="font-semibold">Why:</span> {why}</p> : null}
      {href ? <p className="mt-1 text-[12px]"><Link href={href} className={`underline ${focusRing}`}>See the evidence</Link></p> : null}
    </section>
  );
}
type M = { state: string; percent?: number; correct?: number; independent?: number; band?: keyof typeof EVALUATION_BAND_LABEL; have?: number; need?: number; reason?: string };
function Dim({ m, noun }: { m: M; noun: string }) {
  if (m.state === "measured") return <p className="text-[13.5px] text-gray-900"><span className="text-[20px] font-bold tabular-nums">{m.percent}%</span> · {m.correct} of {m.independent} {noun} · <span className="font-semibold">{EVALUATION_BAND_LABEL[m.band!]}</span></p>;
  return <p className="text-[13.5px] text-gray-700"><span className="font-semibold">{m.state === "insufficient" ? `Too little evidence to say (${m.have} of ${m.need})` : "Not measured"}.</span> {m.reason}</p>;
}
const trendText = (t: Trend) => (t ? TREND[t] : "Not enough evidence for a trend yet");

export function ProgressWorkspace({ v, sections, period }: { v: Extract<ProgressView, { ok: true }>; sections: readonly string[]; period: PeriodKind }) {
  const e = v.evaluation, show = (s: string) => sections.includes(s);
  const k = e.knowledge, app = e.application, rs = e.reasoning, ret = e.retention, cov = e.coverage;
  const evidence = evaluationHref();
  return (
    <div className="mb-10 space-y-6">
      <section aria-labelledby="pg-mine-h" className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <h2 id="pg-mine-h" className="text-[16px] font-bold text-gray-900">My learning progress</h2>
        <p className="mt-1 text-[13px] text-gray-700">
          {v.context.programme ? <>{v.context.programme}{v.context.level ? `, ${v.context.level}` : ""} · </> : "No programme chosen: progress is by material and section · "}
          {v.engagement.lastStudied ? `last studied ${new Date(v.engagement.lastStudied).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "not studied yet"} · {EVALUATION_CONFIDENCE_LABEL[e.confidence.level]}
        </p>
        <p className="mt-1 text-[12.5px] text-gray-600">Observed practice on your own notes: not verified competence. Verified clinical competence is decided only by an independently governed assessment.</p>
        <h3 className="mt-3 text-[13px] font-bold uppercase tracking-[0.12em] text-gray-500">Recommended next steps</h3>
        {v.next.length === 0 ? <p className="mt-1 text-[13px] text-gray-600">Nothing to suggest from your evidence right now. Keep learning, and suggestions appear as your evidence grows.</p> : (
          <ul className="mt-2 space-y-2">{v.next.map((s, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <Link href={nextHref(s)} className={ghost} style={{ color: SCHOLAR.accent }}>{s.label}</Link>
              <span className="text-[12.5px] text-gray-600">{s.reason}</span>
            </li>
          ))}</ul>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {show("coverage") && (
          <Card id="pg-cov" title="Knowledge coverage" what="Which sections and learning outcomes you have worked on. Not what you know." href={evidence}
            why={cov.state === "measured" ? `${cov.sections.worked} of ${cov.sections.total} sections have an answer, a check or a case on them.` : null}>
            {cov.state === "measured" ? <p className="text-[13.5px] text-gray-900"><span className="font-semibold tabular-nums">{cov.sections.worked} of {cov.sections.total}</span> sections{cov.outcomes ? <> · <span className="font-semibold tabular-nums">{cov.outcomes.worked} of {cov.outcomes.total}</span> linked learning outcomes</> : null}</p>
              : <p className="text-[13.5px] text-gray-700">{cov.reason}</p>}
          </Card>
        )}
        {show("understanding") && (
          <Card id="pg-und" title="Understanding" what="Structured questions, each counted once on its latest answer, marked by its key." href={evidence}
            why={`${k.aiEvaluated.n} answers evaluated by AI and ${k.selfReported.n} graded by you are shown apart and not counted here.`}>
            <Dim m={k as M} noun="questions right" />
          </Card>
        )}
        {show("retention") && (
          <Card id="pg-ret" title="Retention" what="What you recalled after a gap of a day or more." href={evidence}
            why={ret.state === "measured" ? `${ret.successful} of ${ret.recalls} recalls held; the longest gap was ${ret.longestIntervalDays} days.` : null}>
            {ret.state === "measured" ? <p className="text-[13.5px] text-gray-900"><span className="text-[20px] font-bold tabular-nums">{ret.percent}%</span> · {ret.successful} of {ret.recalls} recalls · <span className="font-semibold">{EVALUATION_BAND_LABEL[ret.band]}</span></p> : <Dim m={ret as M} noun="" />}
          </Card>
        )}
        {show("application") && (
          <Card id="pg-app" title="Application and clinical reasoning" what="Scenario questions, and decisions in your clinical cases by reasoning dimension." href={evidence}
            why={`Safety points missed in cases: ${rs.safetyMissed}. Written case answers are shown apart.`}>
            <p className="text-[12px] font-semibold text-gray-700">Application</p>
            <Dim m={app as M} noun="scenario questions right" />
            <p className="mt-2 text-[12px] font-semibold text-gray-700">Clinical reasoning</p>
            <Dim m={rs as M} noun="case decisions right" />
            {rs.state === "measured" && <p className="mt-1 text-[12.5px] text-gray-700">{rs.byDimension.map(d => `${CASE_DIMENSION_LABEL[d.dimension] ?? d.dimension} ${d.correct}/${d.n}`).join(" · ")}</p>}
          </Card>
        )}
        {show("engagement") && (
          <Card id="pg-eng" title="Learning engagement" what={`What you did in the last ${v.engagement.windowDays} days. Activity, not understanding.`}>
            <p className="text-[13.5px] text-gray-900"><span className="font-semibold tabular-nums">{v.engagement.studyDays}</span> study days · {v.engagement.answers} answers · {v.engagement.reviews} reviews · {v.engagement.decisions} case decisions · {v.engagement.checks} Teach Me checks</p>
          </Card>
        )}
        {show("confidence") && (
          <Card id="pg-conf" title="Evidence confidence" what="How far your progress can be relied on: amount, breadth, recency and how it was marked." href={evidence}>
            <p className="text-[13.5px] font-semibold text-gray-900">{EVALUATION_CONFIDENCE_LABEL[e.confidence.level]}</p>
            <ul className="mt-1 list-disc pl-5 text-[12.5px] text-gray-700">{e.confidence.reasons.map(x => <li key={x}>{x}</li>)}</ul>
          </Card>
        )}
      </div>

      {show("history") && (
        <section aria-labelledby="pg-hist-h" className="rounded-2xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="pg-hist-h" className="text-[14px] font-bold text-gray-900">Development over time</h2>
            <nav aria-label="Period" className="flex gap-1 text-[13px]">{(["week", "month", "programme"] as const).map(p => (
              <Link key={p} href={`${studyHref("progress")}?period=${p}`} aria-current={p === period ? "page" : undefined}
                className={`rounded-lg px-2.5 py-1.5 pointer-coarse:min-h-[44px] ${focusRing} ${p === period ? "bg-gray-900 font-semibold text-white" : "border border-gray-300 text-gray-800"}`}>
                {p === "week" ? "By week" : p === "month" ? "By month" : "By programme"}
              </Link>
            ))}</nav>
          </div>
          <p className="mt-1 text-[12.5px] text-gray-700">
            New questions: {trendText(v.history.trends.knowledge)} · Recall: {trendText(v.history.trends.retention)} · Case decisions: {trendText(v.history.trends.reasoning)}
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[12.5px]">
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
          <ul className="mt-2 list-disc pl-5 text-[12px] text-gray-600">{v.history.notes.map(n => <li key={n}>{n}</li>)}</ul>
        </section>
      )}

      {show("competencies") && (
        <section aria-labelledby="pg-cfca-h" className="rounded-2xl border border-gray-200 bg-white p-4">
          <h2 id="pg-cfca-h" className="text-[14px] font-bold text-gray-900">{e.cfca ? "By your competency framework" : "By material"}</h2>
          {e.cfca ? (
            <>
              <p className="text-[12px] text-gray-600">Domain › practice unit › competency › learning outcome. Open one to see its evidence. Observed practice, not verified competence.</p>
              {e.cfca.map(d => (
                <div key={d.domain} className="mt-2">
                  <p className="text-[13.5px] font-bold text-gray-900">{d.domain}</p>
                  {d.units.map(u => (
                    <div key={u.name} className="ml-3">
                      <p className="text-[12.5px] font-semibold text-gray-700">{u.name}</p>
                      <ul className="ml-3 space-y-0.5 text-[13px]">
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
              <p className="text-[12px] text-gray-600">No competency catalogue applies, so progress is by your own materials and their topics.</p>
              <ul className="mt-2 space-y-1 text-[13.5px]">{v.materials.map(m => (
                <li key={m.id}><Link href={exploreHref("document", m.id)} className={`underline ${focusRing}`}>{m.title}</Link>{!m.classified ? <span className="text-gray-600"> · not classified yet</span> : null}</li>
              ))}</ul>
            </>
          )}
          {/* Topics: the classification of the notes, each opening its evidence -- with or without a catalogue. */}
          {v.topics.length > 0 && (
            <nav aria-labelledby="pg-topics-h" className="mt-4">
              <h3 id="pg-topics-h" className="text-[13px] font-bold text-gray-800">Explore by topic</h3>
              <ul className="mt-1 flex flex-wrap gap-2">{v.topics.map(t => (
                <li key={t}><Link href={exploreHref("topic", t)} className={`inline-flex min-h-[36px] items-center rounded-full border border-gray-300 bg-white px-3 text-[13px] text-gray-800 hover:bg-gray-50 pointer-coarse:min-h-[44px] ${focusRing}`}>{t}</Link></li>
              ))}</ul>
            </nav>
          )}
        </section>
      )}
    </div>
  );
}
