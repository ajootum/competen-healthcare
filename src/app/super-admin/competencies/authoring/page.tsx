import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { loadAuthoringView } from "@/lib/competency/authoring-view";
import { CLINICAL_STATE_LABEL, clinicalNote } from "@/lib/competency/clinical-review";
import { CompetencyEditor, DomainName, FrameworkIdentity, FrameworkMeta, ImportDraft, NewCpu, NewDomain, NewFramework, NewPractice, SubmitReview } from "./_components/AuthoringControls";

// /super-admin/competencies/authoring -- CFCA authoring in production (migration 438, owner CFCA PRODUCTION AUTHORING).
//
// Guarded by hq.quality.competency.author (the CFCA Competency Curator). Shared CFCA frameworks, their domains and
// competencies, edited as governed content: Draft -> Submit for Review (here) -> Clinical Approval (/clinical-review,
// an independent reviewer) -> Publication (the governed framework lifecycle). Every competency shows its clinical state
// in words, and nothing here says approved unless 395 proves it.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Competency authoring" };

const STATUS_LABEL: Record<string, string> = { draft: "Draft", in_review: "In governance review", approved: "Approved for publication", published: "Published", archived: "Archived" };

export default async function CompetencyAuthoringPage() {
  const ctx = await requireHqCapability("hq.quality.competency.author");
  const v = await loadAuthoringView(ctx.admin);
  const fwOpts = (v?.frameworks ?? []).map(f => ({ id: f.id, name: f.name, code: f.code }));
  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competen Holdings</p>
        <h1 className="text-xl font-bold text-gray-900">Competency authoring</h1>
        <p className="mt-1 text-sm text-gray-600">
          Shared CFCA frameworks and competencies. Write and refine them here, then put each competency forward for independent clinical review.
          You cannot review content you wrote, edited or put forward. Approval is a separate step, and publication is another.
        </p>
      </header>

      {v === null ? (
        <p role="alert" className="rounded-lg border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">
          The frameworks could not be read just now. Nothing is shown rather than a partial list.
        </p>
      ) : (
        <>
          {!v.clinicalReadable && <p role="alert" className="text-[13px] font-semibold text-amber-900">Clinical review states could not be read just now, so none is shown. Nothing here is approved unless that state says so.</p>}

          <section aria-labelledby="new-h" className="rounded-2xl border border-gray-200 bg-white p-4">
            <h2 id="new-h" className="text-[15px] font-bold text-gray-900">New shared framework</h2>
            <div className="mt-2"><NewFramework professions={v.professions} specialties={v.specialties} frameworks={fwOpts} /></div>
            <details className="mt-3">
              <summary className="cursor-pointer text-[13px] font-semibold text-gray-800">Import an existing framework as a draft</summary>
              <p className="mt-1 text-[12.5px] text-gray-600">Creates the framework, its domains and competencies as a DRAFT, not clinically reviewed. No approval is imported or implied.</p>
              <div className="mt-2"><ImportDraft /></div>
            </details>
          </section>

          {v.frameworks.length === 0 && <p className="text-[13.5px] text-gray-700">No shared CFCA framework yet.</p>}
          {v.frameworks.map(f => (
            <section key={f.id} aria-labelledby={`fw-${f.id}`} className="rounded-2xl border border-gray-200 bg-white p-4">
              <h2 id={`fw-${f.id}`} className="text-[16px] font-bold text-gray-900">{f.name} <span className="font-mono text-[12.5px] font-semibold text-gray-600">{f.code ?? "no code"}</span></h2>
              <p className="text-[12.5px] text-gray-600">{f.layer ? `${f.layer[0].toUpperCase()}${f.layer.slice(1)} layer` : "No layer"} · {STATUS_LABEL[f.pubStatus] ?? f.pubStatus}{f.versionNum ? ` · published version ${f.versionNum}` : ""}</p>
              {f.pubStatus === "published" && <p className="mt-1 text-[12.5px] text-amber-900">Published. Edits here change the live content and show as changed since clinical approval until re-approved. The published versions stay on record.</p>}
              {(f.pubStatus === "draft" || f.pubStatus === "published") ? (
                <>
                  <details className="mt-2"><summary className="cursor-pointer text-[13px] font-semibold text-gray-800">Framework name and description</summary><div className="mt-2"><FrameworkMeta id={f.id} name={f.name} description={f.description} /></div></details>
                  {f.pubStatus === "draft" && (
                    <details className="mt-1"><summary className="cursor-pointer text-[13px] font-semibold text-gray-800">Identity: code, layer, profession, specialty, extends</summary>
                      <div className="mt-2"><FrameworkIdentity frameworkId={f.id} professions={v.professions} specialties={v.specialties} frameworks={fwOpts}
                        initial={{ code: f.code ?? "", layer: f.layer ?? "foundational", professionTermId: f.professionTermId ?? "", specialtyTermId: f.specialtyTermId ?? "", parentFrameworkId: f.parentFrameworkId ?? "" }} /></div>
                    </details>
                  )}
                  {f.domains.map(d => (
                    <div key={d.id} className="mt-4 rounded-xl border border-gray-100 p-3">
                      <h3 className="text-[14.5px] font-bold text-gray-900">{d.name}</h3>
                      <details><summary className="cursor-pointer text-[12.5px] text-gray-700">Name and code</summary><DomainName domainId={d.id} name={d.name} code={d.code} /></details>
                      <details className="mt-1"><summary className="cursor-pointer text-[12.5px] text-gray-700">Practices and clinical practice units ({d.practices.reduce((n, p) => n + p.cpus.length, 0)} CPU)</summary>
                        <ul className="mt-1 space-y-2">
                          {d.practices.map(p => (
                            <li key={p.id} className="rounded-lg bg-gray-50 p-2 text-[13px]">
                              <p className="font-semibold text-gray-900"><span className="font-mono text-[12px] text-gray-600">{p.code ?? "no code"}</span> {p.name}</p>
                              <ul className="ml-3 list-disc text-[12.5px] text-gray-700">{p.cpus.map(u => <li key={u.id}><span className="font-mono">{u.code ?? "no code"}</span> {u.name} · {u.riskCategory} risk · complexity {u.complexity}</li>)}</ul>
                              <details className="mt-1"><summary className="cursor-pointer text-[12.5px] text-gray-700">Add a CPU</summary><NewCpu practiceId={p.id} /></details>
                            </li>
                          ))}
                        </ul>
                        <div className="mt-2"><NewPractice domainId={d.id} /></div>
                      </details>
                      <ul className="mt-2 divide-y divide-gray-100">
                        {d.competencies.map(c => (
                          <li key={c.id} className="py-2.5">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <p className="text-[14px] font-semibold text-gray-900"><span className="font-mono text-[12.5px] text-gray-600">{c.code ?? "no code"}</span> {c.name}</p>
                              <p className={`text-[12.5px] font-semibold ${c.clinical?.state === "approved" ? "text-green-800" : "text-amber-900"}`}>
                                {c.clinical ? `${CLINICAL_STATE_LABEL[c.clinical.state]}. ${clinicalNote(c.clinical)}` : "Clinical state not readable"}
                              </p>
                            </div>
                            <details className="mt-1"><summary className="cursor-pointer text-[12.5px] text-gray-700">Edit content</summary>
                              <div className="mt-2"><CompetencyEditor c={c} levels={v.levels} approved={c.clinical?.state === "approved"} cpus={d.practices.flatMap(p => p.cpus.map(u => ({ id: u.id, label: `${u.code ?? ""} ${u.name} (${p.name})` })))} /></div>
                            </details>
                            {c.clinical && (c.clinical.state === "unreviewed" || c.clinical.state === "stale" || c.clinical.state === "changes_requested") && <div className="mt-1.5"><SubmitReview competencyId={c.id} /></div>}
                          </li>
                        ))}
                      </ul>
                      <details className="mt-2"><summary className="cursor-pointer text-[13px] font-semibold text-gray-800">Add a competency</summary><div className="mt-2"><CompetencyEditor domainId={d.id} levels={v.levels} cpus={d.practices.flatMap(p => p.cpus.map(u => ({ id: u.id, label: `${u.code ?? ""} ${u.name} (${p.name})` })))} /></div></details>
                    </div>
                  ))}
                  <div className="mt-3"><NewDomain frameworkId={f.id} /></div>
                </>
              ) : (
                <p className="mt-2 text-[13px] text-gray-700">{f.pubStatus === "archived" ? "Archived: not edited." : "Under governance review: its content is what the approver is looking at, so it is not edited until it is published or returned to draft."}</p>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
