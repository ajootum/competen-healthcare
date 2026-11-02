import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { LAYER_LABEL } from "@/lib/individual/scholar/catalogue";
import { loadLearnerCatalogue } from "@/lib/individual/scholar/competency-view";
import { experienceModulePage, gatedMetadata } from "@/app/individual/_components/shell-context";
import { Notice, PageHeader, Unreadable } from "@/app/individual/_components/chrome";
import { LayerTag } from "../../study/_components/competency-client";
import { ContentStatusTag } from "../../study/_components/client";
import { Fold } from "../../study/_components/progress-parts";
import { EmptyLine } from "../../_module/module-parts";
import { frameworksView } from "../competencies-view";
import { programmesOffered } from "../competency-profile-data";

export const dynamic = "force-dynamic";

// COMPETENCY FRAMEWORKS -- SCHOLAR-MODULES-01. The competencies of the learner's programme, grouped by the framework they
// sit in, through loadLearnerCatalogue ONLY: published, active, HQ-allowlisted and fail-closed (the preview reader is
// never used here). Layer, profession and content status are shown on each, as the catalogue records them.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Competency Frameworks" }); }

export default async function CompetencyFrameworks({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "my-competencies");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const learner = await loadLearnerCatalogue(ctx.admin, ctx.userId);
  const view = frameworksView(learner, await programmesOffered(ctx.admin, learner));
  return (
    <>
      <PageHeader accent={x.accent} eyebrow="My Competencies" title="Competency Frameworks" intro="The published frameworks behind your programme." />
      {view.kind === "unreadable" ? <Unreadable what="competency frameworks" />
        : view.kind === "not_set_up" || view.kind === "no_programme" ? <EmptyLine>{view.text}</EmptyLine>
          : view.kind === "empty" ? (
            <>
              <EmptyLine>{view.text}</EmptyLine>
              {view.heldBack > 0 && <p className="mt-3 text-[13px] text-gray-600">Only clinically approved content is offered, and none of the {view.heldBack} competencies in your programme is approved yet.</p>}
            </>
          ) : (
            <>
              <Notice>{view.programme}. These are the competencies your programme uses. Listing one does not mean you have achieved it.</Notice>
              {view.heldBack > 0 && <p className="mb-3 text-[13px] text-gray-600">{view.heldBack} competenc{view.heldBack === 1 ? "y" : "ies"} in your programme {view.heldBack === 1 ? "is" : "are"} held back until clinically approved.</p>}
              <div className="space-y-3">
                {view.groups.map(g => (
                  <Fold key={g.frameworkId} summary={`${g.name} · ${g.competencies.length} competenc${g.competencies.length === 1 ? "y" : "ies"}`} label={g.layers.map(l => LAYER_LABEL[l as keyof typeof LAYER_LABEL] ?? l).join(", ")}>
                    <ul className="divide-y divide-gray-100">
                      {g.competencies.map(c => (
                        <li key={c.id} className="px-4 py-3">
                          <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-gray-900">
                            {c.code ? `${c.code} ` : ""}{c.title}<LayerTag layer={c.layer} /><ContentStatusTag status={c.contentStatus} />
                          </p>
                          <p className="mt-0.5 text-[12.5px] text-gray-600">{[c.profession, c.domain].filter(Boolean).join(" · ")}</p>
                        </li>
                      ))}
                    </ul>
                  </Fold>
                ))}
              </div>
            </>
          )}
    </>
  );
}
