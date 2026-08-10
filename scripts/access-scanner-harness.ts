/**
 * The access-matrix scanner's own harness — src/lib/access/scan.ts + hq-scan.ts.
 *
 * Run:  npx --yes tsx scripts/access-scanner-harness.ts
 *
 * ⚠ WHY THE SCANNER NEEDS ONE. It is the thing that TELLS A HUMAN which routes are open. Every failure it
 * has had has been silent, and it has had them in both directions:
 *
 *   TOO OPEN  — 98 correctly-gated practice routes reported as `none` ("reachable without signing in"),
 *               because nothing knew about requirePracticeContext. Nearly repeated for requireHqCapability.
 *   TOO SHUT  — six correctly role-gated routes reported as `auth-only` ("any signed-in user"), because
 *               they spell their gate as an INLINE role array rather than a named group. That one was
 *               acted on: it produced a written claim that a nurse could call them, which was false.
 *
 * Both directions matter. A matrix that under-reports gates gets people to "fix" routes that were never
 * broken; a matrix that over-reports them gets a real hole filed as done.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { classifyGate } from "../src/lib/access/scan";
import { classifyHqGate } from "../src/lib/access/hq-scan";
import { HQ_HOME_CAPABILITY, HQ_CAPABILITY_CODES } from "../src/lib/hq/spaces";
import { ADMIN_ROLES, STAFF_ROLES, EDUCATOR_ROLES, SUPERVISOR_ROLES } from "../src/lib/api-auth";

const GROUPS = { ADMIN_ROLES, STAFF_ROLES, EDUCATOR_ROLES, SUPERVISOR_ROLES };
const CAPS = { HQ_HOME_CAPABILITY: { "": HQ_HOME_CAPABILITY } };

let pass = 0;
const failures: string[] = [];
const ok = (id: string, cond: boolean, msg: string) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}`); }
};

const g = (src: string) => classifyHqGate(src, GROUPS, CAPS);
const has = (roles: string[] | undefined, ...want: string[]) => want.every(w => (roles ?? []).includes(w));

console.log("\nACCESS SCANNER\n");

// ── 1. The inline role-array idiom (the false-positive class) ───────────────────────────────────────
console.log("  -- 1. inline role arrays --");

const someInline = `export async function POST(){ const roles=[]; if (!roles.some(r => ["super_admin","hospital_admin","educator"].includes(r))) return new Response("",{status:403}); }`;
ok("I1", g(someInline).kind === "role-list" && has(g(someInline).roles, "super_admin", "hospital_admin", "educator"),
  `.some(r => [..].includes(r)) is a role gate (got ${g(someInline).kind}: ${(g(someInline).roles ?? []).join(", ")})`);

const includesInline = `export async function POST(){ const profile:any={}; if (!["super_admin","hospital_admin"].includes(profile?.role ?? "")) return new Response("",{status:403}); }`;
ok("I2", g(includesInline).kind === "role-list" && has(g(includesInline).roles, "super_admin", "hospital_admin"),
  `[..].includes(profile.role) is a role gate (got ${g(includesInline).kind})`);

const localConst = `import { getCaller, forbidden } from "@/lib/api-auth";
const AUTHOR_ROLES = ["super_admin","hospital_admin","educator","assessor"];
export async function POST(){ const c:any = await getCaller(); if (!c.roles.some((r:string) => AUTHOR_ROLES.includes(r))) return forbidden(); }`;
ok("I3", g(localConst).kind === "role-list" && has(g(localConst).roles, "assessor"),
  `a LOCAL role constant behind getCaller resolves (got ${g(localConst).kind}: ${(g(localConst).roles ?? []).join(", ")})`);

// ⚠ THE CONTROL THAT STOPS THIS INVENTING PROTECTION — a route reported as gated when nothing gates it is
// the dangerous direction.
//
// ⚠ AND THE FIRST VERSION OF THIS CONTROL WAS VACUOUS, WHICH A DELIBERATE BREAK CAUGHT. It used
// `[..].includes(kind)`, which the inline regexes never match anyway (the `.includes(` form requires a
// `role` token), so it passed whether or not the canonical-role test existed — removing that test left this
// control GREEN. The fixture must MATCH the pattern and then be rejected on the role check, not miss the
// pattern entirely. This one uses the `.some(r => [..].includes(r))` shape with a list of non-roles.
const notRoles = `export async function POST(){ const kinds: string[] = []; if (!kinds.some(r => ["draft","published","archived"].includes(r))) return new Response("",{status:400}); }`;
ok("I4-control", g(notRoles).kind !== "role-list",
  `CONTROL: a list of NON-roles in the same shape is NOT read as a role gate (got ${g(notRoles).kind}) -- the matrix must not invent protection`);

const stillAuthOnly = `import { getCaller } from "@/lib/api-auth";
export async function POST(){ const c:any = await getCaller(); return Response.json({ id: c.userId }); }`;
ok("I5-control", g(stillAuthOnly).kind === "auth-only",
  `CONTROL: getCaller with no role test is STILL auth-only (got ${g(stillAuthOnly).kind}) -- the new branch has not swallowed the category`);

// ── 2. The guard helpers the scanner must never miss ────────────────────────────────────────────────
console.log("\n  -- 2. guard helpers --");

for (const [id, helper] of [["G1", "requireHqContext"], ["G2", "requireHqCapability"], ["G3", "resolveHqContext"]] as const) {
  const src = `import { ${helper} } from "@/lib/hq/context";\nexport default async function P(){ await ${helper}("hq.platform.ai.view"); }`;
  const gate = g(src);
  ok(id, gate.kind === "hq-position" && (gate.capabilities ?? []).includes("hq.platform.ai.view"),
    `${helper} classifies as hq-position carrying its capability (got ${gate.kind})`);
}

// ⚠ THE FAILURE MODE ITSELF, ASSERTED. An unknown guard helper must NOT come out as `none`.
const unknownHelper = `import { requireSomethingNobodyTaughtTheScanner } from "@/lib/x";
export default async function P(){ await requireSomethingNobodyTaughtTheScanner("x"); return null }`;
ok("G4", g(unknownHelper).kind === "none",
  `⚠ a guard helper the scanner has never heard of DOES come out as "none" (got ${g(unknownHelper).kind}) -- this is the known blind spot, asserted so nobody rediscovers it by shipping`);

ok("G5", classifyGate(`export default function P(){ return null }`).kind === "none",
  "control: a file with no gate at all is none -- G4 is the blind spot, not a scanner that says none about everything");

// ── 3. The six that were misreported, read from the REAL files ─────────────────────────────────────
console.log("\n  -- 3. the six false positives, on the shipped files --");
const SIX = [
  ["/api/ai/assistant", "src/app/api/ai/assistant/route.ts"],
  ["/api/ai/governance", "src/app/api/ai/governance/route.ts"],
  ["/api/knowledge-objects", "src/app/api/knowledge-objects/route.ts"],
  ["/api/osce/exams", "src/app/api/osce/exams/route.ts"],
  ["/api/quality/capa", "src/app/api/quality/capa/route.ts"],
  ["/api/studio", "src/app/api/studio/route.ts"],
] as const;

let n = 0;
const wrong: string[] = [];
const admitsNurse: string[] = [];
for (const [route, file] of SIX) {
  const gate = g(readFileSync(file, "utf8"));
  n++;
  if (gate.kind !== "role-list") wrong.push(`${route} -> ${gate.kind}`);
  if ((gate.roles ?? []).includes("nurse")) admitsNurse.push(route);
}
ok("S0-control", n === SIX.length, `count control: all ${n} files were read`);
ok("S1", wrong.length === 0,
  `each of the six classifies as role-list, not auth-only${wrong.length ? ` -- ${wrong.join("; ")}` : ""}`);
ok("S2", admitsNurse.length === 0,
  `⚠ THE CLAIM THAT WAS WRONG: none of the six admits a nurse${admitsNurse.length ? ` -- ${admitsNurse.join(", ")}` : ""}`);

// ── 4. The HQ catalogue is not empty (vacuity floor) ───────────────────────────────────────────────
ok("V1", HQ_CAPABILITY_CODES.length > 20 && ADMIN_ROLES.length > 0,
  `count control: ${HQ_CAPABILITY_CODES.length} HQ capabilities and ${ADMIN_ROLES.length} admin roles loaded -- the fixtures above resolve against real data`);

console.log(`\n${failures.length ? "RED" : "ALL GREEN"}  ${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log("\nFAILURES:"); failures.forEach(f => console.log("  " + f)); }
process.exit(failures.length ? 1 : 0);
