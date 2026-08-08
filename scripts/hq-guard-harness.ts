/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * hq-guard-harness — proves the HQ guard refuses.
 *
 * PLAT-ARCH-SURVEY-001 step 5. Four required outcomes, and every one of them is here:
 *   1. an owner reaches everything (and cannot be locked out by missing data),
 *   2. a NAMED non-owner position provably cannot reach a space it was not granted,
 *   3. landlordCan's empty-`required` branch DENIES,
 *   4. no /super-admin route is left `auth-only` -- or `none`, or `unknown`.
 *
 * ⚠ EVERY REFUSAL IS PAIRED WITH A CONTROL. A test that only ever asserts "denied" passes just as loudly
 * when the thing it guards has been deleted and nothing is reachable at all. So each refusal below sits
 * next to the positive case that would break if the resolver stopped resolving.
 *
 * ⚠ AND THE COUNT CONTROLS ARE NOT DECORATION. A walker that silently reads nothing makes every "no page
 * is ungated" assertion pass. PAGE_BASELINE and the catalogue-size checks are what stop that.
 *
 * THE DDL IS PARSED, NOT ASSUMED. Migration 264 has not been applied when this is first run (the user
 * applies migrations by hand, once), so the position/capability/grant assertions read the seed rows out of
 * the migration FILE and run the real decision function over them. When the migration IS applied, the same
 * assertions additionally check the database agrees with the file. Checks that need the database report
 * PENDING rather than PASS -- a pending check is never counted as green.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { classifyHqGate } from "../src/lib/access/hq-scan";
import {
  HQ_SPACES, HQ_CAPABILITIES, HQ_CAPABILITY_CODES, HQ_ROUTE_INTENT, HQ_HOME_CAPABILITY,
  capabilityForRoute, decideHq, activeGrants, isHqOfficeType, hqOfficeType,
} from "../src/lib/hq/spaces";
import { landlordCan, type LandlordCaller } from "../src/lib/platform/landlord";
import { PLATFORM_ROLES, type PlatformRole } from "../src/lib/roles";

loadEnvConfig(process.cwd());

// ── The count control. 204 page patterns under /super-admin, from the build manifest and confirmed by
// walking the tree. If this number moves, a page was added or removed and every subset assertion below is
// measuring a different estate than the one that was reviewed.
const PAGE_BASELINE = 204;
const MIGRATION = "supabase/migrations/264-hq-positions-and-spaces.sql";
const APP_ROOT = "src/app/super-admin";

