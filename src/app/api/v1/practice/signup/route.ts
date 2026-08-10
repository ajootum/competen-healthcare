import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import {
  validateIndividual, payloadHash, runProvisioning, platformFlag, type IndividualRequest,
} from "@/lib/practice/provisioning";
import { audit } from "@/lib/practice/audit";
import { isPracticeType, isProfession, LEGAL_VERSIONS } from "@/lib/practice/catalogs";
import { practiceIdentityProfile } from "@/lib/platform-membership";

// POST /api/v1/practice/signup -- CPR-IAM-001 s8, the minimum-friction individual practitioner flow.
//
// s8 is an ordered list and this route is its first four steps; runProvisioning is steps 5 to 10, and the
// onboarding wizard is 11. Written out, because the ordering carries the safety:
//
//   1. Collect name, email, country, profession, password and legal acceptance.
//   2. CHECK FOR AN EXISTING COMPETEN IDENTITY AND OFFER SECURE SIGN-IN rather than duplicate
//      registration. Two ways that check happens here: an active session (you are already someone, so
//      this is not a registration) and an email that already has an account.
//   3. Create the pending identity.
//   4. VERIFY EMAIL. PROV-001 s10 says the provisioning endpoint creates a Practice "for a VERIFIED
//      user", so provisioning runs only once a session exists. With email confirmation enabled, signUp
//      returns no session and the caller is told to verify -- their Practice is created when they come
//      back through sign-in, not now.
//
// ENUMERATION. Telling a stranger "that email already has an account" discloses membership of the
// platform. It is disclosed deliberately: the alternative is a person who cannot sign up, cannot tell
// why, and has no path forward, and IAM-001 s8 explicitly asks to "offer secure sign-in rather than
// duplicate registration". The response gives no name, role or workspace -- only that signing in is the
// way through.
//
// EVERY WRITE IS BEHIND practice_public_signup. The flag is the launch ladder's controlled-launch rung;
// with it off this route refuses before creating anything, so the page and the API cannot disagree.

const err = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error: { code, message }, ...extra }, { status });

