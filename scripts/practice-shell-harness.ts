/**
 * CPR-SHELL-001 -- Authenticated Practice Application Shell and Route Guard.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS, AND WHY IT IS OVERDUE.
 *
 * `practice_public_signup`'s own note in practice_platform_flags reads:
 *
 *     "Off until IAM+PROV+SHELL integrated tests pass."
 *
 * IAM has practice-signup-harness. PROV has practice-provisioning-harness. SHELL had NOTHING --
 * CPR-SHELL-001 was cited in docs/CPR-BUILD-000 and by several modules, and the specification itself
 * sits in the owner's spec folder, but no test in this repository referenced it. So one third of the
 * stated precondition for opening public signup was not merely unmet: it was UNMEASURABLE, and a
 * condition nothing can check cannot honestly be declared satisfied.
 *
 * ⚠ THIS IS A SOURCE-LEVEL HARNESS BY DESIGN. The shell's behaviour is a server-side redirect
 * sequence behind a real session; asserting it end to end means driving a signed-in browser, which is
 * the owner's pass to make (the same boundary practice-responsive draws). What is checkable here is
 * the STRUCTURE the specification fixes: which routes exist, that guards run server-side and in the
 * mandated order, that denials are safe, and what the workspace context actually carries.
 *
 * ⚠ AND WHERE THE BUILD DOES NOT MEET THE SPEC, THIS FILE SAYS SO RATHER THAN SKIPPING IT. s9's
 * context contract names thirteen fields; six are absent. Those are asserted as a DELIBERATE, RECORDED
 * absence -- the same shape the billing harness used for the Settlements tab -- so the gap is visible,
 * its consequence is written down, and the day somebody adds one the harness asks for this note to be
 * updated instead of quietly going green.
 *
 *   npx tsx scripts/practice-shell-harness.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PRACTICE = join(ROOT, "src", "app", "practice");
const SHELL_TS = join(ROOT, "src", "lib", "practice", "shell.ts");
const ACCESS_TS = join(ROOT, "src", "lib", "practice", "access.ts");

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

/** Comments stripped so a rule cannot be satisfied by prose describing it. */
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/).map(l => (/^\s*(\/\/|\*)/.test(l) ? "" : l)).join("\n");

console.log("\nPractice shell harness (CPR-SHELL-001)\n");

const shellSrc = readFileSync(SHELL_TS, "utf8");
const accessSrc = readFileSync(ACCESS_TS, "utf8");

// ── 4. CANONICAL AUTHENTICATED ROUTES ──────────────────────────────────────────────────────────
// s4 fixes the route namespace at /practice/*, which CPR-BUILD-000 s1 records as a decision taken
// against /my-practice. A missing route here is not cosmetic: s8's default-landing table and s12's
// deep-link table both name these paths as destinations.
const ROUTES = [
  "home", "calendar", "patients", "encounters", "follow-ups",
  "reports", "intelligence", "settings", "onboarding", "access-status", "select-workspace",
];
const missing = ROUTES.filter(r =>
  !existsSync(join(PRACTICE, "(shell)", r)) && !existsSync(join(PRACTICE, r)));
ok("4a every canonical authenticated route in s4 exists under /practice", missing.length === 0, missing.join(", "));

const DYNAMIC: [string, string][] = [
  ["patients/[patientId]", "patient workspace"],
  ["encounters/[encounterId]", "clinical encounter workspace"],
];
const missingDynamic = DYNAMIC.filter(([p]) => !existsSync(join(PRACTICE, "(shell)", p))).map(([p]) => p);
ok("4b and the two OBJECT-guarded routes exist, which s6 gives their own guard class",
  missingDynamic.length === 0, missingDynamic.join(", "));

// ── 6.1 GUARD EVALUATION ORDER ─────────────────────────────────────────────────────────────────
// ⚠ ORDER, NOT PRESENCE. s6.1: "Route guards must execute in this order to avoid information leakage
// and unnecessary service calls." A shell that ran every guard but resolved membership before
// authentication would leak whether a workspace exists to an unauthenticated caller. Presence is
// therefore the weaker half of this assertion; the positions are the real one.
const guardOrder = ["Guard 1: authentication", "Guards 2-3: workspace resolution and membership",
  "Guards 4-5: workspace status and entitlement", "Guard 6: onboarding completion"];
const positions = guardOrder.map(g => shellSrc.indexOf(g));
ok("6.1a the shell names all four centralised guard stages", positions.every(p => p >= 0),
  guardOrder.filter((_, i) => positions[i] < 0).join(" | "));
ok("6.1b and they appear in the order s6.1 mandates: auth, membership, status+entitlement, onboarding",
  positions.every((p, i) => i === 0 || (p > positions[i - 1] && p >= 0)),
  positions.join(" -> "));

