import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import { assignPathway, listPatientPathways } from "@/lib/practice/pathways";
import { PATHWAY_CAPABILITIES } from "@/lib/practice/pathways-constants";

// GET  /api/v1/practice/pathways/assignments?patientId=  -- s11's patient panel.
// POST /api/v1/practice/pathways/assignments             -- put a patient on a plan.
//
// ⚠ ASSIGNMENT IS A DECISION SOMEBODY MAKES (s2, "practitioner-controlled"). Nothing on this route reads
// the template's entry criteria and decides for them: the criteria are shown on the screen, a person
// reads them, and this endpoint records what they chose. `pathway.assign` is the seeded capability for
// exactly that act, held separately from `pathway.design`.

export async function GET(req: NextRequest) {
  const auth = await requirePracticeContext(PATHWAY_CAPABILITIES.view);
  if (isDenied(auth)) return auth;

  const patientId = new URL(req.url).searchParams.get("patientId");
  if (!patientId) return NextResponse.json({ error: "patientId is required" }, { status: 400 });

  const result = await listPatientPathways(auth.caller.admin, auth.ctx.workspaceId, patientId);
  return NextResponse.json({
    pathways: result.items, unavailable: result.unavailable,
    unavailableDetail: result.detail, correlationId: auth.caller.traceId,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePracticeContext(PATHWAY_CAPABILITIES.assign);
  if (isDenied(auth)) return auth;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.patientId || !body.templateId)
    return NextResponse.json({ error: "patientId and templateId are required" }, { status: 400 });

  const result = await assignPathway(auth.caller.admin, {
    workspaceId: auth.ctx.workspaceId,
    patientId: String(body.patientId), templateId: String(body.templateId),
    trigger: body.trigger ? String(body.trigger) : undefined,
    originEncounterId: body.originEncounterId ? String(body.originEncounterId) : null,
    note: body.note ? String(body.note) : null,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ pathway: result.data, correlationId: auth.caller.traceId }, { status: 201 });
}
