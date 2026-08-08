import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { formLibrary, createForm } from "@/lib/practice/forms";
import { FORM_CAPABILITIES } from "@/lib/practice/form-constants";

// GET  /api/v1/practice/forms -- CPR-KS-001 section 8, the form library.
// POST /api/v1/practice/forms -- section 4, a new form.
//
// ⚠ READING TAKES document.view AND AUTHORING TAKES template.manage, and both are SEEDED codes -- probed
// live against practice_role_capabilities, which held 50 of them. Migration 210 chose exactly this split
// for the document library. An invented code compiles perfectly and 403s for every user including the
// practice owner, so the feature is simply unreachable and nothing errors -- six have shipped in this
// codebase that way.
//
// ⚠ `state` IS A FIELD ON THE LIBRARY, not a comment on this route. A client receiving `items: []` cannot
// tell an empty shelf from a store that does not exist from a read that failed, and the one it will
// render is the reassuring one.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext(FORM_CAPABILITIES.view);
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const library = await formLibrary(auth.caller.admin, auth.ctx.workspaceId, {
    q: url.searchParams.get("q"),
    kind: url.searchParams.get("kind"),
    status: url.searchParams.get("status"),
    specialty: url.searchParams.get("specialty"),
    tag: url.searchParams.get("tag"),
    author: url.searchParams.get("author"),
  });

  return NextResponse.json({ library, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext(FORM_CAPABILITIES.manage);
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await createForm(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    code: String(body.code ?? ""),
    title: String(body.title ?? ""),
    kind: String(body.kind ?? ""),
    subject: body.subject ? String(body.subject) : undefined,
    purpose: body.purpose ? String(body.purpose) : null,
    specialty: body.specialty ? String(body.specialty) : null,
    tags: body.tags,
    ownerId: body.ownerId ? String(body.ownerId) : null,
    // ⚠ THE SUBJECT OF THE WRITE IS THE CALLER, never an id from the request body.
    actorId: auth.ctx.userId,
    correlationId: auth.caller.traceId,
  });
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  return NextResponse.json({ id: result.data.id, correlationId: auth.caller.traceId }, { status: 201 });
}
