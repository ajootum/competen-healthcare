/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Provision the synthetic HQ operator fixture in STAGING — CPR-PD-014 §14 delivery evidence.
 *
 * §14 asks for screenshots of the four optimised Product Operations screens in healthy and exception
 * states. Every one of those routes is behind requireHqCapability, and no synthetic HQ identity exists,
 * so the evidence could not be produced without either this or an owner signing in to PRODUCTION.
 *
 * !! IT EXISTS SO NOBODY SIGNS IN TO PRODUCTION FOR A SCREENSHOT. Production screenshots would put real
 * practice and practitioner names into a delivery document, and production is quiet — two practices, no
 * failures — which makes it poor evidence for the EXCEPTION half of what §14 asks for. Staging already
 * holds a practice stalled at 0/6 and a deliberately retried provisioning run.
 *
 * !! IT GRANTS HQ PRIVILEGE, AND ONLY ON STAGING. The appointment below makes a synthetic account a
 * Practice Product Director, which carries 19 practice capabilities. That is a real privilege grant, so
 * it is guarded by the same production predicate the smoke fixture uses and refuses any other target.
 *
 * WHAT IT DOES NOT DO: it does not touch the owner's account, it does not create a position or a
 * capability grant, and it does not widen any existing one. Offices, positions and their capabilities
 * are seeded by migrations 116-121 and are already present on staging — this only appoints somebody to
 * one that exists.
 *
 * SETUP (.env.local, gitignored):
 *   STAGING_SUPABASE_URL / STAGING_SERVICE_ROLE_KEY
 *   HQ_FIXTURE_PASSWORD   a strong secret you invent, never stored here
 *
 *   npx tsx scripts/provision-staging-hq-fixture.ts
 *   npx tsx scripts/provision-staging-hq-fixture.ts --verify    (no writes)
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";

loadEnvConfig(process.cwd());

/** RFC 2606 reserved, so it can never be a real mailbox. Same reasoning as the smoke practitioner. */
const FIXTURE_EMAIL = "hq.operator@staging.competen.invalid";
const FIXTURE_NAME = "Automation HQ Operator (synthetic)";

/**
 * The office and position this fixture is appointed to.
 *
 * practice_product_director is the position CPR-PD-014 exists to serve — PD-014 §9 says the Product
 * Director must not be equated with Super Admin, and appointing this fixture to exactly that position
 * is what makes the screenshots evidence of what a Product Director sees rather than what an owner does.
 */
const OFFICE_CODE = "practice";
const POSITION_CODE = "practice_product_director";
/** src/lib/ogs/lifecycle.ts: ACCESS_GRANTING_STATUSES is ["active"] and nothing else. */
const GRANTING_STATUS = "active";

const VERIFY_ONLY = process.argv.includes("--verify");

const url = process.env.STAGING_SUPABASE_URL ?? null;
const key = process.env.STAGING_SERVICE_ROLE_KEY ?? null;
const password = process.env.HQ_FIXTURE_PASSWORD ?? null;

let failures = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => { failures++; console.log(`  FAIL  ${m}`); };

function die(msg: string, extra: string[] = []): never {
  console.error(`\n[refused] ${msg}\n`);
  for (const l of extra) console.error(`   ${l}`);
  console.error("");
  process.exit(1);
}

if (!url || !key) {
  die("STAGING_SUPABASE_URL and STAGING_SERVICE_ROLE_KEY must both be set.", [
    "There is deliberately no fallback to the production variables.",
  ]);
}

// The shared predicate. An unidentifiable target fails closed, exactly as for the smoke fixture.
const verdict = judgeTarget(url);
if (!verdict.ok) {
  die(verdict.reason === "PRODUCTION"
    ? `STAGING_SUPABASE_URL points at PRODUCTION (${verdict.ref}). No synthetic HQ appointment belongs there.`
    : "STAGING_SUPABASE_URL does not identify a Supabase project, so this run cannot prove it is not production.");
}

