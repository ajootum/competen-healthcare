import { NextRequest, NextResponse } from "next/server";
import { requirePracticeContext, isDenied } from "@/lib/practice/api-context";
import {
  getPatientPathway, completeStage, skipStage, repeatStage, cancelStage, delayStage, stopPathway,
} from "@/lib/practice/pathways";
import { PATHWAY_CAPABILITIES, PATHWAY_STAGE_ACTIONS } from "@/lib/practice/pathways-constants";

// GET   /api/v1/practice/pathways/assignments/{id} -- the plan, its stages and its full audit trail.
// PATCH /api/v1/practice/pathways/assignments/{id} -- { action, reason?, note?, days?, dueOn?, closingEncounterId? }
//
// ⚠ NO DEVIATION IS EVER REFUSED HERE. skip, repeat, delay and cancel are peers of complete, not
// exceptions to it, and the only thing any of them is refused for is having NO REASON -- which is s10
// and s14's requirement ("every deviation is audited"), not a gate on the act. A pathway that could only
// be walked the way it was written would be a protocol wearing a plan's name, and it would be wrong for
// exactly the patients who need thinking about.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ pathwayId: string }> }) {
  const auth = await requirePracticeContext(PATHWAY_CAPABILITIES.view);
  if (isDenied(auth)) return auth;
  const { pathwayId } = await params;

  const detail = await getPatientPathway(auth.caller.admin, auth.ctx.workspaceId, pathwayId);
  // ⚠ THE THREE ANSWERS ARE KEPT APART. `pathway: null` with `unavailable: true` is a read that failed;
  // `pathway: null` with `unavailable: false` is a plan that is not there. Collapsing them into a 404
  // would tell a practitioner a patient is on no pathway because a query timed out.
  if (detail.unavailable)
    return NextResponse.json({ error: { code: "READ_FAILED", message: detail.detail ?? "the pathway could not be read" } }, { status: 503 });
  if (!detail.pathway) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...detail, correlationId: auth.caller.traceId });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ pathwayId: string }> }) {
  const auth = await requirePracticeContext(PATHWAY_CAPABILITIES.assign);
  if (isDenied(auth)) return auth;
  const { pathwayId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }

  const action = String(body.action ?? "");
  const reason = body.reason ? String(body.reason) : "";
  const common = {
    workspaceId: auth.ctx.workspaceId, patientPathwayId: pathwayId,
    actorId: auth.caller.userId, correlationId: auth.caller.traceId,
  };

  const run = async () => {
    switch (action) {
      case "complete":
        return completeStage(auth.caller.admin, {
          ...common, note: body.note ? String(body.note) : null,
          closingEncounterId: body.closingEncounterId ? String(body.closingEncounterId) : null,
        });
      case "skip": return skipStage(auth.caller.admin, { ...common, reason });
      case "repeat": return repeatStage(auth.caller.admin, { ...common, reason });
      case "cancel": return cancelStage(auth.caller.admin, { ...common, reason });
      case "delay":
        return delayStage(auth.caller.admin, {
          ...common, reason,
          days: body.days !== undefined ? Number(body.days) : undefined,
          dueOn: body.dueOn ? String(body.dueOn) : undefined,
        });
      case "stop": return stopPathway(auth.caller.admin, { ...common, reason });
      default: return null;
    }
  };

  const result = await run();
  if (!result)
    return NextResponse.json({ error: `action must be one of: ${[...PATHWAY_STAGE_ACTIONS, "stop"].join(", ")}` }, { status: 400 });
  if (!result.ok) return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return NextResponse.json({ result: result.data, correlationId: auth.caller.traceId });
}
