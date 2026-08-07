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
import { createClient } from "@supabase/supabase-js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pagedRpc, capWarning } from "./_registry";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

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

  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}\n`);
  process.exit(fails.length ? 1 : 0);
}

main();
