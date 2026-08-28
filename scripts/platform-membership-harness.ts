/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PLATFORM MEMBERSHIP HARNESS -- CP-SPLIT-002 stages 1 to 4, COMP-ARCH-PSA-001 sections 7, 11, 14, 40.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS EXISTS TO KEEP TRUE.
 *
 *   1. AN IDENTITY WITH NO PLATFORM MEMBERSHIP REACHES NONE OF THE ELEVEN ESTATE SURFACES -- AND A
 *      NURSE WHO HAS ONE STILL REACHES WHAT THEY REACHED BEFORE. The second half is the CONTROL, and
 *      without it "denied" also passes when the estate is broken for everybody.
 *   2. THE TWO OWNER ACCOUNTS CANNOT BE LOCKED OUT. Proven by making the membership read actually FAIL
 *      -- a client with a dead key -- and asserting a super_admin is still admitted, having performed
 *      no read at all.
 *   3. A FAILED READ IS A THIRD STATE. Unreadable admits and REPORTS "unreadable". It is never folded
 *      into "not a member", which would blank the estate for 47 people during an outage.
 *   4. COMPETEN PRACTICE REGISTRATION CREATES NO PLATFORM STATE -- no estate role, no membership --
 *      with a control proving the registration otherwise SUCCEEDED (a real workspace and a real
 *      practice membership come out of the same run).
 *   5. AFTER THE BACKFILL, EVERY EXISTING IDENTITY STILL REACHES WHAT IT REACHED BEFORE. Asserted as a
 *      COUNT over the whole directory, not a sample.
 *
 * ⚠ VACUITY. The three traps found in this repo this week are each guarded:
 *      (a) scanning source for a phrase that also appears in this file's own comment -- COMMENTS ARE
 *          STRIPPED BEFORE EVERY SCAN, and the stripper itself is asserted against this file, which
 *          deliberately mentions admitToEstate and grantPlatformMembership in prose. Every negative
 *          scan is paired with a positive scan over a file that MUST contain the phrase.
 *      (b) asserting over an EMPTY LIST -- every list assertion is preceded by a non-emptiness one.
 *      (c) a harness that re-implements the rule it tests -- admitToEstate, readPlatformMembership,
 *          grantPlatformMembership, practiceIdentityProfile and highestRole are all IMPORTED. Nothing
 *          below restates the membership rule.
 *
 * ⚠ MIGRATIONS 279 AND 280 ARE APPLIED BY HAND. Until 279 is applied every store-dependent assertion
 * reports PEND, never PASS, and the totals say so. 280 is optional and reported separately -- the
 * harness must pass both before and after it.
 *
 * ⚠ RUN IT ALONE. Other agents run harnesses against this database concurrently.
 *
 *   npx --yes tsx scripts/platform-membership-harness.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  admitToEstate, readPlatformMembership, grantPlatformMembership, practiceIdentityProfile,
  holdsEstateBreakGlass, PLATFORM_MEMBERSHIP_TABLE, NO_MEMBERSHIP_DESTINATION,
} from "../src/lib/platform-membership";
import { highestRole, hasEstateRole, type AppRole } from "../src/lib/roles";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });
// The store that will not answer. Used to prove the break-glass and the third state, because a stub
// object proves the code path and a dead key proves the code path AND the client library's behaviour.
const deadStore = createClient(url, "this-key-is-not-valid", { auth: { persistSession: false } });

const MIG_279 = "supabase/migrations/279-platform-membership.sql";
const MIG_280 = "supabase/migrations/280-mullen-corrective-migration.sql";

// The eleven estate layouts named in CP-SPLIT-002 s2. If this list shrinks, the count assertion fails.
const ESTATE_LAYOUTS = [
  "admin", "assessor", "competency-office", "dashboard", "educator", "hospital-executive",
  "platform-admin", "quality-accreditation", "super-admin", "supervisor", "unit-manager",
].map(d => `src/app/${d}/layout.tsx`);

