import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { listTemplates, createTemplate } from "@/lib/practice/documentation";

// GET  /api/v1/practice/note-templates?kind=&includeUnpublished=1 -- CPR-130's library.
// POST /api/v1/practice/note-templates                            -- author a workspace template.
//
// READING the library needs encounter.edit, not template.manage: applying a template is a clinical act
// available to anyone who writes notes, while authoring one is practice configuration. Requiring the
// management capability to READ would hide the library from the people it exists for.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("encounter.edit");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const templates = await listTemplates(auth.caller.admin, auth.ctx.workspaceId, {
    kind: url.searchParams.get("kind") ?? undefined,
    includeUnpublished: url.searchParams.get("includeUnpublished") === "1",
  });
  return NextResponse.json({ templates, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("template.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await createTemplate(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    code: String(body.code ?? ""), title: String(body.title ?? ""),
    description: body.description ? String(body.description) : undefined,
    kind: body.kind ? String(body.kind) : undefined,
    specialty: body.specialty ? String(body.specialty) : undefined,
    sections: Array.isArray(body.sections) ? (body.sections as never[]) : [],
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ template: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
