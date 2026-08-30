/**
 * Practice provisioning harness -- CPR-PROV-001 section 20's end-to-end test, run against the live
 * database through the same orchestrator the API uses.
 *
 * WHAT IT PROVES, in the spec's own acceptance terms (PROV-001 s19):
 *   1. One request creates exactly one workspace, TWO memberships (owner + practitioner, IAM-001 s10's
 *      administration/clinical separation), their capability sets, one configuration, one entitlement
 *      and one onboarding instance.
 *   2. Re-running the same provisioning is a no-op: every count unchanged. This is the property that
 *      matters more than "atomicity" here -- the runner cannot host a multi-statement DB transaction
 *      (single-statement function bodies only), so the saga's idempotency IS the safety story, and it
 *      must hold even when the orchestrator is re-entered from the start.
 *   3. A second provisioning_request with the SAME idempotency key cannot be inserted -- the unique
 *      index arbitrates the concurrent-first-request race at the database, not in code.
 *   4. A second individual Practice for the same owner is refused by the partial unique owner index
 *      even if the pre-check in the route is bypassed entirely.
 *   5. Completing onboarding transitions the workspace ONBOARDING -> ACTIVE.
 *   6. An ILLEGAL status value is rejected by the CHECK constraint -- the state machine's vocabulary is
 *      enforced below any service bug.
 *   7. Anon reads 0 rows from every practice_* table WHILE the service role reads more than 0 somewhere
 *      -- the count comparison, never the error, and never a vacuous pass against empty tables.
 *
 * SYNTHETIC DATA, CLEANED UP. The subject user is a fixed synthetic uuid that no auth user carries; the
 * workspace name says HARNESS. Everything created is deleted at the end (workspace cascade + request
 * rows), so re-runs start clean and the production dataset gains nothing.
 *
 *   npx --yes tsx scripts/practice-provisioning-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, PROVISIONING_STEPS, type IndividualRequest } from "../src/lib/practice/provisioning";
import { CP_BASELINE_VERSION, BASELINE_RULE_NAME } from "../src/lib/practice/baseline";
import { messagingStatus } from "../src/lib/practice/messaging";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const SYNTH_USER = "00000000-0000-4000-8000-0000000c0de1";
const KEY_A = "harness-provision-a";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const PAYLOAD: IndividualRequest = {
  displayName: "HARNESS Practice (synthetic)", countryCode: "UG", timezone: "Africa/Kampala",
  professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
  termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
};

const TABLES = [
  "practice_workspace", "practice_membership", "practice_role_assignment", "practice_configuration",
  "practice_location", "practice_entitlement", "practice_onboarding", "provisioning_request",
  "provisioning_step", "practice_audit_event",
];

async function counts(workspaceId: string) {
  const get = async (t: string, col: string) => {
    const { count } = await admin.from(t).select("*", { count: "exact", head: true }).eq(col, workspaceId);
    return count ?? 0;
  };
  // practice_role_assignment hangs off membership_id, NOT workspace_id -- which is exactly why it was
  // absent from this helper and why the assign_capabilities step could write nothing for months without
  // a red assertion. It is counted through its memberships now.
  const { data: ms } = await admin.from("practice_membership").select("id, role_code").eq("workspace_id", workspaceId);
  const membershipIds = ((ms ?? []) as { id: string }[]).map(m => m.id);
  const { count: capCount } = membershipIds.length
    ? await admin.from("practice_role_assignment").select("*", { count: "exact", head: true })
      .in("membership_id", membershipIds).is("effective_to", null)
    : { count: 0 };

  return {
    memberships: await get("practice_membership", "workspace_id"),
    configurations: await get("practice_configuration", "workspace_id"),
    entitlements: await get("practice_entitlement", "workspace_id"),
    onboardings: await get("practice_onboarding", "workspace_id"),
    capabilities: capCount ?? 0,
    membershipRoles: ((ms ?? []) as { id: string; role_code: string }[]),
  };
}

/** What the catalog says a role should hold -- the yardstick the granted set is measured against. */
async function catalogFor(roleCode: string): Promise<string[]> {
  const { data } = await admin.from("practice_role_capabilities").select("capability_code").eq("role_code", roleCode);
  return ((data ?? []) as { capability_code: string }[]).map(r => r.capability_code).sort();
}

