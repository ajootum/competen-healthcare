import { createHash } from "node:crypto";

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

/**
 * One row in the workspace's audit trail -- CPR-CORE-001 s13's "all state-changing actions require actor,
 * timestamp, source and audit entry", and s16's "all state changes are auditable".
 *
 * ⚠ THE INSERT'S ERROR IS NOT DISCARDED, and this is the table where discarding it costs most: a trail
 * with a hole in it is indistinguishable from a trail of a quiet afternoon, so nobody ever finds out.
 * It is not THROWN either -- an audit write that failed must not unwind a consultation that succeeded --
 * so the failure goes to the server log where somebody is watching, and comes back as `false`. A caller
 * that wants to claim "recorded" can check instead of assuming; the hundred that ignore it behave exactly
 * as they did.
 *
 * `source` is s13's fourth element. The column defaults to 'api' because that is what nearly every write
 * is, and it is OMITTED rather than sent as null when the caller does not know -- an explicit null would
 * be refused by a NOT NULL column that would otherwise have supplied its own default. A cron, an
 * integration or a harness says which surface it is, because the database cannot know.
 */
export async function audit(admin: any, event: {
  workspaceId?: string | null; actorId?: string | null; eventType: string;
  payload?: Record<string, unknown>; correlationId?: string; source?: string;
}): Promise<boolean> {
  const row: Record<string, unknown> = {
    workspace_id: event.workspaceId ?? null,
    actor_id: event.actorId ?? null,
    event_type: event.eventType,
    payload: event.payload ?? {},
    correlation_id: event.correlationId ?? null,
  };
  if (event.source) row.source = event.source;

  const { error } = await admin.from("practice_audit_event").insert(row);
  if (error) {
    console.error(`[practice] audit "${event.eventType}" was NOT recorded: ${error.message}`);
    return false;
  }
  return true;
}

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
export async function platformFlag(admin: any, flag: string): Promise<boolean> {
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
 * Run (or resume) provisioning for an accepted request row. Every step is safe to re-run: each first
 * checks whether its resource already exists for this workspace, so a retry after a mid-flight failure
 * completes the remainder instead of duplicating the start.
 */
export async function runProvisioning(admin: any, req: {
  id: string; target_user_id: string; correlation_id: string; workspace_id: string | null;
}, payload: IndividualRequest): Promise<{ ok: boolean; workspaceId?: string; failedStep?: StepCode; errorCode?: string }> {
  // Ensure the step ledger exists (idempotent on the unique (request_id, step_code) index).
  for (const step of PROVISIONING_STEPS) {
    await admin.from("provisioning_step").upsert(
      { request_id: req.id, step_code: step },
      { onConflict: "request_id,step_code", ignoreDuplicates: true },
    );
  }

  let workspaceId = req.workspace_id;

  const fail = async (step: StepCode, code: string) => {
    await markStep(admin, req.id, step, "failed", code);
    await admin.from("provisioning_request").update({ status: "FAILED", error_code: code, updated_at: new Date().toISOString() }).eq("id", req.id);
    await audit(admin, { workspaceId, actorId: req.target_user_id, eventType: "practice.provisioning_failed", payload: { requestId: req.id, failedStep: step, errorCode: code }, correlationId: req.correlation_id });
    return { ok: false as const, failedStep: step, errorCode: code, workspaceId: workspaceId ?? undefined };
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
      if (error && !/duplicate|unique/i.test(error.message)) return fail("assign_capabilities", "CAPABILITY_GRANT_FAILED");
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
  await markStep(admin, req.id, "create_configuration", "succeeded");

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

  return { ok: true, workspaceId: workspaceId ?? undefined };
}
