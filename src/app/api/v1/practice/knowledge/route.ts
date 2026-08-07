import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { guidanceLibrary, createGuidance } from "@/lib/practice/knowledge";
import { KNOWLEDGE_CAPABILITIES } from "@/lib/practice/knowledge-constants";

// GET  /api/v1/practice/knowledge -- CPR-KS-001 section 8, the guidance library.
// POST /api/v1/practice/knowledge -- Engine 4, a new guidance document.
//
// ⚠ READING TAKES document.view AND WRITING TAKES template.manage, and both are SEEDED codes -- probed
// live against practice_role_capabilities, which held 47 of them. Migration 210 chose exactly this split
// for the document library on the reasoning that a protocol is something everybody who reads documents
// should be able to find, while keeping it is the same permission as keeping the note templates. An
// invented code compiles perfectly and 403s for every user including the practice owner, so the feature
// is simply unreachable and nothing errors; six have shipped in this codebase that way.
//
// ⚠ `state` IS A FIELD ON THE LIBRARY, not a comment on this route. A client receiving `items: []`
// cannot tell an empty shelf from a store that does not exist from a read that failed, and the one it
// will render is the reassuring one.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext(KNOWLEDGE_CAPABILITIES.view);
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const library = await guidanceLibrary(auth.caller.admin, auth.ctx.workspaceId, {
    q: url.searchParams.get("q"),
    docType: url.searchParams.get("type"),
    status: url.searchParams.get("status"),
    specialty: url.searchParams.get("specialty"),
    tag: url.searchParams.get("tag"),
    author: url.searchParams.get("author"),
  });

  return NextResponse.json({ library, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext(KNOWLEDGE_CAPABILITIES.manage);
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await createGuidance(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    code: String(body.code ?? ""),
    title: String(body.title ?? ""),
    docType: String(body.docType ?? ""),
    summary: body.summary ? String(body.summary) : null,
    specialty: body.specialty ? String(body.specialty) : null,
    tags: body.tags,
    ownerId: body.ownerId ? String(body.ownerId) : null,
    actorId: auth.ctx.userId,
    correlationId: auth.caller.traceId,
  });
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  return NextResponse.json({ id: result.data.id, correlationId: auth.caller.traceId }, { status: 201 });
}
