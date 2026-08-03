import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { listDocuments } from "@/lib/practice/documentation";
import { DOC_TYPES } from "@/lib/practice/document-constants";

// /practice/documents -- CPR-130's document register.
//
// TWO LISTS, and the split is the one that matters clinically: documents that have LEFT the practice and
// documents that have not. A signed referral letter is out in the world; a draft is a private working
// note. Sorting them together by date would put the two on the same footing, and the whole point of the
// signature is that they are not.
//
// AMENDED documents are shown, not hidden. A superseded version is still part of the record -- somebody
// out there is holding it -- and a register that quietly dropped it would be answering "what did we
// issue?" with a curated version of the truth.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const TYPE_LABEL = Object.fromEntries(DOC_TYPES) as Record<string, string>;

export default async function DocumentsPage() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "document.view")) redirect("/practice/home");

  const admin = createAdminClient();
  const documents = await listDocuments(admin, shell.ctx.workspaceId, { limit: 100 }) as any[];
  const issued = documents.filter(d => ["SIGNED", "AMENDED"].includes(d.status));
  const working = documents.filter(d => ["DRAFT", "FINAL"].includes(d.status));
  const voided = documents.filter(d => d.status === "ENTERED_IN_ERROR");

  const row = (d: any) => (
    <li key={d.id} className="flex items-center gap-2 flex-wrap border-b border-gray-100 py-2 last:border-0">
      <Link href={`/practice/documents/${d.id}`} className="text-[13px] font-semibold text-gray-900 hover:underline">
        {d.title}
      </Link>
      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
        {TYPE_LABEL[d.doc_type] ?? d.doc_type}
      </span>
      {d.version > 1 && (
        <span className="rounded bg-[var(--cmp-surface-information)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--cmp-text-information)]">
          v{d.version}
        </span>
      )}
      <span className="text-[12px] text-gray-600">{d.patient_name ?? "Unknown patient"}</span>
      <span className="ml-auto text-[11px] text-gray-400">
        {d.signed_at
          ? `signed ${String(d.signed_at).slice(0, 10)}`
          : `created ${String(d.created_at).slice(0, 10)}`}
      </span>
      <span className="text-[10px] font-bold text-gray-400">{d.status}</span>
    </li>
  );

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Documents</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            Letters, certificates and summaries. A document is created from a consultation and signed
            separately from it &mdash; signing here means issuing.
          </p>
        </div>
        <span className="flex items-center gap-3">
          {/* CPR-320: the practice's own documents, which belong to nobody in particular. */}
          <Link href="/practice/documents/library" className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
            Document library →
          </Link>
          {hasCapability(shell.ctx, "template.manage") && (
            <Link href="/practice/documents/templates" className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              Template library →
            </Link>
          )}
        </span>
      </div>

      {documents.length === 0 && (
        <section className="mt-4 rounded-xl border border-gray-200 bg-white p-6">
          <p className="text-[13px] font-semibold text-gray-700">No documents yet.</p>
          <p className="mt-1 text-[12px] text-gray-500">
            Open a consultation and use <span className="font-semibold">Create document</span> to draft a
            referral letter, a certificate or a summary from what you recorded.
          </p>
        </section>
      )}

      {[
        ["Issued", issued, "Signed and out in the world. These cannot be edited; an amendment creates a new version."],
        ["In progress", working, "Drafts and documents marked ready. Nothing here has been issued to anyone."],
        ["Entered in error", voided, "Retained, permanently flagged."],
      ].map(([title, list, note]) => (list as any[]).length > 0 && (
        <section key={title as string} className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">{title as string}</h2>
          <p className="mt-0.5 text-[11px] text-gray-500">{note as string}</p>
          <ul className="mt-2">{(list as any[]).map(row)}</ul>
        </section>
      ))}
    </div>
  );
}
