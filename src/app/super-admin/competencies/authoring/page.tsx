import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { loadAuthoringView } from "@/lib/competency/authoring-view";
import { ImportDraft, NewFramework } from "./_components/AuthoringControls";
import FrameworkLibrary from "./_components/FrameworkLibrary";

// /super-admin/competencies/authoring -- CFCA authoring in production (migration 465), CFCA-STUDIO-UX-02 layout: the
// framework LIBRARY. Each framework opens in its own focused page (./[frameworkId]), where its competencies are edited
// and put forward for independent clinical review. Guarded by hq.quality.competency.author (the Competency Author).
// Draft -> put forward for review (here) -> Clinical Approval (/clinical-review, an independent reviewer) -> Publication
// (the governed framework lifecycle). Nothing here says approved unless 395 proves it.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Competency authoring" };

const STATUS_LABEL: Record<string, string> = { draft: "Draft", in_review: "In governance review", approved: "Approved for publication", published: "Published", archived: "Archived" };

export default async function CompetencyAuthoringPage() {
  const ctx = await requireHqCapability("hq.quality.competency.author");
  const v = await loadAuthoringView(ctx.admin);
  const fwOpts = (v?.frameworks ?? []).map(f => ({ id: f.id, name: f.name, code: f.code }));
  return (
    <div className="max-w-7xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Your shared standards</p>
          <h1 className="text-[26px] font-bold text-gray-900">Framework library</h1>
          <p className="mt-1 text-sm text-gray-600">
            Find a framework and open it to edit its competencies and put them forward for independent clinical review.
            You cannot review content you wrote, edited or put forward. Approval and publication are separate steps.
          </p>
        </div>
      </header>

      {v === null ? (
        <p role="alert" className="rounded-lg border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">
          The frameworks could not be read just now. Nothing is shown rather than a partial list.
        </p>
      ) : (
        <>
          <FrameworkLibrary cards={v.frameworks.map(f => {
            const comps = f.domains.flatMap(d => d.competencies);
            return { id: f.id, name: f.name, code: f.code, layer: f.layer, status: f.pubStatus, statusLabel: STATUS_LABEL[f.pubStatus] ?? f.pubStatus,
              profession: v.professions.find(p => p.id === f.professionTermId)?.value ?? null, domains: f.domains.length, competencies: comps.length,
              criteria: comps.reduce((s, c) => s + c.criteria.length, 0) };
          })} />
          <section aria-labelledby="new-h" className="rounded-2xl border border-gray-200 bg-white p-5">
            <details>
              <summary id="new-h" className="cursor-pointer text-[15px] font-bold text-gray-900">+ New framework</summary>
              <div className="mt-3"><NewFramework professions={v.professions} specialties={v.specialties} frameworks={fwOpts} /></div>
            </details>
            <details className="mt-3 border-t border-gray-100 pt-3">
              <summary className="cursor-pointer text-[13.5px] font-semibold text-gray-800">Import a draft package</summary>
              <p className="mt-1 text-[12.5px] text-gray-600">Creates the framework, its domains and competencies as a DRAFT, not clinically reviewed. No approval is imported or implied. Pasting the same package again continues an import that paused.</p>
              <div className="mt-2"><ImportDraft /></div>
            </details>
          </section>
        </>
      )}
    </div>
  );
}
