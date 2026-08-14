/**
 * RAPID TREATMENT AND INVESTIGATION CAPTURE -- CPR-TREAT-001, CPR-INV-001, CINV-CAP-001, migration 275.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS EXISTS TO KEEP TRUE.
 *
 *   1. THE 45-SECOND CLAIM IS STRUCTURAL, NOT A STOPWATCH. The interaction count for the routine case is
 *      COUNTED OUT OF THE RENDERED MARKUP and asserted against a ceiling. A field added later that pushes
 *      the routine case past its budget fails a test rather than quietly costing ten seconds a patient.
 *   2. NO CLINICAL VOCABULARY IS HARD-CODED IN A COMPONENT. CPR-TREAT-001 s6 is a FROZEN REQUIREMENT.
 *      The scan strips comments first, and its CONTROL is the same scan over the migration, which must
 *      FIND the words -- otherwise the scan proves nothing.
 *   3. THE EXACT ENTERED WORDING OF A CUSTOM FREQUENCY SURVIVES INTO THE ENCOUNTER RECORD (s5, AC-02),
 *      read back out of the column rather than out of the engine's return value.
 *   4. A REPEATED INVESTIGATION IS NEVER MERGED (CPR-INV-001 s11). Two rows, two ids, two timestamps.
 *   5. NOTHING CLAIMS A TEST WAS PERFORMED OR A DRUG WAS ADMINISTERED. The rendered markup is scanned
 *      for the words that would say so, with a control proving the scanner can see them.
 *   6. NO FUNCTION ON A PAYLOAD HANDED TO A CLIENT COMPONENT. tsc passes, the API is fine, the page is
 *      dead. Both payloads are walked.
 *   7. EVERY REFUSAL IS PAIRED WITH A CONTROL. "Denied" passes just as loudly when the thing is deleted.
 *
 * ⚠ MIGRATION 275 IS APPLIED BY HAND. Until it is, the store-dependent half is reported as SKIPPED --
 * never as passed -- and the totals say so. A harness that counted an unrunnable assertion as green
 * would be the worst thing in this directory.
 *
 *   npx --yes tsx scripts/practice-treatment-investigation-harness.ts
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { encounterParameters } from "../src/lib/practice/parameters";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { registerPatient } from "../src/lib/practice/patients";
import { patientSnapshot, addAllergy, recordAllergyReview, setBloodGroup } from "../src/lib/practice/longitudinal";
import { launchEncounter, transitionEncounter } from "../src/lib/practice/encounters";
import { patientMedications } from "../src/lib/practice/medication";
import {
  investigationCatalogue, encounterInvestigations, addInvestigations, reviewInvestigations,
  cancelInvestigation, createCustomInvestigation, setInvestigationActivation,
  setInvestigationFavourite, saveInvestigationSet, setCaptureSetting, captureSettings,
} from "../src/lib/practice/investigations";
import {
  treatmentCapture, treatmentOptions, recordTreatmentBatch, setTreatmentOptionState,
  createTreatmentOption, saveTreatmentTemplate,
} from "../src/lib/practice/treatment-capture";
import {
  rankInvestigations, scoreInvestigation, INVESTIGATION_MATCH_SCORE, INVESTIGATION_BOUNDARY,
} from "../src/lib/practice/investigation-constants";
import { TREATMENT_BOUNDARY, OTHER_OPTION_CODE } from "../src/lib/practice/treatment-capture-constants";
import { allergyLine } from "../src/lib/practice/longitudinal-constants";
import InvestigationCapture from "../src/app/practice/(shell)/encounters/[encounterId]/InvestigationCapture";
import TreatmentCapture from "../src/app/practice/(shell)/encounters/[encounterId]/TreatmentCapture";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

/* eslint-disable @typescript-eslint/no-explicit-any */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

// ⚠ THE OWNER ID IS THIS HARNESS'S ALONE. Four other agents run harnesses against this database
// concurrently, and a shared owner id makes them purge each other's rows mid-run.
// HEX ONLY. The id first assigned to this harness ended "trt1", which is not a uuid at all -- t and r
// are not hex digits and Postgres refuses the literal outright. Twelve hex digits, still unique to this
// harness so that four concurrent agents cannot purge each other.
const OWNER = "00000000-0000-4000-8000-00000000fab1";
/**
 * ⚠ A SECOND TENANT NEEDS A SECOND OWNER, AND THE FIRST VERSION OF THIS HARNESS DID NOT KNOW THAT.
 *
 * runProvisioning REUSES an existing individual practice rather than minting a second one
 * (provisioning.ts lines 218-222: it looks up practice_workspace by owner_person_id and type
 * 'individual_practice' and returns the existing id). Competen Practice is a product for individual
 * practitioners, so that is correct product behaviour -- but it meant the "other workspace" in the
 * isolation check WAS THE FIRST WORKSPACE. The assertion compared a tenant against itself, saw its own
 * custom item, and reported a cross-tenant leak that did not exist. Had the custom item not been there
 * it would have passed while testing nothing at all, which is the worse of the two failures.
 *
 * Proven against the database rather than read off the source: two provisioning calls under one owner
 * returned one id, and a call under a different owner returned a different one.
 */
const OWNER_B = "00000000-0000-4000-8000-00000000fab2";
const CID = "harness-treatment-investigation";

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
 * ⚠ COMMENTS ARE STRIPPED BEFORE EVERY SCAN BELOW, AND EVERY NEGATIVE SCAN DEPENDS ON IT.
 *
 * These files explain in prose exactly which words they refuse to hard-code. A scan for "tablet" over
 * raw source would match the SENTENCE saying the component must not contain it, and pass whether or not
 * the string itself was gone -- an assertion that cannot fail is worse than no assertion.
 */
const src = (rel: string) => {
  const text = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
  return text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
};
const raw = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

const ENC_DIR = "src/app/practice/(shell)/encounters/[encounterId]";
const MIGRATION = "supabase/migrations/275-investigation-catalogue-and-treatment-configuration.sql";

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-trtinv-${suffix}-${Date.now()}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: CID,
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin,
    { id: req.id, target_user_id: user, correlation_id: CID, workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

/** Everything migration 275 adds that belongs to this harness's workspaces, in FK order. */
async function cleanup() {
  const { data: ws, error } = await admin.from("practice_workspace")
    .select("id").in("owner_person_id", [OWNER, OWNER_B]);
  // ⚠ A FAILED READ IS NOT AN EMPTY LIST. Reporting a purge that never happened is how the next run
  // fails with a wall of duplicate errors that read like an engine bug.
  if (error) { console.log(`  cleanup could not read workspaces: ${error.message}`); return; }
  for (const w of (ws ?? []) as { id: string }[]) {
    const { data: sets } = await admin.from("practice_investigation_set").select("id").eq("workspace_id", w.id);
    for (const s of (sets ?? []) as any[]) await admin.from("practice_investigation_set_item").delete().eq("set_id", s.id);
    const { data: tpls } = await admin.from("practice_treatment_template").select("id").eq("workspace_id", w.id);
    for (const t of (tpls ?? []) as any[]) await admin.from("practice_treatment_template_item").delete().eq("template_id", t.id);
    for (const table of [
      "practice_investigation_set", "practice_investigation_preference",
      "practice_investigation_activation", "practice_treatment_option_state",
      "practice_treatment_template", "practice_treatment_option",
      "practice_capture_setting", "practice_medication_catalogue",
      "practice_investigation_catalogue",
    ]) await admin.from(table).delete().eq("workspace_id", w.id);
    const { data: encs } = await admin.from("practice_encounter").select("id").eq("workspace_id", w.id);
    for (const e of (encs ?? []) as any[]) {
      await admin.from("practice_encounter_investigation").delete().eq("encounter_id", e.id);
      await admin.from("practice_encounter_status_history").delete().eq("encounter_id", e.id);
    }
    await admin.from("practice_medication_event").delete().eq("workspace_id", w.id);
    await admin.from("practice_medication_dose_calculation").delete().eq("workspace_id", w.id);
    await admin.from("practice_medication").delete().eq("workspace_id", w.id);
    await admin.from("practice_treatment").delete().eq("workspace_id", w.id);
    await admin.from("practice_encounter").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient_identifier").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient_contact").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient").delete().eq("workspace_id", w.id);
  }
  await admin.from("practice_practitioner_identity").delete().in("user_id", [OWNER, OWNER_B]);
  await purgeWorkspacesOwnedBy(admin, [OWNER, OWNER_B], { quiet: true });
}

/**
 * Renders a "use client" component to static markup.
 *
 * useRouter() throws outside a router, so a stub context is provided. It is a STUB AND NOTHING MORE --
 * nothing in these components navigates during render, and a harness that faked navigation would be
 * asserting over its own fiction.
 */
const routerStub = {
  push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {},
} as any;
const renderClient = (type: any, props: any) =>
  renderToStaticMarkup(React.createElement(
    AppRouterContext.Provider, { value: routerStub }, React.createElement(type, props)));

/** Counts controls tagged data-step="X" in a rendered markup string. */
const stepCount = (html: string, step: string) =>
  (html.match(new RegExp(`data-step="${step}"`, "g")) ?? []).length;

