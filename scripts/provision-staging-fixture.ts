/**
 * Provision the deterministic synthetic practitioner + Practice fixture in STAGING — COMP-ENG-002G §3.
 *
 * ⚠⚠ IT REFUSES TO RUN AGAINST PRODUCTION, TWICE OVER. §10: "No test may mutate production." The target
 * is named by STAGING_SUPABASE_URL, and (a) it is compared against the production ref in
 * NEXT_PUBLIC_SUPABASE_URL and refused on a match, and (b) it will not silently fall back to the
 * production variables if the staging ones are unset. Both are needed: the first stops the wrong URL,
 * the second stops an ABSENT url from quietly becoming the production one, which is how this class of
 * accident usually happens.
 *
 * ⚠ IT USES THE REAL PROVISIONING ENGINE, NOT HAND-WRITTEN ROWS. runProvisioning() is the same function
 * /api/v1/practice/signup calls, so the fixture gets the workspace, owner membership, capabilities,
 * configuration, entitlement and onboarding the product actually creates. Hand-inserting these rows is
 * precisely the shape of the capability-backfill bug this codebase has hit twice: rows that look right,
 * a workspace nobody can use, and every harness still green.
 *
 * ⚠ THE PASSWORD IS NEVER IN THIS FILE AND NEVER PRINTED. §4. It is read from
 * SMOKE_PRACTITIONER_PASSWORD and passed straight to GoTrue. The email IS printed, because a fixture
 * you cannot identify is a fixture you cannot audit.
 *
 * WHAT "REACHES PRACTICE HOME" MEANS, read out of src/lib/practice/shell.ts rather than assumed. The
 * shell refuses or diverts at six guards before it returns READY, and the fixture must clear all of
 * them:
 *
 *   guard 2/3  at least one active practice_membership       else WORKSPACE_REQUIRED
 *   guard 3    EXACTLY ONE workspace, or a cookie preference else CHOOSER_REQUIRED   <- §11 diversion
 *   guard 4    workspace status in ACTIVE/ONBOARDING/PROV.   else ACCESS_RESTRICTED
 *   guard 5    an active|trial entitlement covering now      else ACCESS_RESTRICTED
 *   guard 6    workspace status EXACTLY "ACTIVE"             else ONBOARDING_REQUIRED <- §11 diversion
 *   guard 7/8  device register and MFA                       only if the practice asked for MFA
 *
 * runProvisioning leaves the workspace at ONBOARDING (provisioning.ts, the create_onboarding step), so
 * guard 6 would divert every run. This script completes onboarding the way the product does — the same
 * effect as the `done` branch of PATCH /api/v1/practice/workspaces/[id]/onboarding — rather than
 * reaching past it to force the status.
 *
 * SETUP:
 *   .env.local (gitignored):  STAGING_SUPABASE_URL=...  STAGING_SERVICE_ROLE_KEY=...
 *   shell:                    $env:SMOKE_PRACTITIONER_PASSWORD = "<a strong secret>"
 *   then:                     npx tsx scripts/provision-staging-fixture.ts
 *                             npx tsx scripts/provision-staging-fixture.ts --verify   (no writes)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { resolvePracticeAccess, resolveWorkspaceContext } from "../src/lib/practice/access";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { judgeTarget } from "./production-guard";
// The booking prerequisites, each through the engine the product itself calls — see provisionBooking.
import { createLocation } from "../src/lib/practice/configuration";
import { saveSession } from "../src/lib/practice/practice-sessions";
import { generateSlots } from "../src/lib/practice/availability-config";
import { claimHandle, publishIdentity } from "../src/lib/practice/identity-service";
import { saveBookingAccess, publishReadiness, setPublishState } from "../src/lib/practice/patient-access";
import { saveBookingRule } from "../src/lib/practice/booking-rules";
import { createTemplate, publishTemplate } from "../src/lib/practice/registration-config";

loadEnvConfig(process.cwd());

/**
 * ⚠ THE DOMAIN IS RESERVED, NOT MERELY UNUSED. `.invalid` is set aside by RFC 2606 and can never be
 * registered or receive mail, so this address cannot collide with a real practitioner however the
 * fixture is copied around. §3: "Clearly synthetic automation/test identity; never impersonate a real
 * practitioner."
 */
const FIXTURE_EMAIL = "smoke.practitioner@staging.competen.invalid";
const FIXTURE_NAME = "Automation Practitioner (synthetic)";
const IDEMPOTENCY_KEY = "comp-eng-002g-smoke-fixture";
const CORRELATION = "comp-eng-002g-provision";
// CPR-BOOK-E2E-001 fixture names. Deterministic so a re-run reuses rather than multiplies.
const FIXTURE_LOCATION = "Staging Clinic (synthetic)";
const FIXTURE_HANDLE = "stagingclinic";

const VERIFY_ONLY = process.argv.includes("--verify");

