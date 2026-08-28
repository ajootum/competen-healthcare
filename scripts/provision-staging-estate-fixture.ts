/**
 * Provision the ESTATE fixture in STAGING — the owners, memberships, tenant chain and clinical
 * assignment that six privileged-live harnesses need and staging does not have.
 *
 * ⚠ WHY THIS EXISTS. On 2026-08-27 the writing harnesses were pointed at staging for the first time and
 * six failed on a MISSING PREREQUISITE rather than on the thing they check. Diagnosed one at a time,
 * they turned out to share a single root cause: STAGING HAS NO PEOPLE. Three synthetic profiles, no
 * super_admin, no platform_membership, no organisational unit, no patient, no assignment.
 *
 *   identity-join         22/1  needs an organisational unit to parent a fixture team
 *   platform-flag-gate    19/1  needs a profile carrying a tenant to gate against
 *   hq-guard              67/1  needs a super_admin identity (P2 is an owner control). 68/0 on production.
 *   platform-membership   59/3  needs owner accounts AND platform_membership rows
 *   hww-evidence            --  needs an ACTIVE op_patient_assignments row
 *   hww-gaps                --  the same assignment
 *
 * ⚠ EVERY ONE OF THEM REFUSED RATHER THAN PASSING OVER AN EMPTY ESTATE, and that is the only reason the
 * cause was legible. A harness that quietly passed with no data would have read as coverage. That is the
 * behaviour to preserve: this file makes the estate real, it does not make the checks lenient.
 *
 * ⚠⚠ IT REFUSES TO RUN AGAINST PRODUCTION, TWICE OVER — the same two guards
 * provision-staging-fixture.ts carries, for the same reason. (a) judgeTarget refuses the production ref
 * AND an unidentifiable URL, and (b) there is deliberately NO fallback to NEXT_PUBLIC_SUPABASE_URL: an
 * ABSENT staging URL quietly becoming the production one is how this class of accident usually happens.
 *
 * !! AND THIS ONE CREATES super_admin IDENTITIES, WHICH THE OTHER TWO FIXTURES EXPLICITLY REFUSE TO DO.
 * provision-staging-fixture.ts dies if its practitioner carries super_admin, because §10 forbids broad
 * privilege on THAT fixture. Here the privilege IS the fixture: hq-guard's P2 and platform-membership's
 * D3a are owner controls, and an estate with no owner cannot exercise them. Two consequences, both
 * deliberate: the addresses are on the RFC 2606 `.invalid` domain so they can never receive mail or
 * collide with a real person, and the production guard above is the only thing standing between this
 * script and a privileged account on the live project. Read it before changing it.
 *
 * ⚠ HAND-WRITTEN ROWS, AND WHY THAT IS ACCEPTABLE HERE. provision-staging-fixture.ts insists on going
 * through the real engines, because a hand-built Practice workspace is the capability-backfill shape:
 * rows that look right, a workspace nobody can use, every harness still green. That argument does not
 * transfer to these tables — there is no engine for platform_membership (it is a table write in
 * src/lib/platform-membership.ts), and the six harnesses read hospitals/units/op_* DIRECTLY, so what
 * this file writes is exactly what they read. Where an engine exists it is used; where one does not,
 * the row is written here and the outcome is read back.
 *
 * ⚠ IDEMPOTENT, AND EVERY STEP READS ITS OWN OUTCOME BACK. "No error" is never taken for "a row exists"
 * -- the trap provision-staging-fixture.ts records twice (a status-guarded UPDATE matching nothing, and
 * migration 334's `update storage.buckets` on a fresh project).
 *
 * SETUP:
 *   .env.local (gitignored):  STAGING_SUPABASE_URL=...  STAGING_SERVICE_ROLE_KEY=...
 *   shell:                    $env:STAGING_FIXTURE_PASSWORD = "<a real secret you invent>"
 *   then:                     npx tsx scripts/provision-staging-estate-fixture.ts
 *                             npx tsx scripts/provision-staging-estate-fixture.ts --verify   (no writes)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";

loadEnvConfig(process.cwd());

/**
 * ⚠ `.invalid` IS RESERVED BY RFC 2606 — it can never be registered and can never receive mail, so these
 * addresses cannot collide with a real person however this fixture is copied around. The same choice
 * provision-staging-fixture.ts makes, and for the same reason: a synthetic identity must be unmistakably
 * synthetic, especially one carrying super_admin.
 */
