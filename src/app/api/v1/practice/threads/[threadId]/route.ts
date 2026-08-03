import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { getThread, postMessage, markThreadRead } from "@/lib/practice/communication";

// GET   /api/v1/practice/threads/{id} -- the conversation. Reading via GET does NOT move the cursor:
//       a GET that writes is a GET a prefetcher can trigger, and a prefetched page must not mark
//       something read that nobody has looked at.
// POST  /api/v1/practice/threads/{id} -- { body } reply. Posting marks your own cursor.
// PATCH /api/v1/practice/threads/{id} -- { read: true } move the CALLER's cursor, nobody else's.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ threadId: string }> }) {
  const auth = await requirePracticeContext("message.use");
  if (isDenied(auth)) return auth;
  const { threadId } = await params;

  const detail = await getThread(auth.caller.admin, auth.ctx.workspaceId, threadId);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...detail, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ threadId: string }> }) {
  const auth = await requirePracticeContext("message.use");
  if (isDenied(auth)) return auth;
  const { threadId } = await params;

  let body: { body?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await postMessage(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, threadId, body: String(body.body ?? ""),
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ message: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ threadId: string }> }) {
  const auth = await requirePracticeContext("message.use");
  if (isDenied(auth)) return auth;
  const { threadId } = await params;

  let body: { read?: boolean };
  try { body = await req.json(); } catch { body = {}; }
  if (body.read !== true) return NextResponse.json({ error: "the only patch here is { read: true }" }, { status: 400 });

  // The thread must exist HERE before the cursor moves -- a cursor write against another workspace's
  // thread id would confirm the id exists.
  const detail = await getThread(auth.caller.admin, auth.ctx.workspaceId, threadId);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await markThreadRead(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, threadId, userId: auth.caller.userId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ read: result.data, correlationId: auth.caller.traceId });
}
