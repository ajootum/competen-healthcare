import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { getDocument, updateDocument, transitionDocument, amendDocument, recordRelease } from "@/lib/practice/documentation";
import { DOCUMENT_ACTIONS } from "@/lib/practice/document-constants";

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
    return NextResponse.json({ amendment: result.data, correlationId: auth.caller.traceId });
  }

  if (body.release) {
    const auth = await requirePracticeContext("document.author");
    if (isDenied(auth)) return auth;
    const result = await recordRelease(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, documentId, channel: String(body.release.channel ?? "printed"),
      recipient: body.release.recipient ? String(body.release.recipient) : undefined,
      note: body.release.note ? String(body.release.note) : undefined,
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ release: result.data, correlationId: auth.caller.traceId });
  }

  if (body.action !== undefined) {
    const to = DOCUMENT_ACTIONS[String(body.action)];
    if (!to) return NextResponse.json({ error: `action must be one of: ${Object.keys(DOCUMENT_ACTIONS).join(", ")}` }, { status: 400 });

    const auth = await requirePracticeContext(to === "SIGNED" ? "document.sign" : "document.author");
    if (isDenied(auth)) return auth;
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
