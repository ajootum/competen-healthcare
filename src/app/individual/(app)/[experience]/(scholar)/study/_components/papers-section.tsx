import Link from "next/link";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { listMaterials } from "@/lib/individual/scholar/store";
import { listAllExamAnswers, listExamPapers } from "@/lib/individual/scholar/exam-store";
import { loadIndividualPolicy } from "@/lib/individual/policy";

// Past and practice examination papers (COMPETEN-SCHOLAR-EXAM-PAPERS-01), where they are studied: Apply lists them,
// Revise and Evaluate show what came of them. Nothing at all where 570 is not applied or policy does not offer it,
// so no space shows a section that cannot work.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const card = "rounded-2xl border border-gray-200 bg-white p-5";

export async function ExamPapersSection({ admin, userId, variant }: { admin: unknown; userId: string; variant: "apply" | "revise" | "evaluate" }) {
  const policy = await loadIndividualPolicy(admin);
  if (!policy.scholarExams.enabled) return null;
  const [papers, materials, answers] = await Promise.all([listExamPapers(admin, userId), listMaterials(admin, userId), listAllExamAnswers(admin, userId)]);
  if (!papers.ok) return null;
  const titles = new Map((materials.ok ? materials.data : []).map(m => [m.id, m.title]));
  const all = answers.ok ? answers.data.filter(a => a.kind === "answer") : [];
  const x = SCHOLAR;

  if (variant === "apply") {
    return (
      <section aria-labelledby="papers-h" className={`${card} mb-6`}>
        <h2 id="papers-h" className="text-[16px] font-bold text-gray-900">Past and practice papers</h2>
        <p className="mt-1 text-[14px] text-gray-600">Attempt each question, then reveal a suggested answer with its evidence. After uploading a paper, choose “Study as an examination paper” on its page.</p>
        {/* HFE-01 Wave 5 (F12): the way in, where people look for it -- the Library upload dialog (#upload). */}
        <Link href={`${experienceHref("scholar", "study")}#upload`} className={`mt-3 inline-flex min-h-[44px] items-center rounded-xl px-4 text-[14px] font-semibold text-white ${focusRing}`} style={{ background: x.accent }}>Add a paper</Link>
        {papers.data.length === 0 ? <p className="mt-3 text-[14px] text-gray-600">No papers yet.</p> : (
          <ul className="mt-3 divide-y divide-gray-200">
            {papers.data.map(p => {
              const done = new Set(all.filter(a => a.materialId === p.materialId).map(a => a.questionId)).size;
              return (
                <li key={p.materialId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold text-gray-900">{titles.get(p.materialId) ?? "Examination paper"}</span>
                    <span className="text-[12.5px] text-gray-600">{p.questionCount} question{p.questionCount === 1 ? "" : "s"} · {done} with a saved answer{p.flags.length ? " · some content flagged" : ""}</span>
                  </span>
                  <Link href={experienceHref("scholar", `study/apply/papers/${p.materialId}`)} className={`text-[14px] font-semibold underline-offset-2 hover:underline ${focusRing}`} style={{ color: x.accent }}>Open →</Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  }
  if (!papers.data.length) return null;
  if (variant === "revise") {
    const cards = all.filter(a => a.revisionQuestionId).length;
    return (
      <section aria-labelledby="papers-rev-h" className={`${card} mb-6`}>
        <h2 id="papers-rev-h" className="text-[16px] font-bold text-gray-900">From your examination papers</h2>
        <p className="mt-1 text-[14px] text-gray-600">
          {cards ? `${cards} suggested answer${cards === 1 ? " is" : "s are"} in your revision as flashcards, on the same schedule as the rest.` : "Add a suggested answer to revision from a paper, and it comes back here on your schedule."}
          {" "}Revision guides are written on each paper’s page.
        </p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {papers.data.slice(0, 6).map(p => <li key={p.materialId}><Link href={experienceHref("scholar", `study/apply/papers/${p.materialId}`)} className={`text-[14px] font-semibold underline-offset-2 hover:underline ${focusRing}`} style={{ color: x.accent }}>{titles.get(p.materialId) ?? "Examination paper"}</Link></li>)}
        </ul>
      </section>
    );
  }
  // Evaluate: what the practice shows, as practice -- never a score. Choices are compared with the AI's suggested option.
  const choices = all.filter(a => a.attempt && typeof (a.attempt as { option?: unknown }).option === "string" && typeof a.content.option === "string");
  const matched = choices.filter(a => (a.attempt as { option: string }).option === a.content.option).length;
  const attempted = all.filter(a => a.attempt).length;
  const differs = all.filter(a => a.content.guidanceStatus === "differs").length;
  return (
    <section aria-labelledby="papers-ev-h" className={`${card} mb-6`}>
      <h2 id="papers-ev-h" className="text-[16px] font-bold text-gray-900">Examination paper practice</h2>
      <p className="mt-1 text-[13.5px] text-gray-600">Formative practice, not a mark: suggested answers are AI-written from evidence, not an answer key.</p>
      <dl className="mt-3 grid gap-3 sm:grid-cols-3">
        <div><dt className="text-[12px] text-gray-600">Questions attempted before revealing</dt><dd className="text-[24px] font-bold text-gray-900 tabular-nums">{attempted}</dd></div>
        <div><dt className="text-[12px] text-gray-600">Choices matching the suggested option</dt><dd className="text-[24px] font-bold text-gray-900 tabular-nums">{choices.length ? `${matched} / ${choices.length}` : "Not measured"}</dd></div>
        <div><dt className="text-[12px] text-gray-600">Where current guidance differs from the paper</dt><dd className="text-[24px] font-bold text-gray-900 tabular-nums">{differs}</dd></div>
      </dl>
      {choices.length > 0 && choices.length < 5 && <p className="mt-2 text-[12.5px] text-gray-600">Too few answers to show a trend.</p>}
    </section>
  );
}
