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
import { QUESTION_FLAG_TEXT, paperFlagText } from "@/lib/individual/scholar/exam-paper";
import { RESEARCH_DEPTH, webResearchState } from "@/lib/individual/scholar/exam-research";
import { LIVE_EXAM_NOTICE } from "@/lib/individual/scholar/exam-service";
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
          <PaperStudy questions={views} saved={saved}
            choice={{ notes: p.sources.includes("notes"), library: p.sources.includes("library"), web: web.on ? { on: true, reason: null } : { on: false, reason: web.reason }, depth: p.depth }}
            webDepths={depths} />
        )}

      <PaperActions materialId={materialId} guides={guides} />
    </>
  );
}
