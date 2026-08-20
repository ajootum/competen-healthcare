import { createHash } from "node:crypto";
import { audit } from "./audit";
import { seedTaxonomy } from "./taxonomy";

// Competen Practice provisioning orchestrator (CPR-PROV-001 sections 3-8, 11-13).
//
// THE FIRST WRITE-PATH ON THIS PLATFORM WHOSE TENANT IS NOT A HOSPITAL. Everything here scopes to
// practice_workspace.id, and every rule this codebase learned about hospital tenancy applies with the
// noun swapped: writes carry the SUBJECT's workspace, reads are workspace-filtered, and nothing trusts a
// client-supplied workspace id without checking membership.
//
// WHY THIS IS A STEP LEDGER AND NOT A TRANSACTION. PROV-001 section 7 asks for an atomic creation
// transaction. A true multi-table transaction needs a database function, and this project's migration
// runner splits statements on semicolons -- a plpgsql body cannot survive it (the deployed language-sql
// functions all have single-statement bodies). So the orchestrator implements the OTHER half of section 7,
// the saga: every step is individually idempotent (check-then-create against unique indexes), every step's
// outcome is durable in provisioning_step, a failed run leaves the request resumable rather than
// half-invisible, and the retry endpoint re-runs only what did not complete. The harness proves the
// property that actually matters -- a repeated or concurrent request never duplicates a workspace,
// membership, entitlement or onboarding instance -- which the unique indexes from migration 191 enforce
// even if this code is wrong.
//
// Steps run in PROV-001 section 7's order. `create_location` is deliberately a placeholder-or-defer step:
// section 7 allows requiring the location during onboarding instead, and onboarding's practice_context
// step is where the real location is captured.

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ WHY `issue_identity` IS NOT IN THIS LIST, AND IS NOT A LEDGERED STEP.
 *
 * PIS-000 s15 makes a practitioner identity automatic, and migration 254 makes a booking page impossible
 * without one -- so provisioning has to create it. It is NOT a step in the ledger because it cannot be:
 * `provisioning_step.step_code` carries a CHECK constraint (migration 191) listing eight codes, none of
 * them `issue_identity`, and the ledger seed at the top of runProvisioning is an upsert whose error is
 * discarded. Adding the code here without widening that constraint would produce a step that silently
 * never records anything -- the same shape as the capability bug the comments below describe.
 *
 * So issuance runs as an unledgered tail action AFTER publish_completed, and it is soft: see
 * issuePractitionerIdentity(). Widening the constraint would let it become a proper step, and that is a
 * migration for whoever owns migrations.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
export const PROVISIONING_STEPS = [
  "create_workspace",
  "create_owner_membership",
  "assign_capabilities",
  "create_configuration",
  "create_entitlement",
  "create_onboarding",
  "publish_completed",
] as const;
export type StepCode = (typeof PROVISIONING_STEPS)[number];

export type IndividualRequest = {
  displayName: string;
  countryCode: string;
  timezone: string;
  professionCode: string;
  primarySpecialtyCode?: string;
  defaultPracticeType: "independent" | "hospital_based" | "clinic" | "outreach" | "teleconsultation" | "mixed";
  locale: string;
  termsVersion: string;
  privacyNoticeVersion: string;
  source: "public_signup" | "invitation" | "pilot" | "admin" | "migration";
};

export type ProvisionResult = {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
};

/** Stable hash so a replayed idempotency key can be checked for payload equality (PROV-001 s8). */
export const payloadHash = (p: IndividualRequest) =>
  createHash("sha256").update(JSON.stringify({
    displayName: p.displayName, countryCode: p.countryCode, timezone: p.timezone,
    professionCode: p.professionCode, primarySpecialtyCode: p.primarySpecialtyCode ?? null,
    defaultPracticeType: p.defaultPracticeType, locale: p.locale, source: p.source,
  })).digest("hex");

