import { NextRequest, NextResponse } from "next/server";
import { getCaller, isResponse, isSuper } from "@/lib/api-auth";
import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
import {
  validateIndividual, payloadHash, runProvisioning, platformFlag, type IndividualRequest,
} from "@/lib/practice/provisioning";
import { audit } from "@/lib/practice/audit";
import { validateAccessPeriod } from "@/lib/practice/entitlement-period";

// POST /api/v1/practice/provisioning/individual (CPR-PROV-001 s10/s11, CPR-IAM-001 s8).
//
// WHO MAY PROVISION, under the IAM-001 s14.1 launch ladder as seeded by migration 191:
//   - practice_public_signup ON  -> any authenticated user may provision FOR THEMSELVES.
//   - practice_pilot_provisioning ON -> a super_admin may provision for a named target user
//     (PROV-001 s4 "Platform-assisted pilot"). This is the only path open in the development posture,
//     which is what keeps the public "not open yet" claim true while the flow is exercised end to end.
//
// Idempotency per PROV-001 s8: the Idempotency-Key header is REQUIRED; a repeated key with the same
// payload returns the ORIGINAL result (created: false); the same key with a different payload is a 409
// IDEMPOTENCY_CONFLICT. The unique index on provisioning_request.idempotency_key arbitrates the race --
// two concurrent first requests cannot both insert, and the loser re-reads the winner's row.

const err = (status: number, code: string, message: string, correlationId: string) =>
  NextResponse.json({ error: { code, message, correlationId } }, { status });