const url = process.env.STAGING_SUPABASE_URL ?? null;
const key = process.env.STAGING_SERVICE_ROLE_KEY ?? null;
const password = process.env.SMOKE_PRACTITIONER_PASSWORD ?? null;

/**
 * ⚠ REFUSE A PLACEHOLDER, BECAUSE THEY GET PASTED. On 2026-08-19 the literal string "<a strong secret>"
 * — written by me as an illustration — was pasted into the shell and this script cheerfully created a
 * real account with it. That was the THIRD placeholder of the day used verbatim, after an invented
 * pooler region and the service-role key.
 *
 * The lesson is not "write clearer placeholders". A tool that accepts an obviously fake secret and
 * reports success has no business being trusted with the real one.
 */
function assertRealSecret(pw: string): void {
  const problems: string[] = [];
  if (/[<>]/.test(pw)) problems.push("contains < or >, which means it is still a placeholder");
  if (pw.length < 16) problems.push(`is ${pw.length} characters, and the fixture requires at least 16`);
  if (/^(password|secret|changeme|test|a strong secret)/i.test(pw.trim())) problems.push("is a well-known placeholder string");
  if (problems.length) {
    die("SMOKE_PRACTITIONER_PASSWORD is not a real secret.", [
      ...problems.map(p => `It ${p}.`),
      "",
      "Invent one — it is the password for a synthetic account that does not exist anywhere else.",
      "Nothing looks it up and nothing else uses it. A random 24+ character string is ideal:",
      "",
      "  -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 28 | % {[char]$_})",
      "",
      "Put it in .env.local as SMOKE_PRACTITIONER_PASSWORD=... so Playwright reads the same value.",
    ]);
  }
}

function die(msg: string, extra: string[] = []): never {
  console.error(`\n⛔ ${msg}\n`);
  for (const l of extra) console.error(`   ${l}`);
  console.error("");
  process.exit(1);
}

if (!url || !key) {
  die("STAGING_SUPABASE_URL and STAGING_SERVICE_ROLE_KEY must both be set.", [
    "Add them to .env.local, which is gitignored:",
    "",
    "  STAGING_SUPABASE_URL=https://<staging-ref>.supabase.co",
    "  STAGING_SERVICE_ROLE_KEY=<the STAGING service_role key>",
    "",
    "⚠ There is deliberately NO fallback to NEXT_PUBLIC_SUPABASE_URL. That variable names",
    "  PRODUCTION, and a fixture script that quietly defaults to it is how production gets written to.",
  ]);
}

// ── Guard 1: the target must not be production ───────────────────────────────────────────────────
/**
 * ⚠ THE SHARED PREDICATE, NOT A LOCAL COPY. COMP-ENG-002H §5 requires the negative test to exercise
 * "the same guard code path used by real smoke/provisioning automation", and it cannot do that while
 * this script carries its own notion of what production is. judgeTarget also fails closed on a target
 * it cannot identify — the state a half-configured environment produces.
 */
const verdict = judgeTarget(url);
if (!verdict.ok) {
  if (verdict.reason === "PRODUCTION") {
    die(`REFUSING — STAGING_SUPABASE_URL points at PRODUCTION (${verdict.ref}).`, [
      "No test may mutate production, and no synthetic fixture belongs there.",
    ]);
  }
  die("STAGING_SUPABASE_URL does not identify a Supabase project, so this run cannot prove it is not production.", [
    "Refusing rather than guessing.  want: https://<ref>.supabase.co",
  ]);
}
const targetRef = verdict.ref;
const prodRef = judgeTarget(process.env.NEXT_PUBLIC_SUPABASE_URL).ref;

if (password) assertRealSecret(password);

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => { console.log(`  FAIL  ${m}`); failures++; };
let failures = 0;

const payload: IndividualRequest = {
  displayName: FIXTURE_NAME,
  countryCode: "UG",
  timezone: "Africa/Kampala",
  professionCode: "medical_doctor",
  defaultPracticeType: "clinic",
  locale: "en-UG",
  termsVersion: "t1",
  privacyNoticeVersion: "p1",
  // "pilot", not "public_signup": signup is closed by owner decision and this fixture must not depend
  // on, or look like, a path that is shut.
  source: "pilot",
};

/** Find the fixture identity without assuming a getUserByEmail that this client version lacks. */
async function findFixtureUser(): Promise<any | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) die(`could not list users on ${targetRef}: ${error.message}`);
    const hit = (data?.users ?? []).find(u => (u.email ?? "").toLowerCase() === FIXTURE_EMAIL);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}

