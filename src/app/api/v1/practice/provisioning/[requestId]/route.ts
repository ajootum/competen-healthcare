import { NextRequest, NextResponse } from "next/server";
import { getCaller, isResponse, isSuper } from "@/lib/api-auth";

// GET /api/v1/practice/provisioning/{requestId} (PROV-001 s10). Visible to the request's actor, its
// target, or a platform operator; everyone else gets the same 404 a nonexistent id gets.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const { requestId } = await params;

  const { data: reqRow } = await c.admin.from("provisioning_request")
    .select("id, status, workspace_id, error_code, request_type, actor_user_id, target_user_id, created_at, updated_at")
    .eq("id", requestId).maybeSingle();

  if (!reqRow || (reqRow.actor_user_id !== c.userId && reqRow.target_user_id !== c.userId && !isSuper(c)))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: steps } = await c.admin.from("provisioning_step")
    .select("step_code, status, attempts, error_code").eq("request_id", requestId);

  return NextResponse.json({
    requestId: reqRow.id, status: reqRow.status, workspaceId: reqRow.workspace_id,
    errorCode: reqRow.error_code, steps: steps ?? [], correlationId: c.traceId,
  });
}
