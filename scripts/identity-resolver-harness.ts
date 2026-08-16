/**
 * COMP-IDENTITY-001 Phase 3 item 13 — the read-side identity resolver, proved BEFORE any repoint.
 *
 * COMP-SECURITY-SURVEY-001 s6.2 names the six role columns as the biggest lockout risk in the survey
 * and sets the discipline: read-side unification only, prove equivalence for ALL live profiles, then
 * repoint call sites one at a time. This harness IS that proof, and it runs against the live table
 * because the population it must hold for is the live one — a fixture-only proof would be the
 * "fixture that cannot produce the failure" shape all over again.
 *
 * WHAT IT PROVES:
 *   1. ⚠ THE HEADLINE: for EVERY live profile, estateRolesOf answers exactly what the inline
 *      expression `(p.roles?.length ? p.roles : [p.role]).filter(Boolean)` answers — element for
 *      element, order included. Zero divergence is asserted, because a repoint under any divergence
 *      changes somebody's identity at a gate.
 *   2. resolveIdentity's folds equal the pure folds over the same row, for every live profile —
 *      the resolver adds a read, never an opinion.
 *   3. The fold semantics themselves, on fixtures that CAN fail: roles=[] falls back to [role]
 *      (the length check the drifted variant dropped), roles beats role when both exist, nulls
 *      vanish, absent profile answers empty.
 *   4. A failed read is REPORTED as unreadable, never as an empty identity.
 *
 * WHAT IT MEASURES AND REPORTS WITHOUT PINNING (counts that drift as profiles change are reported,
 * never asserted — the never-pin-a-count lesson):
 *   - profiles whose platform/org columns carry out-of-vocabulary values (the validated folds drop
 *     these BY LONG-STANDING DESIGN; the estate fold must never start doing so);
 *   - divergence of the drifted variant `p.roles ?? [p.role]` (super-admin/users/page.tsx:103)
 *     against the canonical fold — the live evidence for WHY this consolidation exists.
 *
 *   npx --yes tsx scripts/identity-resolver-harness.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { readFileSync, readdirSync } from "node:fs";
import { estateRolesOf, orgRolesOf, platformRolesOf, ORG_ROLES, PLATFORM_ROLES } from "../src/lib/roles";
import { resolveIdentity } from "../src/lib/identity";

loadEnvConfig(process.cwd());

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

type Row = {
  id: string; role: string | null; roles: string[] | null;
  org_role: string | null; org_roles: string[] | null;
  platform_role: string | null; platform_roles: string[] | null;
};

/** ⚠ THE INLINE EXPRESSION, VERBATIM. This is the yardstick, spelled exactly as the ~350 sites
 * spell it. If this line and the sites ever disagree, the harness is proving the wrong thing —
 * which is why assertion 5 greps a real site for the expression this reproduces. */
const inlineFold = (p: { role?: string | null; roles?: string[] | null }): string[] =>
  ((p.roles?.length ? p.roles : [p.role]) as (string | null | undefined)[]).filter(Boolean) as string[];

/** The DRIFTED variant found at super-admin/users/page.tsx:103 — measured, not emulated anywhere. */
const driftedFold = (p: { role?: string | null; roles?: string[] | null }): string[] =>
  ((p.roles ?? [p.role]) as (string | null | undefined)[]).filter(Boolean) as string[];

const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

