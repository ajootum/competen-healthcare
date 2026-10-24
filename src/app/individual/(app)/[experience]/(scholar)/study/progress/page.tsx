import Link from "next/link";
import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { experienceHref } from "@/lib/individual/experiences";
import { listPassportChoices, progressRows, reviewRows } from "@/lib/individual/scholar/store";
import { loadLearningIntelligence } from "@/lib/individual/scholar/intelligence-data";
import LearningIntelligence from "../_components/LearningIntelligence";
import { eligibleAchievements } from "@/lib/individual/scholar/passport-items";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { EVIDENCE_LABEL } from "@/lib/individual/passport";
import { PassportChoices } from "../_components/passport-choice";
import { buildProgress } from "@/lib/individual/scholar/progress";
import { SELF_DIRECTED_LABEL } from "@/lib/individual/scholar/config";
import { PageHeader, StatePanel, Unreadable, focusRing } from "../../../../../_components/chrome";
import StudyNav from "../_components/StudyNav";
import { competencyProgressRows } from "@/lib/individual/scholar/store";
import { loadLearnerCatalogue, type LearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { buildCompetencyProgress, type CompetencyProgress, type CompetencyProgressRow } from "@/lib/individual/scholar/competency-progress";
import { LAYER_LABEL } from "@/lib/individual/scholar/catalogue";
import { LayerTag } from "../_components/competency-client";
import { ContentStatusTag } from "../_components/client";
import { CHECK_VERDICT_LABEL, NO_APPROVED_COMPETENCIES, NOT_COMPETENCE_LABEL, type CheckVerdict } from "@/lib/individual/scholar/config";
import { learningActivityByCompetency } from "@/lib/individual/scholar/store";
import type { CompetencyCoverage } from "@/lib/competency/progress-model";

const STATUS_TEXT: Record<CompetencyProgressRow["status"], string> = {
  no_notes: "No notes linked yet",
  notes_linked: "Notes linked, not practised yet",
  practising: "Practising",
};

/** COMPETEN-SCHOLAR-01 S4. Practice against each competency of the programme -- never a judgement of competence. */
/**
 * The totals and the measure state come from S5's coverage (li.coverage) -- ONE computation, read by both this
 * section and the Learning Intelligence panel (COMPETEN-SCHOLAR-01 P0). The rows below are this section's own
 * detail from the same accepted links (a unit test pins that each row's figures equal coverage's).
 */
function CompetencySection({ learner, progress, coverage, unreadable, accent, activity }: {
  learner: LearnerCatalogue | null; progress: CompetencyProgress | null; coverage: CompetencyCoverage | null; unreadable: boolean; accent: string;
  /** LEARN-01 L4: learning activity on sections linked to each competency. Null: not recorded here (414 absent). */
  activity: Map<string, { actions: number; lastVerdict: string | null; lastAt: string }> | null;
}) {
  if (!learner?.provisioned) return null;
  return (
    <section aria-labelledby="competency-h" className="mt-8">
      <h2 id="competency-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">
        By competency{learner.programme ? ` · ${learner.programme.label}` : ""}
      </h2>
      <p className="mt-1 text-[13px] text-gray-600">
        Which competencies of your programme your notes cover, and how you did on practice questions written for each. Practice counts once you have accepted the link from a section to a competency, so suggestions you have not decided on, and rejected links, are not counted. This is practice on your own notes, not an assessment of competence.
      </p>
      <div className="mt-3">
        {!learner.programme ? (
          <StatePanel title="No programme chosen">
            <p>Choose your programme in My Learning to see your study against its competencies.</p>
            <p><Link href={experienceHref("scholar", "study")} className={`font-semibold underline ${focusRing}`} style={{ color: accent }}>Go to My Learning</Link></p>
          </StatePanel>
        ) : unreadable ? <Unreadable what="progress by competency" />
          : progress && progress.totals.competencies === 0 ? (
            <StatePanel title={learner.belowFloor > 0 ? NO_APPROVED_COMPETENCIES : "Your programme has no competencies to show yet"}>
              <p>{learner.belowFloor > 0
                ? `Only clinically approved content is offered, and none of the ${learner.belowFloor} competencies in your programme is approved yet. Nothing about your study has changed.`
                : "None of the frameworks your programme uses is published yet, so there is nothing to measure against. Nothing about your study has changed."}</p>
            </StatePanel>
          ) : progress && (
            <>
              <p className="mb-3 text-[13.5px] text-gray-800 tabular-nums">
                {coverage?.state === "measured"
                  ? <>Practised {coverage.covered} of {coverage.total} competencies · right on the latest try for {coverage.coveredPositive}</>
                  : <span className="text-gray-600">{coverage ? coverage.reason : "Coverage could not be measured just now."}</span>}
                {" · "}notes linked to {progress.totals.withNotes}
                {progress.outsideProgramme ? ` · ${progress.outsideProgramme} question${progress.outsideProgramme === 1 ? "" : "s"} practise competencies outside this programme` : ""}
              </p>
              {coverage?.state === "measured" && coverage.gaps.length > 0 && (
                <p className="mb-3 text-[13px] text-gray-700">
                  <span className="font-semibold">Not practised yet, highest expected level first: </span>
                  {coverage.gaps.slice(0, 5).map(g => `${g.name}${g.expected ? ` (${g.expected})` : ""}`).join(" · ")}{coverage.gaps.length > 5 ? ` and ${coverage.gaps.length - 5} more` : ""}
                </p>
              )}
              <div className="space-y-3">
                {progress.layers.map(l => (
                  <details key={l.layer} open={l.rows.some(r => r.status !== "no_notes")} className="rounded-2xl border border-gray-200 bg-white">
                    <summary className={`flex cursor-pointer flex-wrap items-center gap-2 p-4 ${focusRing}`}>
                      <LayerTag layer={l.layer} />
                      <span className="text-[14px] font-semibold text-gray-900">{LAYER_LABEL[l.layer]} competencies</span>
                      <span className="text-[12.5px] text-gray-600 tabular-nums">{l.rows.filter(r => r.status !== "no_notes").length} of {l.rows.length} with notes</span>
                    </summary>
                    <ul className="divide-y divide-gray-100 border-t border-gray-100">
                      {l.rows.map(r => (
                        <li key={r.id} className="px-4 py-3">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-gray-900">{r.code ? `${r.code} ` : ""}{r.title}<ContentStatusTag status={r.contentStatus} /></span>
                            <span className="text-[13px] font-semibold tabular-nums" style={{ color: r.latestAccuracy === null ? undefined : accent }}>
                              {r.latestAccuracy === null ? <span className="text-gray-500">{STATUS_TEXT[r.status]}</span> : `${r.latestAccuracy}% practice accuracy`}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[12.5px] text-gray-600 tabular-nums">
                            {r.domain}{r.structure ? ` · ${r.structure}` : ""} · {r.sectionsAccepted} section{r.sectionsAccepted === 1 ? "" : "s"} accepted, {r.sectionsProposed} suggested
                            {r.questions ? ` · ${r.answered} of ${r.questions} question${r.questions === 1 ? "" : "s"} answered` : ""}
                          </p>
                          {(r.sectionsAccepted + r.sectionsProposed > 0 || activity?.get(r.id)) && (
                            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-gray-700">
                              {r.sectionsAccepted + r.sectionsProposed > 0 && (
                                <Link href={experienceHref("scholar", `study/learn?competency=${r.id}`)} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: accent }}>Learn this competency</Link>
                              )}
                              {activity?.get(r.id) && (
                                <span>
                                  Learning activity: {activity.get(r.id)!.actions} action{activity.get(r.id)!.actions === 1 ? "" : "s"}
                                  {activity.get(r.id)!.lastVerdict ? ` · last check: ${CHECK_VERDICT_LABEL[activity.get(r.id)!.lastVerdict as CheckVerdict] ?? activity.get(r.id)!.lastVerdict}` : ""}
                                  <span className="text-gray-500"> · {NOT_COMPETENCE_LABEL}</span>
                                </span>
                              )}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            </>
          )}
      </div>
    </section>
  );
}

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// IMPROVE -- COMPETEN-IND-004 s6. Per-material mastery, cards due and the weekly trend, built from the
// person's own rows (src/lib/individual/scholar/progress.ts).
//
// ⚠ SELF-DIRECTED STUDY, AND LABELLED SO. Nothing here is verified, assessed or visible to an employer.
// Nothing reaches the Passport unless the person chooses it, one achievement at a time, in "Your Passport"
// below (migration 375). What can be chosen is a count of practice answered, never accuracy.
// ⚠ NOT MEASURED IS SHOWN AS NOT MEASURED. A material with no answers has no mastery figure, and a week
// with no answers has no accuracy bar -- never a 0.

// The title only when Individual is live: with the release gate off, a 404 must not name the route.
export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Progress" });
}

const fmtWeek = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export default async function ProgressPage({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const [rows, reviews] = await Promise.all([progressRows(ctx.admin, ctx.userId), reviewRows(ctx.admin, ctx.userId)]);
  const today = new Date().toISOString().slice(0, 10);
  const policy = await loadIndividualPolicy(ctx.admin);
  // COMPETEN-SCHOLAR-01 S5: the four measures, from the rows already read (nothing is read twice).
  const li = rows.ok ? await loadLearningIntelligence(ctx.admin, ctx.userId, policy, today, { pre: { rows, reviews } }) : null;
  const reviewRefs = reviews.ok && reviews.data ? reviews.data : [];
  const p = rows.ok ? buildProgress({ ...rows.data, today }) : null;
  const choices = rows.ok ? await listPassportChoices(ctx.admin, ctx.userId) : null;
  const allEligible = rows.ok && choices?.ok ? eligibleAchievements({ ...rows.data, choices: choices.data, reviews: reviewRefs }) : [];
  // Which kinds may be newly chosen is Individual policy (COMPETEN-CONFIG-002). One already chosen stays listed,
  // so the person can still see it and take it off: switching a kind off never rewrites their Passport.
  const offered = new Set<string>(policy.passportAchievementKinds);
  const eligible = allEligible.filter(a => a.chosenLabel !== null || offered.has(a.achievement));

  // COMPETEN-SCHOLAR-01 S4: progress by competency, through the catalogue interface. Absent where 387/388
  // are not applied (fail closed). Unreadable is said, never shown as an empty list.
  const learner = rows.ok ? await loadLearnerCatalogue(ctx.admin, ctx.userId) : null;
  const cRows = learner?.provisioned && learner.programme && learner.competencies ? await competencyProgressRows(ctx.admin, ctx.userId) : null;
  const cp = cRows?.ok && learner?.competencies
    ? buildCompetencyProgress({
      competencies: learner.competencies,
      mappings: cRows.data.mappings.map(m => ({ competencyId: m.competencyId, chunkId: m.chunkId, state: m.state })),
      questions: cRows.data.questions, attempts: cRows.data.attempts,
    })
    : null;
  const cUnreadable = !!learner?.programme && (learner.competencies === null || (cRows !== null && !cRows.ok));
  // LEARN-01 L4: learning activity per competency, read from the structured history (null where 414 is absent).
  const activity = cp ? await learningActivityByCompetency(ctx.admin, ctx.userId) : null;

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="My Learning" title="Progress" intro="How your own study is going, material by material." />
      <StudyNav dueCount={p?.totals.cardsDue ?? null} />
      <p className="mb-6 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[13.5px] text-gray-700">
        <span className="font-semibold">{SELF_DIRECTED_LABEL}</span> None of it is added to your Passport or shared with anyone unless you choose an achievement below.
      </p>

      {!rows.ok ? (rows.notProvisioned
        ? <StatePanel title="Progress is not set up on this environment yet"><p>The study store it needs has not been installed here.</p></StatePanel>
        : <Unreadable what="study progress" />)
        : p && p.materials.length === 0 ? (
          <StatePanel title="Nothing to measure yet">
            <p>Progress appears once you have uploaded material and answered questions from it.</p>
            <p><Link href={experienceHref("scholar", "study")} className={`font-semibold underline ${focusRing}`} style={{ color: x.accent }}>Go to your materials</Link></p>
          </StatePanel>
        ) : p && (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { k: "Questions answered", v: `${p.totals.answered} of ${p.totals.questions}` },
                { k: "Answers given", v: String(p.totals.attempts) },
                { k: "Cards due now", v: String(p.totals.cardsDue) },
                { k: "Cards on long intervals", v: `${p.totals.cardsLongInterval} of ${p.totals.cardsActive + p.totals.cardsLongInterval}` },
              ].map(s => (
                <div key={s.k} className="rounded-2xl border border-gray-200 bg-white p-4">
                  <dt className="text-[12.5px] font-semibold text-gray-500">{s.k}</dt>
                  <dd className="mt-1 text-[22px] font-bold text-gray-900 tabular-nums">{s.v}</dd>
                </div>
              ))}
            </dl>

            <CompetencySection learner={learner} progress={cp} coverage={li?.ok ? li.data.coverage : null} unreadable={cUnreadable} accent={x.accent} activity={activity} />

            {li?.ok ? <LearningIntelligence li={li.data} accent={x.accent} /> : <div className="mt-8"><Unreadable what="learning intelligence" /></div>}

            <section aria-labelledby="accuracy-h" className="mt-8">
              <h2 id="accuracy-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">By material</h2>
              <p className="mt-1 text-[13px] text-gray-600">Practice accuracy is the share of a material&apos;s AI-written practice questions you got right the last time you answered them. It reflects how you did on practice questions from your own notes. It is not a measure of competence or of clinical knowledge.</p>
              <ul className="mt-3 divide-y divide-gray-200 rounded-2xl border border-gray-200 bg-white">
                {p.materials.map(m => (
                  <li key={m.id} className="p-4 sm:p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link href={experienceHref("scholar", `study/${m.id}`)} className={`text-[15px] font-semibold text-gray-900 underline-offset-2 hover:underline ${focusRing}`}>{m.title}</Link>
                      <span className="text-[14px] font-bold tabular-nums" style={{ color: m.latestAccuracy === null ? undefined : x.accent }}>
                        {m.latestAccuracy === null ? <span className="font-semibold text-gray-500">Not measured yet</span> : `${m.latestAccuracy}% practice accuracy`}
                      </span>
                    </div>
                    {m.latestAccuracy !== null && (
                      <div className="mt-2 h-2 rounded-full bg-gray-100" role="img" aria-label={`${m.latestAccuracy}% practice accuracy`}>
                        <div className="h-2 rounded-full" style={{ width: `${m.latestAccuracy}%`, background: x.accent }} />
                      </div>
                    )}
                    <p className="mt-2 text-[12.5px] text-gray-600 tabular-nums">
                      {m.questions === 0 ? "No questions written yet" : `${m.answered} of ${m.questions} question${m.questions === 1 ? "" : "s"} answered${m.latestCorrect !== null ? `, ${m.latestCorrect} right on the latest try` : ""}`}
                      {" · "}{m.cardsDue} card{m.cardsDue === 1 ? "" : "s"} due · {m.cardsLongInterval} on long intervals
                    </p>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="passport-h" className="mt-8">
              <h2 id="passport-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Your Passport</h2>
              <p className="mt-1 text-[13px] text-gray-600">
                You can choose to show what you have practised in your Competen Passport, one achievement at a time. It is labelled
                &ldquo;{EVIDENCE_LABEL.self_directed}&rdquo;. Only the title you give it, the number you answered and when you last studied are shown. Your notes, your answers, whether they were right and anything the AI wrote are never shown.
                It also appears on Passport links you share from Competen Professional, including links already shared. Removing it takes it off them straight away, and your study history stays as it is.
              </p>
              {!choices?.ok ? (choices?.notProvisioned
                ? <p className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-[14px] text-gray-600">Showing study achievements in your Passport is not available on this environment yet.</p>
                : <div className="mt-3"><Unreadable what="Passport choices" /></div>)
                : eligible.length === 0 && allEligible.length > 0 ? (
                  <p className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-[14px] text-gray-600">Adding study achievements to your Passport is not offered at the moment. Your study history is unchanged.</p>
                ) : eligible.length === 0 ? (
                  <p className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-[14px] text-gray-600">Nothing to show yet. Answer practice questions or scenarios from a material and it can be shown here.</p>
                ) : <PassportChoices items={eligible} />}
            </section>

            <section aria-labelledby="trend-h" className="mt-8">
              <h2 id="trend-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Last 8 weeks</h2>
              <p className="mt-1 text-[13px] text-gray-600">Answers given each week, and the share that were right. A week with no answers has no bar.</p>
              <table className="mt-3 w-full overflow-hidden rounded-2xl border border-gray-200 bg-white text-left text-[13.5px]">
                <caption className="sr-only">Answers and accuracy by week</caption>
                <thead className="bg-gray-50 text-[12px] font-semibold text-gray-600">
                  <tr><th scope="col" className="px-3 py-2">Week of</th><th scope="col" className="px-3 py-2 text-right">Answers</th><th scope="col" className="px-3 py-2">Right</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {p.trend.map(w => (
                    <tr key={w.weekStart}>
                      <th scope="row" className="whitespace-nowrap px-3 py-2 font-medium text-gray-800">{fmtWeek(w.weekStart)}</th>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-800">{w.attempts}</td>
                      <td className="w-1/2 px-3 py-2">
                        {w.accuracy === null ? <span className="text-gray-400">No answers</span> : (
                          <div className="flex items-center gap-2">
                            <div className="h-2 flex-1 rounded-full bg-gray-100"><div className="h-2 rounded-full" style={{ width: `${w.accuracy}%`, background: x.accent }} /></div>
                            <span className="w-10 text-right tabular-nums text-gray-800">{w.accuracy}%</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
    </>
  );
}