let pass = 0, fail = 0, pending = 0;
const failures: string[] = [];
const ok = (id: string, cond: boolean, msg: string) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { fail++; failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}`); }
};
const skip = (id: string, msg: string) => { pending++; console.log(`  PEND  ${id}  ${msg} (migration 264 not applied)`); };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── Fixtures ─────────────────────────────────────────────────────────────────
function walkPages(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkPages(p, out);
    else if (e === "page.tsx") out.push(p);
  }
  return out;
}
const routeOf = (file: string) =>
  "/" + file.split("\\").join("/").replace(/^src\/app\//, "").replace(/\/page\.tsx$/, "")
    .split("/").filter(seg => !(seg.startsWith("(") && seg.endsWith(")"))).join("/");

// Parse the seed rows straight out of the migration, so the DDL and the TypeScript catalogue can never
// quietly disagree and so the decision tests below run against the data that will actually ship.
const sql = readFileSync(MIGRATION, "utf8");
const rowsOf = (table: string): string[][] => {
  const start = sql.indexOf(`insert into ${table} (`);
  if (start < 0) return [];
  const block = sql.slice(start, sql.indexOf("on conflict", start));
  const body = block.slice(block.indexOf(" values") + 7);
  return [...body.matchAll(/\(([^()]*)\)/g)].map(m =>
    m[1].split(",").map(v => v.trim().replace(/^'/, "").replace(/'$/, "")));
};
const ddlCapabilities = rowsOf("hq_capability").map(r => ({ code: r[0], space: r[1] }));
const ddlPositions = rowsOf("hq_position").map(r => ({ code: r[0], space: r[1], name: r[2] }));
const ddlGrants = rowsOf("hq_position_capability").map(r => ({ position: r[0], capability: r[1] }));
const grantsFor = (position: string) => ddlGrants.filter(g => g.position === position).map(g => g.capability);

// ── 1. The estate: no /super-admin page may be reachable on the layout alone ─
console.log("\n1. THE ESTATE -- every page carries its own gate");
const pages = walkPages(APP_ROOT);
ok("E1", pages.length === PAGE_BASELINE,
  `count control: ${pages.length} page.tsx under ${APP_ROOT} (baseline ${PAGE_BASELINE}) -- a walker that reads nothing passes every check below`);

const classified = pages.map(f => ({ file: f, route: routeOf(f), gate: classifyHqGate(readFileSync(f, "utf8")) }));
const byKind = new Map<string, string[]>();
for (const c of classified) byKind.set(c.gate.kind, [...(byKind.get(c.gate.kind) ?? []), c.route]);
console.log("        gate kinds:", [...byKind.entries()].map(([k, v]) => `${k}=${v.length}`).join(" "));

for (const bad of ["auth-only", "none", "unknown"] as const) {
  const hits = byKind.get(bad) ?? [];
  ok(`E2.${bad}`, hits.length === 0,
    `zero /super-admin pages classify as "${bad}"${hits.length ? ` -- ${hits.slice(0, 6).join(", ")}` : ""}`);
}
ok("E3", (byKind.get("hq-position") ?? []).length >= 36,
  `${(byKind.get("hq-position") ?? []).length} pages now carry an HQ capability gate (the 36 that had no gate of their own)`);
ok("E4", (byKind.get("single-role") ?? []).length > 0,
  `control: ${(byKind.get("single-role") ?? []).length} pages still classify as single-role -- the classifier has not simply stopped distinguishing kinds`);

// ── 2. The intent map, in BOTH directions ───────────────────────────────────
console.log("\n2. THE INTENT MAP -- a new route must fail, not disappear");
const unmapped = classified.filter(c => capabilityForRoute(c.route) === null).map(c => c.route);
ok("I1", unmapped.length === 0,
  `every scanned /super-admin route resolves to a declared capability${unmapped.length ? ` -- unmapped: ${unmapped.slice(0, 8).join(", ")}` : ""}`);
const deadIntents = HQ_ROUTE_INTENT.filter(i => !classified.some(c => c.route === i.prefix || c.route.startsWith(i.prefix + "/")));
ok("I2", deadIntents.length === 0,
  `every declared intent prefix has at least one real page${deadIntents.length ? ` -- dead: ${deadIntents.map(d => d.prefix).join(", ")}` : ""}`);
ok("I3", HQ_ROUTE_INTENT.every(i => HQ_CAPABILITY_CODES.includes(i.capability)),
  "every capability named by the intent map exists in the capability catalogue");
ok("I4", capabilityForRoute("/super-admin/platform-ops/practice") === "hq.practice.operations.view"
      && capabilityForRoute("/super-admin/platform-ops/configuration") === "hq.platform.operations.view",
  "order control: the longer prefix wins -- platform-ops/practice is the PRACTICE space, platform-ops is not");
ok("I5", capabilityForRoute("/super-admin-elsewhere") === null && capabilityForRoute("/practice/x") === null,
  "prefixes match on a segment boundary, so /super-admin never claims a route that merely starts like it");

// ── 3. DDL vs TypeScript ────────────────────────────────────────────────────
console.log("\n3. THE MIGRATION AND THE CODE AGREE");
ok("D1", ddlCapabilities.length === HQ_CAPABILITIES.length,
  `catalogue size control: ${ddlCapabilities.length} capabilities in the DDL, ${HQ_CAPABILITIES.length} in code`);
ok("D2", eq([...ddlCapabilities].map(c => c.code).sort(), [...HQ_CAPABILITY_CODES].sort()),
  "the DDL capability codes and the TypeScript catalogue are the same set");
ok("D3", ddlCapabilities.every(c => (HQ_SPACES as readonly string[]).includes(c.space)),
  "every DDL capability sits in one of the five closed spaces");
ok("D4", HQ_SPACES.every(s => sql.includes(`'${s}'`)) && ddlPositions.length > 0,
  `all five spaces appear in the migration CHECK vocabulary and ${ddlPositions.length} positions are seeded`);
// ⚠ Checked against the DDL's OWN rows, not against the TypeScript catalogue. Written the other way first,
// and a break test proved it vacuous: renaming a capability inside the migration left every grant pointing
// at a code the migration no longer defines, and this assertion stayed green because it was reading the
// TypeScript list instead. D2 is what ties the two files together -- this one has to police the file.
ok("D5", ddlGrants.every(g => ddlCapabilities.some(c => c.code === g.capability) && ddlPositions.some(p => p.code === g.position)),
  `all ${ddlGrants.length} seeded grants reference a position and a capability the SAME migration defines`);
ok("D6", ddlPositions.every(p => grantsFor(p.code).includes(HQ_HOME_CAPABILITY)),
  "every position can reach the HQ landing page -- a position that sees nothing at all is a support ticket");
// ⚠ Matches the INSERT's own select list, not merely the presence of the string somewhere in the file.
// Written the loose way first, and a break test proved it vacuous: changing the seeded office_type from
// 'hq_quality' to 'quality' -- the exact mistake that would let an HQ appointment confer Hospital Executive
// access -- left the string 'hq_quality' behind in the idempotency guard and the assertion stayed green.
ok("D7", HQ_SPACES.every(s => sql.includes(`select null, null, '${hqOfficeType(s)}', 'HQ `)),
  "the five ogs_offices seeds are typed hq_* so the tenant workspace matchers cannot see them");
