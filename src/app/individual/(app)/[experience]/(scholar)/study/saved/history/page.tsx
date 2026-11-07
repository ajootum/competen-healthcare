import Link from "next/link";
import { formatForReader, type ReaderClock } from "@/lib/datetime";
import { readerClock } from "@/lib/individual/scholar/reader-clock";
import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../../_components/shell-context";
import { PageHeader, StatePanel, Unreadable, focusRing } from "../../../../../../_components/chrome";
import StudyNav from "../../_components/StudyNav";
import { studyHref } from "../../_components/question-view";
import { countDue, isUuid } from "@/lib/individual/scholar/store";
import { loadHistoryIndex, loadQuestionHistory } from "@/lib/individual/scholar/question-history-data";
import { EXAM_ANSWER_LABEL, HISTORY_NOTE, HISTORY_SOURCE_LABEL, OUTCOME_WORD, versionLabel, type HistoryEntry, type QuestionHistory } from "@/lib/individual/scholar/question-history";

// Request-time only: it reads the session and must never be prerendered at build.
export const dynamic = "force-dynamic";

// QUESTION HISTORY -- SQIE-CLOSE-2026-11 WS-I. One place where a learner sees every answer they gave to one of their questions,
// wherever it was asked (practice, Revise sessions, adaptive and mock exams, Check your understanding) and the exam-paper answers it
// was made from, each with what it was marked against at the time, so an old answer still reads correctly after the question or its
// guide changed. Database reads only (question-history-data.ts): no AI, so it is always available. Formative, never an assessment.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Question history" });
}

const pct = (s: number | null) => (s === null ? null : `${Math.round(s * 100)}%`);

function Entry({ e, clock }: { e: HistoryEntry; clock: ReaderClock | null }) {
  const when = (iso: string) => formatForReader(iso, clock, "dateTime");
  if (e.kind === "exam_answer") {
    return (
      <li className="py-3" data-source="exam_paper">
        <p className="text-[12px] text-gray-500">{when(e.answeredAt)} · <span className="font-semibold text-gray-800">{e.sourceLabel}</span></p>
        {e.examQuestion && <p className="mt-0.5 break-words text-[13.5px] text-gray-800"><span className="font-semibold">As printed:</span> {e.examQuestion}</p>}
        <p className="mt-0.5 break-words text-[13.5px] text-gray-800"><span className="font-semibold">You:</span> {e.attempt ?? "No attempt of your own was made first."}</p>
        <p className="mt-1 text-[12px] text-gray-600">{EXAM_ANSWER_LABEL} Model {e.model} · prompt {e.promptVersion}</p>
      </li>
    );
  }
  const m = e.markedAgainst;
  const version = versionLabel(m.questionVersion);
  return (
    <li className="py-3" data-source={e.source}>
      <p className="text-[12px] text-gray-500">
        {when(e.answeredAt)} · <span className="font-semibold text-gray-800">{e.sourceLabel}</span>{e.step !== null ? ` · lesson ${e.step + 1}` : ""} · <span className="font-semibold text-gray-900">{OUTCOME_WORD[e.outcome]}</span>
        {pct(e.score) && e.outcome !== "correct" && e.outcome !== "unmarked" ? ` (${pct(e.score)})` : ""}
      </p>
      {e.original && <p className="mt-0.5 text-[12px] text-amber-800">Corrected. Originally marked {OUTCOME_WORD[e.original.outcome].toLowerCase()}{pct(e.original.score) ? ` (${pct(e.original.score)})` : ""}.</p>}
      <p className="mt-0.5 break-words text-[13.5px] text-gray-800"><span className="font-semibold">You:</span> {e.answer ?? "Your answer was not kept in words."}</p>
      <p className="mt-1 text-[12px] text-gray-600">{e.markingLabel}{e.evaluator ? ` Model ${e.evaluator.model} · prompt ${e.evaluator.promptVersion}.` : ""}</p>
      <div className="mt-1 rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-700">
        <p><span className="font-semibold">Marked against:</span> {version ?? "the question version was not recorded"}
          {m.contentHash ? ` · question ${m.contentHash}` : ""}{m.guideHash ? ` · marking guide ${m.guideHash}` : " · no marking guide kept"}</p>
        {m.frameworks.length > 0 && <p className="mt-0.5"><span className="font-semibold">Competency mapping:</span> {m.frameworks.join("; ")}</p>}
        {m.objective && <p className="mt-0.5"><span className="font-semibold">Learning objective:</span> {m.objective}</p>}
        {m.notes.map(n => <p key={n} className="mt-0.5">{n}</p>)}
      </div>
    </li>
  );
}

function Detail({ h, clock }: { h: QuestionHistory; clock: ReaderClock | null }) {
  const counts = Object.entries(h.bySource).map(([k, n]) => `${k === "exam_paper" ? "Exam paper" : HISTORY_SOURCE_LABEL[k as keyof typeof HISTORY_SOURCE_LABEL]} ${n}`).join(" · ");
  return (
    <section aria-labelledby="qh-h" className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <h2 id="qh-h" className="break-words text-[15px] font-bold text-gray-900">{h.stem}</h2>
      <p className="mt-1 text-[12.5px] text-gray-600">{h.entries.length ? counts : "No answers yet."}</p>
      {h.entries.length > 0 && <ul className="mt-2 divide-y divide-gray-200">{h.entries.map(e => <Entry key={e.kind === "attempt" ? e.attemptId : e.id} e={e} clock={clock} />)}</ul>}
    </section>
  );
}

export default async function QuestionHistoryPage({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const clock = await readerClock(page.ctx);
  const { ctx } = page;
  const search = await searchParams;
  const qid = typeof search.q === "string" && isUuid(search.q) ? search.q : null;
  const [due, index, detail] = await Promise.all([
    countDue(ctx.admin, ctx.userId), loadHistoryIndex(ctx.admin, ctx.userId),
    qid ? loadQuestionHistory(ctx.admin, ctx.userId, qid) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader accent={SCHOLAR.accent} eyebrow="Kept for you" title="Question history" intro={HISTORY_NOTE} />
      <StudyNav dueCount={due} study={null} />
      <p className="mb-4 text-[13px]"><Link href={studyHref("saved")} className={`font-semibold underline underline-offset-2 ${focusRing}`}>Back to saved learning</Link></p>

      {detail && (!detail.ok ? <div className="mb-6"><Unreadable what="this question's history" /></div>
        : !detail.data ? <div className="mb-6"><StatePanel title="That question could not be found"><p>It may have been removed with its notes.</p></StatePanel></div>
          : <Detail h={detail.data} clock={clock} />)}

      <section aria-labelledby="qh-list-h" className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
        <h2 id="qh-list-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Questions you answered recently</h2>
        {!index.ok ? <div className="mt-3"><Unreadable what="your answered questions" /></div>
          : index.data.length === 0 ? <p className="mt-3 text-[14px] text-gray-600">No answers yet. Questions you answer in Revise, in exams and in your lessons appear here.</p>
            : (
              <ul className="mt-2 divide-y divide-gray-200">
                {index.data.map(i => (
                  <li key={i.questionId} className="py-2">
                    <Link href={`${studyHref("saved/history")}?q=${i.questionId}`} aria-current={i.questionId === qid ? "true" : undefined}
                      className={`block min-h-[44px] rounded-lg px-2 py-1.5 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
                      <span className="block break-words text-[14px] font-semibold text-gray-900">{i.stem}</span>
                      <span className="block text-[12px] text-gray-600">{i.count} answer{i.count === 1 ? "" : "s"} · last {formatForReader(i.lastAt, clock, "dateTime")}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
      </section>
    </>
  );
}
