/**
 * Every API route enters an approved authorization boundary, or is allowlisted with a reason.
 *
 * OWNER RULING, 2026-08-19. The estate architecture deliberately is service-role + application
 * authorization, not RLS-enforced RBAC. Given that, a route that never reaches the authorization
 * gateway is far more consequential than one that reaches it and then uses an older role abstraction
 * inside — so this ranks ABOVE the ADR-008 role migration. Target: 100% of routes requiring
 * authorization enter an approved boundary; anything intentionally public or system is explicitly
 * allowlisted, never merely counted as an exception.
 *
 * ⚠⚠ THE DRIFT CONTROL AT THE BOTTOM IS THE MOST IMPORTANT PART OF THIS FILE, AND IT EXISTS BECAUSE
 * THIS EXACT MISTAKE WAS MADE TWICE WHILE WRITING IT.
 *
 * A scanner with a hand-written list of guard helpers reports properly gated routes as unprotected the
 * moment a thirteenth helper is added. Measuring this for the first time, the list missed
 * `getLandlordCaller` and the platform-plane mutation routes (tenant provisioning, product toggles,
 * subscription changes) came back as "no auth check at all" — a critical-looking finding that was
 * entirely an artifact of the pattern. Corrected, the list then missed `hqApiGate` and four HQ write
 * routes came back the same way. Both were caught only by opening the files.
 *
 * This is the fourth-plus recurrence of that class in this repository (see the note on hq-scan.ts and
 * the tenant-plane blind spot). So this harness does not merely carry a list: it FAILS when a
 * guard-shaped helper is exported from src/lib and is not in BOUNDARIES. A new guard now breaks the
 * build until it is taught here, rather than silently turning protected routes into apparent holes.
 *
 * Run: npx tsx scripts/auth-boundary-harness.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const API = join(ROOT, "src", "app", "api");
const LIB = join(ROOT, "src", "lib");

/**
 * The approved boundaries. Each resolves a principal and applies the tenant/product boundary before a
 * handler touches data. Adding one is a security decision: say which plane it serves.
 */
const BOUNDARIES: Record<string, string> = {
  getCaller: "estate plane — loads the caller's roles + tenant (src/lib/api-auth.ts)",
  getLandlordCaller: "landlord/platform plane — paired with landlordCan",
  hqApiGate: "HQ plane — capability-gated API entry (src/lib/hq/api-gate.ts)",
  requireHqCapability: "HQ plane — named capability",
  requireHqContext: "HQ plane — governance context",
  requirePracticeContext: "Practice plane — membership, entitlement, capabilities",
  requireEnterpriseContext: "Enterprise plane",
  requireAnalyticsAccess: "analytics surface",
  requireEducatorAccess: "educator surface",
  resolveWorkspaceContext: "Practice — workspace resolution used directly",
  resolveHqContext: "HQ — context resolution used directly",
  resolveUnitContext: "unit manager — unit scope",
};

/** Names that LOOK like a guard. Anything matching and exported from lib must be classified above. */
const GUARD_SHAPED = /^(get[A-Z][A-Za-z]*Caller|require[A-Z][A-Za-z]*|resolve[A-Z][A-Za-z]*Context|[a-z][A-Za-z]*ApiGate)$/;

/** Guard-shaped exports that are deliberately NOT route boundaries, with why. */
const NOT_A_BOUNDARY: Record<string, string> = {
  requireRole: "a role assertion applied AFTER a boundary has run, not an entry point itself (ADR-008 compatibility adapter)",
  requireForSafety: "a clinical-safety precondition, not authorization",
  requireWritableStore: "an offline-store writability check on the device, not authorization",
  requireEdit: "a UI affordance check, not a request boundary",
  requireHqCapabilityOrNull: "a non-throwing variant used for rendering decisions, not entry",
};

type Cat = "guarded" | "public" | "system" | "inline" | "unclassified";

const allow = JSON.parse(readFileSync(join(ROOT, "security", "auth-boundary-allowlist.json"), "utf8")) as {
  public: { route: string; reason: string }[];
  system: { route: string; reason: string }[];
  inlineAuthBacklog: string[];
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(`${sep}route.ts`)) out.push(p);
  }
  return out;
}

const rel = (p: string) => p.slice(ROOT.length + 1).split(sep).join("/");
const boundaryRe = new RegExp(`\\b(${Object.keys(BOUNDARIES).join("|")})\\s*\\(`);