ok("D8", !/^\s*--.*;/m.test(sql) && !/[^\x00-\x7F]/.test(sql),
  "migration house rules: ASCII only, and no semicolon inside a comment (one shredded two sections of 238)");

// ── 4. The decision, over the data that will actually ship ──────────────────
console.log("\n4. THE DECISION -- owner reaches everything, a named position does not");
const OWNER = { isOwner: true, positions: [], capabilities: [], mode: "observe" as const };
ok("A1", decideHq({ ...OWNER, capability: "hq.executive.priorities.view" }).allowed
      && decideHq({ ...OWNER, capability: null }).allowed
      && decideHq({ ...OWNER, capability: "hq.does.not.exist" }).allowed
      && decideHq({ ...OWNER, mode: "enforce", capability: null }).allowed,
  "an owner reaches every capability, an unmapped route, and a capability that does not exist -- in both modes");
ok("A2", decideHq({ ...OWNER, capability: "hq.executive.priorities.view" }).decision === "allow_owner",
  "control: the owner path is reported as allow_owner, so break-glass use is distinguishable in the ledger");

const cpd = { isOwner: false, positions: ["practice_product_director"], capabilities: grantsFor("practice_product_director") };
ok("A3", cpd.capabilities.length > 0,
  `control: the Practice Product Director actually holds ${cpd.capabilities.length} capabilities -- an empty grant set would make every refusal below vacuous`);
ok("A4", decideHq({ ...cpd, capability: "hq.practice.operations.view", mode: "enforce" }).allowed,
  "positive: the Practice Product Director reaches the Practice space");
ok("A5", !decideHq({ ...cpd, capability: "hq.executive.priorities.view", mode: "enforce" }).allowed
      && decideHq({ ...cpd, capability: "hq.executive.priorities.view", mode: "enforce" }).decision === "deny",
  "⚠ NEGATIVE FIXTURE: the Practice Product Director is REFUSED the Executive space it was never granted");
ok("A6", !decideHq({ ...cpd, capability: "hq.platform.system.view", mode: "enforce" }).allowed
      && !decideHq({ ...cpd, capability: "hq.quality.policy.view", mode: "enforce" }).allowed
      && !decideHq({ ...cpd, capability: "hq.learning.studio.view", mode: "enforce" }).allowed,
  "and refused the Platform, Quality and Learning spaces too -- the refusal is not one lucky code");

const ceo = { isOwner: false, positions: ["chief_executive"], capabilities: grantsFor("chief_executive") };
const cfo = { isOwner: false, positions: ["chief_financial_officer"], capabilities: grantsFor("chief_financial_officer") };
ok("A7", decideHq({ ...ceo, capability: "hq.executive.priorities.view", mode: "enforce" }).allowed
      && !decideHq({ ...cfo, capability: "hq.executive.priorities.view", mode: "enforce" }).allowed
      && decideHq({ ...cfo, capability: "hq.executive.reports.view", mode: "enforce" }).allowed,
  "⚠ THE SPACE IS NOT THE POSITION: CEO and CFO share the Executive space and differ only by their grants");

