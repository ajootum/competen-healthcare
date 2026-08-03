import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { listDocuments, createDocument } from "@/lib/practice/documentation";

// GET  /api/v1/practice/documents?patientId=&encounterId=&status= -- CPR-130 document list.
// POST /api/v1/practice/documents                                  -- create one, optionally composed
//                                                                     from a real encounter.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("document.view");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const documents = await listDocuments(auth.caller.admin, auth.ctx.workspaceId, {
    patientId: url.searchParams.get("patientId") ?? undefined,
    encounterId: url.searchParams.get("encounterId") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  });
  return NextResponse.json({ documents, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("document.author");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.patientId) return NextResponse.json({ error: "patientId is required" }, { status: 400 });

  const result = await createDocument(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    patientId: String(body.patientId),
    encounterId: body.encounterId ? String(body.encounterId) : null,
    templateId: body.templateId ? String(body.templateId) : null,
    docType: body.docType ? String(body.docType) : undefined,
    title: String(body.title ?? ""),
    addressedTo: body.addressedTo ? String(body.addressedTo) : undefined,
    body: body.body !== undefined ? String(body.body) : undefined,
    composeFrom: body.composeFrom === true,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ document: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
