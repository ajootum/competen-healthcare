import Link from "next/link";
import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import {
  countDue, dueCards, getRevisionSession, listMaterials, listRevisionSessions, listRevisionSets, readConsent, revisionInsightRows, revisionPool, sqieSchema, type QuestionRow,
} from "@/lib/individual/scholar/store";
import { citeChunk } from "@/lib/individual/scholar/extract";
import { answerText, buildRevisionInsights } from "@/lib/individual/scholar/revision";
import { feedbackView, revisionItemView } from "@/lib/individual/scholar/revision-view";
import { loadLearnerCatalogue, competencyLabels } from "@/lib/individual/scholar/competency-view";
import { aiOffMessage, consentDocuments, consentStatus } from "@/lib/individual/scholar/consent-gate";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { REVISION_FORMATS, REVISION_MODE_LABEL, type Marking, type RevisionMode } from "@/lib/individual/scholar/config";
import { PageHeader, StatePanel, Unreadable, focusRing, BoundaryNotice, EmptyState } from "../../../../../_components/chrome";
import StudyNav from "../_components/StudyNav";
import { ExamPapersSection } from "../_components/papers-section";
import { FORMATIVE_NOTICE, scholarSpace } from "@/lib/individual/scholar/spaces";
import { CardReview, type CardView } from "../_components/client";
import { sourceHref, studyHref } from "../_components/question-view";
import { RevisionRunner, RevisionStart, SavedSets } from "../_components/revision-client";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// REVISION -- COMPETEN-SCHOLAR-REVISION-01 (Stage 4), on COMPETEN-IND-004 s4.
//
// The workspace: Start Today's Revision; Quick Practice, Spaced Revision, Weak Areas, Mock Practice, Flashcards;
// the student's own choice of scope, formats, quantity, difficulty and feedback; Saved Revision Sets; the review cards
// due (the 372 cards on the shared SM-2, self-graded, as before); and Revision Intelligence (R5): due and upcoming,
// recall and its trend, what keeps being missed, coverage, revision activity per competency -- practised, never
// achieved -- and recommendations from the student's own answers. ?session=<id> runs or resumes one session.
// Everything here is formative. Nothing needs new AI to be read: saved sets, cards and history stay available.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Revise" });
}

/** EVALUATION-01: a sitting started as an evaluation knowledge check carries its method and scope back here. */
function evaluationIntent(q: { evaluate?: string; evscope?: string }): { method: "fresh" | "combined"; scope: Record<string, unknown> } | null {
  if (q.evaluate !== "fresh" && q.evaluate !== "combined") return null;
  try {
    const scope = JSON.parse(q.evscope ?? "");
    return scope && typeof scope === "object" && typeof scope.kind === "string" ? { method: q.evaluate, scope } : null;
  } catch { return null; }
}