const PRACTICE_SIGNUP = "src/app/api/v1/practice/signup/route.ts";
const ESTATE_SIGNUP = "src/app/api/auth/signup/route.ts";
const PRACTICE_SHELL = "src/app/practice/(shell)/layout.tsx";
const GUARD_MODULE = "src/lib/platform-membership.ts";

// Fixture identities. auth.admin.createUser assigns the uuid, so these are tracked by EMAIL. The
// harness deletes them and then asserts the deletion.
const FIX_PRACTICE_EMAIL = "harness-cpsplit-practice@competen.test";
const FIX_ESTATE_EMAIL = "harness-cpsplit-estate@competen.test";
const CID = "cpsplit-002-harness";

let pass = 0, pend = 0;
const fails: string[] = [];
const ok = (id: string, cond: boolean, msg: string, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { fails.push(`${id}  ${msg}${detail ? ` -- ${detail}` : ""}`); console.log(`  FAIL  ${id}  ${msg}${detail ? ` -- ${detail}` : ""}`); }
};
const skip = (id: string, msg: string, why: string) => { pend++; console.log(`  PEND  ${id}  ${msg} (${why})`); };

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");

/**
 * Strip TypeScript comments, honouring string and template literals so a `//` inside a URL is not
 * mistaken for a comment. Used before EVERY source scan, because this file talks about the very
 * identifiers it scans for and would otherwise be reading its own prose.
 */
function stripComments(src: string): string {
  let out = "", i = 0;
  let inLine = false, inBlock = false, quote: string | null = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (inLine) { if (c === "\n") { inLine = false; out += c; } i++; continue; }
    if (inBlock) { if (c === "*" && d === "/") { inBlock = false; i += 2; } else i++; continue; }
    if (quote) {
      out += c;
      if (c === "\\") { out += d ?? ""; i += 2; continue; }
      if (c === quote) quote = null;
      i++; continue;
    }
    if (c === "/" && d === "/") { inLine = true; i += 2; continue; }
    if (c === "/" && d === "*") { inBlock = true; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

/**
 * Strip SQL line comments, honouring string literals.
 *
 * ⚠ THIS IS VACUITY TRAP (a), AND IT CAUGHT ME WHILE WRITING THIS FILE. The assertion "the unique index
 * has no WHERE clause" passed against the raw migration text only because the migration's own comment
 * says "has no WHERE clause and never will" 40 characters earlier. Every structural assertion over a
 * migration below runs on the stripped text.
 */
function stripSqlComments(src: string): string {
  return src.split(/\r?\n/).map(line => {
    let out = "", inStr = false, j = 0;
    while (j < line.length) {
      const c = line[j], d = line[j + 1];
      if (!inStr && c === "-" && d === "-") break;
      if (c === "'") inStr = !inStr;
      out += c; j++;
    }
    return out;
  }).join("\n");
}

/** A SQL comment / literal linter matching the migration rules the owner applies by hand. */
function lintSql(file: string): string[] {
  const src = read(file);
  const problems: string[] = [];
  if (!src) return ["file missing"];
  if (/[^\x00-\x7F]/.test(src)) problems.push("non-ASCII byte");
  let inStr = false;
  src.split(/\r?\n/).forEach((line, n) => {
    let j = 0, inComment = false;
    while (j < line.length) {
      const c = line[j], d = line[j + 1];
      if (!inStr && !inComment && c === "-" && d === "-") { inComment = true; j += 2; continue; }
      if (!inComment && c === "'") { inStr = !inStr; j++; continue; }
      if (inComment && c === ";") problems.push(`L${n + 1} semicolon inside a comment`);
      if (inStr && c === "-" && d === "-") problems.push(`L${n + 1} double-dash inside a string literal`);
      j++;
    }
  });
  if (inStr) problems.push("unterminated string literal");
  if (!/notify pgrst, 'reload schema';\s*$/.test(src.trimEnd() + "\n")) problems.push("notify pgrst is not the last statement");
  if (/\bdo\s*\$\$/i.test(src)) problems.push("anonymous do-block");
  return problems;
}

// A structural stub of the Supabase query builder, so the ordering assertions do not need a network.
function stubStore(result: { data: any; error: any } | "explode") {
  let reads = 0;
  const api = {
    get reads() { return reads; },
    from() {
      reads++;
      if (result === "explode") throw new Error("the store was read, and it must not have been");
      const chain: any = {
        select: () => chain, eq: () => chain,
        maybeSingle: async () => result,
      };
      return chain;
    },
  };
  return api;
}

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "independent", locale: "en-UG",
  termsVersion: "harness", privacyNoticeVersion: "harness", source: "pilot",
});