const OWNER_A = "estate.owner.a@staging.competen.invalid";
const OWNER_B = "estate.owner.b@staging.competen.invalid";
const NURSE = "estate.nurse@staging.competen.invalid";

const TENANT_NAME = "Staging Tenant (synthetic)";
const HOSPITAL_NAME = "Staging General Hospital (synthetic)";
const DEPARTMENT_NAME = "Staging Medical Department (synthetic)";
const UNIT_NAME = "Staging Ward A (synthetic)";
const PATIENT_LABEL = "Synthetic Patient A (staging fixture)";

const VERIFY_ONLY = process.argv.includes("--verify");

const url = process.env.STAGING_SUPABASE_URL ?? null;
const key = process.env.STAGING_SERVICE_ROLE_KEY ?? null;
const password = process.env.STAGING_FIXTURE_PASSWORD ?? null;

function die(msg: string, extra: string[] = []): never {
  console.error(`\n⛔ ${msg}\n`);
  for (const l of extra) console.error(`   ${l}`);
  console.error("");
  process.exit(1);
}

if (!url || !key) {
  die("STAGING_SUPABASE_URL and STAGING_SERVICE_ROLE_KEY must both be set.", [
    "Add them to .env.local, which is gitignored.",
    "",
    "⚠ There is deliberately NO fallback to NEXT_PUBLIC_SUPABASE_URL. That variable names PRODUCTION,",
    "  and a fixture script that quietly defaults to it is how production gets written to — and this",
    "  particular script creates super_admin identities.",
  ]);
}

// ── Guard 1: the target must not be production ───────────────────────────────────────────────────
const verdict = judgeTarget(url);
if (!verdict.ok) {
  if (verdict.reason === "PRODUCTION") {
    die(`REFUSING — STAGING_SUPABASE_URL points at PRODUCTION (${verdict.ref}).`, [
      "This script creates super_admin identities. It must never touch the live project.",
    ]);
  }
  die("STAGING_SUPABASE_URL does not identify a Supabase project, so this run cannot prove it is not production.", [
    "Refusing rather than guessing.  want: https://<ref>.supabase.co",
  ]);
}
const targetRef = verdict.ref;
const prodRef = judgeTarget(process.env.NEXT_PUBLIC_SUPABASE_URL).ref;

/**
 * ⚠ REFUSE A PLACEHOLDER, BECAUSE THEY GET PASTED. The sibling fixture records the day the literal
 * string "<a strong secret>" was pasted into a shell and a real account was created with it — the third
 * placeholder used verbatim that day. A tool that accepts an obviously fake secret and reports success
 * has no business being trusted with a real one, and this one is making OWNERS.
 */
if (password) {
  const problems: string[] = [];
  if (/[<>]/.test(password)) problems.push("contains < or >, so it is still a placeholder");
  if (password.length < 16) problems.push(`is ${password.length} characters, and the fixture requires at least 16`);
  if (/^(password|secret|changeme|test|a strong secret)/i.test(password.trim())) problems.push("is a well-known placeholder");
  if (problems.length) {
    die("STAGING_FIXTURE_PASSWORD is not a real secret.", [
      ...problems.map(p => `It ${p}.`),
      "",
      "Invent one — nothing looks it up and nothing else uses it:",
      "  -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 28 | % {[char]$_})",
    ]);
  }
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let failures = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => { console.log(`  FAIL  ${m}`); failures++; };
const note = (m: string) => console.log(`  note  ${m}`);

/** Find an identity by email without assuming a getUserByEmail this client version lacks. */
async function findUser(email: string): Promise<any | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) die(`could not list users on ${targetRef}: ${error.message}`);
    const hit = (data?.users ?? []).find(u => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}

