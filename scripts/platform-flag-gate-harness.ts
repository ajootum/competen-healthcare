/**
 * Platform feature-flag harness -- LCP-001 s9, migration 042.
 *
 * WHY THIS EXISTS. plat_feature_flags, plat_feature_flag_assignments, a precedence resolver and a
 * per-scope assignment UI have all existed since migration 042, and until now NOTHING in the application
 * ever asked the resolver a question. Five switches, zero readers, and a page that said they worked.
 *
 * WHAT IT PROVES:
 *   1. A FLAG HAS THREE STATES, not two: on, off, and unresolved -- and unresolved is not off.
 *   2. AN UNREADABLE FLAG CATALOGUE IS UNRESOLVED, and says so.
 *   3. ⚠ AN UNREADABLE ASSIGNMENT LIST IS UNRESOLVED TOO. This is the bug this change fixes: the
 *      assignments error used to be discarded, so a flag whose default is ON came back ON even when the
 *      rows that would have switched it OFF for this tenant could not be read.
 *   4. A KEY THAT IS NOT IN THE CATALOGUE IS UNRESOLVED, not "off" -- a typo and a decision are
 *      different facts.
 *   5. THE WHOLE PRECEDENCE CHAIN, one rung at a time: tenant > cohort > plan > country > global > default.
 *   6. A SCOPED ASSIGNMENT DOES NOT LEAK to another scope of the same type.
 *   7. flagEnabled() IS CLOSED ON DOUBT -- the boolean face never returns true for "unresolved".
 *   8. THE GATE RESOLVES END TO END: gateFor() builds the caller's tenant/plan/country context from live
 *      rows and an assignment against it actually decides.
 *   9. A CONTEXT THAT COULD NOT BE BUILT IS UNRESOLVED, not an empty context -- because an empty context
 *      silently removes the tenant rung and lets the global default answer instead.
 *  10. EVERY WIRED GATE NAMES A FLAG THAT EXISTS. A gate on an absent key is permanently unresolved.
 *  11. THIS HARNESS LEAVES NO ASSIGNMENT BEHIND on the one flag that gates a live surface.
 *
 *   npx --yes tsx scripts/platform-flag-gate-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { flagState, flagEnabled, gateFor, tenantFlagContext, WIRED_GATES } from "../src/lib/platform/feature-flags";
import { cleanupOnKill } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

/* eslint-disable @typescript-eslint/no-explicit-any */

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

/**
 * A client whose named tables genuinely cannot be read.
 *
 * NOT A STUB THAT RETURNS A FAKE ERROR. It points the query at a table that does not exist, so PostgREST
 * produces the real failure -- the same shape a dropped table, a revoked grant or an unapplied migration
 * produces in production. A hand-written `{error: {...}}` would prove only that the code reads a field.
 */
const brokenFor = (tables: string[]) => ({
  from(table: string) { return (admin as any).from(tables.includes(table) ? "table_that_does_not_exist_flag_harness" : table); },
}) as any;

/** The flag used for the precedence ladder: not wired to any surface, default off, so a leaked row is inert. */
const LADDER = "marketplace";
/** The flag that gates a live surface. Only ever assigned against a synthetic tenant here. */
const GATED = "executive_intelligence";
const SYNTHETIC_TENANT = "00000000-0000-4000-8000-00000000f1a6";

const created: string[] = [];

async function assign(flagKey: string, scopeType: string, scopeRef: string | null, enabled: boolean) {
  const { data, error } = await admin.from("plat_feature_flag_assignments")
    .insert({ flag_key: flagKey, scope_type: scopeType, scope_ref: scopeRef, enabled }).select("id").single();
  if (error || !data) throw new Error(`could not write assignment ${flagKey}/${scopeType}: ${error?.message}`);
  created.push(data.id as string);
  return data.id as string;
}
async function drop(id: string) {
  await admin.from("plat_feature_flag_assignments").delete().eq("id", id);
  const i = created.indexOf(id); if (i >= 0) created.splice(i, 1);
}
async function cleanup() {
  // Belt and braces: anything this run created, plus anything a previous crashed run left on the two
  // keys it touches at a scope only this harness uses.
  if (created.length) await admin.from("plat_feature_flag_assignments").delete().in("id", created);
  created.length = 0;
  await admin.from("plat_feature_flag_assignments").delete().eq("flag_key", LADDER);
  await admin.from("plat_feature_flag_assignments").delete().eq("flag_key", GATED).eq("scope_ref", SYNTHETIC_TENANT);
}

const FULL = { tenantId: "T-1", cohort: "C-1", planCode: "P-1", country: "K-1" };

