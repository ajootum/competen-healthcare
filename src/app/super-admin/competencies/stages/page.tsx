import Link from "next/link";
import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { listStages, loadScalesWithMappings, mappingProblems, publishedOf } from "@/lib/competency/stage-mapping";
import { DraftBandEditor, NewDraftButton, StageForm } from "../_studio/StudioForms";

// /super-admin/competencies/stages -- CFCA-STUDIO-P1 items 5 and 6: Scales and Stages. The agreed Competen
// competency stages (rows), and for every scale (DACUM 0-6, Benner 0-6, any other on the Scoring page) the
// VERSIONED mapping from its levels to those stages. Guarded by hq.quality.competency.author: an author drafts a
// version here. Publication is on Framework Publication, by somebody else (the 660 trigger refuses the author).

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Scales and stages" };

const when = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

export default async function ScalesAndStagesPage() {
  const ctx = await requireHqCapability("hq.quality.competency.author");
  const [stages, scales] = await Promise.all([listStages(ctx.admin), loadScalesWithMappings(ctx.admin)]);
  const label = new Map((stages ?? []).map(s => [s.code, s.label]));

  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competency Studio</p>
        <h1 className="text-xl font-bold text-gray-900">Scales and stages</h1>
        <p className="mt-1 text-sm text-gray-600">
          Each scale&apos;s levels map to a Competen competency stage. A mapping is versioned: draft a new version here, and another person with publication
          authority publishes it on <Link href="/super-admin/competencies/publication" className="font-semibold underline">Framework publication</Link>. A
          published version never changes, and the version it replaces is kept. Scales and their level wording are on the{" "}
          <Link href="/super-admin/scoring" className="font-semibold underline">Scoring</Link> page.
        </p>
      </header>

      {stages === null || scales === null ? (
        <p role="alert" className="rounded-lg border border-[var(--cmp-color-error)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">
          Stages and mappings could not be read just now (or migration 660 is not applied here).
        </p>
      ) : (
        <>
          <section aria-labelledby="st-h" className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
            <h2 id="st-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Competency stages</h2>
            {stages.map(s => <StageForm key={s.code} stage={s} />)}
            <details className="border-t border-gray-100 pt-2"><summary className="cursor-pointer text-[13px] font-semibold text-teal-800">Add a stage</summary><div className="mt-2"><StageForm stage={null} /></div></details>
          </section>

          {scales.map(scale => {
            const pub = publishedOf(scale);
            const draft = scale.mappings.find(m => m.status === "draft") ?? null;
            const problems = draft ? mappingProblems(scale.levels, draft.bands, stages) : [];
            return (
              <section key={scale.id} aria-labelledby={`sc-${scale.id}`} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id={`sc-${scale.id}`} className="text-[16px] font-bold text-gray-900">{scale.name}{scale.isDefault && <span className="ml-2 rounded bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-800">Default</span>}</h2>
                  {!draft && <NewDraftButton scaleId={scale.id} />}
                </div>
                {pub ? (
                  <div>
                    <p className="text-[13px] text-gray-700">Published version {pub.version}{pub.publishedAt ? `, ${when(pub.publishedAt)}` : ""}{pub.approvalReference ? ` (${pub.approvalReference})` : ""}. Fingerprint <span className="font-mono text-[12px]">{pub.contentHash}</span>.</p>
                    <table className="mt-2 w-full text-left text-[13.5px]">
                      <thead><tr className="text-[12px] uppercase tracking-wide text-gray-500"><th className="py-1">Level</th><th className="py-1">Stage</th></tr></thead>
                      <tbody>{scale.levels.map(l => <tr key={l.id} className="border-t border-gray-100"><td className="py-1.5 pr-3">{l.score} {l.label}</td><td className="py-1.5">{label.get(pub.bands.find(b => b.levelId === l.id)?.stageCode ?? "") ?? "No stage"}</td></tr>)}</tbody>
                    </table>
                  </div>
                ) : <p className="text-[13px] text-gray-600">No published mapping: scores on this scale show no stage.</p>}
                {draft && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                    <h3 className="text-[14px] font-semibold text-amber-900">Draft version {draft.version}</h3>
                    {problems.length > 0 && <ul className="mt-1 list-disc pl-5 text-[12.5px] text-amber-900">{problems.map(p => <li key={p}>{p}</li>)}</ul>}
                    <div className="mt-2"><DraftBandEditor mappingId={draft.id} levels={scale.levels} bands={draft.bands} stages={stages.filter(s => s.active)} /></div>
                  </div>
                )}
                {scale.mappings.some(m => m.status === "retired") && (
                  <p className="text-[12.5px] text-gray-500">Retired versions kept: {scale.mappings.filter(m => m.status === "retired").map(m => `v${m.version} (${when(m.retiredAt)})`).join(", ")}.</p>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