const REQUIRED: (keyof IndividualRequest)[] = [
  "displayName", "countryCode", "timezone", "professionCode", "defaultPracticeType",
  "locale", "termsVersion", "privacyNoticeVersion", "source",
];

export function validateIndividual(p: Partial<IndividualRequest>): string | null {
  for (const k of REQUIRED) if (!p[k] || String(p[k]).trim() === "") return `missing field: ${k}`;
  if (String(p.displayName).length > 120) return "displayName exceeds 120 characters";
  if (!/^[A-Z]{2}$/.test(String(p.countryCode))) return "countryCode must be ISO 3166-1 alpha-2";
  return null;
}

// ⚠ MOVED to ./audit and RE-EXPORTED, and THE SENTENCE THAT USED TO BE HERE HAS GONE STALE.
//
// It read: "Seventy-odd modules import audit from here and none of them needed to change; the four
// that must not reach node:crypto import ./audit directly." That was true at the moment of the move.
// The estate has since gone the other way -- NOTHING under src/ imports audit through this module any
// more, practice-bundle-harness A3 asserts exactly that, and the last straggler (the provisioning
// [requestId] route) was repointed when that assertion was found red.
//
// ⚠ SO THIS LINE NOW HAS ZERO IMPORTERS -- measured across src/ AND scripts/, not assumed. It is kept
// as a compatibility surface rather than deleted, because A3 already prevents the pattern coming back
// and removing a public export is a change nobody asked for; it is not a recommended path. New code
// imports @/lib/practice/audit.
//
// ⚠ AND A3 IS THE ONLY THING THAT WILL EVER NOTICE. Both spellings resolve to the same function, so no
// test, no type and no runtime behaviour can object to the wrong one -- which is precisely how the last
// straggler drifted back in unremarked.
export { audit };

/**
 * Is a launch flag on?
 *
 * FAILS CLOSED, BUT NEVER SILENTLY. The first version destructured only `data`, so a read that FAILED
 * was indistinguishable from a flag that was OFF -- and it resolved that ambiguity, without saying so,
 * in the direction of off. Closed is the right default for a launch ladder; being quiet about it is not,
 * because the whole product then presents its pre-launch face and every page looks like it is working.
 *
 * The same bug class as the partial-index upsert this codebase has hit twice: an error discarded at the
 * call site becomes a wrong answer somewhere far away.
 */
export async function platformFlag(admin: any | null, flag: string): Promise<boolean> {
  // ⚠ NULL IS A REAL ANSWER, NOT A MISSING ARGUMENT (COMP-ENG-002 §7). Public pages pass
  // createAdminClientOrNull(), which yields null where the environment has no privileged key -- a CI
  // runner, a contributor without a .env.local. Treating that as OFF is the same verdict this function
  // already reaches for a failed read, and for the same stated reason: a flag lookup must not take a
  // public page down. Previously the page crashed at client construction before reaching this line.
  if (!admin) {
    console.error(`[practice] no privileged client available to read launch flag "${flag}" -- treating it as OFF`);
    return false;
  }
  const { data, error } = await admin.from("practice_platform_flags")
    .select("enabled").eq("flag", flag).maybeSingle();
  if (error) {
    // Loud, and on the server where somebody is looking at a terminal. Not thrown: a flag read failing
    // must not take a public marketing page down with it.
    console.error(`[practice] could not read launch flag "${flag}" -- treating it as OFF: ${error.message}`);
    return false;
  }
  return !!data?.enabled;
}

async function markStep(admin: any, requestId: string, step: StepCode, status: "running" | "succeeded" | "failed", errorCode?: string) {
  const patch: Record<string, unknown> = { status };
  if (status === "running") patch.started_at = new Date().toISOString();
  if (status === "succeeded" || status === "failed") patch.completed_at = new Date().toISOString();
  if (errorCode) patch.error_code = errorCode;
  await admin.from("provisioning_step").update(patch).eq("request_id", requestId).eq("step_code", step);
}

