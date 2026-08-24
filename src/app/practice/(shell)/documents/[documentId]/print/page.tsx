import { redirect } from "next/navigation";
import PrintButton from "../../../PrintButton";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getDocument } from "@/lib/practice/documentation";
import { letterhead } from "@/lib/practice/document-generation";
import { resolveStyle } from "@/lib/practice/document-style";
import { publishedStyleFor } from "@/lib/practice/document-style-store";
import { DocumentBody } from "@/components/practice/DocumentBody";
import { DOC_ATTESTATION } from "@/lib/practice/documents-workspace-constants";
import { logAccess } from "@/lib/practice/privacy";
import { formatDateTime } from "@/lib/datetime";

// /practice/documents/[id]/print -- CPR-330 export.
//
// THE PRINT VIEW IS THE PDF EXPORT. A browser's print-to-PDF produces the letterhead, the body and the
// signature block exactly as they are here, and it does so without this product taking on a rendering
// library, a font licence, or a second definition of what the document looks like. Word export is not
// built and the reports page says so rather than implying it.
//
// A DRAFT PRINTS WITH A WATERMARK, and this is not decoration. A printed draft that looks identical to a
// signed one is a document somebody hands over in good faith; the word DRAFT across it is the only thing
// standing between an unsigned letter and a filing cabinet.
//
// PRINTING IS A READ OF A PATIENT RECORD and is logged like any other (CPR-370).

export const dynamic = "force-dynamic";

export default async function PrintDocumentPage({ params }: { params: Promise<{ documentId: string }> }) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "document.view")) redirect("/practice/home");

  const { documentId } = await params;
  const admin = createAdminClient();
  const detail = await getDocument(admin, shell.ctx.workspaceId, documentId);
  if (!detail?.document) redirect("/practice/documents");

  const doc = detail.document;

  // COMPOSED HERE, NOT STORED IN THE BODY -- see the note in document-generation.ts. One definition of
  // the letterhead, so correcting the practice's address corrects every future print rather than
  // leaving a hundred signed documents disagreeing with it. A template may opt out; a hand-written
  // document has no template and gets the practice's letterhead, which is what stationery is for.
  const { data: template } = doc.template_id
    ? await admin.from("practice_note_template").select("include_letterhead").eq("id", doc.template_id).maybeSingle()
    : { data: null };
  const head = template?.include_letterhead === false ? null : await letterhead(admin, shell.ctx.workspaceId);

  // CPR-DOC-CONFIG-001 s11. THE PINNED STYLE FIRST. A document rendered under one practice style must
  // keep it when the practice publishes another -- a letter that has been signed and sent cannot be
  // repainted. Only a document with no pin follows the practice style of today.
  const { data: pinnedRow } = doc.style_id
    ? await admin.from("practice_document_style").select("tokens").eq("id", doc.style_id).maybeSingle()
    : { data: null };
  const practiceStyle = pinnedRow ? null : await publishedStyleFor(admin, shell.ctx.workspaceId);
  const style = resolveStyle({ pinned: pinnedRow?.tokens, practicePublished: practiceStyle?.tokens });

  await logAccess(admin, {
    workspaceId: shell.ctx.workspaceId, actorId: shell.ctx.userId,
    patientId: doc.patient_id, subjectKind: "document", subjectId: doc.id,
    // "export", not "view": the taxonomy has no "print", and printing is the action that produces a
    // copy nobody can recall. Mapping it to the weaker verb would understate it in the access review.
    action: "export", route: `/practice/documents/${doc.id}/print`,
  });

  const signed = doc.status === "SIGNED" || doc.status === "AMENDED";

  // WHO SIGNED IT, BY NAME, ON THE PAPER. A recipient holding a printed certificate cannot look up a
  // uuid. A name that could not be read prints nothing rather than an id -- an unresolved identifier on a
  // clinical document reads as data rot to the person holding it.
  const { data: signer } = signed && doc.signed_by
    ? await admin.from("profiles").select("full_name").eq("id", doc.signed_by).maybeSingle()
    : { data: null };
  const signerName: string | null = signer?.full_name ?? null;

  return (
    <div className="mx-auto max-w-[190mm] bg-white p-8 print:p-0">
      {/* Screen-only chrome. Nothing here reaches the paper. */}
      <div className="mb-6 flex items-center gap-3 print:hidden">
        <PrintButton />
        <a href={`/practice/documents/${doc.id}`} className="text-[12px] text-gray-500 hover:underline">
          &larr; Back to the document
        </a>
        <p className="ml-auto text-[11px] text-gray-500">
          Use your browser&rsquo;s print dialog and choose &ldquo;Save as PDF&rdquo;.
        </p>
      </div>

      {!signed && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-900 print:hidden">
          This document is not signed. It will print marked DRAFT.
        </p>
      )}

      <article className="relative text-[12px] leading-relaxed text-black">
        {!signed && (
          <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rotate-[-30deg] text-[80px] font-black tracking-widest text-black/10">DRAFT</span>
          </span>
        )}

        {head && (
          <header className="mb-6 whitespace-pre-line border-b border-black/20 pb-3 text-center text-[11px]">
            {head}
          </header>
        )}

        <h1 className="mb-1 text-[15px] font-bold">{doc.title}</h1>
        <p className="mb-4 text-[11px] text-black/60">
          {detail.patient?.display_name ?? "No patient on the record"}
          {doc.addressed_to ? ` · For the attention of ${doc.addressed_to}` : ""}
          {" · "}{new Date(doc.created_at).toLocaleDateString()}
        </p>

        {/* CPR-DOC-CONFIG-001 s15. Structure plus the resolved style where the document has one, and
            the verbatim body where it does not -- which is every document written before this existed.
            Either way any [[marker]] the generator left is still visible, which is the entire point of
            rendering unresolved fields rather than blanking them. */}
        <DocumentBody blocks={(doc.content_model as never) ?? null} body={doc.body ?? ""} tokens={style.tokens} />

        <footer className="mt-10 border-t border-black/20 pt-3 text-[11px]">
          {signed ? (
            <>
              <p>
                Signed {doc.signed_at ? formatDateTime(doc.signed_at) : ""}
                {signerName ? ` by ${signerName}` : ""}.
              </p>
              <p className="text-black/60">
                {/* NO IMAGE OF A SIGNATURE. This product signs by recording who signed and when; drawing
                    a facsimile would assert something the record does not hold. */}
                Signed electronically in Competen Practice. This copy carries no handwritten signature.
              </p>
              {/* ⚠ s7.1 ON THE PAPER. The reader of a printed referral letter cannot open the audit
                  trail, so the one line that says WHAT THIS SIGNATURE MEANS has to be on the page: it is
                  an attestation to this document, and it is not the consultation's signature. */}
              <p className="mt-1 text-black/60">
                {DOC_ATTESTATION.distinction}
              </p>
            </>
          ) : (
            <p>Unsigned draft &mdash; not valid as an issued document.</p>
          )}
        </footer>
      </article>
    </div>
  );
}