const routes = walk(API);
const publicSet = new Set(allow.public.map(p => p.route));
const systemSet = new Set(allow.system.map(p => p.route));
const backlogSet = new Set(allow.inlineAuthBacklog);

const counts: Record<Cat, number> = { guarded: 0, public: 0, system: 0, inline: 0, unclassified: 0 };
const unclassified: string[] = [];
const staleAllowlist: string[] = [];

for (const f of routes) {
  const r = rel(f);
  const src = readFileSync(f, "utf8");
  if (boundaryRe.test(src)) {
    counts.guarded++;
    // A route that now has a real boundary must LEAVE the backlog, or the burn-down never shows progress.
    if (backlogSet.has(r)) staleAllowlist.push(`${r} now enters a boundary — remove it from inlineAuthBacklog`);
    continue;
  }
  if (publicSet.has(r)) { counts.public++; continue; }
  if (systemSet.has(r)) { counts.system++; continue; }
  if (backlogSet.has(r)) { counts.inline++; continue; }
  counts.unclassified++;
  unclassified.push(r);
}

// Allowlist entries pointing at routes that no longer exist are rot, and rot hides real gaps.
for (const r of [...publicSet, ...systemSet, ...backlogSet]) {
  if (!routes.some(f => rel(f) === r)) staleAllowlist.push(`${r} is allowlisted but no longer exists`);
}

console.log("\n=== API authorization boundary ===\n");
console.log(`  routes:        ${routes.length}`);
console.log(`  guarded:       ${counts.guarded}`);
console.log(`  public (why):  ${counts.public}`);
console.log(`  system (why):  ${counts.system}`);
console.log(`  inline auth:   ${counts.inline}   <-- the backlog: authenticates, but not through the gateway`);
console.log(`  UNCLASSIFIED:  ${counts.unclassified}`);

let failed = 0;

if (unclassified.length) {
  failed++;
  console.log(`\n  FAIL  ${unclassified.length} route(s) enter no boundary and are in no list:`);
  unclassified.forEach(r => console.log(`          ${r}`));
  console.log("        Add a boundary, or allowlist it in security/auth-boundary-allowlist.json WITH A REASON.");
}

if (staleAllowlist.length) {
  failed++;
  console.log(`\n  FAIL  the allowlist has drifted from the tree:`);
  staleAllowlist.forEach(s => console.log(`          ${s}`));
}

// ── ⚠ THE DRIFT CONTROL ──────────────────────────────────────────────────────────────────────────
const exported = new Set<string>();
for (const f of walk(LIB).concat(walkTs(LIB))) {
  for (const m of readFileSync(f, "utf8").matchAll(/export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_$][\w$]*)/g)) {
    exported.add(m[1]);
  }
}
function walkTs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkTs(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}
const unknownGuards = [...exported].filter(n =>
  GUARD_SHAPED.test(n) && !(n in BOUNDARIES) && !(n in NOT_A_BOUNDARY));

if (unknownGuards.length) {
  failed++;
  console.log(`\n  FAIL  ${unknownGuards.length} guard-shaped helper(s) exported from src/lib are classified nowhere:`);
  unknownGuards.forEach(n => console.log(`          ${n}`));
  console.log("        Add each to BOUNDARIES (with the plane it serves) or to NOT_A_BOUNDARY (with why).");
  console.log("        ⚠ This check exists because an unknown helper makes GATED routes look OPEN --");
  console.log("        it happened twice while writing this file, and reported platform-plane writes as unauthenticated.");
} else {
  console.log(`\n  PASS  drift control: every guard-shaped export in src/lib is classified`);
}

// ── Ratchet ──────────────────────────────────────────────────────────────────────────────────────
const BACKLOG_CEILING = 91;
const ok = counts.inline <= BACKLOG_CEILING;
if (!ok) failed++;
console.log(`  ${ok ? "PASS" : "FAIL"}  inline-auth backlog: ${counts.inline} (ceiling ${BACKLOG_CEILING}, target 0)`);
if (counts.inline < BACKLOG_CEILING) {
  console.log(`        ${BACKLOG_CEILING - counts.inline} migrated — lower BACKLOG_CEILING to ${counts.inline} to hold the gain.`);
}

console.log(`\n${failed === 0 ? "ALL GREEN" : "RED"}  ${failed} check(s) failed\n`);
process.exit(failed === 0 ? 0 : 1);
