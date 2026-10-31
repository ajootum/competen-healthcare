import Link from "next/link";
import type { Metadata } from "next";
import { loadStudy } from "@/lib/individual/scholar/study-context";
import { adaptivePrefill, withStudy } from "@/lib/individual/scholar/study-carry";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../../_components/shell-context";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { countDue, listAdaptiveExams, listMaterials, readConsent, sqieSchema } from "@/lib/individual/scholar/store";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { aiOffMessage, consentDocuments, consentStatus } from "@/lib/individual/scholar/consent-gate";
import { activityState, getScholarAiStanding } from "@/lib/individual/scholar/ai-standing";
import { generationContextLoader } from "@/lib/individual/scholar/question-context";
import { adaptiveReport, currentQuestion, loadAdaptive, stateOutcomes } from "@/lib/individual/scholar/adaptive-service";
import { adaptationOutcomes, blueprintLimits, blueprintOf, deadlineOf, nextDifficulty } from "@/lib/individual/scholar/adaptive";
import { feedbackView, keptAttemptView, revisionItemView } from "@/lib/individual/scholar/revision-view";
import { keyOf } from "@/lib/individual/scholar/revision";
import { ADAPTIVE_FALLBACK_NOTE, ADAPTIVE_HELP, ADAPTIVE_REPORT_LABEL, ADAPTIVE_RULE, MARKING_LABEL, type Marking } from "@/lib/individual/scholar/config";
import { PageHeader, StatePanel, Unreadable, focusRing, BoundaryNotice } from "../../../../../../_components/chrome";
import StudyNav from "../../_components/StudyNav";
import { FORMATIVE_NOTICE, scholarSpace } from "@/lib/individual/scholar/spaces";
import { adaptiveHref, studyHref } from "../../_components/question-view";
import { ReviseNav } from "../../_components/revise-nav";
import { AdaptiveReportView, AdaptiveRunner, AdaptiveStart, type ReviewRow } from "../../_components/adaptive-client";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// ADAPTIVE EXAMS -- SCHOLAR-PRACTICE-EXAMS-01 (owner, 30 Oct 2026), under Revise.
//
// The blueprint form and the student's past exams; ?session=<id> runs or resumes one, or shows its report once it has
// finished. Formative throughout: the report is a practice estimate from rule-based adaptation, and says so.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Adaptive exam" });
}

