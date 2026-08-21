import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getDocument } from "@/lib/practice/documentation";
import { editorSupport } from "@/lib/practice/documents-workspace-issue";
import { aiAttribution, draftAvailability } from "@/lib/practice/documents-workspace-ai";
import { AI_DRAFT_LABEL } from "@/lib/practice/documents-workspace-constants";
import { LOCKED_DOCUMENT_STATUSES, DOC_TYPES } from "@/lib/practice/document-constants";
import { logAccess } from "@/lib/practice/privacy";
import DocumentConsole from "./DocumentConsole";
import AiDraftPanel from "./AiDraftPanel";
import { practiceDayOf, workspaceClock } from "@/lib/practice/practice-time";

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
  // The practice's own day for every date rendered below. These were UTC slices of timestamptz
  // columns, which name yesterday for the three hours a practice ahead of UTC is already on tomorrow.
  const { timezone } = await workspaceClock(admin, shell.ctx.workspaceId);
  const detail = await getDocument(admin, shell.ctx.workspaceId, documentId);
  if (!detail) notFound();

  const { document: doc, patient, releases, successor, predecessor } = detail as any;
  const locked = LOCKED_DOCUMENT_STATUSES.includes(doc.status);

  // CPR-DOC-002 s8, PHASE 2. Everything the structured editor needs, resolved HERE on the server and
  // handed over as plain values: what each merge field resolves to for this patient, what markers are
  // still in the text, the letterhead as it will print, and the template's section headings.
  //
  // ⚠ RESOLVED ON THE SERVER BY DESIGN. editorSupport() reads the patient, the configuration and the
  // template through the admin client; it must never be reachable from the client component, and it is
  // not -- DocumentConsole imports only from document-constants.ts and documents-workspace-constants.ts,
  // neither of which imports anything server-side. That boundary killed the Follow-ups board this week.
  const support = await editorSupport(admin, shell.ctx, doc);

  // CPR-DOC-002 s12, PHASE 3. Whether a machine wrote this text, and whether the panel that asks one to
  // may be drawn at all.
  //
  // ⚠ THE ATTRIBUTION IS A `Reading`, AND ITS THIRD STATE IS RENDERED. "No machine wrote this" and "we
  // could not find out whether a machine wrote this" are opposite advice to somebody about to put their
  // name on it. A trail that could not be read must never draw as the absence of an event.
  const [attribution, drafting] = await Promise.all([
    aiAttribution(admin, shell.ctx.workspaceId, doc.id, doc.body ?? ""),
    draftAvailability(admin, shell.ctx, { status: doc.status, encounter_id: doc.encounter_id ?? null }),
  ]);
  const attributionLabel = attribution.state === "ok" ? AI_DRAFT_LABEL[attribution.value.state] : null;

  // CPR-370. A document carries the same clinical content as the consultation behind it, so opening
  // one is as much a read of the patient as opening their record.
  await logAccess(admin, {
    workspaceId: shell.ctx.workspaceId, actorId: shell.ctx.userId, subjectKind: "document",
    subjectId: doc.id, patientId: doc.patient_id, route: "/practice/documents/[id]",
  });

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
            {" · created "}{practiceDayOf(timezone, doc.created_at) ?? "date not recorded"}
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

      {/* s12: "Label AI-generated content until the practitioner reviews it."
          ⚠ ABOVE THE EDITOR AND ABOVE THE SIGN PANEL, because it is a fact about the text a person is
          being asked to attest to. A document nobody asked a machine to draft carries NOTHING here --
          the absence of a claim is the correct rendering of the absence of an event, and a banner
          reading "no AI was used" on every hand-written letter would be noise that trains people to
          stop reading the one that matters. */}
      {attributionLabel && attribution.state === "ok" && (
        <div className="mt-3 rounded-xl border border-gray-200 bg-white px-3 py-2">
          <p className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${attributionLabel.chip}`}>
              {attributionLabel.label}
            </span>
            {attribution.value.taskLabel && (
              <span className="text-[11px] text-gray-500">{attribution.value.taskLabel}</span>
            )}
            {attribution.value.model && (
              <span className="text-[11px] text-gray-400">{attribution.value.model}</span>
            )}
            {attribution.value.at && (
              <span className="text-[11px] text-gray-400">
                {String(attribution.value.at).slice(0, 16).replace("T", " ")}
              </span>
            )}
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-gray-600">{attributionLabel.blurb}</p>
          {/* ⚠ THE DRAFT LANDED AND THE RECORD OF IT DID NOT. Said, never swallowed. */}
          {!attribution.value.attributionComplete && (
            <p className="mt-1 text-[11.5px] font-semibold text-rose-700">
              The record of what the machine produced is incomplete, so whether this text has been edited
              since cannot be established from the trail.
            </p>
          )}
        </div>
      )}
      {attribution.state !== "ok" && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="text-[12px] font-bold text-amber-900">
            Whether a machine drafted this could not be checked.
          </p>
          <p className="mt-0.5 text-[11px] text-amber-800">
            {attribution.detail} This is not the same as no machine having drafted it.
          </p>
        </div>
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
            merge={support.merge}
            letterheadLines={support.letterheadLines}
            templateSections={support.templateSections}
            attestation={support.attestation}
            printHref={`/practice/documents/${doc.id}/print`}
          />
        </div>

        <div className="flex flex-col gap-4">
          <AiDraftPanel
            documentId={doc.id}
            hasBody={!!String(doc.body ?? "").trim()}
            provider={drafting.provider}
            model={drafting.model}
            blocker={drafting.blocker}
            available={drafting.available}
          />

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

          {/* ⚠ THIS PANEL USED TO SAY "there is no practice letterhead yet". That stopped being true when
              CPR-360 built the configuration the print view composes one from, and a page that describes
              the product as it was two releases ago is a quieter kind of wrong answer than a bad number. */}
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-[13px] font-bold text-gray-900">Printing and PDF</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-gray-500">
              The print view is the PDF export: open it and choose &ldquo;Save as PDF&rdquo; in your
              browser&apos;s print dialog. It carries the practice letterhead, the body exactly as the
              record holds it, and the signature block. An unsigned document prints marked DRAFT.
            </p>
            <Link href={`/practice/documents/${doc.id}/print`}
              className="mt-2 inline-block text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
              Open the print view &rarr;
            </Link>
            <p className="mt-2 text-[10px] text-gray-400">
              Printing is a read of a patient record and is logged as an export.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
