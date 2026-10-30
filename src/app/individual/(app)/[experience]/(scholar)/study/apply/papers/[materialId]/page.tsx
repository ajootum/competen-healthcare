import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../../../_components/shell-context";
import { PageHeader, StatePanel, Unreadable, focusRing, BoundaryNotice } from "../../../../../../../_components/chrome";
import StudyNav from "../../../_components/StudyNav";
import { countDue, getMaterial } from "@/lib/individual/scholar/store";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { FORMATIVE_NOTICE } from "@/lib/individual/scholar/spaces";
import { NOTES_VERDICT, QUESTION_FLAG_TEXT, paperFlagText } from "@/lib/individual/scholar/exam-paper";
import { RESEARCH_DEPTH, webResearchState } from "@/lib/individual/scholar/exam-research";
import { LIVE_EXAM_NOTICE, judgeOpenedPaper } from "@/lib/individual/scholar/exam-service";
import { getExamPaper, listExamAnswers, listExamQuestions } from "@/lib/individual/scholar/exam-store";
import { PaperActions, PaperStudy, type AnswerContentView, type EvidenceView, type PaperQuestionView, type SavedAnswerView } from "../../../_components/paper-client";

export const dynamic = "force-dynamic";

// ONE EXAMINATION PAPER -- COMPETEN-SCHOLAR-EXAM-PAPERS-01 (570), in Apply: the paper's printed instructions, what
// could not be read, and each question as printed, to attempt and then reveal a suggested answer with its evidence.
// The student's latest saved answer is shown under each question. Read by the caller's own id: another person's
// paper is a 404.

export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Examination paper" });
}

export default async function PaperPage({ params }: { params: Promise<{ experience: string; materialId: string }> }) {
  const { experience, materialId } = await params;
  const page = await experienceModulePage(experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const [material, paper, due, policy] = await Promise.all([
    getMaterial(ctx.admin, ctx.userId, materialId), getExamPaper(ctx.admin, ctx.userId, materialId), countDue(ctx.admin, ctx.userId), loadIndividualPolicy(ctx.admin),
  ]);
  const header = (title: string) => (
    <>
      <p className="mb-2 text-[13px]"><Link href={experienceHref("scholar", "study/apply")} className={`font-semibold underline-offset-2 hover:underline ${focusRing}`} style={{ color: x.accent }}>← Apply</Link></p>
      <PageHeader accent={x.accent} eyebrow="Examination paper" title={title} intro="Attempt each question, then reveal a suggested answer with its evidence." />
      <StudyNav dueCount={due} />
    </>
  );
  if (!paper.ok) {
    return <>{header("Examination paper")}{paper.notProvisioned
      ? <StatePanel title="Studying examination papers is not set up here yet"><p>Nothing on your account has changed.</p></StatePanel>
      : <Unreadable what="examination paper" />}</>;
  }
  if (!material.ok) return <>{header("Examination paper")}<Unreadable what="material" /></>;
  if (!material.data || !paper.data) notFound();

  const [questions, answers] = await Promise.all([listExamQuestions(ctx.admin, ctx.userId, materialId), listExamAnswers(ctx.admin, ctx.userId, materialId)]);
  const p = policy.scholarExams;
  const web = webResearchState(p);
  const views: PaperQuestionView[] = (questions.ok ? questions.data : []).map(q => ({
    id: q.id, number: q.number, section: q.section, instructions: q.instructions, stem: q.stem, options: q.options, marks: q.marks,
    pages: q.pageFrom === null ? null : q.pageTo !== null && q.pageTo !== q.pageFrom ? `pages ${q.pageFrom}-${q.pageTo}` : `page ${q.pageFrom}`,
    leadIn: q.flags.some(f => f.kind === "lead_in"), flags: q.flags.filter(f => f.kind !== "lead_in").map(f => QUESTION_FLAG_TEXT[f.kind]),
  }));
  const saved: Record<string, SavedAnswerView> = {};
  const guides: { id: string; text: string; createdAt: string }[] = [];
  for (const a of answers.ok ? answers.data : []) {
    if (a.kind === "guide") { guides.push({ id: a.id, text: String(a.content.text ?? ""), createdAt: a.createdAt }); continue; }
    if (!a.questionId || saved[a.questionId]) continue;
    saved[a.questionId] = {
      id: a.id, content: a.content as unknown as AnswerContentView, evidence: a.evidence as unknown as EvidenceView[],
      attempt: a.attempt as SavedAnswerView["attempt"], research: a.research as SavedAnswerView["research"], model: a.model, createdAt: a.createdAt, revisionQuestionId: a.revisionQuestionId,
    };
  }
  const depths = (Object.keys(RESEARCH_DEPTH) as ("quick" | "standard" | "deep")[]).filter(d => RESEARCH_DEPTH[d].maxUses <= RESEARCH_DEPTH[p.depth].maxUses);
  // SCHOLAR-SQIE-CLOSE-01 P0: a paper an earlier parser kept is judged again with today's rules, in this response only
  // (nothing is written to the paper, its questions or its answers). Statements are never offered as questions.
  const legacy = questions.ok ? await judgeOpenedPaper(ctx, paper.data, questions.data) : null;
  const statementIds = new Set(legacy?.statementIds ?? []);
  const asked = views.filter(v => !statementIds.has(v.id));
  const statementViews = views.filter(v => statementIds.has(v.id));
  const practise = experienceHref("scholar", `study/revise?material=${materialId}`);

  if (legacy?.notesLike) {
    return (
      <>
        {header(material.data.title)}
        <section aria-labelledby="legacy-notes-h" className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-5">
          <h2 id="legacy-notes-h" className="text-[16px] font-bold text-amber-950">Notes, not an examination paper</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-amber-950">{NOTES_VERDICT}</p>
          <Link href={practise} className={`${primaryBtn} mt-3`} style={{ background: x.accent }}>Practise questions from this material</Link>
          <details className="mt-4">
            <summary className={`inline-flex min-h-[44px] cursor-pointer items-center text-[14px] font-semibold text-amber-950 underline underline-offset-2 ${focusRing}`}>Show the original anyway</summary>
            <p className="mt-2 text-[13.5px] text-amber-950">Shown as it was kept, read-only. Lines marked as from the notes are statements, not questions.</p>
            {paper.data.instructions && <p className="mt-2 whitespace-pre-line text-[13.5px] text-gray-700">{paper.data.instructions}</p>}
            <OriginalPaper views={views} statementIds={statementIds} saved={saved} />
          </details>
        </section>
        <PaperActions materialId={materialId} guides={guides} />
      </>
    );
  }

  return (
    <>
      {header(material.data.title)}
      <BoundaryNotice notice={FORMATIVE_NOTICE} detail={<>Suggested answers are AI-written study material, not an answer key or a mark. {LIVE_EXAM_NOTICE}</>} />
      {!p.enabled && <StatePanel title="Studying examination papers is not offered at the moment"><p>Your paper and saved answers are kept and shown below. New suggested answers are not available.</p></StatePanel>}

      {(paper.data.instructions || paper.data.flags.length > 0) && (
        <section aria-labelledby="paper-ins-h" className="mb-5 rounded-2xl border border-gray-200 bg-white p-5">
          <h2 id="paper-ins-h" className="text-[16px] font-bold text-gray-900">About this paper</h2>
          {paper.data.instructions && <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-gray-700">{paper.data.instructions}</p>}
          {paper.data.flags.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {paper.data.flags.map((f, i) => <li key={i} className="rounded-lg bg-[var(--cmp-role-revision-soft)] px-3 py-2 text-[13px] text-[var(--cmp-role-revision-ink)]">{paperFlagText(f)}</li>)}
            </ul>
          )}
          <p className="mt-3 text-[13px]"><a href={`/api/individual/scholar/materials/${materialId}`} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: x.accent }}>Open the original paper</a> to check anything flagged, including figures and diagrams.</p>
        </section>
      )}

      {!questions.ok ? <Unreadable what="questions" />
        : views.length === 0 ? (
          <StatePanel title="No questions were found in this paper">
            <p>Nothing was guessed. You can still study it as notes from <Link href={experienceHref("scholar", `study/${materialId}`)} className="font-semibold underline">the material page</Link>.</p>
          </StatePanel>
        ) : (
          <PaperStudy questions={asked} saved={saved}
            choice={{ notes: p.sources.includes("notes"), library: p.sources.includes("library"), web: web.on ? { on: true, reason: null } : { on: false, reason: web.reason }, depth: p.depth }}
            webDepths={depths} />
        )}

      {statementViews.length > 0 && (
        <section aria-labelledby="legacy-lines-h" className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-5">
          <h2 id="legacy-lines-h" className="text-[16px] font-bold text-amber-950">
            {statementViews.length === 1 ? "1 numbered line is from the notes, not a question" : `${statementViews.length} numbered lines are from the notes, not questions`}
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-amber-950">They are statements, so they are not offered as questions to answer. <Link href={practise} className={`font-semibold underline underline-offset-2 ${focusRing}`}>Practise questions from this material</Link> to be tested on them.</p>
          <details className="mt-3">
            <summary className={`inline-flex min-h-[44px] cursor-pointer items-center text-[14px] font-semibold text-amber-950 underline underline-offset-2 ${focusRing}`}>Show them anyway</summary>
            <OriginalPaper views={statementViews} statementIds={statementIds} saved={saved} />
          </details>
        </section>
      )}

      <PaperActions materialId={materialId} guides={guides} />
    </>
  );
}

