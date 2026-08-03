import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { listIncoming, recordIncoming, reviewIncoming, actionIncoming } from "@/lib/practice/communication";

// GET   /api/v1/practice/inbox?status=          -- the register of what arrived.
// POST  /api/v1/practice/inbox                  -- record something the post or portal brought.
// PATCH /api/v1/practice/inbox                  -- { id, action: "review"|"action", note? }
//
// THE CAPABILITY SPLIT IS THE POINT. Recording receipt is desk work (inbox.record, assistant included).
// REVIEW is a clinical judgement -- deciding a lab result needs nothing IS a decision about a patient --
// so it needs inbox.review, which only the practitioner role carries. The register exists so that
// judgement has a name on it.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("inbox.record");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const incoming = await listIncoming(auth.caller.admin, auth.ctx.workspaceId, {
    status: status ? status.split(",") : undefined,
    patientId: url.searchParams.get("patientId") ?? undefined,
  });
  return NextResponse.json({ incoming, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("inbox.record");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await recordIncoming(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    patientId: body.patientId ? String(body.patientId) : null,
    docType: body.docType ? String(body.docType) : undefined,
    source: String(body.source ?? ""), title: String(body.title ?? ""),
    summary: body.summary ? String(body.summary) : undefined,
    receivedOn: body.receivedOn ? String(body.receivedOn) : undefined,
    whereHeld: body.whereHeld ? String(body.whereHeld) : undefined,
    priority: body.priority ? String(body.priority) : undefined,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ incoming: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  let body: { id?: string; action?: string; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const fail = (r: { code: string; message: string; status: number }) =>
    NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });

  if (body.action === "review") {
    const auth = await requirePracticeContext("inbox.review");
    if (isDenied(auth)) return auth;
    const result = await reviewIncoming(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, incomingId: body.id, note: body.note,
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ incoming: result.data, correlationId: auth.caller.traceId });
  }

  if (body.action === "action") {
    const auth = await requirePracticeContext("inbox.record");
    if (isDenied(auth)) return auth;
    const result = await actionIncoming(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, incomingId: body.id, note: String(body.note ?? ""),
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ incoming: result.data, correlationId: auth.caller.traceId });
  }

  return NextResponse.json({ error: "action must be review or action" }, { status: 400 });
}
