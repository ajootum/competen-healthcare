import Link from "next/link";
import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { POLICY_SCOPE } from "@/lib/individual/policy";
import { DEFAULT_LABELS, DOCUMENTS_PATH, SECTION_CODES, SECTION_TITLE, resolveDocuments, templatesFor } from "@/lib/individual/documents-config";
import { buildDocModel, emptyDraft } from "@/lib/individual/documents/model";
import { SAMPLE_PERSON, SAMPLE_RECORDS } from "@/lib/individual/documents/sample";
import DocumentPreview from "@/app/individual/_components/DocumentPreview";
import TemplateStudio from "./_components/TemplateStudio";
import { PublishBar } from "../configuration/_components/PolicyControls";

// /super-admin/individual/documents -- COMPETEN-PROFESSIONAL-PROGRESS-01 PR7 s10.3, the No-Code Document Template Studio.
//
// Guarded by hq.individual.config.manage (migration 376), the right the Individual Product Administrator holds: the same
// authority, WCE store, publication and audit as the Individual policy (the document lives at DOCUMENTS_PATH in the
// platform/individual partition). It shows the published configuration, edits a draft, and previews any template with
// INVENTED sample records: it reads no person's records. Publishing is the Individual policy's one publish.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Document Template Studio" };

type SP = Record<string, string | string[] | undefined>;

export default async function DocumentTemplateStudioPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireHqCapability("hq.individual.config.manage");
  const { data: row } = await ctx.admin.from("workspace_config_overrides").select("draft, published, updated_at")
    .eq("scope_type", POLICY_SCOPE.scopeType).eq("scope_ref", POLICY_SCOPE.scopeRef).eq("config_path", DOCUMENTS_PATH).maybeSingle();
  const published = resolveDocuments(row?.published ?? null);
  const draft = row?.draft ? resolveDocuments(row.draft) : published;
  const pending = row && JSON.stringify(row.draft ?? null) !== JSON.stringify(row.published ?? null) ? 1 : 0;
  const sp = await searchParams;
  const which = (Array.isArray(sp.preview) ? sp.preview[0] : sp.preview) ?? draft.templates[0]?.code;
  const tpl = draft.templates.find(t => t.code === which) ?? draft.templates[0];
  const type = draft.types.find(d => templatesFor(draft, d).some(t => t.code === tpl?.code)) ?? draft.types[0];
  const records = new Map(SAMPLE_RECORDS.map(r => [r.key, r]));
  const model = tpl && type ? buildDocModel({ type, template: tpl, title: `${type.label} (sample)`, today: new Date().toISOString().slice(0, 10), person: SAMPLE_PERSON, records,
    draft: { ...emptyDraft(type), summary: "This is a sample summary written by the professional, in their own words.", sections: emptyDraft(type).sections.map(s => ({ ...s, visible: true, records: SAMPLE_RECORDS.filter(r => r.sections.includes(s.code)).map(r => ({ key: r.key })) })) } }) : null;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-teal-800">Competen Individual</p>
        <h1 className="text-2xl font-bold text-gray-900">Document Template Studio</h1>
        <p className="mt-1 max-w-3xl text-[14px] text-gray-600">The document types and templates of the Professional Document Studio, no code. Every template is versioned: a changed template gets its next version when saved, and people get it when the <Link href="/super-admin/individual/configuration" className="font-semibold underline">Individual policy</Link> is published. What a record means (self-declared, document-supported, formative, decided by an organisation or an independent verifier, expired, revoked) is fixed by its owner: templates only word it.</p>
      </header>
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-[16px] font-bold text-gray-900">Published now</h2>
        <p className="mt-1 text-[13px] text-gray-700">{row?.published ? `Published configuration, updated ${new Date(row.updated_at).toISOString().slice(0, 10)}` : "Nothing published: the built-in defaults apply"}. {published.types.length} document types, {published.templates.length} templates ({published.templates.map(t => `${t.name} v${t.version}`).join(", ")}).</p>
      </section>
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-[16px] font-bold text-gray-900">Draft</h2>
        <div className="mt-3"><TemplateStudio initial={draft} sections={SECTION_CODES.map(c => [c, SECTION_TITLE[c]])} labelKeys={Object.keys(DEFAULT_LABELS)} /></div>
        <div className="mt-4"><PublishBar pending={pending} /></div>
      </section>
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-[16px] font-bold text-gray-900">Preview with sample records</h2>
        <nav aria-label="Preview template" className="mt-2 flex flex-wrap gap-2 text-[13px]">
          {draft.templates.map(t => <Link key={t.code} href={`?preview=${t.code}`} aria-current={t.code === tpl?.code ? "true" : undefined} className={`rounded-full border px-3 py-1 font-semibold ${t.code === tpl?.code ? "border-teal-700 text-teal-900" : "border-gray-300 text-gray-700"}`}>{t.name} v{t.version}</Link>)}
        </nav>
        <p className="mt-2 text-[12.5px] text-gray-500">Invented records only. Save the draft to see changes here.</p>
        <div className="mt-3">{model && tpl ? <DocumentPreview model={model} template={tpl} /> : <p>No template to preview.</p>}</div>
      </section>
    </main>
  );
}
