import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { pathwayWorkspace, listPathwayTemplates, createPathwayTemplate, type StageInput } from "@/lib/practice/pathways";
import { PATHWAY_CAPABILITIES } from "@/lib/practice/pathways-constants";

// GET  /api/v1/practice/pathways?templates=1  -- CPR-FUP-003 s12's workspace, or the template catalogue.
// POST /api/v1/practice/pathways              -- s5: author a template.
//
// ⚠ DESIGNING A PATHWAY AND PUTTING A PATIENT ON ONE ARE DIFFERENT CAPABILITIES, and migration 239 s8
// seeds them separately for a reason: the first is practice configuration and the second is a clinical
// decision. Only codes SEEDED in that migration appear here -- an invented capability code compiles
// perfectly and returns 403 for every user including the practice owner, so the feature is simply
// unreachable and nothing errors. Six have shipped in this codebase that way.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext(PATHWAY_CAPABILITIES.view);
  if (isDenied(auth)) return auth;

  const url = new URL(req.url);
  if (url.searchParams.get("templates") === "1") {
    const templates = await listPathwayTemplates(auth.caller.admin, auth.ctx.workspaceId, {
      includeInactive: url.searchParams.get("includeInactive") === "1",
    });
    // `unavailable` is a FIELD, not a comment on this route. A client receiving `templates: []` cannot
    // tell an empty catalogue from a failed read, and the one it will show is the reassuring one.
    return NextResponse.json({
      templates: templates.items, unavailable: templates.unavailable,
      unavailableDetail: templates.detail, correlationId: auth.caller.traceId,
    });
  }

  const workspace = await pathwayWorkspace(auth.caller.admin, auth.ctx.workspaceId, {
    templateId: url.searchParams.get("templateId"),
    status: url.searchParams.get("status"),
    search: url.searchParams.get("search"),
    activeOnly: url.searchParams.get("activeOnly") === "1",
  });
  return NextResponse.json({ workspace, correlationId: auth.caller.traceId });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext(PATHWAY_CAPABILITIES.design);
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const stages = Array.isArray(body.stages) ? (body.stages as Record<string, unknown>[]) : [];
  const result = await createPathwayTemplate(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    name: String(body.name ?? ""),
    specialty: body.specialty ? String(body.specialty) : null,
    description: body.description ? String(body.description) : null,
    // s5's entry criteria. Stored as PROSE and never evaluated -- a machine-evaluated criterion would
    // decide who goes on a pathway, and s2 says a practitioner does.
    entryCriteria: body.entryCriteria ? String(body.entryCriteria) : null,
    exitCriteria: body.exitCriteria ? String(body.exitCriteria) : null,
    stages: stages.map(s => ({
      name: String(s.name ?? ""),
      offsetDays: Number(s.offsetDays ?? 0),
      requiredAction: s.requiredAction ? String(s.requiredAction) : null,
      completionRule: s.completionRule ? String(s.completionRule) : undefined,
      followUpKind: s.followUpKind ? String(s.followUpKind) : null,
      followUpPriority: s.followUpPriority ? String(s.followUpPriority) : null,
    })) as StageInput[],
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ template: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