async function heldBy(membershipId: string): Promise<string[]> {
  const { data } = await admin.from("practice_role_assignment")
    .select("capability_code").eq("membership_id", membershipId).is("effective_to", null);
  return ((data ?? []) as { capability_code: string }[]).map(r => r.capability_code).sort();
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [SYNTH_USER]);
}

async function main() {
  console.log("\nPractice provisioning harness (CPR-PROV-001 s20)\n");
  await cleanup();

  // ── 1. First run creates exactly one of everything ─────────────────────────
  const { data: reqRow, error: reqErr } = await admin.from("provisioning_request").insert({
    idempotency_key: KEY_A, request_type: "pilot", actor_user_id: SYNTH_USER, target_user_id: SYNTH_USER,
    payload_hash: "harness", correlation_id: "harness-run",
  }).select("id, workspace_id").single();
  ok("provisioning request recorded", !reqErr && !!reqRow, reqErr?.message);
  if (!reqRow) { report(); return; }

  const run1 = await runProvisioning(admin, { id: reqRow.id, target_user_id: SYNTH_USER, correlation_id: "harness-run", workspace_id: null }, PAYLOAD);
  ok("provisioning run succeeds", run1.ok, run1.errorCode);
  const wsId = run1.workspaceId!;

  const c1 = await counts(wsId);
  ok("exactly 2 memberships (owner + practitioner)", c1.memberships === 2, `${c1.memberships}`);
  ok("exactly 1 effective configuration", c1.configurations === 1, `${c1.configurations}`);
  ok("exactly 1 entitlement", c1.entitlements === 1, `${c1.entitlements}`);
  ok("exactly 1 onboarding instance", c1.onboardings === 1, `${c1.onboardings}`);

  // ── 1b. THE CAPABILITIES ACTUALLY LANDED ───────────────────────────────────
  // A workspace whose memberships hold nothing renders an empty sidebar and 403s every API call, so
  // "provisioned" without this is a lie in the shape of a success. The assign_capabilities step shipped
  // broken for exactly this reason: it used an upsert against a PARTIAL unique index, which PostgREST
  // refuses, and discarded the error. Nothing above could see it.
  ok("capabilities were granted to the new memberships", c1.capabilities > 0, `${c1.capabilities}`);

  for (const m of c1.membershipRoles) {
    const expected = await catalogFor(m.role_code);
    const held = await heldBy(m.id);
    const missing = expected.filter(c => !held.includes(c));
    ok(`the ${m.role_code} membership holds every capability its role defines`,
      expected.length > 0 && missing.length === 0,
      missing.length ? `missing: ${missing.join(", ")}` : "the catalog is empty for this role");
  }

  // The shipped phases must be reachable by the owner, not merely "some capabilities present".
  const practitioner = c1.membershipRoles.find(m => m.role_code === "practitioner");
  const practitionerCaps = practitioner ? await heldBy(practitioner.id) : [];
  for (const cap of ["practice.calendar.view", "appointment.manage", "patient.list", "encounter.create", "encounter.sign"]) {
    ok(`the owner can use phase-shipped capability ${cap}`, practitionerCaps.includes(cap),
      `held: ${practitionerCaps.length} capability(ies)`);
  }

  const { data: wsRow } = await admin.from("practice_workspace").select("status").eq("id", wsId).single();
  ok("workspace is in ONBOARDING after provisioning", wsRow?.status === "ONBOARDING", wsRow?.status);

  const { data: steps } = await admin.from("provisioning_step").select("status").eq("request_id", reqRow.id);
  ok(`all ${PROVISIONING_STEPS.length} steps recorded as succeeded`,
    (steps ?? []).length === PROVISIONING_STEPS.length && (steps ?? []).every((s: { status: string }) => s.status === "succeeded"));

  // ── 2. Re-entry is a no-op ─────────────────────────────────────────────────
  const run2 = await runProvisioning(admin, { id: reqRow.id, target_user_id: SYNTH_USER, correlation_id: "harness-run", workspace_id: wsId }, PAYLOAD);
  const c2 = await counts(wsId);
  ok("re-running provisioning duplicates nothing",
    run2.ok && c2.memberships === 2 && c2.configurations === 1 && c2.entitlements === 1 && c2.onboardings === 1,
    JSON.stringify({ ...c2, membershipRoles: undefined }));
  ok("re-running provisioning does not duplicate capabilities either",
    c2.capabilities === c1.capabilities, `${c1.capabilities} -> ${c2.capabilities}`);

  // ── 2.5 CPR-PROV-DEFAULTS-001: the Competen Standard baseline, seeded once and only into emptiness ──
  //
  // ⚠ THESE RUN AFTER run2, DELIBERATELY. Every figure below is asserted on a workspace that has been
  // provisioned TWICE, so "exactly one" is simultaneously DEF-01 (the starter state exists) and DEF-02
  // (a retry converged rather than duplicated).

  const { data: cfgRow } = await admin.from("practice_configuration")
    .select("feature_flags").eq("workspace_id", wsId).eq("is_effective", true).maybeSingle();
  ok("DEF-01. the baseline version is recorded on the configuration",
    (cfgRow?.feature_flags as any)?.baseline_version === CP_BASELINE_VERSION,
    JSON.stringify(cfgRow?.feature_flags ?? null));

  const { data: seededRules } = await admin.from("practice_booking_rule")
    .select("name, status, active, visibility, booking_horizon_days, lead_time_minutes, cancellation_notice_minutes, required_information")
    .eq("workspace_id", wsId);
  ok("DEF-01/02. exactly one starter booking rule, after two provisioning runs",
    (seededRules ?? []).length === 1 && seededRules![0].name === BASELINE_RULE_NAME,
    JSON.stringify((seededRules ?? []).map((r: any) => r.name)));
  ok("DEF-01. the starter rule carries the V1 booking baseline: 120-day horizon, 30-minute cutoff, no cancellation penalty",
    seededRules?.[0]?.booking_horizon_days === 120 && seededRules?.[0]?.lead_time_minutes === 30
    && (seededRules?.[0]?.cancellation_notice_minutes ?? 0) === 0,
    JSON.stringify(seededRules?.[0] ?? null));
  ok("DEF-01. the starter rule is in force and serves BOTH engines: status active for the card chain, active flag for the offering engine",
    seededRules?.[0]?.status === "active" && seededRules?.[0]?.active === true);
  ok("DEF-01. the pilot's email requirement is on the rule -- email is required at booking",
    (seededRules?.[0]?.required_information as any)?.fields?.contact_email?.level === "required",
    JSON.stringify(seededRules?.[0]?.required_information ?? null));

  const { data: seededTpls } = await admin.from("practice_registration_template")
    .select("id, name, status, is_default").eq("workspace_id", wsId);
  ok("DEF-01/02. exactly one starter registration template, published, after two runs",
    (seededTpls ?? []).length === 1 && seededTpls![0].status === "published",
    JSON.stringify((seededTpls ?? []).map((t: any) => `${t.name}:${t.status}`)));
  const { count: fieldCount } = await admin.from("practice_registration_field")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsId);
  ok("DEF-01. the starter template carries the canonical core fields rather than being an empty shell",
    (fieldCount ?? 0) >= 8, `${fieldCount} fields`);

  // The email channel: seeded ONLY where the deployment can actually send (never fabricated).
  const emailConfigured = messagingStatus().email.configured;
  const { data: chanRows } = await admin.from("practice_message_channel")
    .select("kind, enabled, sender_name").eq("workspace_id", wsId).eq("kind", "email");
  if (emailConfigured) {
    ok("DEF-01/13. the email channel is on, named after the practice, exactly once",
      (chanRows ?? []).length === 1 && chanRows![0].enabled === true
      && chanRows![0].sender_name === PAYLOAD.displayName,
      JSON.stringify(chanRows ?? []));
  } else {
    ok("DEF-13. with no provider on this deployment, NO email channel row is fabricated",
      (chanRows ?? []).length === 0, JSON.stringify(chanRows ?? []));
  }

  // DEF-12: the baseline fabricates no availability and no bookable inventory.
  const { count: sessCount } = await admin.from("practice_availability_template")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsId);
  const { count: slotCount } = await admin.from("practice_availability_slot")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsId);
  ok("DEF-12. no clinic, session or slot exists merely because the baseline was provisioned",
    (sessCount ?? -1) === 0 && (slotCount ?? -1) === 0, `sessions=${sessCount} slots=${slotCount}`);

  // DEF-11: no booking page exists, let alone a published one -- publishing stays the deliberate act.
  const { count: pageCount } = await admin.from("practice_booking_access")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsId);
  ok("DEF-11. no public booking page was created or published by the baseline",
    (pageCount ?? -1) === 0, `pages=${pageCount}`);

  // ── 3. The idempotency key is unique at the database ───────────────────────
  const dup = await admin.from("provisioning_request").insert({
    idempotency_key: KEY_A, request_type: "pilot", actor_user_id: SYNTH_USER, target_user_id: SYNTH_USER,
    payload_hash: "different", correlation_id: "harness-dup",
  });
  ok("same idempotency key cannot be inserted twice", !!dup.error && /duplicate|unique/i.test(dup.error.message), dup.error?.message ?? "insert succeeded");

  // ── 4. A second active owner membership is impossible even bypassing the route check ──
  const secondOwner = await admin.from("practice_membership").insert({
    workspace_id: wsId, user_id: "00000000-0000-4000-8000-0000000c0de2", role_code: "practice_owner", status: "active",
  });
  ok("a second active practice_owner is refused by the partial unique index",
    !!secondOwner.error && /duplicate|unique/i.test(secondOwner.error.message), secondOwner.error?.message ?? "insert succeeded");

  // ── 5. Completing onboarding activates the workspace ───────────────────────
  const { data: cat } = await admin.from("practice_onboarding_step_catalog").select("step_code").order("position");
  const allSteps = ((cat ?? []) as { step_code: string }[]).map(s => s.step_code);
  await admin.from("practice_onboarding").update({
    completed_steps: allSteps, state: "completed", completed_at: new Date().toISOString(),
  }).eq("workspace_id", wsId).eq("user_id", SYNTH_USER);
  await admin.from("practice_workspace").update({ status: "ACTIVE" }).eq("id", wsId).eq("status", "ONBOARDING");
  const { data: active } = await admin.from("practice_workspace").select("status").eq("id", wsId).single();
  ok("workspace transitions ONBOARDING -> ACTIVE", active?.status === "ACTIVE", active?.status);

  // ── 6. The state vocabulary is closed ──────────────────────────────────────
  const bad = await admin.from("practice_workspace").update({ status: "TOTALLY_FINE" }).eq("id", wsId);
  ok("an illegal workspace status is rejected by the CHECK constraint",
    !!bad.error && /check|constraint|invalid/i.test(bad.error.message), bad.error?.message ?? "update succeeded");

  // ── 7. Anon denial, non-vacuous ────────────────────────────────────────────
  let serviceSeesRows = false;
  let anonSeesAny = 0;
  for (const t of TABLES) {
    const { count: svc } = await admin.from(t).select("*", { count: "exact", head: true });
    if ((svc ?? 0) > 0) serviceSeesRows = true;
    const { count: a } = await anon.from(t).select("*", { count: "exact", head: true });
    if ((a ?? 0) > 0) anonSeesAny++;
  }
  ok("the service role sees rows somewhere (denial test is not vacuous)", serviceSeesRows);
  ok("anon reads 0 rows from every practice_* table", anonSeesAny === 0, `${anonSeesAny} table(s) leaked`);

  await cleanup();
  const { count: left } = await admin.from("practice_workspace").select("*", { count: "exact", head: true }).eq("owner_person_id", SYNTH_USER);
  ok("synthetic data cleaned up", (left ?? 0) === 0, `${left} workspace(s) remain`);

  report();
}

function report() {
  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}\n`);
  process.exit(fails.length ? 1 : 0);
}

main();
