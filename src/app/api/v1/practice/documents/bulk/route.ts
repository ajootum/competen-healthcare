import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { bulkClassify } from "@/lib/practice/documents-workspace-review";

// POST /api/v1/practice/documents/bulk -- CPR-DOC-002 s10's bulk operations, s20 Phase 3.
//
//   { action: "classify", ids: string[], patientId?, docType? }
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// inbox.record, exactly as the single-row classify route takes. Doing the same thing forty times is the
// same act, and gating it differently would say that filing the post in bulk is a more privileged
// operation than filing it one row at a time -- which would be true of a bulk DELETE and is not true of
// this.
//
// ⚠ THE RESPONSE IS ALWAYS PER ROW. `{ changed: 38 }` on a batch of forty tells the operator two failed
// and not WHICH two, and the two that failed are the two an arriving result was about. `outcomes` is one
// entry per requested id, in the order requested, each carrying its own refusal code and sentence.
//
// ⚠ AND IT IS A 200 EVEN WHEN EVERY ROW REFUSED. The BATCH ran; the rows refused. A 4xx here would make
// a client discard the per-row detail it needs to show, and the operator would see one generic error
// instead of thirty-eight successes and two named problems. The engine's own refusals -- no selection,
// over the cap, nothing to apply, no capability -- are the ones that produce a non-200, because those
// are failures of the request rather than of the rows in it.
//
// ⚠ THERE IS NO "action": "archive" AND NO "action": "assign". Neither is drawn in the interface and
// neither is accepted here. Archive has no state to write to on either table; assign cannot reach an
// arriving document at all, because practice_task has no incoming_document_id -- see the header of
// documents-workspace-review.ts for the column that would close it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("inbox.record");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  if (body.action !== "classify")
    return NextResponse.json(
      { error: { code: "UNKNOWN_ACTION", message: "the only bulk action this workspace performs is classify" } },
      { status: 400 },
    );
  if (!Array.isArray(body.ids))
    return NextResponse.json({ error: "ids must be an array" }, { status: 400 });

  const result = await bulkClassify(auth.caller.admin, auth.ctx, {
    ids: (body.ids as unknown[]).map(String),
    // Undefined means "leave it alone", exactly as the single-row route treats it. There is deliberately
    // no way to pass null: unlinking needs a reason and is a different action.
    patientId: body.patientId ? String(body.patientId) : undefined,
    docType: body.docType === undefined ? undefined : String(body.docType),
    correlationId: auth.caller.traceId,
  });
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  return NextResponse.json({ bulk: result.data, correlationId: auth.caller.traceId });
}
