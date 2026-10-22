import Link from "next/link";
import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage } from "../../../../../_components/shell-context";
import { experienceHref } from "@/lib/individual/experiences";
import { countDue, listQuestions } from "@/lib/individual/scholar/store";
import { PageHeader, StatePanel, Unreadable, focusRing } from "../../../../../_components/chrome";
import { questionView } from "../_components/question-view";
import StudyNav from "../_components/StudyNav";
import { QuestionCard } from "../_components/client";

// APPLY -- COMPETEN-IND-004 s5. Case-style questions written from the person's OWN material, answered
// with feedback that cites the source. Written from a section on a material page ("Case question").
//
// ⚠ SHARED CLINICAL CONTENT IS NOT SERVED, AND THE PAGE SAYS WHY. clinical_cases (migration 026) has a
// status and a source reference but no clinical-review record -- no reviewer, no date, no scope
// (COMPETEN-IND-002 s3.3). Scholar serves shared content only once that record exists. So this page
// reads nothing from clinical_cases, and shows the governed state below in its place.

export const metadata: Metadata = { title: "Apply" };

export default async function Apply({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const [questions, due] = await Promise.all([listQuestions(ctx.admin, ctx.userId, { kind: "case" }), countDue(ctx.admin, ctx.userId)]);

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="My Learning" title="Apply"
        intro="Case questions put what you have studied into a scenario. They are written from your own notes, and the feedback shows the passage each answer rests on." />
      <StudyNav dueCount={due} />

      <section aria-labelledby="own-cases-h">
        <h2 id="own-cases-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">From your material</h2>
        <div className="mt-3">
          {!questions.ok ? (questions.notProvisioned
            ? <StatePanel title="Case practice is not set up on this environment yet"><p>The study store it needs has not been installed here.</p></StatePanel>
            : <Unreadable what="case questions" />)
            : questions.data.length === 0 ? (
              <StatePanel title="No case questions yet">
                <p>Open one of your materials and choose <span className="font-semibold">Case question</span> on a section that describes a condition, an assessment or its management.</p>
                <p><Link href={experienceHref("scholar", "study")} className={`font-semibold underline ${focusRing}`} style={{ color: x.accent }}>Go to your materials</Link></p>
              </StatePanel>
            ) : (
              <div className="space-y-4">
                {questions.data.map((q, i) => <QuestionCard key={q.id} q={questionView(q)} index={i + 1} chunkId={q.chunkId} />)}
              </div>
            )}
        </div>
      </section>

      <section aria-labelledby="shared-h" className="mt-10">
        <h2 id="shared-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Reviewed clinical cases</h2>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
          <p className="text-[15px] font-semibold text-gray-900">Not available yet</p>
          <p className="mt-1 text-[14px] leading-relaxed text-gray-700">
            Competen has shared clinical cases, but none of them carries a record of clinical review (who reviewed it, when, and for what).
            Until that record exists, they are not shown to students here. Your own case questions above are not clinically reviewed either, and are labelled as such.
          </p>
        </div>
      </section>
    </>
  );
}
