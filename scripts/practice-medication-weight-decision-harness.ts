/**
 * THE RULING OF 2026-08-08, END TO END:
 *
 *   "Permit dosing only on a weight recorded in the same session. If there is no weight, prompt the
 *    practitioner to make a decision and RECORD the decision."
 *
 *   npx --yes tsx scripts/practice-medication-weight-decision-harness.ts
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SEPARATE FILE FROM practice-medication-harness.ts. That file asserts the medication
 * record, its timeline and s3's arithmetic. This one asserts a rule that cuts across all three and that
 * was, until today, enforced NOWHERE IN src -- migrations 259 and 265 built the column and the
 * constraints, and nothing wrote them and nothing asked for them. The assertions below are the ones that
 * would have caught that: they check that the ENGINE demands the decision, that the STORED ROW carries
 * it, and that the SURFACE asks for it.
 *
 * ⚠ THE FOUR CLAIMS THIS FILE EXISTS FOR, each paired with a control:
 *
 *  1. A FIXED DOSE IS NEVER ASKED TO JUSTIFY NOT HAVING A WEIGHT. Most patients on a fixed dose have
 *     never been weighed and nothing is wrong. A prompt that fires when nothing is wrong is a prompt
 *     people learn to dismiss without reading, which is how the real prompt stops working.
 *  2. NO WEIGHT PLUS A DECISION RECORDS, AND THE DECISION IS ON THE ROW THAT WAS STORED. Not in an event
 *     table alone -- migration 259: an event in another table can be printed apart from the prescription
 *     it justified, and a dose printed without the reasoning that produced it is what the column prevents.
 *  3. A BLANK DECISION IS REFUSED BY THE ENGINE IN A SENTENCE, BEFORE THE DATABASE REFUSES IT WITH A
 *     CONSTRAINT NAME. 23514 is not a thing to put in front of a prescriber.
 *  4. mg/m2 WITH NO SURFACE AREA IS REFUSED, AND THE MESSAGE DOES NOT BLAME THE MISSING DECISION. A
 *     decision stands in for a missing MEASUREMENT, never for the ARITHMETIC. Blaming the justification
 *     would send somebody to write one, and it would change nothing.
 *
 * ⚠ AND THE ONE THING NO ASSERTION HERE MAY LET THROUGH: A NUMBER. The decision permits the prescriber to
 * proceed. It never permits this product to multiply by a weight it did not measure, so every recorded
 * decision below is asserted to carry per_dose null AND daily_total null.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { loadEnvConfig } from "@next/env";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { ensureCoreLibrary, setActivation, recordMeasurement } from "../src/lib/practice/parameters";
import {
  medicationStorePresence, recordMedication, calculateDose, medicationTimeline, patientMedications,
  MEDICATION_DOSE_TABLE, MEDICATION_EVENT_TABLE,
} from "../src/lib/practice/medication";
import {
  MEDICATION_CAPABILITIES, WEIGHT_STATES_NEEDING_DECISION,
  weightDecisionPrompt, weightDecisionHeadline, WEIGHT_DECISION_ASK,
  BSA_NEEDS_MEASUREMENTS, WEIGHT_DECISION_NOT_APPLICABLE,
  ageLine, completedYears, ADULT_NO_WEIGHT_REFUSED,
} from "../src/lib/practice/medication-constants";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

/** ⚠ ITS OWN USER, so a concurrent run of practice-medication-harness.ts cannot purge this one's fixtures. */
const USER_W = "00000000-0000-4000-8000-0000000e0fd7";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};
const section = (t: string) => console.log(`\n── ${t} ──`);

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(): Promise<string> {
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: "harness-med-weightdec", request_type: "pilot",
    actor_user_id: USER_W, target_user_id: USER_W, payload_hash: "harness", correlation_id: "harness-weightdec",
  }).select("id").single();
  const run = await runProvisioning(
    admin,
    { id: req!.id, target_user_id: USER_W, correlation_id: "harness-weightdec", workspace_id: null },
    payload("Weight Decision Harness"),
  );
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

/** ⚠ NEVER THE OLD INLINE CLEANUP -- it discarded the delete error and left fixtures behind. */
async function cleanup() { await purgeWorkspacesOwnedBy(admin, [USER_W]); }

const base = { actorId: USER_W, correlationId: "harness-weightdec" };

/**
 * ⚠ A FIXED "TODAY", PASSED INTO THE ENGINE RATHER THAN WAITED FOR. The age gate turns on a threshold of
 * exactly 18, and the only way to stand on both sides of a birthday in one run is to say what day it is.
 * calculateDose and patientMedications both take `today` for this reason.
 */
const TODAY = "2026-06-15";

const DECISION = "Mother reports 12 kg weighed at the health centre last week. No working scale here today.";