/**
 * The practitioner identity (PIS-000), issued after the practice is already standing.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THIS FUNCTION CANNOT FAIL PROVISIONING, BY TWO INDEPENDENT MEASURES, AND BOTH ARE DELIBERATE.
 *
 *   ORDERING. It runs after publish_completed. By the time it is called the workspace is ONBOARDING, the
 *   request is COMPLETED and the owner can sign in and work. There is no half-created practice for a
 *   failure here to strand, because there is nothing left to create.
 *
 *   SOFT FAILURE. It returns a boolean and swallows everything -- including a thrown error, which the
 *   engine below does not throw today but might after any future edit. Provisioning is the critical path
 *   for every new practice on this platform: an identity that could not be issued must never be the
 *   reason somebody cannot sign up. The failure is logged, and recorded in the practice's own audit trail
 *   as `practice.identity_issue_deferred` so it is findable rather than merely absent.
 *
 * ⚠ SOFT IS NOT SILENT, AND IT IS NOT PERMANENT. issueIdentity() is idempotent per person -- keyed on a
 * unique user_id -- so a re-run of provisioning, or the practitioner opening Practice Setup, issues the
 * identity that this run could not. Nothing double-writes, and nothing is lost.
 *
 * ⚠ THE IMPORT IS DYNAMIC ON PURPOSE. identity-service imports audit() from this module; a static import
 * back would make the two modules a cycle, whose behaviour under the bundler is a thing to test rather
 * than a thing to rely on. Deferring it also means a module that fails to load cannot take provisioning
 * down with it, which is the same property the rest of this function is built for.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
async function issuePractitionerIdentity(admin: any, req: {
  id: string; target_user_id: string; correlation_id: string;
}, payload: IndividualRequest, workspaceId: string | null): Promise<boolean> {
  try {
    const { issueIdentity } = await import("@/lib/practice/identity-service");
    const result = await issueIdentity(admin, {
      userId: req.target_user_id,
      displayName: payload.displayName,
      workspaceId,
      correlationId: req.correlation_id,
    });
    if (result.ok) return true;
    console.error(`[practice] identity not issued for ${req.target_user_id}: ${result.code} ${result.message}`);
    await audit(admin, {
      workspaceId, actorId: req.target_user_id, eventType: "practice.identity_issue_deferred",
      payload: { requestId: req.id, errorCode: result.code, message: result.message },
      correlationId: req.correlation_id,
    });
    return false;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[practice] identity issuance threw for ${req.target_user_id}: ${message}`);
    await audit(admin, {
      workspaceId, actorId: req.target_user_id, eventType: "practice.identity_issue_deferred",
      payload: { requestId: req.id, errorCode: "THREW", message },
      correlationId: req.correlation_id,
    });
    return false;
  }
}

/**
 * Run (or resume) provisioning for an accepted request row. Every step is safe to re-run: each first
 * checks whether its resource already exists for this workspace, so a retry after a mid-flight failure
 * completes the remainder instead of duplicating the start.
 */