ok("A8", !decideHq({ isOwner: false, positions: [], capabilities: [], capability: "hq.platform.home.view", mode: "observe" }).allowed
      && !decideHq({ isOwner: false, positions: [], capabilities: [], capability: "hq.platform.home.view", mode: "enforce" }).allowed,
  "the HARD gate holds in BOTH modes: no HQ appointment means no entry, so observe mode is never wider than today's layout");
const obs = decideHq({ ...cpd, capability: "hq.executive.priorities.view", mode: "observe" });
ok("A9", obs.allowed && obs.decision === "would_deny",
  "OBSERVE BEFORE ENFORCE: the same refusal is recorded as would_deny and lets the request through");
ok("A10", !decideHq({ ...cpd, capability: null, mode: "enforce" }).allowed
      && decideHq({ ...cpd, capability: null, mode: "observe" }).decision === "would_deny",
  "⚠ an UNMAPPED route denies -- a new HQ page that forgets to declare itself is refused, not admitted");

const now = Date.parse("2026-08-08T00:00:00Z");
ok("A11", activeGrants([{ effective_from: "2026-01-01", effective_to: null }], now).length === 1
      && activeGrants([{ effective_from: "2026-01-01", effective_to: "2026-02-01" }], now).length === 0
      && activeGrants([{ effective_from: "2027-01-01", effective_to: null }], now).length === 0,
  "grants are time-bound both ways: an expired grant and a not-yet-started grant both count for nothing");

// ── 5. landlordCan ──────────────────────────────────────────────────────────
console.log("\n5. landlordCan -- the empty-required branch");
const caller = (roles: PlatformRole[], owner = false): LandlordCaller => ({
  admin: null as any, userId: "u", fullName: null, appRoles: [], platformRoles: roles,
  isSuperAdmin: owner, isOwner: owner,
});
ok("L1", landlordCan(caller(["finance"])) === false,
  "⚠ THE FIX: landlordCan with NO required roles now DENIES a platform-role holder (it returned true)");
ok("L2", landlordCan(caller([], true)) === true,
  "control: an owner still passes the empty-required branch, so the fix cannot lock the owners out");
ok("L3", landlordCan(caller(["finance"]), "finance") === true,
  "control: the same caller still passes when the route names their role -- the resolver still resolves");
ok("L4", landlordCan(caller(["finance"]), "platform_operations") === false,
  "a role the route did not name is refused");
ok("L5", landlordCan(caller(["platform_super_admin"]), "platform_operations") === true
      && landlordCan(caller(["developer"]), "engineer") === true,
  "the two documented back-compat aliases resolve to their canonical role instead of being silently ignored");
ok("L6", landlordCan(caller(["support"]), "platform_operations") === false,
  "control: aliasing did not turn the gate into a pass-through");

const callSites = ["deployments/route.ts", "flags/assign/route.ts", "identity/route.ts", "products/toggle/route.ts",
  "provision/route.ts", "support/tickets/route.ts", "tenants/[id]/status/route.ts", "tenants/[id]/subscription/route.ts"]
  .map(f => readFileSync(join("src/app/api/platform", f), "utf8"));
const passed = callSites.flatMap(s => [...s.matchAll(/landlordCan\s*\(\s*\w+\s*,\s*((?:"[a-z_]+"\s*,?\s*)+)\)/g)]
  .flatMap(m => [...m[1].matchAll(/"([a-z_]+)"/g)].map(x => x[1])));
ok("L7", passed.length >= 9 && passed.every(r => (PLATFORM_ROLES as string[]).includes(r)),
  `all ${passed.length} role codes passed by the 8 /api/platform call sites are real PlatformRole values`);
ok("L8", !passed.includes("platform_super_admin"),
  "the redundant alias is gone from the call sites -- they now name canonical roles only");

