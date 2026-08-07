import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { draftIntoDocument } from "@/lib/practice/documents-workspace-ai";

// POST /api/v1/practice/documents/ai-draft -- CPR-DOC-002 s12, s20 Phase 3.
//
//   { documentId, task, mode?: "replace" | "append" }
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// document.author, AND THAT IS THE WHOLE BOUNDARY. Migration 248 gave the practice assistant
// document.author and deliberately withheld document.sign. A machine drafting is an authoring act; it is
// not a signing act, and there is no route anywhere that lets one become the other. This route cannot
// mark a document ready, cannot sign it, and cannot issue it.
//
// ⚠ THE RESPONSE CARRIES `attributionRecorded`, AND A CLIENT MUST RENDER IT WHEN IT IS FALSE. False means
// the machine's text is now in the document and the record of where it came from did not save. That is
// the one outcome in which a practitioner is looking at machine-written words with nothing anywhere
// saying so, and it is exactly the state s12's labelling rule exists to prevent.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("document.author");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  if (!body.documentId) return NextResponse.json({ error: "documentId is required" }, { status: 400 });
  if (!body.task) return NextResponse.json({ error: "task is required" }, { status: 400 });

  const result = await draftIntoDocument(auth.caller.admin, auth.ctx, {
    documentId: String(body.documentId),
    task: String(body.task),
    mode: body.mode === "append" ? "append" : "replace",
    correlationId: auth.caller.traceId,
  });
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  return NextResponse.json({ draft: result.data, correlationId: auth.caller.traceId });
}