const primaryBtn = `inline-flex min-h-[44px] items-center justify-center rounded-[9px] px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 ${focusRing}`;

/** SCHOLAR-SQIE-CLOSE-01 P0: a kept paper shown read-only, each statement labelled as from the notes, with any saved answer. */
function OriginalPaper({ views, statementIds, saved }: { views: PaperQuestionView[]; statementIds: Set<string>; saved: Record<string, SavedAnswerView> }) {
  return (
    <ol className="mt-3 space-y-3">
      {views.map(q => {
        const statement = statementIds.has(q.id);
        const s = saved[q.id];
        return (
          <li key={q.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className={`text-[12px] font-bold uppercase tracking-[0.1em] ${statement ? "text-amber-900" : "text-gray-500"}`}>
              {statement ? `Line ${q.number} · from the notes, not a question` : `Question ${q.number}`}{q.pages ? ` · ${q.pages}` : ""}
            </p>
            <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-gray-800">{q.stem}</p>
            {q.options.length > 0 && <ul className="mt-2 space-y-1 text-[14px] text-gray-800">{q.options.map(o => <li key={o.label}>{o.label}. {o.text}</li>)}</ul>}
            {s && (
              <div className="mt-3 rounded-lg bg-[var(--cmp-app-bg)] p-3 text-[13.5px] text-gray-700">
                <p className="text-[12px] text-gray-500">Your saved answer · {new Date(s.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                {s.attempt && (s.attempt.option || s.attempt.text) && <p className="mt-1"><span className="font-semibold">Your attempt:</span> {[s.attempt.option, s.attempt.text].filter(Boolean).join(". ")}</p>}
                {s.content.examAnswer && <p className="mt-1 whitespace-pre-line"><span className="font-semibold">Suggested answer (AI-written):</span> {s.content.examAnswer}</p>}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