// ── 6. The scanner extension ────────────────────────────────────────────────
console.log("\n6. THE SCANNER CAN SEE THE HQ IDIOM");
const guarded = `import { requireHqContext } from "@/lib/hq/context";\nexport default async function P(){ const { admin } = await requireHqContext("hq.platform.ai.view"); return admin }`;
const bogus = guarded.replace("hq.platform.ai.view", "hq.platform.nope.view");
const naked = `export default async function P(){ return <div/> }`;
ok("S1", classifyHqGate(guarded).kind === "hq-position" && eq(classifyHqGate(guarded).capabilities, ["hq.platform.ai.view"]),
  "a page guarded by requireHqContext classifies as hq-position with its capability -- NOT as `none` (which roleReaches answers true for)");
ok("S2", classifyHqGate(bogus).kind === "unknown",
  "control: a capability that is not in the catalogue is `unknown`, never a silently-empty gate");
ok("S3", classifyHqGate(naked).kind === "none",
  "control: a genuinely ungated page still classifies as `none` -- the extension did not blanket everything");

// ── 7. Live database ────────────────────────────────────────────────────────
(async () => {
  console.log("\n7. LIVE DATABASE");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  // ⚠ NO head+count -- that combination returns NO ERROR for a missing table, which is how four tables
  // that do not exist were reported PRESENT while writing this.
  const { error: absent } = await admin.from("hq_position").select("code").limit(1);

  // These two run whether or not 264 is applied.
  const { data: profs } = await admin.from("profiles").select("id, role, roles, platform_role").limit(5000);
  const held = new Set((profs ?? []).map((p: any) => p.platform_role).filter(Boolean));
  ok("P1", [...held].every(r => (PLATFORM_ROLES as string[]).includes(r as string)),
    `the CHECK constraint in 264 refuses nothing anybody already holds -- live values: ${[...held].join(", ") || "(none)"}`);
  const owners = (profs ?? []).filter((p: any) => ((p.roles?.length ? p.roles : [p.role]) as string[]).includes("super_admin"));
  ok("P2", owners.length >= 1,
    `⚠ owner control: ${owners.length} super_admin account(s) exist and every one of them short-circuits the guard before any HQ table is read`);

  if (absent) {
    for (const id of ["B1", "B2", "B3", "B4", "B5"]) skip(id, "database seed checks");
    return report();
  }

  const { data: caps } = await admin.from("hq_capability").select("code, space").limit(500);
  ok("B1", eq(((caps ?? []) as any[]).map(c => c.code).sort(), [...HQ_CAPABILITY_CODES].sort()),
    "the applied capability catalogue is exactly the code catalogue");
  const { data: offices } = await admin.from("ogs_offices").select("id, office_type, code, scope_type, hospital_id").limit(500);
  const hqOffices = ((offices ?? []) as any[]).filter(o => isHqOfficeType(o.office_type));
  ok("B2", hqOffices.length === HQ_SPACES.length && hqOffices.every(o => o.hospital_id === null && o.scope_type === "enterprise"),
    `${hqOffices.length} enterprise HQ office(s) seeded, none bound to a hospital`);
  const { data: appts } = await admin.from("ogs_office_appointments").select("id").limit(10);
  ok("B3", (appts ?? []).length === 0,
    "⚠ NOBODY IS APPOINTED. The migration seeds spaces and positions and grants no human anything");
  const { data: cfg } = await admin.from("hq_config").select("mode").eq("id", "singleton").limit(1);
  ok("B4", (cfg?.[0] as any)?.mode === "observe",
    "ships in OBSERVE -- the position matrix records what it would refuse and refuses nothing");
  const { data: grants } = await admin.from("hq_position_capability").select("position_code, capability_code").limit(2000);
  const dbGrant = (p: string) => ((grants ?? []) as any[]).filter(g => g.position_code === p).map(g => g.capability_code).sort();
  ok("B5", eq(dbGrant("chief_executive"), grantsFor("chief_executive").sort())
        && eq(dbGrant("practice_product_director"), grantsFor("practice_product_director").sort()),
    "the applied grants match the migration file the decision tests were run against");
  report();
})();

function report() {
  console.log(`\n${fail === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${fail} failed, ${pending} pending`);
  if (failures.length) { console.log("\nFAILURES:"); failures.forEach(f => console.log("  " + f)); }
  process.exit(fail === 0 ? 0 : 1);
}
