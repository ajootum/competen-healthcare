/**
 * Auth-guard harness: the three doors to super_admin on public.profiles, watched from the DEPLOYED
 * database.
 *
 * WHY IT READS THE CATALOGUE AND NEVER THE MIGRATIONS. The bug class this file exists for is a
 * migration that says one thing while the database does another. Migration 019 redefined a function
 * that was never applied and the library search returned nothing for months. Migration 238 lost two
 * sections to a semicolon inside a comment and still reported "Success. No rows returned". Migration
 * 249 -- the file this harness mostly watches -- came within one missing statement terminator of
 * leaving the vulnerable function deployed behind a green SQL editor. So every assertion below is made
 * against plat_* registries, which read pg_catalog. Not one reads supabase/migrations.
 *
 * WHAT IT WATCHES, AND WHY ALL THREE BELONG IN ONE FILE. They are one vulnerability with three
 * entrances, and closing any two of them leaves the platform open:
 *   DOOR 1, unauthenticated. handle_new_user() copied the signup payload's role verbatim, so a direct
 *   POST to GoTrue with the anon key that ships to every browser minted a super_admin. Closed by
 *   migration 249 section 1 with an allow-list.
 *   DOOR 2, any signed-in user. The profiles UPDATE policy had WITH CHECK = null, and Postgres reuses
 *   USING as the check, so auth.uid() = id permitted rewriting every column of one's own row. Closed by
 *   migration 249 sections 3 and 4.
 *   DOOR 3, the INSERT policy. WITH CHECK (auth.uid() = id) pinned one column and left the other twelve
 *   free. Unreachable only for want of a DELETE policy. Closed by migration 250.
 *
 * ⚠ IT DOES NOT DEMONSTRATE THE HOLE. There is no assertion here that signs up, that PATCHes a role, or
 * that inserts a profiles row. Minting a privileged account is not a read-only act and a harness that
 * proves a control by exercising the escalation is a harness that escalates on every CI run. Reading
 * the deployed definition IS the assertion. The one live behaviour it does exercise is read-only: that
 * every auth user still has a profiles row, which is what "signup still works" means in data.
 *
 * SECTIONS 7 AND 8 WATCH A FOURTH THING, AND IT IS THE OPPOSITE FAILURE. Migration 251 ends the 42P17
 * infinite recursion that made profiles and hospitals -- and 62 other tables that merely read profiles
 * from their own policies -- answer 500 to every RLS-bound caller. Until 251, row-level security was not
 * an enforcement layer on this platform at all: a policy that raises 42P17 decides nothing, which is why
 * 717 files reach for the service role. The recursion was ACCIDENTALLY PROTECTIVE. It made those reads
 * fail, and a fix that replaced the error with a permissive policy would replace it with a leak of 47
 * users' identities. So section 8 does not assert a status code. IT ASSERTS ROW COUNTS, in both
 * directions at once: the service role must count rows in the table (or "anon sees zero" is true of
 * nothing), AND the read as anon must succeed (a failed read is not a denial), AND only then is the count
 * of zero meaningful. Section 7 is the other half -- it pins the COMPLETE set of SELECT policies on both
 * tables by name and each one's expression verbatim, because policies are OR'd and an unexpected fourth
 * SELECT policy on profiles is exactly what a leak would look like from the catalogue.
 *
 * ⚠ CONTROLS BEFORE EVERY ABSENCE CHECK. Half of what follows is of the form "the dangerous thing is
 * not there", and that shape passes gloriously against an empty result -- a registry that returned
 * nothing, a table name that no longer matches, an RPC that was never applied. Fourteen vacuous
 * assertions have been found in this codebase. So no absence is asserted until something that MUST be
 * present has been found in the same result set, and every registry read fails loudly when it comes
 * back empty or truncated.
 *
 * ⚠ RUN IT ALONE. Concurrent harness runs on this project have produced false failures.
 *
 *   npx --yes tsx scripts/practice-auth-guard-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pagedRpc, capWarning } from "./_registry";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY not set");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });
// THE SECOND CLIENT, AND THE ONLY ONE THAT PROVES ANYTHING ABOUT RLS. Every other read in this file runs
// on the service role, which bypasses row-level security entirely -- so no assertion made through `admin`
// can ever tell you whether a policy denies. Section 8 asks the same questions with the key that ships to
// every browser, and section 8 opens by proving this client is genuinely unprivileged before believing a
// single empty answer it gives.
const anonClient = createClient(url, anonKey, { auth: { persistSession: false } });

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};
const section = (title: string) => console.log(`\n${title}\n${"-".repeat(title.length)}`);

type FnRow = { fn_name: string; identity_args: string; lang: string; src: string };
type AttrRow = { fn_name: string; identity_args: string; secdef: boolean; config: string; fn_owner: string };
type RlsRow = { tbl: string; rls_enabled: boolean; policy_name: string | null; cmd: string; roles: string | null; qual: string | null; with_check: string | null };
type GrantRow = { tbl: string; col: string | null; grantee: string; privilege: string };

/** Whitespace carries no meaning in SQL text, and pg_get_expr re-indents. Compare on a stripped copy. */
const squash = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, "");

/**
 * squash(), plus the two other things that carry no meaning in a policy expression: case, and a schema
 * qualification that pg_get_expr adds or drops depending on the reader's search_path. Migration 251 writes
 * `public.current_user_is_super_admin()` and the catalogue renders it back bare -- neither is a difference
 * worth failing on, and neither can be used to widen a policy.
 */
