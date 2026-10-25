import Link from "next/link";
import type { Metadata } from "next";
import { EXPERIENCES, experienceHref } from "@/lib/individual/experiences";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { SECTION_TITLE, loadDocumentsConfig, templatesFor } from "@/lib/individual/documents-config";
import { modelLines } from "@/lib/individual/documents/model";
import { pdfUnencodable } from "@/lib/individual/documents/pdf";
import { statusText } from "@/lib/individual/documents/model";
import { loadDocuments, documentOf } from "@/lib/individual/professional/document-store";
import { composeDocument } from "@/lib/individual/professional/document-compose";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { PageHeader, Unreadable, focusRing, primaryBtn, secondaryBtn } from "../../../../../_components/chrome";
import { ApiButton, ApiForm, Field, inputCls } from "../../../../../_components/professional/forms";
import { Empty, Section, fmtDate } from "../../../../../_components/professional/bits";
import DocumentEditor from "../../../../../_components/professional/DocumentEditor";
import DocumentPreview from "../../../../../_components/DocumentPreview";

// Request-time only: never prerendered, no client at build time (foundation harness 11a).
export const dynamic = "force-dynamic";

// PROFESSIONAL DOCUMENT STUDIO -- COMPETEN-PROFESSIONAL-PROGRESS-01 PR7 (P0), at /progress/documents (sidebar unchanged).
// Reached from Progress and from the Passport (?origin=passport[&passport=<link>]).
//
// Choose a type and a published template, choose sections and individual records (never a whole category by default),
// reorder, write your own words, preview the COMPLETE document, then export DOCX or PDF of exactly that preview (the
// export carries the preview's hash and is refused if anything changed). Drafts hold choices and record keys only:
// nothing here changes a Professional, Learning, Competency, Evidence or Passport record. Works without AI.

export async function generateMetadata(): Promise<Metadata> { return gatedMetadata({ title: "Document Studio" }); }

type SP = Record<string, string | string[] | undefined>;
const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as string | undefined;

