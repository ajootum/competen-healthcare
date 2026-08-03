import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { getTemplate, setTemplateStatus } from "@/lib/practice/documentation";

// GET   /api/v1/practice/note-templates/{id} -- one template with its sections.
// PATCH /api/v1/practice/note-templates/{id} -- { status } publish / retire / return to draft.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ templateId: string }> }) {
  const auth = await requirePracticeContext("encounter.edit");
  if (isDenied(auth)) return auth;
  const { templateId } = await params;

  const template = await getTemplate(auth.caller.admin, auth.ctx.workspaceId, templateId);
  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ template, correlationId: auth.caller.traceId });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ templateId: string }> }) {
  const auth = await requirePracticeContext("template.manage");
  if (isDenied(auth)) return auth;
  const { templateId } = await params;

  let body: { status?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const status = body.status ?? "";
  if (!["draft", "published", "retired"].includes(status))
    return NextResponse.json({ error: "status must be one of: draft, published, retired" }, { status: 400 });

  const result = await setTemplateStatus(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, templateId, status: status as "draft" | "published" | "retired",
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ template: result.data, correlationId: auth.caller.traceId });
}
