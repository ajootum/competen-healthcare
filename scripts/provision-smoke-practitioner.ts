/**
 * Provisions the synthetic automation practitioner the Playwright smoke suite needs
 * (COMP-ENG-001A §4). Owner-authorised 2026-08-18.
 *
 * ⚠ STAGING ONLY (COMPETEN-OPS-001 R13, 2026-10-23). The authenticated smoke suite runs against the
 * staging project, and .env.local targets staging. This script REFUSES the production project: a
 * synthetic account with a password in CI secrets has no business in production. It is also the step
 * that mints a credential, and the password must be one only the owner has seen: this script reads it
 * from the environment and never generates, logs, or defaults it.
 *
 *   SMOKE_PRACTITIONER_EMAIL='...' SMOKE_PRACTITIONER_PASSWORD='...' \
 *     SMOKE_PROVISION_CONFIRM=yes npx tsx scripts/provision-smoke-practitioner.ts
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL, which .env.local already supplies.
 *
 * ⚠ IDEMPOTENT BY DESIGN. Re-running finds the existing user, request and workspace rather than
 * creating a second one — so a half-finished run is fixed by running it again, not by hand-repairing
 * rows. The one thing it will NOT do is change an existing user's password.
 *
 * ⚠ IT REUSES THE APPLICATION'S OWN runProvisioning RATHER THAN INSERTING ROWS BY HAND. Provisioning a
 * practice is seven steps (workspace, owner membership, CAPABILITY GRANTS, configuration, entitlement,
 * onboarding, publish), and hand-writing them has a specific recorded failure mode in this codebase: a
 * practice created without its capability grants is locked out of its own workspace while every harness
 * stays green. Calling the real path cannot drift from what a real signup does.
 *
 * WHAT IT PRODUCES, and why each part is needed to reach /practice/home rather than a diversion
 * (src/lib/practice/shell.ts, guards 2-6):
 *   - an auth user                      -> otherwise AUTH_REQUIRED
 *   - exactly ONE workspace             -> two would mean CHOOSER_REQUIRED. Provisioning gives the user
 *                                          TWO memberships in it (owner + practitioner) by design, and
 *                                          the shell counts workspaces, not memberships.
 *   - a live entitlement, no end date   -> otherwise ACCESS_RESTRICTED / NOT_ENTITLED. The trial that
 *                                          provisioning opens ends, and the smoke suite would go red the
 *                                          day it did, so an open-ended period replaces it (owner GO
 *                                          2026-10-24), written through openAccessPeriod like any other.
 *   - workspace status ACTIVE           -> otherwise ONBOARDING_REQUIRED
 *   - MFA left off for this workspace   -> the MFA gate only runs where a practice asked for it
 *
 * No patient, encounter, appointment or clinical row is created or touched. The workspace is empty by
 * construction, which is what makes it safe to sign into from an automated test.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { randomUUID } from "node:crypto";
import { runProvisioning, payloadHash, type IndividualRequest } from "../src/lib/practice/provisioning";
import { openAccessPeriod } from "../src/lib/practice/entitlement-writer";

loadEnvConfig(process.cwd());

const PRODUCTION_REF = "rnnqhlrcgvsauigxwszl";

const EMAIL = process.env.SMOKE_PRACTITIONER_EMAIL;
const PASSWORD = process.env.SMOKE_PRACTITIONER_PASSWORD;
const CONFIRM = process.env.SMOKE_PROVISION_CONFIRM;
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function die(msg: string): never { console.error(`\n✗ ${msg}\n`); process.exit(1); }

// The password is needed only to CREATE the user. Re-running against an existing user (to repair or
// extend it) never touches the password, so it is not asked for.
if (!EMAIL) die("set SMOKE_PRACTITIONER_EMAIL.");
function requirePassword(): string {
  if (!PASSWORD) die("the user does not exist yet, so set SMOKE_PRACTITIONER_PASSWORD.\n"
    + "  It has no default and is never generated here on purpose: the credential must be one\n"
    + "  only the owner has seen. Choose a long random password from a password manager.");
  return PASSWORD;
}
if (CONFIRM !== "yes") {
  die("set SMOKE_PROVISION_CONFIRM=yes to confirm.\n"
    + "  This WRITES to the staging Supabase project. The guard is here so the write is always deliberate.");
}
if (!URL_ || !SERVICE_KEY) die("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local supplies both).");
if (URL_.includes(PRODUCTION_REF)) die("this is the PRODUCTION project. The smoke practitioner lives on staging only.");

const admin = createClient(URL_, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const DISPLAY_NAME = "Automation Smoke Practice";
const FULL_NAME = "Smoke Automation (synthetic)";

async function findUserByEmail(email: string): Promise<{ id: string } | null> {
  // listUsers is paged; the estate is small, but page until found rather than assuming page 1.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) die(`could not list users: ${error.message}`);
    const hit = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return { id: hit.id };
    if (data.users.length < 200) return null;
  }
  return null;
}

async function main() {
  console.log("\n=== Provisioning the synthetic smoke practitioner ===\n");
  console.log(`  email: ${EMAIL}`);          // the identifier is fine to print
  console.log("  password: (read from env, never printed)\n");

  // ── 1. The auth user ───────────────────────────────────────────────────────────────────────────
  let userId: string;
  const existing = await findUserByEmail(EMAIL!);
  if (existing) {
    userId = existing.id;
    console.log(`  = auth user already exists (${userId}) -- password left untouched`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: EMAIL, password: requirePassword(), email_confirm: true,
      user_metadata: { full_name: FULL_NAME, synthetic_automation_account: true },
    });
    if (error || !data.user) die(`could not create the auth user: ${error?.message ?? "no user returned"}`);
    userId = data.user.id;
    console.log(`  + auth user created (${userId})`);
  }

  // ── 2. The profile row the roster reads its name from ──────────────────────────────────────────
  const { error: profErr } = await admin.from("profiles")
    .upsert({ id: userId, full_name: FULL_NAME }, { onConflict: "id" });
  if (profErr) console.log(`  ! profiles upsert said: ${profErr.message} (continuing -- the shell does not gate on it)`);
  else console.log("  = profile name set");

  // ── 3. Provisioning, through the application's own path ────────────────────────────────────────
  const payload: IndividualRequest = {
    displayName: DISPLAY_NAME,
    countryCode: "GB",
    timezone: "Europe/London",
    professionCode: "doctor",
    defaultPracticeType: "independent",
    locale: "en-GB",
    termsVersion: "1.0",
    privacyNoticeVersion: "1.0",
    source: "admin",
  };

  // One stable idempotency key, so re-running resumes the same request instead of starting a new one.
  const idempotencyKey = `smoke-automation-practitioner:${userId}`;
  const correlationId = randomUUID();

  const { data: existingReq } = await admin.from("provisioning_request")
    .select("id, workspace_id").eq("idempotency_key", idempotencyKey).maybeSingle();

  let requestId: string, workspaceId: string | null;
  if (existingReq) {
    requestId = existingReq.id; workspaceId = existingReq.workspace_id;
    console.log(`  = provisioning request already exists (${requestId})`);
  } else {
    const { data: created, error: reqErr } = await admin.from("provisioning_request").insert({
      idempotency_key: idempotencyKey, request_type: "individual",
      actor_user_id: userId, target_user_id: userId,
      payload_hash: payloadHash(payload), correlation_id: correlationId, status: "REQUESTED",
    }).select("id, workspace_id").single();
    if (reqErr || !created) die(`could not create the provisioning request: ${reqErr?.message}`);
    requestId = created.id; workspaceId = created.workspace_id;
    console.log(`  + provisioning request created (${requestId})`);
  }

  const run = await runProvisioning(admin, {
    id: requestId, target_user_id: userId, correlation_id: correlationId, workspace_id: workspaceId,
  }, payload);
  if (!run.ok) die(`provisioning failed at step "${run.failedStep}" (${run.errorCode}): ${run.detail ?? "no detail"}\n`
    + "  The request is resumable -- fix the cause and run this script again.");
  workspaceId = run.workspaceId!;
  console.log(`  + provisioned workspace ${workspaceId} (identity issued: ${run.identityIssued})`);

  // ── 4. Activation: without this the shell answers ONBOARDING_REQUIRED, never READY ─────────────
  // Mirrors what completing the last onboarding step does
  // (src/app/api/v1/practice/workspaces/[workspaceId]/onboarding/route.ts): mark the record complete,
  // then flip the workspace, guarded on it still being ONBOARDING so this cannot revive a closed one.
  // ⚠ current_step is NOT NULL. A completed record keeps "review_activate", exactly as the route leaves it.
  const nowIso = new Date().toISOString();
  const { error: obErr } = await admin.from("practice_onboarding")
    .update({ state: "completed", current_step: "review_activate", completed_at: nowIso, updated_at: nowIso })
    .eq("workspace_id", workspaceId).neq("state", "completed");
  if (obErr) die(`could not complete onboarding: ${obErr.message}`);

  const { error: actErr } = await admin.from("practice_workspace")
    .update({ status: "ACTIVE", updated_at: nowIso })
    .eq("id", workspaceId).eq("status", "ONBOARDING");
  if (actErr) die(`could not activate the workspace: ${actErr.message}`);

  // ── 5. An access period with no end date, so the suite does not expire with the trial ──────────
  // Through openAccessPeriod, the one writer: the live trial is closed (status -> expired, its own
  // dates kept) and the open-ended period appended. Skipped when one is already live.
  const { data: periods, error: perErr } = await admin.from("practice_entitlement")
    .select("plan_code, status, starts_at, ends_at").eq("workspace_id", workspaceId).order("starts_at", { ascending: false });
  if (perErr) die(`could not read the workspace's access periods: ${perErr.message}`);
  const isLive = (p: { status: string; starts_at: string; ends_at: string | null }) =>
    ["active", "trial"].includes(p.status) && p.starts_at <= nowIso && (p.ends_at === null || p.ends_at >= nowIso);
  if ((periods ?? []).some(p => isLive(p) && p.ends_at === null)) {
    console.log("  = open-ended access period already live");
  } else {
    const planCode = periods?.[0]?.plan_code;
    if (!planCode) die("the workspace has no access period to take a plan from -- provisioning should have opened one.");
    const opened = await openAccessPeriod(admin, {
      workspaceId: workspaceId!, planCode, status: "active", startsAt: nowIso, endsAt: null, source: "director",
    });
    if (!opened.ok) die(`could not open the open-ended access period (${opened.code}): ${opened.message}`);
    console.log(`  + open-ended access period opened (plan ${planCode}, source director)`);
  }

  // ── 6. Prove it, rather than announce it ───────────────────────────────────────────────────────
  const [{ data: ws }, { data: mems }, { data: ents }] = await Promise.all([
    admin.from("practice_workspace").select("id, name, status").eq("id", workspaceId).single(),
    admin.from("practice_membership").select("workspace_id, role_code, status").eq("user_id", userId).eq("status", "active"),
    admin.from("practice_entitlement").select("status, starts_at, ends_at").eq("workspace_id", workspaceId).in("status", ["active", "trial"]),
  ]);

  const workspaces = new Set((mems ?? []).map(m => m.workspace_id));
  const live = (ents ?? []).filter(isLive);
  console.log("\n── Verification (what the shell will actually find) ──");
  const checks: [string, boolean, string][] = [
    ["workspace is ACTIVE", ws?.status === "ACTIVE", `status=${ws?.status}`],
    ["exactly ONE workspace (more would mean the chooser)", workspaces.size === 1 && workspaces.has(workspaceId),
      `${workspaces.size} workspace(s), ${mems?.length ?? 0} membership(s): ${(mems ?? []).map(m => m.role_code).join(", ")}`],
    ["exactly ONE live entitlement, with no end date", live.length === 1 && live[0].ends_at === null,
      `${live.length} live, ends_at=${live[0]?.ends_at ?? "none"}`],
  ];
  let allOk = true;
  for (const [name, ok, detail] of checks) {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name} -- ${detail}`);
    if (!ok) allOk = false;
  }

  if (!allOk) die("provisioning finished but the workspace is not in a state that reaches /practice/home.");

  console.log(`\n✓ Ready. Workspace "${ws?.name}" (${workspaceId}).`);
  console.log("\nNext: with SMOKE_PRACTITIONER_EMAIL and SMOKE_PRACTITIONER_PASSWORD set, run");
  console.log("  npx playwright test");
  console.log("and the authenticated journeys should change from skipped to passing. If one fails, that is a real");
  console.log("finding about the signed-in product, not about this script.\n");
}

main().catch(e => die(e instanceof Error ? e.message : String(e)));
