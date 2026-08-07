import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { getDocument, updateDocument, transitionDocument, amendDocument } from "@/lib/practice/documentation";
import { DOCUMENT_ACTIONS } from "@/lib/practice/document-constants";
import { signDocument, issueDocument } from "@/lib/practice/documents-workspace-issue";
import { notifyDocumentAmended } from "@/lib/practice/tasks";

// GET   /api/v1/practice/documents/{id}
// PATCH /api/v1/practice/documents/{id} -- one of four shapes:
//         { title | body | addressedTo | docType }  edit a draft
//         { action }                                the state machine
//         { amend: { reason } }                     create the next version of a signed document
//         { release: { channel, recipient, note } } record that a copy left the practice
//
// SIGNING NEEDS document.sign; everything else needs document.author. The same split as the encounter,
// and for the same reason: a scribe role could reasonably draft a referral letter without ever being able
// to put a practitioner's name on it.
//
// ⚠ CPR-DOC-002 PHASE 2: SIGNING AND ISSUING NO LONGER GO STRAIGHT TO documentation.ts.
//
//   { action: "sign" } now requires { attestationVersion } and runs through signDocument(), which states
//   what a DOCUMENT signature means (s7.1 -- a different act from signing the consultation), refuses a
//   document still carrying unresolved merge markers (s12), re-checks the patient link at the moment of
//   signature (s17) and writes the attestation with the SHA-256 of the text signed.
//
//   { release: ... } runs through issueDocument(), which adds s17's patient-link control and s6.4's
//   recipient rules. The wire shape is unchanged, so nothing that already calls it breaks.
//
// Both engines re-check the capability themselves. That is not belt-and-braces for its own sake: the
// check below protects THIS route, and the check in the engine protects every future caller of it.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  const auth = await requirePracticeContext("document.view");
  if (isDenied(auth)) return auth;
  const { documentId } = await params;

  const detail = await getDocument(auth.caller.admin, auth.ctx.workspaceId, documentId);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...detail, correlationId: auth.caller.traceId });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  let body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const fail = (r: { code: string; message: string; status: number }) =>
    NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });

  if (body.amend) {
    const auth = await requirePracticeContext("document.author");
    if (isDenied(auth)) return auth;
    const result = await amendDocument(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, documentId, reason: String(body.amend.reason ?? ""),
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);

    // CPR-340. Tell the ORIGINAL AUTHOR that their document was superseded -- the one clinical event in
    // this product that another person can cause and that cannot be worked out from current state
    // later. notify() drops it silently when the amender is the author, which in a solo practice is
    // always. Wired HERE rather than inside amendDocument so the notification layer stays a consumer of
    // the clinical modules and never something they depend on.
    const { data: original } = await auth.caller.admin.from("practice_clinical_document")
      .select("created_by").eq("id", documentId).maybeSingle();
    if (original?.created_by) {
      await notifyDocumentAmended(auth.caller.admin, {
        workspaceId: auth.ctx.workspaceId, documentId, successorId: result.data.id,
        authorId: original.created_by, reason: String(body.amend.reason ?? ""),
        actorId: auth.caller.userId,
      });
    }
    return NextResponse.json({ amendment: result.data, correlationId: auth.caller.traceId });
  }

  if (body.release) {
    const auth = await requirePracticeContext("document.author");
    if (isDenied(auth)) return auth;
    const result = await issueDocument(auth.caller.admin, auth.ctx, {
      documentId, channel: String(body.release.channel ?? "printed"),
      recipient: body.release.recipient ? String(body.release.recipient) : null,
      note: body.release.note ? String(body.release.note) : null,
      correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ release: result.data, correlationId: auth.caller.traceId });
  }

  if (body.action !== undefined) {
    const to = DOCUMENT_ACTIONS[String(body.action)];
    if (!to) return NextResponse.json({ error: `action must be one of: ${Object.keys(DOCUMENT_ACTIONS).join(", ")}` }, { status: 400 });

    const auth = await requirePracticeContext(to === "SIGNED" ? "document.sign" : "document.author");
    if (isDenied(auth)) return auth;

    // ⚠ SIGNING IS NOT A TRANSITION LIKE THE OTHERS, WHICH IS WHY IT LEAVES THE STATE MACHINE HERE.
    // s7.1: it is an attestation. The caller must send back the version of the statement it displayed;
    // a request without one is refused rather than defaulted, because a default would mean somebody's
    // signature was recorded against wording they were never shown.
    if (to === "SIGNED") {
      const version = body.attestationVersion;
      if (typeof version !== "string" || !version.trim())
        return NextResponse.json({
          error: {
            code: "ATTESTATION_REQUIRED",
            message: "signing a document requires the signature statement to have been read; attestationVersion is missing",
          },
        }, { status: 400 });

      const signed = await signDocument(auth.caller.admin, auth.ctx, {
        documentId, attestationVersion: version.trim(), correlationId: auth.caller.traceId,
      });
      if (!signed.ok) return fail(signed);
      return NextResponse.json({ document: signed.data, correlationId: auth.caller.traceId });
    }

    const result = await transitionDocument(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, documentId, to,
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ document: result.data, correlationId: auth.caller.traceId });
  }

  const auth = await requirePracticeContext("document.author");
  if (isDenied(auth)) return auth;
  const result = await updateDocument(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, documentId,
    title: body.title !== undefined ? String(body.title) : undefined,
    body: body.body !== undefined ? String(body.body) : undefined,
    addressedTo: body.addressedTo !== undefined ? (body.addressedTo === null ? null : String(body.addressedTo)) : undefined,
    docType: body.docType !== undefined ? String(body.docType) : undefined,
    recordVersion: typeof body.recordVersion === "number" ? body.recordVersion : undefined,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return fail(result);
  return NextResponse.json({ document: result.data, correlationId: auth.caller.traceId });
}
