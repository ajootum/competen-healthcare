import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getDocument } from "@/lib/practice/documentation";
import { LOCKED_DOCUMENT_STATUSES, DOC_TYPES } from "@/lib/practice/document-constants";
import DocumentConsole from "./DocumentConsole";

// /practice/documents/{id} -- CPR-130's document workspace.
//
// THE VERSION CHAIN IS RENDERED ON THE PAGE, both directions. A reader who opens version 2 must be able
// to see what version 1 said, and a reader who opens version 1 must be told immediately that it is not
// the current one -- otherwise the amendment machinery is correct in the database and invisible to the
// person relying on it.
//
// Object-level access is the workspace, as everywhere else: a document from another practice is
// notFound(), not 403 (SHELL-001 s6.2).

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const TYPE_LABEL = Object.fromEntries(DOC_TYPES) as Record<string, string>;

export default async function DocumentPage({ params }: { params: Promise<{ documentId: string }> }) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "document.view")) redirect("/practice/home");

  const { documentId } = await params;
  const admin = createAdminClient();
  const detail = await getDocument(admin, shell.ctx.workspaceId, documentId);
  if (!detail) notFound();

  const { document: doc, patient, releases, successor, predecessor } = detail as any;
  const locked = LOCKED_DOCUMENT_STATUSES.includes(doc.status);

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900">{doc.title}</h1>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">{doc.status}</span>
            {doc.version > 1 && (
              <span className="rounded bg-[var(--cmp-surface-information)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--cmp-text-information)]">
                version {doc.version}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[13px] text-gray-500">
            {TYPE_LABEL[doc.doc_type] ?? doc.doc_type}
            {" · "}{patient?.display_name ?? "Unknown patient"}
            {doc.addressed_to ? ` · to ${doc.addressed_to}` : ""}
            {" · created "}{String(doc.created_at).slice(0, 10)}
          </p>
        </div>
        <div className="flex gap-3">
          {doc.encounter_id && (
            <Link href={`/practice/encounters/${doc.encounter_id}`} className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              Consultation
            </Link>
          )}
          <Link href={`/practice/patients/${doc.patient_id}`} className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
            Patient record
          </Link>
          <Link href="/practice/documents" className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">← Documents</Link>
        </div>
      </div>

      {/* SUPERSEDED: the loudest thing on the page, because reading an outdated letter as current is the
          failure this whole versioning scheme exists to prevent. */}
      {successor && (
        <div className="mt-3 rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] px-3 py-2">
          <p className="text-[12px] font-bold text-[var(--cmp-text-warning)]">This is not the current version.</p>
          <p className="mt-0.5 text-[11px] text-gray-700">
            It was amended into{" "}
            <Link href={`/practice/documents/${successor.id}`} className="font-semibold underline">version {successor.version}</Link>
            {" "}({successor.status.toLowerCase()}). This version is kept because copies of it were issued.
          </p>
        </div>
      )}

      {locked && !successor && (
        <div className="mt-3 rounded-xl border border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] px-3 py-2">
          <p className="text-[12px] font-bold text-[var(--cmp-text-success)]">
            {doc.status === "ENTERED_IN_ERROR" ? "Marked as entered in error." : "Signed and issued."}
          </p>
          <p className="mt-0.5 text-[11px] text-gray-700">
            {doc.signed_at ? `Signed ${String(doc.signed_at).slice(0, 16).replace("T", " ")}. ` : ""}
            The content can no longer be edited. An amendment creates a new linked version; the database
            refuses any other change.
          </p>
        </div>
      )}

      {predecessor && (
        <p className="mt-3 text-[11px] text-gray-500">
          Amends{" "}
          <Link href={`/practice/documents/${predecessor.id}`} className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
            version {predecessor.version}
          </Link>
          {doc.amendment_reason ? ` — ${doc.amendment_reason}` : ""}
        </p>
      )}

      <div className="mt-4 grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <DocumentConsole
            documentId={doc.id}
            status={doc.status}
            title={doc.title}
            body={doc.body}
            addressedTo={doc.addressed_to}
            docType={doc.doc_type}
            recordVersion={doc.record_version}
            hasSuccessor={successor !== null}
            canAuthor={hasCapability(shell.ctx, "document.author")}
            canSign={hasCapability(shell.ctx, "document.sign")}
          />
        </div>

        <div className="flex flex-col gap-4">
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-[13px] font-bold text-gray-900">Who holds a copy</h2>
            {releases.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">
                {doc.status === "SIGNED"
                  ? "Not recorded as issued to anyone yet."
                  : "Nothing can be issued until this is signed."}
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {releases.map((r: any) => (
                  <li key={r.id} className="text-[12px]">
                    <span className="font-semibold text-gray-800">{String(r.channel).replace(/_/g, " ")}</span>
                    {r.recipient && <span className="text-gray-600"> — {r.recipient}</span>}
                    <p className="text-[10px] text-gray-400">{String(r.released_at).slice(0, 16).replace("T", " ")}</p>
                    {r.note && <p className="text-[11px] text-gray-500">{r.note}</p>}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[10px] text-gray-400">
              Recording a release does not send anything. It records that a copy left the practice, which
              is why this version can never be edited.
            </p>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-[13px] font-bold text-gray-900">Printing</h2>
            <p className="mt-1 text-[12px] text-gray-500">
              Use your browser&apos;s print command. There is no practice letterhead yet &mdash; a header
              carrying a practice&apos;s name, registration and address is a document this product has not
              been given, and inventing one would put unverified details on a clinical certificate.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
