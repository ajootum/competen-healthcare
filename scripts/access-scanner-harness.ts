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
import { NextResponse } from "next/server";
import { hqApiGate } from "../src/lib/hq/api-gate";
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

// ⚠ hqApiGate IS NOT IN THIS LOOP, AND THAT IS NOT AN OMISSION. These three REDIRECT or THROW on refusal,
// so merely calling them gates the route. hqApiGate RETURNS the refusal, so calling it proves nothing until
// the caller returns it -- see G8. Its recognition is covered by G8-control on a realistic fixture and by
// G10 on the shipped files.
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

// An ANY-OF gate passes an array constant, not a literal. Reporting one of its codes would understate the
// audience; this scanner's contract is the UNION.
const anyOf = `import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
const CAPABILITIES = ["hq.learning.knowledge.view", "hq.learning.studio.view"];
export async function PATCH(){ const ctx = await hqApiGate(CAPABILITIES); if (isHqRefusal(ctx)) return ctx; }`;
ok("G6", g(anyOf).kind === "hq-position" && (g(anyOf).capabilities ?? []).length === 2,
  `an any-of capability array reports BOTH codes, not just the first (got ${(g(anyOf).capabilities ?? []).join(", ") || "none"})`);

// ⚠ THE CONTROL: a local array of things that are NOT capability codes must resolve to nothing rather than
// inventing one -- the same discipline as looksLikeRoles above.
const fakeCaps = `import { hqApiGate } from "@/lib/hq/api-gate";
const CAPABILITIES = ["not.a.capability", "also.not.one"];
export async function PATCH(){ await hqApiGate(CAPABILITIES); }`;
ok("G7-control", (g(fakeCaps).capabilities ?? []).length === 0,
  `CONTROL: an array of non-catalogue strings yields NO capabilities (got ${(g(fakeCaps).capabilities ?? []).join(", ") || "none"}) -- the matrix must not invent one`);

// ⚠ CALLING THE GATE IS NOT OBEYING IT. hqApiGate RETURNS a refusal instead of throwing, so a route that
// ignores the result is ungated while still containing the call. Found by a deliberate break that left the
// route reading as hq-position with its guard disabled.
const decorative = `import { hqApiGate } from "@/lib/hq/api-gate";
const CAPABILITIES = ["hq.learning.studio.view"];
export async function PATCH(){ const ctx = await hqApiGate(CAPABILITIES); return Response.json({ ok: true, a: ctx }); }`;
ok("G8", g(decorative).kind === "unknown",
  `a route that calls hqApiGate but never returns its refusal is NOT reported as gated (got ${g(decorative).kind})`);

const obeyed = `import { hqApiGate, isHqRefusal } from "@/lib/hq/api-gate";
const CAPABILITIES = ["hq.learning.studio.view"];
export async function PATCH(){ const ctx = await hqApiGate(CAPABILITIES); if (isHqRefusal(ctx)) return ctx; return Response.json({ ok: true }); }`;
ok("G8-control", g(obeyed).kind === "hq-position",
  `control: the SAME route that returns the refusal IS gated (got ${g(obeyed).kind}) -- G8 is the check, not a rule that rejects hqApiGate everywhere`);


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

// ⚠ THIS ASSERTION PINNED `role-list` AND A GENUINE SUCCESS TURNED IT RED -- the same shape as
// hq-guard-harness E4. Two of the six (/api/ai/governance, /api/knowledge-objects) have since been NARROWED
// to HQ capability gates, which is strictly better than the role list they had, and the old wording called
// that a failure. The property worth defending was never "these are role-lists"; it is "these are GATED",
// so that is what it says now.
const UNGATED = ["auth-only", "none"];
let n = 0;
const ungated: string[] = [];
const admitsNurse: string[] = [];
for (const [route, file] of SIX) {
  const gate = g(readFileSync(file, "utf8"));
  n++;
  if (UNGATED.includes(gate.kind)) ungated.push(`${route} -> ${gate.kind}`);
  // A nurse passes a role-list that names them; nobody passes an hq-position gate by holding an estate
  // role at all, so the two kinds are checked on their own terms rather than both on `roles`.
  if (gate.kind !== "hq-position" && (gate.roles ?? []).includes("nurse")) admitsNurse.push(route);
}
ok("S0-control", n === SIX.length, `count control: all ${n} files were read`);
ok("S1", ungated.length === 0,
  `each of the six is GATED -- none reads as auth-only or none${ungated.length ? ` -- ${ungated.join("; ")}` : ""}`);