export default async function AdaptiveExam({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<{ session?: string; study?: string }> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const q = await searchParams;
  const [due, policy] = await Promise.all([countDue(ctx.admin, ctx.userId), loadIndividualPolicy(ctx.admin)]);
  // SCHOLAR-SESSION-AI-02: the open study session (database reads only): its bar, carried links, and the exam scope chosen.
  const study = await loadStudy(ctx.admin, ctx.userId, q.study, "revise", policy);
  const sid = study?.session.id ?? null;
  const header = (
    <>
      <PageHeader accent={SCHOLAR.accent} eyebrow={scholarSpace("revise").eyebrow} title="Adaptive exam" intro={ADAPTIVE_HELP} />
      <StudyNav dueCount={due} study={study?.bar ?? null} />
      <ReviseNav current="adaptive" adaptive={policy.scholarAdaptiveExams === "on"} row studyId={sid} />
      <BoundaryNotice notice={FORMATIVE_NOTICE} />
      <p className="mb-3 text-[13px]"><Link href={withStudy(studyHref("revise"), sid)} className={`underline ${focusRing}`}>← Back to Revision</Link></p>
    </>
  );
  if (policy.scholarAdaptiveExams !== "on")
    return <>{header}<StatePanel title="Adaptive exams are not offered here"><p>Revision, mock practice and your review cards are unaffected.</p></StatePanel></>;

  // ── one exam: run it, resume it, or its report ──
  if (q.session) {
    const loaded = await loadAdaptive(ctx.admin, ctx.userId, q.session);
    if (!loaded.ok) return <>{header}<Unreadable what="this exam" /></>;
    if (!loaded.data) return <>{header}<StatePanel title="That exam could not be found" actions={<Link href={adaptiveHref()} className={focusRing}>Set up an adaptive exam</Link>}><p>It may have been removed with the materials it used.</p></StatePanel></>;
    const st = loaded.data;
    const title = st.setTitle || "Adaptive exam";
    const fallback = st.fallback ? ADAPTIVE_FALLBACK_NOTE : null;
    if (st.session.status !== "completed") {
      const cur = currentQuestion(st);
      const answered = st.questionIds.length - (cur ? 1 : 0);
      const initial = cur ? {
        item: revisionItemView(cur), number: st.questionIds.indexOf(cur.id) + 1, total: st.blueprint.length, answered,
        target: nextDifficulty(st.blueprint.start, adaptationOutcomes(stateOutcomes(st).slice(0, st.questionIds.indexOf(cur.id)))),
        deadline: deadlineOf(st.session.createdAt, st.blueprint.timeLimitMinutes),
      } : null;
      return <>{header}<AdaptiveRunner sessionId={st.session.id} title={title} feedback={st.session.feedback} rule={ADAPTIVE_RULE} label={ADAPTIVE_REPORT_LABEL} fallback={fallback} initial={initial} /></>;
    }
    const report = await adaptiveReport(ctx.admin, ctx.userId, st);
    const att = new Map(st.attempts.map(a => [a.questionId, a]));
    const held = new Map(st.held.map(h => [h.questionId, h.response.text]));
    const review: ReviewRow[] = st.questionIds.map((id, i) => {
      const qq = st.questions.get(id)!;
      const a = att.get(id);
      if (a) return { n: i + 1, questionId: id, stem: qq.stem, feedback: feedbackView(qq, { correct: a.correct, score: a.score, marking: a.marking as Marking, ...keptAttemptView(qq, a) }) };
      if (held.has(id)) {
        // 425, owner decision R4: a short answer held unmarked until the end, graded now by the student against the notes.
        const f = feedbackView(qq, { correct: false, score: null, marking: "self_graded" });
        const k = keyOf(qq);
        return { n: i + 1, questionId: id, stem: qq.stem, held: { response: held.get(id)!, accepted: k?.kind === "accepted" ? k.answers : [f.answer], rationale: f.rationale, source: f.source, label: MARKING_LABEL.self_graded } };
      }
      return { n: i + 1, questionId: id, stem: qq.stem };
    });
    return <>{header}<AdaptiveReportView report={report} sessionId={st.session.id} title={title} review={review} /></>;
  }

  // ── the blueprint, and past exams ──
  const [materials, learner, exams, sqie, consent] = await Promise.all([
    listMaterials(ctx.admin, ctx.userId), loadLearnerCatalogue(ctx.admin, ctx.userId), listAdaptiveExams(ctx.admin, ctx.userId, 20), sqieSchema(ctx.admin, ctx.userId), readConsent(ctx.admin, ctx.userId),
  ]);
  const loader = await generationContextLoader(ctx.admin, ctx.userId, policy);
  const limits = blueprintLimits({ length: policy.scholarAdaptiveLength, maxLength: policy.scholarAdaptiveMaxLength, formats: policy.scholarAdaptiveFormats.filter(f => f !== "structured" || sqie), revisionFormats: policy.scholarRevisionFormats, feedback: "end" });
  const status = consent.ok ? consentStatus(consent.data, consentDocuments().published) : null;
  const standing = activityState(await getScholarAiStanding(ctx.admin, ctx.userId), "questions");
  const aiNote = policy.scholarRevisionGeneration === "saved_only" ? "New questions are not written here: the exam uses library and saved questions."
    : status !== "on" ? `${status ? aiOffMessage(status) ?? "AI help is off." : "Your AI help setting could not be read just now."} The exam uses library and saved questions.`
      : !standing.available ? `${standing.message ?? "New AI help is limited right now."} The exam uses library and saved questions.` : null;
  return (
    <>
      {header}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {limits.formats.length === 0
          ? <StatePanel title="No question format is offered for adaptive exams here"><p>Revision is unaffected.</p></StatePanel>
          : <AdaptiveStart formats={[...limits.formats]} length={limits.defaultLength} maxLength={limits.maxLength} feedback={limits.defaultFeedback}
              materials={materials.ok ? materials.data.filter(m => m.chunkCount > 0).map(m => ({ id: m.id, title: m.title })) : []}
              competencies={(learner.competencies ?? []).map(c => ({ id: c.id, title: c.title }))} programme={learner.programme?.label ?? null}
              levelDefault={loader.levelDefault} rule={ADAPTIVE_RULE} aiNote={aiNote}
              scope={adaptivePrefill(study?.scope ?? null, { materialIds: materials.ok ? materials.data.filter(m => m.chunkCount > 0).map(m => m.id) : [], competencyIds: (learner.competencies ?? []).map(c => c.id) })} />}
        <aside aria-labelledby="adaptive-history-h" className="rounded-2xl border border-gray-200 bg-white p-5">
          <h2 id="adaptive-history-h" className="text-[15px] font-bold text-gray-900">Your adaptive exams</h2>
          <p className="text-[12.5px] text-gray-600">{ADAPTIVE_REPORT_LABEL}</p>
          {!exams.ok ? (exams.notProvisioned ? <p className="mt-2 text-[13px] text-gray-600">Exams cannot be kept on this environment yet.</p> : <Unreadable what="your adaptive exams" />)
            : exams.data.length === 0 ? <p className="mt-2 text-[13px] text-gray-600">None yet. Each exam you take is kept here with its report.</p> : (
              <ul className="mt-2 divide-y divide-gray-100">
                {exams.data.map(x => {
                  const bp = blueprintOf(x.scope);
                  return (
                    <li key={x.session.id} className="py-2 text-[13.5px]">
                      <Link href={adaptiveHref(x.session.id)} className={`font-semibold underline underline-offset-2 ${focusRing}`}>{x.title}</Link>
                      <span className="block text-[12.5px] text-gray-600">
                        {new Date(x.session.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · {x.session.status === "completed" ? "finished" : "in progress"} · {x.session.position} of {bp?.length ?? x.session.total} answered
                        · practice score {x.marked ? `${Math.round((x.scoreSum / x.marked) * 100)}%` : "not measured yet"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
        </aside>
      </div>
    </>
  );
}