/** Same placeholder refusal as the smoke fixture, for the same reason: they get pasted. */
function assertRealSecret(pw: string): void {
  if (/[<>]/.test(pw) || pw.length < 16) {
    die("HQ_FIXTURE_PASSWORD is not a real secret.", [
      "Angle brackets mean it is still a placeholder, and under 16 characters is too short.",
      "Invent one - it is the password for a synthetic account that exists nowhere else:",
      "",
      "  -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 28 | % {[char]$_})",
    ]);
  }
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUser(): Promise<any | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) die(`could not list users: ${error.message}`);
    const hit = (data?.users ?? []).find(u => (u.email ?? "").toLowerCase() === FIXTURE_EMAIL);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}

async function main() {
  console.log(`\n=== CPR-PD-014 §14 synthetic HQ operator ===`);
  console.log(`target : ${url}  (${verdict.ref})`);
  console.log(`mode   : ${VERIFY_ONLY ? "VERIFY ONLY, no writes" : "provision (idempotent)"}\n`);

  console.log("IDENTITY");
  let user = await findUser();
  if (!user && VERIFY_ONLY) { bad(`${FIXTURE_EMAIL} does not exist`); return report(); }
  if (!user) {
    if (!password) die("HQ_FIXTURE_PASSWORD is not set.", ["Set it in .env.local, alongside the staging keys."]);
    assertRealSecret(password);
    const { data, error } = await admin.auth.admin.createUser({
      email: FIXTURE_EMAIL, password, email_confirm: true,
      user_metadata: { full_name: FIXTURE_NAME, synthetic: true, purpose: "CPR-PD-014 §14 evidence" },
    });
    if (error || !data.user) die(`could not create the identity: ${error?.message ?? "no user"}`);
    user = data.user;
    ok(`created ${FIXTURE_EMAIL}`);
  } else {
    ok(`reused ${FIXTURE_EMAIL}`);
    if (password && !VERIFY_ONLY) {
      assertRealSecret(password);
      const { error } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true });
      if (error) bad(`could not reset the password: ${error.message}`); else ok("password reset to the supplied secret");
    }
  }

  /**
   * ── GATE 1: platform membership ────────────────────────────────────────────────────────────────
   *
   * !! THE HQ APPOINTMENT ALONE IS NOT ENOUGH, and finding that out was the point of running this.
   * The first version provisioned the appointment, the resolver confirmed 20 capabilities, and every
   * /super-admin route still redirected to /practice/no-account. src/app/super-admin/layout.tsx calls
   * admitToEstate BEFORE any capability is consulted, and this account had no platform_membership row.
   *
   * That is COMP-ARCH-PSA-001's two-gate split doing exactly what it says: gate 1 asks whether a person
   * belongs to Competen Platform at all, gate 2 asks what they may do there. A fixture that satisfies
   * only the second is a fixture that cannot open the product.
   *
   * !! MEMBERSHIP, NOT super_admin. The break-glass short-circuit in admitToEstate would also admit this
   * account, and using it would make every screenshot evidence of what an OWNER sees rather than what a
   * Product Director sees -- which is the distinction PD-014 section 9 exists to protect. An explicit
   * membership row is the mechanism the product actually intends.
   */
  console.log("\nGATE 1 - PLATFORM MEMBERSHIP");
  const { data: pm } = await admin.from("platform_membership")
    .select("id, status").eq("user_id", user.id).maybeSingle();
  if (pm && (pm as any).status === "active") {
    ok("an active platform membership exists");
  } else if (VERIFY_ONLY) {
    bad("no active platform membership - /super-admin would redirect to the no-account page");
  } else if (pm) {
    const { error } = await admin.from("platform_membership")
      .update({ status: "active" }).eq("id", (pm as any).id);
    if (error) bad(`could not activate the membership: ${error.message}`); else ok("membership set to active");
  } else {
    const { error } = await admin.from("platform_membership").insert({
      // migration 279 CHECKs source against four values. admin_grant is the honest one: a platform
      // operator granted this membership deliberately, which is exactly what this script is.
      user_id: user.id, status: "active", source: "admin_grant",
      note: "CPR-PD-014 section 14 synthetic HQ operator. Staging only.",
    });
    if (error) bad(`could not create the platform membership: ${error.message}`);
    else ok("platform membership created, status active");
  }

  // ── The office and position must already exist. This fixture appoints; it does not create rights. ──
  console.log("\nOFFICE AND POSITION");
  const { data: office } = await admin.from("ogs_offices")
    .select("id, code, office_type, is_active, status").eq("code", OFFICE_CODE).maybeSingle();
  if (!office) { bad(`no office with code "${OFFICE_CODE}" exists on this project`); return report(); }
  ok(`office ${OFFICE_CODE} (${(office as any).office_type}) is ${(office as any).status ?? "active"}`);

  const { data: position } = await admin.from("hq_position")
    .select("code, name, is_active").eq("code", POSITION_CODE).maybeSingle();
  if (!position) { bad(`position ${POSITION_CODE} does not exist`); return report(); }
  if ((position as any).is_active === false) { bad(`position ${POSITION_CODE} is not active, so it grants nothing`); return report(); }
  ok(`position ${POSITION_CODE} is active`);

  const { data: grants } = await admin.from("hq_position_capability")
    .select("capability_code").eq("position_code", POSITION_CODE);
  ok(`${(grants ?? []).length} capability grant(s) attach to it - none created by this script`);

  // ── The appointment ────────────────────────────────────────────────────────────────────────────
  console.log("\nAPPOINTMENT");
  const { data: existing } = await admin.from("ogs_office_appointments")
    .select("id, status, role").eq("office_id", (office as any).id).eq("person_id", user.id).maybeSingle();

  if (existing && (existing as any).status === GRANTING_STATUS && (existing as any).role === POSITION_CODE) {
    ok(`already appointed as ${POSITION_CODE} with status ${GRANTING_STATUS}`);
  } else if (VERIFY_ONLY) {
    bad("no access-granting appointment exists - run without --verify to create it");
  } else if (existing) {
    // The row exists but does not grant. Append-safe: this table is not a ledger, so an update is right.
    const { error } = await admin.from("ogs_office_appointments")
      .update({ role: POSITION_CODE, status: GRANTING_STATUS }).eq("id", (existing as any).id);
    if (error) bad(`could not correct the appointment: ${error.message}`);
    else ok(`appointment corrected to ${POSITION_CODE}/${GRANTING_STATUS}`);
  } else {
    const { error } = await admin.from("ogs_office_appointments").insert({
      office_id: (office as any).id, person_id: user.id, person_name: FIXTURE_NAME,
      role: POSITION_CODE, status: GRANTING_STATUS, term_start: new Date().toISOString(),
    });
    if (error) bad(`could not create the appointment: ${error.message}`);
    else ok(`appointed as ${POSITION_CODE}, status ${GRANTING_STATUS}`);
  }

  // ── What the app will actually resolve ─────────────────────────────────────────────────────────
  //
  // Asked of the real resolver rather than inferred from the rows just written. The rows being correct
  // and the resolver agreeing are two different claims, and only the second one matters.
  console.log("\nRESOLVED (asked of the real HQ resolver)");
  const { resolveHqPositions } = await import("../src/lib/hq/context");
  const resolved = await resolveHqPositions(admin as never, user.id);
  if (resolved.positions.includes(POSITION_CODE)) ok(`positions: ${resolved.positions.join(", ")}`);
  else bad(`the resolver does not see the appointment - positions: ${resolved.positions.join(", ") || "(none)"}`);
  const needed = ["hq.practice.operations.view", "hq.practice.provision.execute", "hq.practice.flags.manage"];
  for (const c of needed) {
    if (resolved.capabilities.includes(c)) ok(`holds ${c}`);
    else bad(`does NOT hold ${c} - a §14 screenshot of that surface is not reachable`);
  }
  ok(`${resolved.capabilities.length} capabilities in total`);

  report();
}

function report() {
  console.log("");
  if (failures === 0) {
    console.log("HQ fixture ready. Sign in at /login with:");
    console.log(`  ${FIXTURE_EMAIL}`);
    console.log("  (the password you supplied - never printed)\n");
    console.log("Then browse the Product Operations screens on the staging server:");
    console.log("  npm run dev:staging      then http://127.0.0.1:3100/super-admin/pd/operations\n");
  } else {
    console.log(`RED - ${failures} problem(s). The fixture is NOT ready.\n`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
