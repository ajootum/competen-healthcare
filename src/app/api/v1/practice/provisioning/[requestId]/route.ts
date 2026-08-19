import { NextRequest, NextResponse } from "next/server";
import { getCaller, isResponse } from "@/lib/api-auth";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import { runProvisioning, audit, type IndividualRequest } from "@/lib/practice/provisioning";

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

/**
 * POST /api/v1/practice/provisioning/{requestId} — the authorised retry (CPR-PD-014 §8.3).
 *
 * ⚠ THIS IS THE ENDPOINT WHOSE ABSENCE THE PRODUCT OPERATIONS SCREENS HAVE BEEN STATING IN WORDS.
 * Until now the only way to resume a failed run was to hand-craft an HTTP POST with an Idempotency-Key
 * header, so both screens said so rather than offering a button that called nothing. §12 puts it as a
 * precondition: "Retry is real and idempotent before any retry UI is enabled."
 *
 * ⚠ CAPABILITY, NOT ROLE, AND ENFORCED HERE RATHER THAN IN THE UI. §9: "Client-side hiding is not
 * authorisation; enforce capability at server/action/API boundary." Unlike the GET above — where the
 * gate is a predicate and a refusal must fall through to 404 so request ids cannot be probed — a retry
 * is a MUTATION, and a caller without the capability is told 403 plainly. There is nothing to hide: they
 * already knew the id, because they had to send it.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const { requestId } = await params;

  const gate = await hqApiGate(["hq.practice.provision.execute"]);
  if (isHqRefusal(gate)) return gate;

  const { data: reqRow } = await c.admin.from("provisioning_request")
    .select("id, status, workspace_id, target_user_id, correlation_id, payload")
    .eq("id", requestId).maybeSingle();
  if (!reqRow) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (String(reqRow.status).toUpperCase() === "COMPLETED") {
    return NextResponse.json(
      { error: "This run already completed. There is nothing to resume.", status: reqRow.status },
      { status: 409 });
  }

  /**
   * ⚠ A RUN WITHOUT ITS PAYLOAD IS REFUSED, NOT RECONSTRUCTED. Requests created before migration 341
   * stored only a payload hash. The engine needs the locale for create_configuration and the display
   * name for identity issuance, and neither is recoverable when create_configuration is the step that
   * failed — which is one of the likelier failures. §13: report the dependency rather than invent
   * behaviour. Guessing here would look like a successful recovery and quietly write a value nobody
   * chose.
   */
  const payload = reqRow.payload as IndividualRequest | null;
  if (!payload) {
    return NextResponse.json({
      error: "This request predates payload capture, so it cannot be resumed faithfully. "
        + "Provision a new request instead, or complete the remaining steps deliberately.",
      requestId, status: reqRow.status,
    }, { status: 409 });
  }

  /**
   * ⚠ A CONDITIONAL UPDATE IS THE CONCURRENCY GUARD, AND IT IS WHY A DOUBLE CLICK IS SAFE. §7.4 asks
   * that provisioning double-submit be idempotent and that a failed retry cannot duplicate
   * already-created resources. The saga's own steps re-check each resource before creating it, which
   * handles a SEQUENTIAL re-run; two SIMULTANEOUS retries could still interleave between a step's check
   * and its insert. Claiming the row by moving it to PROVISIONING only if it is not already there means
   * the second caller matches no row and is refused, without a lock table.
   */
  const { data: claimed } = await c.admin.from("provisioning_request")
    .update({ status: "PROVISIONING", updated_at: new Date().toISOString() })
    .eq("id", requestId).neq("status", "PROVISIONING")
    .select("id");
  if (!claimed || claimed.length === 0) {
    return NextResponse.json(
      { error: "A retry of this request is already running.", requestId, status: "PROVISIONING" },
      { status: 409 });
  }

  // Recorded BEFORE the run, so an attempt that dies mid-flight still leaves a trace of who started it.
  await audit(c.admin, {
    workspaceId: reqRow.workspace_id, actorId: c.userId,
    eventType: "practice.provisioning_retry_started",
    payload: { requestId, previousStatus: reqRow.status },
    correlationId: reqRow.correlation_id ?? undefined,
  });

  const run = await runProvisioning(c.admin, {
    id: reqRow.id,
    target_user_id: reqRow.target_user_id,
    correlation_id: reqRow.correlation_id ?? `retry-${requestId}`,
    // The workspace the original run created, so the engine continues that one rather than starting a
    // second. Passing null here would be the duplication §7.4 forbids.
    workspace_id: reqRow.workspace_id,
  }, payload);

  await audit(c.admin, {
    workspaceId: run.workspaceId ?? reqRow.workspace_id, actorId: c.userId,
    eventType: run.ok ? "practice.provisioning_retry_succeeded" : "practice.provisioning_retry_failed",
    payload: { requestId, failedStep: run.failedStep ?? null, errorCode: run.errorCode ?? null },
    correlationId: reqRow.correlation_id ?? undefined,
  });

  // §7.4: "The UI confirms the post-mutation state from a fresh read rather than assuming success."
  // The endpoint does the same — the status returned is read back, not inferred from run.ok.
  const { data: after } = await c.admin.from("provisioning_request")
    .select("status, workspace_id, error_code, updated_at").eq("id", requestId).maybeSingle();
  const { data: steps } = await c.admin.from("provisioning_step")
    .select("step_code, status, attempts, error_code").eq("request_id", requestId);

  return NextResponse.json({
    requestId,
    ok: run.ok,
    status: after?.status ?? null,
    workspaceId: after?.workspace_id ?? null,
    failedStep: run.failedStep ?? null,
    errorCode: run.errorCode ?? after?.error_code ?? null,
    detail: run.detail ?? null,
    steps: steps ?? [],
  }, { status: run.ok ? 200 : 502 });
}
