/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { listQualificationTerms, listStudioCatalogues, listStudioProgrammes, loadProgrammePreview, type PreviewRow } from "@/lib/individual/programme-framework";
import { listComponents } from "@/lib/competency/studio-components";
import { EntryEditor, QualificationForm, type LevelOption } from "../_studio/StudioForms";

// /super-admin/competencies/programmes -- CFCA-STUDIO-P1 items 4, 9, 10: Programme Frameworks. Configure what a
// programme requires of each shared competency (requirement, target level, CCHU components) and PREVIEW the exact
// resolved set a learner of that programme gets. Guarded by hq.individual.config.manage, the right that curates
// catalogue entries and programmes (394, 387).
//
// ⚠ A programme framework is a controlled catalogue that NAMES shared competencies: nothing is copied per cadre.
// Its overlay can be changed only while it is a draft (the 394 and 660 triggers). Publication is the existing
// independent framework publication, and only a published, allowlisted catalogue reaches a learner.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Programme frameworks" };

const REQ_LABEL: Record<string, string> = { required: "Required", recommended: "Recommended", optional: "Optional" };
const STATUS_TONE: Record<string, string> = { published: "bg-green-100 text-green-900", draft: "bg-amber-100 text-amber-900", in_review: "bg-blue-100 text-blue-900", approved: "bg-blue-100 text-blue-900" };

