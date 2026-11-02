import { headers } from "next/headers";
import type { Metadata } from "next";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { learnerTimeZone, learnerToday } from "@/lib/individual/scholar/learning-definitions";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { experienceModulePage, gatedMetadata } from "@/app/individual/_components/shell-context";
import { Notice, PageHeader, Unreadable } from "@/app/individual/_components/chrome";
import { EmptyLine, RowList, TextLink } from "../../_module/module-parts";
import { gapsView } from "../competencies-view";
import { loadCoverage, myPlanOn, programmesOffered } from "../competency-profile-data";

export const dynamic = "force-dynamic";

// MY DEVELOPMENT GAPS -- SCHOLAR-MODULES-01. The competencies of the learner's programme their practice has not yet
// touched, highest expected level first: Learning Intelligence's coverage.gaps, the very list Progress reports (one
// computation). "Not practised yet" is a fact about practice, never a judgement that the competency is lacking.
// Each gap links to Learn on that competency, and to My Plan where it is on. No AI.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "My Development Gaps" }); }

export default async function DevelopmentGaps({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "my-competencies");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const hdrs = await headers();
  const learner = await loadLearnerCatalogue(ctx.admin, ctx.userId);
  const [offered, coverage, plan] = await Promise.all([
    programmesOffered(ctx.admin, learner),
    loadCoverage(ctx.admin, ctx.userId, learner, learnerToday(hdrs), learnerTimeZone(hdrs)),
    myPlanOn(ctx.admin, ctx.userId),
  ]);
  const view = gapsView(learner, coverage, offered);
  return (
    <>
      <PageHeader accent={x.accent} eyebrow="My Competencies" title="My Development Gaps" intro="Competencies in your programme that your practice has not reached yet." />
      {view.kind === "unreadable" ? <Unreadable what="development gaps" />
        : view.kind === "not_set_up" || view.kind === "no_programme" ? <EmptyLine>{view.text}</EmptyLine>
          : view.kind === "not_measured" ? <EmptyLine>{view.reason}</EmptyLine>
            : view.kind === "none" ? <EmptyLine>Your practice has touched every one of the {view.total} competencies in {view.framework}. That is practice, not an assessment of competence.</EmptyLine>
              : (
                <>
                  <Notice>Practised {view.covered} of {view.total} competencies in {view.framework}. These {view.gaps.length} are not practised yet, highest expected level first. Not practised yet is not a judgement about you: practice counts once you have accepted the link from a section of your notes to a competency.</Notice>
                  <RowList>
                    {view.gaps.map(g => (
                      <li key={g.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                        <div className="min-w-0">
                          <p className="text-[14.5px] font-semibold text-gray-900">{g.name}</p>
                          <p className="text-[12.5px] text-gray-600">{g.expected ? `Expected level: ${g.expected}` : "No expected level set"}</p>
                        </div>
                        <TextLink href={experienceHref("scholar", `study/learn?competency=${encodeURIComponent(g.id)}`)} accent={x.accent}>Learn this competency</TextLink>
                      </li>
                    ))}
                  </RowList>
                  {plan && <p className="mt-3"><TextLink href={experienceHref("scholar", "study/plan")} accent={x.accent}>Plan your study in My Plan</TextLink></p>}
                </>
              )}
    </>
  );
}
