/**
 * INDIVIDUAL FOUNDATION HARNESS -- the gate-3 invariants of ADR-016 / COMPETEN-IND-003, checked from
 * source.
 *
 *   npx --yes tsx scripts/individual-foundation-harness.ts
 *
 * ⚠ WHAT THIS IS, AND WHAT IT IS NOT. It needs no database, so it runs before migration 370 is applied
 * and on every machine. It checks the STRUCTURAL rules a reviewer would otherwise have to remember:
 * Individual never reaches for gate 1, never grants another product, never writes profiles, never writes
 * the estate tables hospital analytics read (provisional ruling D1), judges liveness only through the
 * DB-clock view, guards every API route with its own gate, ships no signup surface, and lists in its
 * navigation only modules that exist.
 *
 * The BEHAVIOUR of the resolver (both experiences, one experience, direct Professional, fail-closed,
 * landing fallback) is executed in Vitest: src/lib/individual/access.test.ts and
 * src/lib/identity/product-resolution.test.ts. The end-to-end acceptance run needs migration 370 applied
 * and pilot grants made, and is recorded in docs/COMPETEN-IND-003-individual-foundation.md s7.
 *
 * ⚠ IT READS STRIPPED SOURCE. Every content needle runs on the text with comments removed, because this
 * repository has recorded a needle matching its own documentation eight times -- and these files explain
 * at length the very calls they must not make. Control 0 proves the strip did not simply empty the files.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { ACCESS_DOORS } from "../src/lib/access-doors";
import { EXPERIENCES, EXPERIENCE_KEYS, FOUNDATION_NAV, navFor } from "../src/lib/individual/experiences";
import { capabilityForRoute } from "../src/lib/hq/spaces";
import { GENERAL_NAV } from "../src/app/super-admin/_components/nav-tables";
import { inviteDeliveryMode } from "../src/lib/individual/invitations";
import { PRODUCTION_REF } from "./production-guard";

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const posix = (p: string) => p.replace(/\\/g, "/");

/** Comments out, strings kept -- a needle may legitimately be a table name inside a string. */
function strip(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const FILES = [
  ...walk("src/lib/individual"),
  ...walk("src/app/individual"),
  ...walk("src/app/api/individual"),
  ...walk("src/app/api/hq/individual"),
].map(posix).filter(f => f !== "src/app/individual/page.tsx" && !f.startsWith("src/app/individual/sign-in/"));
const SRC = new Map(FILES.map(f => [f, strip(readFileSync(f, "utf8"))]));
const offenders = (re: RegExp, among: string[] = FILES) => among.filter(f => re.test(SRC.get(f) ?? ""));

function main() {
  console.log("INDIVIDUAL FOUNDATION HARNESS (ADR-016)\n");

  // ── 0. CONTROLS ─────────────────────────────────────────────────────────────────────────────────
  ok("0a. the Individual source was found (guard, access, registry, both layouts, both API routes)",
    ["src/lib/individual/guard.ts", "src/lib/individual/access.ts", "src/lib/individual/experiences.ts",
      "src/app/individual/(app)/layout.tsx", "src/app/individual/(app)/[experience]/layout.tsx",
      "src/app/api/individual/assistant/route.ts", "src/app/api/individual/preferences/route.ts"].every(f => SRC.has(f)));
  ok("0b. ⚠ the comment strip did not empty the files -- a real call survives it",
    /readIndividualAccess\(/.test(SRC.get("src/lib/individual/guard.ts") ?? ""));
  ok("0c. ⚠ and it does remove comments -- the guard's own warning about getCaller is gone",
    !/getCaller/.test(SRC.get("src/lib/individual/guard.ts") ?? "x getCaller"));

  // ── 1. GATE 3 NEVER LEANS ON, OR GRANTS, ANOTHER GATE ───────────────────────────────────────────
  const GATE_FILES = FILES.filter(f => f.endsWith("layout.tsx") || f.endsWith("guard.ts") || f.endsWith("access.ts") || f.startsWith("src/app/api/individual/"));
  ok("1a. no Individual gate (guard, access, layouts, API) calls admitToEstate",
    offenders(/\badmitToEstate\b/, GATE_FILES).length === 0, offenders(/\badmitToEstate\b/, GATE_FILES).join(", "));
  ok("1b. no Individual file calls getCaller -- its default is gate 1 (src/lib/api-auth.ts)",
    offenders(/\bgetCaller\b/).length === 0, offenders(/\bgetCaller\b/).join(", "));
  ok("1c. no Individual file grants or writes another product's membership",
    offenders(/grantPlatformMembership|from\("(platform|practice|enterprise)_membership"\)/).length === 0,
    offenders(/grantPlatformMembership|from\("(platform|practice|enterprise)_membership"\)/).join(", "));
  // ONE WRITE, AND ONLY TO CLEAR STANDING: an identity an Individual invitation just created has the trigger's
  // default 'nurse' set back to null through the boundary helper -- the rule Competen Practice registration
  // keeps (practiceIdentityProfile). No Individual code ever SETS a role, or touches an existing profile.
  const profileWrites = FILES.flatMap(f => [...(SRC.get(f) ?? "").matchAll(/from\("profiles"\)\s*\.(insert|update|upsert|delete)\(([^)]*)\)/g)].map(m => `${f}: ${m[1]}(${m[2]})`));
  ok("1d. no Individual file writes profiles, except an invitation clearing its own new identity's role to null",
    profileWrites.length === 1 && profileWrites[0] === "src/lib/individual/invitations.ts: update(individualIdentityProfile()",
    profileWrites.join("; "));

  // ── 2. WHAT INDIVIDUAL MAY WRITE, AND WHERE ─────────────────────────────────────────────────────
  // Every write site names its table on the same chain. audit_log may be written anywhere. Beyond it,
  // each gate-3 write is allowed in exactly one file: the person's own preference and terms acceptance
  // (owner ruling D2), and the HQ pilot grant (D9). A write anywhere else is a second writer.
  const ALLOWED: Record<string, string[]> = {
    "src/app/api/individual/preferences/route.ts": ["individual_membership.update"],
    "src/app/api/individual/terms/route.ts": ["individual_membership.update", "individual_entitlement.update"],
    // The delete is the grant's own compensation (COMPETEN-IND-ACCESS-001): a membership THIS call created,
    // with no entitlement written beside it, is removed again rather than left as a member with nothing live.
    // individual_membership.update is the membership-status action (LEGAL-001 s13 step 7): suspend, reinstate,
    // revoke -- 12o pins its transitions.
    "src/lib/individual/grants.ts": ["individual_membership.insert", "individual_membership.update", "individual_membership.delete", "individual_entitlement.insert", "individual_entitlement.update"],
    // The invitation record (migration 378): created by the HQ invitation, closed by acceptance or revocation.
    // It grants nothing itself -- acceptance goes through grants.ts above.
    // profiles.update is the one role-clearing write 1d pins to its exact argument.
    "src/lib/individual/invitations.ts": ["individual_invitation.insert", "individual_invitation.update", "profiles.update"],
  };
  const writes: string[] = [];
  for (const [f, src] of SRC) {
    for (const m of src.matchAll(/from\("([a-z_]+)"\)\s*\.(insert|update|upsert|delete)\(/g)) writes.push(`${f}: ${m[1]}.${m[2]}`);
  }
  // EXPERIENCE RULE (IND-004 / IND-007): a file under src/lib/individual/<x>/ or src/app/api/individual/<x>/
  // may write only that experience's own tables, individual_<x>_*. One named estate exception: Professional's
  // share module (share.ts, called by its route and its staging harness) reuses passport_share_tokens
  // (COMPETEN-IND-002 s4.1), whose only other readers are the owner's
  // own share page and /verify -- no hospital-scoped reader. Each experience's own harness pins its exact list.
  const NAMED_EXCEPTIONS: Record<string, string[]> = {
    "src/lib/individual/professional/share.ts": ["passport_share_tokens.insert", "passport_share_tokens.update"],
  };
  const experienceOf = (f: string) => /^src\/(?:lib|app\/api)\/individual\/(scholar|professional)\//.exec(f)?.[1] ?? null;
  const badWrites = writes.filter(w => {
    const [f, op] = w.split(": ");
    if (op === "audit_log.insert" || (ALLOWED[f] ?? []).includes(op) || (NAMED_EXCEPTIONS[f] ?? []).includes(op)) return false;
    const x = experienceOf(f);
    return !(x && op.startsWith(`individual_${x}_`));
  });
  ok("2a. every gate-3 write sits in its one allowed file; nothing else but audit_log is written", badWrites.length === 0, badWrites.join("; "));
  const expected = Object.entries(ALLOWED).flatMap(([f, ops]) => ops.map(op => `${f}: ${op}`));
  ok("2b. ⚠ control: every allowed write is actually seen, so 2a is not vacuous",
    expected.every(w => writes.includes(w)), expected.filter(w => !writes.includes(w)).join("; "));

  // ── 3. PROVISIONAL RULING D1 -- NO INDIVIDUAL DATA IN TABLES HOSPITAL ANALYTICS READ ──────────
  const ESTATE_LEARNING = /from\("(quiz_attempts|knowledge_attempts|cpd_logs|course_enrollments|learning_enrolments|cdp_reinforcement_cards|skill_log_entries)"\)/;
  ok("3a. no Individual file touches the estate learning tables (learning-analytics.ts reads them by hospital)",
    offenders(ESTATE_LEARNING).length === 0, offenders(ESTATE_LEARNING).join(", "));

  // ── 4. LIVENESS IS THE DATABASE'S CLOCK ─────────────────────────────────────────────────────────
  const access = SRC.get("src/lib/individual/access.ts") ?? "";
  ok("4a. access reads liveness from individual_live_entitlement", /from\("individual_live_entitlement"\)/.test(access));
  ok("4b. access never reads the raw ledger or compares a period with the app clock",
    !/from\("individual_entitlement"\)/.test(access) && !/starts_at|ends_at/.test(access) && !/Date\.now\(\)|new Date\(/.test(access));
  const ledgerReaders = offenders(/from\("individual_entitlement"\)\s*\.select\(/);
  // Two display readers: the person's own history, and the HQ grant screen's lookup (COMPETEN-IND-ACCESS-001),
  // which shows every period and takes "active now" from the view, never from the dates.
  const grantsLib = SRC.get("src/lib/individual/grants.ts") ?? "";
  ok("4c. only the two display readers READ the raw ledger (history, and the HQ lookup) -- every access decision uses the view",
    ledgerReaders.length === 2 && ledgerReaders.includes("src/lib/individual/history.ts") && ledgerReaders.includes("src/lib/individual/grants.ts")
      && /from\("individual_live_entitlement"\)\.select\("id"\)\.eq\("user_id", p\.id\)/.test(grantsLib)
      && !/Date\.now\(\)/.test(grantsLib), ledgerReaders.join(", "));

  // ── 5. EVERY INDIVIDUAL API ROUTE IS GUARDED BY GATE 3 ──────────────────────────────────────────
  const routes = FILES.filter(f => f.startsWith("src/app/api/individual/") && f.endsWith("route.ts"));
  // ONE NAMED EXCEPTION: accepting an invitation (migration 378) is done by a person who holds no membership
  // yet, so requireIndividualContext would refuse the only people it serves. 12l pins its own gate order.
  const ACCEPT_ROUTE = "src/app/api/individual/invitation/accept/route.ts";
  const unguarded = routes.filter(f => f !== ACCEPT_ROUTE).filter(f => {
    const s = SRC.get(f) ?? "";
    const handlers = [...s.matchAll(/export async function (POST|PUT|PATCH|DELETE)\b/g)].length;
    return handlers > 0 && [...s.matchAll(/requireIndividualContext\(/g)].length < handlers;
  });
  ok("5a. every mutating Individual API handler calls requireIndividualContext", routes.length >= 3 && unguarded.length === 0, unguarded.join(", "));
  // The pilot-GRANT routes: grants/ and invitations/ (migration 378). COMPETEN-CONFIG-002 added
  // /api/hq/individual/config, which is gated on its own capability (hq.individual.config.manage) and pinned
  // by scripts/individual-config-harness.ts G1, so it is not one of these. The routes that act on a person by
  // id refuse the caller acting on themselves. The invitation routes act on an email with NO account -- an
  // administrator always has one, so inviting yourself ends in ACCOUNT_EXISTS rather than needing its own test.
  const hqRoutes = FILES.filter(f => /^src\/app\/api\/hq\/individual\/(grants|invitations)\//.test(f) && f.endsWith("route.ts"));
  const hqUngated = hqRoutes.filter(f => !/hqApiGate\(\["hq\.individual\.pilot\.grant"\]\)/.test(SRC.get(f) ?? "")
    || (f.startsWith("src/app/api/hq/individual/grants/") && !/targetUserId === ctx\.userId/.test(SRC.get(f) ?? "")));
  ok("5b. D9: every HQ Individual route is gated on hq.individual.pilot.grant; the grant routes refuse acting on yourself",
    hqRoutes.length >= 4 && hqUngated.length === 0, hqUngated.join(", "));
  // The grant engine's callers: the HQ grant routes, and the invitation library (relative import) whose only
  // granting function, acceptIndividualInvitation, is called from the accept route alone.
  const grantImporters = FILES.filter(f => /from "(@\/lib\/individual|\.)\/grants"/.test(SRC.get(f) ?? ""));
  const callersOf = (fn: string) => FILES.filter(f => !f.endsWith("/invitations.ts") && new RegExp(`\\b${fn}\\(`).test(SRC.get(f) ?? ""));
  ok("5c. the grant service is reachable only from the HQ grant routes and, through acceptance, the accept route",
    grantImporters.length >= 3 && grantImporters.every(f => f.startsWith("src/app/api/hq/individual/grants/") || f === "src/lib/individual/invitations.ts")
    && callersOf("acceptIndividualInvitation").join() === ACCEPT_ROUTE
    && callersOf("createIndividualInvitation").join() === "src/app/api/hq/individual/invitations/route.ts"
    && callersOf("revokeIndividualInvitation").join() === "src/app/api/hq/individual/invitations/revoke/route.ts",
    `importers: ${grantImporters.join(", ")}; accept: ${callersOf("acceptIndividualInvitation").join(", ")}`);

  // ── 6. SIGNUP STAYS CLOSED ──────────────────────────────────────────────────────────────────────
  ok("6a. no Individual surface links to /signup or creates an auth user",
    offenders(/["'`]\/signup|auth\.signUp\(|auth\.admin\.createUser\(/).length === 0,
    offenders(/["'`]\/signup|auth\.signUp\(|auth\.admin\.createUser\(/).join(", "));
  const door = ACCESS_DOORS.find(d => d.code === "INDIVIDUAL");
  ok("6b. the public Individual door is still being_built -- the pilot enters through /login", door?.status === "being_built");
  ok("6c. no person-facing Individual API route can create membership or entitlement",
    !FILES.some(f => f.startsWith("src/app/api/individual/") && /from\("individual_(membership|entitlement)"\)\s*\.(insert|upsert)\(/.test(SRC.get(f) ?? "")));

  // ── 7. NAVIGATION LISTS ONLY WHAT EXISTS ────────────────────────────────────────────────────────
  const EXP_DIR = "src/app/individual/(app)/[experience]";
  const missing = EXPERIENCE_KEYS.flatMap(k => navFor(k).filter(n => {
    if (!n.segment) return !existsSync(`${EXP_DIR}/page.tsx`);
    return !existsSync(`${EXP_DIR}/${n.segment}/page.tsx`) && !existsSync(`${EXP_DIR}/(${k})/${n.segment}/page.tsx`);
  }).map(n => `${k}/${n.segment}`));
  ok("7a. every navigation entry, for both experiences, has a real page behind it", missing.length === 0, missing.join(", "));
  const foundationSegments = new Set(FOUNDATION_NAV.map(n => n.segment));
  const badModules = EXPERIENCE_KEYS.flatMap(k => {
    const segs = EXPERIENCES[k].modules.map(m => m.segment);
    return segs.filter((s, i) => !s || foundationSegments.has(s) || segs.indexOf(s) !== i).map(s => `${k}/${s || "(empty)"}`);
  });
  ok("7c. experience modules never reuse a foundation segment, an empty segment or each other", badModules.length === 0, badModules.join(", "));
  // 7a walks navFor, which skips modules that are not in the navigation (nav: false -- reached from another
  // page). experienceModulePage still admits them, so every listed module needs its page.
  const modulesWithoutPage = EXPERIENCE_KEYS.flatMap(k => EXPERIENCES[k].modules
    .filter(m => !existsSync(`${EXP_DIR}/(${k})/${m.segment}/page.tsx`)).map(m => `${k}/${m.segment}`));
  ok("7f. every experience module, in the navigation or not, has its page under (app)/[experience]/(<experience>)/",
    modulesWithoutPage.length === 0, modulesWithoutPage.join(", "));
  const pages = FILES.filter(f => f.startsWith(`${EXP_DIR}/`) && f.endsWith("/page.tsx"));
  const ungatedPages = pages.filter(f => !/experiencePage\(|experienceModulePage\(/.test(SRC.get(f) ?? ""));
  ok("7d. every page under [experience] takes its context from experiencePage / experienceModulePage (gate, live, terms)",
    pages.length >= 5 && ungatedPages.length === 0, ungatedPages.join(", "));
  const modulePages = pages.filter(f => /\/\((scholar|professional)\)\//.test(f));
  ok("7e. every experience-owned module page uses experienceModulePage, so another experience's URL is 404",
    modulePages.every(f => /experienceModulePage\(/.test(SRC.get(f) ?? "")), modulePages.filter(f => !/experienceModulePage\(/.test(SRC.get(f) ?? "")).join(", "));
  ok("7b. the experience route accepts exactly the registry's experiences",
    /isExperienceKey\(experience\)/.test(SRC.get("src/app/individual/(app)/[experience]/layout.tsx") ?? "") && EXPERIENCE_KEYS.length === 2);

  // ── 8. THE NEUTRAL RESOLVER OFFERS INDIVIDUAL FROM ITS GATE, AND ONLY FROM ITS GATE ─────────────
  const pr = strip(readFileSync("src/lib/identity/product-resolution.ts", "utf8"));
  ok("8a. product-resolution reads individual_membership and offers /individual/home",
    /from\("individual_membership"\)/.test(pr) && /href: "\/individual\/home"/.test(pr));
  ok("8b. and a missing table is the ONLY Individual read failure it forgives",
    /isNotProvisioned\(individualRead\.error\)/.test(pr) && /individualRead\.error && !individualAbsent/.test(pr));

  // ── 9. THE OWNER RULINGS THAT LIVE IN CODE AND SCHEMA ───────────────────────────────────────────
  const MIG = "supabase/migrations/370-individual-membership-and-entitlement.sql";
  const mig = existsSync(MIG) ? readFileSync(MIG, "utf8").replace(/--.*$/gm, "") : "";
  const grantsSrc = SRC.get("src/lib/individual/grants.ts") ?? "";
  const legalSrc = SRC.get("src/lib/individual/legal.ts") ?? "";
  ok("9a. D8: the schema refuses a Scholar row without an adult-eligibility confirmation",
    /check \(experience_code <> 'scholar' or adult_confirmed_at is not null\)/.test(mig));
  ok("9b. D8: the grant refuses Scholar without adultConfirmed === true, and records who confirmed",
    /includes\("scholar"\) && !adultConfirmed/.test(grantsSrc) && /adult_confirmed_by: grantedBy/.test(grantsSrc));
  // RAW, not stripped: spaces.ts carries route globs ("/super-admin/*") that the block-comment strip would
  // read as comment openers and swallow. The needle is a catalogue entry, which no comment could fake.
  const spaces = readFileSync("src/lib/hq/spaces.ts", "utf8");
  ok("9c. D9: the capability is in the migration AND the HQ catalogue, granted to the Individual Product Administrator",
    /'hq\.individual\.pilot\.grant', 'platform'/.test(mig) && /"hq\.individual\.pilot\.grant",\s*space: "platform"/.test(spaces)
    && /\('individual_product_administrator', 'platform'/.test(mig) && /set product_line_code = 'individual'/.test(mig));
  ok("9d. D2: every page, the experience layout and every experience API pass the terms gate before use",
    /contextTermsGate\(shell\.ctx, param\)\.usable/.test(SRC.get("src/app/individual/_components/shell-context.ts") ?? "")
    && /contextTermsGate\(shell\.ctx, experience\)/.test(SRC.get("src/app/individual/(app)/[experience]/layout.tsx") ?? "")
    && /opts\.requireTerms !== false && !contextTermsGate/.test(SRC.get("src/lib/individual/guard.ts") ?? ""));
  ok("9e. D2: no legal version or registered name is hard-coded -- both come from configuration",
    legalSrc.length > 0 && !/registeredName:\s*"/.test(legalSrc) && !/version:\s*"/.test(legalSrc));
  ok("9f. D2: terms acceptance is all-or-nothing in the schema, on both tables",
    /individual_entitlement_terms_whole/.test(mig) && /individual_membership_foundation_terms_whole/.test(mig));
  // ── 10. THE RELEASE GATE: every entry point asks it first, on the server ──
  const guardSrc = SRC.get("src/lib/individual/guard.ts") ?? "";
  ok("10a. the shell guard checks the release gate BEFORE authentication and before any Individual table",
    /individualAppEnabled\(admin\)\)\) return \{ state: "DISABLED" \}/.test(guardSrc) // (admin may be null: see 11d)
    && guardSrc.indexOf("individualAppEnabled(admin)") < guardSrc.indexOf("auth.getUser()")
    && guardSrc.indexOf("individualAppEnabled(admin)") < guardSrc.indexOf("readIndividualAccess("));
  ok("10b. a DISABLED shell is 404 in the API guard, the group layout, the experience layout, every page helper, home and welcome",
    /shell\.state === "DISABLED"\) return NextResponse\.json\(\{ error: "Not found" \}, \{ status: 404 \}\)/.test(guardSrc)
    && ["src/app/individual/(app)/layout.tsx", "src/app/individual/(app)/[experience]/layout.tsx", "src/app/individual/_components/shell-context.ts",
      "src/app/individual/(app)/home/page.tsx", "src/app/individual/(app)/welcome/page.tsx"]
      .every(f => /shell\.state === "DISABLED"\) notFound\(\)/.test(SRC.get(f) ?? "")));
  ok("10c. the access page and both HQ grant routes check the gate themselves",
    /if \(!admin \|\| !\(await individualAppEnabled\(admin\)\)\) notFound\(\)/.test(SRC.get("src/app/individual/access/page.tsx") ?? "")
    && hqRoutes.every(f => /individualAppEnabled\(ctx\.admin\)\)\) return NextResponse\.json/.test(SRC.get(f) ?? "")));
  ok("10d. the neutral resolver reads individual_membership ONLY when the gate is on",
    /individualAppEnabled\(admin\),/.test(pr) && /individualOn\s*\?\s*await admin\.from\("individual_membership"\)/.test(pr));
  ok("10e. both person-facing APIs run the guard before validating input, and no GET handler exists",
    ["src/app/api/individual/assistant/route.ts", "src/app/api/individual/terms/route.ts"].every(f => {
      const s = SRC.get(f) ?? "";
      return s.indexOf("requireIndividualContext(") < s.indexOf('"Unknown experience"') && !/export async function GET/.test(s);
    }));

  // ── 11. REQUEST-TIME ONLY: nothing Individual is prerendered at build ──
  // Found on Vercel Preview 2026-10-22: /individual/access was prerendered at build, built a service-role
  // client there and died on "supabaseKey is required" (Preview has no key). Where a key DOES exist, the
  // same prerender would freeze the release gate into static HTML -- a gate that is not server-enforced.
  const routeFiles = FILES.filter(f => /\/(page|layout|route)\.tsx?$/.test(f));
  const notDynamic = routeFiles.filter(f => !/export const dynamic = "force-dynamic";/.test(SRC.get(f) ?? ""));
  ok("11a. every Individual page, layout and route handler is force-dynamic (public /individual and /individual/sign-in excepted)",
    routeFiles.length >= 15 && notDynamic.length === 0, notDynamic.join(", "));
  ok("11b. the guard and the access page wait for a request (connection()) before creating any client",
    guardSrc.indexOf("await connection()") > -1 && guardSrc.indexOf("await connection()") < guardSrc.indexOf("createAdminClientOrNull()")
    && (() => { const a = SRC.get("src/app/individual/access/page.tsx") ?? ""; return a.indexOf("await connection()") > -1 && a.indexOf("await connection()") < a.indexOf("createAdminClientOrNull()"); })());
  // Found 2026-10-23 (merge-condition check on staging): static `export const metadata` put "Competen Scholar ·
  // Competen Individual" into the gate-off 404, telling a visitor the route exists. Gated metadata is empty
  // while the gate is off, so the 404 carries the root title an absent route carries.
  const gatedViews = routeFiles.filter(f => /\/(page|layout)\.tsx$/.test(f));
  const leakyMeta = gatedViews.filter(f => {
    const s = SRC.get(f) ?? "";
    return /export const metadata\b/.test(s) || (/export async function generateMetadata/.test(s) && !/gatedMetadata\(/.test(s));
  });
  ok("11e. no gated Individual page or layout exports static metadata; every generateMetadata goes through gatedMetadata",
    gatedViews.length >= 10 && leakyMeta.length === 0, leakyMeta.join(", "));
  // Found on Vercel Preview 2026-10-22, after 11a: with no service key the routes answered 500, not 404 --
  // createAdminClient()'s constructor throws on a missing key, before the gate's own try could say OFF.
  const gatePaths = ["src/lib/individual/guard.ts", "src/app/individual/access/page.tsx"];
  ok("11d. the gate paths build their client with createAdminClientOrNull (no client = OFF), never the throwing createAdminClient()",
    gatePaths.every(f => /createAdminClientOrNull\(\)/.test(SRC.get(f) ?? "") && !/createAdminClient\(\)/.test(SRC.get(f) ?? ""))
    && /if \(!admin \|\| !\(await individualAppEnabled\(admin\)\)\) return \{ state: "DISABLED" \}/.test(guardSrc));
  const moduleScopeClients = FILES.filter(f => /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:await\s+)?create(?:Admin)?Client(?:OrNull)?\(/m.test(SRC.get(f) ?? ""));
  ok("11c. no Supabase client is created at module scope anywhere in Individual", moduleScopeClients.length === 0, moduleScopeClients.join(", "));

  // ── 12. COMPETEN-IND-ACCESS-001: ENTRY, DESTINATION AND THE HQ GRANT SCREEN ──
  const doorSrc = strip(readFileSync("src/app/individual/sign-in/page.tsx", "utf8"));
  ok("12a. the public door asks the release gate on the server (no client = OFF) and otherwise renders the coming-soon screen",
    /export const dynamic = "force-dynamic";/.test(doorSrc) && doorSrc.indexOf("await connection()") > -1
    && doorSrc.indexOf("await connection()") < doorSrc.indexOf("createAdminClientOrNull()")
    && /if \(admin && \(await individualAppEnabled\(admin\)\)\) \{/.test(doorSrc) && /<ProductComingSoon/.test(doorSrc)
    && !/createAdminClient\(\)/.test(doorSrc) && !/type="password"/.test(doorSrc));
  ok("12b. with the gate on, the door redirects ONLY to entry.ts destinations -- the ?experience= value is never echoed",
    /redirect\(user \? entryDestination\(experience\) : signInHref\(experience\)\)/.test(doorSrc)
    && /requestedExperience\(\(await searchParams\)\.experience\)/.test(doorSrc) && (doorSrc.match(/redirect\(/g) ?? []).length === 1);
  const marketing = ["src/components/marketing/ExperiencePage.tsx", "src/components/marketing/IndividualFamily.tsx"].map(f => strip(readFileSync(f, "utf8")));
  ok("12c. every Sign in on the Scholar and Professional pages names its experience; none uses the bare door",
    marketing.every(s => !/INDIVIDUAL_SIGN_IN/.test(s)) && marketing.reduce((n, s) => n + (s.match(/experienceSignIn\(e\.key\)/g) ?? []).length, 0) === 3);
  const reqDriven = ["src/app/individual/(app)/layout.tsx", "src/app/individual/(app)/[experience]/layout.tsx",
    "src/app/individual/_components/shell-context.ts", "src/app/individual/access/page.tsx", "src/app/individual/(app)/welcome/page.tsx"];
  const rawReq = reqDriven.filter(f => {
    const s = SRC.get(f) ?? "";
    return /\?for=\$\{|\?experience=\$\{/.test(s) || /searchParams\)\.(for|experience)/.test(s.replace(/requestedExperience\(\(await searchParams\)\.(for|experience)\)/g, ""));
  });
  ok("12d. requested experiences reach redirects and copy only through entry.ts (no raw ?for= or ?experience= use)",
    rawReq.length === 0, rawReq.join(", "));
  const exLayout = SRC.get("src/app/individual/(app)/[experience]/layout.tsx") ?? "";
  const welcomeAt = exLayout.indexOf("membership.onboardedAt) redirect(`/individual/welcome");
  ok("12e. a not-yet-onboarded member entering an experience goes through the welcome first, AFTER the live check",
    welcomeAt > -1 && exLayout.indexOf("if (!live.includes(experience))") > -1
    && exLayout.indexOf("if (!live.includes(experience))") < welcomeAt && welcomeAt < exLayout.indexOf("contextTermsGate(shell.ctx, experience)"));
  const hqPage = strip(readFileSync("src/app/super-admin/individual/page.tsx", "utf8"));
  const hqBoard = strip(readFileSync("src/app/super-admin/individual/IndividualAccessBoard.tsx", "utf8"));
  ok("12f. the HQ grant screen enforces hq.individual.pilot.grant on the page, and the route intent declares the same",
    /await requireHqCapability\("hq\.individual\.pilot\.grant"\)/.test(hqPage)
    && capabilityForRoute("/super-admin/individual") === "hq.individual.pilot.grant");
  ok("12g. the HQ grant screen writes nothing itself: no table call, every change goes through the gated /api/hq/individual routes",
    !/\.from\("/.test(hqPage + hqBoard) && /"\/api\/hq\/individual\/grants"/.test(hqBoard) && /"\/api\/hq\/individual\/grants\/end"/.test(hqBoard));
  ok("12h. the HQ sidebar links to the screen (a door, so the page is not left reachable only by URL)",
    GENERAL_NAV.some(s => s.items.some(i => i.href === "/super-admin/individual")));
  const loginSrc = strip(readFileSync("src/app/login/page.tsx", "utf8"));
  ok("12i. the login's Individual presentation is copy only: next is still validated by the one existing rule",
    /signInProductName\(/.test(loginSrc) && /next && next\.startsWith\("\/"\) && !next\.startsWith\("\/\/"\) && !BUILDING\[next\]/.test(loginSrc));

  // ⚠ SWITCHING INDIVIDUAL ON IS THE OWNER'S ACT, NEVER AN APPLICATION'S (COMPETEN-IND-ACCESS-001 s5,
  // CONFIG-002). The release flag is a row the owner writes by hand. No route, page or library in the
  // application may write it: the only flag writer (/api/v1/practice/flags) allowlists the three Practice
  // launch flags and refuses every other name, and no other file writes practice_platform_flags at all.
  const flagWriters = walk("src").map(posix).filter(f => /from\("practice_platform_flags"\)\s*\.(insert|update|upsert|delete)\(/.test(strip(readFileSync(f, "utf8"))));
  const flagsRoute = strip(readFileSync("src/app/api/v1/practice/flags/route.ts", "utf8"));
  const allow = /const FLAGS: Record<string, string> = \{([\s\S]*?)\};/.exec(flagsRoute)?.[1] ?? "";
  ok("12j. no application code can switch individual_app: one flag writer, allowlisted to Practice flags, refusing anything else",
    flagWriters.length === 1 && flagWriters[0] === "src/app/api/v1/practice/flags/route.ts"
    && /practice_sign_in/.test(allow) && !/individual_/.test(allow) && /if \(!FLAGS\[flag\]\) return NextResponse\.json/.test(flagsRoute)
    && !walk("src").map(posix).some(f => /["'`]individual_app["'`]/.test(strip(readFileSync(f, "utf8"))) && f !== "src/lib/individual/gate.ts"),
    `writers: ${flagWriters.join(", ")}`);
  // CONFIG-002 item 3, the capability half: whatever Individual HQ rights exist -- hq.individual.pilot.grant
  // (370), hq.individual.config.manage (IND-007, 376) or a later one -- none may reach the flag writer. Its
  // gate is hq.practice.flags.manage, and no migration statement may grant that right to an Individual
  // position. And the gate reads ONE store, so no other configuration (a WCE override, an env var) can
  // switch Individual on behind it.
  const flagsGate = /hqApiGate\(\["hq\.practice\.flags\.manage"\]\)/.test(flagsRoute) && (flagsRoute.match(/hqApiGate\(/g) ?? []).length === 1;
  const grantsToIndividual = readdirSync("supabase/migrations").filter(f => f.endsWith(".sql")).flatMap(f =>
    readFileSync(join("supabase/migrations", f), "utf8").replace(/--.*$/gm, "").split(";")
      .filter(st => /hq_position_capability/i.test(st) && /hq\.practice\.flags\.manage/.test(st) && /'individual_[a-z_]+'/.test(st))
      .map(() => f));
  const gateSrc = SRC.get("src/lib/individual/gate.ts") ?? "";
  ok("12k. no Individual HQ right reaches the flag writer, and the gate reads only practice_platform_flags",
    flagsGate && grantsToIndividual.length === 0
    && (gateSrc.match(/\.from\(/g) ?? []).length === 1 && /\.from\("practice_platform_flags"\)/.test(gateSrc) && !/process\.env/.test(gateSrc),
    `flagsGate=${flagsGate} grantsToIndividual=${grantsToIndividual.join(", ")}`);

  // ── 12l-12n. INVITATIONS FOR PEOPLE WITHOUT AN ACCOUNT (migration 378) ──
  const acceptSrc = SRC.get(ACCEPT_ROUTE) ?? "";
  // The pre-membership boundary (guard.ts requireIndividualSession): release gate first, then the session.
  const sessionGuard = guardSrc.slice(guardSrc.indexOf("export async function requireIndividualSession"));
  ok("12l. the accept route enters requireIndividualSession (gate FIRST, then session), and takes nothing from the body",
    sessionGuard.length > 0 && sessionGuard.indexOf("await connection()") > -1
    && sessionGuard.indexOf("individualAppEnabled(admin)") > -1 && sessionGuard.indexOf("individualAppEnabled(admin)") < sessionGuard.indexOf("auth.getUser()")
    && !/from\("individual_/.test(sessionGuard.slice(0, sessionGuard.indexOf("export const isSessionRefusal")))
    && acceptSrc.indexOf("requireIndividualSession()") > -1 && acceptSrc.indexOf("requireIndividualSession()") < acceptSrc.indexOf("acceptIndividualInvitation(")
    && !/req\.json\(|request\.json\(|searchParams/.test(acceptSrc) && /acceptIndividualInvitation\(s\.admin, \{ id: s\.userId,/.test(acceptSrc));
  const invSrc = SRC.get("src/lib/individual/invitations.ts") ?? "";
  const modes = [
    inviteDeliveryMode({ INDIVIDUAL_INVITE_TEST_DELIVERY: "link", NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: "https://ezhvpgtcqcdsgylrxgdb.supabase.co" }),
    inviteDeliveryMode({ INDIVIDUAL_INVITE_TEST_DELIVERY: "link", NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://ezhvpgtcqcdsgylrxgdb.supabase.co" }),
    inviteDeliveryMode({ INDIVIDUAL_INVITE_TEST_DELIVERY: "link", NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` }),
    inviteDeliveryMode({ INDIVIDUAL_INVITE_TEST_DELIVERY: "link", NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: "" }),
    inviteDeliveryMode({ NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: "https://ezhvpgtcqcdsgylrxgdb.supabase.co" }),
  ];
  ok("12m. the test 'return the link' delivery runs ONLY under next dev, against an identifiable non-production project, when asked",
    modes.join() === "link,email,email,email,email"
    && /from "\.\.\/\.\.\/\.\.\/scripts\/production-guard"/.test(invSrc) && /judgeTarget\(env\.NEXT_PUBLIC_SUPABASE_URL\)/.test(invSrc)
    && /opts\.delivery === "link" && testLink \? \{ testLink \}/.test(invSrc) && (invSrc.match(/generateLink\(/g) ?? []).length === 1
    && /const delivery = inviteDeliveryMode\(\);/.test(SRC.get("src/app/api/hq/individual/invitations/route.ts") ?? ""),
    `modes=${modes.join()}`);
  ok("12n. an invitation creates the identity through Supabase auth's invite and nothing else: no createUser, no signUp, no other product, and no estate role on its new identity",
    /auth\.admin\.inviteUserByEmail\(/.test(invSrc) && !/auth\.admin\.createUser\(|auth\.signUp\(/.test(invSrc)
    && !/platform_membership|grantPlatformMembership|practice_|enterprise_/.test(invSrc)
    && /if \(!reuse\) \{\s*const clear = await admin\.from\("profiles"\)\.update\(individualIdentityProfile\(\)\)\.eq\("id", authUserId\);/.test(invSrc));

  // ── 12o. MEMBERSHIP STATUS (LEGAL-001 s13 step 7): suspend, reinstate, revoke ──
  const memRoute = SRC.get("src/app/api/hq/individual/grants/membership/route.ts") ?? "";
  ok("12o. the membership action: pilot-grant right, then gate, not yourself; revoke needs a reason, is terminal, and touches only the membership",
    /hqApiGate\(\["hq\.individual\.pilot\.grant"\]\)/.test(memRoute) && /targetUserId === ctx\.userId/.test(memRoute)
    && /individualAppEnabled\(ctx\.admin\)\)\) return NextResponse\.json/.test(memRoute)
    && /const FROM: Record<MembershipAction, string\[\]> = \{ suspend: \["active"\], reinstate: \["suspended"\], revoke: \["active", "suspended"\] \};/.test(grantsLib)
    && /action === "revoke" && \(reason \?\? ""\)\.length < 8/.test(grantsLib)
    && !/from\("individual_entitlement"\)/.test(grantsLib.slice(grantsLib.indexOf("export async function setIndividualMembershipStatus"), grantsLib.indexOf("export async function endIndividualExperience"))));

  ok("9g. D10: no Individual code persists AI conversation",
    !FILES.some(f => /from\("[a-z_]*(ai_message|ai_session|conversation)[a-z_]*"\)/.test(SRC.get(f) ?? "")));

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"} -- ${pass} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main();
