import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { listNotifications, markNotificationsRead } from "@/lib/practice/tasks";

// GET   /api/v1/practice/notifications?includeRead=1 -- the caller's own in-app feed (CPR-340).
// PATCH /api/v1/practice/notifications               -- { ids? } mark read; omit ids to clear all.
//
// NO CAPABILITY IS REQUIRED, and that is deliberate: these are the caller's own rows and nobody else's.
// Gating them behind task.view would hide document_amended from a practitioner who does not do tasks.
//
// THE RECIPIENT IS ALWAYS THE SESSION, never a parameter. A feed you can read on somebody's behalf is a
// feed you can clear on their behalf, and the notification they needed is then gone unseen.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext(null);
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const notifications = await listNotifications(auth.caller.admin, auth.ctx.workspaceId, auth.caller.userId, {
    includeRead: url.searchParams.get("includeRead") === "1",
  });
  return NextResponse.json({ notifications, correlationId: auth.caller.traceId });
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePracticeContext(null);
  if (isDenied(auth)) return auth;

  let body: { ids?: string[] };
  try { body = await req.json(); } catch { body = {}; }

  const result = await markNotificationsRead(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, userId: auth.caller.userId,
    notificationIds: Array.isArray(body.ids) ? body.ids.map(String) : undefined,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ read: result.data, correlationId: auth.caller.traceId });
}
