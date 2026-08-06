import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { recordInvestigation, reviewInvestigation } from "@/lib/practice/encounter-workspace";

// POST  /api/v1/practice/encounters/{id}/investigations  -- record that one was requested.
// PATCH /api/v1/practice/encounters/{id}/investigations  -- record that it has been reviewed.
//
// ⚠ THIS IS NOT AN ORDER SYSTEM AND IT MUST NOT BECOME ONE. CPR-ENC-001 s3 says "Requested / reviewed
// (TYPE ONLY)" and s5 excludes laboratory tables and imaging reports outright. There is no `result`
// field in the body, in the table, or in the response. CompetenPractice does not transmit a request to a
// laboratory, does not receive a structured result, and cannot tell anybody whether a test was
// performed. `summary` is a sentence about what the PRACTITIONER made of whatever came back -- the
// arrived document itself lives in practice_incoming_document with its own review trail.

export async function POST(req: NextRequest, { params }: { params: Promise<{ encounterId: string }> }) {
  const auth = await requirePracticeContext("encounter.edit");
  if (isDenied(auth)) return auth;
  const { encounterId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await recordInvestigation(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, encounterId,
    label: String(body.label ?? ""),
    summary: body.summary === undefined ? null : String(body.summary),
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ investigation: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ encounterId: string }> }) {
  const auth = await requirePracticeContext("encounter.edit");
  if (isDenied(auth)) return auth;
  const { encounterId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const investigationId = String(body.investigationId ?? "");
  if (!investigationId) return NextResponse.json({ error: "investigationId is required" }, { status: 400 });

  const result = await reviewInvestigation(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, encounterId, investigationId,
    summary: body.summary === undefined ? null : String(body.summary),
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ investigation: result.data, correlationId: auth.caller.traceId });
}