async function main() {
  console.log("\nPlatform feature-flag harness (migration 042) -- three states, and a real gate\n");
  await cleanup();

  // ── 1. Three states, and "off" is a decision ───────────────────────────────
  const gatedDefault = await flagState(admin, GATED);
  ok("1. A FLAG WITH default_on=true AND NO ASSIGNMENT RESOLVES ON, and names the default as the decider",
    gatedDefault.state === "on" && gatedDefault.enabled === true && gatedDefault.decidedBy === "flag_default",
    JSON.stringify(gatedDefault));

  const ladderDefault = await flagState(admin, LADDER);
  ok("1b. AND default_on=false RESOLVES OFF -- 'off' is a decision, distinct from 'unresolved'",
    ladderDefault.state === "off" && ladderDefault.enabled === false && ladderDefault.decidedBy === "flag_default",
    JSON.stringify(ladderDefault));

  // ── 2. An unreadable catalogue ─────────────────────────────────────────────
  const noCatalogue = await flagState(brokenFor(["plat_feature_flags"]), GATED);
  ok("2. AN UNREADABLE FLAG CATALOGUE IS 'unresolved', NOT 'off' -- an outage is not a decision",
    noCatalogue.state === "unresolved" && noCatalogue.decidedBy === "unreadable" && noCatalogue.enabled === false,
    JSON.stringify(noCatalogue));
  ok("2b. and it says what failed, in a sentence an operator can act on",
    /could not be read/i.test(noCatalogue.reason) && noCatalogue.reason.length > 30, noCatalogue.reason);

  // ── 3. THE FIX: an unreadable assignment list must not fall through to the default ──
  const noAssigns = await flagState(brokenFor(["plat_feature_flag_assignments"]), GATED, { tenantId: SYNTHETIC_TENANT });
  ok("3. ⚠ AN UNREADABLE ASSIGNMENT LIST IS 'unresolved' -- the rows that would have overridden the default are exactly the ones missing",
    noAssigns.state === "unresolved" && noAssigns.decidedBy === "unreadable",
    JSON.stringify(noAssigns));
  ok("3b. AND SO IT IS WITHHELD, THOUGH THE FLAG'S OWN DEFAULT IS ON -- this is the regression that used to switch a disabled tenant back on",
    noAssigns.enabled === false && gatedDefault.enabled === true,
    `${noAssigns.enabled} / default ${gatedDefault.enabled}`);

  // ── 4. A key nobody seeded ─────────────────────────────────────────────────
  const missing = await flagState(admin, "communications.email.enabled");
  ok("4. A KEY THAT IS NOT IN THE CATALOGUE IS 'unresolved' AND NAMED AS SUCH -- a typo is not a decision",
    missing.state === "unresolved" && missing.decidedBy === "no_such_flag" && missing.enabled === false,
    JSON.stringify(missing));

  // ── 5. The precedence chain, one rung at a time ────────────────────────────
  const globalId = await assign(LADDER, "global", null, true);
  const atGlobal = await flagState(admin, LADDER, FULL);
  ok("5. GLOBAL BEATS THE FLAG DEFAULT",
    atGlobal.state === "on" && atGlobal.decidedBy === "global", JSON.stringify(atGlobal));

  const countryId = await assign(LADDER, "country", FULL.country, false);
  const atCountry = await flagState(admin, LADDER, FULL);
  ok("5b. COUNTRY BEATS GLOBAL",
    atCountry.state === "off" && atCountry.decidedBy === "country" && atCountry.scopeRef === FULL.country,
    JSON.stringify(atCountry));

  const planId = await assign(LADDER, "plan", FULL.planCode, true);
  const atPlan = await flagState(admin, LADDER, FULL);
  ok("5c. PLAN BEATS COUNTRY",
    atPlan.state === "on" && atPlan.decidedBy === "plan" && atPlan.scopeRef === FULL.planCode,
    JSON.stringify(atPlan));

  const cohortId = await assign(LADDER, "cohort", FULL.cohort, false);
  const atCohort = await flagState(admin, LADDER, FULL);
  ok("5d. COHORT BEATS PLAN",
    atCohort.state === "off" && atCohort.decidedBy === "cohort" && atCohort.scopeRef === FULL.cohort,
    JSON.stringify(atCohort));

  const tenantId = await assign(LADDER, "tenant", FULL.tenantId, true);
  const atTenant = await flagState(admin, LADDER, FULL);
  ok("5e. TENANT BEATS EVERYTHING -- the most specific rung wins",
    atTenant.state === "on" && atTenant.decidedBy === "tenant" && atTenant.scopeRef === FULL.tenantId,
    JSON.stringify(atTenant));

  // ── 6. A rung the caller does not supply cannot win, and does not leak ─────
  const otherTenant = await flagState(admin, LADDER, { ...FULL, tenantId: "T-2" });
  ok("6. A TENANT ASSIGNMENT DOES NOT APPLY TO A DIFFERENT TENANT -- it falls to the next rung",
    otherTenant.decidedBy === "cohort" && otherTenant.state === "off", JSON.stringify(otherTenant));
  const noContext = await flagState(admin, LADDER, {});
  ok("6b. AND A SCOPE THE CALLER NEVER SUPPLIED CANNOT DECIDE -- with no context only global can",
    noContext.decidedBy === "global" && noContext.state === "on", JSON.stringify(noContext));

  await drop(tenantId); await drop(cohortId); await drop(planId); await drop(countryId); await drop(globalId);
  const backToDefault = await flagState(admin, LADDER, FULL);
  ok("6c. CONTROL: with every assignment removed it falls back to the flag's own default",
    backToDefault.decidedBy === "flag_default" && backToDefault.state === "off", JSON.stringify(backToDefault));

  // ── 7. The boolean face is closed on doubt ─────────────────────────────────
  const boolOn = await flagEnabled(admin, GATED);
  const boolUnresolved = await flagEnabled(brokenFor(["plat_feature_flags"]), GATED);
  const boolMissing = await flagEnabled(admin, "communications.email.enabled");
  ok("7. flagEnabled() IS TRUE ONLY FOR 'on' -- both other states are closed",
    boolOn === true && boolUnresolved === false && boolMissing === false,
    `${boolOn}/${boolUnresolved}/${boolMissing}`);

  // ── 8. The gate, end to end, against live rows ─────────────────────────────
  const { data: someone } = await admin.from("profiles").select("id, tenant_id").not("tenant_id", "is", null).limit(1);
  const person = ((someone ?? []) as any[])[0];
  ok("a live profile with a tenant exists to gate against", !!person, JSON.stringify(someone));
  if (person) {
    const ctx = await tenantFlagContext(admin, person.id);
    ok("8. THE GATE BUILDS ITS SCOPE FROM LIVE ROWS -- tenant, country and plan, not an empty context",
      ctx.ok && ctx.ctx.tenantId === person.tenant_id && !!ctx.ctx.country && !!ctx.ctx.planCode,
      JSON.stringify(ctx));

    const beforeGate = await gateFor(admin, GATED, person.id);
    ok("8b. and with no assignment the gate is ON, so wiring it changed nothing for anyone",
      beforeGate.state === "on" && beforeGate.decidedBy === "flag_default", JSON.stringify(beforeGate));

    const realTenantOff = await assign(GATED, "tenant", person.tenant_id, false);
    const afterGate = await gateFor(admin, GATED, person.id);
    await drop(realTenantOff);
    ok("8c. ⚠ AN ASSIGNMENT ACTUALLY DECIDES THE LIVE GATE -- switching this tenant off switches the module off",
      afterGate.state === "off" && afterGate.decidedBy === "tenant" && afterGate.scopeRef === person.tenant_id,
      JSON.stringify(afterGate));

    const restored = await gateFor(admin, GATED, person.id);
    ok("8d. CONTROL: and removing the assignment switches it back on",
      restored.state === "on" && restored.decidedBy === "flag_default", JSON.stringify(restored));

    // ── 9. A context that could not be built ────────────────────────────────
    const noProfile = await gateFor(brokenFor(["profiles"]), GATED, person.id);
    ok("9. A CALLER WHOSE TENANT CANNOT BE READ IS 'unresolved', NOT AN EMPTY CONTEXT -- an empty one would let the global default answer for a tenant that was switched off",
      noProfile.state === "unresolved" && noProfile.enabled === false && /could not be evaluated for this user/i.test(noProfile.reason),
      JSON.stringify(noProfile));
    const noTenantRow = await gateFor(brokenFor(["tenants"]), GATED, person.id);
    ok("9b. and so is one whose tenant record cannot be read",
      noTenantRow.state === "unresolved" && noTenantRow.enabled === false, JSON.stringify(noTenantRow));
  }

  // ── 10. Every wired gate names a flag that exists ──────────────────────────
  const { data: catalogue } = await admin.from("plat_feature_flags").select("key");
  const keys = new Set(((catalogue ?? []) as any[]).map(f => f.key));
  const wired = Object.keys(WIRED_GATES);
  ok("10. EVERY WIRED GATE NAMES A KEY THAT EXISTS -- a gate on an absent key is permanently unresolved",
    wired.length > 0 && wired.every(k => keys.has(k)), `${wired.join(",")} vs ${[...keys].join(",")}`);
  ok("10b. and the one gate this change wired is the Executive Intelligence module",
    WIRED_GATES[GATED]?.includes("/hospital-executive/intelligence") === true, WIRED_GATES[GATED]);

  // ── 11. Nothing left behind ───────────────────────────────────────────────
  await cleanup();
  const { data: leftovers, error: leftErr } = await admin.from("plat_feature_flag_assignments")
    .select("id, flag_key, scope_type, scope_ref").eq("flag_key", GATED);
  ok("11. THIS HARNESS LEAVES NO ASSIGNMENT ON THE FLAG THAT GATES A LIVE SURFACE",
    !leftErr && ((leftovers ?? []) as any[]).length === 0, leftErr?.message ?? JSON.stringify(leftovers));

  report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

// ⚠ TEARDOWN ON A KILL, NOT ONLY ON A THROW. The catch below covers a run that FAILS; it does not
// cover one that is KILLED, which in this environment is the ordinary case -- a command timeout, an
// agent watchdog, a stopped task. Six abandoned Practice workspaces accumulated that way and the
// landlord Mission Control counted every one of them as a real practice. Best effort: SIGKILL cannot
// be caught, and scripts/estate-hygiene-harness.ts is the backstop for what still gets through.
cleanupOnKill(cleanup);
main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