export default async function DocumentStudioPage({ params, searchParams }: { params: Promise<{ experience: string }>; searchParams: Promise<SP> }) {
  const page = await experienceModulePage((await params).experience, "progress");
  if (!page) return null;
  const { ctx } = page;
  const x = EXPERIENCES.professional;
  const today = new Date().toISOString().slice(0, 10);
  const sp = await searchParams;
  const [cfg, docs, policy] = await Promise.all([loadDocumentsConfig(ctx.admin), loadDocuments(ctx.admin, ctx.userId), loadIndividualPolicy(ctx.admin)]);
  const aiOn = policy.professionalDocuments.ai === "on";
  const docId = one(sp.doc);
  const doc = docId ? await documentOf(ctx.admin, ctx.userId, docId) : null;
  const fromPassport = one(sp.origin) === "passport";

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your development" title="Document Studio"
        intro="Make a CV, resume, Passport export or portfolio from records you choose. Only what you select appears, every entry keeps what its source says about it, and you preview the whole document before you export it." />
      <nav aria-label="Document Studio" className="mb-5 flex flex-wrap gap-3 text-[13.5px]">
        <Link href={experienceHref("professional", "progress")} className={`font-semibold text-gray-600 ${focusRing}`}>← Progress</Link>
        <Link href={experienceHref("professional", "progress/documents")} className={`font-semibold ${focusRing}`} style={{ color: x.accent }}>All documents</Link>
        <Link href={experienceHref("professional", "passport")} className={`font-semibold ${focusRing}`} style={{ color: x.accent }}>My Competen Passport</Link>
      </nav>
      {!docs.provisioned && <p className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900">The Document Studio is not set up on this environment yet, so documents cannot be saved.</p>}
      {doc ? <Editor /> : docId ? <Section title="Not found"><Empty>That document is not yours, or it was deleted.</Empty></Section> : <List />}
    </>
  );

  function List() {
    return (
      <>
        <Section id="new-h" title="Create a document" note={fromPassport ? "Started from your Passport: choose the Competen Passport Export, or any other type." : "Choose a type and a template. You choose every record that goes in."}>
          <ApiForm action="/api/individual/professional/document-drafts" submitLabel="Create draft" accent={x.accent} savedText="Draft created. Open it below.">
            {fromPassport && <input type="hidden" name="origin" value="passport" />}
            {fromPassport && one(sp.passport) && <input type="hidden" name="passportShareTokenId" value={one(sp.passport)} />}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Document type" htmlFor="doc-type">
                <select id="doc-type" name="docType" required className={inputCls} defaultValue={fromPassport ? "passport-export" : cfg.types[0]?.code}>
                  {cfg.types.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Title (optional)" htmlFor="doc-title"><input id="doc-title" name="title" maxLength={200} className={inputCls} /></Field>
            </div>
            <p className="text-[12.5px] text-gray-500">Templates for each type: {cfg.types.map(t => `${t.label}: ${templatesFor(cfg, t).map(tp => `${tp.name} v${tp.version}`).join(", ")}`).join(" · ")}.</p>
          </ApiForm>
        </Section>
        <Section id="drafts-h" title="My documents" note="Private to you. Exports are made for you only and are not stored.">
          {docs.documents === null ? <Unreadable what="documents" /> : docs.documents.length === 0 ? <Empty>No documents yet.</Empty> : (
            <ul className="divide-y divide-gray-100">
              {docs.documents.map(d => {
                const ex = (docs.exports ?? []).filter(e => e.document_id === d.id);
                return (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <Link href={`?doc=${d.id}`} className={`text-[14.5px] font-semibold text-gray-900 underline-offset-2 hover:underline ${focusRing}`}>{d.title}</Link>
                      <p className="text-[12.5px] text-gray-600">{[cfg.types.find(t => t.code === d.doc_type)?.label ?? d.doc_type, `${cfg.templates.find(t => t.code === d.template_code)?.name ?? d.template_code} v${d.template_version}`,
                        `edited ${fmtDate(d.updated_at)}`, ex.length ? `${ex.length} export${ex.length === 1 ? "" : "s"}, last ${fmtDate(ex[0].exported_at)}` : "not exported", d.origin === "passport" ? "from your Passport" : null].filter(Boolean).join(" · ")}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <ApiForm action="/api/individual/professional/document-drafts" submitLabel="Duplicate" accent={x.accent} savedText="Duplicated." reset={false}>
                        <input type="hidden" name="duplicateOf" value={d.id} />
                      </ApiForm>
                      <ApiButton action={`/api/individual/professional/document-drafts?id=${d.id}`} method="DELETE" label="Delete" confirm="Delete this draft? Your records are not affected." />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </>
    );
  }

  async function Editor() {
    const c = await composeDocument(ctx.admin, ctx, doc!, today);
    if ("error" in c) return <Section title={doc!.title}><p role="alert" className="text-[13.5px] font-semibold text-red-700">{c.error}</p></Section>;
    const lines = modelLines(c.model);
    const odd = pdfUnencodable(lines);
    const offered = templatesFor(c.cfg, c.type);
    const recs = c.catalogue.records.filter(r => (c.type.rules.offerLapsed || r.validity === "current" || r.validity === "not_applicable") && (c.type.rules.offerSelfDeclared || r.trust !== "self_declared"))
      .map(r => ({ key: r.key, title: r.title, subtitle: r.subtitle, sections: r.sections, facts: r.facts, source: r.source, status: statusText(r.trust, r.validity, c.template.labels) }));
    const exportHref = (f: string) => `/api/individual/professional/document-drafts/export?id=${doc!.id}&format=${f}&hash=${c.hash}`;
    return (
      <>
        <Section id="edit-h" title={`${c.type.label}: ${doc!.title}`} note={`${c.template.name} template, version ${c.template.version}. Choose what goes in, in what order, then save to preview.`}>
          {c.catalogue.unreadable.length > 0 && <p className="mb-3 text-[13px] font-semibold text-amber-900">Could not be read just now, so not offered: {c.catalogue.unreadable.join(", ")}.</p>}
          <DocumentEditor id={doc!.id} title={doc!.title} templateCode={c.template.code} templates={offered.map(t => ({ code: t.code, label: `${t.name} (v${t.version})` }))}
            draft={doc!.content} records={recs} sectionTitles={{ ...SECTION_TITLE, ...c.template.sectionTitles }} accent={x.accent} aiOn={aiOn} showContactOffered={c.template.header.showContact} />
        </Section>
        <Section id="preview-h" title="Preview: the complete document" note="This is exactly what both exports contain. Exporting checks it is still the same.">
          {c.templateChanged && <p className="mb-2 text-[13px] font-semibold text-amber-900">The template was updated from version {c.templateChanged.from} to {c.templateChanged.to} since this draft was saved. The preview uses version {c.templateChanged.to}.</p>}
          {c.model.missing.length > 0 && <p className="mb-2 text-[13px] font-semibold text-amber-900">{c.model.missing.length} chosen {c.model.missing.length === 1 ? "record is" : "records are"} no longer available or not offered for this type, and {c.model.missing.length === 1 ? "is" : "are"} left out.</p>}
          {odd.length > 0 && <p className="mb-2 text-[13px] font-semibold text-amber-900">The PDF cannot show these characters and will print &ldquo;?&rdquo; for them: {odd.join(" ")}. The DOCX keeps them.</p>}
          <DocumentPreview model={c.model} template={c.template} />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {c.type.formats.includes("docx") && <a href={exportHref("docx")} className={primaryBtn} style={{ background: x.accent }}>Export editable DOCX</a>}
            {c.type.formats.includes("pdf") && <a href={exportHref("pdf")} className={secondaryBtn} style={{ color: x.accent }}>Export PDF</a>}
            <span className="text-[12.5px] text-gray-500">{c.model.recordCount} records · content check {c.hash.slice(0, 12)}. The file downloads to you only and is not stored. A downloaded copy cannot be recalled.</span>
          </div>
        </Section>
      </>
    );
  }
}