export async function POST(req: NextRequest) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const correlationId = c.traceId;

  const idempotencyKey = req.headers.get("Idempotency-Key");
  if (!idempotencyKey) return err(400, "VALIDATION_ERROR", "Idempotency-Key header is required", correlationId);

  let body: Partial<IndividualRequest> & { targetUserId?: string };
  try { body = await req.json(); } catch { return err(400, "VALIDATION_ERROR", "invalid JSON body", correlationId); }

  const invalid = validateIndividual(body);
  if (invalid) return err(400, "VALIDATION_ERROR", invalid, correlationId);
  const payload = body as IndividualRequest;

  // ── CPR-PD-PROV-001 §4 step 2 / AC-04 ────────────────────────────────────────────────────────────
  //
  // ⚠ THE CHOSEN ACCESS PERIOD IS STRIPPED FIRST AND ONLY GIVEN BACK ON THE GATED PATH BELOW. Left on
  // the payload unconditionally, this field would let ANY authenticated user on the open self-serve
  // route post themselves a ten-year `active` period -- the launch flags decide who may create a
  // practice, and nothing else would have decided how long they get to keep it. It is reinstated after
  // the capability gate, which is the only place a caller has been shown to be a Product Director.
  const requestedAccess = payload.access ?? null;
  delete payload.access;

  // Eligibility under the launch flags.
  const targetUserId = body.targetUserId && body.targetUserId !== c.userId ? body.targetUserId : c.userId;
  if (targetUserId !== c.userId) {
  // !!CPR-PD-014 build 2: THE CAPABILITY, NOT OWNERSHIP.
  //
  // This read an ownership test on the caller, which broke in both directions. A real Practice Product
  // Director -- the position this endpoint exists to serve -- was refused, because the check asked
  // whether they OWNED the platform rather than whether they held the right. And any super_admin
  // invoked it holding no HQ position at all, so the HQ plane recorded nothing and governed nothing.
  // PD-014 says it plainly: "Do not equate Product Director with Super Admin."
  //
  // !!hqApiGate, NOT requireHqCapability: this is a fetch, and a redirect is not a status a caller can
  // act on. resolveHqContext keeps the owner short-circuit, so an owner is unaffected by this change.
  const gate = await hqApiGate(["hq.practice.provision.execute"]);
  if (isHqRefusal(gate)) return gate;
    if (!(await platformFlag(c.admin, "practice_pilot_provisioning")))
      return err(403, "ACCESS_DENIED", "pilot provisioning is disabled", correlationId);

    // Past the capability gate: this caller may determine the period, which was the owner's decision.
    if (requestedAccess) {
      // ⚠ REFUSED BEFORE ANYTHING IS WRITTEN. §15: a failure must not "leave an apparently complete
      // usable Practice". runProvisioning re-checks this as the server-authoritative backstop, but by
      // then a workspace, two memberships and a configuration exist -- so an unusable interval is caught
      // here, where the cost of being wrong is a 422 and nothing else.
      const refusal = validateAccessPeriod({
        status: String(requestedAccess.basis), startsAt: String(requestedAccess.startsAt),
        endsAt: requestedAccess.endsAt === null ? null : String(requestedAccess.endsAt),
      });
      if (refusal) return err(refusal.status, refusal.code, refusal.message, correlationId);
      payload.access = {
        planCode: String(requestedAccess.planCode),
        basis: requestedAccess.basis,
        startsAt: String(requestedAccess.startsAt),
        endsAt: requestedAccess.endsAt === null ? null : String(requestedAccess.endsAt),
      };
    }
  } else {
    const selfAllowed = (await platformFlag(c.admin, "practice_public_signup"))
      || (isSuper(c) && (await platformFlag(c.admin, "practice_pilot_provisioning")));
    if (!selfAllowed) return err(403, "ACCESS_DENIED", "Practice signup is not open", correlationId);
  }

  const hash = payloadHash(payload);

  // Idempotency: try to claim the key; on conflict, read the original and compare payloads.
  const { data: created, error: insErr } = await c.admin.from("provisioning_request").insert({
    idempotency_key: idempotencyKey, request_type: payload.source === "pilot" ? "pilot" : "individual",
    actor_user_id: c.userId, target_user_id: targetUserId, payload_hash: hash, correlation_id: correlationId,
    // CPR-PD-014 section 8.3: the payload is STORED, not only hashed, so an authorised retry can resume
    // this run faithfully. A hash proves two requests were the same and cannot rebuild either.
    payload,
  }).select("id, status, workspace_id").single();

  let request = created;
  let isReplay = false;
  if (insErr) {
    if (!/duplicate|unique/i.test(insErr.message)) return err(500, "PROVISIONING_FAILED", "could not record the request", correlationId);
    const { data: original } = await c.admin.from("provisioning_request")
      .select("id, status, workspace_id, payload_hash, correlation_id").eq("idempotency_key", idempotencyKey).single();
    if (!original) return err(500, "PROVISIONING_FAILED", "idempotency record unavailable", correlationId);
    if (original.payload_hash !== hash)
      return err(409, "IDEMPOTENCY_CONFLICT", "this Idempotency-Key was used for a different request", correlationId);
    if (["PROVISIONING", "REQUESTED"].includes(original.status))
      return NextResponse.json({ requestId: original.id, workspaceId: original.workspace_id, status: original.status, nextAction: "await_processing", created: false, correlationId }, { status: 202 });
    request = original;
    isReplay = true;
  }

  // Duplicate-practice policy (PROV-001 s8): one default individual Practice per person.
  if (!isReplay) {
    const { data: existing } = await c.admin.from("practice_workspace")
      .select("id, status").eq("owner_person_id", targetUserId).eq("type", "individual_practice")
      .not("status", "in", "(CLOSED,FAILED)").maybeSingle();
    if (existing) {
      await c.admin.from("provisioning_request").update({ status: "COMPLETED", workspace_id: existing.id, error_code: "PRACTICE_ALREADY_EXISTS", updated_at: new Date().toISOString() }).eq("id", request!.id);
      return NextResponse.json({
        error: { code: "PRACTICE_ALREADY_EXISTS", message: "an individual Practice already exists for this user", correlationId },
        requestId: request!.id, workspaceId: existing.id, created: false,
        nextAction: existing.status === "ONBOARDING" ? "resume_onboarding" : "open_workspace",
        nextUrl: existing.status === "ONBOARDING" ? "/practice/onboarding" : "/practice/home",
      }, { status: 409 });
    }
    await audit(c.admin, { actorId: c.userId, eventType: "practice.provisioning_requested", payload: { requestId: request!.id, targetUserId, mode: payload.source }, correlationId });
  }

  if (isReplay && request!.status === "COMPLETED" && request!.workspace_id) {
    // PROV-001 s8: the original result, not a re-run.
    const { data: ws } = await c.admin.from("practice_workspace").select("status").eq("id", request!.workspace_id).single();
    return NextResponse.json({
      requestId: request!.id, workspaceId: request!.workspace_id, status: ws?.status ?? "ONBOARDING",
      nextAction: ws?.status === "ACTIVE" ? "open_workspace" : "resume_onboarding",
      nextUrl: ws?.status === "ACTIVE" ? "/practice/home" : "/practice/onboarding",
      created: false, correlationId,
    });
  }

  const run = await runProvisioning(c.admin, {
    id: request!.id, target_user_id: targetUserId, correlation_id: correlationId, workspace_id: request!.workspace_id ?? null,
  }, payload);

  if (!run.ok) return err(502, run.errorCode ?? "PROVISIONING_FAILED", `provisioning failed at ${run.failedStep}; the request is resumable`, correlationId);

  return NextResponse.json({
    requestId: request!.id, workspaceId: run.workspaceId, status: "ONBOARDING",
    nextAction: "resume_onboarding", nextUrl: "/practice/onboarding", created: !isReplay, correlationId,
  }, { status: 201 });
}