async function main() {
  console.log(`\n=== COMP-ENG-002G staging fixture ===`);
  console.log(`target : ${url}  (production is ${prodRef} — guard passed)`);
  console.log(`mode   : ${VERIFY_ONLY ? "VERIFY ONLY, no writes" : "provision (idempotent)"}\n`);

  // ── The identity ───────────────────────────────────────────────────────────────────────────────
  console.log("IDENTITY");
  let user = await findFixtureUser();

  if (!user && VERIFY_ONLY) { bad(`${FIXTURE_EMAIL} does not exist — run without --verify to create it`); return report(); }

  if (!user) {
    if (!password) {
      die("SMOKE_PRACTITIONER_PASSWORD is not set.", [
        "It is never stored in the repository. Set it in your shell for this run:",
        "",
        "  $env:SMOKE_PRACTITIONER_PASSWORD = \"<a strong secret>\"",
        "",
        "Use the same value for the Playwright smoke run.",
      ]);
    }
    const { data, error } = await admin.auth.admin.createUser({
      email: FIXTURE_EMAIL,
      password,
      // No verification wall: §11 requires the fixture to reach the workspace, and an unconfirmed
      // address would park it on a confirmation screen forever.
      email_confirm: true,
      user_metadata: { full_name: FIXTURE_NAME, synthetic: true, purpose: "COMP-ENG-002G smoke fixture" },
    });
    if (error || !data.user) die(`could not create the fixture identity: ${error?.message ?? "no user returned"}`);
    user = data.user;
    ok(`created ${FIXTURE_EMAIL}`);
  } else {
    ok(`reused existing ${FIXTURE_EMAIL}`);
    // Deterministic on every run (§3 repeatability): if a password was supplied, make it authoritative,
    // so a fixture whose secret was rotated elsewhere cannot silently fail the smoke run later.
    if (password && !VERIFY_ONLY) {
      const { error } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true });
      if (error) bad(`could not reset the fixture password: ${error.message}`);
      else ok("password reset to the supplied secret");
    }
  }
  const userId: string = user.id;

  // ── §10: no broad privilege. Assert it rather than intend it. ──────────────────────────────────
  const { data: prof } = await admin.from("profiles").select("role, platform_role, platform_roles").eq("id", userId).maybeSingle();
  const role = (prof as any)?.role ?? null;
  if (role === "super_admin" || (prof as any)?.platform_role === "super_admin") {
    die(`REFUSING — ${FIXTURE_EMAIL} carries super_admin. §10 forbids broad privilege on the fixture.`);
  }
  ok(`no super_admin privilege (profiles.role = ${role === null ? "null" : role})`);

  const { data: plat, error: platErr } = await admin.from("platform_membership")
    .select("id, status").eq("user_id", userId).eq("status", "active");
  if (platErr) console.log(`  note  platform_membership unreadable (${platErr.message.slice(0, 40)})`);
  else ok(`${(plat ?? []).length} active platform membership(s) — Practice is gate 2 and needs none`);

  // ── The launch flag the sign-in page is gated on ───────────────────────────────────────────────
  /**
   * ⚠ WITHOUT THIS THERE IS NO FORM TO SIGN IN WITH. /practice/sign-in renders SignInForm only when
   * practice_sign_in is on. On a clean staging build it is off, so the page returns no <form> at all —
   * measured 2026-08-19, and it presented as four authenticated journeys timing out on a wait, which
   * described nothing about the cause.
   *
   * §3 calls for "the minimum synthetic Practice/workspace state required to reach the intended
   * Practice home", and a sign-in form is part of reaching it.
   *
   * !! practice_public_signup IS NOT TOUCHED, ON ANY TARGET. Signup being closed is a standing owner
   * decision, and a fixture script is not the place to reopen it — not even on staging, where a
   * difference from production would make the smoke suite prove something production does not do.
   */
  console.log("\nLAUNCH FLAGS");
  const { data: flagRow } = await admin.from("practice_platform_flags")
    .select("flag, enabled").eq("flag", "practice_sign_in").maybeSingle();
  if ((flagRow as any)?.enabled === true) ok("practice_sign_in is on");
  else if (VERIFY_ONLY) bad("practice_sign_in is off — the sign-in page renders no form");
  else {
    const { error: fErr } = await admin.from("practice_platform_flags")
      .update({ enabled: true }).eq("flag", "practice_sign_in");
    const { data: after } = await admin.from("practice_platform_flags")
      .select("enabled").eq("flag", "practice_sign_in").maybeSingle();
    if (fErr || (after as any)?.enabled !== true) bad(`could not enable practice_sign_in: ${fErr?.message ?? "still off after the update"}`);
    else ok("practice_sign_in enabled on this staging project");
  }
  const { data: signupFlag } = await admin.from("practice_platform_flags")
    .select("enabled").eq("flag", "practice_public_signup").maybeSingle();
  ok(`practice_public_signup left at ${(signupFlag as any)?.enabled} — untouched by design`);

  // ── The Practice, through the real engine ──────────────────────────────────────────────────────
  console.log("\nPRACTICE");
  let access = await resolvePracticeAccess(admin, userId);

  /**
   * ⚠ A WORKSPACE EXISTING IS NOT A WORKSPACE FINISHED, and the first version of this script treated
   * them as the same thing. An interrupted run on 2026-08-19 left a workspace at PROVISIONING with its
   * memberships already written, and because `workspaces.length` was 1 the next run took the "reused
   * existing" path, skipped the engine entirely, and left it stuck there forever.
   *
   * runProvisioning is resumable by design — its ledger is keyed on (request_id, step_code) and each
   * step checks for its own output before writing — so the correct response to an unfinished workspace
   * is to run it AGAIN with that workspace id, not to step around it.
   */
  const unfinished = access.workspaces.length === 1
    && !["ACTIVE", "ONBOARDING"].includes(access.workspaces[0].status);
  if (unfinished) console.log(`  note  workspace is ${access.workspaces[0].status} — an unfinished run, resuming it`);

  if (access.workspaces.length === 0 || unfinished) {
    if (VERIFY_ONLY) { bad("no Practice workspace — run without --verify to provision one"); return report(); }
    const { data: req, error: reqErr } = await admin.from("provisioning_request").insert({
      idempotency_key: IDEMPOTENCY_KEY, request_type: "pilot",
      actor_user_id: userId, target_user_id: userId,
      payload_hash: IDEMPOTENCY_KEY, correlation_id: CORRELATION,
    }).select("id").maybeSingle();
    // A repeat run hits the idempotency key; reuse that row rather than treating it as an error.
    let requestId = (req as any)?.id ?? null;
    if (!requestId) {
      const { data: prior } = await admin.from("provisioning_request")
        .select("id").eq("idempotency_key", IDEMPOTENCY_KEY).maybeSingle();
      requestId = (prior as any)?.id ?? null;
    }
    if (!requestId) die(`could not create or find the provisioning request: ${reqErr?.message ?? "unknown"}`);

    const run = await runProvisioning(admin,
      {
        id: requestId, target_user_id: userId, correlation_id: CORRELATION,
        // Resuming: hand the engine the workspace it already made, so it continues that one rather
        // than starting a second and leaving the fixture with two (which is a chooser diversion).
        workspace_id: unfinished ? access.workspaces[0].id : null,
      }, payload);
    if (!run.ok || !run.workspaceId) {
      die(`provisioning failed at ${run.failedStep ?? "?"} (${run.errorCode ?? "?"})`, [run.detail ?? ""]);
    }
    ok(`provisioned workspace ${run.workspaceId} through the real engine`);
    if (run.identityIssued === false) console.log("  note  practitioner identity was not issued — a soft tail step");
    access = await resolvePracticeAccess(admin, userId);
  } else {
    ok(`reused existing workspace ${access.workspaces[0].id}`);
  }

  // ── §11: exactly one workspace, or the shell shows a chooser ───────────────────────────────────
  if (access.workspaces.length !== 1) {
    bad(`${access.workspaces.length} workspaces — the shell would show CHOOSER_REQUIRED. `
      + `The fixture must hold exactly one.`);
    return report();
  }
  const ws = access.workspaces[0];
  ok(`exactly one workspace — no chooser diversion`);

  // ── §11: onboarding must be complete, or the shell shows ONBOARDING_REQUIRED ────────────────────
  if (ws.status !== "ACTIVE") {
    if (VERIFY_ONLY) { bad(`workspace status is ${ws.status}, not ACTIVE — would divert to onboarding`); return report(); }
    const { data: steps } = await admin.from("practice_onboarding_step_catalog")
      .select("step_code").order("position");
    const catalog = ((steps ?? []) as any[]).map(s => s.step_code as string);
    const { data: ob } = await admin.from("practice_onboarding")
      .select("id, step_data").eq("workspace_id", ws.id).eq("user_id", userId)
      .order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (ob) {
      await admin.from("practice_onboarding").update({
        completed_steps: catalog,
        step_data: (ob as any).step_data ?? {},
        current_step: "review_activate",
        state: "completed",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", (ob as any).id);
    }
    // Same shape as the route's `done` branch, including the status precondition, so a workspace that
    // is anything other than ONBOARDING is left alone rather than forced.
    const { error: actErr } = await admin.from("practice_workspace")
      .update({ status: "ACTIVE", updated_at: new Date().toISOString() })
      .eq("id", ws.id).eq("status", "ONBOARDING");
    /**
     * ⚠ NO ERROR IS NOT THE SAME AS A ROW CHANGED. This update is guarded on status = ONBOARDING, so
     * against a workspace in any other state it matches nothing, returns no error, and the first
     * version of this script printed "activated" for it. That is precisely the trap migration 334 fell
     * into with `update storage.buckets` on a fresh project — a no-op reading as success.
     *
     * So the OUTCOME is read back rather than the absence of an error believed.
     */
    if (actErr) bad(`could not activate the workspace: ${actErr.message}`);
    access = await resolvePracticeAccess(admin, userId);
    const nowStatus = access.workspaces[0]?.status;
    if (nowStatus === "ACTIVE") ok(`onboarding completed and workspace activated (${catalog.length} catalog step(s))`);
    else bad(`workspace is still ${nowStatus} after the activation update — it matched no row`);
  } else {
    ok("workspace is ACTIVE — no onboarding diversion");
  }

  // ── The shell's own guards 4 and 5, asked directly ─────────────────────────────────────────────
  console.log("\nWORKSPACE CONTEXT (the shell's guards 4-6, asked of the real resolver)");
  const ctx = await resolveWorkspaceContext(admin, userId, access.workspaces[0].id);
  if (!ctx.ok) bad(`resolveWorkspaceContext refused: ${ctx.reason}`);
  else {
    ok(`context resolves — workspace "${ctx.ctx.workspaceName ?? access.workspaces[0].name}"`);
    if (access.workspaces[0].status !== "ACTIVE") bad(`status is ${access.workspaces[0].status}, guard 6 needs ACTIVE`);
    else ok("status ACTIVE — the shell would return READY");
    const caps = (ctx.ctx as any).capabilities;
    if (Array.isArray(caps)) ok(`${caps.length} capability grant(s) — whatever the owner role confers, nothing added`);
  }

  if (ctx.ok) await provisionBooking(ctx.ctx as any);

  report();
}

/**
 * CPR-BOOK-E2E-001's publication prerequisites, provisioned in staging.
 *
 * ⚠ WHY THIS EXISTS AT ALL. The fixture above stopped at an ACTIVE workspace, which is everything the
 * SHELL smoke journey needs and nothing the BOOKING one does. Staging carried zero locations, zero
 * sessions, zero booking rules, zero booking-access profiles and zero registration templates, so
 * Gates C, D, the concurrency race and the HFE pass had nothing to run against. That was mistaken
 * for "no staging project exists" once already; it is a missing fixture, not a missing environment.
 *
 * ⚠ EVERY ROW HERE GOES THROUGH THE ENGINE THE PRODUCT USES, for the same reason the workspace does.
 * Hand-inserted booking rows would look correct and prove nothing: the capability-backfill class in
 * this codebase is exactly a fixture that looks right, a workspace nobody can use, and every harness
 * still green. If an engine refuses, that refusal is the finding.
 *
 * ⚠ IDEMPOTENT, AND EACH STEP READS ITS OWN OUTCOME BACK. Re-running must not create a second
 * location or a second rule, and "no error" is never taken for "a row exists" — the same trap the
 * activation update above documents.
 */
async function provisionBooking(ctx: any): Promise<void> {
  console.log("\nBOOKING (CPR-BOOK-E2E-001 publication prerequisites)");
  const wsId: string = ctx.workspaceId;
  const corr = "cpr-book-e2e-001-fixture";

  // ── 1. A LOCATION ───────────────────────────────────────────────────────────────────────────────
  const locs = await admin.from("practice_location").select("id, name, active").eq("workspace_id", wsId);
  if (locs.error) { bad(`locations unreadable: ${locs.error.message}`); return; }
  let locationId = (locs.data ?? []).find((l: any) => l.active)?.id ?? null;
  if (!locationId) {
    if (VERIFY_ONLY) { bad("no active location — run without --verify to provision one"); return; }
    const made = await createLocation(admin, {
      workspaceId: wsId, name: FIXTURE_LOCATION, type: "clinic", country: "UG",
      actorId: ctx.userId, correlationId: corr,
    });
    if (!made.ok) { bad(`createLocation refused: ${made.message}`); return; }
    locationId = made.data.id;
    ok(`created location "${FIXTURE_LOCATION}"`);
  } else ok(`reused location ${(locs.data ?? []).find((l: any) => l.id === locationId)?.name}`);

  // ── 2. A SESSION PATIENTS MAY BOOK ──────────────────────────────────────────────────────────────
  //
  // booking_mode "public" rather than "link_only": Gate C's step 1 opens the PUBLIC address, and
  // link_only is reachable but unlisted. A fixture that quietly tested the weaker of two modes would
  // report a pass the acceptance pack did not ask for.
  const sessions = await admin.from("practice_availability_template")
    .select("id, booking_mode, weekday, capacity").eq("workspace_id", wsId).eq("status", "active");
  if (sessions.error) { bad(`sessions unreadable: ${sessions.error.message}`); return; }
  let sessionId = (sessions.data ?? []).find((s: any) => s.booking_mode === "public")?.id ?? null;
  if (!sessionId) {
    if (VERIFY_ONLY) { bad("no public session — run without --verify to provision one"); return; }
    const made = await saveSession(admin, ctx, {
      weekday: 3, startsMinute: 9 * 60, endsMinute: 13 * 60,
      locationId, sessionName: "Staging public clinic",
      bookingMode: "public", appointmentMinutes: 20, capacityManual: 8,
      appointmentTypes: ["new_consultation"],
      correlationId: corr,
    } as any);
    if (!(made as any).ok) { bad(`saveSession refused: ${(made as any).message}`); return; }
    const back = await admin.from("practice_availability_template")
      .select("id, booking_mode, capacity").eq("workspace_id", wsId).eq("booking_mode", "public").limit(1);
    sessionId = (back.data ?? [])[0]?.id ?? null;
    if (!sessionId) { bad("saveSession reported success but no public session came back"); return; }
    ok(`created a public Wednesday 09:00-13:00 session, capacity ${(back.data ?? [])[0]?.capacity}`);
  } else ok("reused the existing public session");

  // ── 3. A HANDLE ─────────────────────────────────────────────────────────────────────────────────
  const ident = await admin.from("practice_practitioner_identity")
    .select("id, handle").eq("user_id", ctx.userId).maybeSingle();
  if (!ident.data) { bad("no practitioner identity — runProvisioning's identity step did not land"); return; }
  if (!(ident.data as any).handle) {
    if (VERIFY_ONLY) { bad("no handle claimed — run without --verify to claim one"); return; }
    const claimed = await claimHandle(admin, { userId: ctx.userId, handle: FIXTURE_HANDLE, correlationId: corr });
    if (!claimed.ok) { bad(`claimHandle refused: ${claimed.message}`); return; }
    ok(`claimed @${claimed.data.handle}`);
  } else ok(`reused @${(ident.data as any).handle}`);

  // ── 4. A BOOKING-ACCESS PROFILE ─────────────────────────────────────────────────────────────────
  //
  // Created AFTER the claim on purpose: that is the order in which the page seeds its handle from the
  // identity, so the fixture exercises the seed path rather than assuming it.
  const baBefore = await admin.from("practice_booking_access").select("id, handle, mode").eq("workspace_id", wsId).maybeSingle();
  if (!baBefore.data) {
    if (VERIFY_ONLY) { bad("no booking-access profile — run without --verify to create one"); return; }
    const saved = await saveBookingAccess(admin, ctx, {
      mode: "public", otpRequired: true,
      actorId: ctx.userId, correlationId: corr,
    } as any);
    if (!(saved as any).ok) { bad(`saveBookingAccess refused: ${(saved as any).message}`); return; }
    const after = await admin.from("practice_booking_access").select("handle, mode").eq("workspace_id", wsId).maybeSingle();
    if (!(after.data as any)?.handle) bad("the booking page was created but seeded no handle from the identity");
    else ok(`created the booking page carrying @${(after.data as any).handle}, mode ${(after.data as any).mode}`);
  } else ok(`reused the booking page (handle ${(baBefore.data as any).handle ?? "null"})`);

  // ── 4b. WHAT THE PAGE ACTUALLY OFFERS ───────────────────────────────────────────────────────────
  //
  // ⚠ AN EMPTY visible_* ARRAY MEANS "NONE CHOSEN", NOT "ALL". patient-booking.ts narrows locations
  // behind `if (ids.length > 0)` and raises NOTHING_OFFERED when either list is empty, so a page that
  // is published, resolvable and green on every blocking check still tells a patient "this practice
  // has not yet chosen what it offers online". That is what this fixture produced on its first run.
  //
  // Recorded rather than worked around silently: publishReadiness has no blocking check for it, which
  // is the THIRD condition found today that leaves a 0-blocking practice unbookable. Raised as
  // separate work per §14.
  const offer = await admin.from("practice_booking_access")
    .select("visible_location_ids, visible_appointment_types").eq("workspace_id", wsId).maybeSingle();
  const emptyOffer = ((offer.data as any)?.visible_location_ids ?? []).length === 0
    || ((offer.data as any)?.visible_appointment_types ?? []).length === 0;
  if (emptyOffer) {
    if (VERIFY_ONLY) { bad("the page offers no location or no appointment type — a patient sees NOTHING_OFFERED"); return; }
    const saved = await saveBookingAccess(admin, ctx, {
      visibleLocationIds: [locationId],
      visibleAppointmentTypes: ["new_consultation"],
      actorId: ctx.userId, correlationId: corr,
    } as any);
    if (!(saved as any).ok) { bad(`saveBookingAccess refused the offer: ${(saved as any).message}`); return; }
    const back = await admin.from("practice_booking_access")
      .select("visible_location_ids, visible_appointment_types").eq("workspace_id", wsId).maybeSingle();
    const nLoc = ((back.data as any)?.visible_location_ids ?? []).length;
    const nType = ((back.data as any)?.visible_appointment_types ?? []).length;
    if (nLoc === 0 || nType === 0) bad(`the offer was saved but reads back as ${nLoc} location(s), ${nType} type(s)`);
    else ok(`page offers ${nLoc} location(s) and ${nType} appointment type(s)`);
  } else ok("page already offers a location and an appointment type");

  // ── 5. A RULE COVERING IT ───────────────────────────────────────────────────────────────────────
  const rules = await admin.from("practice_booking_rule")
    .select("id, location_id, booking_horizon_days, visibility, status").eq("workspace_id", wsId);
  if (rules.error) { bad(`rules unreadable: ${rules.error.message}`); return; }
  const covering = (rules.data ?? []).find((r: any) =>
    (r.location_id === null || r.location_id === locationId) && r.status === "active");
  if (!covering) {
    if (VERIFY_ONLY) { bad("no rule in force covers the public session — run without --verify"); return; }
    const made = await saveBookingRule(admin, ctx, {
      name: "Staging public self-booking", status: "active", locationId,
      bookingHorizonDays: 120, leadTimeMinutes: 30, visibility: "public",
      reason: "CPR-BOOK-E2E-001 staging fixture: gives the public session an explicit finite horizon, an explicit notice period and public visibility.",
      actorId: ctx.userId, correlationId: corr,
    });
    if (!made.ok) { bad(`saveBookingRule refused: ${(made as any).message}`); return; }
    ok(`created a rule: horizon 120, notice 30, visibility public`);
  } else ok(`reused a rule in force (horizon ${covering.booking_horizon_days}, visibility ${covering.visibility})`);

  // ── 6. A PUBLISHED REGISTRATION TEMPLATE ────────────────────────────────────────────────────────
  const tpls = await admin.from("practice_registration_template")
    .select("id, name, status").eq("workspace_id", wsId);
  if (tpls.error) { bad(`registration templates unreadable: ${tpls.error.message}`); return; }
  if (!(tpls.data ?? []).some((t: any) => t.status === "published")) {
    if (VERIFY_ONLY) { bad("no published registration template — run without --verify"); return; }
    let templateId = (tpls.data ?? []).find((t: any) => t.status === "draft")?.id ?? null;
    if (!templateId) {
      const made = await createTemplate(admin, ctx, { name: "Staging patient registration", correlationId: corr });
      if (!made.ok) { bad(`createTemplate refused: ${made.message}`); return; }
      templateId = made.data.id;
    }
    const pub = await publishTemplate(admin, ctx, { templateId: templateId!, makeDefault: true, correlationId: corr });
    // The protected floor lives here: a template whose seed does not satisfy it cannot publish, and
    // this is the fixture that would notice.
    if (!pub.ok) { bad(`publishTemplate refused: ${pub.message}`); return; }
    ok(`published a registration template as the default`);
  } else ok("reused the published registration template");

  // ── 7. AN IDENTITY A PATIENT CAN ACTUALLY REACH ─────────────────────────────────────────────────
  //
  // ⚠ THIS STEP EXISTS BECAUSE THE PUBLIC PAGE 404ed WITH EVERY BLOCKER GREEN, and that is a product
  // finding, not a fixture detail. resolveHandle refuses an identity whose discovery is `hidden` or
  // whose status is outside RESOLVABLE_STATES (`active`, `licence_verified`). A newly provisioned
  // identity is `hidden` and `created` — both refused — and publishReadiness checks NEITHER. So a
  // practitioner can clear every blocking check, publish, hand out their address, and have it answer
  // 404. Raised as separate work per §14 rather than fixed here by adding a check.
  //
  // publishIdentity is the real path: it requires a claimed handle and a confirmed email, walks
  // created -> email_verified -> active through transitionIdentity, and sets discovery.
  const identNow = await admin.from("practice_practitioner_identity")
    .select("discovery, status").eq("user_id", ctx.userId).maybeSingle();
  const resolvable = (d: any) => d && d.discovery !== "hidden" && ["active", "licence_verified"].includes(d.status);
  if (!resolvable(identNow.data)) {
    if (VERIFY_ONLY) {
      bad(`identity is discovery=${(identNow.data as any)?.discovery}/status=${(identNow.data as any)?.status} — the public page would 404`);
      return;
    }
    const pub = await publishIdentity(admin, { userId: ctx.userId, discovery: "public", correlationId: corr });
    if (!pub.ok) { bad(`publishIdentity refused: ${pub.message}`); return; }
    const back = await admin.from("practice_practitioner_identity")
      .select("discovery, status").eq("user_id", ctx.userId).maybeSingle();
    if (!resolvable(back.data)) bad(`publishIdentity reported success but the identity is still discovery=${(back.data as any)?.discovery}/status=${(back.data as any)?.status}`);
    else ok(`identity published — discovery ${(back.data as any).discovery}, status ${(back.data as any).status}`);
  } else ok(`identity already resolvable (discovery ${(identNow.data as any).discovery}, status ${(identNow.data as any).status})`);

  // ── 8. THE PAGE ITSELF, PUBLISHED ───────────────────────────────────────────────────────────────
  //
  // Publishing is a separate deliberate act by design (migration 254 keeps `mode` and `publish_state`
  // apart), so readiness reporting 0 blocking means "you may now publish", not "you have". The
  // fixture has to take that act for the journey to have a page to open.
  //
  // ⚠ `published_with_warnings` IS LIVE, AND THE DISTINCTION IS THE PRODUCT BEING HONEST RATHER THAN
  // A FAILURE. This fixture first asserted `=== "published"` and went red on a page that had in fact
  // gone live: NOTIFICATION_CHANNEL is a warning here, acceptWarnings carried the publish, and the
  // engine recorded WHICH of the two it was instead of flattening both to "published". That is
  // exactly §10's posture — never let a green state imply confirmations are operational — so the
  // fixture accepts both live states and reports which one it got.
  const LIVE = ["published", "published_with_warnings"];
  const pageNow = await admin.from("practice_booking_access")
    .select("publish_state").eq("workspace_id", wsId).maybeSingle();
  if (!LIVE.includes((pageNow.data as any)?.publish_state)) {
    if (VERIFY_ONLY) { bad(`booking page is ${(pageNow.data as any)?.publish_state}, not live`); return; }
    const pub = await setPublishState(admin, ctx, { to: "published", acceptWarnings: true, actorId: ctx.userId, correlationId: corr });
    if (!(pub as any).ok) { bad(`setPublishState refused: ${(pub as any).message}`); return; }
    const back = await admin.from("practice_booking_access").select("publish_state").eq("workspace_id", wsId).maybeSingle();
    const state = (back.data as any)?.publish_state;
    if (!LIVE.includes(state)) bad(`publish reported success but the page is ${state}`);
    else ok(`booking page live (${state})`);
  } else ok(`booking page already live (${(pageNow.data as any).publish_state})`);

  // ── 8b. SLOTS, WHICH A SESSION TEMPLATE IS NOT ──────────────────────────────────────────────────
  //
  // ⚠ A TEMPLATE IS A RULE FOR MAKING TIMES, NOT THE TIMES. practice_availability_slot was empty
  // across the whole staging project, so the public availability endpoint answered `slots: []` for a
  // page that was published, resolvable, offering a location and a type, and green on every blocking
  // check. Nothing said so: the emptiness reads exactly like "fully booked".
  //
  // generateSlots is the engine the planner calls. The window is deliberately short — a fortnight is
  // enough for the journey to find a Wednesday, and materialising 120 days of a synthetic clinic
  // would make every later count in this project harder to read.
  const slotCount = await admin.from("practice_availability_slot")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsId);
  if ((slotCount.count ?? 0) === 0) {
    if (VERIFY_ONLY) { bad("no availability slots — public availability would answer with an empty list"); return; }
    const from = new Date();
    const to = new Date(from.getTime() + 28 * 24 * 60 * 60 * 1000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const gen = await generateSlots(admin, ctx, {
      fromDate: iso(from), toDate: iso(to), actorId: ctx.userId, correlationId: corr,
    });
    if (!gen.ok) { bad(`generateSlots refused: ${(gen as any).message}`); return; }
    const back = await admin.from("practice_availability_slot")
      .select("*", { count: "exact", head: true }).eq("workspace_id", wsId);
    if ((back.count ?? 0) === 0) bad("generateSlots reported success but produced no slots");
    else ok(`generated ${back.count} slot(s) over 28 days`);
  } else ok(`reused ${slotCount.count} existing slot(s)`);

  // ── 9. WHAT THE PRODUCT ITSELF SAYS ─────────────────────────────────────────────────────────────
  //
  // ⚠ THE VERDICT IS ASKED OF THE REAL ENGINE, NOT RECOMPUTED HERE. A fixture that graded its own work
  // with its own copy of the rules would agree with itself no matter what it had written.
  const verdict = await publishReadiness(admin, ctx);
  const blocking = (verdict.checks ?? []).filter((c: any) => c.severity === "blocker" && c.state === "fail");
  if (blocking.length === 0) ok(`publishReadiness: 0 blocking`);
  else bad(`publishReadiness: ${blocking.length} blocking — ${blocking.map((c: any) => c.code).join(", ")}`);
  const notChecked = (verdict.checks ?? []).filter((c: any) => c.state === "not_checked").length;
  const warnings = (verdict.checks ?? []).filter((c: any) => c.severity !== "blocker" && c.state === "fail").length;
  console.log(`  note  ${notChecked} not checked, ${warnings} warning(s) — advisory, not blocking`);
}

function report() {
  console.log("");
  if (failures === 0) {
    console.log(`✓ fixture ready`);
    console.log(`\nSet these for the smoke run (the password is the one you supplied, never printed):`);
    console.log(`  $env:SMOKE_PRACTITIONER_EMAIL = "${FIXTURE_EMAIL}"`);
    console.log(`  $env:SMOKE_PRACTITIONER_PASSWORD = "<the same secret>"`);
    console.log(`  npx playwright test e2e/smoke --workers=1\n`);
  } else {
    console.log(`RED — ${failures} problem(s). The fixture is NOT ready.\n`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