/** Create or reuse an identity. Returns its id, or null when --verify and it is absent. */
async function identity(email: string, fullName: string): Promise<string | null> {
  const existing = await findUser(email);
  if (existing) { ok(`reused ${email}`); return existing.id; }
  if (VERIFY_ONLY) { bad(`${email} does not exist — run without --verify to create it`); return null; }
  if (!password) {
    die("STAGING_FIXTURE_PASSWORD is not set.", [
      "It is never stored in the repository. Set it in your shell for this run:",
      "",
      "  $env:STAGING_FIXTURE_PASSWORD = \"<invent a real one>\"",
    ]);
  }
  const { data, error } = await admin.auth.admin.createUser({
    email, password,
    // No verification wall: these identities are never signed into interactively, and an unconfirmed
    // address would leave the profile row in a state the harnesses do not expect.
    email_confirm: true,
    user_metadata: { full_name: fullName, synthetic: true, purpose: "staging estate fixture" },
  });
  if (error || !data.user) { bad(`could not create ${email}: ${error?.message ?? "no user returned"}`); return null; }
  ok(`created ${email}`);
  return data.user.id;
}

async function main() {
  console.log(`\n=== Staging estate fixture ===`);
  console.log(`target : ${url}  (production is ${prodRef} — guard passed)`);
  console.log(`mode   : ${VERIFY_ONLY ? "VERIFY ONLY, no writes" : "provision (idempotent)"}\n`);

  // ── 1. OWNERS ──────────────────────────────────────────────────────────────────────────────────
  //
  // hq-guard P2 needs at least one. platform-membership D3a asserts EXACTLY TWO:
  //   ok("D3a", supers.length === 2, ...)
  // ⚠ That is a pinned count mirroring production's two live owners, and this codebase has a recorded
  // rule against pinning counts you may want to change. It is not this script's to change -- so the
  // fixture makes exactly two and SAYS the number is load-bearing, rather than making three and leaving
  // somebody to discover D3a going red for a reason that looks like a defect.
  console.log("1. OWNERS — hq-guard P2, platform-membership D3a");
  const ownerIds: string[] = [];
  for (const [email, name] of [[OWNER_A, "Estate Owner A (synthetic)"], [OWNER_B, "Estate Owner B (synthetic)"]]) {
    const id = await identity(email, name);
    if (id) ownerIds.push(id);
  }

  for (const id of ownerIds) {
    const { data: prof } = await admin.from("profiles").select("id, roles, role, full_name").eq("id", id).maybeSingle();
    if (!prof) { bad(`no profiles row for ${id} — the auth trigger did not create one`); continue; }
    const roles: string[] = (prof as any).roles ?? [];
    if (roles.includes("super_admin")) { ok(`${(prof as any).full_name} already carries super_admin`); continue; }
    if (VERIFY_ONLY) { bad(`${(prof as any).full_name} does not carry super_admin`); continue; }
    const { error } = await admin.from("profiles")
      .update({ roles: [...new Set([...roles, "super_admin"])], role: "super_admin" }).eq("id", id);
    // ⚠ READ IT BACK. An UPDATE that matches nothing returns no error.
    const { data: after } = await admin.from("profiles").select("roles").eq("id", id).maybeSingle();
    if (error || !((after as any)?.roles ?? []).includes("super_admin")) {
      bad(`could not grant super_admin to ${id}: ${error?.message ?? "the update matched no row"}`);
    } else ok(`granted super_admin to ${(prof as any).full_name}`);
  }

  const { data: allProfiles } = await admin.from("profiles").select("id, email, roles, role, tenant_id").limit(5000);
  const supers = ((allProfiles ?? []) as any[]).filter(p => ((p.roles?.length ? p.roles : [p.role]) as string[] ?? []).includes("super_admin"));
  if (supers.length === 2) ok(`exactly 2 super_admin identities — D3a's pinned count is satisfied`);
  else bad(`${supers.length} super_admin identities on this estate. hq-guard P2 needs >=1; platform-membership D3a pins EXACTLY 2.`);

  // ── 2. PLATFORM MEMBERSHIP ─────────────────────────────────────────────────────────────────────
  //
  // D2b and D4: every estate identity holds an ACTIVE membership. There is no granting engine --
  // src/lib/platform-membership.ts holds the table name and the read side -- so this is a table write,
  // and `source` is recorded honestly rather than borrowed from a real path.
  console.log("\n2. PLATFORM MEMBERSHIP — platform-membership D2b, D4");
  const { data: members } = await admin.from("platform_membership").select("user_id, status").limit(1000);
  const activeIds = new Set(((members ?? []) as any[]).filter(m => m.status === "active").map(m => m.user_id));
  const lacking = ((allProfiles ?? []) as any[]).filter(p => !activeIds.has(p.id));
  if (lacking.length === 0) ok(`all ${(allProfiles ?? []).length} estate identities already hold an active membership`);
  else if (VERIFY_ONLY) bad(`${lacking.length} identit(ies) hold no active membership`);
  else {
    for (const p of lacking) {
      /**
       * ⚠ `source` IS CONSTRAINED, AND THE SCHEMA WAS RIGHT TO REFUSE ME. The first version passed
       * "staging_estate_fixture" -- a truthful-sounding label I invented -- and every insert failed on
       * platform_membership_source_check, which permits exactly:
       *   backfill_legacy | platform_signup | admin_grant | explicit_grant   (migration 279)
       *
       * That is CLAUDE.md's "make a wrong state unrepresentable rather than enforcing it in application
       * code" doing its job on me: a rule a service layer enforced would have let four rows through with
       * a vocabulary nobody else understands. `admin_grant` is the honest member of that set for a
       * script granting membership with the service role.
       */
      const { error } = await admin.from("platform_membership").insert({
        user_id: p.id, status: "active", source: "admin_grant",
      });
      if (error) bad(`could not grant membership to ${p.email ?? p.id}: ${error.message.slice(0, 70)}`);
    }
    const { data: back } = await admin.from("platform_membership").select("user_id, status").limit(1000);
    const nowActive = new Set(((back ?? []) as any[]).filter(m => m.status === "active").map(m => m.user_id));
    const still = ((allProfiles ?? []) as any[]).filter(p => !nowActive.has(p.id));
    if (still.length) bad(`${still.length} identit(ies) still hold no active membership after the insert`);
    else ok(`granted active membership to ${lacking.length} identit(ies)`);
  }

  // ── 3. THE TENANT CHAIN ────────────────────────────────────────────────────────────────────────
  //
  // hospitals -> departments -> units. Required columns read from plat_column_registry rather than
  // guessed: hospitals(country, name), departments(hospital_id, name), units(department_id, name).
  //
  // ⚠ THE REGISTRY HAS TO BE READ WITH pagedRpc. A direct .rpc() returns the PostgREST cap of 1000 rows
  // and says nothing about truncating -- which reported op_patients as having 7 columns and NO required
  // ones, while hww-census had already failed on a NOT NULL for op_patients.hospital_id. The paged read
  // returns 7903.
  //
  // ⚠ AND IT STARTS AT `tenants`, NOT AT `hospitals`. Migration 041 makes profiles.tenant_id and
  // hospitals.tenant_id both `references tenants(id)`. The first version skipped the tenant and fell
  // back to using the hospital's own id as a tenant id, which is not a tenant and cannot be: the FK
  // refused it. That failure surfaced as "the tenant update matched no row" because the update's error
  // was discarded and only the read-back reported -- the exact "no error is not the same as a row
  // changed" trap this file's header warns about, walked into while writing the file that warns about it.
  console.log("\n3. TENANT CHAIN — identity-join (a unit must exist)");
  const tenantId = await ensureRow("tenants", { name: TENANT_NAME }, { name: TENANT_NAME }, "tenant");
  const hospitalId = await ensureRow("hospitals", { name: HOSPITAL_NAME },
    { name: HOSPITAL_NAME, country: "Uganda", tenant_id: tenantId }, "hospital");
  const departmentId = hospitalId
    ? await ensureRow("departments", { name: DEPARTMENT_NAME }, { name: DEPARTMENT_NAME, hospital_id: hospitalId }, "department")
    : null;
  const unitId = departmentId
    ? await ensureRow("units", { name: UNIT_NAME }, { name: UNIT_NAME, department_id: departmentId }, "unit")
    : null;

  // ── 4. A PROFILE CARRYING A TENANT ─────────────────────────────────────────────────────────────
  //
  // platform-flag-gate's control: `profiles.select("id, tenant_id").not("tenant_id", "is", null)`.
  // hospitals carries its own tenant_id column, so the fixture uses the hospital's rather than
  // inventing an id that points at nothing.
  console.log("\n4. A PROFILE WITH A TENANT — platform-flag-gate");
  const withTenant = ((allProfiles ?? []) as any[]).find(p => p.tenant_id);
  if (withTenant) ok(`a profile already carries a tenant`);
  else if (VERIFY_ONLY) bad("no profile carries a tenant — the gate has nothing to test against");
  else if (!tenantId) bad("no tenant row, so there is nothing valid to attach");
  else {
    const subject = ownerIds[0] ?? ((allProfiles ?? []) as any[])[0]?.id;
    if (!subject) bad("no profile to attach a tenant to");
    else {
      // ⚠ THE ERROR IS READ, NOT DISCARDED. The first version threw it away and reported only the
      // read-back, so an FK violation on tenant_id presented as "the update matched no row" -- a
      // description of the symptom that named nothing about the cause and cost a diagnosis.
      const { error: tErr } = await admin.from("profiles")
        .update({ tenant_id: tenantId, hospital_id: hospitalId }).eq("id", subject);
      const { data: after } = await admin.from("profiles").select("tenant_id").eq("id", subject).maybeSingle();
      if (tErr) bad(`could not attach the tenant: ${tErr.message.slice(0, 90)}`);
      else if ((after as any)?.tenant_id) ok(`attached tenant ${String((after as any).tenant_id).slice(0, 8)}… to a profile`);
      else bad("the tenant update returned no error and changed nothing — it matched no row");
    }
  }

  /**
   * ⚠ A TENANT IS NOT ENOUGH — THE GATE ALSO WANTS A COUNTRY AND A PLAN, and that only became visible by
   * running the harness after the tenant existed. Check 8 went from failing on "no profile carries a
   * tenant" to failing on `country: null, planCode: null`, which is the fixture uncovering the NEXT
   * requirement rather than the fixture being wrong. tenantFlagContext (feature-flags.ts) reads:
   *
   *   tenants.primary_country                       <- NOT `country`; the column beside it
   *   plat_subscriptions (status active) -> plat_plans.code
   *
   * ⚠ THE PLAN IS REUSED, NOT INVENTED. plat_plans already carries six seeded rows on staging, and a
   * synthetic seventh would put a plan in the catalogue that the product never defined -- the kind of
   * fixture debris that later reads as real configuration.
   */
  if (tenantId && !VERIFY_ONLY) {
    const { data: ten } = await admin.from("tenants").select("primary_country").eq("id", tenantId).maybeSingle();
    if (!(ten as any)?.primary_country) {
      const { error } = await admin.from("tenants").update({ primary_country: "UG" }).eq("id", tenantId);
      const { data: back } = await admin.from("tenants").select("primary_country").eq("id", tenantId).maybeSingle();
      if (error || !(back as any)?.primary_country) bad(`could not set the tenant's primary_country: ${error?.message ?? "matched no row"}`);
      else ok(`tenant primary_country = ${(back as any).primary_country}`);
    } else ok(`tenant already carries primary_country ${(ten as any).primary_country}`);

    const { data: sub } = await admin.from("plat_subscriptions")
      .select("id, status").eq("tenant_id", tenantId).eq("status", "active").limit(1).maybeSingle();
    if (sub) ok("tenant already holds an active subscription");
    else {
      const { data: plans } = await admin.from("plat_plans").select("id, code").limit(10);
      const plan = ((plans ?? []) as any[]).find(p => p.code === "starter") ?? ((plans ?? []) as any[])[0];
      if (!plan) bad("plat_plans is empty — no plan to subscribe the tenant to");
      else {
        const { error } = await admin.from("plat_subscriptions")
          .insert({ tenant_id: tenantId, plan_id: plan.id, status: "active" });
        const { data: back } = await admin.from("plat_subscriptions")
          .select("id").eq("tenant_id", tenantId).eq("status", "active").limit(1).maybeSingle();
        if (error || !back) bad(`could not subscribe the tenant: ${error?.message.slice(0, 80) ?? "no row came back"}`);
        else ok(`subscribed the tenant to the "${plan.code}" plan`);
      }
    }
  } else if (tenantId && VERIFY_ONLY) {
    const { data: ten } = await admin.from("tenants").select("primary_country").eq("id", tenantId).maybeSingle();
    const { data: sub } = await admin.from("plat_subscriptions").select("id").eq("tenant_id", tenantId).eq("status", "active").limit(1).maybeSingle();
    if (!(ten as any)?.primary_country) bad("the tenant carries no primary_country — flag check 8 needs one");
    if (!sub) bad("the tenant holds no active subscription — flag check 8 needs a plan");
  }

  // ── 5. THE CLINICAL ASSIGNMENT ─────────────────────────────────────────────────────────────────
  //
  // hww-evidence and hww-gaps both open with:
  //   op_patient_assignments.select("staff_id, op_patients!patient_id(...)").eq("status","active")
  // and both print "No active assignment — cannot exercise the bridge" and stop when it is absent.
  // ⚠ THAT MESSAGE WAS BURIED UNDER A libuv UV_HANDLE_CLOSING CRASH at exit, which is how it was first
  // mis-filed as a Windows crash rather than a missing fixture. The crash is noise printed after.
  console.log("\n5. CLINICAL ASSIGNMENT — hww-evidence, hww-gaps, hww-census");
  const nurseId = await identity(NURSE, "Estate Nurse (synthetic)");
  const patientId = hospitalId
    ? await ensureRow("op_patients", { label: PATIENT_LABEL },
        { label: PATIENT_LABEL, hospital_id: hospitalId, unit_id: unitId }, "patient")
    : null;

  if (!nurseId || !patientId || !hospitalId) {
    bad("cannot build an assignment without a nurse, a patient and a hospital");
  } else {
    const { data: asg } = await admin.from("op_patient_assignments")
      .select("id, status").eq("patient_id", patientId).eq("staff_id", nurseId).maybeSingle();
    if ((asg as any)?.status === "active") ok("an active assignment already exists");
    else if (VERIFY_ONLY) bad("no active assignment — the two hww harnesses would bail");
    else {
      if (asg) await admin.from("op_patient_assignments").update({ status: "active" }).eq("id", (asg as any).id);
      else await admin.from("op_patient_assignments").insert({
        hospital_id: hospitalId, patient_id: patientId, staff_id: nurseId, status: "active",
      });
      // ⚠ Read it back THROUGH THE HARNESSES' OWN QUERY, not through a simpler one. The join is what
      // they depend on, and a row that exists but does not join is a row that does not help them.
      const { data: seen } = await admin.from("op_patient_assignments")
        .select("staff_id, op_patients!patient_id(id, label, hospital_id, unit_id)")
        .eq("status", "active").limit(1).maybeSingle();
      if ((seen as any)?.op_patients && (seen as any)?.staff_id) ok("an active assignment resolves through the harnesses' own join");
      else bad("the assignment was written but does not resolve through the join the hww harnesses use");
    }
  }

  // ── 6. THE HOSPITAL STAFF COHORT ───────────────────────────────────────────────────────────────
  //
  // Five harnesses (ssw-attendance, ssw-mdt, umw-communications, umw-wellbeing, xw-sweep) open with the
  // same gate, read verbatim from their source before writing this: enumerate hospitals, keep the first
  // whose `profiles.hospital_id` count reaches their floor (5, 2, 2, 2 and 3 respectively), refuse
  // otherwise. No role filter, no other field -- the gate is purely "a hospital with people in it".
  // Five dedicated staff identities clear all five floors at once.
  //
  // ⚠ DEDICATED IDENTITIES, NOT THE PRACTICE FIXTURES. smoke.practitioner and retry.proof belong to the
  // Practice-product smoke fixtures; attaching a hospital to them would quietly change what OTHER
  // harnesses observe about accounts they treat as theirs.
  //
  // ⚠ EACH STAFF MEMBER ALSO GETS AN ACTIVE MEMBERSHIP, because platform-membership D2b asserts EVERY
  // estate identity holds one. Seeding five profiles without memberships would clear five harnesses by
  // reddening a sixth.
  console.log("\n6. HOSPITAL STAFF COHORT — ssw-attendance, ssw-mdt, umw-communications, umw-wellbeing, xw-sweep");
  if (!hospitalId) bad("no hospital, so no cohort can be attached");
  else {
    let attached = 0;
    for (let i = 1; i <= 5; i++) {
      const email = `estate.staff.${i}@staging.competen.invalid`;
      const id = await identity(email, `Estate Staff ${i} (synthetic)`);
      if (!id) continue;
      const { data: prof } = await admin.from("profiles").select("id, hospital_id").eq("id", id).maybeSingle();
      if (!prof) { bad(`no profiles row for ${email}`); continue; }
      if ((prof as any).hospital_id !== hospitalId && !VERIFY_ONLY) {
        const { error } = await admin.from("profiles")
          .update({ hospital_id: hospitalId, department_id: departmentId, unit_id: unitId }).eq("id", id);
        if (error) { bad(`could not attach ${email} to the hospital: ${error.message.slice(0, 70)}`); continue; }
      }
      const { data: mem } = await admin.from("platform_membership")
        .select("id").eq("user_id", id).eq("status", "active").limit(1).maybeSingle();
      if (!mem && !VERIFY_ONLY) {
        const { error } = await admin.from("platform_membership")
          .insert({ user_id: id, status: "active", source: "admin_grant" });
        if (error) { bad(`could not grant membership to ${email}: ${error.message.slice(0, 70)}`); continue; }
      }
      attached++;
    }
    // ⚠ READ BACK THROUGH THE GATES' OWN QUERY, floor included -- five harnesses trust this count.
    const { data: cohort } = await admin.from("profiles").select("id").eq("hospital_id", hospitalId).limit(8);
    const n = (cohort ?? []).length;
    if (n >= 5) ok(`the fixture hospital holds ${n} profiles -- every gate's floor (5/3/2) is met`);
    else if (VERIFY_ONLY) bad(`the fixture hospital holds ${n} profile(s); the highest gate needs 5`);
    else bad(`after attaching ${attached}, the hospital reads back ${n} profile(s) -- below the floor of 5`);
  }

  // ── 7. STANDING DATA THE OBSERVATORY HARNESSES ANCHOR ON ───────────────────────────────────────
  //
  // Two harnesses read AMBIENT data rather than provisioning their own, by design:
  //
  //   practice-adoption anchors on the oldest practice_appointment ("an unordered limit(1) is not a
  //   fixture" -- its own header) and proves its counting hook against the workspace that owns it. On
  //   production there is real traffic; on staging every booking harness cleans up after itself, so the
  //   moment adoption runs there may be NOTHING to anchor on and its H2-control goes red by design.
  //
  //   xw-uplift's HEX side reads the latest DAILY op_ops_snapshots row for occupancy -- its own comment:
  //   the two dashboards "will legitimately differ until a snapshot is written". No snapshot writer runs
  //   on staging, so the HEX number stays null for ever.
  //
  // ⚠ THE APPOINTMENT IS PAST-DATED AND THE SNAPSHOT'S PERIOD IS A CONSTANT. A standing appointment
  // scheduled today would occupy a slot the booking journeys count; yesterday's is inert for capacity
  // and still a row for the counting hook. A period of new Date() would create one row per run day --
  // fixture debris -- where a constant date is idempotent.
  console.log("\n7. STANDING OBSERVATORY DATA — practice-adoption, xw-uplift");
  const smokeUser = await findUser("smoke.practitioner@staging.competen.invalid");
  if (!smokeUser) bad("the Practice smoke fixture does not exist -- run provision-staging-fixture.ts first");
  else {
    const { data: smokeWs } = await admin.from("practice_workspace")
      .select("id").eq("owner_person_id", smokeUser.id).limit(1).maybeSingle();
    if (!smokeWs) bad("the smoke practitioner has no workspace -- run provision-staging-fixture.ts first");
    else {
      const wsId = (smokeWs as any).id;
      const patientId = await ensureRow("practice_patient",
        { workspace_id: wsId, display_name: "Estate Standing Patient (synthetic)" },
        { workspace_id: wsId, display_name: "Estate Standing Patient (synthetic)" }, "standing patient");
      if (patientId) {
        const { data: appt } = await admin.from("practice_appointment")
          .select("id").eq("workspace_id", wsId).eq("patient_name", "Estate Standing Patient (synthetic)").limit(1).maybeSingle();
        if (appt) ok("the standing appointment already exists");
        else if (VERIFY_ONLY) bad("no standing appointment -- practice-adoption has nothing to anchor on");
        else {
          const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
          yesterday.setUTCHours(6, 0, 0, 0); // 09:00 Kampala, safely in the past
          const { error } = await admin.from("practice_appointment").insert({
            workspace_id: wsId, patient_id: patientId,
            patient_name: "Estate Standing Patient (synthetic)", scheduled_at: yesterday.toISOString(),
          });
          const { data: back } = await admin.from("practice_appointment")
            .select("id").eq("workspace_id", wsId).eq("patient_name", "Estate Standing Patient (synthetic)").limit(1).maybeSingle();
          if (error || !back) bad(`could not create the standing appointment: ${error?.message.slice(0, 80) ?? "no row came back"}`);
          else ok("created the standing appointment (yesterday 09:00 Kampala -- inert for today's capacity)");
        }
      }
    }
  }

  if (!hospitalId) bad("no hospital, so no ops snapshot can be written");
  else {
    const { data: snap } = await admin.from("op_ops_snapshots")
      .select("id").eq("hospital_id", hospitalId).eq("period", "2026-08-27").eq("period_type", "day").limit(1).maybeSingle();
    if (snap) ok("the daily ops snapshot already exists");
    else if (VERIFY_ONLY) bad("no daily ops snapshot -- xw-uplift's HEX occupancy stays null");
    else {
      const { error } = await admin.from("op_ops_snapshots").insert({
        hospital_id: hospitalId, period: "2026-08-27", period_type: "day",
        occupancy_pct: 62.5, admissions: 4, discharges: 3, capacity_score: 70,
      });
      const { data: back } = await admin.from("op_ops_snapshots")
        .select("id, occupancy_pct").eq("hospital_id", hospitalId).eq("period", "2026-08-27").eq("period_type", "day").limit(1).maybeSingle();
      if (error || !back) bad(`could not write the ops snapshot: ${error?.message.slice(0, 80) ?? "no row came back"}`);
      else ok(`wrote the daily ops snapshot (occupancy ${(back as any).occupancy_pct}%)`);
    }
  }

  report();
}

