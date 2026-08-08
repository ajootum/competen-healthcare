import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { getForm, updateForm } from "@/lib/practice/forms";
import { FORM_CAPABILITIES } from "@/lib/practice/form-constants";

// GET   /api/v1/practice/forms/[id] -- the form, its questions, its readiness, the forms completed against it.
// PATCH /api/v1/practice/forms/[id] -- edit a draft, including the whole question list.
//
// ⚠ THE QUESTION LIST IS SENT WHOLE OR NOT AT ALL. `fields` absent means "leave the questions alone";
// `fields: []` means "this form has no questions", which is a thing somebody may legitimately want on the
// way to rebuilding it. The two are different and the engine treats them differently -- a PATCH that could
// not tell them apart would empty a form every time somebody renamed it.
//
// ⚠ `options`, `rules` AND `condition` ARE PASSED THROUGH AS THE JSON THEY ARE, not re-shaped here. The
// engine and the database own their shape: validateAnswer refuses a `pattern` rule by name, RULES_COHERENT
// refuses a range nothing could satisfy, and CALCULATIONS_RESOLVE refuses a total that uses a later
// question. A route quietly rewriting them would be a fourth place the rules live.

export async function GET(_req: NextRequest, ctx: { params: Promise<{ formId: string }> }) {
  const auth = await requirePracticeContext(FORM_CAPABILITIES.view);
  if (isDenied(auth)) return auth;

  const { formId } = await ctx.params;
  const detail = await getForm(auth.caller.admin, auth.ctx.workspaceId, formId);
  if (detail.state === "not_found")
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });

  return NextResponse.json({ detail, correlationId: auth.caller.traceId });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ formId: string }> }) {
  const auth = await requirePracticeContext(FORM_CAPABILITIES.manage);
  if (isDenied(auth)) return auth;

  const { formId } = await ctx.params;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await updateForm(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    formId,
    title: body.title !== undefined ? String(body.title) : undefined,
    purpose: body.purpose !== undefined ? (body.purpose ? String(body.purpose) : null) : undefined,
    specialty: body.specialty !== undefined ? (body.specialty ? String(body.specialty) : null) : undefined,
    tags: body.tags,
    ownerId: body.ownerId !== undefined ? (body.ownerId ? String(body.ownerId) : null) : undefined,
    subject: body.subject !== undefined ? String(body.subject) : undefined,
    effectiveFrom: body.effectiveFrom !== undefined ? (body.effectiveFrom ? String(body.effectiveFrom) : null) : undefined,
    reviewOn: body.reviewOn !== undefined ? (body.reviewOn ? String(body.reviewOn) : null) : undefined,
    fields: Array.isArray(body.fields)
      ? (body.fields as Record<string, unknown>[]).map(f => ({
          fieldKey: String(f.fieldKey ?? ""),
          label: String(f.label ?? ""),
          section: f.section ? String(f.section) : null,
          help: f.help ? String(f.help) : null,
          fieldType: f.fieldType ? String(f.fieldType) : "text",
          required: f.required !== false,
          options: f.options,
          rules: f.rules ?? null,
          condition: f.condition ?? null,
        }))
      : undefined,
    actorId: auth.ctx.userId,
    correlationId: auth.caller.traceId,
  });
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}
