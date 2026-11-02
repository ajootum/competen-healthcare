import { experienceHref, SCHOLAR } from "@/lib/individual/experiences";
import { withStudy } from "@/lib/individual/scholar/study-carry";
import { Notice, Unreadable } from "@/app/individual/_components/chrome";
import { EmptyLine, RowList, TextLink } from "../_module/module-parts";
import type { GapsView } from "./competencies-view";

// MY DEVELOPMENT GAPS -- now the foot of the Overview (#gaps). The competencies of the learner's programme their practice has not yet touched, highest
// expected level first: Learning Intelligence's coverage.gaps, the very list Progress reports (one computation). "Not practised yet" is a fact about
// practice, never a judgement that the competency is lacking. Gaps found by a self-assessment are shown with that self-assessment, above. No AI.

export function GapsSection({ view, myPlanOn, study }: { view: GapsView; myPlanOn: boolean; study: string | null }) {
  const x = SCHOLAR;
  if (view.kind === "unreadable") return <Unreadable what="development gaps" />;
  if (view.kind === "not_set_up" || view.kind === "no_programme") return <EmptyLine>{view.text}</EmptyLine>;
  if (view.kind === "not_measured") return <EmptyLine>{view.reason}</EmptyLine>;
  if (view.kind === "none") return <EmptyLine>Your practice has touched every one of the {view.total} competencies in {view.framework}. That is practice, not an assessment of competence.</EmptyLine>;
  return (
    <>
      <Notice>Practised {view.covered} of {view.total} competencies in {view.framework}. These {view.gaps.length} are not practised yet, highest expected level first. Not practised yet is not a judgement about you: practice counts once you have accepted the link from a section of your notes to a competency.</Notice>
      <RowList>
        {view.gaps.map(g => (
          <li key={g.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
            <div className="min-w-0">
              <p className="text-[14.5px] font-semibold text-gray-900">{g.name}</p>
              <p className="text-[12.5px] text-gray-600">{g.expected ? `Expected level: ${g.expected}` : "No expected level set"}</p>
            </div>
            <TextLink href={withStudy(experienceHref("scholar", `study/learn?competency=${encodeURIComponent(g.id)}`), study)} accent={x.accent}>Learn this competency</TextLink>
          </li>
        ))}
      </RowList>
      {myPlanOn && <p className="mt-3"><TextLink href={withStudy(experienceHref("scholar", "study/plan"), study)} accent={x.accent}>Plan your study in My Plan</TextLink></p>}
    </>
  );
}
