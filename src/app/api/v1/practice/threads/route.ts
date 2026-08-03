import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { listThreads, createThread } from "@/lib/practice/communication";

// GET  /api/v1/practice/threads -- conversations, newest activity first, with the CALLER's unread flags.
// POST /api/v1/practice/threads -- start one; the first message is required.
//
// Unread is derived per caller from a read cursor, so the same list means something different to each
// member -- which is why the caller comes from the session and never from a parameter.

export async function GET() {
  const auth = await requirePracticeContext("message.use");
  if (isDenied(auth)) return auth;

  const threads = await listThreads(auth.caller.admin, auth.ctx.workspaceId, auth.caller.userId);
  return NextResponse.json({ threads, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("message.use");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await createThread(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    subject: String(body.subject ?? ""), body: String(body.body ?? ""),
    patientId: body.patientId ? String(body.patientId) : null,
    encounterId: body.encounterId ? String(body.encounterId) : null,
    documentId: body.documentId ? String(body.documentId) : null,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ thread: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
