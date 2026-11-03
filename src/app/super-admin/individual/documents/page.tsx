import Link from "next/link";
import type { Metadata } from "next";
import { requireHqCapability } from "@/lib/hq/context";
import { withOwnAppointments } from "@/lib/assessment/studio/appointed";
import { DOCUMENTS_REVIEW_CAP, documentsPathway, loadDocumentsReviewState, type DocumentsPathway, type DocumentsReviewState } from "@/lib/hq/documents-review";
import { PathwayTracker } from "@/app/super-admin/checklist-studio/_components/PathwayPanel";
import { POLICY_SCOPE } from "@/lib/individual/policy";
import { DEFAULT_LABELS, DOCUMENTS_PATH, SECTION_CODES, SECTION_TITLE, resolveDocuments, templatesFor } from "@/lib/individual/documents-config";
import { buildDocModel, emptyDraft } from "@/lib/individual/documents/model";
import { SAMPLE_PERSON, SAMPLE_RECORDS } from "@/lib/individual/documents/sample";
import DocumentPreview from "@/app/individual/_components/DocumentPreview";
import TemplateStudio from "./_components/TemplateStudio";
import { PublishBar } from "../configuration/_components/PolicyControls";
import DocumentsGovernance from "./_components/DocumentsGovernance";

// /super-admin/individual/documents -- COMPETEN-PROFESSIONAL-PROGRESS-01 PR7 s10.3, the No-Code Document Template Studio.
//
// Guarded by hq.individual.config.manage (migration 376), the right the Individual Product Administrator holds: the same
// authority, WCE store, publication and audit as the Individual policy (the document lives at DOCUMENTS_PATH in the
// platform/individual partition). A changed configuration is published only after a different holder of that right approves the exact
// draft (migration 942, two-person review): the "Pathway to publication" section shows where it stands and offers the one action for
// the viewer. It shows the published configuration, edits a draft, and previews any template with
// INVENTED sample records: it reads no person's records. Publishing is the Individual policy's one publish.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Document Template Studio" };

type SP = Record<string, string | string[] | undefined>;

export default async function DocumentTemplateStudioPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await withOwnAppointments(await requireHqCapability("hq.individual.config.manage"), ["hq.individual.config.manage"]);
  const { data: row } = await ctx.admin.from("workspace_config_overrides").select("draft, published, updated_at")
    .eq("scope_type", POLICY_SCOPE.scopeType).eq("scope_ref", POLICY_SCOPE.scopeRef).eq("config_path", DOCUMENTS_PATH).maybeSingle();
  const published = resolveDocuments(row?.published ?? null);
  const draft = row?.draft ? resolveDocuments(row.draft) : published;
  const pending = row && JSON.stringify(row.draft ?? null) !== JSON.stringify(row.published ?? null) ? 1 : 0;
  let review: DocumentsReviewState | null = null;
  let reviewError: string | null = null;
  try { review = await loadDocumentsReviewState(ctx.admin); } catch (e) { reviewError = e instanceof Error ? e.message : "The review record could not be read."; }
  const pathway: DocumentsPathway | null = review ? documentsPathway(review, { userId: ctx.userId, canManage: ctx.capabilities.includes(DOCUMENTS_REVIEW_CAP) }) : null;
  const when = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");
  const name = (id: string | null | undefined) => (id ? (id === ctx.userId ? "you" : review?.names[id] ?? "a colleague") : "");
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
      <section aria-labelledby="docs-pathway-h" className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 id="docs-pathway-h" className="text-[16px] font-bold text-gray-900">Pathway to publication</h2>
        {!pathway || !review ? (
          <p role="alert" className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[13px] text-red-900">The review record could not be read just now{reviewError ? ` (${reviewError.slice(0, 160)})` : ""}. Publishing is still refused by the database unless an independent holder approved the exact draft.</p>
        ) : (
          <div data-cmp-theme="platform" className="mt-3 space-y-3">
            <PathwayTracker stages={pathway.stages} />
            <div className="rounded-xl border border-teal-200 bg-teal-50 p-4" aria-label="Next action">
              <p className="text-[11px] font-bold uppercase tracking-wide text-teal-900">Next action</p>
              <p className="text-[15px] font-bold text-gray-900">{pathway.next.headline}</p>
              <p className="text-[13px] text-gray-800">{pathway.next.detail}</p>
              {!pathway.next.viewer.canAct && pathway.next.viewer.reason && <p className="mt-1 text-[12.5px] font-semibold text-amber-900">You: {pathway.next.viewer.reason}</p>}
              {pathway.next.action !== "none" && <div className="mt-3"><DocumentsGovernance action={pathway.next.action} reviewId={review.review?.decision === null ? review.review.id : null} /></div>}
            </div>
            {review.review ? (
              <dl className="grid gap-x-6 gap-y-1 text-[13px] text-gray-800 sm:grid-cols-[max-content_1fr]">
                <dt className="font-semibold">Submitted by</dt>
                <dd>{name(review.review.submittedBy)}, {when(review.review.submittedAt)}{review.review.note ? `: "${review.review.note}"` : ""}</dd>
                <dt className="font-semibold">Latest decision</dt>
                <dd>{review.review.decision ? `${review.review.decision === "approved" ? "Approved" : "Changes requested"} by ${name(review.review.decidedBy)}, ${when(review.review.decidedAt)}${review.review.decisionNote ? `: "${review.review.decisionNote}"` : ""}` : "Not decided yet"}</dd>
              </dl>
            ) : review.pending ? <p className="text-[13px] text-gray-700">This draft has not been submitted for review.</p> : null}
          </div>
        )}
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