const norm = (s: string | null | undefined) => squash(s).toLowerCase().replace(/public\./g, "");

// The twelve columns migration 249 pinned, in its own order. profiles carries SIX overlapping role
// columns and THREE overlapping tenant columns and different gates read different ones, so a check that
// pinned only `role` would be theatre. If a future edit narrows the pin, this list is what notices.
const AUTHORITY_COLUMNS = [
  "role", "roles", "org_role", "org_roles", "platform_role", "platform_roles",
  "hospital_id", "organisation_id", "tenant_id", "managed_country",
  "is_senior_assessor", "account_status",
];

// The product's own definition of "personal", from src/app/api/account/{profile,avatar}/route.ts.
// These five are what migration 249 granted back at column level after revoking table-level UPDATE.
const PERSONAL_COLUMNS = ["avatar_url", "country", "full_name", "phone", "specialization"];

// ── MIGRATION 251 ────────────────────────────────────────────────────────────────────────────────────
// THE COMPLETE SELECT GRANT ON EACH TABLE, BY POLICY NAME. Postgres OR's permissive policies together, so
// these lists ARE the grant -- the visible rows are the union of what each one admits. That is why the
// assertion below is set EQUALITY and not "contains". A rewrite that fixed the recursion and left behind
// one extra SELECT policy would pass every other check in this file while handing out 47 identities.
// profiles has NO super-admin read policy and that is deliberate: supabase/fix-super-admin-rls-recursion
// dropped it in 2024, super_admins read other people through the service role, and putting it back would
// be a widening dressed up as a repair.
const PROFILES_SELECT_POLICIES = [
  "Country admin reads country profiles", "Group admin reads org profiles", "users_read_own_profile",
].sort();
const HOSPITALS_SELECT_POLICIES = [
  "Authenticated users view hospitals", "Country admin reads country hospitals",
  "Group admin reads org hospitals", "Super admin reads all hospitals",
].sort();

// Each policy's USING expression, normalised. Five of these seven are policies migration 251 does NOT
// touch, and they are here on purpose: they are the control for the two that it does. If the registry, or
// pg_get_expr's rendering, or `norm()` below ever stopped producing what this file expects, the untouched
// five would go red first -- so a green line against a rewritten policy means the comparison works.
const EXPECTED_QUAL: Record<string, string[]> = {
  // profiles -- the two migration 251 rewrote, plus the self-read it left alone
  "Country admin reads country profiles": ["current_user_is_country_admin_for(hospital_id)"],
  "Group admin reads org profiles":       ["current_user_is_group_admin_for_hospital(hospital_id)"],
  "users_read_own_profile":               ["(auth.uid()=id)"],
  // hospitals -- the one migration 251 rewrote, plus the three it left alone
  "Super admin reads all hospitals":       ["current_user_is_super_admin()"],
  "Authenticated users view hospitals":    ["(auth.role()='authenticated'::text)"],
  "Country admin reads country hospitals": ["current_user_is_country_admin_for(id)"],
  "Group admin reads org hospitals":
    ["((organisation_idisnotnull)andcurrent_user_is_group_admin_for(organisation_id))"],
};

// The three SECURITY DEFINER helpers migration 251's policies now depend on. NOT a sweep of every definer
// function on the database -- current_user_is_group_admin_for(uuid) and current_user_is_hospital_admin_for
// (uuid) are also definer with an empty proconfig and are also findings, but 251 does not touch them and
// asserting a state no migration establishes is how a harness ends up permanently red and then ignored.
const HELPERS_251 = [
  "current_user_is_country_admin_for", "current_user_is_group_admin_for_hospital", "current_user_is_super_admin",
];

// Tables that answered anon with 42P17 before migration 251 purely because their own policies read
// profiles -- directly, like departments, or two hops away, like course_enrollments. They are the check
// that the fix cleared the INHERITED recursion and not just the two tables it edits. Sixty-eight tables
// were recursing when 251 was written and 251 clears sixty-four. Each of these six also holds rows the
// service role can count, which is what makes "anon sees zero" mean something.
// ⚠ NOT IN THIS LIST, DELIBERATELY: osce_exams, osce_candidates, osce_stations and osce_results. They
// carry a SECOND recursion cycle among themselves that never touches profiles, migration 251 does not
// address it, and listing them here would make this file permanently and correctly red for a bug it is
// not watching. They need their own migration -- see 251's header.
const RECURSION_SAMPLE = [
  "assessments", "competency_cycles", "course_enrollments", "cpd_logs", "departments", "units",
];