/** ⚠ Walks a payload for FUNCTIONS. One of these kills the page while tsc stays green. */
function functionPaths(value: unknown, at = "$", seen = new Set<unknown>(), out: string[] = []): string[] {
  if (typeof value === "function") { out.push(at); return out; }
  if (!value || typeof value !== "object") return out;
  if (seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) value.forEach((v, i) => functionPaths(v, `${at}[${i}]`, seen, out));
  else for (const [k, v] of Object.entries(value)) functionPaths(v, `${at}.${k}`, seen, out);
  return out;
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed, ${skipped} skipped`);
  if (skipped > 0) console.log("  ⚠ SKIPPED IS NOT PASSED. Apply migration 275 and re-run for the rest.");
  if (fails.length) { for (const f of fails) console.log(`   - ${f}`); process.exitCode = 1; }
}

async function main() {
  console.log("\nRapid treatment and investigation capture (CPR-TREAT-001, CPR-INV-001, CINV-CAP-001)\n");
  await cleanup();

  // ══ 0. IS MIGRATION 275 APPLIED? ═══════════════════════════════════════════════════════════════
  section("0. the store");
  const probes: [string, () => Promise<{ error: unknown }>][] = [
    ["practice_investigation_catalogue", async () => admin.from("practice_investigation_catalogue").select("id").limit(1)],
    ["practice_investigation_alias", async () => admin.from("practice_investigation_alias").select("id").limit(1)],
    ["practice_investigation_activation", async () => admin.from("practice_investigation_activation").select("id").limit(1)],
    ["practice_investigation_preference", async () => admin.from("practice_investigation_preference").select("id").limit(1)],
    ["practice_investigation_set", async () => admin.from("practice_investigation_set").select("id").limit(1)],
    ["practice_investigation_set_item", async () => admin.from("practice_investigation_set_item").select("id").limit(1)],
    ["practice_medication_catalogue", async () => admin.from("practice_medication_catalogue").select("id").limit(1)],
    ["practice_treatment_option", async () => admin.from("practice_treatment_option").select("id").limit(1)],
    ["practice_treatment_option_state", async () => admin.from("practice_treatment_option_state").select("id").limit(1)],
    ["practice_treatment_template", async () => admin.from("practice_treatment_template").select("id").limit(1)],
    ["practice_treatment_template_item", async () => admin.from("practice_treatment_template_item").select("id").limit(1)],
    ["practice_capture_setting", async () => admin.from("practice_capture_setting").select("id").limit(1)],
    ["practice_encounter_investigation.batch_id", async () => admin.from("practice_encounter_investigation").select("batch_id").limit(1)],
    ["practice_treatment.frequency_code", async () => admin.from("practice_treatment").select("frequency_code").limit(1)],
  ];
  const missing: string[] = [];
  for (const [name, probe] of probes) {
    const { error } = await probe();
    if (error) missing.push(name);
  }
  const migrated = missing.length === 0;
  ok("0-1. the presence probe can detect an absent table (control)",
    !!(await admin.from("practice_table_that_does_not_exist").select("id").limit(1)).error);
  if (migrated) ok("0-2. migration 275 is applied (all twelve tables and both added columns are present)", true);
  else skip("0-2. migration 275 is applied", `MISSING: ${missing.join(", ")} -- run ${MIGRATION}`);

  // ══ 1. THE MIGRATION FILE ITSELF ═══════════════════════════════════════════════════════════════
  //
  // ⚠ THE THREE TRAPS THAT HAVE ACTUALLY BITTEN THIS REPOSITORY. A semicolon inside a comment shredded
  // two sections of migration 238 while reporting success, a `--` inside a string literal did the same
  // elsewhere, and a non-ASCII byte breaks the owner's editor paste.
  section("1. migration 275 is safe to paste");
  const mig = raw(MIGRATION);
  const commentLines = mig.split("\n").filter(l => /^\s*--/.test(l));
  // ⚠ THE STATEMENT SCANS RUN OVER THE SQL WITH ITS COMMENTS STRIPPED, and the first version of this
  // harness proved why: the file's own prose says "no plpgsql" and "no double hyphen in a string", so
  // both scans matched the sentence describing the rule and reported the file unsafe. A scan that reads
  // a comment as code is the mirror image of one that reads a comment as evidence.
  const migStatements = mig.split("\n").filter(l => !/^\s*--/.test(l)).join("\n");
  ok("1-1. the comment scan is not vacuous (the file has comment lines)", commentLines.length > 50, `${commentLines.length}`);
  ok("1-2. NO SEMICOLON in any comment line", !commentLines.some(l => l.includes(";")),
    commentLines.filter(l => l.includes(";")).slice(0, 2).join(" | "));
  ok("1-3. no double hyphen inside a string literal",
    !/'[^']*--[^']*'/.test(migStatements));
  ok("1-3b. CONTROL: the same scan DOES catch a double hyphen in a literal",
    /'[^']*--[^']*'/.test("insert into t values ('a -- b');"));
  ok("1-4. ASCII only", !/[^\x00-\x7F]/.test(mig));
  ok("1-5. no plpgsql and no do-block (the runner splits on semicolons)",
    !/\bplpgsql\b/i.test(migStatements) && !/^\s*do\s*\$\$/im.test(migStatements));
  ok("1-5b. CONTROL: the same scan DOES catch a plpgsql body",
    /\bplpgsql\b/i.test("create function f() returns void language plpgsql as $ begin end $;"));
  ok("1-6. every new table has RLS enabled",
    (mig.match(/create table if not exists/g) ?? []).length
    === (mig.match(/enable row level security/g) ?? []).length,
    `${(mig.match(/create table if not exists/g) ?? []).length} tables vs ${(mig.match(/enable row level security/g) ?? []).length} rls`);
  ok("1-7. the schema reload is the LAST statement",
    mig.trimEnd().endsWith("notify pgrst, 'reload schema';"));

  // ══ 2. SEARCH AND RANKING -- CINV-CAP-001 s6 ═══════════════════════════════════════════════════
  //
  // ⚠ THE FUNCTION IS IMPORTED FROM THE MODULE THE SCREEN USES. A harness that re-implemented the
  // ranking would stay green under every break to the real one.
  section("2. search and ranking (CINV-CAP-001 s6)");
  const fbc = {
    id: "a", canonicalName: "Full Blood Count", shortName: "FBC", displayName: "Full Blood Count",
    category: "Laboratory", aliases: ["CBC", "Full Haemogram"],
  };
  const ct = {
    id: "b", canonicalName: "CT Brain", shortName: "CT Brain", displayName: "CT Brain",
    category: "Radiology", aliases: ["CT head", "Head CT"],
  };
  const ue = {
    id: "c", canonicalName: "Urea and Electrolytes", shortName: "U&E", displayName: "Urea and Electrolytes",
    category: "Laboratory", aliases: ["UEC", "Renal function"],
  };
  const fixture = [fbc, ct, ue];
  ok("2-1. the ranking fixture is not empty (the assertions below are not vacuous)", fixture.length === 3);
  ok("2-2. AC-02: FBC finds Full Blood Count, as an exact SHORT NAME match",
    scoreInvestigation(fbc, "FBC") === INVESTIGATION_MATCH_SCORE.exactShortName);
  ok("2-3. AC-02: CBC finds Full Blood Count, as an exact ALIAS match",
    scoreInvestigation(fbc, "CBC") === INVESTIGATION_MATCH_SCORE.exactAlias);
  ok("2-4. AC-03: \"CT head\" reaches CT Brain through its configured alias",
    rankInvestigations(fixture, "CT head")[0]?.id === "b");
  ok("2-5. punctuation and spacing are tolerated: \"u e\" and \"U&E\" reach the same item",
    scoreInvestigation(ue, "u e") === INVESTIGATION_MATCH_SCORE.exactShortName
    && scoreInvestigation(ue, "U&E") === INVESTIGATION_MATCH_SCORE.exactShortName);
  ok("2-6. an exact short name OUTRANKS a broad token match",
    INVESTIGATION_MATCH_SCORE.exactShortName > INVESTIGATION_MATCH_SCORE.token
    && rankInvestigations(fixture, "blood")[0]?.id === "a");
  ok("2-7. CONTROL: nonsense matches nothing", rankInvestigations(fixture, "zzqx").length === 0);
  ok("2-8. CONTROL: an empty query returns everything rather than nothing",
    rankInvestigations(fixture, "").length === 3);

  // ══ 3. NO CLINICAL VOCABULARY IN A COMPONENT -- CPR-TREAT-001 s6 (FROZEN) ══════════════════════
  section("3. the frozen no-code requirement");
  const treatSrc = src(`${ENC_DIR}/TreatmentCapture.tsx`);
  const invSrc = src(`${ENC_DIR}/InvestigationCapture.tsx`);
  // ⚠ THESE WORDS ARE READ OUT OF THE MIGRATION, NOT TYPED HERE. A list typed into the harness would
  // stop matching the seed the day somebody changed it, and the assertion would go quietly green.
  const seededOptionLabels = [...mig.matchAll(/\('(?:formulation|route|frequency|non_drug_category)', '[a-z_0-9]+', '([^']+)'/g)]
    .map(m => m[1]);
  ok("3-1. the seeded option labels were read out of the migration (not invented here)",
    seededOptionLabels.length > 30, `${seededOptionLabels.length}`);
  const leakedIntoTreatment = seededOptionLabels.filter(l => treatSrc.includes(l));
  ok("3-2. NOT ONE seeded clinical option label appears in TreatmentCapture.tsx",
    leakedIntoTreatment.length === 0, leakedIntoTreatment.slice(0, 5).join(", "));
  ok("3-3. CONTROL: the same scan DOES find those labels in the migration (the scan works)",
    seededOptionLabels.filter(l => mig.includes(l)).length === seededOptionLabels.length);

  const seededInvestigationNames = [...mig.matchAll(/\('(?:LAB|RAD|CAR|NEU|RESP|OTH)-[A-Z0-9-]+', '([^']+)'/g)].map(m => m[1]);
  ok("3-4. the seeded investigation names were read out of the migration",
    seededInvestigationNames.length > 50, `${seededInvestigationNames.length}`);
  const leakedIntoInv = seededInvestigationNames.filter(n => invSrc.includes(n));
  ok("3-5. NOT ONE seeded investigation name appears in InvestigationCapture.tsx",
    leakedIntoInv.length === 0, leakedIntoInv.slice(0, 5).join(", "));

  ok("3-6. the constants modules import NOTHING (so a client bundle stays clean)",
    !/^\s*import\s/m.test(raw("src/lib/practice/investigation-constants.ts"))
    && !/^\s*import\s/m.test(raw("src/lib/practice/treatment-capture-constants.ts")));
  ok("3-7. CONTROL: the same scan DOES see the imports in the engine modules",
    /^\s*import\s/m.test(raw("src/lib/practice/investigations.ts"))
    && /^\s*import\s/m.test(raw("src/lib/practice/treatment-capture.ts")));
  ok("3-8. both client components import the engines as TYPES ONLY",
    /import type \{[^}]*\} from "@\/lib\/practice\/investigations"/.test(invSrc)
    && !/^import \{[^}]*\} from "@\/lib\/practice\/investigations"/m.test(invSrc)
    && /import type \{[^}]*\} from "@\/lib\/practice\/treatment-capture"/.test(treatSrc)
    && !/^import \{[^}]*\} from "@\/lib\/practice\/treatment-capture"/m.test(treatSrc));
  ok("3-9. audit.ts still imports nothing", !/^\s*import\s/m.test(raw("src/lib/practice/audit.ts")));

  // ══ 4. THE OLD ONE-AT-A-TIME FORMS ARE GONE FROM THE TAB ══════════════════════════════════════
  section("4. the tabs are the new capture");
  const consoleSrc = src(`${ENC_DIR}/EncounterConsole.tsx`);
  ok("4-1. the encounter console no longer holds a per-item treatment form",
    !consoleSrc.includes("addTx") && !consoleSrc.includes("TREATMENT_TYPES"));
  ok("4-2. the encounter console no longer holds a per-item investigation form",
    !consoleSrc.includes("addInvestigation") && !consoleSrc.includes("setReviewSummary"));
  // ⚠ THIS CONTROL WENT RED FOR THE RIGHT REASON AND WAS LEFT RED, WHICH IS THE PART THAT MATTERED.
  // Its needle was `addDx`, the single-diagnosis form -- replaced by DiagnosisWorkspace, so the needle
  // stopped existing. 4-1 and 4-2 are NEGATIVE assertions: they pass against an empty string, a renamed
  // file or a mistyped path just as readily as against a console that genuinely dropped those forms.
  // The control is the only thing standing between them and passing for nothing, so while it was red
  // they were decorative. Repointed at a token this file cannot render without.
  ok("4-3. CONTROL: the same scan DOES still see live code in this file (the scan works)",
    consoleSrc.includes("props.treatmentCapture") && consoleSrc.length > 5000,
    `${consoleSrc.length} chars scanned -- if this is 0 the negatives above mean nothing`);
  ok("4-4. both tabs render the new capture components as slots",
    consoleSrc.includes("props.treatmentCapture") && consoleSrc.includes("props.investigationCapture"));
  const pageSrc = src(`${ENC_DIR}/page.tsx`);
  ok("4-5. the practitioner passed to the engines is the CALLER, never a value from the request body",
    /investigationCatalogue\(admin, shell\.ctx, shell\.ctx\.userId\)/.test(pageSrc)
    && /treatmentCapture\(admin, shell\.ctx, shell\.ctx\.userId\)/.test(pageSrc));
  const invRoute = src("src/app/api/v1/practice/investigation-capture/route.ts");
  ok("4-6. the favourite route writes the CALLER's preference, not a practitionerId from the body",
    /practitionerId: caller\.userId/.test(invRoute) && !/practitionerId: String\(body/.test(invRoute));

  // ══ THE LIVE HALF ══════════════════════════════════════════════════════════════════════════════
  section("5. a workspace, a patient and an encounter");
  const ws = await provision(OWNER, "HARNESS Treatment/Investigation (synthetic)", "a");
  const ctxRes = await resolveWorkspaceContext(admin, OWNER, ws);
  if (!ctxRes.ok) { ok("5-1. the workspace context resolves", false); return report(); }
  const ctx: WorkspaceContext = ctxRes.ctx;
  ok("5-1. the workspace context resolves", true);
  const base = { actorId: OWNER, correlationId: CID };

  const pat = await registerPatient(admin, {
    workspaceId: ws, displayName: "Kirabo Joan", birthDate: "2019-02-11", sex: "female",
    phone: "0772 555 411", ...base,
  });
  if (!pat.ok) { ok("5-2. a patient registers", false, pat.message); return report(); }
  const patientId = pat.data.id;
  ok("5-2. a patient registers", true);

  const launched = await launchEncounter(admin, {
    workspaceId: ws, patientId, pathway: "new_walk_in", reasonForVisit: "fever and cough", ...base,
  });
  if (!launched.ok) { ok("5-3. an encounter launches", false, launched.message); return report(); }
  const encounterId = launched.data.id;
  await transitionEncounter(admin, { workspaceId: ws, encounterId, to: "ACTIVE", ...base });
  ok("5-3. an encounter launches", true);

  // ══ 6. THE PAYLOADS ARE PLAIN DATA ════════════════════════════════════════════════════════════
  //
  // ⚠ RUNS WHETHER OR NOT 275 IS APPLIED, because both engines answer with a payload either way and
  // this is exactly the failure that survives tsc, eslint and every API test.
  section("6. the payloads a client component receives");
  const library = await investigationCatalogue(admin, ctx, OWNER);
  const capture = await treatmentCapture(admin, ctx, OWNER);
  const recordedInv = await encounterInvestigations(admin, ctx, encounterId);
  const medRecord = await patientMedications(admin, ctx, patientId);
  const snapshot = await patientSnapshot(admin, ctx, patientId);

  const libFns = functionPaths(library);
  const capFns = functionPaths(capture);
  ok("6-1. the walker can SEE a function (control)",
    functionPaths({ a: { b: [() => 1] } }).length === 1);
  ok("6-2. the investigation payload contains NO function", libFns.length === 0, libFns.join(", "));
  ok("6-3. the treatment payload contains NO function", capFns.length === 0, capFns.join(", "));
  ok("6-4. both payloads survive JSON round-tripping unchanged in shape",
    JSON.parse(JSON.stringify(library)).boundary === library.boundary
    && JSON.parse(JSON.stringify(capture)).boundary === capture.boundary);

  // ══ 7. THE 45-SECOND CLAIM, COUNTED ═══════════════════════════════════════════════════════════
  section("7. the interaction budget");
  // ⚠ THE PAYLOAD IS THE ENGINE'S OWN, with quick-add items forced on so the shortest path EXISTS to
  // be counted. The items are taken from what the catalogue actually returned; nothing is invented.
  //
  // ⚠ THE FOUR ITEMS ARE NOT INVENTED. When the catalogue is live they come from what the engine
  // actually returned. When migration 275 has not been applied yet they are PARSED OUT OF THE SEED IN
  // THE MIGRATION ITSELF -- the same rows that will exist the moment it runs -- so the interaction count
  // is measured against real data either way, and the assertion never quietly stops running.
  const seedRows = [...mig.matchAll(/\('((?:LAB|RAD|CAR|NEU|RESP|OTH)-[A-Z0-9-]+)', '([^']+)', '([^']+)', '([^']+)'/g)]
    .slice(0, 4)
    .map(m => ({
      id: m[1], code: m[1], canonicalName: m[2], shortName: m[3], displayName: m[2],
      category: m[4], subcategory: null, aliases: [] as string[],
      source: "platform" as const, enabled: true, renamed: false,
      favourite: true, usageCount: 0, lastUsedAt: null,
    }));
  const quickSource = library.selectable.length >= 4 ? library.selectable.slice(0, 4) : seedRows;
  const quickFrom = library.selectable.length >= 4 ? "the live catalogue" : "the seed in migration 275";
  const stagedLibrary = {
    ...library,
    selectable: library.selectable.length >= 4 ? library.selectable : quickSource,
    categories: library.categories.length > 0 ? library.categories : [...new Set(quickSource.map(i => i.category))],
    quickAdd: quickSource.map(item => ({ item, reason: "favourite" })),
  };
  ok("7-0. the four items the count below uses came from " + quickFrom, quickSource.length === 4,
    `${quickSource.length}`);
  if (quickSource.length === 4) {
    const invHtml = renderClient(InvestigationCapture, {
      encounterId, catalogue: stagedLibrary, recorded: recordedInv,
      canEdit: true, canConfigure: true, locked: false,
    });
    const quickTaps = stepCount(invHtml, "quick-add");
    const confirm = stepCount(invHtml, "confirm-add");
    ok("7-1. four quick-add chips are actually drawn (the count below is not vacuous)", quickTaps === 4, `${quickTaps}`);
    ok("7-2. AC-02: recording four investigations costs FOUR TAPS AND ONE CONFIRM, at most 6 interactions",
      quickTaps + confirm <= 6, `${quickTaps} + ${confirm}`);
    ok("7-3. there is exactly ONE confirm control, not one per investigation", confirm === 1, `${confirm}`);
    ok("7-4. AC-04: Quick Add requires no typing (the chips are buttons, not inputs)",
      !/data-step="quick-add"[^>]*<input/.test(invHtml));

    // ── The words that must and must not be on the screen ────────────────────────────────────────
    ok("7-5. AC-10: the boundary sentence is rendered", invHtml.includes(INVESTIGATION_BOUNDARY.slice(0, 60)));
    ok("7-6. AC-10: nothing on the tab says performed, completed, ordered or sent to a laboratory",
      !/\bperformed\b/i.test(stripBoundary(invHtml)) && !/\bordered\b/i.test(stripBoundary(invHtml)),
      "");
    // ⚠ THE CONTROL RUNS THROUGH THE SAME STRIPPING 7-6 DOES, or it proves nothing about 7-6. And it
    // uses a HEADING rather than a status word: the first version tested for "requested", which only
    // appears once a row exists, so it went red on an empty encounter -- exactly the vacuum it was
    // written to detect, caught in the right direction.
    ok("7-7. CONTROL: the same scan DOES find a word that is on the screen",
      /quick add/i.test(stripBoundary(invHtml)));
    // ⚠ 7-6 AND 7-8 BOTH STRIP TEXT BEFORE SCANNING -- the boundary paragraph SAYS "performed", and the
    // not-a-recommendation notice SAYS "recommendation". A stripper that removed too much would leave
    // two assertions that could never fail, so each one is followed by an injection that must be caught.
    ok("7-6b. CONTROL: the same scan CATCHES the forbidden word when it is injected",
      /\bperformed\b/i.test(stripBoundary(invHtml.replace("</section>", "<p>the test was performed</p></section>"))));
    ok("7-8. Quick Add is never labelled Recommended or Suggested",
      !/recommend/i.test(stripNotRecommendation(invHtml)) && !/suggest/i.test(stripNotRecommendation(invHtml)));
    ok("7-8b. CONTROL: the same scan CATCHES a Recommended heading when it is injected",
      /recommend/i.test(stripNotRecommendation(invHtml.replace("</section>", "<h4>Recommended</h4></section>"))));
  } else {
    skip("7-1..7-8. the interaction budget for investigations", "no four items could be resolved from the live catalogue OR from the seed");
  }

  // The treatment side: a template is ONE tap, and recording is one more.
  const stagedCapture = {
    ...capture,
    templates: {
      items: [{
        id: "t1", name: "Chest infection (adult)", ownerType: "practitioner", ownerId: OWNER,
        mine: true, version: 1,
        items: [{
          id: "i1", sortOrder: 0, treatmentType: "medication", label: "Amoxicillin",
          medicationRef: null, formulation: "Capsule", doseText: "500", doseUnit: "mg",
          route: "Oral", frequencyCode: "tds", frequencyText: "Three times a day (TDS)",
          durationText: "5 days", reason: null,
        }],
      }],
      permitted: true, unavailable: false, detail: null,
    },
  };
  const treatProps = {
    encounterId, patientId, capture: stagedCapture as any, medication: medRecord,
    recorded: [], canRecord: true, canPrescribe: true, locked: false,
    allergyLine: snapshot.allergies, allergyList: snapshot.allergyList,
    bloodGroupLine: snapshot.bloodGroup, canEditPatient: true,
    // ⚠ THE REAL COLLECTION FOR THIS ENCOUNTER, not a hand-built stub. The treatment cards derive their
    // vitals and alert chips from it with the same arithmetic SafetySnapshot uses, and a stub would let
    // the two drift apart while this stayed green. When the prop was added the render CRASHED here
    // rather than degrading quietly, which is the failure worth having.
    collection: await encounterParameters(admin, ctx, encounterId),
  };
  const treatHtml = renderClient(TreatmentCapture, treatProps);
  const templateTaps = stepCount(treatHtml, "apply-template");
  const recordTaps = stepCount(treatHtml, "record-batch");
  ok("7-9. a template chip is drawn (the count below is not vacuous)", templateTaps === 1, `${templateTaps}`);
  ok("7-10. prescribing a saved template costs TWO interactions: apply, then record",
    templateTaps + recordTaps === 2, `${templateTaps} + ${recordTaps}`);
  ok("7-11. there is exactly ONE record control for the whole plan (s9: no Record per medication)",
    recordTaps === 1, `${recordTaps}`);

  // ── THE OWNER'S "IT DOES NOT SEEM TO RECORD", GUARDED (2026-08-13) ────────────────────────────────
  //
  // ⚠ SOURCE-LEVEL, AND I AM SAYING SO. renderClient draws the component's INITIAL state, where the
  // draft is empty and the plan is empty -- the one combination in which the button is correctly
  // disabled either way. The defect lived in a state only typing can reach, so these three read the
  // source instead of the markup. They are weaker than the behavioural guards above; they are here
  // because the alternative was no guard at all on a defect the owner had to find by hand.
  const capSrc = src(`${ENC_DIR}/TreatmentCapture.tsx`);
  ok("7-11b. the record control is enabled by what it will WRITE, not by the plan alone",
    /disabled=\{busy \|\| recordCount === 0\}/.test(capSrc) && !/disabled=\{busy \|\| plan\.length === 0\}/.test(capSrc),
    "a finished draft with an empty plan left this disabled, and a disabled button cannot say why");
  ok("7-11c. recording submits the started draft ALONGSIDE the plan",
    /const submitted = pending \? \[\.\.\.plan, pending\] : plan/.test(capSrc)
      && /items: submitted/.test(capSrc) && !/action: "record"[\s\S]{0,80}items: plan\b/.test(capSrc),
    "posting `plan` alone silently drops the treatment on screen in front of the practitioner");
  ok("7-11d. a refused add does not delete the draft it refused",
    /if \(addToPlan\(item\)\) clearDraft\(\)/.test(capSrc),
    "clearing unconditionally answers `the plan is full` by erasing what the practitioner typed");
  ok("7-12. the treatment boundary sentence is rendered", treatHtml.includes(TREATMENT_BOUNDARY.slice(0, 60)));
  // ⚠ THE TWO SENTENCES ARE GENERATED BY THE ENGINE'S OWN FUNCTION, not typed here. allergyLine() is
  // what longitudinal-constants.ts calls the most safety-critical function in this build, and a harness
  // holding its own copy of those words would stay green the day somebody changed them.
  const unresolvedSentence = allergyLine({ status: null, count: 0, unavailable: false }).text;
  const reassuringSentence = allergyLine({ status: "none_known", count: 0, unavailable: false }).text;
  ok("7-13a. the two sentences differ (the assertions below are not vacuous)",
    unresolvedSentence !== reassuringSentence && reassuringSentence.length > 0);
  ok("7-13b. AC-08: with nobody having answered, the strip prints the UNRESOLVED sentence",
    snapshot.allergies.safeToRead || treatHtml.includes(unresolvedSentence),
    `tone=${snapshot.allergies.tone}`);
  ok("7-14. the nine deferred checks are on the prescribing surface",
    medRecord.notChecked.length > 0 && treatHtml.includes(medRecord.notChecked[0].label));
  ok("7-15. CONTROL: notChecked is not an empty list", medRecord.notChecked.length >= 5, `${medRecord.notChecked.length}`);

  // ── CPR-TRT-UI-002 s8 AND s21: A QUICK SET, AND EVERYTHING ELSE ONE TAP AWAY ────────────────────
  //
  // ⚠ THE CONTROL COMES FIRST AND IT IS NOT DECORATION. If this practice happened to configure fewer
  // frequencies than the quick set draws, "not all of them are drawn" would be trivially false and
  // "there is a more button" trivially absent -- both assertions would report on a list too short to
  // fold, which is indistinguishable from a composer that never folds anything.
  const freqOpts = ((stagedCapture as any).options?.byField?.frequency ?? []) as any[];
  const freqChips = stepCount(treatHtml, "frequency");
  // ── CP-TREAT-002: A DOSE CARRIES ITS UNIT, AND A NON-DRUG CLAIMS NO DRUG SAFETY ─────────────────
  //
  // ⚠ THE UNIT WAS MISSING FOR MONTHS AND NOTHING SAID SO. dose_unit has existed on practice_treatment
  // since migration 275; getEncounter simply never selected it, so a 3 mg tablet rendered as "3". The
  // record held the answer and the screen could not show it. Guarded at the QUERY, because that is
  // where it was lost -- a component assertion would have passed the whole time.
  const capSrcTreat = src(`${ENC_DIR}/TreatmentCapture.tsx`);
  const encSrc = src("src/lib/practice/encounters.ts");
  const treatSelect = encSrc.match(/from\("practice_treatment"\)\.select\("([^"]+)"\)/)?.[1] ?? "";
  ok("7-23. the encounter reads dose_unit, so a dose can be drawn with its unit",
    /\bdose_unit\b/.test(treatSelect), `selected: ${treatSelect || "(query not found)"}`);
  ok("7-23-control. the same scan found a real select list (7-23 is not passing on an empty string)",
    treatSelect.includes("dose") && treatSelect.length > 30, `${treatSelect.length} chars`);
  ok("7-24. and the screen joins the unit to the dose rather than dropping it",
    /t\.dose, t\.dose_unit/.test(capSrcTreat));
  // ⚠ CP-TREAT-002 s7: "Do not falsely present medication safety checks as having been performed for
  // non-medication treatment types." Every row used to carry the allergy line, so a wound dressing
  // read as though a medication check had been considered for it.
  ok("7-25. the Safety column is drawn for medication rows only",
    /treatment_type !== "medication"/.test(capSrcTreat));

  // ── CP-TREAT-002 s5 AND s6: THE TYPE SELECTOR, AND FORMS THAT FIT THEIR TYPE ────────────────────
  //
  // ⚠ THE SAME QUERY-LEVEL TRAP AS dose_unit, CHECKED THE SAME WAY. A form that captures a detail into
  // a column nobody selects is a field that swallows what a practitioner typed -- it saves, and the
  // record never shows it again. non_drug_category is what every non-medication type writes to.
  ok("7-26. the encounter reads the column the type-specific detail is stored in",
    /\bnon_drug_category\b/.test(treatSelect), `selected: ${treatSelect}`);
  ok("7-27. s11: changing type warns before discarding fields that do not carry over",
    /const changeType/.test(capSrcTreat) && /window\.confirm/.test(capSrcTreat));
  // ⚠ AND THE BLANKING ITSELF, which is the rule that matters more than the warning: a dose typed under
  // Medication must not ride into a diet plan and be recorded there invisibly.
  ok("7-28. and it blanks everything except the name and reason",
    /blankDraft\(code\), label: d\.label, reason: d\.reason/.test(capSrcTreat));
  // s6: every non-medication type gets a schedule. Before this it had nowhere to put "daily for 5 days".
  ok("7-29. non-medication types can carry a frequency and duration",
    /!shape\.prescribing && shape\.needsSchedule/.test(capSrcTreat));

  // ── s19's EDIT AND REMOVE EXIST BEHIND THE COMP'S CONTROLS ──────────────────────────────────────
  //
  // ⚠ THE POINT IS THAT THE ENGINE EXISTS, NOT THAT THE ICON DOES. The comp draws a pencil and a menu
  // on every card; there was no correction or withdrawal path for a treatment at all until this change.
  // An icon wired to nothing is the defect this codebase keeps finding, so the guard is on the pair.
  const engineSrc = src("src/lib/practice/treatment-capture.ts");
  ok("7-19. the card's Correct and Withdraw controls are drawn",
    stepCount(treatHtml, "edit-treatment") >= 0 && /data-step="edit-treatment"/.test(capSrcTreat)
      && /data-step="withdraw-treatment"/.test(capSrcTreat));
  ok("7-20. and BOTH have an engine behind them, not just an icon",
    /export async function updateEncounterTreatment/.test(engineSrc)
      && /export async function removeEncounterTreatment/.test(engineSrc));
  // ⚠ A SIGNED ENCOUNTER IS SOMETHING SOMEBODY PUT THEIR NAME TO. Both verbs refuse it by name rather
  // than silently succeeding, which is the same rule the diagnosis pair follows one tab away.
  ok("7-21. both refuse a SIGNED encounter by name",
    (engineSrc.match(/ENCOUNTER_SIGNED/g) ?? []).length >= 2,
    `${(engineSrc.match(/ENCOUNTER_SIGNED/g) ?? []).length} refusal(s)`);
  // ⚠ AND WITHDRAWING THE NOTE MUST NOT SILENTLY DELETE THE LONGITUDINAL MEDICATION. The engine reports
  // whether one survived so the screen can say so; a partial deletion nobody is told about leaves
  // evidence in a place the practitioner is not looking.
  // ⚠ THE FLAG MUST BE DERIVED, NOT DECLARED. The first version of this tested for the WORD
  // `medicationKept`, and its break-test did not redden: hardcoding the value to false left the type
  // signature still carrying the name, so the assertion passed against an engine that had stopped
  // reporting the thing it is named after. Same shape as the ui-2 weakness -- a needle that matches a
  // declaration proves nothing about behaviour.
  // ⚠ COUNTED, BECAUSE IT IS REPORTED IN TWO PLACES AND BOTH MATTER: the value returned to the screen,
  // and the audit payload. This took THREE attempts to get right, each failure the same shape as ui-2.
  // First it tested for the WORD `medicationKept` -- the type signature carries that, so hardcoding the
  // value to false still passed. Then it tested the derivation with .test() -- which matched the AUDIT
  // line while the RETURN was broken. An assertion over two call sites has to count them.
  const keptDerived = (engineSrc.match(/medicationKept: !!row\.medication_ref/g) ?? []).length;
  ok("7-22. withdrawal reports the surviving medication to BOTH the screen and the audit log",
    keptDerived >= 2 && /medicationKept/.test(capSrcTreat),
    `${keptDerived} of 2 derived from the row`);

  ok("7-16-control. the fixture configures more frequencies than the quick set draws",
    freqOpts.length > 5, `${freqOpts.length} configured`);
  // ⚠ REPOINTED WHEN THE CHIPS BECAME A DROPDOWN, AND THE GUARANTEE GOT STRONGER RATHER THAN WEAKER.
  // These asserted "a quick set is drawn" and "a `N more` control exists" -- both descriptions of the
  // chip implementation. The comp uses a select, so the old wording described a control that no longer
  // exists. The PROPERTY was always s21's: every configured value reachable within one additional
  // interaction. 7-17 now checks every single configured frequency is actually present, which the
  // "there is a more button" version never did -- that one would have passed with the button wired to
  // an empty list.
  ok("7-16. s8: frequency is ONE compact control, not a row of chips per configured value",
    freqChips === 1, `${freqChips} control(s) for ${freqOpts.length} configured values`);
  ok("7-17. s21: EVERY configured frequency is inside it, one interaction away",
    freqOpts.every(o => treatHtml.includes(`>${o.label}<`)),
    freqOpts.filter(o => !treatHtml.includes(`>${o.label}<`)).map(o => o.label).join(", ") || "all present");
  // ⚠ THE CUSTOM-WORDING OPTION IS NOT BEHIND THE DISCLOSURE. It opens the free-text frequency s5
  // requires, and putting the ordinary act of writing "every other day" behind an extra tap would be a
  // regression dressed as tidying. Asserted by LABEL from the fixture, not by a string typed here.
  const otherOpt = freqOpts.find(o => o.code === "other");
  ok("7-18. the configured Other frequency is drawn without opening the disclosure",
    !otherOpt || treatHtml.includes(`>${otherOpt.label}<`), `${otherOpt?.label ?? "no other option configured"}`);

  // ══ 7b. THE ALLERGY DEAD END, CLOSED ══════════════════════════════════════════════════════════
  //
  // ⚠ THE STORE, THE ENGINE AND THE ROUTE ALL EXISTED SINCE MIGRATION 238 AND NOTHING CALLED THEM.
  // The screen said "nobody has asked" and offered no way to answer, on the field that matters most
  // during prescribing. "No action without a store" cuts both ways: a store with no action is the same
  // dead end from the other side.
  section("7b. the allergy answer and the blood group");

  const callsAllergyEndpoint = (text: string) =>
    /encounters\/record\/\$\{props\.patientId\}\/allergies/.test(text);
  ok("7b-1. the Treatment tab CALLS the existing allergy endpoint", callsAllergyEndpoint(treatSrc));
  // ⚠ THE DELIBERATE BREAK, RUN INSIDE THE HARNESS. The same predicate over the same source with the
  // call removed must go RED, which is what proves 7b-1 can fail at all.
  ok("7b-2. CONTROL: the same predicate FAILS when the call is removed from the source",
    !callsAllergyEndpoint(treatSrc.replace(/encounters\/record\/\$\{props\.patientId\}\/allergies/g, "REMOVED")));
  ok("7b-3. both verbs are used: POST adds an allergy, PUT records the answer",
    /"POST"/.test(treatSrc) && /"PUT"/.test(treatSrc));
  ok("7b-4. the certainty default is \"suspected\", never \"confirmed\"",
    /certainty: "suspected"/.test(treatSrc) && !/certainty: "confirmed"/.test(treatSrc));
  ok("7b-5. no new store, engine, route or capability was invented for this",
    !fs.existsSync("src/app/api/v1/practice/allergies")
    && !/practice_patient_allergy/.test(treatSrc)
    && !/allergy\.(record|manage)/.test(treatSrc));

  ok("7b-6. the strip draws both of s10's quick actions",
    stepCount(treatHtml, "nkda") === 1 && stepCount(treatHtml, "record-allergy") === 1,
    `nkda=${stepCount(treatHtml, "nkda")} record=${stepCount(treatHtml, "record-allergy")}`);
  ok("7b-7. answering the common case is ONE tap", stepCount(treatHtml, "nkda") === 1);
  ok("7b-8. the blood group control is NOT a permanent second control on the strip",
    stepCount(treatHtml, "blood-group") === 0,
    "the 45-second flow outranks the field: it lives inside the panel Record allergy opens");
  ok("7b-9. CONTROL: the blood group control DOES appear once the panel is open",
    renderClient(TreatmentCapture, treatProps).length > 0
    && raw(`${ENC_DIR}/TreatmentCapture.tsx`).includes('data-step="blood-group"'));
  ok("7b-10. the blood group LINE is readable without opening anything",
    treatHtml.includes(snapshot.bloodGroup.text));

  // ⚠ THE SAFETY RULE, RENDERED. The reassuring sentence comes only from the engine's SafetyLine.
  ok("7b-11. the strip prints the engine's own allergy sentence, not one composed on the screen",
    treatHtml.includes(snapshot.allergies.text));
  // ⚠ THE BUTTON LABEL IS NOT THE STATEMENT, AND THE TWO MUST NOT BE CONFLATED. "No known drug
  // allergies" is an ACTION offering to answer the question. "No known allergies" is the engine's
  // reassuring SENTENCE, and it may appear only once somebody has answered. The assertion is on the
  // engine's own string, so it cannot be satisfied or broken by a button label.
  ok("7b-12. an unanswered patient never shows the engine's REASSURING sentence",
    snapshot.allergies.safeToRead || !treatHtml.includes(reassuringSentence),
    `tone=${snapshot.allergies.tone}`);
  const answeredHtml = renderClient(TreatmentCapture, {
    ...treatProps,
    allergyLine: allergyLine({ status: "none_known", count: 0, unavailable: false, reviewedAt: null }),
  });
  ok("7b-12b. CONTROL: once somebody HAS answered, the reassuring sentence does render",
    answeredHtml.includes(reassuringSentence));

  // ── The engine's own rules, live ────────────────────────────────────────────────────────────────
  const answered = await recordAllergyReview(admin, ctx, { patientId, status: "none_known", ...base });
  ok("7b-13. the answer records", answered.ok, answered.ok ? "" : answered.message);
  const afterAnswer = await patientSnapshot(admin, ctx, patientId);
  ok("7b-14. and ONLY THEN does the line become safe to read",
    afterAnswer.allergies.safeToRead && afterAnswer.allergies.tone === "none");
  const { data: stamped } = await admin.from("practice_patient")
    .select("allergy_status, allergy_reviewed_at, allergy_reviewed_by").eq("id", patientId).single();
  ok("7b-15. the answer carries WHO said it and WHEN",
    stamped?.allergy_status === "none_known" && !!stamped?.allergy_reviewed_at
    && stamped?.allergy_reviewed_by === OWNER);

  const allergyAdded = await addAllergy(admin, ctx, {
    patientId, substance: "Penicillin", reaction: "widespread rash", severity: "moderate", ...base,
  });
  ok("7b-16. an allergy records through the existing engine", allergyAdded.ok, allergyAdded.ok ? "" : allergyAdded.message);
  const { data: allergyRow } = await admin.from("practice_patient_allergy")
    .select("certainty, severity, substance").eq("patient_id", patientId).maybeSingle();
  ok("7b-17. the certainty defaults to suspected, which is the honest default for something reported",
    allergyRow?.certainty === "suspected", JSON.stringify(allergyRow?.certainty));

  const contradicted = await recordAllergyReview(admin, ctx, { patientId, status: "none_known", ...base });
  ok("7b-18. ⚠ none_known is REFUSED while an allergy is listed",
    !contradicted.ok && contradicted.code === "ALLERGIES_LISTED",
    contradicted.ok ? "was allowed" : contradicted.code);
  ok("7b-19. CONTROL: the same call succeeded before the allergy existed (7b-13 above)", answered.ok);
  ok("7b-20. the screen does not offer the button in the state the engine refuses",
    /allergyList\.items\.filter\(a => a\.certainty !== "refuted"\)\.length === 0/.test(treatSrc));

  const blood = await setBloodGroup(admin, ctx, { patientId, bloodGroup: "O+", ...base });
  ok("7b-21. the blood group records through the same endpoint's engine", blood.ok, blood.ok ? "" : blood.message);
  const badBlood = await setBloodGroup(admin, ctx, { patientId, bloodGroup: "Z-", ...base });
  ok("7b-22. CONTROL: an invented blood group is refused",
    !badBlood.ok && badBlood.code === "VALIDATION_ERROR");
  const afterBlood = await patientSnapshot(admin, ctx, patientId);
  ok("7b-23. and the snapshot line changes to the recorded value",
    afterBlood.bloodGroup.text.includes("O+"), afterBlood.bloodGroup.text);

  if (!migrated) {
    section("8+. everything below needs migration 275");
    for (const label of [
      "8. batch add and duplicates", "9. batch review and not-pursued", "10. the catalogue is configurable",
      "11. the treatment batch and the custom frequency", "12. option configuration", "13. capability refusals",
    ]) skip(label, `run ${MIGRATION} and re-run this harness`);
    await cleanup();
    const { data: left } = await admin.from("practice_workspace")
      .select("id").in("owner_person_id", [OWNER, OWNER_B]);
    ok("14-1. the harness deleted its own fixtures, for BOTH tenants", (left ?? []).length === 0, `${(left ?? []).length} left`);
    return report();
  }

  // ══ 8. BATCH ADD AND DUPLICATE HANDLING ═══════════════════════════════════════════════════════
  section("8. batch add and duplicates (CPR-INV-001 s2, s5, s11)");
  const four = library.selectable.slice(0, 4);
  ok("8-1. the catalogue returned at least four selectable items (not vacuous)", four.length === 4, `${four.length}`);

  const added = await addInvestigations(admin, ctx, {
    encounterId, items: four.map(i => ({ investigationId: i.id })),
    reasonShared: "febrile child, source unclear", ...base,
  });
  ok("8-2. AC-01/AC-02: four investigations are recorded in ONE call",
    added.ok && added.data.recorded === 4, added.ok ? `${added.data.recorded}` : added.message);

  const afterAdd = await encounterInvestigations(admin, ctx, encounterId);
  ok("8-3. the four rows are on the encounter", afterAdd.items.length === 4, `${afterAdd.items.length}`);
  ok("8-4. every row carries the SAME batch id, so the batch is auditable as one act",
    new Set(afterAdd.items.map(i => i.batchId)).size === 1);
  ok("8-5. AC-06: the shared reason reached every item without being retyped",
    afterAdd.items.every(i => i.reasonShared === "febrile child, source unclear"));
  ok("8-6. s7: the display name was SNAPSHOTTED onto each row",
    afterAdd.items.every(i => !!i.displayNameSnapshot));

  const dupe = await addInvestigations(admin, ctx, { encounterId, items: [{ investigationId: four[0].id }], ...base });
  ok("8-7. a duplicate is refused with a WARNING rather than written silently",
    dupe.ok && dupe.data.recorded === 0 && dupe.data.results[0]?.code === "DUPLICATE_WARNING",
    dupe.ok ? JSON.stringify(dupe.data.results[0]) : dupe.message);

  const again = await addInvestigations(admin, ctx, {
    encounterId, items: [{ investigationId: four[0].id }], allowDuplicate: [0], ...base,
  });
  const { data: repeats } = await admin.from("practice_encounter_investigation")
    .select("id").eq("encounter_id", encounterId).eq("investigation_id", four[0].id);
  ok("8-8. CONTROL + AC-09: an explicit Add again writes a SECOND row and never merges the first",
    again.ok && again.data.recorded === 1 && (repeats ?? []).length === 2,
    `${(repeats ?? []).length} rows`);

  const missingLabel = await addInvestigations(admin, ctx, { encounterId, items: [{ label: "   " }], ...base });
  ok("8-9. an unnamed item is refused per-item, not by discarding the batch",
    missingLabel.ok && missingLabel.data.results[0]?.code === "VALIDATION_ERROR");

  // s6's configurable requirement.
  await setCaptureSetting(admin, ctx, { key: "investigation_reason_required", value: "true", ...base });
  const noReason = await addInvestigations(admin, ctx, {
    encounterId, items: [{ investigationId: library.selectable[5].id }], ...base,
  });
  ok("8-10. with the practice setting on, a batch with no clinical question is refused",
    !noReason.ok && noReason.code === "REASON_REQUIRED", noReason.ok ? "was allowed" : noReason.code);
  const withReason = await addInvestigations(admin, ctx, {
    encounterId, items: [{ investigationId: library.selectable[5].id }], reasonShared: "rule out anaemia", ...base,
  });
  ok("8-11. CONTROL: the same batch WITH a reason is accepted",
    withReason.ok && withReason.data.recorded === 1, withReason.ok ? "" : withReason.message);
  await setCaptureSetting(admin, ctx, { key: "investigation_reason_required", value: "false", ...base });
  const settingsBack = await captureSettings(admin, ctx.workspaceId);
  ok("8-12. the setting round-trips through the store", settingsBack.investigationReasonRequired === false);

  // ══ 9. BATCH REVIEW, AND NOT PURSUED ══════════════════════════════════════════════════════════
  section("9. batch review and not pursued (CPR-INV-001 s8, s9)");
  const openIds = (await encounterInvestigations(admin, ctx, encounterId)).items
    .filter(i => i.status === "requested").map(i => i.id).slice(0, 3);
  ok("9-1. there are three requested rows to review (not vacuous)", openIds.length === 3, `${openIds.length}`);
  const reviewed = await reviewInvestigations(admin, ctx, { encounterId, investigationIds: openIds, ...base });
  ok("9-2. AC-07: a batch review marks all three in one call",
    reviewed.ok && reviewed.data.reviewed.length === 3, reviewed.ok ? `${reviewed.data.reviewed.length}` : reviewed.message);
  const { data: reviewedRows } = await admin.from("practice_encounter_investigation")
    .select("status, reviewed_at, reviewed_by").in("id", openIds);
  ok("9-3. s9: one shared timestamp and the reviewing user on every row",
    new Set((reviewedRows ?? []).map((r: any) => r.reviewed_at)).size === 1
    && (reviewedRows ?? []).every((r: any) => r.status === "reviewed" && r.reviewed_by === OWNER));

  const stillOpen = (await encounterInvestigations(admin, ctx, encounterId)).items.find(i => i.status === "requested");
  const noWhy = await cancelInvestigation(admin, ctx, {
    encounterId, investigationId: stillOpen!.id, reason: "  ", ...base,
  });
  ok("9-4. not pursued with no reason is refused", !noWhy.ok && noWhy.code === "VALIDATION_ERROR");
  const cancelled = await cancelInvestigation(admin, ctx, {
    encounterId, investigationId: stillOpen!.id, reason: "family declined the test", ...base,
  });
  ok("9-5. CONTROL: not pursued WITH a reason is accepted", cancelled.ok, cancelled.ok ? "" : cancelled.message);
  const { data: cancelledRow } = await admin.from("practice_encounter_investigation")
    .select("status, cancelled_at, cancelled_reason").eq("id", stillOpen!.id).single();
  ok("9-6. the third status is stored with its time and its reason",
    cancelledRow?.status === "cancelled" && !!cancelledRow?.cancelled_at
    && cancelledRow?.cancelled_reason === "family declined the test");
  const { error: noResultCol } = await admin.from("practice_encounter_investigation").select("result").limit(1);
  ok("9-7. ⚠ THERE IS STILL NO RESULT COLUMN, and 275 did not add one", !!noResultCol);

  // ══ 10. THE CATALOGUE IS CONFIGURABLE -- CINV-CAP-001 s5, s7, s8 ═══════════════════════════════
  section("10. the catalogue is configurable");
  const custom = await createCustomInvestigation(admin, ctx, {
    canonicalName: "Bedside ultrasound for free fluid", shortName: "eFAST",
    category: "Other diagnostics", aliases: ["FAST scan"], ...base,
  });
  ok("10-1. AC-03: a custom investigation is created", custom.ok, custom.ok ? "" : custom.message);
  const afterCustom = await investigationCatalogue(admin, ctx, OWNER);
  ok("10-2. AC-03: it is IMMEDIATELY selectable",
    custom.ok && afterCustom.selectable.some(i => i.id === custom.data.id));
  ok("10-3. its alias is searchable straight away",
    custom.ok && rankInvestigations(afterCustom.selectable, "FAST scan").some(i => i.id === custom.data.id));
  ok("10-4. the generated code is this practice's, not a name somebody typed",
    custom.ok && custom.data.code.startsWith("CUS-"));

  const target = afterCustom.selectable.find(i => i.source === "platform")!;
  await setInvestigationActivation(admin, ctx, { investigationId: target.id, enabled: false, ...base });
  const afterOff = await investigationCatalogue(admin, ctx, OWNER);
  ok("10-5. AC-01: a disabled item leaves the picker",
    !afterOff.selectable.some(i => i.id === target.id));
  ok("10-6. and it is still in the full list, so Setup can switch it back on",
    afterOff.all.some(i => i.id === target.id && !i.enabled));
  const { data: masterRow } = await admin.from("practice_investigation_catalogue")
    .select("active, canonical_name").eq("id", target.id).single();
  ok("10-7. ⚠ THE MASTER ROW WAS NOT TOUCHED (s5: a platform update cannot overwrite local state)",
    masterRow?.active === true && masterRow?.canonical_name === target.canonicalName);

  await setInvestigationActivation(admin, ctx, {
    investigationId: target.id, enabled: true, localDisplayName: "Bloods (routine)", ...base,
  });
  const afterRename = await investigationCatalogue(admin, ctx, OWNER);
  const renamed = afterRename.all.find(i => i.id === target.id)!;
  ok("10-8. AC-06: a local rename changes the display name and NOT the canonical one",
    renamed.displayName === "Bloods (routine)" && renamed.canonicalName === target.canonicalName);
  ok("10-9. the local name is searchable", rankInvestigations(afterRename.selectable, "Bloods").some(i => i.id === target.id));

  await setInvestigationFavourite(admin, ctx, { investigationId: target.id, favourite: true, practitionerId: OWNER, ...base });
  const afterPin = await investigationCatalogue(admin, ctx, OWNER);
  const pinned = afterPin.quickAdd.find(q => q.item.id === target.id);
  ok("10-10. AC-04: a pinned item appears on Quick Add", !!pinned);
  ok("10-11. s11: Quick Add says WHY the item is there", pinned?.reason === "favourite");
  ok("10-12. usage is observed from what was actually recorded, not curated",
    afterPin.all.some(i => i.usageCount > 0));

  const savedSet = await saveInvestigationSet(admin, ctx, {
    name: "Febrile child", ownerType: "practitioner", practitionerId: OWNER,
    investigationIds: four.map(i => i.id), ...base,
  });
  ok("10-13. AC-04/AC-05: a personal set is saved with its four items",
    savedSet.ok && savedSet.data.items === 4, savedSet.ok ? "" : savedSet.message);
  const afterSet = await investigationCatalogue(admin, ctx, OWNER);
  ok("10-14. the set comes back with its ids, resolvable to catalogue items",
    afterSet.sets.some(s => s.name === "Febrile child" && s.itemIds.length === 4));

  // ══ 11. THE TREATMENT BATCH AND THE CUSTOM FREQUENCY ══════════════════════════════════════════
  section("11. the treatment batch (CPR-TREAT-001 s5, s9, s15)");
  const CUSTOM_FREQUENCY = "every other day, with food, until the swelling settles";
  const batch = await recordTreatmentBatch(admin, ctx, {
    encounterId,
    items: [
      {
        treatmentType: "medication", label: "Amoxicillin", formulation: "Capsule",
        dose: "500", doseUnit: "mg", route: "Oral", frequencyCode: "tds",
        frequencyText: "Three times a day (TDS)", frequencyPerDay: 3, duration: "5 days",
        reason: "chest infection",
      },
      {
        treatmentType: "medication", label: "Prednisolone", formulation: "Tablet",
        dose: "20", doseUnit: "mg", route: "Oral",
        // ⚠ THE ONE THAT MATTERS. s5 and AC-02.
        frequencyCode: OTHER_OPTION_CODE, frequencyText: CUSTOM_FREQUENCY, duration: "7 days",
      },
      { treatmentType: "non_drug", label: "Daily wound dressing", nonDrugCategory: "wound_care" },
      { treatmentType: "no_change", label: "Continue current antiepileptic unchanged" },
      { treatmentType: "", label: "Nothing chosen" },
    ],
    ...base,
  });
  ok("11-1. AC-06: four treatments are recorded in ONE call",
    batch.ok && batch.data.recorded === 4, batch.ok ? `${batch.data.recorded}` : batch.message);
  ok("11-2. s15: the fifth comes back REFUSED rather than being silently dropped",
    batch.ok && batch.data.results.length === 5 && batch.data.results[4].ok === false
    && batch.data.results[4].code === "VALIDATION_ERROR");
  ok("11-3. s9: every recorded row carries the same batch id",
    batch.ok && new Set(batch.data.results.filter(r => r.ok).map(r => r.treatmentId)).size === 4);

  const { data: txRows } = await admin.from("practice_treatment")
    .select("id, treatment_type, label, dose, dose_unit, route, frequency, frequency_code, duration, formulation, non_drug_category, batch_id")
    .eq("encounter_id", encounterId);
  ok("11-4. the rows are on the encounter (not vacuous)", (txRows ?? []).length === 4, `${(txRows ?? []).length}`);
  ok("11-5. one batch id across all four", new Set((txRows ?? []).map((r: any) => r.batch_id)).size === 1);

  const pred = (txRows ?? []).find((r: any) => r.label === "Prednisolone") as any;
  ok("11-6. ⚠ AC-02: THE EXACT ENTERED WORDING OF THE CUSTOM FREQUENCY IS IN THE ENCOUNTER RECORD",
    pred?.frequency === CUSTOM_FREQUENCY, JSON.stringify(pred?.frequency));
  ok("11-7. and frequency_code is NULL, so a reader can tell a typed frequency from a tapped one",
    pred?.frequency_code === null, JSON.stringify(pred?.frequency_code));
  const amox = (txRows ?? []).find((r: any) => r.label === "Amoxicillin") as any;
  ok("11-8. CONTROL: a TAPPED frequency stores its configured code alongside the label",
    amox?.frequency_code === "tds" && amox?.frequency === "Three times a day (TDS)");
  ok("11-9. AC-11: a non-drug treatment records with its configured category",
    (txRows ?? []).some((r: any) => r.treatment_type === "non_drug" && r.non_drug_category === "wound_care"));
  ok("11-10. s3: \"no treatment change\" is recordable explicitly",
    (txRows ?? []).some((r: any) => r.treatment_type === "no_change"));

  const { data: medRows } = await admin.from("practice_medication")
    .select("id, generic_name, treatment_id, dose_text, frequency, encounter_id").eq("patient_id", patientId);
  ok("11-11. AC-13: a prescribing treatment ALSO opens a longitudinal medication row",
    (medRows ?? []).length === 2, `${(medRows ?? []).length}`);
  ok("11-12. and the medication points back at the treatment decision that started it",
    (medRows ?? []).every((m: any) => !!m.treatment_id
      && (txRows ?? []).some((t: any) => t.id === m.treatment_id)));
  ok("11-13. the custom frequency reached the medication record too, unparsed",
    (medRows ?? []).some((m: any) => m.frequency === CUSTOM_FREQUENCY));
  ok("11-14. ⚠ AC-13: the treatment row and the medication row are DISTINCT records, never one",
    (txRows ?? []).length === 4 && (medRows ?? []).length === 2);

  // ⚠ REFUSAL PAIRED WITH ITS CONTROL. The control above (11-1) already proves the same call works on a
  // live encounter, so a green refusal here cannot be an engine that stopped working.
  await transitionEncounter(admin, { workspaceId: ws, encounterId, to: "COMPLETED", ...base });
  await transitionEncounter(admin, { workspaceId: ws, encounterId, to: "SIGNED", ...base });
  const afterSign = await recordTreatmentBatch(admin, ctx, {
    encounterId, items: [{ treatmentType: "medication", label: "Ibuprofen", dose: "200" }], ...base,
  });
  ok("11-15. a signed encounter refuses a new treatment",
    !afterSign.ok && afterSign.code === "ENCOUNTER_LOCKED", afterSign.ok ? "was allowed" : afterSign.code);
  const invAfterSign = await addInvestigations(admin, ctx, {
    encounterId, items: [{ label: "Repeat FBC" }], ...base,
  });
  ok("11-16. a signed encounter refuses a new investigation",
    !invAfterSign.ok && invAfterSign.code === "ENCOUNTER_LOCKED", invAfterSign.ok ? "was allowed" : invAfterSign.code);

  // ══ 12. THE CONFIGURED OPTION LISTS ═══════════════════════════════════════════════════════════
  section("12. the configured option lists (CPR-TREAT-001 s6, s7)");
  const options = await treatmentOptions(admin, ctx);
  const routes = options.byField.route ?? [];
  ok("12-1. the route list came back with rows (not vacuous)", routes.length > 5, `${routes.length}`);
  const aRoute = routes[0];
  await setTreatmentOptionState(admin, ctx, { optionId: aRoute.id, enabled: false, ...base });
  const afterHide = await treatmentOptions(admin, ctx);
  ok("12-2. AC-05: a disabled option leaves the prescriber's list",
    !(afterHide.byField.route ?? []).some(o => o.id === aRoute.id));
  ok("12-3. and stays in the configuration list so it can be switched back on",
    (afterHide.allByField.route ?? []).some(o => o.id === aRoute.id && !o.enabled));
  const { data: platformRoute } = await admin.from("practice_treatment_option")
    .select("active, label, workspace_id").eq("id", aRoute.id).single();
  ok("12-4. the PLATFORM row was not mutated",
    platformRoute?.active === true && platformRoute?.workspace_id === null && platformRoute?.label === aRoute.label);

  await setTreatmentOptionState(admin, ctx, { optionId: aRoute.id, enabled: true, labelOverride: "By mouth", ...base });
  const afterRelabel = await treatmentOptions(admin, ctx);
  ok("12-5. AC-05: a relabel changes what the prescriber sees, without a deployment",
    (afterRelabel.byField.route ?? []).some(o => o.id === aRoute.id && o.label === "By mouth" && o.relabelled));

  const extended = await createTreatmentOption(admin, ctx, { fieldKey: "route", label: "Via nasogastric tube", ...base });
  const afterExtend = await treatmentOptions(admin, ctx);
  ok("12-6. AC-05: a practice can EXTEND a list with its own value",
    extended.ok && (afterExtend.byField.route ?? []).some(o => o.label === "Via nasogastric tube" && o.source === "practice"));

  // ⚠ THE HONEST LIMIT, ASSERTED RATHER THAN HIDDEN.
  const notExtensible = await createTreatmentOption(admin, ctx, { fieldKey: "treatment_type", label: "Home visit plan", ...base });
  ok("12-7. ⚠ a NEW treatment TYPE is refused, because a database CHECK constrains the column",
    !notExtensible.ok && notExtensible.code === "NOT_EXTENSIBLE", notExtensible.ok ? "was allowed" : notExtensible.code);
  ok("12-8. CONTROL: the same verb on an extensible list succeeds (12-6 above)", extended.ok);

  const template = await saveTreatmentTemplate(admin, ctx, {
    name: "Chest infection (adult)", ownerType: "practitioner", practitionerId: OWNER,
    items: [{
      treatmentType: "medication", label: "Amoxicillin", formulation: "Capsule",
      dose: "500", doseUnit: "mg", route: "Oral", frequencyCode: "tds",
      frequencyText: "Three times a day (TDS)", duration: "5 days",
    }],
    ...base,
  });
  ok("12-9. AC-09: a prescription template saves its field values", template.ok && template.data.items === 1,
    template.ok ? "" : template.message);
  const { data: tplItems } = await admin.from("practice_treatment_template_item")
    .select("id, dose_text, frequency_code").eq("template_id", template.ok ? template.data.id : "");
  ok("12-10. ⚠ a template holds FIELD VALUES ONLY -- there is no column for a safety verdict",
    (tplItems ?? []).length === 1 && !Object.keys((tplItems ?? [])[0] ?? {}).some(k => /verdict|approved|safe/i.test(k)));

  // ══ 13. CAPABILITY REFUSALS, EACH WITH A CONTROL ══════════════════════════════════════════════
  section("13. capability refusals");
  const stripped: WorkspaceContext = { ...ctx, capabilities: ctx.capabilities.filter(c => c !== "treatment.record") };
  ok("13-1. the stripped context still holds other capabilities (not a broken fixture)",
    stripped.capabilities.length > 10 && stripped.capabilities.includes("encounter.edit"),
    `${stripped.capabilities.length}`);
  const enc2 = await launchEncounter(admin, {
    workspaceId: ws, patientId, pathway: "walk_in_followup", reasonForVisit: "review", ...base,
  });
  const enc2Id = enc2.ok ? enc2.data.id : "";
  await transitionEncounter(admin, { workspaceId: ws, encounterId: enc2Id, to: "ACTIVE", ...base });

  const deniedTreat = await recordTreatmentBatch(admin, stripped, {
    encounterId: enc2Id, items: [{ treatmentType: "medication", label: "Paracetamol", dose: "500" }], ...base,
  });
  ok("13-2. without treatment.record the batch is refused",
    !deniedTreat.ok && deniedTreat.code === "FORBIDDEN", deniedTreat.ok ? "was allowed" : deniedTreat.code);
  const allowedTreat = await recordTreatmentBatch(admin, ctx, {
    encounterId: enc2Id, items: [{ treatmentType: "medication", label: "Paracetamol", dose: "500" }], ...base,
  });
  ok("13-3. CONTROL: the same call WITH the capability is accepted",
    allowedTreat.ok && allowedTreat.data.recorded === 1, allowedTreat.ok ? "" : allowedTreat.message);

  const noConfig: WorkspaceContext = { ...ctx, capabilities: ctx.capabilities.filter(c => c !== "investigation.configure") };
  const deniedCustom = await createCustomInvestigation(admin, noConfig, {
    canonicalName: "Something local", category: "Other diagnostics", ...base,
  });
  ok("13-4. without investigation.configure a catalogue item cannot be created",
    !deniedCustom.ok && deniedCustom.code === "FORBIDDEN", deniedCustom.ok ? "was allowed" : deniedCustom.code);
  ok("13-5. CONTROL: with the capability it succeeds (10-1 above)", custom.ok);

  const deniedShared = await saveInvestigationSet(admin, noConfig, {
    name: "Shared bundle", ownerType: "practice", practitionerId: OWNER,
    investigationIds: [four[0].id], ...base,
  });
  ok("13-6. a PRACTICE-SHARED set needs the configuration capability",
    !deniedShared.ok && deniedShared.code === "FORBIDDEN", deniedShared.ok ? "was allowed" : deniedShared.code);
  const allowedPersonal = await saveInvestigationSet(admin, noConfig, {
    name: "Personal bundle", ownerType: "practitioner", practitionerId: OWNER,
    investigationIds: [four[0].id], ...base,
  });
  ok("13-7. CONTROL: a PERSONAL set does not, because it is a preference",
    allowedPersonal.ok, allowedPersonal.ok ? "" : allowedPersonal.message);

  // ── TENANT ISOLATION, CINV-CAP-001 AC-07 ────────────────────────────────────────────────────────
  //
  // ⚠ THE SECOND WORKSPACE IS PROVISIONED UNDER A SECOND OWNER. See the note on OWNER_B: provisioning
  // hands back the caller's existing individual practice, so a second call under OWNER would have made
  // 13-8 compare a tenant with itself.
  const otherWs = await provision(OWNER_B, "HARNESS Treatment/Investigation second tenant (synthetic)", "b");
  const otherCtxRes = await resolveWorkspaceContext(admin, OWNER_B, otherWs);

  // ⚠ THE PRECONDITION IS ITS OWN NAMED ASSERTION, AND IT RUNS BEFORE THE ISOLATION CHECK. Without it,
  // an isolation assertion silently becomes a test of one workspace against itself the moment the
  // fixture changes -- and a security assertion that cannot fail is worse than one that does.
  ok("13-8a. PRECONDITION: the two workspaces are genuinely different tenants",
    otherCtxRes.ok && otherWs !== ws && otherCtxRes.ok && otherCtxRes.ctx.workspaceId !== ctx.workspaceId,
    otherCtxRes.ok ? `A=${ctx.workspaceId} B=${otherCtxRes.ok ? otherCtxRes.ctx.workspaceId : "?"}` : "context did not resolve");

  if (otherCtxRes.ok && otherCtxRes.ctx.workspaceId !== ctx.workspaceId) {
    const otherLibrary = await investigationCatalogue(admin, otherCtxRes.ctx, OWNER_B);
    ok("13-8b. the other tenant's catalogue read returned rows (13-8c is not vacuous)",
      otherLibrary.all.length > 50, `${otherLibrary.all.length} items`);
    ok("13-8c. AC-07: another tenant sees the platform seed and NOT this practice's custom item",
      !otherLibrary.all.some(i => custom.ok && i.id === custom.data.id),
      `${otherLibrary.all.length} items, custom present`);
    ok("13-8d. and it sees none of this practice's local renames either",
      !otherLibrary.all.some(i => i.displayName === "Bloods (routine)"));
    ok("13-8e. nor this practice's sets",
      !otherLibrary.sets.some(x => x.name === "Febrile child" || x.name === "Personal bundle"));
    ok("13-9. CONTROL: the custom item IS in the workspace that made it",
      afterCustom.all.some(i => custom.ok && i.id === custom.data.id));
  } else skip("13-8b..13-9. tenant isolation", "the second tenant is not a distinct workspace");

  // ══ 14. CLEAN UP AND PROVE IT ═════════════════════════════════════════════════════════════════
  section("14. fixtures");
  await cleanup();
  const { data: left, error: leftErr } = await admin.from("practice_workspace")
    .select("id").in("owner_person_id", [OWNER, OWNER_B]);
  ok("14-1. the harness deleted its own fixtures, for BOTH tenants",
    !leftErr && (left ?? []).length === 0, leftErr ? leftErr.message : `${(left ?? []).length} left`);
  const { data: strayCustom } = await admin.from("practice_investigation_catalogue")
    .select("id").not("workspace_id", "is", null);
  ok("14-2. no practice-scoped catalogue row of this harness survives",
    !(strayCustom ?? []).some((r: any) => custom.ok && r.id === custom.data.id));

  return report();
}

/** The boundary paragraph SAYS the words the scan forbids elsewhere. Removing it is what makes 7-6 real. */
function stripBoundary(html: string): string {
  return html.split(INVESTIGATION_BOUNDARY.slice(0, 40)).map((part, i) =>
    i === 0 ? part : part.slice(INVESTIGATION_BOUNDARY.length)).join(" ")
    .replace(/It does not mean:[^<]*/g, " ")
    .replace(/must not[^<]*/gi, " ");
}
/** Likewise: the "not a recommendation" notice contains the word it forbids. */
function stripNotRecommendation(html: string): string {
  return html
    .replace(/not a\s+clinical recommendation[^<]*/gi, " ")
    .replace(/[^<]*recommendation[^<]*/gi, " ")
    .replace(/[^<]*recommends no set[^<]*/gi, " ");
}

main().catch(e => { console.error(e); process.exit(1); });
