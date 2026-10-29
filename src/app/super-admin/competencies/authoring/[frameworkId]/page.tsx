import Link from "next/link";
import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { loadAuthoringView } from "@/lib/competency/authoring-view";
import { CLINICAL_STATE_LABEL, clinicalNote } from "@/lib/competency/clinical-review";
import { eligibilityOf } from "@/lib/competency/review-batch";
import { DomainName, FrameworkIdentity, FrameworkMeta, NewCpu, NewDomain, NewPractice, CompetencyEditor } from "../_components/AuthoringControls";
import { ReviewButton } from "../_components/ReviewDialog";
import StudioWorkspace, { type StudioDomain } from "../_components/StudioWorkspace";
import { SubmitForPublication } from "../../publication/_components/PublicationControls";
import { ReviewPackView } from "../../_studio/ReviewPackView";
import { loadFrameworkPack } from "@/lib/competency/review-pack";

// /super-admin/competencies/authoring/[frameworkId] -- CFCA-STUDIO-UX-02: one framework, focused. Competencies (explorer
// and a single active editor) and Overview & governance (structure, clinical review in numbers, publication kept
// separate). Guarded by hq.quality.competency.author like the authoring page it sits under. Every number and state here
// is read from the existing services: the authoring view (465), the 395 clinical review states, the framework status.
// Nothing is simulated. Putting content forward is the existing per-competency operation, in a scope (review-batch.ts).

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Competency Studio" };

const STATUS: Record<string, string> = { draft: "Draft framework", in_review: "In governance review", approved: "Approved for publication", published: "Published", archived: "Archived" };
const PUB: Record<string, string> = { draft: "Not published", in_review: "Awaiting a publication decision", approved: "Approved, not yet published", published: "Published", archived: "Archived" };
const tabCls = (on: boolean) => `border-b-2 px-1 pb-2 text-[14.5px] font-semibold ${on ? "border-teal-700 text-teal-800" : "border-transparent text-gray-600 hover:text-gray-900"}`;

