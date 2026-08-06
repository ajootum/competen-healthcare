import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { publishPathwayVersion, setTemplateActive, type StageInput } from "@/lib/practice/pathways";
import { PATHWAY_CAPABILITIES } from "@/lib/practice/pathways-constants";

// PATCH /api/v1/practice/pathways/templates/{id} -- one of two shapes:
//         { stages: [...] }  s13: publish a NEW VERSION and retire this one
//         { active }         retire or restore a template
//
// ⚠ THERE IS NO EDIT-IN-PLACE, AND THAT IS THE POINT OF s13. Patients are already walking the version
// that exists; rewriting its stages underneath them would change the plan they are halfway through, and
// the history would then describe a journey nobody was ever actually sent on. Publishing makes a new row
// and deactivates the old one, so existing enrolments keep working against what they were assigned.

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ templateId: string }> }) {
  const auth = await requirePracticeContext(PATHWAY_CAPABILITIES.design);
  if (isDenied(auth)) return auth;
  const { templateId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const fail = (r: { code: string; message: string; status: number }) =>
    NextResponse.json({ error: { code: r.code, message: r.message } }, { status: r.status });

  if (Array.isArray(body.stages)) {
    const stages = (body.stages as Record<string, unknown>[]).map(s => ({
      name: String(s.name ?? ""),
      offsetDays: Number(s.offsetDays ?? 0),
      requiredAction: s.requiredAction ? String(s.requiredAction) : null,
      completionRule: s.completionRule ? String(s.completionRule) : undefined,
      followUpKind: s.followUpKind ? String(s.followUpKind) : null,
      followUpPriority: s.followUpPriority ? String(s.followUpPriority) : null,
    })) as StageInput[];

    const result = await publishPathwayVersion(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, templateId, stages,
      name: body.name !== undefined ? String(body.name) : undefined,
      specialty: body.specialty !== undefined ? (body.specialty ? String(body.specialty) : null) : undefined,
      description: body.description !== undefined ? (body.description ? String(body.description) : null) : undefined,
      entryCriteria: body.entryCriteria !== undefined ? (body.entryCriteria ? String(body.entryCriteria) : null) : undefined,
      exitCriteria: body.exitCriteria !== undefined ? (body.exitCriteria ? String(body.exitCriteria) : null) : undefined,
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ template: result.data, correlationId: auth.caller.traceId }, { status: 201 });
  }

  if (typeof body.active === "boolean") {
    const result = await setTemplateActive(auth.caller.admin, {
      workspaceId: auth.ctx.workspaceId, templateId, active: body.active,
      actorId: auth.caller.userId, correlationId: auth.caller.traceId,
    });
    if (!result.ok) return fail(result);
    return NextResponse.json({ template: result.data, correlationId: auth.caller.traceId });
  }

  return NextResponse.json({ error: "send { stages } to publish a new version, or { active } to retire or restore one" }, { status: 400 });
}
