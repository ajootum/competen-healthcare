import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { getGuidance, updateGuidance } from "@/lib/practice/knowledge";
import { KNOWLEDGE_CAPABILITIES } from "@/lib/practice/knowledge-constants";

// GET   /api/v1/practice/knowledge/[id] -- one guidance document, its ten rendered sections, its
//                                          approval and its publish readiness.
// PATCH /api/v1/practice/knowledge/[id] -- edit a DRAFT. Anything else is refused by name.
//
// ⚠ THE EDIT REFUSAL IS THE ENGINE'S AND IT IS DELIBERATE. A document that changes while a colleague is
// reading it is not the document they approved, and one that changes after they approved it is an
// approval that means nothing. The forward path from anything that is not a draft is an explicit act:
// withdraw, re-open, or start a new version.

export async function GET(_req: NextRequest, ctx: { params: Promise<{ guidanceId: string }> }) {
  const auth = await requirePracticeContext(KNOWLEDGE_CAPABILITIES.view);
  if (isDenied(auth)) return auth;

  const { guidanceId } = await ctx.params;
  const detail = await getGuidance(auth.caller.admin, auth.ctx.workspaceId, guidanceId);
  if (detail.state === "not_found")
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });

  return NextResponse.json({ detail, correlationId: auth.caller.traceId });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ guidanceId: string }> }) {
  const auth = await requirePracticeContext(KNOWLEDGE_CAPABILITIES.manage);
  if (isDenied(auth)) return auth;

  const { guidanceId } = await ctx.params;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const sections = Array.isArray(body.sections)
    ? (body.sections as Record<string, unknown>[]).map(s => ({ key: String(s.key ?? ""), body: String(s.body ?? "") }))
    : undefined;

  // `undefined` means "not sent" and `null` means "clear it". Collapsing the two is how clearing a
  // review date becomes impossible and how an untouched field gets nulled by a partial form.
  const result = await updateGuidance(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    guidanceId,
    title: body.title === undefined ? undefined : String(body.title ?? ""),
    summary: body.summary === undefined ? undefined : (body.summary ? String(body.summary) : null),
    specialty: body.specialty === undefined ? undefined : (body.specialty ? String(body.specialty) : null),
    tags: body.tags === undefined ? undefined : body.tags,
    ownerId: body.ownerId === undefined ? undefined : (body.ownerId ? String(body.ownerId) : null),
    effectiveFrom: body.effectiveFrom === undefined ? undefined : (body.effectiveFrom ? String(body.effectiveFrom) : null),
    reviewOn: body.reviewOn === undefined ? undefined : (body.reviewOn ? String(body.reviewOn) : null),
    sections,
    actorId: auth.ctx.userId,
    correlationId: auth.caller.traceId,
  });
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}