/**
 * Find-or-create by a natural key, reading the outcome back.
 *
 * ⚠ NOT AN UPSERT. This codebase has a recorded PARTIAL-INDEX UPSERT TRAP, and these tables carry no
 * unique constraint on the names used here — an upsert would either fail or silently duplicate. A read,
 * then an insert, then a read-back is longer and says what actually happened.
 */
async function ensureRow(
  table: string, match: Record<string, unknown>, row: Record<string, unknown>, label: string,
): Promise<string | null> {
  const { data: found, error: readErr } = await admin.from(table).select("id").match(match).limit(1).maybeSingle();
  if (readErr) { bad(`${table} unreadable: ${readErr.message.slice(0, 60)}`); return null; }
  if (found) { ok(`reused ${label} ${String((found as any).id).slice(0, 8)}…`); return (found as any).id; }
  if (VERIFY_ONLY) { bad(`no ${label} exists — run without --verify to create one`); return null; }
  const { error } = await admin.from(table).insert(row);
  if (error) { bad(`could not create the ${label}: ${error.message.slice(0, 90)}`); return null; }
  const { data: back } = await admin.from(table).select("id").match(match).limit(1).maybeSingle();
  if (!back) { bad(`the ${label} insert reported success but no row came back`); return null; }
  ok(`created ${label} ${String((back as any).id).slice(0, 8)}…`);
  return (back as any).id;
}

function report() {
  console.log("");
  if (failures === 0) {
    console.log(`✓ estate fixture ready on ${targetRef}`);
    console.log(`\nThese six should now run. Move each into STAGING in privileged-harnesses.ts once it does:`);
    console.log(`  npx tsx scripts/privileged-harnesses.ts --staging --only identity-join`);
    console.log(`  npx tsx scripts/privileged-harnesses.ts --staging --only platform-flag-gate`);
    console.log(`  npx tsx scripts/privileged-harnesses.ts --staging --only hq-guard`);
    console.log(`  npx tsx scripts/privileged-harnesses.ts --staging --only platform-membership`);
    console.log(`  npx tsx scripts/privileged-harnesses.ts --staging --only hww-evidence`);
    console.log(`  npx tsx scripts/privileged-harnesses.ts --staging --only hww-gaps\n`);
  } else {
    console.log(`RED — ${failures} problem(s). The estate fixture is NOT ready.\n`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
