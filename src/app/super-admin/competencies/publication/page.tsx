import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPublicationView } from "@/lib/competency/framework-publication";
import { Archive, Decide } from "./_components/PublicationControls";
import Link from "next/link";
import { listStages, loadScalesWithMappings, mappingProblems } from "@/lib/competency/stage-mapping";
import { PublishMappingButton } from "../_studio/StudioForms";

// /super-admin/competencies/publication -- Holdings framework publication (migration 580, owner CENTRAL GOVERNANCE).
//
// Guarded by hq.quality.competency.publish (the Quality Council Member). Every centrally governed framework (shared,
// with a CFCA layer) and controlled catalogue: its state, its governed version, its clinical approval in numbers, what
// is awaiting a decision, its published versions, and the Verification Studio methods that apply to it. Publishing
// still needs every owned competency clinically approved (466), and never offers a framework to anybody: that is the
// Individual policy allowlist.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Framework publication" };

const STATUS_LABEL: Record<string, string> = { draft: "Draft", in_review: "Awaiting a publication decision", approved: "Approved, not yet published", published: "Published", archived: "Archived" };
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function FrameworkPublicationPage() {
  const ctx = await requireHqCapability("hq.quality.competency.publish");
  const [v, scales, stages] = await Promise.all([loadPublicationView(ctx.admin), loadScalesWithMappings(ctx.admin), listStages(ctx.admin)]);
  const stageName = new Map((stages ?? []).map(s => [s.code, s.label]));
  const drafts = (scales ?? []).flatMap(scale => scale.mappings.filter(m => m.status === "draft")
    .map(draft => ({ scale, draft, problems: mappingProblems(scale.levels, draft.bands, stages ?? []) })));
  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings</p>
        <h1 className="text-xl font-bold text-gray-900">Framework publication</h1>
        <p className="mt-1 text-sm text-gray-600">
          Centrally governed competency frameworks and controlled catalogues. Authors put them forward. You publish or return them.
          You cannot decide a framework you put forward, wrote or curated.
          Every competency a framework owns must be clinically approved at its current content before it can be published.
          Publishing does not offer it to anybody. Scholar and Professional offer only what Individual policy allows.
          Nothing here verifies any person.
        </p>
      </header>

      {v === null ? (
        <p role="alert" className="rounded-lg border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">
          The frameworks could not be read just now. Nothing is shown rather than a partial list.
        </p>
      ) : v.rows.length === 0 ? (
        <p className="text-[13.5px] text-gray-700">No centrally governed framework yet. Authors create them in Competency Authoring.</p>
      ) : v.rows.map(f => (
        <section key={f.id} aria-labelledby={`pub-${f.id}`} className="rounded-2xl border border-gray-200 bg-white p-4">
          <h2 id={`pub-${f.id}`} className="text-[16px] font-bold text-gray-900">{f.name} <span className="font-mono text-[12.5px] font-semibold text-gray-600">{f.code ?? "no code"}</span></h2>
          <p className="text-[12.5px] text-gray-600">
            {f.kind === "catalogue" ? "Controlled catalogue" : "Framework"} · {f.layer} layer · {STATUS_LABEL[f.status] ?? f.status} · version {f.version}
            {f.publishedCount ? ` · published ${f.publishedCount} time${f.publishedCount === 1 ? "" : "s"}` : " · never published"}
          </p>
          <p className="mt-1 text-[13px] text-gray-800">
            {f.kind === "catalogue"
              ? `Names ${f.catalogueEntries} competenc${f.catalogueEntries === 1 ? "y" : "ies"}, each with its own content status.`
              : f.clinicallyApproved === null
                ? `${f.competencies} competencies. Clinical approval could not be read just now, so none is counted.`
                : `${f.clinicallyApproved} of ${f.competencies} competencies clinically approved at their current content.`}
          </p>

          {f.pending ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-[13px] font-semibold text-amber-950">
                {f.pending.revision ? "A revision is awaiting your decision. The published version stays in use meanwhile." : "Awaiting your decision."}
                {" "}Put forward by {f.pending.submittedByName ?? "an author"} on {day(f.pending.submittedAt)}.
              </p>
              {f.pending.note && <p className="mt-1 text-[12.5px] text-amber-950">“{f.pending.note}”</p>}
              <Decide frameworkId={f.id} firstPublication={f.publishedCount === 0} version={f.version} />
            </div>
          ) : (
            <p className="mt-2 text-[12.5px] text-gray-600">Nothing awaiting a decision.</p>
          )}
          {f.status === "published" && !f.pending && (
            <details className="mt-2"><summary className="cursor-pointer text-[13px] font-semibold text-gray-800">Archive</summary><Archive frameworkId={f.id} /></details>
          )}

          <details className="mt-3">
            <summary className="cursor-pointer text-[13px] font-semibold text-gray-800">Published versions ({f.versions.length})</summary>
            {f.versions.length === 0 ? <p className="mt-1 text-[12.5px] text-gray-600">None yet.</p> : (
              <ul className="mt-1 space-y-1 text-[12.5px] text-gray-700">
                {f.versions.map(x => <li key={x.num}>#{x.num}{x.label ? ` (${x.label})` : " (version label not recorded)"} · {day(x.publishedAt)} · {x.by ?? "publisher not recorded"}{x.notes ? ` · ${x.notes}` : ""}</li>)}
              </ul>
            )}
          </details>
          <p className="mt-2 text-[12.5px] text-gray-700">
            {f.methods === null ? "Verification methods could not be read just now."
              : f.methods.length === 0 ? "No published verification method applies yet. Independent verification against this framework is not available."
              : `Verification methods that apply: ${f.methods.map(m => `${m.name} (v${m.version})`).join(", ")}. Configured in the Verification Studio.`}
          </p>
        </section>
      ))}

      {/* CFCA-STUDIO-P1 (migration 660): stage-mapping versions an author has drafted, for an independent publisher. */}
      <section aria-labelledby="pub-stages" className="rounded-2xl border border-gray-200 bg-white p-4">
        <h2 id="pub-stages" className="text-[16px] font-bold text-gray-900">Stage mappings awaiting publication</h2>
        <p className="text-[12.5px] text-gray-600">
          Draft versions of a scale&apos;s level-to-stage mapping, made on <Link href="/super-admin/competencies/stages" className="font-semibold underline">Scales and stages</Link>.
          You cannot publish a version you drafted. Publishing retires the version it replaces, which is kept.
        </p>
        {scales === null ? <p className="mt-2 text-[13px] text-[var(--cmp-text-critical)]">The stage mappings could not be read just now.</p>
          : drafts.length === 0 ? <p className="mt-2 text-[13px] text-gray-700">No draft version is waiting.</p>
          : drafts.map(({ scale, draft, problems }) => (
            <div key={draft.id} className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-[13.5px] font-semibold text-amber-950">{scale.name}, draft version {draft.version}</p>
              <p className="text-[12.5px] text-amber-950">{scale.levels.map(l => `${l.score} ${stageName.get(draft.bands.find(b => b.levelId === l.id)?.stageCode ?? "") ?? "no stage"}`).join(" · ")}</p>
              {problems.length ? <p className="mt-1 text-[12.5px] text-amber-950">Not ready: {problems.join(" ")}</p>
                : <div className="mt-2"><PublishMappingButton mappingId={draft.id} label={`Publish ${scale.name} version ${draft.version}`} /></div>}
            </div>
          ))}
      </section>
    </div>
  );
}
