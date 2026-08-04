import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  runAssistant, assistantSettings, setAssistantEnabled, listSessions, sessionMessages,
  rateMessage, assistantUsage, ASSISTANT_TASKS, REFUSED, type TaskKey,
} from "@/lib/practice/ai-assistant";

// GET   /api/v1/practice/assistant                    -- settings, tasks, refusals, usage
// GET   /api/v1/practice/assistant?view=sessions      -- the CALLER'S OWN conversations
// GET   /api/v1/practice/assistant?sessionId=<id>     -- one conversation
// POST  /api/v1/practice/assistant                    -- ask the assistant
// PATCH /api/v1/practice/assistant                    -- turn it on/off, or rate an answer
//
// A LONGER TIMEOUT THAN THE OTHER PRACTICE ROUTES, because a model call is not a database query.

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("encounter.list");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");

  if (sessionId) {
    const s = await sessionMessages(auth.caller.admin, auth.ctx, sessionId);
    if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ...s, correlationId: auth.caller.traceId });
  }

  if (url.searchParams.get("view") === "sessions") {
    const sessions = await listSessions(auth.caller.admin, auth.ctx);
    return NextResponse.json({ sessions, correlationId: auth.caller.traceId });
  }

  const [settings, usage] = await Promise.all([
    assistantSettings(auth.caller.admin, auth.ctx.workspaceId),
    assistantUsage(auth.caller.admin, auth.ctx),
  ]);
  return NextResponse.json({
    settings, usage, tasks: ASSISTANT_TASKS, refused: REFUSED,
    correlationId: auth.caller.traceId,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("encounter.list");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await runAssistant(auth.caller.admin, auth.ctx, {
    task: String(body.task ?? "ask") as TaskKey,
    question: body.question ? String(body.question) : undefined,
    encounterId: body.encounterId ? String(body.encounterId) : null,
    patientId: body.patientId ? String(body.patientId) : null,
    sessionId: body.sessionId ? String(body.sessionId) : null,
    correlationId: auth.caller.traceId,
  });
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  // NO ENDPOINT WRITES THIS ANSWER ANYWHERE CLINICAL. It is returned for the practitioner to read, and
  // if they want it in the record they paste it into a note and sign it -- the existing CPR-130 path,
  // which is already audited and already refuses to touch a signed encounter.
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePracticeContext("encounter.list");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  if (body.messageId !== undefined) {
    const result = await rateMessage(auth.caller.admin, auth.ctx, {
      messageId: String(body.messageId), helpful: body.helpful === true,
      note: body.note ? String(body.note) : undefined,
    });
    if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
    return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
  }

  const result = await setAssistantEnabled(auth.caller.admin, auth.ctx, {
    enabled: body.enabled === true,
    acknowledgedNoticeVersion: body.acknowledgedNoticeVersion ? String(body.acknowledgedNoticeVersion) : undefined,
    correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}