export default async function Revise({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<{ session?: string; evaluate?: string; evscope?: string; material?: string; difficulty?: string }> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const q = await searchParams;
  const due = await countDue(ctx.admin, ctx.userId);
  const header = (
    <>
      <PageHeader accent={x.accent} eyebrow={scholarSpace("revise").eyebrow} title="Revise" intro={scholarSpace("revise").intro} />
      <StudyNav dueCount={due} />
      <BoundaryNotice notice={FORMATIVE_NOTICE} />
    </>
  );
  const papers = <ExamPapersSection admin={ctx.admin} userId={ctx.userId} variant="revise" />;

  // ── one session: run it, or resume it where the student left it ──
  if (q.session) {
    const [s, pool] = await Promise.all([getRevisionSession(ctx.admin, ctx.userId, q.session), revisionPool(ctx.admin, ctx.userId, { kinds: [...REVISION_FORMATS, "case"] })]);
    if (!s.ok || !pool.ok) return <>{header}<Unreadable what="this revision session" /></>;
    if (!s.data) return <>{header}<StatePanel title="That revision session could not be found" actions={<Link href={studyHref("revise")} className={focusRing}>Back to Revision</Link>}><p>It may have been removed with the materials it used.</p></StatePanel></>;
    const byId = new Map(pool.data.questions.map(qq => [qq.id, qq]));
    const questions = s.data.questionIds.map(id => byId.get(id)).filter((qq): qq is QuestionRow => !!qq);
    const show = s.data.session.feedback === "immediate" || s.data.session.status === "completed";
    const answered = s.data.attempts.filter(a => byId.has(a.questionId)).map(a => ({
      questionId: a.questionId, ...(show ? { feedback: feedbackView(byId.get(a.questionId)!, { correct: a.correct, score: a.score, marking: a.marking as Marking }) } : {}),
    // 425, owner decision R4: a short answer held unmarked until the end is answered, and kept on resume. Its grading
    // comes with the end of the session (PATCH complete), never before.
    })).concat(s.data.held.filter(h => byId.has(h.questionId)).map(h => ({ questionId: h.questionId, held: true })));
    return (
      <>
        {header}
        <RevisionRunner session={{ id: s.data.session.id, mode: s.data.session.mode, feedback: s.data.session.feedback, status: s.data.session.status, total: questions.length, position: s.data.session.position }}
          items={questions.map(revisionItemView)} answered={answered} evaluation={evaluationIntent(q)} />
      </>
    );
  }

  // ── the workspace ──
  const [policy, materials, sets, sessions, rows, cards, learner, consent, sqie] = await Promise.all([
    loadIndividualPolicy(ctx.admin), listMaterials(ctx.admin, ctx.userId), listRevisionSets(ctx.admin, ctx.userId), listRevisionSessions(ctx.admin, ctx.userId, 5),
    revisionInsightRows(ctx.admin, ctx.userId), dueCards(ctx.admin, ctx.userId), loadLearnerCatalogue(ctx.admin, ctx.userId), readConsent(ctx.admin, ctx.userId),
    sqieSchema(ctx.admin, ctx.userId),
  ]);
  // SCHOLAR-SQIE-CLOSE-01: structured (multi-part) is offered only where migration 710 stores it.
  const formats = policy.scholarRevisionFormats.filter(x => x !== "structured" || sqie);
  const status = consent.ok ? consentStatus(consent.data, consentDocuments().published) : null;
  const standing = activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "questions");
  const aiNote = policy.scholarRevisionGeneration === "saved_only" ? "New questions are not written here: revision uses your saved questions."
    : status !== "on" ? `${status ? aiOffMessage(status) ?? "AI help is off." : "Your AI help setting could not be read just now."} Revision uses your saved questions.`
      : !standing.available ? `${standing.message ?? "New AI help is limited right now."} Revision uses your saved questions, cards and sets.` : null;
  const mats = materials.ok ? materials.data.map(m => ({ id: m.id, title: m.title })) : [];
  const insights = rows.ok ? buildRevisionInsights({
    today: new Date().toISOString().slice(0, 10), windowDays: policy.scholarInsightWindowDays, minAnswers: policy.scholarInsightMinAnswers,
    attempts: rows.data.attempts, questions: rows.data.questions, reviews: rows.data.reviews, cards: rows.data.cards, materials: mats,
  }) : null;
  const compNames = insights?.competencyActivity.length
    ? await competencyLabels(ctx.admin, learner.competencies, insights.competencyActivity.map(c => c.competencyId), new Map()) : new Map();
  const cardViews: CardView[] = cards.ok ? cards.data.map(c => ({
    id: c.id, stem: c.question.stem, answer: answerText(c.question), rationale: c.question.rationale, quote: c.question.sourceQuote,
    citation: `${c.question.materialTitle}, ${c.question.ordinal !== null ? citeChunk({ ordinal: c.question.ordinal, pageFrom: c.question.pageFrom, pageTo: c.question.pageTo }, c.question.unit) : "source section"}`,
    href: sourceHref(c.question.materialId, c.question.chunkId),
  })) : [];
  const active = sessions.ok ? sessions.data.filter(s => s.status === "active") : [];

  // HFE-01 Wave 4 (F10): before there is anything to revise, one message and one action -- not a dashboard of zeros.
  const nothingYet = materials.ok && mats.length === 0 && rows.ok && rows.data.attempts.length === 0
    && cards.ok && cards.data.length === 0 && sets.ok && sets.data.length === 0 && active.length === 0;
  if (nothingYet) {
    return (
      <>
        {header}
        {papers}
        <EmptyState title="Nothing to revise yet" action={<Link href={studyHref("")} className={`inline-flex min-h-[44px] items-center rounded-xl px-5 text-[14.5px] font-semibold text-white ${focusRing}`} style={{ background: x.accent }}>Go to My Learning</Link>}>
          Revision works from questions on your own material. Upload a material and answer a few questions on it, and your revision appears here.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      {header}
      {papers}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-5">
          <RevisionStart modes={policy.scholarRevisionModes} formats={formats} quantity={policy.scholarRevisionQuantity}
            difficulty={policy.scholarRevisionDifficulty} feedback={policy.scholarRevisionFeedback} materials={mats}
            competencies={(learner.competencies ?? []).map(c => ({ id: c.id, title: c.title }))} aiNote={aiNote}
            preset={q.material ? { materialId: q.material, difficulty: q.difficulty ?? null } : null} />

          {active.length > 0 && (
            <section aria-labelledby="resume-h" className="rounded-2xl border border-gray-200 bg-white p-5">
              <h2 id="resume-h" className="text-[15px] font-bold text-gray-900">Carry on where you left off</h2>
              <ul className="mt-2 space-y-1.5">
                {active.map(s => (
                  <li key={s.id}><Link href={`${studyHref("revise")}?session=${s.id}`} className={`text-[14px] font-semibold underline underline-offset-2 ${focusRing}`}>{REVISION_MODE_LABEL[s.mode as RevisionMode] ?? "Revision"}</Link>
                    <span className="text-[12.5px] text-gray-500"> · {s.position} of {s.total} answered · {new Date(s.lastActiveAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="sets-h" className="rounded-2xl border border-gray-200 bg-white p-5">
            <h2 id="sets-h" className="text-[15px] font-bold text-gray-900">Saved revision sets</h2>
            <p className="text-[12.5px] text-gray-600">Revising a saved set again uses its stored questions and answers: no new AI, so it is always available.</p>
            {!sets.ok ? (sets.notProvisioned ? <p className="mt-2 text-[13px] text-gray-600">Saved sets are not available here yet.</p> : <Unreadable what="saved revision sets" />)
              : sets.data.length === 0 ? <p className="mt-2 text-[13px] text-gray-600">None yet. After a session, you can save its questions as a set.</p>
                : <SavedSets sets={sets.data.map(s => ({ id: s.id, title: s.title, questions: s.questionIds.length, lastUsedAt: s.lastUsedAt }))} />}
          </section>

          <section aria-labelledby="cards-h">
            <h2 id="cards-h" className="mb-2 text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Review cards due</h2>
            {!cards.ok ? (cards.notProvisioned
              ? <StatePanel title="Revision is not set up here yet"><p>The study store it needs has not been installed here.</p></StatePanel>
              : <Unreadable what="review cards" />)
              : <CardReview cards={cardViews} />}
          </section>
        </div>

        <aside aria-labelledby="intel-h" className="space-y-4">
          <h2 id="intel-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">How your revision is going</h2>
          <p className="text-[12.5px] text-gray-600">From your own answers and reviews. Revision is practice: none of this is an assessment or evidence of competence.</p>
          {!insights ? <Unreadable what="your revision history" /> : (
            <>
              {policy.scholarRevisionRecommendations === "on" && insights.recommendations.length > 0 && (
                <section aria-labelledby="rec-h" className="rounded-2xl border border-gray-200 bg-white p-4">
                  <h3 id="rec-h" className="text-[14px] font-bold text-gray-900">What to revise next</h3>
                  <ul className="mt-2 space-y-2">
                    {insights.recommendations.map(r => (
                      <li key={r.id} className="text-[13.5px]">
                        {"learnSection" in r.action
                          ? <Link href={`${studyHref("learn")}?section=${r.action.learnSection}`} className={`font-semibold underline underline-offset-2 ${focusRing}`}>{r.title}</Link>
                          : <span className="font-semibold text-gray-900">{r.title}</span>}
                        <span className="block text-[12.5px] text-gray-600">{r.reason}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <dl className="grid grid-cols-2 gap-3">
                <Stat label="Cards due now" value={String(insights.due)} />
                <Stat label="Due in the next 7 days" value={String(insights.upcoming7)} />
                <Stat label={`Reviews, last ${policy.scholarInsightWindowDays} days`} value={insights.completedReviews.state === "measured" ? String(insights.completedReviews.reviews) : "Not measured"} note={insights.completedReviews.state === "measured" ? null : insights.completedReviews.reason} />
                <Stat label="Recall" value={insights.recall.state === "measured" ? `${insights.recall.recalledShare}%` : insights.recall.state === "insufficient" ? "Not enough yet" : "Not measured"}
                  note={insights.recall.state === "measured" ? `of ${insights.recall.reviews} reviews graded Okay or better` : insights.recall.state === "insufficient" ? `${insights.recall.have} of ${insights.recall.need} reviews needed` : insights.recall.reason} />
                <Stat label="Materials revised" value={`${insights.coverage.revised} of ${insights.coverage.of}`} />
                <Stat label="Answers marked" value={`${insights.marking.deterministic + insights.marking.self_graded + insights.marking.ai_evaluation}`}
                  note={`by code ${insights.marking.deterministic} · by you ${insights.marking.self_graded} · by AI evaluation ${insights.marking.ai_evaluation}`} />
              </dl>
              <section aria-labelledby="ret-h" className="rounded-2xl border border-gray-200 bg-white p-4">
                <h3 id="ret-h" className="text-[14px] font-bold text-gray-900">Recall over six weeks</h3>
                {insights.retention.state !== "measured" ? <p className="mt-1 text-[13px] text-gray-600">{insights.retention.state === "insufficient" ? `Not enough reviews yet (${insights.retention.have} of ${insights.retention.need}).` : insights.retention.reason}</p> : (
                  <table className="mt-2 w-full text-[13px]">
                    <caption className="sr-only">Reviews and the share graded Okay or better, by week</caption>
                    <thead><tr className="text-left text-[12px] text-gray-500"><th scope="col" className="font-semibold">Week of</th><th scope="col" className="font-semibold">Reviews</th><th scope="col" className="font-semibold">Recalled</th></tr></thead>
                    <tbody>{insights.retention.weeks.map(w => (
                      <tr key={w.weekStart} className="border-t border-gray-100"><td>{new Date(`${w.weekStart}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</td>
                        <td className="tabular-nums">{w.reviews}</td><td className="tabular-nums">{w.recalledShare === null ? "No reviews" : `${w.recalledShare}%`}</td></tr>
                    ))}</tbody>
                  </table>
                )}
              </section>
              <section aria-labelledby="hard-h" className="rounded-2xl border border-gray-200 bg-white p-4">
                <h3 id="hard-h" className="text-[14px] font-bold text-gray-900">What you keep missing</h3>
                {insights.repeatedDifficulties.length === 0 ? <p className="mt-1 text-[13px] text-gray-600">Nothing missed more than once.</p> : (
                  <ul className="mt-2 space-y-2">{insights.repeatedDifficulties.map(d => (
                    <li key={d.questionId} className="text-[13px]"><span className="text-gray-900">{d.stem}</span> <span className="text-gray-500">· missed {d.misses} times</span>
                      <Link href={`${studyHref("learn")}?section=${d.chunkId}`} className={`ml-2 font-semibold underline ${focusRing}`}>Teach me this</Link></li>
                  ))}</ul>
                )}
              </section>
              <section aria-labelledby="comp-h" className="rounded-2xl border border-gray-200 bg-white p-4">
                <h3 id="comp-h" className="text-[14px] font-bold text-gray-900">Revision by competency</h3>
                <p className="text-[12px] text-gray-600">Questions answered on competencies your notes are linked to. Practised, not achieved.</p>
                {insights.competencyActivity.length === 0 ? <p className="mt-1 text-[13px] text-gray-600">Not measured: none of your revision questions is linked to a competency yet. Revision works without a catalogue.</p> : (
                  <ul className="mt-2 space-y-1">{insights.competencyActivity.slice(0, 8).map(c => (
                    <li key={c.competencyId} className="flex justify-between gap-2 text-[13px]"><span className="text-gray-900">{compNames.get(c.competencyId)?.title ?? "A competency"}</span><span className="tabular-nums text-gray-600">{c.answered} answered</span></li>
                  ))}</ul>
                )}
              </section>
            </>
          )}
        </aside>
      </div>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3">
      <dt className="text-[12px] font-semibold text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-[18px] font-bold text-gray-900 tabular-nums">{value}</dd>
      {note && <dd className="text-[11.5px] text-gray-600">{note}</dd>}
    </div>
  );
}