async function findFixture(email: string) {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  return (data?.users ?? []).find(u => u.email === email) ?? null;
}

async function cleanupFixtures() {
  for (const email of [FIX_PRACTICE_EMAIL, FIX_ESTATE_EMAIL]) {
    const u = await findFixture(email);
    if (!u) continue;
    await purgeWorkspacesOwnedBy(admin, [u.id]);
    await admin.from("provisioning_request").delete().eq("target_user_id", u.id);
    await admin.from("practice_audit_event").delete().eq("actor_id", u.id);
    await admin.from(PLATFORM_MEMBERSHIP_TABLE).delete().eq("user_id", u.id);
    await admin.from("profiles").delete().eq("id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
}

async function main() {
  console.log("\nPlatform membership harness -- CP-SPLIT-002 stages 1-4\n");

  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  // A. THE RULE ITSELF. No database, no files -- the imported functions, exercised directly.
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  console.log("A. the rule");

  ok("A1", highestRole([]) === null, "highestRole of no roles is null, not a nurse badge");
  ok("A1c", highestRole(["nurse"]) === "nurse", "CONTROL: highestRole still resolves a role it is given");
  ok("A2", hasEstateRole([]) === false && hasEstateRole(["nurse"]) === true,
    "hasEstateRole answers both ways");
  ok("A3", holdsEstateBreakGlass(["super_admin"]) === true && holdsEstateBreakGlass(["hospital_admin"]) === false,
    "the break-glass predicate is super_admin and nothing else");

  // The ordering property, asserted by making a read IMPOSSIBLE rather than by inspecting the source.
  const exploding = stubStore("explode");
  let ownerAdmission: any = null, threw = false;
  try { ownerAdmission = await admitToEstate(exploding as any, "u", ["super_admin"]); } catch { threw = true; }
  ok("A4", !threw && ownerAdmission?.admitted === true && ownerAdmission?.reason === "owner_break_glass"
      && (exploding as any).reads === 0,
    "a super_admin is admitted WITHOUT the membership store being read at all");

  const exploding2 = stubStore("explode");
  const bgAdmission = await admitToEstate(exploding2 as any, "u", ["nurse"], { breakGlass: true });
  ok("A5", bgAdmission.admitted && bgAdmission.reason === "owner_break_glass" && (exploding2 as any).reads === 0,
    "the platform_owner break-glass also short-circuits before the read");

  const errStore = stubStore({ data: null, error: { code: "PGRST205" } });
  const unreadable = await admitToEstate(errStore as any, "u", ["nurse"]);
  ok("A6", unreadable.admitted === true && unreadable.membership === "unreadable"
      && unreadable.reason === "store_unreadable",
    "an UNREADABLE store admits and reports the third state");

  const absent = stubStore({ data: null, error: null });
  const refused = await admitToEstate(absent as any, "u", ["nurse"]);
  ok("A7", refused.admitted === false && refused.membership === "not_member",
    "CONTROL: the same code path REFUSES when the read completes and finds nothing -- so A6 is not "
    + "passing because everything is admitted");

  const active = await admitToEstate(stubStore({ data: { status: "active" }, error: null }) as any, "u", ["nurse"]);
  const susp = await admitToEstate(stubStore({ data: { status: "suspended" }, error: null }) as any, "u", ["nurse"]);
  const revoked = await admitToEstate(stubStore({ data: { status: "revoked" }, error: null }) as any, "u", ["nurse"]);
  ok("A8", active.admitted && !susp.admitted && !revoked.admitted,
    "active admits, suspended and revoked refuse");

  const thrower = { from() { throw new Error("network"); } };
  const thrown = await readPlatformMembership(thrower as any, "u");
  ok("A9", thrown.state === "unreadable", "a THROWN read is as unreadable as a returned error");

  ok("A10", NO_MEMBERSHIP_DESTINATION === "/practice/home",
    "a refused identity is sent to the product it belongs to, not to a dead end");

  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  // B. THE SOURCE. Comments stripped first, every negative paired with a positive control.
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nB. the source (comments stripped)");

  // The stripper, asserted against THIS file, which names both identifiers in prose above.
  const selfRaw = read("scripts/platform-membership-harness.ts");
  const selfStripped = stripComments(selfRaw);
  ok("B0a", selfRaw.length > 0 && selfRaw.includes("admitToEstate, readPlatformMembership"),
    "CONTROL: this harness file was read and does contain the identifiers in prose");
  ok("B0b", !/\* {3}1\. AN IDENTITY WITH NO PLATFORM MEMBERSHIP/.test(selfStripped),
    "the comment stripper removes this file's own prose, so a scan cannot read its own claims");

  const layoutSrcs = ESTATE_LAYOUTS.map(f => [f, stripComments(read(f))] as const);
  ok("B1a", layoutSrcs.length === 11 && layoutSrcs.every(([, s]) => s.length > 0),
    `CONTROL: all 11 estate layouts were found and read (${layoutSrcs.filter(([, s]) => s.length > 0).length}/11)`);
  const missingGuard = layoutSrcs.filter(([, s]) => !/admitToEstate\s*\(/.test(s)).map(([f]) => f);
  ok("B1b", missingGuard.length === 0,
    "every one of the 11 estate layouts calls the shared guard", missingGuard.join(", "));
  // ⚠ `redirect(...)`, NOT merely the identifier. The first version of this assertion tested for
  // NO_MEMBERSHIP_DESTINATION anywhere in the file, and the BREAK TABLE caught it: deleting the entire
  // guard line from a layout left the IMPORT standing, and the assertion stayed green.
  const missingRedirect = layoutSrcs.filter(([, s]) => !/redirect\(\s*NO_MEMBERSHIP_DESTINATION\s*\)/.test(s)).map(([f]) => f);
  ok("B1c", missingRedirect.length === 0,
    "every one of the 11 sends a refused identity to the shared destination", missingRedirect.join(", "));

  const shell = stripComments(read(PRACTICE_SHELL));
  ok("B2a", shell.length > 0, "CONTROL: the practice shell layout was found and read");
  ok("B2b", !/admitToEstate/.test(shell),
    "the PRACTICE shell does NOT call the estate guard -- the scan discriminates between files");

  const practiceSignup = stripComments(read(PRACTICE_SIGNUP));
  const estateSignup = stripComments(read(ESTATE_SIGNUP));
  ok("B3a", practiceSignup.length > 0 && estateSignup.length > 0, "CONTROL: both signup routes were read");
  ok("B3b", /["']nurse["']/.test(estateSignup),
    "CONTROL: the scanner CAN see an estate role literal -- the estate signup route still has one");
  ok("B3c", !/["']nurse["']/.test(practiceSignup),
    "Competen Practice signup names no estate role anywhere in its code");
  ok("B3d", !/\brole\s*:\s*["'][a-z_]+["']/.test(practiceSignup),
    "Competen Practice signup assigns no role literal at all");
  ok("B4a", /grantPlatformMembership\s*\(/.test(estateSignup),
    "CONTROL: the scanner CAN see a membership grant -- the ESTATE signup route makes one");
  ok("B4b", !/grantPlatformMembership|platform_membership/.test(practiceSignup),
    "Competen Practice signup creates no platform membership");

  const guardSrc = stripComments(read(GUARD_MODULE));
  ok("B5a", guardSrc.length > 0 && /grantPlatformMembership/.test(guardSrc), "CONTROL: the guard module was read");
  ok("B5b", !/from\(\s*["']profiles["']\s*\)/.test(guardSrc),
    "the guard module never writes or reads profiles -- granting membership cannot grant a role");

  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  // C. THE MIGRATION FILES. They are applied by hand and must be final before anybody runs them.
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nC. the migrations");

  const l279 = lintSql(MIG_279), l280 = lintSql(MIG_280);
  ok("C1", l279.length === 0, "279 obeys the migration rules", l279.join(" | "));
  ok("C2", l280.length === 0, "280 obeys the migration rules", l280.join(" | "));

  // ⚠ STRIPPED. See stripSqlComments -- the "no WHERE clause" assertion below passed against the raw
  // text purely because the migration's own comment contains the phrase.
  const m279raw = read(MIG_279), m280raw = read(MIG_280);
  const m279 = stripSqlComments(m279raw), m280 = stripSqlComments(m280raw);
  ok("C0", /has no WHERE clause/.test(m279raw) && !/has no WHERE clause/.test(m279),
    "CONTROL: the SQL comment stripper really removes the migration's own prose");
  ok("C3a", /create table if not exists platform_membership/.test(m279), "279 creates platform_membership");
  ok("C3b", /alter table platform_membership enable row level security/.test(m279), "279 enables RLS on it");
  ok("C3c", /create unique index if not exists ux_platform_membership_user\s+on platform_membership\(user_id\)/.test(m279)
      && !/ux_platform_membership_user[\s\S]{0,120}where /i.test(m279),
    "the upsert target is a FULL unique index, with no WHERE clause");
  ok("C3d", /insert into platform_membership[\s\S]*from profiles/.test(m279),
    "279 BACKFILLS in the same file as the table -- backfill before enforce");
  ok("C3e", /on conflict \(user_id\) do nothing/.test(m279), "the backfill is idempotent");
  ok("C3f", !/create table[\s\S]*platform_membership[\s\S]*references practice_/.test(m279),
    "no foreign key from platform membership to any practice table");
  ok("C4", /alter table profiles alter column role drop not null/.test(m279),
    "279 makes 'no estate role' expressible");

  const MULLEN_ID = "22cfc00a-c763-4e0f-a0d9-e9d8e747c3a1";
  const MULLEN_EMAIL = "mullen.elisha777@gmail.com";
  ok("C5a", m280.includes(MULLEN_ID) && m280.includes(MULLEN_EMAIL),
    "CONTROL: 280 names the one account by uuid AND by email, in its STATEMENTS not its prose");
  // Already comment-free, so the warning prose in 280 about the dangerous predicate cannot be mistaken
  // for the predicate itself.
  const stmts280 = m280;
  ok("C5b", !/practice_membership/.test(stmts280),
    "280 contains NO predicate over practice_membership -- it would demote an owner who owns a practice");
  ok("C5c", (stmts280.match(/where/gi) ?? []).length > 0
      && stmts280.split(/\r?\n/).filter(l => /update profiles|delete from platform_membership/.test(l)).length === 2,
    "280 changes exactly two things: one membership row and one profile row");

  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  // D. THE LIVE DATABASE.
  // ══════════════════════════════════════════════════════════════════════════════════════════════════
  console.log("\nD. the live database");

  // ⚠ A REAL SELECT, NOT head+count. A head+count probe returns count=null with NO error against a
  // missing table on this stack, so it cannot tell "not applied" from "empty".
  const probe = await admin.from(PLATFORM_MEMBERSHIP_TABLE).select("user_id, status").limit(1);
  const applied = !probe.error;
  if (!applied) console.log(`  (migration 279 is NOT applied: ${probe.error?.code})`);

  const { data: profiles, error: profErr } = await admin
    .from("profiles").select("id, email, role, roles").limit(1000);
  ok("D0", !profErr && (profiles?.length ?? 0) > 0,
    `CONTROL: the profile directory was read (${profiles?.length ?? 0} identities)`, profErr?.message);

  const estateProfiles = (profiles ?? []).filter((p: any) =>
    (p.roles?.length ? p.roles : [p.role]).filter(Boolean).length > 0);
  ok("D1", estateProfiles.length > 0,
    `CONTROL: the set of identities holding an estate role is NON-EMPTY (${estateProfiles.length}) -- `
    + "every count below is over a list that exists");

  if (!applied) {
    skip("D2", "the backfill covers every estate identity", "279 not applied");
    skip("D3", "both owner accounts hold a membership", "279 not applied");
    skip("D4", "every existing identity still reaches what it reached before", "279 not applied");
  } else {
    const { data: members, error: memErr } = await admin
      .from(PLATFORM_MEMBERSHIP_TABLE).select("user_id, status, source").limit(1000);
    ok("D2a", !memErr && (members?.length ?? 0) > 0,
      `CONTROL: the membership table was read and is non-empty (${members?.length ?? 0})`, memErr?.message);
    const activeIds = new Set((members ?? []).filter((m: any) => m.status === "active").map((m: any) => m.user_id));

    // ⚠ THE COUNT, NOT A SAMPLE. Mullen is the ONE identity 280 deliberately removes on PRODUCTION, so
    // she is a permitted absentee and she is named rather than filtered by a rule.
    //
    // ⚠ AND THE STAGING PRACTICE FIXTURES ARE NAMED ABSENTEES TOO -- 2026-08-28, learned the expensive
    // way. This assertion once demanded a membership for smoke.practitioner, one was granted to appease
    // it, and the Gate-3 topology work then found the smoke practitioner resolving TWO product
    // destinations: admitToEstate's rule is "membership decides", so a platform membership handed to a
    // Practice-product fixture turns a pure practitioner into a platform person and destroys the
    // direct-landing shape (fixture A) that identity exists to prove. A Practice fixture holding NO
    // platform membership is the CORRECT model -- it mirrors production's Mullen exactly -- and each is
    // named here with that reason. The signup harness's probe identities are the one PATTERN exemption,
    // because their addresses are generated per run and cannot be named in advance; the pattern is
    // anchored to their reserved .invalid domain so it can never match a person.
    const STAGING_PRACTICE_FIXTURES = [
      "smoke.practitioner@staging.competen.invalid",   // COMP-ENG-002G smoke fixture -- Practice product only
      "retry.proof@staging.competen.invalid",          // the retry-idempotency fixture -- Practice product only
      "estate.twoclinics@staging.competen.invalid",    // Gate-3 fixture B -- two Practice memberships, no platform
      "estate.nodest@staging.competen.invalid",        // Gate-3 fixture D -- ZERO destinations by definition
    ];
    const isSignupProbe = (email: string) => /^probe-\d+@example\.invalid$/.test(email);
    const missing = estateProfiles.filter((p: any) =>
      !activeIds.has(p.id) && p.email !== MULLEN_EMAIL
      && !STAGING_PRACTICE_FIXTURES.includes(p.email) && !isSignupProbe(String(p.email ?? "")));
    ok("D2b", missing.length === 0,
      `every one of the ${estateProfiles.length} estate identities holds an active membership (named absentees aside)`,
      missing.map((p: any) => p.email).join(", "));

    const supers = (profiles ?? []).filter((p: any) =>
      (p.roles?.length ? p.roles : [p.role]).includes("super_admin"));
    ok("D3a", supers.length === 2, `CONTROL: both owner accounts are present in the directory (${supers.length})`);
    ok("D3b", supers.every((p: any) => activeIds.has(p.id)),
      "both owner accounts hold an active platform membership");

    // The real assertion behind stage 3: run the REAL guard over EVERY existing identity and count.
    const admissions = await Promise.all(estateProfiles.map(async (p: any) => {
      const roles = (p.roles?.length ? p.roles : [p.role]).filter(Boolean) as AppRole[];
      return { email: p.email, ...(await admitToEstate(admin, p.id, roles)) };
    }));
    // ⚠ The named absentees are REFUSED here by design -- a Practice fixture being turned away from
    // the platform door is the guard doing exactly its job, and counting that as a lockout would
    // demand the mis-model D2b's note describes.
    const lockedOut = admissions.filter(a => !a.admitted && a.email !== MULLEN_EMAIL
      && !STAGING_PRACTICE_FIXTURES.includes(a.email) && !isSignupProbe(String(a.email ?? "")));
    ok("D4", lockedOut.length === 0,
      `all ${admissions.length} existing estate identities are still admitted by the real guard (named absentees aside)`,
      lockedOut.map(a => a.email).join(", "));
  }

  // ── The break-glass, proven against a store that genuinely will not answer ────────────────────────
  const deadRead = await readPlatformMembership(deadStore, "00000000-0000-4000-8000-000000000000");
  ok("D5a", deadRead.state === "unreadable",
    "CONTROL: the dead-key client really does fail to read the membership store", deadRead.errorCode ?? "");
  const deadOwner = await admitToEstate(deadStore, "00000000-0000-4000-8000-000000000000", ["super_admin"]);
  ok("D5b", deadOwner.admitted && deadOwner.reason === "owner_break_glass",
    "a super_admin is ADMITTED while platform_membership is unreadable -- the break-glass holds");
  const deadNurse = await admitToEstate(deadStore, "00000000-0000-4000-8000-000000000000", ["nurse"]);
  ok("D5c", deadNurse.admitted && deadNurse.membership === "unreadable",
    "and a nurse is admitted too, reported as unreadable rather than as a member");

  // ── Fixtures: the Practice registrant and the estate nurse control ───────────────────────────────
  console.log("\nE. fixtures");
  await cleanupFixtures();

  const { data: practiceUser, error: pcErr } = await admin.auth.admin.createUser({
    email: FIX_PRACTICE_EMAIL, password: "harness-password-1", email_confirm: true,
    user_metadata: { full_name: "Harness Practice Registrant" },
  });
  const { data: estateUser, error: esErr } = await admin.auth.admin.createUser({
    email: FIX_ESTATE_EMAIL, password: "harness-password-1", email_confirm: true,
    user_metadata: { full_name: "Harness Estate Nurse" },
  });
  ok("E0", !pcErr && !esErr && !!practiceUser?.user?.id && !!estateUser?.user?.id,
    "CONTROL: both fixture identities were created", `${pcErr?.message ?? ""} ${esErr?.message ?? ""}`);

  const pcId = practiceUser?.user?.id, esId = estateUser?.user?.id;
  if (!pcId || !esId) {
    fails.push("E0 fixtures could not be created -- everything below is unrun");
  } else {
    // The trigger has already written 'nurse'. That is the badge this arc removes, and asserting it is
    // present FIRST is what makes the next assertion mean something.
    const { data: born } = await admin.from("profiles").select("role").eq("id", pcId).maybeSingle();
    ok("E1", born?.role === "nurse",
      "CONTROL: handle_new_user really does stamp 'nurse' on a new identity -- the badge exists to remove");

    // Exactly what the Practice signup route now does, IMPORTED from the boundary module.
    const { error: upErr } = await admin.from("profiles")
      .upsert(practiceIdentityProfile(pcId, "Harness Practice Registrant", FIX_PRACTICE_EMAIL), { onConflict: "id" });
    const { data: corrected } = await admin.from("profiles").select("role, roles").eq("id", pcId).maybeSingle();
    if (applied) {
      ok("E2", !upErr && corrected?.role === null,
        "Competen Practice registration leaves profiles.role NULL -- no estate role is assigned", upErr?.message);
    } else {
      // Not a pass dressed up as one: this is the assertion that migration 279 is NECESSARY. Without
      // its ALTER, the correction the route now makes is refused by the database itself, which is
      // exactly why Practice signup used to write 'nurse'.
      ok("E2pre", !!upErr && /not-null|not null/i.test(upErr.message),
        "CONTROL: without 279 the correction is IMPOSSIBLE -- profiles.role rejects null", upErr?.message);
      skip("E2", "Competen Practice registration leaves profiles.role NULL", "279 not applied");
    }

    // The rest of registration -- steps 5 to 10 of CPR-IAM-001 s8, the real engine.
    const { data: req, error: reqErr } = await admin.from("provisioning_request").insert({
      idempotency_key: `cpsplit-harness-${Date.now()}`, request_type: "individual",
      actor_user_id: pcId, target_user_id: pcId, payload_hash: "harness", correlation_id: CID,
    }).select("id").single();
    const run = req ? await runProvisioning(admin,
      { id: req.id, target_user_id: pcId, correlation_id: CID, workspace_id: null },
      payload("HARNESS CP-SPLIT Practice (synthetic)")) : null;
    ok("E3a", !reqErr && !!run?.ok && !!run?.workspaceId,
      "CONTROL: the registration otherwise SUCCEEDED -- a real practice workspace was provisioned",
      `${reqErr?.message ?? ""} ${run?.errorCode ?? ""}`);
    const { data: pmRows } = await admin.from("practice_membership").select("role_code").eq("user_id", pcId);
    ok("E3b", (pmRows?.length ?? 0) > 0,
      `CONTROL: and a real practice membership came out of it (${pmRows?.length ?? 0} rows)`);

    // The estate control identity: a nurse who DOES hold platform membership.
    await admin.from("profiles").update({ role: "nurse", roles: ["nurse"] }).eq("id", esId);
    const granted = await grantPlatformMembership(admin, esId, { source: "admin_grant", note: "harness control" });
    if (!applied) {
      ok("E4", granted.ok === false,
        "CONTROL: with 279 unapplied the grant FAILS loudly rather than silently reporting success");
      skip("E5", "a no-membership identity reaches none of the 11 estate surfaces", "279 not applied");
      skip("E6", "and a nurse with membership still reaches them", "279 not applied");
    } else {
      ok("E4", granted.ok, "the estate control identity was granted platform membership", granted.error ?? "");

      const { data: leaked } = await admin.from(PLATFORM_MEMBERSHIP_TABLE).select("user_id").eq("user_id", pcId);
      const { data: seen } = await admin.from(PLATFORM_MEMBERSHIP_TABLE).select("user_id").eq("user_id", esId);
      ok("E5a", (seen?.length ?? 0) === 1,
        "CONTROL: this exact query DOES see a membership row when one exists");
      ok("E5b", (leaked?.length ?? 0) === 0,
        "the Practice registrant has NO platform membership -- registration created none");

      const practiceAdmission = await admitToEstate(admin, pcId, []);
      const estateAdmission = await admitToEstate(admin, esId, ["nurse"]);
      ok("E5c", practiceAdmission.admitted === false && practiceAdmission.reason === "no_platform_membership",
        "the real shared guard REFUSES the Practice registrant -- so all 11 estate layouts refuse them");
      ok("E6", estateAdmission.admitted === true && estateAdmission.reason === "member",
        "CONTROL: and ADMITS the nurse who holds membership -- the refusal above is not the estate "
        + "being broken for everybody");

      // Belt and braces on rule 4: granting membership granted no role.
      const { data: afterGrant } = await admin.from("profiles").select("role, roles").eq("id", pcId).maybeSingle();
      ok("E7", afterGrant?.role === null,
        "nothing in this run gave the Practice registrant an estate role");
    }
  }

  // ── Cleanup, and the deletion is ASSERTED ────────────────────────────────────────────────────────
  await cleanupFixtures();
  const stillThere = (await Promise.all([FIX_PRACTICE_EMAIL, FIX_ESTATE_EMAIL].map(findFixture))).filter(Boolean);
  ok("E8", stillThere.length === 0, "both fixtures were deleted and the deletion was verified",
    stillThere.map((u: any) => u.email).join(", "));
  if (applied) {
    const { data: after } = await admin.from(PLATFORM_MEMBERSHIP_TABLE).select("user_id").limit(1000);
    const { data: afterProfiles } = await admin.from("profiles").select("id").limit(1000);
    ok("E9", (after ?? []).every((m: any) => (afterProfiles ?? []).some((p: any) => p.id === m.user_id)),
      "no orphaned membership row survives the run");
  }

  console.log(`\n  ${pass} passed, ${fails.length} failed, ${pend} pending`);
  if (fails.length) { console.log("\n  FAILURES:"); fails.forEach(f => console.log(`   - ${f}`)); }
  process.exit(fails.length ? 1 : 0);
}

main().catch(async e => {
  console.error(e);
  try { await cleanupFixtures(); } catch { /* best effort */ }
  process.exit(1);
});