export async function POST(req: NextRequest) {
  const traceId = (await headers()).get("x-trace-id") ?? crypto.randomUUID();
  const admin = createAdminClient();

  if (!(await platformFlag(admin, "practice_public_signup")))
    return err(403, "SIGNUP_CLOSED", "Competen Practice signup is not open yet.");

  const supabase = await createClient();
  const { data: { user: current } } = await supabase.auth.getUser();
  if (current)
    return err(409, "ALREADY_AUTHENTICATED",
      "You are already signed in. Continue to your practice, or sign out to create a different account.",
      { nextUrl: "/practice/home" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return err(400, "VALIDATION_ERROR", "invalid JSON body"); }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const fullName = String(body.fullName ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err(400, "VALIDATION_ERROR", "a valid email address is required");
  if (password.length < 8) return err(400, "VALIDATION_ERROR", "the password must be at least 8 characters");
  if (!fullName) return err(400, "VALIDATION_ERROR", "your name is required");
  if (body.acceptedTerms !== true)
    return err(400, "VALIDATION_ERROR", "the terms and privacy notice must be accepted");

  const professionCode = String(body.professionCode ?? "");
  const defaultPracticeType = String(body.defaultPracticeType ?? "");
  if (!isProfession(professionCode)) return err(400, "VALIDATION_ERROR", "choose your profession");
  if (!isPracticeType(defaultPracticeType)) return err(400, "VALIDATION_ERROR", "choose how you practise");

  const payload: IndividualRequest = {
    displayName: String(body.displayName ?? "").trim(),
    countryCode: String(body.countryCode ?? "").trim().toUpperCase(),
    timezone: String(body.timezone ?? "").trim(),
    professionCode,
    primarySpecialtyCode: body.primarySpecialtyCode ? String(body.primarySpecialtyCode) : undefined,
    defaultPracticeType: defaultPracticeType as IndividualRequest["defaultPracticeType"],
    locale: String(body.locale ?? "en").trim(),
    // Recorded server-side. A client that could name its own accepted version could claim to have
    // accepted a document that was never shown.
    termsVersion: LEGAL_VERSIONS.terms,
    privacyNoticeVersion: LEGAL_VERSIONS.privacy,
    source: "public_signup",
  };
  const invalid = validateIndividual(payload);
  if (invalid) return err(400, "VALIDATION_ERROR", invalid);

  // s8 step 2: an existing identity is offered sign-in, never a second account.
  const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing)
    return err(409, "IDENTITY_EXISTS",
      "An account already exists for that email. Sign in and your practice will be set up from there.",
      { nextUrl: `/practice/sign-in?return_to=${encodeURIComponent("/practice/home")}` });

  // s8 step 3: create the pending identity on the CALLER's client, so a returned session is the new
  // user's own and lands in their cookies. That is a session hijack only when somebody was already
  // signed in, which the guard above has already refused.
  //
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  // !! NO ESTATE ROLE IS NAMED HERE. THIS IS CP-SPLIT-002 STAGE 2 AND IT IS TWO WORDS LONG.
  //
  // This call used to pass `role: "nurse"` in the metadata and the upsert below used to write it again
  // into profiles. COMP-ARCH-PSA-001 s11 lists exactly that under "The following MUST NOT occur":
  // "Create Competen Platform User, Assign Platform Nurse, Provision Platform Membership". s5 states
  // the general rule -- no product may create or infer membership or roles inside another product.
  //
  // It was not carelessness. profiles.role was NOT NULL with a CHECK admitting only estate roles, so
  // this route had to write SOMETHING, and 'nurse' was the least-privileged thing it could write.
  // Migration 279 removed that constraint, so there is now a correct value: none.
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email, password, options: { data: { full_name: fullName } },
  });
  if (signUpError) return err(400, "SIGNUP_FAILED", signUpError.message);
  const userId = signUpData.user?.id;
  if (!userId) return err(502, "SIGNUP_FAILED", "the account could not be created");

  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  // WHAT profiles.role HOLDS FOR A PERSON WHO REGISTERED HERE: NULL. AND WHY THE ROW STILL EXISTS.
  //
  // s3: "IDENTITY != PRODUCT MEMBERSHIP != PRODUCT ROLE". The profiles row is the IDENTITY -- name,
  // email, the thing every foreign key on this database points at -- and this person genuinely has one.
  // What they do not have is a place on the estate, and null is how that is now written down.
  // highestRole() returns null for it, hasEstateRole() is false, and admitToEstate() refuses them from
  // all eleven estate layouts because migration 279's backfill predicate skips a roleless row and
  // nothing here creates a platform_membership.
  //
  // !! THE ROLE IS WRITTEN EXPLICITLY AS null RATHER THAN OMITTED, BECAUSE THE DATABASE ALREADY PUT
  // 'nurse' THERE. public.handle_new_user() fires on the auth.users insert above and writes a profiles
  // row with role = 'nurse' -- see migration 249 section 1, where the default is deliberate and must
  // stay for the estate's own signup. Omitting the key would leave that 'nurse' standing. This upsert
  // is the correction, and it has to name the column to make it.
  //
  // !! THE ERROR IS NOT DISCARDED. It used to be. An upsert whose failure is thrown away is how this
  // codebase has already shipped two silent write failures, and the failure here is worse than most:
  // it would leave a Practice registrant carrying a nurse badge on the identity table. Refusing is
  // safe -- the person's estate access does NOT depend on this write. platform_membership is what
  // admitToEstate reads, no row was created for them, and none will be. So even in the failure branch
  // the gate holds. The refusal is about not storing a false fact, not about access.
  //
  // NOTHING HERE WRITES platform_membership. That is the point of the stage, and the harness asserts
  // the absence with a control proving the same query sees a row when one exists.
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  const { error: profileError } = await admin.from("profiles").upsert(
    practiceIdentityProfile(userId, fullName, email), { onConflict: "id" },
  );
  if (profileError) {
    await audit(admin, {
      actorId: userId, eventType: "practice.signup_platform_role_not_cleared",
      payload: { email, message: profileError.message }, correlationId: traceId,
    });
    return err(502, "SIGNUP_FAILED",
      "Your account was created but its profile could not be completed. Sign in and it will resume.",
      { nextUrl: `/practice/sign-in?return_to=${encodeURIComponent("/practice/home")}` });
  }

  // s8 step 4: no session means verification is required. The Practice is NOT provisioned yet -- PROV-001
  // s10 provisions for a verified user, and provisioning now would create a workspace nobody can open.
  if (!signUpData.session) {
    await audit(admin, {
      actorId: userId, eventType: "practice.signup_awaiting_verification",
      payload: { email }, correlationId: traceId,
    });
    return NextResponse.json({
      status: "IDENTITY_PENDING", nextAction: "verify_identity",
      nextUrl: `/practice/sign-in?return_to=${encodeURIComponent("/practice/home")}`,
      message: "Check your email to confirm your address, then sign in. Your practice is set up on your first sign-in.",
      correlationId: traceId,
    }, { status: 202 });
  }

  // Steps 5-10, the machinery that has been live and harness-proven since Phase 0.
  const idempotencyKey = `signup-${userId}`;
  const { data: created, error: insErr } = await admin.from("provisioning_request").insert({
    idempotency_key: idempotencyKey, request_type: "individual",
    actor_user_id: userId, target_user_id: userId, payload_hash: payloadHash(payload), correlation_id: traceId,
  }).select("id, status, workspace_id").single();

  let request = created;
  if (insErr) {
    // The key is derived from the user id, so a retry of the same person's signup replays rather than
    // duplicating -- PROV-001 s8's "safe to retry" without asking the browser to hold a key.
    const { data: original } = await admin.from("provisioning_request")
      .select("id, status, workspace_id").eq("idempotency_key", idempotencyKey).maybeSingle();
    if (!original) return err(500, "PROVISIONING_FAILED", "the request could not be recorded");
    request = original;
  }

  const run = await runProvisioning(admin, {
    id: request!.id, target_user_id: userId, correlation_id: traceId, workspace_id: request!.workspace_id ?? null,
  }, payload);
  if (!run.ok)
    return err(502, run.errorCode ?? "PROVISIONING_FAILED",
      "Your account was created but the practice setup did not finish. Sign in and it will resume.",
      { nextUrl: "/practice/sign-in", requestId: request!.id });

  await audit(admin, {
    workspaceId: run.workspaceId, actorId: userId, eventType: "practice.signup_completed",
    payload: { requestId: request!.id, source: "public_signup" }, correlationId: traceId,
  });

  return NextResponse.json({
    requestId: request!.id, workspaceId: run.workspaceId, status: "ONBOARDING",
    nextAction: "resume_onboarding", nextUrl: "/practice/onboarding", created: true, correlationId: traceId,
  }, { status: 201 });
}