export async function runProvisioning(admin: any, req: {
  id: string; target_user_id: string; correlation_id: string; workspace_id: string | null;
}, payload: IndividualRequest): Promise<{
  ok: boolean; workspaceId?: string; failedStep?: StepCode; errorCode?: string;
  /**
   * The database's own sentence about what went wrong, when there is one. Null on success and on the
   * failures that are a refusal rather than an error. Declared here so a CALLER can print it: the
   * error code alone names the step, which is the one thing already obvious from the code.
   */
  detail?: string | null;
  /** Whether the practitioner identity exists after this run. False never fails the run -- see above. */
  identityIssued?: boolean;
}> {
  // Ensure the step ledger exists (idempotent on the unique (request_id, step_code) index).
  for (const step of PROVISIONING_STEPS) {
    await admin.from("provisioning_step").upsert(
      { request_id: req.id, step_code: step },
      { onConflict: "request_id,step_code", ignoreDuplicates: true },
    );
  }

  let workspaceId = req.workspace_id;

  /**
   * ⚠ THE DATABASE'S OWN SENTENCE IS CARRIED OUT, NOT DISCARDED (2026-08-17).
   *
   * Every caller of this used to hand `fail` a step and a CODE, and throw the Postgres error away at
   * the call site. So a provisioning run that died reported exactly "CAPABILITY_GRANT_FAILED" -- which
   * says which STEP broke and nothing whatever about WHY, and the step is the one thing already
   * obvious from the code name. A harness blocked by it could not be diagnosed without editing this
   * file, which is precisely what happened.
   *
   * `detail` is optional so no existing call site changes meaning; the ones that hold a real error now
   * pass it. It is recorded on the audit row too, because a failure nobody can explain a week later is
   * a failure that gets rerun rather than fixed.
   */
  const fail = async (step: StepCode, code: string, detail?: string | null) => {
    await markStep(admin, req.id, step, "failed", code);
    await admin.from("provisioning_request").update({ status: "FAILED", error_code: code, updated_at: new Date().toISOString() }).eq("id", req.id);
    await audit(admin, { workspaceId, actorId: req.target_user_id, eventType: "practice.provisioning_failed", payload: { requestId: req.id, failedStep: step, errorCode: code, detail: detail ?? null }, correlationId: req.correlation_id });
    return {
      ok: false as const, failedStep: step, errorCode: code,
      detail: detail ?? null,
      workspaceId: workspaceId ?? undefined,
    };
  };

  // 1. create_workspace
  await markStep(admin, req.id, "create_workspace", "running");
  if (!workspaceId) {
    const { data: existing } = await admin.from("practice_workspace")
      .select("id").eq("owner_person_id", req.target_user_id).eq("type", "individual_practice")
      .not("status", "in", "(CLOSED,FAILED)").maybeSingle();
    if (existing) {
      workspaceId = existing.id;
    } else {
      const { data: ws, error } = await admin.from("practice_workspace").insert({
        type: "individual_practice", name: payload.displayName, owner_person_id: req.target_user_id,
        status: "PROVISIONING", country: payload.countryCode, timezone: payload.timezone,
        default_practice_type: payload.defaultPracticeType, profession_code: payload.professionCode,
        primary_specialty_code: payload.primarySpecialtyCode ?? null, created_by: req.target_user_id,
      }).select("id").single();
      if (error) return fail("create_workspace", "WORKSPACE_CREATE_FAILED");
      workspaceId = ws.id;
      await audit(admin, { workspaceId, actorId: req.target_user_id, eventType: "practice.workspace_created", payload: { type: "individual_practice" }, correlationId: req.correlation_id });
    }
    await admin.from("provisioning_request").update({ workspace_id: workspaceId, status: "PROVISIONING", updated_at: new Date().toISOString() }).eq("id", req.id);
  }
  await markStep(admin, req.id, "create_workspace", "succeeded");

  // 2. create_owner_membership + practitioner membership (IAM-001 s10: administration and clinical
  //    capability sets are separate, so the founding practitioner gets BOTH memberships).
  await markStep(admin, req.id, "create_owner_membership", "running");
  const memberships: { role: string; id?: string }[] = [{ role: "practice_owner" }, { role: "practitioner" }];
  for (const m of memberships) {
    const { data: got } = await admin.from("practice_membership").select("id")
      .eq("workspace_id", workspaceId).eq("user_id", req.target_user_id).eq("role_code", m.role).eq("status", "active").maybeSingle();
    if (got) { m.id = got.id; continue; }
    const { data: created, error } = await admin.from("practice_membership").insert({
      workspace_id: workspaceId, user_id: req.target_user_id, role_code: m.role,
      status: "active", joined_at: new Date().toISOString(), created_by: req.target_user_id,
    }).select("id").single();
    if (error) return fail("create_owner_membership", "MEMBERSHIP_CREATE_FAILED");
    m.id = created.id;
    await audit(admin, { workspaceId, actorId: req.target_user_id, eventType: "practice.membership_created", payload: { roleCode: m.role, membershipId: created.id }, correlationId: req.correlation_id });
  }
  await markStep(admin, req.id, "create_owner_membership", "succeeded");

  // 3. assign_capabilities from the catalog, per membership role.
  //
  // CHECK-THEN-INSERT, NOT UPSERT. ux_practice_capability is a PARTIAL unique index (where effective_to
  // is null) and PostgREST cannot target a partial index with onConflict -- it fails with "there is no
  // unique or exclusion constraint matching the ON CONFLICT specification". This step used an upsert and
  // discarded the error, so it wrote NOTHING and still marked itself succeeded: every workspace
  // provisioned after migration 191 had memberships with zero capabilities, which renders an empty
  // sidebar and 403s every API call. Migration 192's backfill hid it, because that insert..select
  // granted capabilities to memberships that already existed at migration time.
  //
  // The same trap was found and fixed in the Phase-1 arrival write. Two occurrences is a pattern:
  // an upsert whose error is unchecked cannot be distinguished from one that did nothing.
  await markStep(admin, req.id, "assign_capabilities", "running");
  let granted = 0;
  for (const m of memberships) {
    const { data: caps } = await admin.from("practice_role_capabilities").select("capability_code").eq("role_code", m.role);
    for (const c of (caps ?? []) as { capability_code: string }[]) {
      const { data: held } = await admin.from("practice_role_assignment")
        .select("id").eq("membership_id", m.id).eq("capability_code", c.capability_code)
        .is("effective_to", null).maybeSingle();
      if (held) { granted++; continue; }
      const { error } = await admin.from("practice_role_assignment")
        .insert({ membership_id: m.id, capability_code: c.capability_code, source: "role_default" });
      // A duplicate here means a concurrent run won the partial index; that is success, not failure.
      if (error && !/duplicate|unique/i.test(error.message))
        return fail("assign_capabilities", "CAPABILITY_GRANT_FAILED",
          `${c.capability_code} for role ${m.role}: ${error.message}`);
      granted++;
    }
  }
  // Prove it happened. A membership with no capabilities is a workspace nobody can open, and the whole
  // point of the step is that the owner can use what was just built for them.
  if (granted === 0) return fail("assign_capabilities", "NO_CAPABILITIES_GRANTED");
  await markStep(admin, req.id, "assign_capabilities", "succeeded");

  // 4. create_configuration (one effective per workspace -- the unique index arbitrates races).
  await markStep(admin, req.id, "create_configuration", "running");
  const { data: cfg } = await admin.from("practice_configuration").select("id").eq("workspace_id", workspaceId).eq("is_effective", true).maybeSingle();
  if (!cfg) {
    const { error } = await admin.from("practice_configuration").insert({ workspace_id: workspaceId, locale: payload.locale });
    if (error && !/duplicate|unique/i.test(error.message)) return fail("create_configuration", "CONFIGURATION_CREATE_FAILED");
  }
  // ⚠ THE BOOKING TAXONOMY IS SEEDED HERE, NOT ONLY IN MIGRATION 292. That migration filled every
  // workspace that existed when it ran and nothing since -- so without this a practice provisioned
  // tomorrow comes up with two empty dropdowns and cannot take a booking at all. Exactly the failure
  // the booking fallback contact hit after migration 291, caught only because a harness created a
  // workspace minutes later.
  //
  // ⚠ AND IT DOES NOT FAIL PROVISIONING. A practice with no taxonomy is recoverable in one click from
  // Practice Setup; a provisioning run that halted here would leave a half-built practice behind for a
  // fault the owner can fix. The failure is recorded on the step rather than swallowed.
  // ⚠ workspaceId IS `string | null` HERE. Every Supabase call above takes it untyped and would have
  // written `workspace_id: null` without complaint; this is the first typed consumer, and it refuses.
  // A null workspace at this point means the create step did not produce one, which is a failure worth
  // stopping for rather than seeding into nothing.
  if (!workspaceId) return fail("create_configuration", "WORKSPACE_ID_MISSING");
  const seeded = await seedTaxonomy(admin, workspaceId);
  // The step still SUCCEEDS -- the configuration was created -- but it carries the code, so a failure
  // here is findable afterwards rather than surfacing weeks later as an empty dropdown.
  await markStep(admin, req.id, "create_configuration", "succeeded",
    seeded.ok ? undefined : "TAXONOMY_SEED_FAILED");
  if (!seeded.ok) console.error(`[practice] taxonomy seed failed for ${workspaceId}: ${seeded.detail}`);

  // 5. create_entitlement (trial by default; PROV-001 s11.2 ENTITLEMENT_UNAVAILABLE if the plan is off).
  await markStep(admin, req.id, "create_entitlement", "running");
  const { data: ent } = await admin.from("practice_entitlement").select("id").eq("workspace_id", workspaceId).in("status", ["active", "trial"]).maybeSingle();
  if (!ent) {
    const { data: plan } = await admin.from("practice_plans").select("plan_code,trial_days").eq("plan_code", "practice_trial").eq("active", true).maybeSingle();
    if (!plan) return fail("create_entitlement", "ENTITLEMENT_UNAVAILABLE");
    const ends = plan.trial_days ? new Date(Date.now() + plan.trial_days * 86400000).toISOString() : null;
    const { error } = await admin.from("practice_entitlement").insert({
      workspace_id: workspaceId, product_code: "practice", plan_code: plan.plan_code, status: "trial", ends_at: ends,
    });
    if (error) return fail("create_entitlement", "ENTITLEMENT_CREATE_FAILED");
    await audit(admin, { workspaceId, actorId: req.target_user_id, eventType: "practice.entitlement_created", payload: { planCode: plan.plan_code, status: "trial" }, correlationId: req.correlation_id });
  }
  await markStep(admin, req.id, "create_entitlement", "succeeded");

  // 6. create_onboarding (one active instance -- unique index again).
  await markStep(admin, req.id, "create_onboarding", "running");
  const { data: ob } = await admin.from("practice_onboarding").select("id").eq("workspace_id", workspaceId).eq("user_id", req.target_user_id).eq("state", "in_progress").maybeSingle();
  if (!ob) {
    const { error } = await admin.from("practice_onboarding").insert({ workspace_id: workspaceId, user_id: req.target_user_id });
    if (error && !/duplicate|unique/i.test(error.message)) return fail("create_onboarding", "ONBOARDING_CREATE_FAILED");
    await audit(admin, { workspaceId, actorId: req.target_user_id, eventType: "practice.onboarding_started", payload: { currentStep: "professional_profile" }, correlationId: req.correlation_id });
  }
  await markStep(admin, req.id, "create_onboarding", "succeeded");

  // 7. publish_completed: workspace moves to ONBOARDING, request to COMPLETED.
  await markStep(admin, req.id, "publish_completed", "running");
  await admin.from("practice_workspace").update({ status: "ONBOARDING", updated_at: new Date().toISOString() }).eq("id", workspaceId).eq("status", "PROVISIONING");
  await admin.from("provisioning_request").update({ status: "COMPLETED", updated_at: new Date().toISOString() }).eq("id", req.id);
  await audit(admin, { workspaceId, actorId: req.target_user_id, eventType: "practice.provisioning_completed", payload: { requestId: req.id, nextAction: "resume_onboarding" }, correlationId: req.correlation_id });
  await markStep(admin, req.id, "publish_completed", "succeeded");

  // 8. The practitioner identity -- last, unledgered, and unable to fail this run. See the function.
  const identityIssued = await issuePractitionerIdentity(admin, req, payload, workspaceId);

  return { ok: true, workspaceId: workspaceId ?? undefined, identityIssued };
}
