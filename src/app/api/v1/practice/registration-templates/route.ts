import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  listTemplates, getTemplate, createTemplate, duplicateTemplate, upsertField, removeField,
  publishTemplate, retireTemplate, CORE_FIELDS, FIELD_TYPES,
} from "@/lib/practice/registration-config";

// GET    /api/v1/practice/registration-templates            -- every template, with field counts
// GET    /api/v1/practice/registration-templates?id=<id>    -- one, with its fields AND its problems
// POST   /api/v1/practice/registration-templates            -- create, or copy an existing one
// PATCH  /api/v1/practice/registration-templates            -- add/change a field, publish, or retire
// DELETE /api/v1/practice/registration-templates?id=&field= -- remove a field
//
// EVERY RESPONSE CARRIES THE PROBLEMS, not just the publish attempt. An editor that only tells you what
// is wrong at the moment you press Publish makes you hunt for it; one that says so as you type lets you
// fix it where you are standing.
//
// practice.settings.manage throughout -- enforced in the engine, so a second caller cannot bypass it.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("practice.settings.manage");
  if (isDenied(auth)) return auth;

  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const one = await getTemplate(auth.caller.admin, auth.ctx, id);
    if (!one) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ...one, coreFields: CORE_FIELDS, fieldTypes: FIELD_TYPES, correlationId: auth.caller.traceId });
  }

  const templates = await listTemplates(auth.caller.admin, auth.ctx);
  return NextResponse.json({ templates, coreFields: CORE_FIELDS, fieldTypes: FIELD_TYPES, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("practice.settings.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const fail = (r: { code: string; message: string; status: number }) =>
    NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });

  if (body.copyOf) {
    const result = await duplicateTemplate(auth.caller.admin, auth.ctx, {
      templateId: String(body.copyOf), name: body.name ? String(body.name) : undefined,
      correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId }, { status: 201 });
  }

  const result = await createTemplate(auth.caller.admin, auth.ctx, {
    name: String(body.name ?? ""),
    specialty: body.specialty ? String(body.specialty) : undefined,
    country: body.country ? String(body.country) : undefined,
    practiceType: body.practiceType ? String(body.practiceType) : undefined,
    seedCoreFields: body.seedCoreFields !== false,
    correlationId: auth.caller.traceId,
  });
  if (!result.ok) return fail(result);
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePracticeContext("practice.settings.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.templateId) return NextResponse.json({ error: "templateId is required" }, { status: 400 });

  const templateId = String(body.templateId);
  const fail = (r: { code: string; message: string; status: number }) =>
    NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });

  if (body.publish === true) {
    const result = await publishTemplate(auth.caller.admin, auth.ctx, {
      templateId, makeDefault: body.makeDefault === true, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
  }

  if (body.retire === true) {
    const result = await retireTemplate(auth.caller.admin, auth.ctx, { templateId, correlationId: auth.caller.traceId });
    if (!result.ok) return fail(result);
    return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
  }

  const f = (body.field ?? {}) as Record<string, unknown>;
  const result = await upsertField(auth.caller.admin, auth.ctx, {
    templateId, fieldKey: String(f.fieldKey ?? ""),
    label: f.label === undefined ? undefined : String(f.label),
    help: f.help === undefined ? undefined : String(f.help),
    fieldType: f.fieldType === undefined ? undefined : String(f.fieldType),
    required: f.required === undefined ? undefined : f.required === true,
    visible: f.visible === undefined ? undefined : f.visible === true,
    displayOrder: f.displayOrder === undefined ? undefined : Number(f.displayOrder),
    options: Array.isArray(f.options) ? f.options as { value: string; label: string }[] : undefined,
    condition: f.condition === undefined ? undefined : (f.condition as any) ?? null, // eslint-disable-line @typescript-eslint/no-explicit-any
    correlationId: auth.caller.traceId,
  });
  if (!result.ok) return fail(result);

  // THE PROBLEMS COME BACK WITH EVERY EDIT, so the editor can show them as you type rather than
  // ambushing you at Publish.
  const refreshed = await getTemplate(auth.caller.admin, auth.ctx, templateId);
  return NextResponse.json({ ...result.data, ...refreshed, correlationId: auth.caller.traceId });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePracticeContext("practice.settings.manage");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const templateId = url.searchParams.get("id");
  const fieldKey = url.searchParams.get("field");
  if (!templateId || !fieldKey)
    return NextResponse.json({ error: "id and field are required" }, { status: 400 });

  const result = await removeField(auth.caller.admin, auth.ctx, {
    templateId, fieldKey, correlationId: auth.caller.traceId,
  });
  if (!result.ok)
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });

  const refreshed = await getTemplate(auth.caller.admin, auth.ctx, templateId);
  return NextResponse.json({ ...result.data, ...refreshed, correlationId: auth.caller.traceId });
}
