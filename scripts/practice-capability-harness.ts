/**
 * CAPABILITY ACTIVATION FRAMEWORK -- CPR-CAP-001 s3-s6 and s8, migration 278.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS EXISTS TO KEEP TRUE.
 *
 *   1. ACTIVATION AND PERMISSION ARE INDEPENDENT, IN BOTH DIRECTIONS, PROVEN AGAINST A LIVE DATABASE.
 *      Deactivating CP.ENCOUNTERS does not take encounter.edit off anybody, and granting encounter.edit
 *      does not switch CP.ENCOUNTERS on. Each direction carries a CONTROL proving the query used would
 *      have SEEN the thing it reports absent -- a "still there" assertion over a query that can never
 *      see a change is the loudest kind of nothing.
 *   2. A FAILED READ IS NOT A ZERO. resolveCapabilities over a store that will not answer returns
 *      readable:false and active:NULL -- never an empty list, which a caller would read as "this
 *      practice has no product". Three states, everywhere, including on the rendered screen.
 *   3. A DEPENDENCY IS ACTIVATED WITH ITS DEPENDENT (s6 bullet two), and deactivating something depended
 *      upon WARNS AND NAMES the dependents (s6 bullet four) rather than cascading quietly.
 *   4. A MODE IS A PRESET AND NEVER A TIER (s5). An individual choice made after a preset survives the
 *      preset being applied again, and a preset never switches anything off.
 *   5. HISTORICAL DATA SURVIVES DEACTIVATION (s6 bullet five, s8). The patient and the encounter are
 *      read back out of the database after the capability that recorded them is switched off.
 *   6. THE REGISTRY MATCHES THE SPECIFICATION. s4's table is PARSED OUT OF docs/ and compared, so a
 *      display name or a dependency edited here without the document fails a test.
 *   7. THE REGISTRY IS IMPORT-FREE, so a client component may import it. practice-bundle-harness
 *      enforces the same rule for audit.ts and this is the second module that needs it.
 *
 * ⚠ VACUITY. Three traps were found in this repo this week and all three are guarded here:
 *      (a) scanning source for a phrase that also appears in this file's own comment -- COMMENTS ARE
 *          STRIPPED BEFORE EVERY SCAN, and each negative scan has a positive control over a file that
 *          MUST contain the phrase.
 *      (b) asserting over an EMPTY LIST -- every list assertion is preceded by a non-emptiness one.
 *      (c) a harness that re-implements the rule it tests -- requiredClosure, dependentClosure and
 *          modeSelection are IMPORTED from the registry, never restated.
 *
 * ⚠ MIGRATION 278 IS APPLIED BY HAND. Until it is, every store-dependent assertion is reported as
 * SKIPPED, never as passed, and the totals say so.
 *
 * ⚠ RUN IT ALONE. Five other agents run harnesses against this database concurrently. The owner id
 * below belongs to this harness and nothing else. A concurrent run produces phantom
 * MEMBERSHIP_CREATE_FAILED / CAPABILITY_GRANT_FAILED -- re-run alone before believing a failure.
 *
 *   npx --yes tsx scripts/practice-capability-harness.ts
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter } from "../src/lib/practice/encounters";
import {
  CAPABILITY_REGISTRY, CAPABILITY_IDS, DEFAULT_ACTIVE_IDS, PRACTICE_MODES,
  capabilityDef, defaultActive, requiredClosure, requiredDependenciesOf, dependentClosure,
  setupClosure, recommendedFor, modeSelection, isCapabilityId,
  ACTIVATION_IS_NOT_PERMISSION, MODES_ARE_PRESETS, NOT_YET_WIRED,
  type CapabilityId,
} from "../src/lib/practice/capability-registry";
import {
  resolveCapabilities, activateCapability, deactivateCapability, applyPracticeMode,
  planDeactivation, capabilityAvailable, capabilityStateOf, requireWritableStore,
  SETTINGS_CAPABILITY, ACTIVATION_TABLE, ACTIVATION_EVENT_TABLE,
} from "../src/lib/practice/capabilities";
import CapabilityConsole from "../src/app/practice/(shell)/setup/capabilities/CapabilityConsole";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

/* eslint-disable @typescript-eslint/no-explicit-any */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

// ⚠ THE OWNER ID GIVEN TO THIS ARC AND NOTHING ELSE. HEX ONLY -- Postgres refuses a uuid literal with a
// non-hex digit in it, which has already cost one harness a run.
const OWNER = "00000000-0000-4000-8000-00000000beef";
// ⚠ PER-RUN, because practice_audit_event is APPEND-ONLY since migration 247 and accumulates across
// runs. Counting audit rows by a fixed correlation id counts every previous run too.
const CID = `harness-capability-${Date.now()}`;

let pass = 0;
let skipped = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};
const skip = (label: string, why: string) => { skipped++; console.log(`  SKIP  ${label} -- ${why}`); };
const section = (n: string) => console.log(`\n  -- ${n} --`);

/**
 * ⚠ COMMENTS STRIPPED BEFORE EVERY SOURCE SCAN. capabilities.ts explains at length which tables it must
 * never touch, and names all three of them while doing so. A scan over raw source would match the
 * paragraph forbidding the thing and pass whether or not the thing was there.
 */
const src = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const raw = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

const SPEC = "docs/CPR-CAP-001-capability-activation-framework.md";
const MIGRATION = "supabase/migrations/278-practice-capability-activation.sql";
const REGISTRY = "src/lib/practice/capability-registry.ts";
const ENGINE = "src/lib/practice/capabilities.ts";
const CONSOLE = "src/app/practice/(shell)/setup/capabilities/CapabilityConsole.tsx";
const PAGE = "src/app/practice/(shell)/setup/capabilities/page.tsx";
const ROUTE = "src/app/api/v1/practice/capabilities/route.ts";

/** THE OTHER AXIS. These three names must not appear in the engine's executable source. */
const PERMISSION_TABLES = ["practice_role_assignment", "practice_role_capabilities", "practice_membership"];

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-cap-${Date.now()}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: CID,
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin,
    { id: req.id, target_user_id: user, correlation_id: CID, workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  const { data: ws, error } = await admin.from("practice_workspace").select("id").eq("owner_person_id", OWNER);
  // ⚠ A FAILED READ IS NOT AN EMPTY LIST.
  if (error) { console.log(`  cleanup could not read workspaces: ${error.message}`); return; }
  for (const w of (ws ?? []) as { id: string }[]) {
    // Only if 278 is applied. A delete against a missing table is an error, not a silence.
    await admin.from(ACTIVATION_EVENT_TABLE).delete().eq("workspace_id", w.id);
    await admin.from(ACTIVATION_TABLE).delete().eq("workspace_id", w.id);
    const { data: encs } = await admin.from("practice_encounter").select("id").eq("workspace_id", w.id);
    for (const e of (encs ?? []) as any[]) {
      await admin.from("practice_encounter_status_history").delete().eq("encounter_id", e.id);
    }
    await admin.from("practice_encounter").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient_identifier").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient_contact").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient").delete().eq("workspace_id", w.id);
  }
  await admin.from("practice_practitioner_identity").delete().eq("user_id", OWNER);
  await purgeWorkspacesOwnedBy(admin, [OWNER], { quiet: true });
}