ok("S2", admitsNurse.length === 0,
  `⚠ THE CLAIM THAT WAS WRONG: none of the six admits a nurse${admitsNurse.length ? ` -- ${admitsNurse.join(", ")}` : ""}`);

// ── 4. The HQ catalogue is not empty (vacuity floor) ───────────────────────────────────────────────
// ── 5. The narrowed API routes, on the SHIPPED files ───────────────────────────────────────────────
// ⚠ FIXTURES ARE NOT ENOUGH HERE. A deliberate break that disabled the real guard in
// /api/knowledge-objects left every fixture assertion green, because a fixture cannot notice a change to a
// different file. These read the routes that actually ship.
console.log("\n  -- 5. the narrowed API routes --");
const NARROWED = [
  ["/api/knowledge-objects", "src/app/api/knowledge-objects/route.ts"],
  ["/api/ai/governance", "src/app/api/ai/governance/route.ts"],
  ["/api/clinical-cases", "src/app/api/clinical-cases/route.ts"],
  ["/api/content/checklist-items", "src/app/api/content/checklist-items/route.ts"],
] as const;
const notGated = NARROWED.filter(([, f]) => g(readFileSync(f, "utf8")).kind !== "hq-position")
  .map(([r, f]) => `${r} -> ${g(readFileSync(f, "utf8")).kind}`);
ok("G10-control", NARROWED.length === 4, `count control: ${NARROWED.length} narrowed routes checked`);
ok("G10", notGated.length === 0,
  `every narrowed route is capability-gated AND obeys its gate${notGated.length ? ` -- ${notGated.join("; ")}` : ""}`);
const stillRoleGated = NARROWED.filter(([, f]) => (g(readFileSync(f, "utf8")).roles ?? []).length > 0);
ok("G11", stillRoleGated.length === 0,
  `and none of them still admits anybody by estate ROLE${stillRoleGated.length ? ` -- ${stillRoleGated.map(([r]) => r).join(", ")}` : ""}`);

ok("V1", HQ_CAPABILITY_CODES.length > 20 && ADMIN_ROLES.length > 0,
  `count control: ${HQ_CAPABILITY_CODES.length} HQ capabilities and ${ADMIN_ROLES.length} admin roles loaded -- the fixtures above resolve against real data`);

// ⚠ THE ONE BEHAVIOURAL ASSERTION, IN AN ASYNC TAIL because tsx compiles this to CJS and top-level await is
// a transform error. Everything above reasons about SOURCE; this calls the real function. The empty-list
// path is the only one hqApiGate can answer with no auth context, because it returns before resolving.
(async () => {
  const emptyRefusal = await hqApiGate([]);
  ok("G9", emptyRefusal instanceof NextResponse && emptyRefusal.status === 403,
    `hqApiGate([]) REFUSES (got ${emptyRefusal instanceof NextResponse ? emptyRefusal.status : "a context"}) -- "nobody said what this needs" is not "anybody may"`);

  console.log(`\n${failures.length ? "RED" : "ALL GREEN"}  ${pass} passed, ${failures.length} failed`);
  if (failures.length) { console.log("\nFAILURES:"); failures.forEach(f => console.log("  " + f)); }
  process.exit(failures.length ? 1 : 0);
})();