export default async function FrameworkStudioPage({ params, searchParams }: { params: Promise<{ frameworkId: string }>; searchParams: Promise<{ tab?: string; c?: string; view?: string }> }) {
  const ctx = await requireHqCapability("hq.quality.competency.author");
  const [{ frameworkId }, sp] = await Promise.all([params, searchParams]);
  // The paper copy of this framework for its authors (owner, 29 Oct 2026).
  if (sp.view === "pack") {
    const pack = await loadFrameworkPack(ctx.admin, frameworkId, ctx.fullName ?? null);
    return pack ? <ReviewPackView pack={pack} back={{ href: `/super-admin/competencies/authoring/${frameworkId}`, label: "Back to the framework" }} wordHref={`/api/hq/competency/review-pack?frameworkId=${frameworkId}`} />
      : <p role="alert" className="text-[13.5px] text-[var(--cmp-text-critical)]">That framework could not be read just now.</p>;
  }
  const v = await loadAuthoringView(ctx.admin);
  const f = v?.frameworks.find(x => x.id === frameworkId) ?? null;
  if (!v || !f) {
    return (
      <div className="max-w-3xl space-y-3">
        <p className="text-[13px]"><Link href="/super-admin/competencies/authoring" className="font-semibold text-teal-800 underline">Framework library</Link></p>
        <p role="alert" className="rounded-lg border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] px-3 py-2 text-[13px] text-[var(--cmp-text-critical)]">
          {v ? "That framework is not a shared framework in the Studio." : "The framework could not be read just now. Nothing is shown rather than a partial view."}
        </p>
      </div>
    );
  }
  const editable = f.pubStatus === "draft" || f.pubStatus === "published";
  const fwOpts = v.frameworks.map(x => ({ id: x.id, name: x.name, code: x.code }));
  const domains: StudioDomain[] = f.domains.map(d => ({
    id: d.id, name: d.name,
    cpus: d.practices.flatMap(p => p.cpus.map(u => ({ id: u.id, label: `${u.code ?? ""} ${u.name} (${p.name})` }))),
    competencies: d.competencies.map(c => ({
      id: c.id, code: c.code, name: c.name, description: c.description, learningOutcomes: c.learningOutcomes, expectedLevelId: c.expectedLevelId,
      riskCategory: c.riskCategory, sortOrder: c.sortOrder, cpuId: c.cpuId, criteria: c.criteria,
      status: eligibilityOf(c.clinical, f.pubStatus), statusText: c.clinical ? `${CLINICAL_STATE_LABEL[c.clinical.state]}. ${clinicalNote(c.clinical)}` : "Clinical state not readable",
    })),
  }));
  const comps = domains.flatMap(d => d.competencies);
  const n = (s: string) => comps.filter(c => c.status === s).length;
  const criteria = comps.reduce((s, c) => s + c.criteria.length, 0);
  const tab = sp.tab === "overview" ? "overview" : "competencies";
  const meta = [f.code, f.layer ? `${f.layer[0].toUpperCase()}${f.layer.slice(1)} layer` : "No layer", v.professions.find(p => p.id === f.professionTermId)?.value].filter(Boolean);

  return (
    <div className="max-w-7xl space-y-5">
      <nav aria-label="Breadcrumb" className="text-[13px] text-gray-600"><Link href="/super-admin/competencies/authoring" className="font-semibold text-teal-800 hover:underline">Framework library</Link> <span aria-hidden>/</span> {f.code ?? f.name}</nav>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-teal-800">Competency Studio</p>
          <h1 className="text-[26px] font-bold text-gray-900">{f.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-gray-600">{meta.join(" · ")} <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[12px] font-semibold text-gray-800">{STATUS[f.pubStatus] ?? f.pubStatus}</span></p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="?view=pack" className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-[13.5px] font-semibold text-gray-800 hover:bg-gray-50">Review pack</Link>
          {tab === "competencies" && <Link href="?tab=overview" className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-[13.5px] font-semibold text-gray-800 hover:bg-gray-50">Framework overview</Link>}
          <ReviewButton frameworkId={f.id} scope={{ kind: "framework" }} label="Put forward for review" disabled={!editable || !comps.length} />
        </div>
      </header>
      {!v.clinicalReadable && <p role="alert" className="text-[13px] font-semibold text-amber-900">Clinical review states could not be read just now, so none is shown and nothing can be put forward.</p>}

      <div role="tablist" aria-label="Framework views" className="flex gap-6 border-b border-gray-200">
        <Link role="tab" aria-selected={tab === "competencies"} href="?tab=competencies" className={tabCls(tab === "competencies")}>Competencies <span className="text-gray-500">{comps.length}</span></Link>
        <Link role="tab" aria-selected={tab === "overview"} href="?tab=overview" className={tabCls(tab === "overview")}>Overview &amp; governance</Link>
      </div>

      {tab === "competencies" ? (
        <StudioWorkspace frameworkId={f.id} domains={domains} levels={v.levels} components={v.components} editable={editable} initialId={sp.c ?? null} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[[f.domains.length, "Domains"], [comps.length, "Competencies"], [criteria, "Assessment criteria"], [PUB[f.pubStatus] ?? f.pubStatus, "Publication"]].map(([a, b]) => (
              <div key={String(b)} className="rounded-2xl border border-gray-200 bg-white p-5"><p className="text-[26px] font-bold text-gray-900">{a}</p><p className="text-[13px] text-gray-600">{b}</p></div>
            ))}
          </div>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <section aria-labelledby="st-h" className="rounded-2xl border border-gray-200 bg-white p-5">
              <div className="flex items-baseline justify-between"><h2 id="st-h" className="text-[15px] font-bold text-gray-900">Framework structure</h2><span className="text-[12.5px] text-gray-500">Open a domain to focus</span></div>
              <table className="mt-3 w-full text-left text-[13.5px]">
                <thead><tr className="border-b border-gray-200 text-[12px] text-gray-500"><th className="py-2 font-semibold">Domain</th><th className="py-2 font-semibold">Competencies</th><th className="py-2 font-semibold">Ready / in review / reviewed</th><th /></tr></thead>
                <tbody>
                  {domains.map(d => (
                    <tr key={d.id} className="border-b border-gray-100">
                      <td className="py-2.5 pr-2 text-gray-900">{d.name}</td>
                      <td className="py-2.5">{d.competencies.length}</td>
                      <td className="py-2.5 text-gray-700">{d.competencies.filter(c => c.status === "eligible").length} / {d.competencies.filter(c => c.status === "in_review").length} / {d.competencies.filter(c => c.status === "approved").length}</td>
                      <td className="py-2.5 text-right">{d.competencies[0] ? <Link href={`?tab=competencies&c=${d.competencies[0].id}`} className="font-semibold text-teal-800 hover:underline">Open →</Link> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <div className="space-y-5">
              <section aria-labelledby="cr-h" className="rounded-2xl border border-gray-200 bg-white p-5">
                <h2 id="cr-h" className="text-[15px] font-bold text-gray-900">Clinical review</h2>
                <div className="mt-3 grid grid-cols-2 gap-4">
                  {([["eligible", "Ready for review", "bg-teal-50 text-teal-900"], ["in_review", "In review", "bg-blue-50 text-blue-900"], ["changes_requested", "Needs attention", "bg-amber-50 text-amber-900"], ["approved", "Reviewed", "bg-violet-50 text-violet-900"]] as const).map(([k, l, t]) => (
                    <div key={k}><p className="text-[22px] font-bold text-gray-900">{n(k) + (k === "changes_requested" ? n("unreadable") : 0)}</p><span className={`rounded-md px-2 py-0.5 text-[12px] font-semibold ${t}`}>{l}</span></div>
                  ))}
                </div>
                <div className="mt-4 h-2 rounded-full bg-gray-100" aria-hidden><div className="h-2 rounded-full bg-teal-700" style={{ width: `${comps.length ? (100 * n("approved")) / comps.length : 0}%` }} /></div>
                <p className="mt-2 text-[12.5px] text-gray-600">{n("approved")} of {comps.length} clinically approved at their current content. Each competency is reviewed independently against its exact content version.</p>
                <div className="mt-4"><ReviewButton frameworkId={f.id} scope={{ kind: "framework" }} label="Preview framework submission" className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-teal-800 disabled:opacity-50" disabled={!editable || !comps.length} /></div>
              </section>
              <section aria-labelledby="pb-h" className="rounded-2xl border border-gray-200 bg-white p-5">
                <h2 id="pb-h" className="text-[15px] font-bold text-gray-900">Publication stays separate</h2>
                <p className="mt-1 text-[13px] text-gray-600">Putting content forward does not approve or publish it. Authors and submitters cannot clinically review their own content. An independent publisher decides on <Link href="/super-admin/competencies/publication" className="font-semibold underline">Framework publication</Link>, once every competency is clinically approved.</p>
                <p className="mt-2 text-[13px] text-gray-800">Publication status: <strong>{PUB[f.pubStatus] ?? f.pubStatus}</strong></p>
                {editable && f.layer && <div className="mt-2"><SubmitForPublication frameworkId={f.id} revision={f.pubStatus === "published"} /></div>}
              </section>
            </div>
          </div>
          {editable && (
            <section aria-labelledby="mg-h" className="rounded-2xl border border-gray-200 bg-white p-5">
              <h2 id="mg-h" className="text-[15px] font-bold text-gray-900">Framework settings and structure</h2>
              <details className="mt-2"><summary className="cursor-pointer text-[13px] font-semibold text-gray-800">Name and description</summary><div className="mt-2"><FrameworkMeta id={f.id} name={f.name} description={f.description} /></div></details>
              {f.pubStatus === "draft" && (
                <details className="mt-1"><summary className="cursor-pointer text-[13px] font-semibold text-gray-800">Identity: code, layer, profession, specialty, extends</summary>
                  <div className="mt-2"><FrameworkIdentity frameworkId={f.id} professions={v.professions} specialties={v.specialties} frameworks={fwOpts}
                    initial={{ code: f.code ?? "", layer: f.layer ?? "foundational", professionTermId: f.professionTermId ?? "", specialtyTermId: f.specialtyTermId ?? "", parentFrameworkId: f.parentFrameworkId ?? "" }} /></div>
                </details>
              )}
              {f.domains.map(d => (
                <details key={d.id} className="mt-1"><summary className="cursor-pointer text-[13px] font-semibold text-gray-800">{d.name}: name, practices, CPUs, add a competency</summary>
                  <div className="mt-2 space-y-2 rounded-xl border border-gray-100 p-3">
                    <DomainName domainId={d.id} name={d.name} code={d.code} />
                    {d.practices.length > 0 && <ul className="space-y-2">{d.practices.map(p => (
                      <li key={p.id} className="rounded-lg bg-gray-50 p-2 text-[13px]"><p className="font-semibold text-gray-900"><span className="font-mono text-[12px] text-gray-600">{p.code ?? "no code"}</span> {p.name}</p>
                        <ul className="ml-3 list-disc text-[12.5px] text-gray-700">{p.cpus.map(u => <li key={u.id}><span className="font-mono">{u.code ?? "no code"}</span> {u.name} · {u.riskCategory} risk · complexity {u.complexity}</li>)}</ul>
                        <details className="mt-1"><summary className="cursor-pointer text-[12.5px] text-gray-700">Add a CPU</summary><NewCpu practiceId={p.id} /></details></li>))}</ul>}
                    <NewPractice domainId={d.id} />
                    <details><summary className="cursor-pointer text-[12.5px] font-semibold text-gray-800">Add a competency</summary><div className="mt-2"><CompetencyEditor domainId={d.id} levels={v.levels} cpus={d.practices.flatMap(p => p.cpus.map(u => ({ id: u.id, label: `${u.code ?? ""} ${u.name} (${p.name})` })))} /></div></details>
                  </div>
                </details>
              ))}
              <div className="mt-3"><NewDomain frameworkId={f.id} /></div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