async function main() {
  console.log("\nAuth-guard harness -- the deployed state of the three doors to super_admin\n");

  // ── 0. REGISTRIES, AND THE CONTROLS THAT PROVE THEY ANSWERED ──────────────────────────────────────
  section("0. Registries");

  // `readInFull` DELIBERATELY REQUIRES ROWS. pagedRpc reports suspicious = false for an empty result,
  // so "was read in full" would otherwise be the harness's own first vacuous assertion -- a green line
  // printed underneath a registry that answered with an error.
  const readInFull = (n: number, suspicious: boolean) => n > 0 && !suspicious;

  const fnReg = await pagedRpc<FnRow>(admin, "plat_function_registry", ["fn_name", "identity_args"]);
  ok("plat_function_registry answered (migration 168/170)", !fnReg.error && fnReg.rows.length > 0,
    fnReg.error ?? `${fnReg.rows.length} rows -- an empty registry makes every body check below vacuous`);
  ok("plat_function_registry was read in full", readInFull(fnReg.rows.length, fnReg.suspicious),
    capWarning(fnReg.rows.length));

  const rlsReg = await pagedRpc<RlsRow>(admin, "plat_rls_registry", ["tbl", "policy_name"]);
  ok("plat_rls_registry answered (migration 172)", !rlsReg.error && rlsReg.rows.length > 0,
    rlsReg.error ?? `${rlsReg.rows.length} rows`);
  ok("plat_rls_registry was read in full", readInFull(rlsReg.rows.length, rlsReg.suspicious),
    capWarning(rlsReg.rows.length));

  // Added by migration 250 because NOTHING in this repository could read prosecdef or proconfig, which
  // are exactly the two attributes `create or replace` silently resets.
  const attrReg = await pagedRpc<AttrRow>(admin, "plat_function_attributes", ["fn_name", "identity_args"]);
  ok("plat_function_attributes answered (migration 250 section 3)", !attrReg.error && attrReg.rows.length > 0,
    attrReg.error ?? `${attrReg.rows.length} rows`);
  ok("plat_function_attributes was read in full", readInFull(attrReg.rows.length, attrReg.suspicious),
    capWarning(attrReg.rows.length));

  // Added by migration 250 because nothing could read a grant either -- and migration 249's second
  // mechanism, and migration 250's first, are both grants.
  const grantReg = await pagedRpc<GrantRow>(admin, "plat_table_grants", ["tbl", "col", "grantee", "privilege"]);
  ok("plat_table_grants answered (migration 250 section 4)", !grantReg.error && grantReg.rows.length > 0,
    grantReg.error ?? `${grantReg.rows.length} rows`);
  ok("plat_table_grants was read in full", readInFull(grantReg.rows.length, grantReg.suspicious),
    capWarning(grantReg.rows.length));

  // CROSS-REGISTRY CONTROL. The attribute registry is a second query over pg_proc with the same
  // extension exclusion, so it must see the same functions. If it silently sees fewer, every attribute
  // assertion below is being made about a subset and would pass by not looking.
  const fnNames = new Set(fnReg.rows.map(r => r.fn_name));
  const attrNames = new Set(attrReg.rows.map(r => r.fn_name));
  const unseen = [...fnNames].filter(n => !attrNames.has(n)).sort();
  ok("control: the attribute registry sees every function the body registry sees",
    fnNames.size > 0 && attrNames.size > 0 && unseen.length === 0,
    `${fnNames.size} vs ${attrNames.size}${unseen.length ? `, missing: ${unseen.join(", ")}` : ""}`);

  const profilePolicies = rlsReg.rows.filter(r => r.tbl === "profiles" && r.policy_name);
  ok("control: the policy registry returned policies for profiles",
    profilePolicies.length > 0,
    `${profilePolicies.length} -- with zero rows, every \"no such policy\" check below is vacuous`);
  const policiesUsable = profilePolicies.length > 0;

  const profileGrants = grantReg.rows.filter(r => r.tbl === "profiles");
  ok("control: the grant registry returned grants for profiles",
    profileGrants.length > 0, `${profileGrants.length} rows`);
  // service_role is the read and write path for essentially the whole product. If this is absent the
  // registry is not reporting reality, and "authenticated has no INSERT" would mean nothing.
  const grantsUsable = profileGrants.length > 0
    && profileGrants.some(g => g.grantee === "service_role" && g.col === null && g.privilege === "SELECT");
  ok("control: service_role still holds SELECT on profiles", grantsUsable,
    "the grant every server-side read depends on is not in the registry");

  // ⚠ EVERY "X HOLDS NO PRIVILEGE" ASSERTION BELOW IS GATED ON grantsUsable, AND EVERY "NO SUCH POLICY"
  // ON policiesUsable. Without the gates they are the textbook vacuous assertion: this harness was run
  // once before the gates existed, against a database where plat_table_grants did not yet exist, and it
  // cheerfully printed PASS for "authenticated holds NO INSERT on profiles" off an empty array.
  const UNUSABLE_GRANTS = "the grant registry is unusable -- this absence cannot be trusted";
  const UNUSABLE_POLICIES = "the policy registry returned nothing for profiles -- this absence cannot be trusted";

  // ── 1. DOOR 1 -- THE SIGNUP TRIGGER ───────────────────────────────────────────────────────────────
  section("1. Door 1: handle_new_user(), migration 249 section 1");

  const hnu = fnReg.rows.filter(r => r.fn_name === "handle_new_user");
  ok("handle_new_user() is deployed, exactly once", hnu.length === 1, `${hnu.length} definition(s) found`);

  const body = squash(hnu[0]?.src);
  // CONTROL FOR THE TWO CHECKS THAT FOLLOW. This substring is in the old body AND the new one, so it
  // proves we are looking at the real trigger before anything is asserted about what it does or does
  // not contain. Without it, an empty body passes the negative check and fails only the positive one.
  ok("control: the deployed body is the profile-writing trigger",
    body.includes("insertintopublic.profiles(id,full_name,email,role)"),
    `body is ${body.length} char(s) -- if 0, the assertions below are about nothing`);

  ok("the deployed body CONTAINS the role allow-list",
    body.includes("in('nurse','assessor','educator')"),
    "the clamp added by migration 249 is not in the deployed function");

  // The shape that shipped in supabase/fix-profile.sql and migration 171: the caller's own string, with
  // 'nurse' only as a fallback for blank. This is the unauthenticated escalation, and its absence is the
  // point of the whole file.
  ok("the deployed body does NOT contain the old unclamped coalesce",
    !body.includes("coalesce(nullif(trim(new.raw_user_meta_data->>'role'),''),'nurse')"),
    "the pre-249 body is still deployed -- signup copies a client-supplied role verbatim");

  const hnuAttr = attrReg.rows.find(r => r.fn_name === "handle_new_user");
  ok("control: handle_new_user has a row in the attribute registry", Boolean(hnuAttr),
    "without it the two attribute checks below cannot fail and must not pass");
  // If this is ever false, every signup breaks: a security invoker trigger runs as supabase_auth_admin,
  // which has no rights on public.profiles -- and the function's own `exception when others then return
  // new` would swallow the refusal, so the symptom is silent, profile-less accounts.
  ok("handle_new_user is SECURITY DEFINER", hnuAttr?.secdef === true,
    `prosecdef = ${String(hnuAttr?.secdef)} -- a create-or-replace that omitted the attribute downgraded it`);
  ok("handle_new_user has search_path pinned", (hnuAttr?.config ?? "").includes("search_path="),
    `proconfig = "${hnuAttr?.config ?? ""}" -- an unpinned definer function can be pointed at another schema`);

  // ── 2. DOOR 2 -- THE UPDATE AUTHORITY PIN ─────────────────────────────────────────────────────────
  section("2. Door 2: the profiles UPDATE policy, migration 249 sections 2-4");

  const pau = fnReg.rows.filter(r => r.fn_name === "profile_authority_unchanged");
  ok("profile_authority_unchanged() is deployed, exactly once", pau.length === 1, `${pau.length} definition(s)`);
  const pauBody = squash(pau[0]?.src);
  ok("control: its body reads the caller's own profiles row",
    pauBody.includes("frompublic.profilesp") && pauBody.includes("p.id=auth.uid()"),
    "the deployed body is not the authority check it is named after");
  // `is not distinct from`, not `=`. Most of these columns are null on most rows and null = null is
  // null, so an equality test would refuse every ordinary self-edit. That mistake locks people out.
  ok("it compares with `is not distinct from`, not `=`",
    pauBody.includes("isnotdistinctfrom") && !/p\.role=p_role/.test(pauBody),
    "an equality comparison here refuses every self-edit on a row with null authority columns");

  const pauAttr = attrReg.rows.find(r => r.fn_name === "profile_authority_unchanged");
  ok("control: profile_authority_unchanged has a row in the attribute registry", Boolean(pauAttr));
  // It is called from inside a policy ON profiles. Security invoker would re-enter the policy and, on
  // this database, hit the live 42P17 recursion instead of returning an answer.
  ok("profile_authority_unchanged is SECURITY DEFINER", pauAttr?.secdef === true,
    `prosecdef = ${String(pauAttr?.secdef)}`);
  ok("profile_authority_unchanged has search_path pinned", (pauAttr?.config ?? "").includes("search_path="),
    `proconfig = "${pauAttr?.config ?? ""}"`);

  const upd = profilePolicies.filter(p => p.cmd === "UPDATE");
  ok("profiles has exactly one UPDATE policy", upd.length === 1, `${upd.length} found`);
  const wc = upd[0]?.with_check ?? null;
  // THE ORIGINAL BUG WAS A NULL. Postgres reuses USING as the check when WITH CHECK is absent, so a null
  // here is not "no opinion", it is "any row you can already see, you may write anything into".
  ok("its WITH CHECK is not null", wc !== null && wc.trim().length > 0,
    "with_check is null -- USING is being reused as the check and every column is writable");
  ok("its WITH CHECK names profile_authority_unchanged",
    squash(wc).includes("profile_authority_unchanged("),
    `with_check = ${wc ?? "null"}`);
  const missingCols = AUTHORITY_COLUMNS.filter(c => !new RegExp(`\\b${c}\\b`).test(String(wc ?? "")));
  ok(`its WITH CHECK pins all ${AUTHORITY_COLUMNS.length} authority columns`,
    wc !== null && missingCols.length === 0,
    missingCols.length ? `not pinned: ${missingCols.join(", ")}` : "");
  ok("the UPDATE policy is scoped to authenticated", upd[0]?.roles === "authenticated",
    `roles = ${upd[0]?.roles ?? "null (PUBLIC)"}`);

  // Migration 249 section 4: the layer enforced by the privilege system rather than by evaluating an
  // expression, so it holds even where RLS on this table is currently unreliable.
  const tableUpdate = (who: string) =>
    profileGrants.some(g => g.grantee === who && g.col === null && g.privilege === "UPDATE");
  ok("authenticated holds NO table-level UPDATE on profiles",
    grantsUsable && !tableUpdate("authenticated"), grantsUsable ? "" : UNUSABLE_GRANTS);
  ok("anon holds NO table-level UPDATE on profiles",
    grantsUsable && !tableUpdate("anon"), grantsUsable ? "" : UNUSABLE_GRANTS);
  const colUpdate = profileGrants
    .filter(g => g.grantee === "authenticated" && g.col !== null && g.privilege === "UPDATE")
    .map(g => String(g.col)).sort();
  // CONTROL AND ASSERTION AT ONCE. If the column dimension of the registry were broken this list would
  // be empty, which would also make the "no table-level UPDATE" pass above meaningless -- the two
  // together are the only way authenticated can still edit its own name.
  ok(`authenticated holds column-level UPDATE on exactly the ${PERSONAL_COLUMNS.length} personal columns`,
    colUpdate.length > 0 && colUpdate.join(",") === PERSONAL_COLUMNS.join(","),
    `found [${colUpdate.join(", ") || "none"}], expected [${PERSONAL_COLUMNS.join(", ")}]`);

  // ── 3. DOOR 3 -- THE INSERT DOOR ──────────────────────────────────────────────────────────────────
  section("3. Door 3: the profiles INSERT door, migration 250");

  const ins = profilePolicies.filter(p => p.cmd === "INSERT" || p.cmd === "ALL");
  ok("profiles has NO INSERT policy for any role", policiesUsable && ins.length === 0,
    policiesUsable ? ins.map(p => `${p.policy_name}[${p.cmd}] with_check=${p.with_check ?? "null"}`).join(" | ")
      : UNUSABLE_POLICIES);
  ok("the policy \"Users insert own profile\" is gone by name",
    policiesUsable && !profilePolicies.some(p => p.policy_name === "Users insert own profile"),
    policiesUsable ? "supabase/fix-profile.sql's insert policy is still deployed" : UNUSABLE_POLICIES);

  const anyInsert = (who: string) =>
    profileGrants.filter(g => g.grantee === who && g.privilege === "INSERT");
  const authedIns = anyInsert("authenticated");
  ok("authenticated holds NO INSERT on profiles, at table or column level",
    grantsUsable && authedIns.length === 0,
    grantsUsable ? authedIns.map(g => g.col ?? "TABLE").join(", ") : UNUSABLE_GRANTS);
  const anonIns = anyInsert("anon");
  ok("anon holds NO INSERT on profiles, at table or column level",
    grantsUsable && anonIns.length === 0,
    grantsUsable ? anonIns.map(g => g.col ?? "TABLE").join(", ") : UNUSABLE_GRANTS);
  // THE OVERREACH CHECK. A revoke that also caught service_role would break super-admin user creation,
  // the enterprise people API, the practice provisioning saga and both signup write-backs -- and would
  // do it silently, because two of those three upserts discard their error.
  ok("service_role STILL holds INSERT on profiles",
    profileGrants.some(g => g.grantee === "service_role" && g.col === null && g.privilege === "INSERT"),
    "the revoke overreached -- every server-side profile write is now broken");

  // ── 4. THE INTERLOCKS ─────────────────────────────────────────────────────────────────────────────
  section("4. Interlocks");

  ok("row-level security is enabled on profiles",
    profilePolicies.length > 0 && profilePolicies.every(p => p.rls_enabled === true),
    "six tables on this database already have RLS off -- policies on a table without RLS decide nothing");
  // Not a style preference. Door 3 was survivable only because a user cannot delete their own row and
  // so cannot get past the primary key. Migration 250 removes the need for that luck, and this asserts
  // nobody quietly reintroduces the other half of the pair.
  ok("profiles still has NO DELETE policy",
    policiesUsable && !profilePolicies.some(p => p.cmd === "DELETE" || p.cmd === "ALL"),
    policiesUsable
      ? "a DELETE policy on profiles is the second half of the INSERT escalation -- review it deliberately"
      : UNUSABLE_POLICIES);

  // ── 5. SIGNUP STILL WORKS, IN DATA ────────────────────────────────────────────────────────────────
  section("5. Signup still produces a profile");

  const users: { id: string }[] = [];
  let authErr: string | null = null;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) { authErr = error.message; break; }
    const batch = data.users ?? [];
    users.push(...batch.map(u => ({ id: u.id })));
    if (batch.length < 200) break;
  }
  ok("control: the auth admin listing returned users", !authErr && users.length > 0,
    authErr ?? `${users.length} -- with zero, the coverage check below cannot fail`);

  const profileIds = new Set<string>();
  let profErr: string | null = null;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("profiles").select("id").range(from, from + 999);
    if (error) { profErr = error.message; break; }
    const batch = (data ?? []) as { id: string }[];
    for (const p of batch) profileIds.add(p.id);
    if (batch.length < 1000) break;
  }
  ok("control: profiles was read", !profErr && profileIds.size > 0, profErr ?? `${profileIds.size} rows`);

  // THE ONLY LIVE-BEHAVIOUR ASSERTION IN THE FILE, AND IT IS A READ. Between the security definer
  // trigger and the three service-role write-backs, an auth user without a profiles row means account
  // creation has stopped working -- which is the exact failure a revoke on profiles could cause and the
  // one this harness must be able to catch.
  const orphans = users.filter(u => !profileIds.has(u.id));
  ok("every auth user has a profiles row", users.length > 0 && orphans.length === 0,
    `${orphans.length} of ${users.length} auth user(s) have no profile -- signup is no longer writing one`);

  // ── 6. THE SOURCE-SIDE PRECONDITION ───────────────────────────────────────────────────────────────
  section("6. Source guard: no browser-side INSERT into profiles");

  // Migration 250 is only safe because every INSERT into profiles in src/ runs on the service role. That
  // is a property of the application, which changes far more often than a policy does -- so it is worth
  // asserting rather than remembering. This is the one check here that reads files, and it reads the
  // application, never the migrations.
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
    }
  };
  try { walk(join(process.cwd(), "src")); } catch { /* reported by the control below */ }
  ok("control: the source scan found files to read", files.length > 0,
    `${files.length} -- run this from the repository root`);

  const WRITE = /from\(\s*["'`]profiles["'`]\s*\)\s*\.\s*(insert|upsert)\s*\(/g;
  const sites: { file: string; serviceRole: boolean }[] = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(WRITE)) {
      const lead = text.slice(Math.max(0, m.index - 160), m.index);
      sites.push({ file: f.replace(process.cwd(), "").replace(/\\/g, "/"), serviceRole: /admin\b/.test(lead) });
    }
  }
  // CONTROL. Three such sites exist today. Zero means the pattern stopped matching, and "none of them is
  // browser-side" would then be true of nothing at all.
  ok("control: the scan found profiles insert sites at all", sites.length > 0,
    `${sites.length} found -- if 0, the regex no longer matches this codebase`);
  const browserSide = sites.filter(s => !s.serviceRole);
  ok("every INSERT into profiles in src/ runs on a service-role client",
    sites.length > 0 && browserSide.length === 0,
    sites.length ? browserSide.map(s => s.file).join(", ") : "nothing was scanned -- this absence is vacuous");
  for (const s of sites) console.log(`        ${s.serviceRole ? "service role" : "BROWSER SIDE"}  ${s.file}`);

  // ── 7. MIGRATION 251 -- THE RECURSION, AND THE SHAPE THAT REPLACED IT ─────────────────────────────
  section("7. Migration 251: the 42P17 recursion on profiles and hospitals");

  const hospitalPolicies = rlsReg.rows.filter(r => r.tbl === "hospitals" && r.policy_name);
  ok("control: the policy registry returned policies for hospitals", hospitalPolicies.length > 0,
    `${hospitalPolicies.length} -- with zero rows every shape check below is vacuous`);
  const hospitalsUsable = hospitalPolicies.length > 0;
  const bothUsable = policiesUsable && hospitalsUsable;
  const UNUSABLE_BOTH = "the policy registry did not return both tables -- these checks cannot be trusted";

  // THE ANTI-WIDENING ASSERTION, AND THE MOST IMPORTANT ONE IN THIS FILE AFTER SECTION 8'S ROW COUNTS.
  // Set equality, not membership. Fixing a recursion by deleting a policy would pass a membership check
  // and so would fixing it by adding one.
  const profileSelectNames = profilePolicies.filter(p => p.cmd === "SELECT").map(p => String(p.policy_name)).sort();
  ok(`profiles carries exactly the ${PROFILES_SELECT_POLICIES.length} expected SELECT policies and no others`,
    policiesUsable && profileSelectNames.join(" | ") === PROFILES_SELECT_POLICIES.join(" | "),
    policiesUsable ? `found [${profileSelectNames.join(", ") || "none"}]` : UNUSABLE_POLICIES);
  const hospitalSelectNames = hospitalPolicies.filter(p => p.cmd === "SELECT").map(p => String(p.policy_name)).sort();
  ok(`hospitals carries exactly the ${HOSPITALS_SELECT_POLICIES.length} expected SELECT policies and no others`,
    hospitalsUsable && hospitalSelectNames.join(" | ") === HOSPITALS_SELECT_POLICIES.join(" | "),
    hospitalsUsable ? `found [${hospitalSelectNames.join(", ") || "none"}]` : UNUSABLE_BOTH);

  const both = [...profilePolicies, ...hospitalPolicies];
  const exprOf = (p: RlsRow) => `${p.qual ?? ""} ${p.with_check ?? ""}`;
  // CONTROL FOR THE TWO ABSENCE CHECKS THAT FOLLOW. "No policy contains a subquery" is true of a policy
  // whose expression the registry returned as null, and every policy on these two tables has a USING
  // expression today. If that stops being so, this goes red before the absences can pass by not looking.
  const withExpr = both.filter(p => squash(p.qual).length > 0).length;
  ok("control: every policy on profiles and hospitals came back with a USING expression",
    both.length > 0 && withExpr === both.length,
    `${withExpr} of ${both.length} -- an absent expression makes the two checks below vacuous`);

  // THE RECURSION ITSELF, STATED AS A SHAPE. A policy on profiles whose expression selects FROM profiles
  // re-enters the same policy: that is 42P17. All three of the policies migration 251 rewrote did it --
  // the two on profiles directly, and hospitals' super-admin policy through the pair of them. After 251
  // no policy on either table reads a table at all, so no cycle can pass through them.
  const withSubquery = both.filter(p => /\bfrom\b/i.test(exprOf(p)));
  ok("no policy on profiles or hospitals evaluates a subquery",
    bothUsable && withExpr === both.length && withSubquery.length === 0,
    bothUsable ? withSubquery.map(p => `${p.tbl}."${p.policy_name}"`).join(", ") : UNUSABLE_BOTH);
  const namesATable = both.filter(p => /\b(profiles|hospitals)\b/i.test(exprOf(p)));
  ok("no policy on profiles or hospitals names either table in its expression",
    bothUsable && withExpr === both.length && namesATable.length === 0,
    bothUsable ? namesATable.map(p => `${p.tbl}."${p.policy_name}"`).join(", ") : UNUSABLE_BOTH);

  // EACH EXPRESSION VERBATIM. The two checks above forbid a subquery, but not `... or true`, and a policy
  // that calls the right helper and then ORs a constant is a full-table leak that mentions no table. Only
  // exact equality against the whole normalised expression rules that out.
  for (const name of Object.keys(EXPECTED_QUAL).sort()) {
    const p = both.find(x => x.policy_name === name);
    const actual = norm(p?.qual);
    const accepted = EXPECTED_QUAL[name].map(a => norm(a));
    ok(`"${name}" USING is exactly the expected expression`,
      Boolean(p) && accepted.includes(actual),
      p ? `found ${actual || "(empty)"}, expected one of ${accepted.join(" | ")}` : "policy not found on either table");
  }

  // Migration 251 recreated three policies. CREATE POLICY without a TO clause is PUBLIC, which is what all
  // three carried before. Adding "to authenticated" would read as a tightening and would in fact be one --
  // this file's job is to notice a change of scope in EITHER direction.
  const rewritten = ["Country admin reads country profiles", "Group admin reads org profiles",
    "Super admin reads all hospitals"];
  const narrowed = rewritten.filter(n => (both.find(p => p.policy_name === n)?.roles ?? null) !== null);
  ok("the three rewritten policies are still scoped to PUBLIC, as they were before",
    bothUsable && rewritten.every(n => both.some(p => p.policy_name === n)) && narrowed.length === 0,
    bothUsable ? narrowed.map(n => `${n} -> ${both.find(p => p.policy_name === n)?.roles}`).join(", ") : UNUSABLE_BOTH);

  // ── 7b. THE HELPERS THOSE POLICIES NOW DEPEND ON ──────────────────────────────────────────────────
  section("7b. The SECURITY DEFINER helpers migration 251 leans on");

  for (const h of HELPERS_251) {
    const rows = attrReg.rows.filter(r => r.fn_name === h);
    ok(`control: ${h} has exactly one row in the attribute registry`, rows.length === 1,
      `${rows.length} row(s) -- without exactly one, the two checks below cannot fail and must not pass`);
    // THE WHOLE MECHANISM OF THE FIX. A definer function runs as its owner, so its read of profiles is not
    // the caller's read and does not re-enter the caller's policy. Downgraded to security invoker -- which
    // is precisely what a `create or replace` that forgot the attribute would do -- every one of these
    // calls re-enters the profiles policies and 42P17 comes straight back.
    ok(`${h} is SECURITY DEFINER`, rows[0]?.secdef === true,
      `prosecdef = ${String(rows[0]?.secdef)} -- security invoker here puts the recursion back`);
    // An unpinned definer function can be pointed at another schema's profiles table by a caller who
    // controls search_path. For an authorization predicate that means it can be made to answer yes.
    ok(`${h} has search_path pinned`, (rows[0]?.config ?? "").includes("search_path="),
      `proconfig = "${rows[0]?.config ?? ""}"`);
  }

  const gah = fnReg.rows.filter(r => r.fn_name === "current_user_is_group_admin_for_hospital");
  ok("current_user_is_group_admin_for_hospital() is deployed, exactly once", gah.length === 1,
    `${gah.length} definition(s) -- migration 251 section 1`);
  const gahBody = norm(gah[0]?.src);
  // CONTROL BEFORE THE ASSERTIONS, same shape as section 1: prove we are looking at the real body first.
  ok("control: the deployed body is the group-admin-over-a-hospital predicate",
    // norm() strips "public." -- so the expected text must be written POST-normalisation. Written with
    // the schema prefix, this control could never have matched any body, correct or not: it would have
    // reported the real deployed helper as the wrong one, forever.
    gahBody.includes("fromprofilesp") && gahBody.includes("joinhospitalshonh.id=p_hospital_id"),
    `body is ${gahBody.length} char(s) -- if 0, the assertions below are about nothing`);
  // WHY THIS HELPER EXISTS AT ALL. The obvious substitution was the existing organisation-keyed
  // current_user_is_group_admin_for(organisation_id). It is the WRONG ARGUMENT: the policy keys off the
  // organisation of the row's HOSPITAL, not off the row's own organisation_id column, and on the deployed
  // data 25 of the 32 profiles rows that carry a hospital_id have organisation_id null. That substitution
  // would have silently narrowed the policy by 25 rows out of 32 while looking correct.
  ok("it keys the caller off auth.uid() and the row off its HOSPITAL's organisation",
    gahBody.includes("p.id=auth.uid()") && gahBody.includes("h.organisation_id=p.organisation_id"),
    "the predicate no longer matches the policy it replaced");
  ok("it tests for group_admin and for no other role",
    gahBody.includes("p.role='group_admin'") && !gahBody.includes("super_admin"),
    "a widened role test here hands profiles rows to whoever it names");

  // ── 8. LIVE, AS ANON: 200 IS NOT THE ASSERTION, THE ROW COUNT IS ──────────────────────────────────
  section("8. Migration 251 live: anon gets 200, and zero rows");

  // ⚠ THE IDENTITY CONTROL, AND NOTHING BELOW MEANS ANYTHING WITHOUT IT. Every assertion in this section
  // is of the form "this client saw no rows". If `anonClient` were accidentally holding the service-role
  // key it would see EVERY row and the section would go red, which is safe. The dangerous direction is the
  // other one: a client that errors on every request, or a key that grants nothing at all, also sees no
  // rows -- and would print a full green page while proving nothing. So: the key must differ from the
  // service key, and the client must be refused a function that is granted to service_role alone.
  ok("control: the anon key is not the service-role key", anonKey !== key,
    "the two keys are identical -- section 8 is not testing an unprivileged caller");
  const identity = await anonClient.rpc("plat_rls_registry");
  ok("control: the anon client is refused a service-role-only function",
    identity.error !== null && /permission denied/i.test(identity.error?.message ?? ""),
    identity.error ? `unexpected error: ${identity.error.message}` : "it was ALLOWED -- this client is privileged");

  type Counted = { count: number | null; rows: number; error: string | null };
  /**
   * `limit(1)`, NOT `head: true`. A head request returns no body, so PostgREST's error JSON never arrives
   * and a 42P17 comes back through supabase-js as an error with an empty message and no code -- which is
   * exactly the diagnostic this section exists to print. One row costs nothing and keeps the code.
   *
   * Two independent measures come back: PostgREST's exact count over the whole policy-filtered set, and
   * the number of rows it was actually willing to hand over. A leak shows up in both, and a null count
   * cannot quietly stand in for zero.
   */
  const countRows = async (c: SupabaseClient, table: string): Promise<Counted> => {
    const { data, count, error } = await c.from(table).select("*", { count: "exact" }).limit(1);
    return {
      count: count ?? null,
      rows: (data ?? []).length,
      error: error ? `${(error as { code?: string }).code ?? "?"} ${error.message}` : null,
    };
  };

  for (const t of ["profiles", "hospitals"]) {
    const svc = await countRows(admin, t);
    const an = await countRows(anonClient, t);
    // CONTROL FIRST. Against an empty table "anon sees zero rows" is true and means nothing.
    ok(`control: the service role counts rows in ${t}`, svc.error === null && (svc.count ?? 0) > 0,
      svc.error ?? `${svc.count} rows -- on an empty table the denial below is true of nothing`);
    // THE RECURSION, MEASURED. This is the assertion that goes red if 42P17 merely moved instead of
    // clearing -- and it is deliberately NOT combined with the row count, so the two failures read apart.
    ok(`anon reads ${t} without 42P17`, an.error === null,
      an.error ?? "");
    // ⚠ AND THIS IS THE ONE THAT MATTERS. A 200 alone is the failure mode this whole migration risks:
    // before 251 the recursion made these reads FAIL, which was accidentally protective, and a permissive
    // rewrite would swap the error for a leak. Gated on the read having SUCCEEDED and on the table being
    // non-empty, because "zero rows" off a failed request is the textbook vacuous assertion.
    ok(`anon reads EXACTLY 0 of the ${svc.count ?? "?"} rows in ${t}`,
      an.error === null && an.count === 0 && an.rows === 0 && (svc.count ?? 0) > 0,
      an.error ? "the read failed -- a failed read is not a denial" : `anon counted ${an.count} and was handed ${an.rows} row(s)`);
  }

  // THE INHERITED RECURSION. Sixty-eight tables were answering 42P17 when 251 was written, and only two of
  // them are tables 251 edits. The other sixty-six were innocent -- they inherited the fault the moment
  // their own policies read profiles. If the fix were incomplete these would still be 500.
  const sample: { t: string; svc: Counted; an: Counted }[] = [];
  for (const t of RECURSION_SAMPLE) sample.push({ t, svc: await countRows(admin, t), an: await countRows(anonClient, t) });
  const populated = sample.filter(s => s.svc.error === null && (s.svc.count ?? 0) > 0);
  ok(`control: the service role counts rows in all ${RECURSION_SAMPLE.length} inherited-recursion tables`,
    populated.length === RECURSION_SAMPLE.length,
    sample.filter(s => !populated.includes(s)).map(s => `${s.t}=${s.svc.error ?? s.svc.count}`).join(", "));
  const stillRecursing = sample.filter(s => s.an.error !== null);
  ok("the 42P17 has cleared on the tables that only inherited it",
    populated.length === RECURSION_SAMPLE.length && stillRecursing.length === 0,
    stillRecursing.map(s => `${s.t}: ${s.an.error}`).join(" | "));
  const leaking = sample.filter(s => s.an.error === null && (s.an.count !== 0 || s.an.rows !== 0));
  ok("anon reads zero rows from every one of them",
    populated.length === RECURSION_SAMPLE.length && stillRecursing.length === 0 && leaking.length === 0,
    leaking.map(s => `${s.t}: anon sees ${s.an.count} of ${s.svc.count}`).join(", "));
  for (const s of sample) {
    console.log(`        ${String(s.an.error ?? `anon ${s.an.count}`).padEnd(24)} of ${String(s.svc.count).padEnd(4)} ${s.t}`);
  }

  // THE MECHANISM, EXERCISED RATHER THAN READ. Section 7b asserts the helpers are definer from the
  // catalogue. These three prove it does what definer is for: each reads profiles from inside a policy-
  // bearing table while an unauthenticated caller is asking, and answers instead of recursing.
  const oneHospital = await admin.from("hospitals").select("id").limit(1).single();
  const hospitalId = (oneHospital.data as { id: string } | null)?.id;
  // CONTROL. A random uuid would make the two hospital-keyed helpers return false because the hospital
  // does not exist, which is the right answer for the wrong reason. With a REAL id the join finds its row,
  // so a false is attributable to the role test -- the thing actually being asserted.
  ok("control: a real hospitals id was read for the helper probes",
    oneHospital.error === null && Boolean(hospitalId),
    oneHospital.error?.message ?? "no hospitals row -- the two probes below would pass for the wrong reason");

  const asAnon = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await anonClient.rpc(fn, args);
    return { data, error: error ? error.message : null };
  };
  const probes: [string, Record<string, unknown>][] = [
    ["current_user_is_super_admin", {}],
    ["current_user_is_country_admin_for", { p_hospital_id: hospitalId }],
    ["current_user_is_group_admin_for_hospital", { p_hospital_id: hospitalId }],
  ];
  for (const [fn, args] of probes) {
    const r = await asAnon(fn, args);
    // `=== false`, not `!r.data`. null, undefined and an error object are all falsy, and every one of them
    // would mean the probe did not run.
    ok(`${fn}() answers an unauthenticated caller with false, not an error`,
      r.error === null && r.data === false,
      r.error ?? `returned ${JSON.stringify(r.data)} -- expected the boolean false`);
  }

  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}\n`);
  process.exit(fails.length ? 1 : 0);
}

main();