export default async function ProgrammeFrameworksPage({ searchParams }: { searchParams: Promise<{ programme?: string; catalogue?: string }> }) {
  const ctx = await requireHqCapability("hq.individual.config.manage");
  const sp = await searchParams;
  const [programmes, catalogues, terms, registry, lv] = await Promise.all([
    listStudioProgrammes(ctx.admin), listStudioCatalogues(ctx.admin), listQualificationTerms(ctx.admin), listComponents(ctx.admin),
    ctx.admin.from("scoring_levels").select("id, score, label, scoring_scales(name)").order("score"),
  ]);
  const ready = programmes !== null && catalogues !== null && terms !== null && registry !== null;
  const levels: LevelOption[] = ((lv.data ?? []) as any[]).map(l => ({ id: l.id, score: l.score, label: l.label, scale: l.scoring_scales?.name ?? "Scale" }))
    .sort((a, b) => a.scale.localeCompare(b.scale) || a.score - b.score);
  const subject = sp.catalogue ? { catalogueId: sp.catalogue } : sp.programme ? { programmeCode: sp.programme } : null;
  const preview = ready && subject ? await loadProgrammePreview(ctx.admin, subject) : null;
  const names = new Map((catalogues ?? []).map(c => [c.id, c]));

  return (
    <div className="max-w-6xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competency Studio</p>
        <h1 className="text-xl font-bold text-gray-900">Programme frameworks</h1>
        <p className="mt-1 text-sm text-gray-600">
          One shared competency catalogue, many programmes. A programme framework names the shared competencies a programme uses, and sets for each
          whether it is required, recommended or optional, the level the programme expects, and which assessment components it must pass.
          Catalogue entries are added on <Link href="/super-admin/individual/catalogues" className="font-semibold underline">Controlled catalogues</Link>,
          programmes are created on <Link href="/super-admin/individual/programmes" className="font-semibold underline">Scholar programmes</Link>, and a
          framework is published on <Link href="/super-admin/competencies/publication" className="font-semibold underline">Framework publication</Link> by an independent publisher.
        </p>
      </header>

      {!ready ? (
        <p role="alert" className="rounded-lg border border-[var(--cmp-color-error)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">
          The programme frameworks could not be read just now (or migration 660 is not applied here). Nothing below can be trusted until this page loads cleanly.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <nav aria-label="Programmes and catalogues" className="space-y-4">
            <section>
              <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-gray-500">Programmes</h2>
              {programmes!.length === 0 && <p className="mt-1 text-[13px] text-gray-600">No programme exists yet.</p>}
              <ul className="mt-1 space-y-1">
                {programmes!.map(p => (
                  <li key={p.code}>
                    <Link href={`?programme=${encodeURIComponent(p.code)}`} aria-current={sp.programme === p.code ? "page" : undefined}
                      className={`block rounded-lg px-2.5 py-1.5 text-[13.5px] ${sp.programme === p.code ? "bg-teal-50 font-semibold text-teal-900" : "text-gray-800 hover:bg-gray-50"}`}>
                      {p.label}<span className="block text-[12px] text-gray-500">{p.qualification?.label ?? "Qualification not set"}{p.isActive ? "" : " · deactivated"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-gray-500">Preview one catalogue</h2>
              <ul className="mt-1 space-y-1">
                {catalogues!.map(c => (
                  <li key={c.id}>
                    <Link href={`?catalogue=${c.id}`} aria-current={sp.catalogue === c.id ? "page" : undefined}
                      className={`block rounded-lg px-2.5 py-1.5 text-[13.5px] ${sp.catalogue === c.id ? "bg-teal-50 font-semibold text-teal-900" : "text-gray-800 hover:bg-gray-50"}`}>
                      {c.name}{c.code ? <span className="font-mono text-[11.5px] text-gray-500"> {c.code}</span> : null}
                      <span className="block text-[12px] text-gray-500">{c.status}{c.entries ? ` · names ${c.entries}` : ""}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </nav>

          <main className="min-w-0 space-y-4">
            {!preview && <p className="text-[13.5px] text-gray-600">Choose a programme to see exactly what its learners are offered, or a catalogue to preview and configure it as a draft.</p>}
            {preview && "error" in preview && <p role="alert" className="text-[13.5px] text-[var(--cmp-text-critical)]">{preview.error}</p>}
            {preview && !("error" in preview) && (
              <>
                <section className="rounded-xl border border-gray-200 bg-white p-4">
                  {preview.subject.kind === "programme" ? (
                    <>
                      <h2 className="text-[16px] font-bold text-gray-900">{preview.subject.programme.label}</h2>
                      <p className="text-[13px] text-gray-600">{preview.subject.programme.profession} <span className="font-mono text-[12px]">({preview.subject.programme.code})</span></p>
                      <div className="mt-3"><QualificationForm programmeCode={preview.subject.programme.code} terms={terms!} current={preview.subject.programme.qualification?.id ?? null} /></div>
                    </>
                  ) : (
                    <>
                      <h2 className="text-[16px] font-bold text-gray-900">{preview.subject.catalogue.name}</h2>
                      <p className="text-[13px] text-gray-600">Previewed on its own, as a programme that learns against this catalogue alone.</p>
                    </>
                  )}
                  <ul className="mt-3 space-y-1 text-[13px]">
                    {preview.catalogues.map(c => (
                      <li key={c.id} className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${STATUS_TONE[c.status] ?? "bg-gray-100 text-gray-700"}`}>{c.status}</span>
                        <span className="font-semibold text-gray-900">{c.name}</span>
                        <span className="text-gray-600">as {c.layerInProgramme}</span>
                        <span className={c.allowlisted ? "text-green-800" : "text-amber-800"}>{c.allowlisted ? "allowed for Scholar" : "not allowed for Scholar yet"}</span>
                      </li>
                    ))}
                    {preview.catalogues.length === 0 && <li className="text-gray-600">No catalogue linked: this programme offers no competencies.</li>}
                  </ul>
                  <p className="mt-3 text-[13px] text-gray-700">
                    {preview.counts.total} competencies: {preview.counts.required} required, {preview.counts.recommended} recommended, {preview.counts.optional} optional.{" "}
                    <strong>{preview.counts.offered} offered to learners today</strong> (Scholar content floor: {preview.minStatus}).
                  </p>
                </section>

                <section aria-labelledby="pv-h" className="space-y-2">
                  <h2 id="pv-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Resolved competencies</h2>
                  {preview.rows.length === 0 && <p className="text-[13.5px] text-gray-600">Nothing resolves for this subject yet.</p>}
                  {preview.rows.map(r => <Row key={r.id} r={r} stageLabels={preview.stageLabels} editable={names.get(r.frameworkId)?.status === "draft"} levels={levels} registry={registry!} />)}
                </section>
              </>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function Row({ r, stageLabels, editable, levels, registry }: { r: PreviewRow; stageLabels: Record<string, string>; editable: boolean; levels: LevelOption[]; registry: { code: string; label: string; active: boolean }[] }) {
  const compLabel = new Map(registry.map(c => [c.code, c.label]));
  return (
    <article className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[14.5px] font-semibold text-gray-900">{r.code ? <span className="font-mono text-[12px] text-gray-500">{r.code} </span> : null}{r.title}</h3>
        <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${r.requirement === "required" ? "bg-teal-100 text-teal-900" : r.requirement === "recommended" ? "bg-blue-100 text-blue-900" : "bg-gray-100 text-gray-700"}`}>
          {REQ_LABEL[r.requirement ?? "required"]}
        </span>
      </div>
      <p className="text-[12.5px] text-gray-600">{r.domain} · {r.catalogue} · {r.layer}</p>
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-3">
        <div><dt className="text-[11.5px] uppercase tracking-wide text-gray-500">Target level</dt>
          <dd>{r.expectedLevel ? `${r.expectedLevel.score} ${r.expectedLevel.label}` : "Not set"} <span className="text-gray-500">({r.targetFrom === "programme" ? "this programme" : "competency default"})</span></dd></div>
        <div><dt className="text-[11.5px] uppercase tracking-wide text-gray-500">Target stage</dt>
          <dd>{r.targetStage ? stageLabels[r.targetStage] ?? r.targetStage : r.expectedLevel ? "No published mapping for this scale" : "Not set"}</dd></div>
        <div><dt className="text-[11.5px] uppercase tracking-wide text-gray-500">Clinical content</dt><dd>{r.contentStatus === "approved" ? "Clinically approved" : r.contentStatus === "draft" ? "Draft" : "Not clinically reviewed"}</dd></div>
      </dl>
      <p className="mt-2 text-[13px] text-gray-700">
        <span className="font-semibold">Components: </span>
        {r.components.length ? r.components.map(c => `${compLabel.get(c.code) ?? c.code}${c.passLevel ? ` ≥ ${c.passLevel.score}` : " at target"}${c.safetyCritical ? ", safety-critical" : c.mandatory ? ", mandatory" : ", optional"}${c.weight ? `, weight ${c.weight}` : ""}`).join(" · ") : "assessed as one competency (no components set)"}
      </p>
      <p className={`mt-1 text-[12.5px] ${r.notOffered.length ? "text-amber-800" : "text-green-800"}`}>{r.notOffered.length ? `Not offered yet: ${r.notOffered.join(" ")}` : "Offered to learners of this programme."}</p>
      {r.overlayEntryId && (editable ? (
        <details className="mt-2 border-t border-gray-100 pt-2">
          <summary className="cursor-pointer text-[13px] font-semibold text-teal-800">Configure for this programme</summary>
          <div className="mt-2">
            <EntryEditor catalogueId={r.frameworkId} entryId={r.overlayEntryId} requirement={r.requirement ?? "required"} expectedLevelId={r.targetFrom === "programme" ? r.expectedLevelId ?? null : null}
              levels={levels} registry={registry} components={r.components.map(c => ({ code: c.code, passLevelId: c.passLevel?.id ?? null, mandatory: c.mandatory, safetyCritical: c.safetyCritical, weight: c.weight }))} />
          </div>
        </details>
      ) : <p className="mt-1 text-[12px] text-gray-500">The catalogue is not a draft, so this is frozen. Start a new draft version to change it.</p>)}
    </article>
  );
}