// s6.1 steps 7-10 (capability, feature flag, object, workflow) are deliberately NOT centralised: they
// are per-route because only the route knows which capability and which object it needs. That is a
// real architectural fact, so it is pinned rather than left implicit.
// ⚠ It is `export const hasCapability = (...) =>`, an arrow, not `export function`. A first draft of
// this assertion looked for the declaration keyword and went red against correct code -- the same
// mistake as pinning a helper's name instead of its behaviour. Match the export, not the syntax.
ok("6.1c capability is enforced per-route through hasCapability, not inside the shell resolver",
  !/hasCapability/.test(strip(shellSrc)) && /export (const|function) hasCapability\b/.test(accessSrc));

// ── 15. GUARDS ARE SERVER-SIDE ─────────────────────────────────────────────────────────────────
// s15: "Route protection must exist on the server/API, not only in the client." A shell resolver that
// was a client component would make every guard above advisory.
ok("15a the shell resolver is server-side -- it reads cookies and never declares 'use client'",
  !/^["']use client["']/m.test(shellSrc) && /createServerClient|cookies\(\)|@\/lib\/supabase\/server/.test(shellSrc));
ok("15b and the context type is not reconstructible from browser storage: it is resolved, not parsed",
  !/localStorage|sessionStorage/.test(strip(accessSrc)));

// ── 9. WORKSPACE-CONTEXT CONTRACT ──────────────────────────────────────────────────────────────
const CONTEXT_PRESENT = [
  "userId", "workspaceId", "workspaceName", "workspaceType", "workspaceStatus",
  "workspaceTimezone", "roleCodes", "capabilities", "entitled", "entitlementStatus",
  "onboardingComplete", "onboardingStep",
];
const typeBlock = accessSrc.slice(accessSrc.indexOf("export type WorkspaceContext"));
const typeEnd = typeBlock.indexOf("\n};");
const contextType = typeBlock.slice(0, typeEnd);
const absentFromType = CONTEXT_PRESENT.filter(f => !new RegExp(`\\b${f}\\s*[?]?:`).test(contextType));
ok("9a the workspace context carries every field the build relies on", absentFromType.length === 0,
  absentFromType.join(", "));

// ⚠⚠ THE RECORDED GAP. s9 names THIRTEEN context fields. Six are absent, and three of them are the
// input to a guard s6 requires:
//
//   membershipId    -- "Effective membership". The membership row id IS selected by the join in
//                      resolvePracticeAccess; it simply is not carried onto the context.
//   assuranceLevel  -- "Authentication/MFA strength". s6's AssuranceGuard cannot be expressed in
//                      context without it, so step-up state is not a fact the shell can hold.
//   featureFlags    -- "Deployment and cohort features". s6's FeatureFlagGuard likewise; today each
//                      surface asks its own gate (offline-gate.ts) rather than reading the context.
//   correlationId   -- "Current request/route trace". s6.2 requires a correlation id be RETURNED on a
//                      denial for support; engines take one as an argument instead.
//   contextVersion  -- "Detect stale or changed membership context". Without it s9.1's rule that
//                      "background tabs receiving an invalidation event must re-authorise before
//                      further writes" has nothing to compare, so a revoked membership in an open tab
//                      is not detectable from the context alone.
//   locale          -- rendering context; workspaceTimezone is carried, locale is not.
//
// These are asserted ABSENT deliberately. If one is added this assertion goes red, which is the point:
// the note above must be updated in the same change, so the gap list never quietly drifts.
const SPEC_ABSENT = ["membershipId", "assuranceLevel", "featureFlags", "correlationId", "contextVersion", "locale"];
const nowPresent = SPEC_ABSENT.filter(f => new RegExp(`\\b${f}\\s*[?]?:`).test(contextType));
ok("9b the six s9 context fields this build does not carry are still absent, and still recorded above",
  nowPresent.length === 0,
  nowPresent.length ? `now present (update the note): ${nowPresent.join(", ")}` : "");
ok("9b-control the check can see a field that IS present, so it cannot pass by matching nothing",
  new RegExp("\\bcapabilities\\s*[?]?:").test(contextType));

// ── 12. DEEP LINKS AND RETURN-TO ───────────────────────────────────────────────────────────────
// s12: an unauthenticated protected deep link redirects to sign-in "and preserve[s] allow-listed
// route". An unvalidated return_to is an open redirect, which is why this is allow-listed rather
// than merely escaped.
const signInSrc = readFileSync(join(PRACTICE, "sign-in", "SignInForm.tsx"), "utf8");
ok("12a return_to is validated to a relative /practice path rather than taken as given",
  /return_to/.test(signInSrc) && /startsWith\(\s*["']\/practice/.test(strip(signInSrc)));

console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
console.log(
  "\n⚠ Source-level. s5's bootstrap sequence, s11's switching safeguards and s13's degraded states are\n"
  + "  claims about a running shell behind a real session, and remain the owner's pass to make.\n");
