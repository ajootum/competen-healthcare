import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  recordActivity, listActivities, addParticipant, addItem, procedureDetail, procedureItemTrace,
  listProcedureTemplates, createProcedureTemplate, applyProcedureTemplate,
  portfolioSummary, setPortfolio, recordExternalProcedure, removeExternalProcedure,
} from "@/lib/practice/clinical-activity";

// GET    /api/v1/practice/activities                    -- the clinical activity log
// GET    /api/v1/practice/activities?view=portfolio     -- what the caller has done, counted
// GET    /api/v1/practice/activities?view=templates     -- procedure templates
// GET    /api/v1/practice/activities?procedureId=       -- one procedure's team, kit and attachments
// GET    /api/v1/practice/activities?trace=<label>      -- which procedures used a piece of kit
// POST   /api/v1/practice/activities                    -- log an activity, add a participant or item,
//                                                          author or apply a procedure template, or
//                                                          record an EXTERNAL procedure (mig 302)
// PATCH  /api/v1/practice/activities                    -- mark portfolio evidence
// DELETE /api/v1/practice/activities?subject=external_procedure&id=  -- remove one's own external row
//
// LOGGING AN ACTIVITY TAKES procedure.record, the same capability as recording a procedure: both are a
// clinician writing down what they did. It is NOT encounter.edit, because most activities touch no
// patient record at all -- a teaching session is not a clinical write.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext("procedure.record");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  const procedureId = url.searchParams.get("procedureId");
  const trace = url.searchParams.get("trace");

  if (procedureId) {
    const detail = await procedureDetail(auth.caller.admin, auth.ctx.workspaceId, procedureId);
    return NextResponse.json({ ...detail, correlationId: auth.caller.traceId });
  }
  if (trace) {
    const uses = await procedureItemTrace(auth.caller.admin, auth.ctx.workspaceId, trace);
    return NextResponse.json({ uses, correlationId: auth.caller.traceId });
  }

  switch (url.searchParams.get("view")) {
    case "portfolio": {
      // ALWAYS THE CALLER'S OWN. There is no parameter for whose portfolio to read: a portfolio is a
      // claim about what one person did, and reading somebody else's is a different question with a
      // different answer about consent.
      const summary = await portfolioSummary(auth.caller.admin, auth.ctx.workspaceId, auth.caller.userId, {
        fromDay: url.searchParams.get("from") ?? undefined,
        toDay: url.searchParams.get("to") ?? undefined,
      });
      return NextResponse.json({ ...summary, correlationId: auth.caller.traceId });
    }
    case "templates": {
      const templates = await listProcedureTemplates(auth.caller.admin, auth.ctx.workspaceId);
      return NextResponse.json({ templates, correlationId: auth.caller.traceId });
    }
    default: {
      const activities = await listActivities(auth.caller.admin, auth.ctx.workspaceId, {
        performedBy: url.searchParams.get("mine") === "1" ? auth.caller.userId : (url.searchParams.get("performedBy") ?? undefined),
        kind: url.searchParams.get("kind") ?? undefined,
        fromDay: url.searchParams.get("from") ?? undefined,
        toDay: url.searchParams.get("to") ?? undefined,
      });
      return NextResponse.json({ activities, correlationId: auth.caller.traceId });
    }
  }
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext("procedure.record");
  if (isDenied(auth)) return auth;

  let body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const fail = (r: { code: string; message: string; status: number }) =>
    NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });
  const ctx = { actorId: auth.caller.userId, correlationId: auth.caller.traceId, workspaceId: auth.ctx.workspaceId };

  if (body.externalProcedure) {
    // s13: EXPLICIT, never the default shape of this POST -- a generic manual procedure path is what
    // the spec forbids. Every field forwarded whole (the six-dropped-fields route class).
    const x = body.externalProcedure;
    const result = await recordExternalProcedure(auth.caller.admin, {
      ...ctx, label: String(x.label ?? ""), source: String(x.source ?? ""),
      sourceRef: x.sourceRef ?? null, role: x.role, detail: x.detail,
      performedAt: String(x.performedAt ?? ""), cpdMinutes: x.cpdMinutes ?? null,
      portfolio: x.portfolio === true, performedBy: x.performedBy ?? null,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ externalProcedure: result.data, correlationId: auth.caller.traceId }, { status: 201 });
  }

  if (body.participant) {
    const p = body.participant;
    const result = await addParticipant(auth.caller.admin, {
      ...ctx, procedureId: String(p.procedureId ?? ""), role: String(p.role ?? ""),
      userId: p.userId ?? null, personName: p.personName, note: p.note,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ participant: result.data, correlationId: auth.caller.traceId }, { status: 201 });
  }

  if (body.item) {
    const i = body.item;
    const result = await addItem(auth.caller.admin, {
      ...ctx, procedureId: String(i.procedureId ?? ""), label: String(i.label ?? ""),
      kind: i.kind, identifier: i.identifier, quantity: i.quantity ?? null,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ item: result.data, correlationId: auth.caller.traceId }, { status: 201 });
  }

  if (body.template) {
    const t = body.template;
    const result = await createProcedureTemplate(auth.caller.admin, {
      ...ctx, code: String(t.code ?? ""), title: String(t.title ?? ""),
      procedureTypeId: t.procedureTypeId ?? null, defaultLaterality: t.defaultLaterality,
      defaultIndication: t.defaultIndication, defaultItems: t.defaultItems, defaultRoles: t.defaultRoles,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ template: result.data, correlationId: auth.caller.traceId }, { status: 201 });
  }

  if (body.applyTemplate) {
    const a = body.applyTemplate;
    const result = await applyProcedureTemplate(auth.caller.admin, {
      ...ctx, procedureId: String(a.procedureId ?? ""), templateId: String(a.templateId ?? ""),
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId }, { status: 201 });
  }

  const result = await recordActivity(auth.caller.admin, {
    ...ctx, kind: String(body.kind ?? ""), title: String(body.title ?? ""),
    occurredAt: String(body.occurredAt ?? ""), detail: body.detail,
    durationMinutes: body.durationMinutes ?? null, participation: body.participation,
    performedBy: body.performedBy ?? null, locationId: body.locationId ?? null,
    encounterId: body.encounterId ?? null, cpdMinutes: body.cpdMinutes ?? null,
    portfolio: body.portfolio === true,
  });
  if (!result.ok) return fail(result);
  return NextResponse.json({ activity: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePracticeContext("procedure.record");
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const subject = body.subject === "procedure" ? "procedure"
    : body.subject === "activity" ? "activity"
      : body.subject === "external_procedure" ? "external_procedure" : null;
  if (!subject || !body.id) return NextResponse.json({ error: "subject and id are required" }, { status: 400 });

  const result = await setPortfolio(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, subject, id: String(body.id),
    portfolio: body.portfolio === true,
    cpdMinutes: body.cpdMinutes === undefined ? undefined : (body.cpdMinutes as number | null),
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}

export async function DELETE(req: NextRequest) {
  const auth = await requirePracticeContext("procedure.record");
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  // ⚠ ONLY THE EXTERNAL ROW IS DELETABLE THROUGH THIS ROUTE. An encounter procedure is part of a
  // patient's clinical record and a logged activity has its own lifecycle -- neither acquires a
  // delete verb as a side effect of migration 302.
  if (url.searchParams.get("subject") !== "external_procedure")
    return NextResponse.json({ error: "only subject=external_procedure can be deleted here" }, { status: 400 });
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const result = await removeExternalProcedure(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId, id,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ ...result.data, correlationId: auth.caller.traceId });
}