async function doseRows(workspaceId: string): Promise<number> {
  // ⚠ NOT head+count. A missing table and an empty table both return count === null, and the store
  // presence check above is what tells them apart -- this only ever runs once that has passed.
  const { data, error } = await admin.from(MEDICATION_DOSE_TABLE).select("id").eq("workspace_id", workspaceId);
  if (error) throw new Error(`could not count dose rows: ${error.message}`);
  return (data ?? []).length;
}

async function main() {
  await cleanup();

  const store = await medicationStorePresence(admin);
  if (store.state !== "present") {
    console.log(`\n  ⚠ THE MEDICATION STORE IS ${store.state.toUpperCase()}. This file asserts a rule that`);
    console.log("    lives in a column, so it cannot report green against a database that has not got one.");
    console.log(`    Missing: ${store.migration}`);
    process.exit(1);
  }

  const wsA = await provision();
  const ctxRes = await resolveWorkspaceContext(admin, USER_W, wsA);
  if (!ctxRes.ok) throw new Error("no context");
  const ctxA: WorkspaceContext = ctxRes.ctx;
  const medCtx: WorkspaceContext = {
    ...ctxA, capabilities: [...new Set([...ctxA.capabilities, ...MEDICATION_CAPABILITIES])],
  };
  /** A prescriber who may record but holds no override. Migration 258: the assistant, by design. */
  const recordOnly: WorkspaceContext = {
    ...ctxA,
    capabilities: [...ctxA.capabilities.filter(c => !c.startsWith("medication.")), "medication.view", "medication.record"],
  };

  await ensureCoreLibrary(admin);
  const { data: defs } = await admin.from("practice_parameter_definition")
    .select("id, code").is("workspace_id", null).in("code", ["weight", "standing_height"]);
  const defRows = (defs ?? []) as { id: string; code: string }[];
  const WEIGHT = defRows.find(d => d.code === "weight")!.id;
  const HEIGHT = defRows.find(d => d.code === "standing_height")!.id;
  await setActivation(admin, ctxA, { definitionId: WEIGHT, state: "active", collectionRule: "every_visit", ...base });
  await setActivation(admin, ctxA, { definitionId: HEIGHT, state: "active", collectionRule: "every_visit", ...base });

  // ⚠ TWO PATIENTS, AND THE DIFFERENCE BETWEEN THEM IS THE WHOLE CONTROL. NEVER-WEIGHED has no
  // measurement of any kind. WEIGHED has both, so every refusal below can be shown to succeed for
  // somebody -- a gate that refuses everyone is safe, useless, and passes half of this file on its own.
  const p1 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Never Weighed", sex: "female", birthDate: "2021-03-02",
    phone: "+256700000701", actorId: USER_W, correlationId: "harness-weightdec",
  });
  const p2 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Weighed Child", sex: "male", birthDate: "2020-04-01",
    phone: "+256700000702", actorId: USER_W, correlationId: "harness-weightdec",
  });
  const NEVER = p1.ok ? p1.data.id : null;
  const WEIGHED = p2.ok ? p2.data.id : null;
  if (!NEVER || !WEIGHED) throw new Error("fixtures failed");
  await recordMeasurement(admin, ctxA, { patientId: WEIGHED, definitionId: WEIGHT, value: 18.4, unit: "kg", ...base });
  await recordMeasurement(admin, ctxA, { patientId: WEIGHED, definitionId: HEIGHT, value: 110, unit: "cm", ...base });

  const med1 = await recordMedication(admin, medCtx, {
    patientId: NEVER, genericName: "Amoxicillin", doseText: "as decided at this visit", ...base,
  });
  const MED1 = med1.ok ? med1.data.id : null;
  ok("0-control. the fixtures are real: two patients, one weighed, one never, and a medication",
    !!NEVER && !!WEIGHED && !!MED1, JSON.stringify({ NEVER, WEIGHED, MED1 }));

  // ══ 1. THE WORDS, BEFORE ANYTHING USES THEM ═══════════════════════════════════════════════════════
  section("1. THE PROMPT SAYS WHICH OF THE TWO HAPPENED");

  ok("1a. ⚠ the two states needing a decision are exactly absent and unreadable -- 259's pair",
    WEIGHT_STATES_NEEDING_DECISION.length === 2
    && WEIGHT_STATES_NEEDING_DECISION.includes("absent")
    && WEIGHT_STATES_NEEDING_DECISION.includes("unreadable"),
    WEIGHT_STATES_NEEDING_DECISION.join(","));

  // ⚠ A FAILED READ IS NOT AN ABSENT WEIGHT, and the two sentences must not be the same sentence. The
  // next step differs: a read that failed may succeed on a retry, a weight never taken will not.
  ok("1b. ⚠ `could not be read` and `never recorded` are DIFFERENT sentences",
    weightDecisionHeadline("unreadable") !== weightDecisionHeadline("absent")
    && /COULD NOT BE READ/.test(weightDecisionHeadline("unreadable"))
    && /NO WEIGHT HAS EVER BEEN RECORDED/.test(weightDecisionHeadline("absent")),
    weightDecisionHeadline("unreadable"));

  ok("1c. ⚠ the ask says NO FIGURE IS PRODUCED, so nobody reads the prompt as a place to type a weight",
    /NO DOSE FIGURE IS PRODUCED/.test(WEIGHT_DECISION_ASK)
    && /will not multiply by a weight it did not record/.test(WEIGHT_DECISION_ASK));
  ok("1c-control. and it says the words are recorded, which is the reason to write them",
    /override register/.test(WEIGHT_DECISION_ASK) && /travels with the prescription/.test(WEIGHT_DECISION_ASK));

  ok("1d. ⚠ the BSA refusal never mentions a decision or a justification",
    !/decision/i.test(BSA_NEEDS_MEASUREMENTS) && !/justif/i.test(BSA_NEEDS_MEASUREMENTS)
    && /surface area/i.test(BSA_NEEDS_MEASUREMENTS), BSA_NEEDS_MEASUREMENTS);

  // ══ 2. A FIXED DOSE IS NEVER ASKED ════════════════════════════════════════════════════════════════
  section("2. A FIXED DOSE IS NEVER ASKED TO JUSTIFY NOT HAVING A WEIGHT");

  const fixedNoDecision = await calculateDose(admin, medCtx, {
    patientId: NEVER, medicationId: MED1, basis: "fixed", fixedDose: 500, doseUnit: "mg", ...base,
  });
  ok("2a. ⚠ a fixed dose for a never-weighed patient records with NO decision asked for",
    fixedNoDecision.ok && !!fixedNoDecision.data.id && fixedNoDecision.data.perDose === 500
    && fixedNoDecision.data.weightDecision === null,
    JSON.stringify(fixedNoDecision.ok ? { id: fixedNoDecision.data.id, dec: fixedNoDecision.data.weightDecision } : fixedNoDecision));

  // ⚠ THE CONTROL THAT MAKES 2a MEAN SOMETHING. If this patient's weight were quietly readable, 2a would
  // pass for the wrong reason -- it would be testing a patient nothing is wrong with.
  const kgNoDecision = await calculateDose(admin, medCtx, {
    patientId: NEVER, medicationId: MED1, basis: "mg_per_kg", rateValue: 15, doseUnit: "mg", ...base,
  });
  ok("2a-control. ⚠ the SAME patient on mg/kg IS asked, so 2a is not a patient with a weight",
    !kgNoDecision.ok && kgNoDecision.code === "WEIGHT_DECISION_REQUIRED", JSON.stringify(kgNoDecision));

  const fixedWithDecision = await calculateDose(admin, medCtx, {
    patientId: NEVER, medicationId: MED1, basis: "fixed", fixedDose: 500, doseUnit: "mg",
    weightDecision: DECISION, ...base,
  });
  ok("2b. ⚠ a decision offered on a FIXED dose is REFUSED rather than stored -- it justifies nothing",
    !fixedWithDecision.ok && fixedWithDecision.code === "WEIGHT_DECISION_NOT_APPLICABLE",
    JSON.stringify(fixedWithDecision));

  // ⚠ THIS ASSERTION EXISTS BECAUSE THE FIRST VERSION FAILED IT, AND 2b DID NOT NOTICE. The refusal is
  // shared with the has-a-weight case, whose sentence is "this patient has one" -- and for a fixed dose
  // the weight verdict is a synthetic blank reading "no weight is recorded". The two together were a flat
  // contradiction on the commonest prescription this product writes. A code is not a message.
  ok("2b-message. ⚠ and the refusal does not tell a never-weighed patient's prescriber they have a weight",
    !fixedWithDecision.ok
    && /fixed dose does not depend/i.test(fixedWithDecision.message)
    && !/This patient has one/.test(fixedWithDecision.message)
    && !/No weight is recorded/.test(fixedWithDecision.message),
    !fixedWithDecision.ok ? fixedWithDecision.message : "");

  // ══ 3. NO WEIGHT PLUS A DECISION RECORDS, AND THE ROW CARRIES IT ══════════════════════════════════
  section("3. THE RULING ITSELF");

  const before = await doseRows(wsA);
  const decided = await calculateDose(admin, medCtx, {
    patientId: NEVER, medicationId: MED1, basis: "mg_per_kg", rateValue: 15, doseUnit: "mg",
    weightDecision: DECISION, ...base,
  });
  ok("3a. ⚠ a weight-based dose with NO weight and a written decision RECORDS",
    decided.ok && !!decided.data.id, JSON.stringify(decided.ok ? decided.data.id : decided));

  ok("3b. ⚠ AND NO NUMBER WAS INVENTED. Both totals are null, by design, not by failure",
    decided.ok && decided.data.perDose === null && decided.data.dailyTotal === null
    && decided.data.weightDecision === DECISION,
    JSON.stringify(decided.ok ? { p: decided.data.perDose, d: decided.data.dailyTotal } : decided));

  // ⚠ THE ROW THAT WAS STORED, READ BACK OUT OF THE DATABASE. The payload saying so is not the claim --
  // migration 259's claim is that the reasoning is ON THE PRESCRIPTION'S OWN ROW.
  const storedId = decided.ok ? decided.data.id : null;
  type StoredDose = {
    weight_decision: string | null; weight_kg: number | null; weight_state: string;
    per_dose: number | null; daily_total: number | null; working: string;
    safety_checks_not_run: string[] | null;
  };
  const { data: row } = storedId
    ? await admin.from(MEDICATION_DOSE_TABLE).select("*").eq("id", storedId).single()
    : { data: null };
  const stored = (row ?? null) as StoredDose | null;
  ok("3c. ⚠ the decision is ON THE STORED ROW, beside a null weight and a frozen weight_state",
    !!stored && stored.weight_decision === DECISION && stored.weight_kg === null
    && stored.weight_state === "absent" && stored.per_dose === null && stored.daily_total === null,
    JSON.stringify(stored && { dec: stored.weight_decision, kg: stored.weight_kg, st: stored.weight_state, pd: stored.per_dose }));

  ok("3d. ⚠ and the working SAYS no arithmetic happened -- a blank working would read as a skipped step",
    !!stored && /NO ARITHMETIC WAS PERFORMED/.test(String(stored.working))
    && String(stored.working).includes(DECISION)
    && (stored.safety_checks_not_run ?? []).length >= 1,
    String(stored?.working ?? "").slice(0, 120));

  const after = await doseRows(wsA);
  ok("3d-control. exactly one row arrived for that call, so 3c is not reading somebody else's row",
    after === before + 1, `${before} -> ${after}`);

  // The read path. A column nothing renders is a column nobody sees.
  const tl = MED1 ? await medicationTimeline(admin, medCtx, MED1) : null;
  const tlRow = tl?.calculations.find(c => c.id === storedId) ?? null;
  ok("3e. ⚠ the timeline READER carries the decision, so a surface can print it beside the figure",
    !!tlRow && tlRow.weightDecision === DECISION && tlRow.perDose === null,
    JSON.stringify(tlRow && { dec: tlRow.weightDecision, pd: tlRow.perDose }));
  ok("3e-control. the timeline really was read and holds the other calculations too",
    !!tl && tl.calculations.length >= 2, `${tl?.calculations.length} calculations`);

  // MED s5's register. Prescribing with no weight is a clinical act that must leave a trace.
  const { data: events } = await admin.from(MEDICATION_EVENT_TABLE)
    .select("event_type, reason, next").eq("workspace_id", wsA).eq("event_type", "safety_override");
  const register = (events ?? []) as {
    event_type: string; reason: string;
    next: { decisionRecorded?: boolean; doseComputed?: boolean } | null;
  }[];
  ok("3f. ⚠ it lands in the safety-override register, in the prescriber's words",
    register.length === 1 && register[0].reason === DECISION
    && register[0].next?.decisionRecorded === true && register[0].next?.doseComputed === false,
    JSON.stringify(register));

  // ══ 4. A BLANK IS REFUSED BY THE ENGINE, IN A SENTENCE ════════════════════════════════════════════
  section("4. THE SPACE BAR IS NOT A CLINICAL JUSTIFICATION");

  const beforeBlank = await doseRows(wsA);
  const blank = await calculateDose(admin, medCtx, {
    patientId: NEVER, medicationId: MED1, basis: "mg_per_kg", rateValue: 15, doseUnit: "mg",
    weightDecision: "   ", ...base,
  });
  ok("4a. ⚠ a whitespace decision is REFUSED",
    !blank.ok && blank.code === "WEIGHT_DECISION_REQUIRED" && blank.status === 422, JSON.stringify(blank));

  // ⚠ THE HALF THAT MATTERS. 259's btrim check would refuse this too -- with 23514 and a constraint name,
  // which is not a thing to put in front of a prescriber. The engine must get there first, in English.
  ok("4b. ⚠ and it is refused IN A SENTENCE, not with a constraint name or an SQL code",
    !blank.ok && blank.message === weightDecisionPrompt("absent")
    && !/23514|practice_dose_weight_decision_required|constraint/i.test(blank.message),
    !blank.ok ? blank.message : "");

  ok("4b-control. nothing was stored by the refused call",
    (await doseRows(wsA)) === beforeBlank, `${beforeBlank}`);

  ok("4c. ⚠ a missing decision gets the SAME sentence as a blank one -- both are 'you have not said'",
    !kgNoDecision.ok && !blank.ok && kgNoDecision.message === blank.message);

  // ══ 5. mg/m2 -- THE DOOR THAT IS DELIBERATELY NARROWER ════════════════════════════════════════════
  section("5. A DECISION STANDS IN FOR A MEASUREMENT, NEVER FOR THE ARITHMETIC");

  const bsaWithDecision = await calculateDose(admin, medCtx, {
    patientId: NEVER, medicationId: MED1, basis: "mg_per_m2", rateValue: 100, doseUnit: "mg",
    weightDecision: DECISION, ...base,
  });
  ok("5a. ⚠ mg/m2 with no weight is REFUSED even WITH a decision",
    !bsaWithDecision.ok && bsaWithDecision.code === "CANNOT_CALCULATE", JSON.stringify(bsaWithDecision));

  ok("5b. ⚠ and the refusal does NOT blame the decision -- it names the missing measurements",
    !bsaWithDecision.ok
    && /surface area/i.test(bsaWithDecision.message)
    && !/decision/i.test(bsaWithDecision.message)
    && !/justif/i.test(bsaWithDecision.message),
    !bsaWithDecision.ok ? bsaWithDecision.message : "");

  // Captured before the next call so the comparison in 5c is between two messages and not between two
  // narrowings -- TypeScript will not carry the refusal branch of one result into another assertion.
  const bsaRefusal = bsaWithDecision.ok ? "" : bsaWithDecision.message;
  const bsaNoDecision = await calculateDose(admin, medCtx, {
    patientId: NEVER, medicationId: MED1, basis: "mg_per_m2", rateValue: 100, doseUnit: "mg", ...base,
  });
  ok("5c. ⚠ and with NO decision it gives the same answer -- nobody is asked for words that change nothing",
    !bsaNoDecision.ok && bsaNoDecision.code === "CANNOT_CALCULATE"
    && bsaNoDecision.message === bsaRefusal, JSON.stringify(bsaNoDecision));

  const med2 = await recordMedication(admin, medCtx, {
    patientId: WEIGHED, genericName: "Ciprofloxacin", doseText: "as calculated", ...base,
  });
  const MED2 = med2.ok ? med2.data.id : null;
  const bsaReal = await calculateDose(admin, medCtx, {
    patientId: WEIGHED, medicationId: MED2, basis: "mg_per_m2", rateValue: 100, doseUnit: "mg", ...base,
  });
  ok("5c-control. ⚠ mg/m2 WITH a weight and a height computes and stores, so 5a is not a basis that never works",
    bsaReal.ok && !!bsaReal.data.id && bsaReal.data.bsaM2 === 0.75 && bsaReal.data.perDose === 75,
    JSON.stringify(bsaReal.ok ? { bsa: bsaReal.data.bsaM2, pd: bsaReal.data.perDose } : bsaReal));

  // ══ 6. WHO MAY DECIDE ═════════════════════════════════════════════════════════════════════════════
  section("6. THE AUTHORITY, AND IT IS 258's OWN SPLIT");

  // Migration 258, verbatim: medication.override is "the authority to prescribe weight-based when the
  // weight is absent or stale", practitioner only. The assistant records what a patient reports -- they
  // do not decide to prescribe without a weight.
  const assistant = await calculateDose(admin, recordOnly, {
    patientId: NEVER, medicationId: MED1, basis: "mg_per_kg", rateValue: 15, doseUnit: "mg",
    weightDecision: DECISION, ...base,
  });
  ok("6a. ⚠ medication.record alone cannot record the decision -- it needs medication.override",
    !assistant.ok && assistant.code === "OVERRIDE_REQUIRED" && assistant.status === 403,
    JSON.stringify(assistant));
  ok("6a-control. and the practitioner CAN (assertion 3a), so 6a is not a call that always fails",
    decided.ok);

  // ══ 7. WHERE THERE IS A WEIGHT, THERE IS NOTHING TO STAND IN FOR ══════════════════════════════════
  section("7. A DECISION IS NEVER SILENTLY DROPPED");

  const beforeNA = await doseRows(wsA);
  const notApplicable = await calculateDose(admin, medCtx, {
    patientId: WEIGHED, medicationId: MED2, basis: "mg_per_kg", rateValue: 15, doseUnit: "mg",
    weightDecision: DECISION, ...base,
  });
  ok("7a. ⚠ a decision supplied against a weight that EXISTS is refused, not quietly discarded",
    !notApplicable.ok && notApplicable.code === "WEIGHT_DECISION_NOT_APPLICABLE"
    && notApplicable.message.startsWith(WEIGHT_DECISION_NOT_APPLICABLE), JSON.stringify(notApplicable));
  ok("7a-control-a. nothing was stored by that call",
    (await doseRows(wsA)) === beforeNA);

  const normal = await calculateDose(admin, medCtx, {
    patientId: WEIGHED, medicationId: MED2, basis: "mg_per_kg", rateValue: 15, doseUnit: "mg", ...base,
  });
  ok("7a-control-b. ⚠ the SAME call without the decision computes 276 mg and stores it",
    normal.ok && normal.data.perDose === 276 && !!normal.data.id && normal.data.weightDecision === null,
    JSON.stringify(normal.ok ? normal.data.perDose : normal));

  // ══ 8. THE SURFACE ASKS ═══════════════════════════════════════════════════════════════════════════
  section("8. THE PRESCRIBING SCREEN (source scan)");

  const consolePath = join(process.cwd(), "src", "app", "practice", "(shell)", "encounters", "[encounterId]", "MedicationConsole.tsx");
  const pagePath = join(process.cwd(), "src", "app", "practice", "(shell)", "medications", "page.tsx");
  ok("8-control. both surfaces exist and were read",
    existsSync(consolePath) && existsSync(pagePath)
    && readFileSync(consolePath, "utf8").length > 4000);
  const consoleSrc = readFileSync(consolePath, "utf8");
  const pageSrc = readFileSync(pagePath, "utf8");

  ok("8a. ⚠ the console asks for the decision, and only for the two states the engine gates on",
    /WEIGHT_STATES_NEEDING_DECISION[\s\S]{0,120}includes\(record\.weight\.state\)/.test(consoleSrc)
    && /decisionRequired = noWeightAtAll && !bsaImpossible/.test(consoleSrc));
  ok("8b. ⚠ the state list is IMPORTED from the engine's constants, not retyped on the screen",
    /WEIGHT_STATES_NEEDING_DECISION[\s\S]{0,400}from "@\/lib\/practice\/medication-constants"/.test(consoleSrc));
  ok("8c. ⚠ it is a TEXTAREA of free text and not a dropdown of excuses to pick from",
    /<textarea[^>]*value=\{calc\.weightDecision\}/.test(consoleSrc)
    && !/<select[^>]*calc\.weightDecision/.test(consoleSrc));
  ok("8d. ⚠ mg/m2 with no weight disables the button rather than asking for words it would throw away",
    /bsaImpossible = noWeightAtAll && calc\.basis === "mg_per_m2"/.test(consoleSrc)
    && /disabled=\{busy \|\| bsaImpossible \|\| adultNoWeight \|\| decisionMissing\}/.test(consoleSrc)
    && /BSA_NEEDS_MEASUREMENTS/.test(consoleSrc));
  // ⚠ PINNED TO BOTH WHOLE EXPRESSIONS, AND THE LOOSER VERSION OF THIS WAS VACUOUS. Scanning for the
  // token `record.age.decisionPathOffered` matched the NEGATED use in adultNoWeight, so dropping the age
  // term from decisionRequired -- which reopens the decision path to adults -- left the assertion green.
  ok("8h. ⚠ the screen branches on the ENGINE's age verdict, not on arithmetic of its own",
    /const adultNoWeight = noWeightAtAll && !bsaImpossible && !record\.age\.decisionPathOffered;/.test(consoleSrc)
    && /const decisionRequired = noWeightAtAll && !bsaImpossible && record\.age\.decisionPathOffered;/.test(consoleSrc)
    && !/birth_date|birthDate|Date\.parse|CHILD_AGE_LIMIT/.test(consoleSrc));
  ok("8i. ⚠ and the adult sees a refusal with nothing to type in it",
    /\{adultNoWeight && \(/.test(consoleSrc) && /\{ADULT_NO_WEIGHT_REFUSED\}/.test(consoleSrc)
    && !/adultNoWeight[\s\S]{0,600}<textarea/.test(consoleSrc));
  ok("8e. ⚠ `Use this as the dose` is offered only when there IS a figure",
    /\(dose\.perDose !== null \|\| dose\.dailyTotal !== null\) && \(/.test(consoleSrc));
  // ⚠ THE FIRST VERSION OF BOTH OF THESE WAS VACUOUS AND THE BREAK RUN SAID SO. Each scanned only for the
  // token `dose.notStored` / `c.weightDecision`, and both tokens also appear elsewhere in their files --
  // so deleting the block that RENDERS them left the scan green. A scan for a name is not a scan for a
  // rendering. Both now require the guard AND the printed value.
  ok("8f. ⚠ a refused write shows the DATABASE's reason, not a guess that the store is missing",
    /\{dose\.notStored && \(/.test(consoleSrc) && />\{dose\.notStored\}</.test(consoleSrc)
    && !/the medication store is not in this deployment/.test(consoleSrc));
  ok("8g. ⚠ the timeline prints the decision beside the calculation it justified",
    /\{c\.weightDecision && \(/.test(pageSrc)
    && /\{c\.weightDecision\}&rdquo;/.test(pageSrc)
    && /No dose was\s*\n?\s*computed by this product/.test(pageSrc));

  // CONTROL. Every scan above is a regex over a real file, so one that can never match would be silent.
  ok("8-control-b. the scans are not passing on an empty read",
    consoleSrc.includes("weightDecision") && pageSrc.includes("weightDecision")
    && consoleSrc.length > 10000, `${consoleSrc.length} chars`);

  // ══ 9. WHO IT IS FOR -- the user's narrowing of 2026-08-08 ════════════════════════════════════════
  section("9. CHILDREN ONLY, AND AN UNKNOWN AGE IS NOT AN ADULT");

  // ── The arithmetic first, because an off-by-one on an age threshold is the classic ────────────────
  ok("9a. ⚠ a birthday that has NOT yet come round this year makes the patient a year younger",
    completedYears("2008-06-16", TODAY) === 17
    && completedYears("2008-06-15", TODAY) === 18
    && completedYears("2008-06-14", TODAY) === 18,
    JSON.stringify([completedYears("2008-06-16", TODAY), completedYears("2008-06-15", TODAY), completedYears("2008-06-14", TODAY)]));
  // ⚠ THE CONTROL THAT NAMES THE WRONG ANSWER OUT LOUD. Subtracting years alone gives 18 for a patient
  // who is 17 until tomorrow, and 18 is the one number on which this whole gate turns.
  ok("9a-control. ⚠ and the naive year subtraction really would have said 18, so 9a is not a tautology",
    Number(TODAY.slice(0, 4)) - 2008 === 18 && completedYears("2008-06-16", TODAY) === 17);

  ok("9b. ⚠ ageLine: under 18 is a child, 18 is not, and an unreadable record is NEITHER",
    ageLine({ birthDate: "2009-06-14", ageEstimateYears: null, today: TODAY, unavailable: false }).state === "child"
    && ageLine({ birthDate: "2008-06-15", ageEstimateYears: null, today: TODAY, unavailable: false }).state === "adult"
    && ageLine({ birthDate: null, ageEstimateYears: null, today: TODAY, unavailable: true }).state === "unknown");
  ok("9b-control. ⚠ and `unknown` OFFERS the path while `adult` does not -- the third state is not a refusal",
    ageLine({ birthDate: null, ageEstimateYears: null, today: TODAY, unavailable: true }).decisionPathOffered
    && ageLine({ birthDate: null, ageEstimateYears: null, today: TODAY, unavailable: false }).decisionPathOffered
    && !ageLine({ birthDate: "2008-06-15", ageEstimateYears: null, today: TODAY, unavailable: false }).decisionPathOffered);

  // ── The live gate ────────────────────────────────────────────────────────────────────────────────
  const mkPatient = async (name: string, phone: string, birthDate: string | null, estimate: number | null) => {
    const r = await registerPatient(admin, {
      workspaceId: wsA, displayName: name, sex: "female",
      birthDate: birthDate ?? undefined, ageEstimateYears: estimate ?? undefined,
      phone, actorId: USER_W, correlationId: "harness-weightdec",
    });
    if (!r.ok) throw new Error(`fixture ${name} failed: ${r.message}`);
    return r.data.id;
  };
  const noWeightDose = (patientId: string, weightDecision: string | null) => calculateDose(admin, medCtx, {
    patientId, basis: "mg_per_kg", rateValue: 15, doseUnit: "mg",
    weightDecision, ...base,
  }, TODAY);

  const ADULT = await mkPatient("Adult Forty", "+256700000711", "1986-06-15", null);
  const SEVENTEEN = await mkPatient("Seventeen", "+256700000712", "2009-06-14", null);
  const EIGHTEEN = await mkPatient("Eighteen Today", "+256700000713", "2008-06-15", null);
  const TOMORROW = await mkPatient("Eighteen Tomorrow", "+256700000714", "2008-06-16", null);
  const ESTIMATED = await mkPatient("Estimated Forty", "+256700000715", null, 40);
  const UNKNOWN = await mkPatient("Age Unknown", "+256700000716", null, 30);
  // ⚠ THE FIXTURE REGISTRATION REFUSES TO BUILD THIS ONE, AND IT IS RIGHT TO. CPR-V2-005's minimum
  // dataset requires a birth date OR an estimate, so a patient with neither cannot be registered through
  // the form. The state still exists -- an imported row, a migrated record, a read that failed -- and it
  // is exactly the case the ruling does not name, so it is built directly rather than pretended away.
  const { error: nullErr } = await admin.from("practice_patient")
    .update({ birth_date: null, age_estimate_years: null }).eq("id", UNKNOWN);
  if (nullErr) throw new Error(`could not build the unknown-age fixture: ${nullErr.message}`);

  const child = await noWeightDose(NEVER, DECISION);
  ok("9c. ⚠ a 5-year-old with no weight gets the decision path and records",
    child.ok && !!child.data.id && child.data.weightDecision === DECISION && child.data.perDose === null,
    JSON.stringify(child.ok ? child.data.id : child));

  const adult = await noWeightDose(ADULT, DECISION);
  ok("9d. ⚠ an adult with no weight is REFUSED -- the status quo ante, unchanged",
    !adult.ok && adult.code === "CANNOT_CALCULATE" && adult.status === 422, JSON.stringify(adult));

  // ⚠ THE ASSERTION MOST LIKELY TO BE GOT SUBTLY WRONG, so it is checked word by word. A refusal that
  // named the decision would teach an adult's prescriber that a form of words exists which gets a number
  // out of this product, and the next refusal is one they argue with.
  ok("9d-words. ⚠ and the refusal names NO decision, NO justification and nothing to type",
    !adult.ok
    && !/decision/i.test(adult.message) && !/justif/i.test(adult.message)
    && !/say why/i.test(adult.message) && !/in one sentence/i.test(adult.message)
    && !/override/i.test(adult.message) && !/your own words/i.test(adult.message)
    && adult.message.endsWith(ADULT_NO_WEIGHT_REFUSED),
    !adult.ok ? adult.message : "");

  const adultNoDecision = await noWeightDose(ADULT, null);
  ok("9d-same. an adult who sent nothing gets the same sentence -- there is one road, not two",
    !adultNoDecision.ok && !adult.ok && adultNoDecision.message === adult.message);

  // CONTROL. Give the adult a weight and the same call computes -- so 9d is about the missing weight and
  // the age, not about a patient this engine simply refuses.
  await recordMeasurement(admin, ctxA, { patientId: ADULT, definitionId: WEIGHT, value: 70, unit: "kg", ...base });
  const adultWeighed = await noWeightDose(ADULT, null);
  ok("9d-control. ⚠ the SAME adult WITH a weight computes 1050 mg and stores it",
    adultWeighed.ok && adultWeighed.data.perDose === 1050 && !!adultWeighed.data.id,
    JSON.stringify(adultWeighed.ok ? adultWeighed.data.perDose : adultWeighed));

  const unknown = await noWeightDose(UNKNOWN, DECISION);
  ok("9e. ⚠ a patient with NO recorded age gets the decision path -- unknown is not adult",
    unknown.ok && !!unknown.data.id && unknown.data.weightDecision === DECISION,
    JSON.stringify(unknown.ok ? unknown.data.id : unknown));

  // ⚠ THE CONTROL THE FIXTURE NEEDS. Without it 9e passes for a patient who simply happens to be a child.
  const { data: unknownRow } = await admin.from("practice_patient")
    .select("birth_date, age_estimate_years").eq("id", UNKNOWN).single();
  ok("9e-control. ⚠ and that patient really has NO birth date and NO estimate",
    !!unknownRow && unknownRow.birth_date === null && unknownRow.age_estimate_years === null,
    JSON.stringify(unknownRow));

  const seventeen = await noWeightDose(SEVENTEEN, DECISION);
  const eighteen = await noWeightDose(EIGHTEEN, DECISION);
  ok("9f. ⚠ THE BOUNDARY: seventeen is a child and eighteen is not",
    seventeen.ok && !eighteen.ok && eighteen.code === "CANNOT_CALCULATE",
    JSON.stringify({ seventeen: seventeen.ok, eighteen: eighteen.ok ? "recorded" : eighteen.code }));

  const tomorrow = await noWeightDose(TOMORROW, DECISION);
  ok("9g. ⚠ a patient who turns 18 TOMORROW is still seventeen today",
    tomorrow.ok && !!tomorrow.data.id, JSON.stringify(tomorrow.ok ? tomorrow.data.id : tomorrow));

  const estimated = await noWeightDose(ESTIMATED, DECISION);
  ok("9h. an adult known only by an age ESTIMATE is refused too -- a recorded age is a recorded age",
    !estimated.ok && estimated.code === "CANNOT_CALCULATE", JSON.stringify(estimated));

  // The read path carries the same verdict, so the screen and the engine cannot disagree.
  const adultRecord = await patientMedications(admin, medCtx, ADULT, TODAY);
  const childRecord = await patientMedications(admin, medCtx, NEVER, TODAY);
  ok("9i. ⚠ the patient payload carries the SAME age verdict the gate uses",
    adultRecord.age.state === "adult" && !adultRecord.age.decisionPathOffered
    && childRecord.age.state === "child" && childRecord.age.decisionPathOffered,
    JSON.stringify({ adult: adultRecord.age, child: childRecord.age }));

  await cleanup();

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`  - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