async function main() {
  console.log("\n=== IDENTITY RESOLVER: EQUIVALENCE OVER EVERY LIVE PROFILE (s6.2) ===\n");

  // ── 1. THE HEADLINE ────────────────────────────────────────────────────────────────────────────
  const { data, error } = await admin.from("profiles")
    .select("id, role, roles, org_role, org_roles, platform_role, platform_roles");
  ok("0-control. the live profiles table was actually read, and it is not empty",
    !error && (data ?? []).length > 0, error?.message ?? `${(data ?? []).length} rows`);
  const rows = (data ?? []) as Row[];

  const estateDivergent = rows.filter(r => !same(estateRolesOf(r), inlineFold(r)));
  ok(`1. ⚠⚠ estateRolesOf equals the inline fold for ALL ${rows.length} live profiles — zero divergence`,
    estateDivergent.length === 0,
    estateDivergent.slice(0, 3).map(r => r.id).join(", "));

  // ── 2. THE RESOLVER ADDS A READ, NEVER AN OPINION ──────────────────────────────────────────────
  let resolverDivergence = 0;
  for (const r of rows) {
    const ident = await resolveIdentity(admin, r.id);
    if (!ident.readable || !ident.exists
      || !same(ident.estateRoles, estateRolesOf(r))
      || !same(ident.platformRoles as string[], platformRolesOf(r) as string[])
      || JSON.stringify(ident.orgRoles) !== JSON.stringify(orgRolesOf(r))) resolverDivergence++;
  }
  ok(`2. resolveIdentity answers the pure folds' answers for ALL ${rows.length} live profiles`,
    resolverDivergence === 0, `${resolverDivergence} divergent`);

  // ── 3. THE FOLD SEMANTICS, ON FIXTURES THAT CAN FAIL ───────────────────────────────────────────
  ok("3a. ⚠ roles=[] falls back to [role] — the length check the drifted variant dropped",
    same(estateRolesOf({ role: "nurse", roles: [] }), ["nurse"]));
  ok("3b. a populated roles array wins over role",
    same(estateRolesOf({ role: "nurse", roles: ["educator", "assessor"] }), ["educator", "assessor"]));
  ok("3c. nulls vanish and nothing is invented",
    same(estateRolesOf({ role: null, roles: null }), []) && same(estateRolesOf(null), []));
  ok("3d. ⚠ an out-of-vocabulary estate role SURVIVES the fold — validation would be a behaviour change",
    same(estateRolesOf({ role: "practice_only_stray", roles: null }), ["practice_only_stray"]));
  ok("3e-control. the fixtures can fail: the drifted variant answers 3a differently",
    !same(driftedFold({ role: "nurse", roles: [] }), ["nurse"]),
    "if these agreed, 3a would prove nothing");

  // ── 4. A FAILED READ IS NOT AN EMPTY IDENTITY ──────────────────────────────────────────────────
  const broken = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: "connection refused" } }) }) }) }) };
  const unreadable = await resolveIdentity(broken, "00000000-0000-4000-8000-000000000001");
  ok("4. ⚠ a failed profile read reports readable:false — never a person with no roles",
    unreadable.readable === false && unreadable.estateRoles.length === 0);
  const missing = await resolveIdentity(admin, "00000000-0000-4000-8000-0000000000ff");
  ok("4b. a missing profile is readable:true, exists:false — a real fact, distinct from a failure",
    missing.readable === true && missing.exists === false);

  // ── 5. THE YARDSTICK MATCHES THE TERRITORY -- INVERTED AFTER THE BULK REPOINT ──────────────────
  //
  // ⚠ This assertion HAS A HISTORY. Before the repoint it pinned that api-auth.ts SPELLED the inline
  // fold, so the yardstick could not drift from the territory. The owner then ordered the bulk
  // repoint (352 substitutions, 336 files, four shapes, zero near-misses), so the territory moved:
  // the historical spelling now lives ONLY in estateRolesOf's own body, and the pin inverts --
  // any NEW inline spelling anywhere in src/ is drift by definition, reintroducing exactly the
  // per-site variance that produced a management screen disagreeing with the gates about 35 of 47
  // people. inlineFold above stays as the HISTORICAL yardstick: assertions 1-2 still prove the
  // consolidated fold answers what the historical expression answered, for every live profile.
  const foldCore = ".roles?.length ?";
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (e.name !== "node_modules") out.push(...walk(`${dir}/${e.name}`)); }
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(`${dir}/${e.name}`);
    }
    return out;
  };
  const spellers = walk("src").filter(f => readFileSync(f, "utf8").includes(foldCore));
  ok("5. ⚠ the inline fold is spelled NOWHERE in src/ except the fold's own body",
    spellers.length === 1 && spellers[0] === "src/lib/roles.ts",
    spellers.filter(f => f !== "src/lib/roles.ts").slice(0, 5).join(", ") || "roles.ts itself no longer spells it");
  ok("5-control. and roles.ts DOES still spell it, so 5 is not scanning for a typo",
    readFileSync("src/lib/roles.ts", "utf8").includes("p.roles?.length ? p.roles : [p.role]"));

  // ── MEASUREMENTS, REPORTED NEVER PINNED ────────────────────────────────────────────────────────
  const strayPlatform = rows.filter(r =>
    ((r.platform_roles?.length ? r.platform_roles : [r.platform_role]) as (string | null)[])
      .filter(Boolean).some(v => !(PLATFORM_ROLES as string[]).includes(v as string))).length;
  const strayOrg = rows.filter(r =>
    ((r.org_roles?.length ? r.org_roles : [r.org_role]) as (string | null)[])
      .filter(Boolean).some(v => !(ORG_ROLES as string[]).includes(v as string))).length;
  const drifted = rows.filter(r => !same(driftedFold(r), inlineFold(r))).length;
  // The two families the bulk repoint absorbed: the fallback-only filter (filter bound to the
  // fallback array, non-empty roles passing unfiltered) and the raw parenthesized fold (no filter,
  // consumers filtering or guarding themselves). Each diverges from canonical only when a roles
  // array carries a falsy entry -- measured here so the repoint's behaviour delta is a number.
  const fallbackOnly = (p: Row): string[] =>
    (p.roles?.length ? p.roles : ([p.role] as (string | null)[]).filter(Boolean)) as string[];
  const rawFold = (p: Row): (string | null)[] => (p.roles?.length ? p.roles : [p.role]);
  const fallbackDiverges = rows.filter(r => !same(fallbackOnly(r), inlineFold(r))).length;
  const rawDiverges = rows.filter(r => !same(rawFold(r).filter(Boolean) as string[], inlineFold(r))
    || rawFold(r).length !== inlineFold(r).length).length;
  console.log(`\n  measured (informational, counts drift as profiles change):`);
  console.log(`    profiles with out-of-vocab platform values (validated fold drops them): ${strayPlatform}`);
  console.log(`    profiles with out-of-vocab org values (validated fold drops them): ${strayOrg}`);
  console.log(`    profiles where the fixed users-page fold ('roles ?? [role]') diverged: ${drifted}`);
  console.log(`    profiles where the fallback-only-filter family diverges from canonical: ${fallbackDiverges}`);
  console.log(`    profiles where the raw (unfiltered) fold diverges from canonical: ${rawDiverges}`);

  console.log(`\n${failures.length ? "FAILED" : "PASSED"}  ${pass} passed, ${failures.length} failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  if (failures.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
