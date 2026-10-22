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
import { EXPERIENCE_KEYS, FOUNDATION_NAV } from "../src/lib/individual/experiences";

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
  ok("1d. no Individual file writes profiles (profiles.role stays untouched, ADR-001)",
    offenders(/from\("profiles"\)\s*\.(insert|update|upsert|delete)\(/).length === 0,
    offenders(/from\("profiles"\)\s*\.(insert|update|upsert|delete)\(/).join(", "));

  // ── 2. WHAT INDIVIDUAL MAY WRITE ────────────────────────────────────────────────────────────────
  // Every write site names its table on the same chain. Two tables are allowed: the caller's own
  // membership row (preferences) and audit_log.
  const writes: string[] = [];
  for (const [f, src] of SRC) {
    for (const m of src.matchAll(/from\("([a-z_]+)"\)\s*\.(insert|update|upsert|delete)\(/g)) writes.push(`${f}: ${m[1]}.${m[2]}`);
  }
  const badWrites = writes.filter(w => !/: (individual_membership\.update|audit_log\.insert)$/.test(w));
  ok("2a. Individual writes only its own membership row and audit_log", badWrites.length === 0, badWrites.join("; "));
  ok("2b. ⚠ control: the two expected writes are actually seen", writes.some(w => w.endsWith("individual_membership.update")) && writes.some(w => w.endsWith("audit_log.insert")));

  // ── 3. PROVISIONAL RULING D1 -- NO INDIVIDUAL DATA IN TABLES HOSPITAL ANALYTICS READ ──────────
  const ESTATE_LEARNING = /from\("(quiz_attempts|knowledge_attempts|cpd_logs|course_enrollments|learning_enrolments|cdp_reinforcement_cards|skill_log_entries)"\)/;
  ok("3a. no Individual file touches the estate learning tables (learning-analytics.ts reads them by hospital)",
    offenders(ESTATE_LEARNING).length === 0, offenders(ESTATE_LEARNING).join(", "));

  // ── 4. LIVENESS IS THE DATABASE'S CLOCK ─────────────────────────────────────────────────────────
  const access = SRC.get("src/lib/individual/access.ts") ?? "";
  ok("4a. access reads liveness from individual_live_entitlement", /from\("individual_live_entitlement"\)/.test(access));
  ok("4b. access never reads the raw ledger or compares a period with the app clock",
    !/from\("individual_entitlement"\)/.test(access) && !/starts_at|ends_at/.test(access) && !/Date\.now\(\)|new Date\(/.test(access));
  const ledgerReaders = offenders(/from\("individual_entitlement"\)/);
  ok("4c. only the history view reads the raw ledger (all periods, for display)",
    ledgerReaders.length === 1 && ledgerReaders[0] === "src/lib/individual/history.ts", ledgerReaders.join(", "));

  // ── 5. EVERY INDIVIDUAL API ROUTE IS GUARDED BY GATE 3 ──────────────────────────────────────────
  const routes = FILES.filter(f => f.startsWith("src/app/api/individual/") && f.endsWith("route.ts"));
  const unguarded = routes.filter(f => {
    const s = SRC.get(f) ?? "";
    const handlers = [...s.matchAll(/export async function (POST|PUT|PATCH|DELETE)\b/g)].length;
    return handlers > 0 && [...s.matchAll(/requireIndividualContext\(/g)].length < handlers;
  });
  ok("5a. every mutating Individual API handler calls requireIndividualContext", routes.length >= 2 && unguarded.length === 0, unguarded.join(", "));

  // ── 6. SIGNUP STAYS CLOSED ──────────────────────────────────────────────────────────────────────
  ok("6a. no Individual surface links to /signup or creates an auth user",
    offenders(/["'`]\/signup|auth\.signUp\(|auth\.admin\.createUser\(/).length === 0,
    offenders(/["'`]\/signup|auth\.signUp\(|auth\.admin\.createUser\(/).join(", "));
  const door = ACCESS_DOORS.find(d => d.code === "INDIVIDUAL");
  ok("6b. the public Individual door is still being_built -- the pilot enters through /login", door?.status === "being_built");
  ok("6c. no Individual API route exists that could provision membership or entitlement",
    !FILES.some(f => f.startsWith("src/app/api/individual/") && /from\("individual_(membership|entitlement)"\)\s*\.(insert|upsert)\(/.test(SRC.get(f) ?? "")));

  // ── 7. NAVIGATION LISTS ONLY WHAT EXISTS ────────────────────────────────────────────────────────
  const missing = FOUNDATION_NAV.filter(n => !existsSync(n.segment
    ? `src/app/individual/(app)/[experience]/${n.segment}/page.tsx`
    : "src/app/individual/(app)/[experience]/page.tsx"));
  ok("7a. every navigation entry has a real page behind it", missing.length === 0, missing.map(n => n.segment || "home").join(", "));
  ok("7b. the experience route accepts exactly the registry's experiences",
    /isExperienceKey\(experience\)/.test(SRC.get("src/app/individual/(app)/[experience]/layout.tsx") ?? "") && EXPERIENCE_KEYS.length === 2);

  // ── 8. THE NEUTRAL RESOLVER OFFERS INDIVIDUAL FROM ITS GATE, AND ONLY FROM ITS GATE ─────────────
  const pr = strip(readFileSync("src/lib/identity/product-resolution.ts", "utf8"));
  ok("8a. product-resolution reads individual_membership and offers /individual/home",
    /from\("individual_membership"\)/.test(pr) && /href: "\/individual\/home"/.test(pr));
  ok("8b. and a missing table is the ONLY Individual read failure it forgives",
    /isNotProvisioned\(individualRead\.error\)/.test(pr) && /individualRead\.error && !individualAbsent/.test(pr));

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"} -- ${pass} passed, ${failures.length} failed`);
  if (failures.length) { failures.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main();
