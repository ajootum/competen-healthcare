import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { classifyIncoming, unlinkIncomingPatient } from "@/lib/practice/documents-workspace";

// PATCH /api/v1/practice/documents/classify -- CPR-DOC-002 s6.2 steps 3 and 4, and s17's unlink rule.
//
//   { id, patientId?, docType?, receivedOn? }         link and classify an arriving document
//   { id, action: "unlink", reason }                  remove the patient link, with a reason
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// inbox.record, NOT document.author. s13 gives the practice assistant "upload, classify, prepare drafts
// and share where delegated" -- and migration 200 minted inbox.record for exactly the desk work of
// recording what the post brought. Classifying it is the same job. Requiring document.author would put
// filing a lab result behind the permission to write a referral letter, which is a different act by a
// different person.
//
// ⚠ THERE IS NO `source` PARAMETER, ON EITHER BRANCH. s17: "Patient-uploaded documents retain source
// attribution even after classification." The engine's patch is a three-field allowlist and this route
// forwards three fields; there is no shape of request body that can rewrite where a document came from.
// That is the enforcement -- not a rule somebody has to remember when adding the fourth field.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const auth = await requirePracticeContext("inbox.record");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const fail = (r: { code: string; message: string; status: number }) =>
    NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });

  if (body.action === "unlink") {
    const result = await unlinkIncomingPatient(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, incomingId: String(body.id),
      reason: String(body.reason ?? ""),
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ unlinked: result.data, correlationId: auth.caller.traceId });
  }

  const result = await classifyIncoming(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, incomingId: String(body.id),
    // `undefined` means "leave it alone"; an explicit null means "unlink", which the engine refuses and
    // redirects to the action above. The three are kept distinct rather than collapsed to a falsy check.
    patientId: body.patientId === null ? null : body.patientId ? String(body.patientId) : undefined,
    docType: body.docType === undefined ? undefined : String(body.docType),
    receivedOn: body.receivedOn === undefined ? undefined : String(body.receivedOn),
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return fail(result);
  return NextResponse.json({ incoming: result.data, correlationId: auth.caller.traceId });
}
