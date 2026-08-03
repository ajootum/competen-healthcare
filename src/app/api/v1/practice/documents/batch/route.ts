import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { generateBatch, listBatches } from "@/lib/practice/document-generation";

// GET  /api/v1/practice/documents/batch -- CPR-330 batch history.
// POST /api/v1/practice/documents/batch -- generate the same document for many patients.
//
// The response reports `generated` AND `failed` separately and always returns 201 when the batch ran,
// even if every document in it failed. A batch that produced nothing is a fact to show, not an error to
// swallow -- and the caller needs the batch id either way to see what happened.

export async function GET() {
  const auth = await requirePracticeContext("document.view");
  if (isDenied(auth)) return auth;
  const batches = await listBatches(auth.caller.admin, auth.ctx.workspaceId);
  return NextResponse.json({ batches, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("document.author");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.templateId) return NextResponse.json({ error: "templateId is required" }, { status: 400 });
  if (!Array.isArray(body.patientIds)) return NextResponse.json({ error: "patientIds must be an array" }, { status: 400 });

  const result = await generateBatch(auth.caller.admin, auth.ctx, {
    templateId: String(body.templateId),
    patientIds: (body.patientIds as unknown[]).map(String),
    titlePattern: body.titlePattern ? String(body.titlePattern) : undefined,
    selectionNote: body.selectionNote ? String(body.selectionNote) : undefined,
    allowUnresolved: body.allowUnresolved === true,
    correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ batch: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
