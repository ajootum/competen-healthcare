import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  listProcedureTypes, createProcedureType, setProcedureTypeStatus,
  configureProcedureType, setProcedureActivation,
} from "@/lib/practice/procedures";

// GET   /api/v1/practice/procedure-types?category=&includeUnpublished=1 -- CPR-150's catalogue.
// POST  /api/v1/practice/procedure-types                                -- add one to this practice.
// PATCH /api/v1/practice/procedure-types                                -- { id, status } publish/retire.
//
// READING needs encounter.list, not procedure.manage: choosing a procedure from the catalogue is part of
// recording a consultation, while editing the catalogue is practice configuration. Same split as the
// note-template library.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("encounter.list");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const procedureTypes = await listProcedureTypes(auth.caller.admin, auth.ctx.workspaceId, {
    category: url.searchParams.get("category") ?? undefined,
    includeUnpublished: url.searchParams.get("includeUnpublished") === "1",
  });
  return NextResponse.json({ procedureTypes, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("procedure.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const result = await createProcedureType(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    code: String(body.code ?? ""), name: String(body.name ?? ""),
    category: body.category ? String(body.category) : undefined,
    sided: body.sided === true, consentRequired: body.consentRequired === true,
    typicalDurationMinutes: typeof body.typicalDurationMinutes === "number" ? body.typicalDurationMinutes : undefined,
    aftercare: body.aftercare ? String(body.aftercare) : undefined,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ procedureType: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePracticeContext("procedure.manage");
  if (isDenied(auth)) return auth;

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // The 297 settings screen's two verbs (2026-08-16). Legacy callers send { id, status } with no
  // action and keep their behaviour.
  if (body.action === "configure") {
    const result = await configureProcedureType(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, procedureTypeId: String(body.id),
      siteRule: body.siteRule, lateralityRule: body.lateralityRule, consentRule: body.consentRule,
      allowedLateralities: Array.isArray(body.allowedLateralities) ? body.allowedLateralities.map(String) : undefined,
      allowedStatuses: Array.isArray(body.allowedStatuses) ? body.allowedStatuses.map(String) : undefined,
      defaultStatus: body.defaultStatus === undefined ? undefined : (body.defaultStatus === null ? null : String(body.defaultStatus)),
      outcomeRequired: typeof body.outcomeRequired === "boolean" ? body.outcomeRequired : undefined,
      detailFields: body.detailFields,
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
    return NextResponse.json({ ok: true, correlationId: auth.caller.traceId });
  }
  if (body.action === "activation") {
    const result = await setProcedureActivation(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, procedureTypeId: String(body.id),
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      localDisplayName: body.localDisplayName === undefined ? undefined : (body.localDisplayName === null ? null : String(body.localDisplayName)),
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : null,
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
    return NextResponse.json({ ok: true, correlationId: auth.caller.traceId });
  }

  if (!["draft", "published", "retired"].includes(body.status ?? ""))
    return NextResponse.json({ error: "status must be one of: draft, published, retired" }, { status: 400 });

  const result = await setProcedureTypeStatus(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, procedureTypeId: body.id,
    status: body.status as "draft" | "published" | "retired",
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ procedureType: result.data, correlationId: auth.caller.traceId });
}