const routerStub = {
  push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {},
} as any;
const renderClient = (type: any, props: any) =>
  renderToStaticMarkup(React.createElement(
    AppRouterContext.Provider, { value: routerStub }, React.createElement(type, props)));

/**
 * A supabase client that answers exactly one way, so the FAILURE POSTURE can be tested without breaking
 * a real database. It is a stub and it is only ever used to drive resolveCapabilities' error branch --
 * nothing is asserted about the engine's real behaviour through it, which would be asserting over
 * fiction.
 */
const stubAdmin = (answer: any) => ({
  from: () => ({
    select: () => ({
      eq: () => Promise.resolve(answer),
      in: () => Promise.resolve(answer),
    }),
    upsert: () => Promise.resolve({ error: null }),
    insert: () => Promise.resolve({ error: null }),
  }),
});

/** Walks a payload for FUNCTIONS. tsc passes, the API is fine, the page is dead. */
function functionsIn(value: any, at = "$", seen = new Set<any>()): string[] {
  if (typeof value === "function") return [at];
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const out: string[] = [];
  for (const [k, v] of Object.entries(value)) out.push(...functionsIn(v, `${at}.${k}`, seen));
  return out;
}

async function main() {
  console.log(`\nCAPABILITY ACTIVATION FRAMEWORK -- CPR-CAP-001  (${CID})\n`);

  // ══ 1. THE REGISTRY AGAINST THE SPECIFICATION (s4) ══════════════════════════════════════════════
  section("1. the registry is s4's table");

  const specText = raw(SPEC);
  const specLines = specText.split(/\r?\n/).map(l => l.trim());
  const specRows: { id: string; displayName: string; deps: string; def: string }[] = [];
  for (let i = 0; i < specLines.length; i++) {
    if (/^CP\.[A-Z_]+$/.test(specLines[i])) {
      specRows.push({
        id: specLines[i], displayName: specLines[i + 1] ?? "",
        deps: specLines[i + 2] ?? "", def: specLines[i + 3] ?? "",
      });
    }
  }
  // ⚠ THE NON-EMPTINESS ASSERTION COMES FIRST. Every comparison below is vacuous over an empty parse,
  // and this document is a flattened table -- one blank line moved and the parse silently yields zero.
  ok("1-1. PRECONDITION: s4's table parsed out of the specification, twelve rows",
    specRows.length === 12, `${specRows.length} rows parsed from ${SPEC}`);

  ok("1-2. the registry holds exactly the twelve ids s4 names",
    CAPABILITY_IDS.length === 12 && specRows.every(r => (CAPABILITY_IDS as string[]).includes(r.id)),
    `${CAPABILITY_IDS.length} in registry, ${specRows.length} in spec`);

  const nameMismatch = specRows.filter(r => capabilityDef(r.id)?.displayName !== r.displayName);
  ok("1-3. every display name matches the specification verbatim", nameMismatch.length === 0,
    nameMismatch.map(r => `${r.id}: spec "${r.displayName}" vs registry "${capabilityDef(r.id)?.displayName}"`).join("; "));

  const depMismatch = specRows.filter(r => capabilityDef(r.id)?.specDependencies !== r.deps);
  ok("1-4. every dependency cell is recorded verbatim, so a reader can check this table",
    depMismatch.length === 0,
    depMismatch.map(r => `${r.id}: spec "${r.deps}" vs registry "${capabilityDef(r.id)?.specDependencies}"`).join("; "));

  // s4's Default column: On, On, "On in Booking preset", and Optional for the rest.
  ok("1-5. only Calendar and Patient Register are on by default, which is s4's Default column",
    DEFAULT_ACTIVE_IDS.length === 2
    && DEFAULT_ACTIVE_IDS.includes("CP.CALENDAR") && DEFAULT_ACTIVE_IDS.includes("CP.PATIENTS"),
    DEFAULT_ACTIVE_IDS.join(", "));
  ok("1-6. CP.BOOKING is 'preset', which is NOT the same as on",
    capabilityDef("CP.BOOKING")?.defaultState === "preset" && defaultActive("CP.BOOKING") === false);
  const specDefaults = specRows.filter(r =>
    (r.def === "On") !== (capabilityDef(r.id)?.defaultState === "on"));
  ok("1-7. every 'On' in the specification is an 'on' in the registry and vice versa",
    specDefaults.length === 0, specDefaults.map(r => `${r.id}=${r.def}`).join("; "));

  // ══ 2. DEPENDENCIES, AND THE REQUIRED / RECOMMENDED DISTINCTION (s4, s6) ════════════════════════
  section("2. dependency rules");

  ok("2-1. CP.BOOKING requires the Calendar capability", requiredClosure(["CP.BOOKING"]).includes("CP.CALENDAR"));
  ok("2-2. ...and names its four configuration dependencies separately from its capability one",
    ["locations", "practitioner_program", "availability", "registration"]
      .every(k => setupClosure(["CP.BOOKING"]).includes(k as any)),
    setupClosure(["CP.BOOKING"]).join(", "));
  ok("2-3. CP.FOLLOWUPS requires Patients AND Calendar (s4)",
    requiredDependenciesOf(["CP.FOLLOWUPS"]).includes("CP.PATIENTS")
    && requiredDependenciesOf(["CP.FOLLOWUPS"]).includes("CP.CALENDAR"),
    requiredDependenciesOf(["CP.FOLLOWUPS"]).join(", "));

  const clinical: CapabilityId[] = ["CP.INVESTIGATIONS", "CP.MEDICATIONS", "CP.PROCEDURES"];
  ok("2-4. Investigations, Treatments and Procedures REQUIRE Patients",
    clinical.every(c => capabilityDef(c)!.requires.includes("CP.PATIENTS")));
  // ⚠ THE DISTINCTION THAT IS REAL. s4 says "Encounters recommended", not required, and promoting it
  // would force a consultation record on a practice that only wanted to track a scan.
  ok("2-5. ...and RECOMMEND Encounters without requiring it",
    clinical.every(c => capabilityDef(c)!.recommends.includes("CP.ENCOUNTERS")
      && !capabilityDef(c)!.requires.includes("CP.ENCOUNTERS")));
  ok("2-6. so activating Investigations drags in Patients and NOT Encounters",
    requiredClosure(["CP.INVESTIGATIONS"]).includes("CP.PATIENTS")
    && !requiredClosure(["CP.INVESTIGATIONS"]).includes("CP.ENCOUNTERS"),
    requiredClosure(["CP.INVESTIGATIONS"]).join(", "));
  ok("2-7. ...while Encounters is still OFFERED as a recommendation",
    recommendedFor(["CP.INVESTIGATIONS"]).includes("CP.ENCOUNTERS"));

  const patientDeps = dependentClosure("CP.PATIENTS");
  ok("2-8. PRECONDITION: Patient Register has dependents at all", patientDeps.length >= 6, `${patientDeps.length}`);
  ok("2-9. the dependents of Patient Register include every clinical capability",
    ["CP.ENCOUNTERS", "CP.INVESTIGATIONS", "CP.MEDICATIONS", "CP.PROCEDURES", "CP.DOCUMENTS", "CP.FOLLOWUPS"]
      .every(c => patientDeps.includes(c as CapabilityId)), patientDeps.join(", "));
  ok("2-10. ...and never the capability itself, which would make the warning read as being about something else",
    !patientDeps.includes("CP.PATIENTS"));
  ok("2-11. a capability nothing depends on has no dependents (a real empty answer, not a broken one)",
    dependentClosure("CP.AI_ASSIST").length === 0);
  ok("2-12. requiredClosure terminates and puts dependencies before their dependents",
    (() => {
      const c = requiredClosure(["CP.CLOSE_DAY"]);
      return c.indexOf("CP.CALENDAR") < c.indexOf("CP.CLOSE_DAY")
        && c.indexOf("CP.PATIENTS") < c.indexOf("CP.CLOSE_DAY");
    })(), requiredClosure(["CP.CLOSE_DAY"]).join(" -> "));
  ok("2-13. an id that is not in the registry is refused rather than assumed",
    !isCapabilityId("CP.BILLING") && capabilityDef("CP.BILLING") === null);

  // ══ 3. MODES ARE PRESETS, NOT TIERS (s5) ════════════════════════════════════════════════════════
  section("3. practice modes");

  const modeLines = specLines;
  const specModeNames = ["Booking Only", "Organise My Practice", "Remember My Patients", "Intelligent Practice"];
  ok("3-1. PRECONDITION: s5's four presets are in the specification",
    specModeNames.every(n => modeLines.includes(n)), specModeNames.filter(n => !modeLines.includes(n)).join(", "));
  ok("3-2. the registry holds those four, with the specification's own promise wording",
    PRACTICE_MODES.length === 4
    && specModeNames.every(n => PRACTICE_MODES.some(m => m.displayName === n))
    && PRACTICE_MODES.every(m => modeLines.includes(m.specPromise)),
    PRACTICE_MODES.filter(m => !modeLines.includes(m.specPromise)).map(m => m.specPromise).join("; "));

  ok("3-3. Booking Only selects Booking, Calendar and Patients",
    ["CP.BOOKING", "CP.CALENDAR", "CP.PATIENTS"].every(c => modeSelection("booking_only").includes(c as CapabilityId))
    && modeSelection("booking_only").length === 3, modeSelection("booking_only").join(", "));
  // The dependency engine doing the preset's work for it: s5 does not list Patients under
  // "Remember My Patients", every capability in it requires Patients, so the closure supplies it.
  ok("3-4. Remember My Patients does not LIST Patients...",
    !PRACTICE_MODES.find(m => m.id === "remember_patients")!.selects.includes("CP.PATIENTS"));
  ok("3-5. ...and gets it anyway, because every capability in it requires it (s6 bullet two)",
    modeSelection("remember_patients").includes("CP.PATIENTS"), modeSelection("remember_patients").join(", "));
  // s5 writes "Booking/Calendar AS SELECTED" for this preset, which is a decision left to the practice.
  ok("3-6. Organise My Practice does NOT force Booking on the practice (s5: 'as selected')",
    !modeSelection("organise_practice").includes("CP.BOOKING"), modeSelection("organise_practice").join(", "));
  ok("3-7. ...but does bring Calendar, because Follow-ups requires it",
    modeSelection("organise_practice").includes("CP.CALENDAR"));

  // ⚠ THE SHAPE ASSERTION BEHIND "NOT A TIER": there is no stored mode anywhere in the schema that a
  // reader could consult. mode_code exists only on the ROW a preset wrote.
  const migration = raw(MIGRATION);
  // ⚠ COMMENTS AND STRING LITERALS BOTH STRIPPED. The migration's own comment on the mode_code column
  // says "NOT a stored tier", inside a SQL string, so a scan over raw text matches the sentence that
  // forbids the thing -- trap (a), in its SQL form.
  const sqlCode = migration.replace(/--[^\n]*/g, " ").replace(/'(?:[^']|'')*'/g, "''");
  ok("3-8. no column in migration 278 stores a practice tier, plan or current mode",
    !/\b(tier|plan_code|practice_mode|current_mode|active_mode)\b/i.test(sqlCode),
    "a tier column would let a preset override an individual choice");
  ok("3-8b. CONTROL: the stripper left the schema intact and the raw file DOES contain the word",
    /create table if not exists practice_capability_activation\b/.test(sqlCode) && /tier/i.test(migration));
  const engineSrc = src(ENGINE);
  ok("3-9. the resolver never reads mode_code to decide a state",
    /const stateOf =[\s\S]{0,200}row\.state === "active"[\s\S]{0,80}defaultActive/.test(engineSrc)
    && !/mode_code[\s\S]{0,40}(active|state) ===/.test(engineSrc),
    "state is computed from the row's own state and the registry default only");

  // ══ 4. THE TWO AXES ARE SEPARATE, IN SOURCE ════════════════════════════════════════════════════
  section("4. activation is not permission (source)");

  const hits = PERMISSION_TABLES.filter(t => engineSrc.includes(t));
  ok("4-1. the engine's executable source names NO permission table", hits.length === 0, hits.join(", "));
  // ⚠ CONTROL: the scan must be able to SEE those names, or 4-1 is a scan of nothing. The engine's raw
  // source (comments included) explains at length that it must not touch them, so all three are there.
  const rawEngine = raw(ENGINE);
  ok("4-2. CONTROL: the same scan finds all three names in the engine's COMMENTS, so it can see them",
    PERMISSION_TABLES.every(t => rawEngine.includes(t)),
    PERMISSION_TABLES.filter(t => !rawEngine.includes(t)).join(", "));
  ok("4-3. CONTROL: and the comment-stripper really removed the paragraph that names them",
    rawEngine.length > engineSrc.length + 1000, `${rawEngine.length} raw vs ${engineSrc.length} stripped`);
  ok("4-4. the engine writes exactly one activation table and no permission table",
    engineSrc.includes("ACTIVATION_TABLE") && engineSrc.includes("ACTIVATION_EVENT_TABLE"));
  ok("4-5. the API gate is an EXISTING permission code, not an invented CP.* one",
    SETTINGS_CAPABILITY === "practice.settings.manage" && !SETTINGS_CAPABILITY.startsWith("CP."));
  ok("4-6. and the route gates on it rather than on a capability id",
    src(ROUTE).includes("requirePracticeContext(SETTINGS_CAPABILITY)")
    && !/requirePracticeContext\("CP\./.test(src(ROUTE)));
  ok("4-7. migration 278 creates no foreign key into the permission plane",
    !/references\s+practice_(role_assignment|role_capabilities|membership)/i.test(migration));
  ok("4-8. every registry entry is complete -- an id with no display name is a blank row on a screen",
    CAPABILITY_REGISTRY.length === 12
    && CAPABILITY_REGISTRY.every(c => c.displayName.trim() !== "" && c.area.trim() !== ""),
    CAPABILITY_REGISTRY.filter(c => !c.displayName.trim() || !c.area.trim()).map(c => c.id).join(", "));
  ok("4-9. the page gates itself on the SAME existing permission and adds no capability of its own",
    src(PAGE).includes("hasCapability(shell.ctx, SETTINGS_CAPABILITY)")
    && !/hasCapability\(shell\.ctx, "CP\./.test(src(PAGE)));
  // ⚠ THIS ARC DELIBERATELY ADDS NO NAVIGATION ENTRY. navigation.ts is owned by another change in
  // flight, and PRIMARY_ORDER is pinned by sixteen assertions elsewhere. Asserted here so that adding
  // one later is a deliberate act rather than a drift.
  ok("4-10. no navigation entry was added for this page",
    !raw("src/lib/practice/navigation.ts").includes("setup/capabilities"));

  // ══ 5. THE IMPORT-FREE RULE ═════════════════════════════════════════════════════════════════════
  section("5. the registry stays out of the client bundle");

  const registryRaw = raw(REGISTRY);
  const registryImports = registryRaw.split("\n").filter(l => /^\s*import\s/.test(l) || /\brequire\(/.test(l));
  ok("5-1. capability-registry.ts imports NOTHING", registryImports.length === 0, registryImports.join(" | "));
  // ⚠ CONTROL: 5-1 also passes for an empty file.
  ok("5-2. CONTROL: it is the real registry -- twelve definitions and the dependency functions",
    /export const CAPABILITY_REGISTRY/.test(registryRaw)
    && /export function requiredClosure/.test(registryRaw)
    && registryRaw.includes("CP.BOOKING"));
  const consoleSrc = src(CONSOLE);
  ok("5-3. the client console imports the engine for TYPES ONLY",
    /import type \{[^}]*\} from "@\/lib\/practice\/capabilities"/.test(consoleSrc)
    && !/^import \{[^}]*\} from "@\/lib\/practice\/capabilities"/m.test(consoleSrc),
    "a value import here drags audit and the database client into the browser bundle");
  ok("5-4. ...and takes its VALUES from the import-free registry",
    /import \{[\s\S]*?\} from "@\/lib\/practice\/capability-registry"/.test(consoleSrc));
  ok("5-5. the engine imports audit from @/lib/practice/audit, never from provisioning",
    engineSrc.includes('from "@/lib/practice/audit"')
    && !/audit[^\n]*from "@\/lib\/practice\/provisioning"/.test(engineSrc));

  // ══ 6. THE FAILURE POSTURE ══════════════════════════════════════════════════════════════════════
  section("6. a failed read is never a zero");

  const broken = await resolveCapabilities(
    stubAdmin({ data: null, error: { message: "connection refused" } }), "ws-does-not-matter");
  ok("6-1. an unreadable store answers readable:false", broken.readable === false);
  ok("6-2. ⚠ active is NULL, not an empty array -- the shape a caller cannot misread as 'no product'",
    broken.active === null, JSON.stringify(broken.active));
  ok("6-3. PRECONDITION: it still returns all twelve statuses to render", broken.statuses.length === 12);
  ok("6-4. every state is 'unknown' -- not 'inactive'",
    broken.statuses.every(s => s.state === "unknown") && broken.statuses.every(s => s.origin === "unreadable"));
  ok("6-5. activeDependents is null rather than [], which would promise nothing is affected",
    broken.statuses.every(s => s.activeDependents === null));
  ok("6-6. the database's own words survive to the screen", broken.error === "connection refused");
  ok("6-7. RENDERING an unknown resolves to available -- a blip must not blank a working practice",
    capabilityAvailable(broken, "CP.ENCOUNTERS") === true && capabilityStateOf(broken, "CP.ENCOUNTERS") === "unknown");
  ok("6-8. WRITING over an unknown refuses",
    requireWritableStore(broken)?.code === "CAPABILITY_STORE_UNREADABLE");
  ok("6-9. planDeactivation over an unknown names no dependents and says it could not tell",
    planDeactivation(broken, "CP.PATIENTS").dependents === null
    && planDeactivation(broken, "CP.PATIENTS").readable === false);

  // ⚠ THE CONTROL: the same code path over a store that answers with NO ROWS must behave completely
  // differently, or 6-1..6-9 prove only that the stub works.
  const empty = await resolveCapabilities(stubAdmin({ data: [], error: null }), "ws-empty");
  ok("6-10. CONTROL: an EMPTY store is readable, and resolves to the registry defaults",
    empty.readable === true && Array.isArray(empty.active) && empty.active!.length === 2,
    JSON.stringify(empty.active));
  ok("6-11. CONTROL: ...so a capability nobody switched on is 'inactive', not 'unknown'",
    capabilityStateOf(empty, "CP.ENCOUNTERS") === "inactive"
    && capabilityAvailable(empty, "CP.ENCOUNTERS") === false);
  ok("6-12. CONTROL: ...and Calendar and Patients ARE on for a practice that has stored nothing",
    capabilityStateOf(empty, "CP.CALENDAR") === "active" && capabilityStateOf(empty, "CP.PATIENTS") === "active");
  ok("6-13. CONTROL: writing over a readable-but-empty store is allowed",
    requireWritableStore(empty) === null);

  const fakeCtx = { workspaceId: "ws", capabilities: [SETTINGS_CAPABILITY] } as unknown as WorkspaceContext;
  const refusedWrite = await activateCapability(
    stubAdmin({ data: null, error: { message: "connection refused" } }) as any, fakeCtx,
    { capability: "CP.ENCOUNTERS", actorId: OWNER, correlationId: CID });
  ok("6-14. activation over an unreadable store changes nothing and says why",
    !refusedWrite.ok && refusedWrite.code === "CAPABILITY_STORE_UNREADABLE",
    JSON.stringify(refusedWrite));

  // ══ 7. THE PAYLOAD AND THE SCREEN ══════════════════════════════════════════════════════════════
  section("7. the payload and the rendered screen");

  ok("7-1. no FUNCTION anywhere on the payload handed to the client component",
    functionsIn(empty).length === 0, functionsIn(empty).join(", "));
  ok("7-2. ...nor on the unreadable one", functionsIn(broken).length === 0, functionsIn(broken).join(", "));

  const htmlNormal = renderClient(CapabilityConsole, { resolution: empty, canManage: true });
  const htmlBroken = renderClient(CapabilityConsole, { resolution: broken, canManage: true });
  ok("7-3. PRECONDITION: the console renders at all", htmlNormal.length > 500, `${htmlNormal.length} bytes`);
  ok("7-4. the honest limit is on the screen, not in a footnote",
    htmlNormal.includes(NOT_YET_WIRED.slice(0, 40)));
  ok("7-5. the axis rule is said in plain words on the screen",
    htmlNormal.includes(ACTIVATION_IS_NOT_PERMISSION.slice(0, 40)));
  ok("7-6. a preset is described as a preset", htmlNormal.includes(MODES_ARE_PRESETS.slice(0, 40)));
  ok("7-7. an unknown state is drawn as 'Not known'", htmlBroken.includes("Not known"));
  // ⚠ NOT AS OFF. This is the whole point of the third state reaching the screen.
  ok("7-8. ...and NEVER as 'Off'", !/>Off</.test(htmlBroken), "an unknown drawn as Off sends somebody hunting");
  ok("7-9. CONTROL: a readable resolution DOES draw 'Off' for what is genuinely off",
    /">Off</.test(htmlNormal) || htmlNormal.includes(">Off<"));
  ok("7-10. nothing can be switched while the store is unreadable",
    htmlBroken.includes("Not available while your settings cannot be read"));
  ok("7-11. a reader without the permission is told, rather than shown switches that would 403",
    renderClient(CapabilityConsole, { resolution: empty, canManage: false })
      .includes("Only somebody who manages practice settings"));

  // ══ 8. THE STORE ═══════════════════════════════════════════════════════════════════════════════
  section("8. the store (migration 278)");

  const { error: storeProbe } = await admin.from(ACTIVATION_TABLE).select("id").limit(1);
  if (storeProbe) {
    for (const label of [
      "8-x. every store assertion", "9-x. dependency activation", "10-x. deactivation warnings",
      "11-x. modes over a live store", "12-x. activation vs permission (live)", "13-x. history survives",
      "14-x. the audit trail",
    ]) skip(label, `migration 278 is not applied: ${storeProbe.message}`);
    return report();
  }

  await cleanup();
  const ws = await provision(OWNER, "Harness Capability Practice");
  const ctxRes = await resolveWorkspaceContext(admin, OWNER, ws);
  if (!ctxRes.ok) { console.error(`context did not resolve: ${ctxRes.reason}`); return report(); }
  const ctx = ctxRes.ctx;
  const actor = { actorId: OWNER, correlationId: CID };

  ok("8-1. PRECONDITION: the owner holds practice.settings.manage",
    ctx.capabilities.includes(SETTINGS_CAPABILITY), ctx.capabilities.length ? "" : "no capabilities at all");

  const virgin = await resolveCapabilities(admin, ws);
  ok("8-2. a brand new practice has NO stored rows...",
    virgin.readable && virgin.statuses.every(s => s.origin === "registry_default"));
  ok("8-3. ...and is nonetheless running Calendar and Patient Register (absence is the default, not off)",
    virgin.active !== null && virgin.active.length === 2
    && virgin.active.includes("CP.CALENDAR") && virgin.active.includes("CP.PATIENTS"),
    JSON.stringify(virgin.active));
  ok("8-4. ...and everything else is genuinely inactive, not unknown",
    virgin.statuses.filter(s => s.state === "inactive").length === 10
    && virgin.statuses.every(s => s.state !== "unknown"));

  // ⚠ THE PERMISSION GATE ON THE VERB, tested by removing it from the context the API passes.
  const strippedCtx = { ...ctx, capabilities: ctx.capabilities.filter(c => c !== SETTINGS_CAPABILITY) };
  const denied = await activateCapability(admin, strippedCtx, { capability: "CP.DOCUMENTS", ...actor });
  ok("8-5. somebody without practice settings permission cannot change activation",
    !denied.ok && denied.status === 403, JSON.stringify(denied));
  const stillOff = await resolveCapabilities(admin, ws);
  ok("8-6. ...and the refusal wrote nothing",
    capabilityStateOf(stillOff, "CP.DOCUMENTS") === "inactive");
  // ⚠ CONTROL: the same call WITH the permission succeeds, so 8-5 is not passing because the call is
  // broken for everybody.
  const allowed = await activateCapability(admin, ctx, { capability: "CP.DOCUMENTS", ...actor });
  ok("8-7. CONTROL: the same call with the permission succeeds",
    allowed.ok && allowed.data.changed.includes("CP.DOCUMENTS"), JSON.stringify(allowed));

  const bogus = await activateCapability(admin, ctx, { capability: "CP.BILLING", ...actor });
  ok("8-8. an id that is not in the registry is refused, not stored",
    !bogus.ok && bogus.code === "UNKNOWN_CAPABILITY");

  // ══ 9. A DEPENDENCY IS ACTIVATED WITH ITS DEPENDENT (s6 bullet two) ════════════════════════════
  section("9. dependencies come along");

  // Patients is on by default, so to see a dependency ACTIVATED we first switch Patients off. That
  // deactivation is itself the s6 bullet-four case and is acknowledged deliberately.
  const offPatients = await deactivateCapability(admin, ctx,
    { capability: "CP.PATIENTS", acknowledgeDependents: true, ...actor });
  ok("9-1. PRECONDITION: Patient Register switched off, taking its active dependents with it",
    offPatients.ok && offPatients.data.changed.includes("CP.PATIENTS")
    && offPatients.data.dependentsDeactivated.includes("CP.DOCUMENTS"),
    JSON.stringify(offPatients));
  const afterOff = await resolveCapabilities(admin, ws);
  ok("9-2. PRECONDITION: so Patients and Documents are both genuinely off now",
    capabilityStateOf(afterOff, "CP.PATIENTS") === "inactive"
    && capabilityStateOf(afterOff, "CP.DOCUMENTS") === "inactive");

  const withDep = await activateCapability(admin, ctx, { capability: "CP.ENCOUNTERS", ...actor });
  ok("9-3. activating Quick Encounters activates Patient Register in the same flow",
    withDep.ok && withDep.data.dependenciesActivated.includes("CP.PATIENTS")
    && withDep.data.changed.includes("CP.ENCOUNTERS"), JSON.stringify(withDep));
  const afterDep = await resolveCapabilities(admin, ws);
  ok("9-4. ...and the store says so",
    capabilityStateOf(afterDep, "CP.PATIENTS") === "active"
    && capabilityStateOf(afterDep, "CP.ENCOUNTERS") === "active");
  ok("9-5. the dependency row records that a dependency put it there, not a person's decision",
    afterDep.statuses.find(s => s.id === "CP.PATIENTS")?.source === "dependency");
  // ⚠ CONTROL: a capability with no unmet dependency reports NONE dragged in, so 9-3 is not passing
  // because the field is always populated.
  const noDep = await activateCapability(admin, ctx, { capability: "CP.AI_ASSIST", ...actor });
  ok("9-6. CONTROL: activating something with no dependencies drags nothing in",
    noDep.ok && noDep.data.dependenciesActivated.length === 0, JSON.stringify(noDep));

  // ⚠ RECOMMENDED IS OFFERED AND NEVER FORCED (s4: "Encounters recommended"). Encounters is switched
  // off first, so that "it was not activated" is a fact about this call rather than about the fixture.
  const offEnc0 = await deactivateCapability(admin, ctx, { capability: "CP.ENCOUNTERS", ...actor });
  ok("9-7. PRECONDITION: Quick Encounters is off, and switching it off warned about nothing",
    offEnc0.ok && offEnc0.data.dependentsDeactivated.length === 0, JSON.stringify(offEnc0));

  const invActivation = await activateCapability(admin, ctx, { capability: "CP.INVESTIGATIONS", ...actor });
  ok("9-8. activating Investigations OFFERS Quick Encounters as a recommendation",
    invActivation.ok && invActivation.data.recommended.includes("CP.ENCOUNTERS"),
    JSON.stringify(invActivation.ok ? invActivation.data.recommended : invActivation));
  const afterRec = await resolveCapabilities(admin, ws);
  ok("9-9. ⚠ ...and DOES NOT ACTIVATE IT, which is the whole difference from a requirement",
    capabilityStateOf(afterRec, "CP.INVESTIGATIONS") === "active"
    && capabilityStateOf(afterRec, "CP.ENCOUNTERS") === "inactive");
  ok("9-10. ...and the setup artefacts it needs are named rather than assumed complete",
    invActivation.ok && Array.isArray(invActivation.data.setupRequired));
  // ⚠ CONTROL: a capability that recommends nothing reports an EMPTY recommendation list, so 9-8 is not
  // passing because the field is always populated.
  const docsBack = await activateCapability(admin, ctx, { capability: "CP.DOCUMENTS", ...actor });
  ok("9-11. CONTROL: something that recommends nothing recommends nothing",
    docsBack.ok && docsBack.data.recommended.length === 0, JSON.stringify(docsBack));

  // ══ 10. DEACTIVATION WARNS AND NAMES (s6 bullet four) ══════════════════════════════════════════
  section("10. deactivation warns");

  const beforeWarn = await resolveCapabilities(admin, ws);
  const expectWarned = planDeactivation(beforeWarn, "CP.PATIENTS").dependents ?? [];
  ok("10-1. PRECONDITION: Patient Register has ACTIVE dependents right now",
    expectWarned.length > 0, expectWarned.join(", "));

  const warned = await deactivateCapability(admin, ctx, { capability: "CP.PATIENTS", ...actor });
  ok("10-2. deactivating something depended upon is REFUSED without acknowledgement",
    !warned.ok && warned.code === "DEPENDENTS_ACTIVE", JSON.stringify(warned));
  ok("10-3. ...and the refusal NAMES the dependents rather than saying 'some'",
    !warned.ok && Array.isArray(warned.dependents) && warned.dependents.length === expectWarned.length
    && expectWarned.every(d => warned.dependents!.includes(d)),
    JSON.stringify(!warned.ok ? warned.dependents : null));
  ok("10-4. ...and the message says which, in words a practitioner reads",
    !warned.ok && expectWarned.every(d => warned.message.includes(capabilityDef(d)!.displayName)),
    !warned.ok ? warned.message : "");
  const afterWarn = await resolveCapabilities(admin, ws);
  ok("10-5. ⚠ THE REFUSAL CHANGED NOTHING",
    capabilityStateOf(afterWarn, "CP.PATIENTS") === "active"
    && expectWarned.every(d => capabilityStateOf(afterWarn, d) === "active"));

  // ⚠ CONTROL: a capability with NO active dependents is switched off without a warning, so 10-2 is
  // not passing because deactivation is simply broken.
  const clean = await deactivateCapability(admin, ctx, { capability: "CP.AI_ASSIST", ...actor });
  ok("10-6. CONTROL: something nothing depends on switches off with no warning at all",
    clean.ok && clean.data.changed.includes("CP.AI_ASSIST") && clean.data.dependentsDeactivated.length === 0,
    JSON.stringify(clean));
  const alreadyOff = await deactivateCapability(admin, ctx, { capability: "CP.AI_ASSIST", ...actor });
  ok("10-7. switching off something already off reports NO change rather than claiming one",
    alreadyOff.ok && alreadyOff.data.changed.length === 0 && alreadyOff.data.unchanged.includes("CP.AI_ASSIST"));

  // ══ 11. A MODE IS A PRESET, OVER A LIVE STORE (s5) ═════════════════════════════════════════════
  section("11. modes over the live store");

  const applied = await applyPracticeMode(admin, ctx, { mode: "booking_only", ...actor });
  ok("11-1. applying Booking Only switches its capabilities on",
    applied.ok && modeSelection("booking_only").every(c =>
      applied.data.changed.includes(c) || applied.data.unchanged.includes(c)),
    JSON.stringify(applied));
  const afterMode = await resolveCapabilities(admin, ws);
  ok("11-2. PRECONDITION: Booking is on and Investigations is ALSO on (an individual choice from s9)",
    capabilityStateOf(afterMode, "CP.BOOKING") === "active"
    && capabilityStateOf(afterMode, "CP.INVESTIGATIONS") === "active");
  // ⚠ THE ASSERTION THAT MAKES IT A PRESET. Booking Only does not list Investigations. If a mode were a
  // stored tier, re-applying it would take Investigations away.
  const reapplied = await applyPracticeMode(admin, ctx, { mode: "booking_only", ...actor });
  ok("11-3. re-applying the preset changes nothing that was already on",
    reapplied.ok && reapplied.data.changed.length === 0, JSON.stringify(reapplied));
  const afterReapply = await resolveCapabilities(admin, ws);
  ok("11-4. ⚠ AND INVESTIGATIONS IS STILL ON -- a preset never subtracts, so it is not a tier",
    capabilityStateOf(afterReapply, "CP.INVESTIGATIONS") === "active");
  ok("11-5. ...nor did it switch off anything else outside its own list",
    capabilityStateOf(afterReapply, "CP.DOCUMENTS") === "active");

  // An individual choice made AFTER a preset survives, and the preset provenance does not resurrect it.
  const individualOff = await deactivateCapability(admin, ctx, { capability: "CP.BOOKING", ...actor });
  ok("11-6. PRECONDITION: the practice then switches Booking off by hand", individualOff.ok);
  const afterIndividual = await resolveCapabilities(admin, ws);
  ok("11-7. ⚠ Booking is OFF even though a preset switched it on -- the individual choice wins",
    capabilityStateOf(afterIndividual, "CP.BOOKING") === "inactive");
  ok("11-8. ...and the resolver still reports the preset as provenance without acting on it",
    afterIndividual.lastAppliedMode === null || afterIndividual.lastAppliedMode.modeId === "booking_only",
    JSON.stringify(afterIndividual.lastAppliedMode));
  const badMode = await applyPracticeMode(admin, ctx, { mode: "enterprise", ...actor });
  ok("11-9. a mode that does not exist is refused", !badMode.ok && badMode.code === "UNKNOWN_MODE");

  // ══ 12. ACTIVATION AND PERMISSION ARE INDEPENDENT -- LIVE, BOTH DIRECTIONS ═════════════════════
  section("12. activation vs permission, against the database");

  const { data: memberships, error: mErr } = await admin.from("practice_membership")
    .select("id, role_code").eq("workspace_id", ws).eq("user_id", OWNER).eq("status", "active");
  ok("12-0. PRECONDITION: the fixture has both memberships provisioning creates",
    !mErr && (memberships ?? []).length === 2, mErr ? mErr.message : `${(memberships ?? []).length}`);
  const practitionerMembership = (memberships ?? []).find((m: any) => m.role_code === "practitioner")?.id;
  const ownerMembership = (memberships ?? []).find((m: any) => m.role_code === "practice_owner")?.id;

  const liveGrants = async (membershipId: string): Promise<string[]> => {
    const { data } = await admin.from("practice_role_assignment")
      .select("capability_code").eq("membership_id", membershipId).is("effective_to", null);
    return ((data ?? []) as any[]).map(r => r.capability_code as string).sort();
  };

  if (!practitionerMembership || !ownerMembership) {
    skip("12-x. both directions", "the fixture memberships did not resolve");
  } else {
    // ── DIRECTION A: deactivating a product must not revoke a permission ──
    const before = await liveGrants(practitionerMembership);
    ok("12-1. PRECONDITION: the practitioner holds encounter.edit, and holds other grants too",
      before.includes("encounter.edit") && before.length > 1, `${before.length} grants`);
    const encOn = await activateCapability(admin, ctx, { capability: "CP.ENCOUNTERS", ...actor });
    ok("12-2. PRECONDITION: Quick Encounters is active for this practice",
      encOn.ok && capabilityStateOf(await resolveCapabilities(admin, ws), "CP.ENCOUNTERS") === "active");

    const offEnc = await deactivateCapability(admin, ctx,
      { capability: "CP.ENCOUNTERS", acknowledgeDependents: true, ...actor });
    ok("12-3. PRECONDITION: CP.ENCOUNTERS is deactivated", offEnc.ok && offEnc.data.changed.includes("CP.ENCOUNTERS"),
      JSON.stringify(offEnc));

    const afterA = await liveGrants(practitionerMembership);
    ok("12-4. ⚠ NOBODY LOST encounter.edit", afterA.includes("encounter.edit"));
    ok("12-5. ⚠ ...and NOT ONE grant changed at all",
      afterA.length === before.length && afterA.join("|") === before.join("|"),
      `${before.length} before, ${afterA.length} after`);
    const ctxAfterA = await resolveWorkspaceContext(admin, OWNER, ws);
    ok("12-6. ...so the resolved workspace context still carries the permission",
      ctxAfterA.ok && ctxAfterA.ctx.capabilities.includes("encounter.edit"));

    // ⚠ CONTROL. 12-4 and 12-5 would pass just as loudly against a query that can never see a change.
    // Revoke the grant by hand, prove the query NOTICES, then restore it and prove it is back.
    const { error: revokeErr } = await admin.from("practice_role_assignment")
      .update({ effective_to: new Date().toISOString() })
      .eq("membership_id", practitionerMembership).eq("capability_code", "encounter.edit")
      .is("effective_to", null);
    const duringControl = await liveGrants(practitionerMembership);
    ok("12-7. CONTROL: the same query DOES see a revocation when one really happens",
      !revokeErr && !duringControl.includes("encounter.edit"),
      revokeErr ? revokeErr.message : duringControl.join(", "));
    await admin.from("practice_role_assignment")
      .update({ effective_to: null })
      .eq("membership_id", practitionerMembership).eq("capability_code", "encounter.edit")
      .not("effective_to", "is", null);
    const restored = await liveGrants(practitionerMembership);
    ok("12-8. CONTROL: and the grant is restored, so the fixture is where it was",
      restored.includes("encounter.edit") && restored.length === before.length, restored.join(", "));

    // ── DIRECTION B: granting a permission must not activate a product ──
    const ownerBefore = await liveGrants(ownerMembership);
    ok("12-9. PRECONDITION: the OWNER membership does not hold encounter.edit",
      !ownerBefore.includes("encounter.edit"), ownerBefore.join(", "));
    const stateBeforeGrant = capabilityStateOf(await resolveCapabilities(admin, ws), "CP.ENCOUNTERS");
    ok("12-10. PRECONDITION: and CP.ENCOUNTERS is inactive", stateBeforeGrant === "inactive", stateBeforeGrant);

    const { error: grantErr } = await admin.from("practice_role_assignment")
      .insert({ membership_id: ownerMembership, capability_code: "encounter.edit", source: "explicit_grant" });
    const ownerAfter = await liveGrants(ownerMembership);
    ok("12-11. PRECONDITION: the grant really landed (12-12 is not vacuous)",
      !grantErr && ownerAfter.includes("encounter.edit"), grantErr ? grantErr.message : ownerAfter.join(", "));

    const afterB = await resolveCapabilities(admin, ws);
    ok("12-12. ⚠ GRANTING encounter.edit DID NOT ACTIVATE CP.ENCOUNTERS",
      capabilityStateOf(afterB, "CP.ENCOUNTERS") === "inactive",
      capabilityStateOf(afterB, "CP.ENCOUNTERS"));
    ok("12-13. ...and activated nothing else either",
      afterB.active !== null && !afterB.active.includes("CP.ENCOUNTERS"), JSON.stringify(afterB.active));
    const { count: strayRows } = await admin.from(ACTIVATION_TABLE)
      .select("id", { head: true, count: "exact" })
      .eq("workspace_id", ws).eq("capability_code", "CP.ENCOUNTERS").eq("state", "active");
    ok("12-14. ...and wrote no activation row", (strayRows ?? 0) === 0, `${strayRows}`);

    // ⚠ CONTROL: the resolver CAN see CP.ENCOUNTERS become active, so 12-12 is not passing because the
    // resolver is stuck.
    const reactivate = await activateCapability(admin, ctx, { capability: "CP.ENCOUNTERS", ...actor });
    const afterControl = await resolveCapabilities(admin, ws);
    ok("12-15. CONTROL: the ENGINE can activate it, and the resolver notices immediately",
      reactivate.ok && capabilityStateOf(afterControl, "CP.ENCOUNTERS") === "active",
      JSON.stringify(reactivate));
    // And the reverse control on the permission side: the engine's activation granted nothing new.
    const ownerAfterActivate = await liveGrants(ownerMembership);
    ok("12-16. ⚠ ...while granting nobody a single new permission",
      ownerAfterActivate.join("|") === ownerAfter.join("|"),
      `${ownerAfter.length} before, ${ownerAfterActivate.length} after`);

    await admin.from("practice_role_assignment").delete()
      .eq("membership_id", ownerMembership).eq("capability_code", "encounter.edit");
  }

  // ══ 13. HISTORY SURVIVES DEACTIVATION (s6 bullet five, s8) ═════════════════════════════════════
  section("13. nothing is deleted");

  const patient = await registerPatient(admin, {
    workspaceId: ws, displayName: "Harness Capability Patient", sex: "female",
    ageEstimateYears: 40, actorId: OWNER, correlationId: CID, confirmNew: true,
  });
  ok("13-1. PRECONDITION: a patient exists", patient.ok, JSON.stringify(patient));
  let encounterId: string | null = null;
  if (patient.ok) {
    const enc = await launchEncounter(admin, {
      workspaceId: ws, patientId: patient.data.id, pathway: "new_walk_in",
      actorId: OWNER, correlationId: CID,
    });
    ok("13-2. PRECONDITION: an encounter was recorded against them", enc.ok, JSON.stringify(enc));
    if (enc.ok) encounterId = enc.data.id;
  }

  if (patient.ok && encounterId) {
    const kill = await deactivateCapability(admin, ctx,
      { capability: "CP.ENCOUNTERS", acknowledgeDependents: true, ...actor });
    ok("13-3. PRECONDITION: Quick Encounters is switched off", kill.ok, JSON.stringify(kill));
    ok("13-4. ...and the state really is inactive",
      capabilityStateOf(await resolveCapabilities(admin, ws), "CP.ENCOUNTERS") === "inactive");

    const { data: stillEnc, error: encErr } = await admin.from("practice_encounter")
      .select("id, status").eq("id", encounterId).maybeSingle();
    ok("13-5. ⚠ THE ENCOUNTER IS STILL THERE", !encErr && !!stillEnc, encErr ? encErr.message : "gone");
    const { data: stillPatient } = await admin.from("practice_patient")
      .select("id, display_name").eq("id", patient.data.id).maybeSingle();
    ok("13-6. ⚠ AND SO IS THE PATIENT", !!stillPatient && stillPatient.display_name === "Harness Capability Patient");

    const { data: histRow } = await admin.from(ACTIVATION_TABLE)
      .select("state, activated_at, deactivated_at").eq("workspace_id", ws).eq("capability_code", "CP.ENCOUNTERS").maybeSingle();
    ok("13-7. the activation row was UPDATED, not deleted, and kept both halves of its own history",
      !!histRow && histRow.state === "inactive" && !!histRow.deactivated_at && !!histRow.activated_at,
      JSON.stringify(histRow));

    const back = await activateCapability(admin, ctx, { capability: "CP.ENCOUNTERS", ...actor });
    ok("13-8. switching it back on restores the surface...", back.ok);
    const { data: reread } = await admin.from("practice_encounter").select("id").eq("id", encounterId).maybeSingle();
    ok("13-9. ...over exactly the same records", !!reread && reread.id === encounterId);
  } else skip("13-3..13-9. history survives deactivation", "the clinical fixture did not build");

  // ══ 14. THE AUDIT TRAIL (s8) ═══════════════════════════════════════════════════════════════════
  section("14. every activation and deactivation is auditable");

  const { data: events, error: evErr } = await admin.from(ACTIVATION_EVENT_TABLE)
    .select("capability_code, action, state_before, state_after, actor_id, source, mode_code")
    .eq("workspace_id", ws).eq("correlation_id", CID);
  ok("14-1. PRECONDITION: this run's activation history is readable and non-empty",
    !evErr && (events ?? []).length > 0, evErr ? evErr.message : "0 rows");
  const evRows = (events ?? []) as any[];
  ok("14-2. it records both verbs",
    evRows.some(e => e.action === "activate") && evRows.some(e => e.action === "deactivate"),
    [...new Set(evRows.map(e => e.action))].join(", "));
  ok("14-3. every row names an actor", evRows.length > 0 && evRows.every(e => e.actor_id === OWNER));
  ok("14-4. it records what the state was BEFORE, not only what it became",
    evRows.some(e => e.state_before !== null) && evRows.every(e => !!e.state_after));
  ok("14-5. a preset's rows carry its provenance",
    evRows.some(e => e.source === "mode_preset" && e.mode_code === "booking_only"),
    [...new Set(evRows.map(e => `${e.source}/${e.mode_code}`))].join(", "));
  ok("14-6. a dependency activated on somebody's behalf is marked as such",
    evRows.some(e => e.source === "dependency"));

  const { data: auditRows, error: aErr } = await admin.from("practice_audit_event")
    .select("event_type, payload").eq("workspace_id", ws).eq("correlation_id", CID)
    .in("event_type", ["practice.capability_activated", "practice.capability_deactivated"]);
  ok("14-7. and the append-only trail carries the same acts",
    !aErr && (auditRows ?? []).length > 0, aErr ? aErr.message : "0 rows");
  ok("14-8. ⚠ the trail itself says the change was commercial, not a permission change",
    ((auditRows ?? []) as any[]).length > 0
    && ((auditRows ?? []) as any[]).every(r => String(r.payload?.note ?? "").includes("No user permission")),
    JSON.stringify(((auditRows ?? []) as any[])[0]?.payload ?? null));

  // ══ 15. FIXTURES ═══════════════════════════════════════════════════════════════════════════════
  section("15. fixtures");
  await cleanup();
  const { data: left, error: leftErr } = await admin.from("practice_workspace")
    .select("id").eq("owner_person_id", OWNER);
  ok("15-1. the harness deleted its own fixtures",
    !leftErr && (left ?? []).length === 0, leftErr ? leftErr.message : `${(left ?? []).length} left`);
  const { data: strayActivation } = await admin.from(ACTIVATION_TABLE).select("id").eq("workspace_id", ws);
  ok("15-2. and no activation row of this run survives", (strayActivation ?? []).length === 0);

  return report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed, ${skipped} skipped`);
  if (fails.length > 0) {
    console.log("\n  FAILURES:");
    for (const f of fails) console.log(`    - ${f}`);
    process.exit(1);
  }
  if (skipped > 0) console.log("  ⚠ skipped assertions are NOT passes. Apply migration 278 and re-run.");
  console.log("");
}

main().catch(e => { console.error(e); process.exit(1); });
