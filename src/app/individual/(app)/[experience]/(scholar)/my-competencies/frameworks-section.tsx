import { LAYER_LABEL } from "@/lib/individual/scholar/catalogue";
import { Notice, Unreadable } from "@/app/individual/_components/chrome";
import { LayerTag } from "../study/_components/competency-client";
import { ContentStatusTag } from "../study/_components/client";
import { Fold } from "../study/_components/progress-parts";
import { EmptyLine } from "../_module/module-parts";
import type { FrameworksView } from "./competencies-view";

// COMPETENCY FRAMEWORKS -- now the foot of the Overview (#frameworks). The competencies of the learner's programme, grouped by the framework they sit
// in, through loadLearnerCatalogue ONLY (published, active, HQ-allowlisted, fail-closed). Layer, profession and content status are shown as the
// catalogue records them. The view is decided by competencies-view.frameworksView from rows already read: this component reads nothing.

export function FrameworksSection({ view }: { view: FrameworksView }) {
  if (view.kind === "unreadable") return <Unreadable what="competency frameworks" />;
  if (view.kind === "not_set_up" || view.kind === "no_programme") return <EmptyLine>{view.text}</EmptyLine>;
  if (view.kind === "empty") {
    return (
      <>
        <EmptyLine>{view.text}</EmptyLine>
        {view.heldBack > 0 && <p className="mt-3 text-[13px] text-gray-600">Only clinically approved content is offered, and none of the {view.heldBack} competencies in your programme is approved yet.</p>}
      </>
    );
  }
  return (
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
  );
}
