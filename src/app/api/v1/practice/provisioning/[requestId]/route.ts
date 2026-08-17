import { NextRequest, NextResponse } from "next/server";
import { getCaller, isResponse } from "@/lib/api-auth";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";

// GET /api/v1/practice/provisioning/{requestId} (PROV-001 s10). Visible to the request's actor, its
// target, or a platform operator; everyone else gets the same 404 a nonexistent id gets.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const { requestId } = await params;

  const { data: reqRow } = await c.admin.from("provisioning_request")
    .select("id, status, workspace_id, error_code, request_type, actor_user_id, target_user_id, created_at, updated_at")
    .eq("id", requestId).maybeSingle();

  /**
   * ⚠ THE OPERATOR ARM IS A CAPABILITY NOW, NOT OWNERSHIP (CPR-PD-014 build 2, 2026-08-17).
   *
   * The third arm read `!isSuper(c)`, so the Practice Product Director -- whose job includes chasing a
   * provisioning run that stalled -- was told this request does not exist. PD-014: "Do not equate
   * Product Director with Super Admin." An owner still passes, through resolveHqContexts owner
   * short-circuit inside the gate.
   *
   * ⚠ ASKED ONLY WHEN IT CAN CHANGE THE ANSWER. The gate resolves offices, appointments and grants; a
   * caller who is the actor or the target has already earned the row and must not pay for that.
   *
   * ⚠ AND THE REFUSAL IS STILL 404, NOT 403. PROV-001 s10 gives a stranger the same answer a
   * nonexistent id gives, so that this endpoint cannot be used to discover which request ids are real.
   * hqApiGate's own 403 body is therefore DISCARDED rather than returned -- it is being used here as a
   * predicate, and letting its response through would leak exactly what the 404 exists to hide.
   */
  const isParty = !!reqRow
    && (reqRow.actor_user_id === c.userId || reqRow.target_user_id === c.userId);
  const isOperator = !reqRow || isParty
    ? false
    : !isHqRefusal(await hqApiGate(["hq.practice.provision.execute"]));

  if (!reqRow || (!isParty && !isOperator))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: steps } = await c.admin.from("provisioning_step")
    .select("step_code, status, attempts, error_code").eq("request_id", requestId);

  return NextResponse.json({
    requestId: reqRow.id, status: reqRow.status, workspaceId: reqRow.workspace_id,
    errorCode: reqRow.error_code, steps: steps ?? [], correlationId: c.traceId,
  });
}
