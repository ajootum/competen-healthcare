import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { listFollowUps, createFollowUp, followUpBoard, listIntervals } from "@/lib/practice/follow-ups";

// GET  /api/v1/practice/follow-ups?patientId=&status=&board=1 -- CPR-140's obligations.
// POST /api/v1/practice/follow-ups                            -- raise one.
//
// VIEW AND MANAGE ARE SEPARATE CAPABILITIES, and migration 196 s4 explains why at length: an assistant
// can work the board and chase people all day, and cannot alter a clinical obligation.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("followup.view");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  if (url.searchParams.get("board") === "1") {
    const [board, intervals] = await Promise.all([
      followUpBoard(auth.caller.admin, auth.ctx.workspaceId),
      listIntervals(auth.caller.admin),
    ]);
    return NextResponse.json({ board, intervals, correlationId: auth.caller.traceId });
  }

  const status = url.searchParams.get("status");
  const result = await listFollowUps(auth.caller.admin, auth.ctx.workspaceId, {
    patientId: url.searchParams.get("patientId") ?? undefined,
    status: status ? status.split(",") : undefined,
  });
  // `unavailable` is a FIELD ON THE PAYLOAD, not a comment on this route. A client receiving
  // `followUps: []` has no way to tell an empty board from a failed read, and the one it will show the
  // practitioner is the reassuring one. Spelled out rather than returning the result object whole, so
  // the shape of this response is a decision somebody made and not a refactor leaking through.
  return NextResponse.json({
    followUps: result.items,
    unavailable: result.unavailable,
    unavailableDetail: result.detail,
    correlationId: auth.caller.traceId,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("followup.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.patientId) return NextResponse.json({ error: "patientId is required" }, { status: 400 });

  const result = await createFollowUp(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    patientId: String(body.patientId),
    originEncounterId: body.originEncounterId ? String(body.originEncounterId) : null,
    problemId: body.problemId ? String(body.problemId) : null,
    diagnosisId: body.diagnosisId ? String(body.diagnosisId) : null,
    kind: body.kind ? String(body.kind) : undefined,
    reason: String(body.reason ?? ""),
    dueOn: body.dueOn ? String(body.dueOn) : undefined,
    intervalCode: body.intervalCode ? String(body.intervalCode) : undefined,
    priority: body.priority ? String(body.priority) : undefined,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ followUp: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
