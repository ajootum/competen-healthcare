import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { assignDocumentReview } from "@/lib/practice/documents-workspace-review";

// POST /api/v1/practice/documents/review -- CPR-DOC-002 s14 "document assigned for review", s15's
// DocumentReview, s20 Phase 3.
//
//   { documentId, assignTo, note?, dueOn? }
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// task.manage, NOT document.sign AND NOT document.author. Asking a colleague to look at a letter is
// coordination. Requiring the capability to WRITE letters in order to ask somebody to READ one would put
// the desk's own job behind the clinician's, which is the opposite of what s13 describes the practice
// assistant doing.
//
// ⚠ THE ENGINE CHECKS task.manage TOO. This check is the one that stops the request at the door; that one
// is the one that survives a future route, a background job or a console caller.
//
// ⚠ WHAT THIS DOES NOT DO: move the document's status. See DOC_REVIEW_STATUS_NOTE. The response carries
// `documentStatusUnchanged` so a client cannot draw a chip that moved.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("task.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  if (!body.documentId) return NextResponse.json({ error: "documentId is required" }, { status: 400 });
  if (!body.assignTo) return NextResponse.json({ error: "assignTo is required" }, { status: 400 });

  const result = await assignDocumentReview(auth.caller.admin, auth.ctx, {
    documentId: String(body.documentId),
    assignTo: String(body.assignTo),
    note: body.note === undefined || body.note === null ? null : String(body.note),
    dueOn: body.dueOn === undefined || body.dueOn === null ? null : String(body.dueOn),
    correlationId: auth.caller.traceId,
  });
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  return NextResponse.json({ review: result.data, correlationId: auth.caller.traceId });
}
