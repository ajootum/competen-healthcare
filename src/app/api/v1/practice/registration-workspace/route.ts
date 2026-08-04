import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  registrationWorkspace, queueWalkIn, saveDraft, listDrafts, discardDraft,
} from "@/lib/practice/registration-workspace";

// GET    /api/v1/practice/registration-workspace          -- the operational panel and the form config
// GET    /api/v1/practice/registration-workspace?view=drafts
// POST   /api/v1/practice/registration-workspace          -- queue a walk-in, or save a draft
// DELETE /api/v1/practice/registration-workspace?draft=   -- discard a draft

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("patient.list");
  if (isDenied(auth)) return auth;

  if (new URL(req.url).searchParams.get("view") === "drafts") {
    const drafts = await listDrafts(auth.caller.admin, auth.ctx);
    return NextResponse.json({ drafts, correlationId: auth.caller.traceId });
  }

  const workspace = await registrationWorkspace(auth.caller.admin, auth.ctx);
  return NextResponse.json({ ...workspace, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("patient.create");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const fail = (r: { code: string; message: string; status: number }) =>
    NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });

  if (body.queuePatientId) {
    const result = await queueWalkIn(auth.caller.admin, auth.ctx, {
      patientId: String(body.queuePatientId), correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId }, { status: 201 });
  }

  const result = await saveDraft(auth.caller.admin, auth.ctx, {
    id: body.draftId ? String(body.draftId) : null,
    payload: (body.payload ?? {}) as Record<string, unknown>,
    label: body.label ? String(body.label) : undefined,
    correlationId: auth.caller.traceId,
  });
  if (!result.ok) return fail(result);
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePracticeContext("patient.create");
  if (isDenied(auth)) return auth;

  const id = new URL(req.url).searchParams.get("draft");
  if (!id) return NextResponse.json({ error: "draft is required" }, { status: 400 });

  const result = await discardDraft(auth.caller.admin, auth.ctx, { id });
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}
