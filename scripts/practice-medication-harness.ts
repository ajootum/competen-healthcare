/**
 * CPR-MED-001 -- the medication record, its timeline, reconciliation, monitoring and s3's dose
 * arithmetic, ON THE MIDDLE PATH.
 *
 *   npx --yes tsx scripts/practice-medication-harness.ts
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * THE SIX ASSERTIONS THIS FILE EXISTS FOR. Everything else is scaffolding around them.
 *
 *  ⚠ 1. A CHECK THAT CANNOT RUN SAYS "NOT CHECKED" AND NEVER FALLS SILENT. MED s4's nine safety checks
 *       need a licensed drug knowledge base this product has not bought. Every one of them is in
 *       DEFERRED_SAFETY_CHECKS, travels in every payload the engine returns, and is printed by all three
 *       surfaces. An unwarned screen reads as a cleared screen -- migration 238's allergy lesson.
 *
 *  ⚠ 2. THE DOSE FIGURE CARRIES ITS WORKING AND MAKES NO SAFETY CLAIM. Every ok result has a non-empty
 *       `working`, and `safetyNotice` and `notChecked` are on the payload whether or not anything went
 *       wrong. The stored row freezes `safety_checks_not_run` with a cardinality >= 1 constraint behind
 *       it, so a prescription printed from this record can always say what nobody checked.
 *
 *  ⚠ 3. NO WEIGHT, NO NUMBER -- AND A STALE WEIGHT IS NOT A CURRENT ONE. LCP s9. The fixtures are
 *       arranged so the WRONG answer is the one a broken engine gives: a weight is supplied with NO
 *       monitoring plan behind it, which is exactly the shape that returns a green tick if the verdict
 *       is decided from the value instead of from the rule.
 *
 *  ⚠ 4. THE STORE IS ABSENT AND THE SURFACE SAYS SO. Migration 258 is written into medication.ts's
 *       header and has not been applied. Until it is, every read reports storeState "absent" naming the
 *       migration, and every write returns STORE_ABSENT with a 503. NOT an empty list -- "no medications
 *       recorded" is a clinical claim this deployment cannot make. When the migration lands, the
 *       store-present suite below runs instead and NO PRODUCT CODE CHANGES.
 *
 *  ⚠ 5. THE MIGRATION IN THE HEADER IS THE ONE THIS ENGINE NEEDS, AND IT SEEDS ITS CAPABILITIES WITH
 *       THE BACKFILL. Migration 239 seeded three codes and omitted the insert..select into
 *       practice_role_assignment, and all three were granted to nobody. Asserted here as a source scan,
 *       along with the no-semicolon-in-a-comment rule that silently shredded migration 238.
 *
 *  ⚠ 6. NOTHING UPDATES THE TIMELINE OR A DOSE CALCULATION. MED s10 "Historical data never overwritten"
 *       and LCP s9 "a later weight update must not recalculate or rewrite a historical prescription".
 *       Proved by a source scan, with a control that proves the scan can see such a write.
 *
 * EVERY REFUSAL IS PAIRED WITH A CONTROL. A function that returns "not checked" for everything is safe
 * and useless, and it passes assertion 1 on its own.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { loadEnvConfig } from "@next/env";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { ensureCoreLibrary, setActivation, recordMeasurement, upsertPlanEntry } from "../src/lib/practice/parameters";
import {
  medicationStorePresence, patientMedications, medicationWorklist, medicationTimeline,
  recordMedication, changeMedication, verifyMedication,
  calculateDose, setMedicationReview, dosingWeight,
  MEDICATION_MIGRATION, MEDICATION_TABLE, MEDICATION_EVENT_TABLE, MEDICATION_DOSE_TABLE,
} from "../src/lib/practice/medication";
import {
  MEDICATION_CAPABILITIES, DEFERRED_SAFETY_CHECKS, DEFERRED_CHECK_KEYS, MEDICATION_REFUSALS,
  MEDICATION_STATUS_CODES, MEDICATION_EVENT_TYPE_CODES, MEDICATION_SOURCE_CODES, DOSE_BASIS_CODES,
  weightLine, currentLine, verificationLine, reviewLine, reconciliationLine,
  doseSafetyNotice, allergyDisplayNotice, MEDICATION_LIST_BOUNDARY,
} from "../src/lib/practice/medication-constants";
import { doseArithmetic, CALCULATORS, DOSE_UNIT_CONVERSION_REFUSED } from "../src/lib/practice/clinical-calculators";
import {
  REFUSES, MEDICATION_BOUNDARY, MEDICATION_NOT_CURRENT_REASON,
} from "../src/lib/practice/patient-workspace-constants";
import { PRACTICE_NAV, PRIMARY_ORDER } from "../src/lib/practice/navigation";
import { purgeWorkspacesOwnedBy, cleanupOnKill } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const USER_A = "00000000-0000-4000-8000-0000000e0fd1";

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

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-med-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-med",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-med", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [USER_A]);
}

const base = { actorId: USER_A, correlationId: "harness-med" };
const TODAY = "2026-06-15";

/** Every .ts/.tsx file under the practice tree, for the source scans. */
function practiceSources(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e)) out.push({ path: p, text: readFileSync(p, "utf8") });
    }
  };
  walk(join(process.cwd(), "src", "lib", "practice"));
  walk(join(process.cwd(), "src", "app", "practice"));
  walk(join(process.cwd(), "src", "app", "api", "v1", "practice"));
  return out;
}

/**
 * The SQL of the migration, lifted out of medication.ts's header.
 *
 * ⚠ THE HEADER IS THE MIGRATION IN THIS BUILD, because supabase/migrations is held by another agent.
 * That makes it worth MORE scanning, not less: nobody will notice a defect in a comment until somebody
 * pastes it into a database.
 */
function headerSql(): { lines: string[]; text: string } {
  const src = readFileSync(join(process.cwd(), "src", "lib", "practice", "medication.ts"), "utf8");
  const all = src.split("\n");
  // ⚠ SLICED BY MARKERS, NOT FILTERED BY SHAPE. A shape filter pulled prose out of the TypeScript header
  // above and the ASCII assertion then failed on an em dash in a sentence that is not SQL -- which would
  // have been a real failure reported against the wrong thing.
  const start = all.findIndex(l => /^\/\/ -- MIGRATION 258:/.test(l));
  const end = all.findIndex(l => /^\/\/ notify pgrst, 'reload schema';$/.test(l));
  if (start < 0 || end < 0) return { lines: [], text: "" };
  const lines = all.slice(start - 1, end + 1).map(l => l.replace(/^\/\/ ?/, ""));
  return { lines, text: lines.join("\n") };
}

async function main() {
  await cleanup();
  const wsA = await provision(USER_A, "Medication Harness", "a");
  const ctxRes = await resolveWorkspaceContext(admin, USER_A, wsA);
  if (!ctxRes.ok) throw new Error("no context");
  const ctxA: WorkspaceContext = ctxRes.ctx;

  // ⚠ THE AUGMENTED CONTEXT, AND WHY IT IS HONEST RATHER THAN A CHEAT.
  //
  // The three medication codes are seeded by the migration in medication.ts's header, which has not been
  // applied -- assertion cap-1 below asserts exactly that, against the live catalogue, and names the
  // migration. Every engine test then runs against a context with the codes added, so the ENGINE's logic
  // is genuinely exercised rather than every call stopping at a 403 that would make the whole suite
  // vacuously green. When the migration lands, ctxA already carries them and this spread is a no-op.
  const medCtx: WorkspaceContext = {
    ...ctxA, capabilities: [...new Set([...ctxA.capabilities, ...MEDICATION_CAPABILITIES])],
  };
  const viewOnly: WorkspaceContext = {
    ...ctxA, capabilities: [...ctxA.capabilities.filter(c => !c.startsWith("medication.")), "medication.view"],
  };
  const recordNoOverride: WorkspaceContext = {
    ...ctxA, capabilities: [...ctxA.capabilities.filter(c => !c.startsWith("medication.")), "medication.view", "medication.record"],
  };

  const store = await medicationStorePresence(admin);

  // ══ 1. THE PURE READERS -- the sentences a prescriber reads ═══════════════════════════════════════
  section("1. NOT CHECKED IS NOT CHECKED (the readers)");

  ok("1a. ⚠ nine safety checks are deferred, each with a name, a reason and what would close it",
    DEFERRED_SAFETY_CHECKS.length === 9
    && DEFERRED_SAFETY_CHECKS.every(c => c.key && c.label && c.detail.length > 80 && c.wouldRequire.length > 20),
    `${DEFERRED_SAFETY_CHECKS.length} checks`);

  ok("1b. the four MED s4 checks that need a drug database are among them, by name",
    ["max_single_dose", "max_daily_dose", "duplicate_therapy", "allergy", "interaction"]
      .every(k => DEFERRED_CHECK_KEYS.includes(k as never)),
    DEFERRED_CHECK_KEYS.join(","));

  // ⚠ THE ALLERGY ONE CARRIES ITS REASON, and the reason is migration 238's. A future reader who deletes
  // this because "we could just match the strings" has to delete the sentence explaining why not.
  const allergyCheck = DEFERRED_SAFETY_CHECKS.find(c => c.key === "allergy")!;
  ok("1c. ⚠ the allergy check names FREE TEXT as the reason, not effort",
    /free text/i.test(allergyCheck.detail) && /worse than not checking/i.test(allergyCheck.detail));

  ok("1d. ⚠ the dose safety notice says what nobody checked, in the payload rather than in a document",
    /not a safety check/i.test(doseSafetyNotice())
    && /maximum/i.test(doseSafetyNotice()) && /kidney|renal/i.test(doseSafetyNotice()));

  ok("1e. ⚠ the allergy display notice says it is NOT matched",
    /NOT matched/i.test(allergyDisplayNotice()) && /free text/i.test(allergyDisplayNotice()));

  // ── weightLine. THE FIXTURES ARE ARRANGED SO THE WRONG ANSWER IS THE ONE A BROKEN ENGINE GIVES ─────
  section("2. LCP s9's WEIGHT VERDICT -- and the threshold it refuses to invent");

  const wAbsent = weightLine({ valueKg: null, effectiveAt: null, plausibility: null, due: null, daysOverdue: null, today: TODAY, unavailable: false });
  ok("2a. no weight is `absent`, is not reassuring, and refuses to be usable",
    wAbsent.state === "absent" && !wAbsent.reassuring && !wAbsent.usable, JSON.stringify(wAbsent));

  // ⚠ THE ASSERTION THIS WHOLE FILE TURNS ON. A weight EXISTS and is plausible, and NOTHING states when
  // another is due. An engine that decided from the value would return a tick here.
  const wUnjudged = weightLine({
    valueKg: 18.4, effectiveAt: "2026-01-05T09:00:00Z", plausibility: "plausible",
    due: "no_schedule", daysOverdue: null, today: TODAY, unavailable: false,
  });
  ok("2b. ⚠ a weight with NO plan behind it is `age_unjudged` and is NOT reassuring",
    wUnjudged.state === "age_unjudged" && !wUnjudged.reassuring && wUnjudged.usable
    && wUnjudged.ageDays === 161 && /does not call it current or stale/i.test(wUnjudged.text),
    JSON.stringify(wUnjudged));

  // CONTROL. 2b passes against a function that never reassures anybody. This is the one input that must.
  const wCurrent = weightLine({
    valueKg: 18.4, effectiveAt: "2026-06-01T09:00:00Z", plausibility: "plausible",
    due: "due_later", daysOverdue: null, today: TODAY, unavailable: false,
  });
  ok("2b-control. a weight a plan says is not yet due IS reassuring, so 2b is not vacuous",
    wCurrent.state === "current" && wCurrent.reassuring, JSON.stringify(wCurrent));

  const wStale = weightLine({
    valueKg: 18.4, effectiveAt: "2026-01-05T09:00:00Z", plausibility: "plausible",
    due: "overdue", daysOverdue: 40, today: TODAY, unavailable: false,
  });
  ok("2c. a weight the patient's own plan says is overdue is `stale` and names how late",
    wStale.state === "stale" && !wStale.reassuring && /40 days ago/.test(wStale.text), JSON.stringify(wStale));

  const wImplausible = weightLine({
    valueKg: 0.3, effectiveAt: "2026-06-01T09:00:00Z", plausibility: "implausible",
    due: "due_later", daysOverdue: null, today: TODAY, unavailable: false,
  });
  ok("2d. ⚠ implausible beats a satisfied schedule -- a typing error is not made safe by being recent",
    wImplausible.state === "implausible" && !wImplausible.reassuring, JSON.stringify(wImplausible));

  const wUnreadable = weightLine({ valueKg: null, effectiveAt: null, plausibility: null, due: null, daysOverdue: null, today: TODAY, unavailable: true });
  ok("2e. a failed read is `unreadable`, never `absent` -- the next action differs",
    wUnreadable.state === "unreadable" && !wUnreadable.reassuring
    && /not the same as having none/i.test(wUnreadable.text), JSON.stringify(wUnreadable));

  ok("2f. ⚠ exactly ONE of the six weight states is reassuring",
    (["absent", "implausible", "stale", "age_unjudged", "current", "unreadable"] as const)
      .filter(s => {
        const v = weightLine({
          valueKg: s === "absent" ? null : 18.4, effectiveAt: s === "absent" ? null : "2026-06-01T09:00:00Z",
          plausibility: s === "implausible" ? "implausible" : "plausible",
          due: s === "stale" ? "overdue" : s === "age_unjudged" ? "no_schedule" : "due_later",
          daysOverdue: s === "stale" ? 5 : null, today: TODAY, unavailable: s === "unreadable",
        });
        return v.reassuring;
      }).length === 1);

  // ── the other readers ─────────────────────────────────────────────────────────────────────────────
  section("3. CURRENT, VERIFIED, REVIEWED, RECONCILED");

  const cActive = currentLine({ status: "active", startedOn: "2026-06-01", stoppedOn: null, today: TODAY, unavailable: false });
  const cStopped = currentLine({ status: "discontinued", startedOn: "2026-01-01", stoppedOn: "2026-03-01", today: TODAY, unavailable: false });
  ok("3a. `current` is derivable for a medication row -- the status decides, the dates check",
    cActive.inUse && cActive.state === "in_use" && !cStopped.inUse && cStopped.state === "stopped",
    JSON.stringify({ cActive, cStopped }));

  // ⚠ THE CONTRADICTION IS REPORTED, NOT RESOLVED. An active row whose stop date has passed is somebody
  // forgetting to close it, and quietly picking either answer hides the thing a human must fix.
  const cContradiction = currentLine({ status: "active", startedOn: "2026-01-01", stoppedOn: "2026-03-01", today: TODAY, unavailable: false });
  ok("3b. ⚠ an active row with a stop date in the past is reported as a contradiction, not silently resolved",
    !cContradiction.inUse && /somebody needs to close this row/i.test(cContradiction.text), cContradiction.text);

  const vUnverified = verificationLine({ source: "patient_reported", verifiedAt: null, unavailable: false });
  const vVerified = verificationLine({ source: "patient_reported", verifiedAt: "2026-06-10T09:00:00Z", unavailable: false });
  const vPractitioner = verificationLine({ source: "practitioner", verifiedAt: null, unavailable: false });
  ok("3c. LCP s9: a patient-reported row is unverified until reviewed, and a practitioner's is not",
    vUnverified.state === "unverified" && !vUnverified.practitionerBacked
    && vVerified.state === "verified" && vVerified.practitionerBacked
    && vPractitioner.state === "practitioner_recorded" && vPractitioner.practitionerBacked,
    JSON.stringify({ vUnverified, vVerified, vPractitioner }));

  const rOverdue = reviewLine({ nextReviewOn: "2026-06-01", reviewIntervalDays: 90, status: "active", today: TODAY, unavailable: false });
  const rNone = reviewLine({ nextReviewOn: null, reviewIntervalDays: null, status: "active", today: TODAY, unavailable: false });
  const rDiscontinued = reviewLine({ nextReviewOn: "2026-01-01", reviewIntervalDays: 90, status: "discontinued", today: TODAY, unavailable: false });
  ok("3d. a review is overdue by a number of days, `no_review_set` is its own state, and a discontinued course owes nothing",
    rOverdue.state === "overdue" && rOverdue.daysOverdue === 14
    && rNone.state === "no_review_set" && rDiscontinued.state === "not_applicable",
    JSON.stringify({ rOverdue, rNone, rDiscontinued }));

  // ⚠ ZERO OUTSTANDING IS NOT RECONCILED. A practice that has never asked has nothing outstanding either.
  const recNever = reconciliationLine({ unverified: 0, legacyOnly: 0, total: 3, everReviewed: false, unavailable: false });
  const recDone = reconciliationLine({ unverified: 0, legacyOnly: 0, total: 3, everReviewed: true, unavailable: false });
  const recOutstanding = reconciliationLine({ unverified: 2, legacyOnly: 1, total: 5, everReviewed: true, unavailable: false });
  ok("3e. ⚠ nothing outstanding but nothing reviewed is `never_reviewed` and is NOT reassuring",
    recNever.state === "never_reviewed" && !recNever.reassuring
    && /empty worklist is not a reconciled record/i.test(recNever.text), JSON.stringify(recNever));
  ok("3e-control. a list that HAS been reviewed is reconciled and IS reassuring, so 3e is not vacuous",
    recDone.state === "reconciled" && recDone.reassuring, JSON.stringify(recDone));
  ok("3f. outstanding work names both halves and both are lengths you can open",
    recOutstanding.state === "outstanding" && !recOutstanding.reassuring
    && recOutstanding.unverified === 2 && recOutstanding.legacyOnly === 1, JSON.stringify(recOutstanding));

  // ══ 4. MED s3 -- THE ARITHMETIC, AND WHAT IT REFUSES ══════════════════════════════════════════════
  section("4. THE DOSE ARITHMETIC (s3), AND THE THREE THINGS IT WILL NOT DO");

  const dNoWeight = doseArithmetic({ basis: "mg_per_kg", dosePerUnit: 15, weightKg: null });
  ok("4a. ⚠ NO WEIGHT, NO NUMBER. A weight-based dose refuses rather than assuming one",
    !dNoWeight.ok && /no usable weight/i.test(dNoWeight.message), JSON.stringify(dNoWeight));

  const dWeight = doseArithmetic({ basis: "mg_per_kg", dosePerUnit: 15, weightKg: 18.4 });
  ok("4a-control. with a weight it computes, so 4a is not a function that always refuses",
    dWeight.ok && dWeight.perDose === 276 && dWeight.working.length >= 3, JSON.stringify(dWeight));

  const dDailyNoFreq = doseArithmetic({ basis: "mg_per_kg_per_day", dosePerUnit: 40, weightKg: 18.4 });
  ok("4b. ⚠ a mg/kg/day regimen with NO stated frequency returns the DAILY TOTAL and withholds the per-dose figure",
    dDailyNoFreq.ok && dDailyNoFreq.perDose === null && dDailyNoFreq.dailyTotal === 736
    && dDailyNoFreq.working.some(w => /NOT computed/.test(w)), JSON.stringify(dDailyNoFreq));

  const dDailyFreq = doseArithmetic({ basis: "mg_per_kg_per_day", dosePerUnit: 40, weightKg: 18.4, dosesPerDay: 4 });
  ok("4b-control. with a stated frequency the per-dose figure IS computed, so 4b is not vacuous",
    dDailyFreq.ok && dDailyFreq.perDose === 184 && dDailyFreq.dailyTotal === 736, JSON.stringify(dDailyFreq));

  const dBsa = doseArithmetic({ basis: "mg_per_m2", dosePerUnit: 100, weightKg: 18.4, heightCm: 110 });
  ok("4c. mg/m2 uses the SAME Mosteller function the BSA calculator uses, and shows the BSA it got",
    dBsa.ok && dBsa.bsaM2 === 0.75 && dBsa.working.some(w => /Mosteller|sqrt/.test(w)), JSON.stringify(dBsa));

  const bsaDirect = CALCULATORS.find(c => c.key === "bsa")!.compute({ weight: "18.4", height: "110" });
  ok("4c-control. and it is genuinely the same number the standalone calculator returns",
    bsaDirect.ok && dBsa.ok && bsaDirect.value === dBsa.bsaM2, JSON.stringify({ bsaDirect, dBsa }));

  const dFixed = doseArithmetic({ basis: "fixed", dosePerUnit: null, fixedDose: 500, weightKg: null });
  ok("4d. ⚠ a fixed dose still returns WORKING, saying no calculation was performed",
    dFixed.ok && dFixed.working.length >= 2 && /no calculation was performed/i.test(dFixed.working[0]),
    JSON.stringify(dFixed));

  ok("4e. every basis that returns a figure returns at least two lines of working",
    DOSE_BASIS_CODES.every(b => {
      const r = doseArithmetic({
        basis: b as never, dosePerUnit: 10, fixedDose: 500, weightKg: 20, heightCm: 110, dosesPerDay: 2,
      });
      return r.ok && r.working.length >= 2 && r.formula.length > 0;
    }));

  const dSilly = doseArithmetic({ basis: "mg_per_kg", dosePerUnit: 15, weightKg: 900 });
  ok("4f. an implausible weight is refused by the arithmetic too, not just by the verdict",
    !dSilly.ok && /outside the range/i.test(dSilly.message), JSON.stringify(dSilly));

  ok("4g. ⚠ dose UNITS are echoed and never converted, and the refusal says why",
    /never converted/i.test(DOSE_UNIT_CONVERSION_REFUSED) && /international unit/i.test(DOSE_UNIT_CONVERSION_REFUSED));

  // ══ 5. THE STALE REFUSAL WAS REWRITTEN, NOT DELETED ═══════════════════════════════════════════════
  section("5. THE REFUSALS THIS BUILD CHANGED");

  const calcSrc = readFileSync(join(process.cwd(), "src", "lib", "practice", "clinical-calculators.ts"), "utf8");
  ok("5a. ⚠ clinical-calculators.ts no longer STATES `NO DOSING CALCULATORS` as its own rule",
    !/^\/\/ NO DOSING CALCULATORS\./m.test(calcSrc));
  ok("5b. ⚠ but it QUOTES the old refusal and says which half survived -- a deleted warning is worse than a stale one",
    /NO DOSING CALCULATORS/.test(calcSrc)
    && /EXACTLY ZERO OF THE FOUR HAVE BEEN MET/.test(calcSrc)
    && /THE SAFETY CLAIM IS NOT/.test(calcSrc));

  const pwSrc = readFileSync(join(process.cwd(), "src", "lib", "practice", "patient-workspace-constants.ts"), "utf8");
  const currentRefusal = REFUSES.find(r => r.key === "current_medications");
  ok("5c. ⚠ REFUSES.current_medications still EXISTS -- it stays true for practice_treatment rows",
    !!currentRefusal && /practice_treatment\.duration is FREE TEXT/.test(currentRefusal.detail));
  ok("5d. ⚠ and it was REWRITTEN: it now names the store where a current list IS derivable",
    !!currentRefusal && /practice_medication/.test(currentRefusal.detail)
    && /reconciliation list/i.test(currentRefusal.detail));
  ok("5e. MEDICATION_BOUNDARY and MEDICATION_NOT_CURRENT_REASON survive and both name their table",
    /NOT a current-medication list/.test(MEDICATION_BOUNDARY)
    && /medication record/i.test(MEDICATION_BOUNDARY)
    && /practice_treatment\.duration/.test(MEDICATION_NOT_CURRENT_REASON)
    && /from these rows/i.test(MEDICATION_NOT_CURRENT_REASON));
  ok("5e-control. the source file really was read (the scan is not passing on an empty string)",
    pwSrc.length > 5000 && calcSrc.length > 5000);

  ok("5f. the new list boundary says what is NOT in it -- legacy rows and anything prescribed elsewhere",
    /Medications decided in a consultation before this record existed/.test(MEDICATION_LIST_BOUNDARY)
    && /prescribed elsewhere/.test(MEDICATION_LIST_BOUNDARY));

  ok("5g. three things this engine will not claim are exported with reasons",
    MEDICATION_REFUSALS.length === 3
    && MEDICATION_REFUSALS.every(r => r.detail.length > 100 && r.wouldRequire.length > 20)
    && MEDICATION_REFUSALS.some(r => r.key === "medication_warning_store"));

  // ══ 6. THE MIGRATION IN THE HEADER ════════════════════════════════════════════════════════════════
  section("6. THE DDL IN THE ENGINE HEADER (migration 258, not yet applied)");

  const sql = headerSql();
  ok("6a-control. the header extractor actually found SQL",
    sql.text.length > 4000 && sql.lines.length > 100, `${sql.text.length} chars, ${sql.lines.length} lines`);

  // ⚠ THIS ASSERTION EXISTS BECAUSE THE COLLISION HAPPENED, MID-BUILD, WHILE THIS FILE WAS BEING
  // WRITTEN. The header said 257 and 257-guidance-archived-reason-not-blank.sql was written, applied and
  // committed by another agent in the same session. A file telling a future reader "apply 257" when 257
  // is a different migration is worse than no note at all: they apply it, see "Success", and wonder why
  // nothing changed. The number is now checked against the directory on every run.
  const migrationDir = join(process.cwd(), "supabase", "migrations");
  const applied = existsSync(migrationDir) ? readdirSync(migrationDir) : [];
  const claimed = MEDICATION_MIGRATION.split("-")[0];
  // ⚠ TURNED ROUND WHEN THE MIGRATION LANDED, AND THE ORIGINAL WOULD NOW BE WRONG. As first written
  // this asserted the number was FREE, which was right while the file was unwritten and became false the
  // moment 258-practice-medication.sql was created -- by this engine's own migration, correctly. An
  // assertion that fails when the thing it guards SUCCEEDS is the stale-refusal class this codebase has
  // corrected five times this week, and re-pinning it to "free" would have meant deleting the migration.
  //
  // The real claim was never "the number is unused". It was "the number this engine tells a reader to
  // apply belongs to THIS migration and not somebody else's" -- which is what the 257 collision broke and
  // what this now checks by NAME. A number taken by a different file still fails, which is the case that
  // mattered.
  // ⚠ MEDICATION_MIGRATION IS A SENTENCE, NOT A FILENAME. It reads
  // "258-practice-medication (practice_medication + practice_medication_event + ...)" because it is
  // printed in the absent-store message so nobody has to guess what is missing. Comparing it whole
  // against the directory can never match, which is how the first version of this fix failed -- and
  // failed CORRECTLY, rather than passing for the wrong reason. The stem is everything before the first
  // space.
  const claimedFile = `${MEDICATION_MIGRATION.split(" ")[0]}.sql`;
  const atClaimed = applied.filter(f => f.startsWith(`${claimed}-`));
  ok("6a2. ⚠ the migration number this engine claims is unused, or is this engine's own file",
    atClaimed.length === 0 || (atClaimed.length === 1 && atClaimed[0] === claimedFile),
    `${claimed} -> ${atClaimed.join(", ") || "free"} (engine names ${claimedFile})`);
  ok("6a2-control. the migration directory really was read, and the number before it IS taken",
    applied.length > 200 && applied.some(f => f.startsWith(`${Number(claimed) - 1}-`)),
    `${applied.length} migrations`);

  ok("6b. all three tables are created, and only three",
    /create table if not exists practice_medication \(/.test(sql.text)
    && /create table if not exists practice_medication_event \(/.test(sql.text)
    && /create table if not exists practice_medication_dose_calculation \(/.test(sql.text)
    && (sql.text.match(/create table if not exists/g) ?? []).length === 3);

  // ⚠ THE FOUR TABLES THE SURVEY PROPOSED AND THIS BUILD DECLINED. An empty drug-rule table is the whole
  // failure mode this scope decision avoids, so its ABSENCE is asserted rather than assumed.
  ok("6c. ⚠ no rule table, no warning table -- an empty rule table makes every check return `nothing to say`",
    !/create table if not exists practice_medication_rule/.test(sql.text)
    && !/create table if not exists practice_medication_warning/.test(sql.text)
    && !/create table if not exists practice_medication_monitoring/.test(sql.text)
    && !/create table if not exists practice_medication_favourite/.test(sql.text));

  // ⚠ THE TRAP THAT WAS ALREADY PAID FOR. practice_treatment.encounter_id is NOT NULL.
  ok("6d. ⚠ NOT ONE COLUMN IS ADDED TO practice_treatment",
    !/alter table practice_treatment/.test(sql.text)
    && /treatment_id uuid references practice_treatment\(id\)/.test(sql.text));

  ok("6e. encounter_id on the medication is NULLABLE -- the whole reason the table exists",
    /encounter_id uuid references practice_encounter\(id\),/.test(sql.text)
    && !/encounter_id uuid not null/.test(sql.text));

  ok("6f. ⚠ all three capability codes are seeded",
    MEDICATION_CAPABILITIES.every(c => new RegExp(`'${c.replace(".", "\\.")}'`).test(sql.text)));

  // ⚠ MIGRATION 239 SEEDED THREE CODES AND OMITTED THIS, AND ALL THREE WERE GRANTED TO NOBODY.
  ok("6g. ⚠ and the BACKFILL into practice_role_assignment is there",
    /insert into practice_role_assignment \(membership_id, capability_code, source\)/.test(sql.text)
    && /join practice_role_capabilities c on c\.role_code = m\.role_code/.test(sql.text)
    && /where m\.status = 'active'/.test(sql.text));

  ok("6h. RLS is enabled on every table and pgrst is reloaded last",
    /alter table practice_medication enable row level security/.test(sql.text)
    && /alter table practice_medication_event enable row level security/.test(sql.text)
    && /alter table practice_medication_dose_calculation enable row level security/.test(sql.text)
    && sql.lines.filter(l => l.trim()).pop()?.trim() === "notify pgrst, 'reload schema';");

  // ⚠ A SEMICOLON IN A COMMENT SILENTLY SHREDDED MIGRATION 238 WHILE REPORTING "Success. No rows returned".
  const commentSemicolons = sql.lines.filter(l => /^\s*--/.test(l) && l.includes(";"));
  ok("6i. ⚠ NO SEMICOLON IN ANY COMMENT LINE -- the runner splits the file on them",
    commentSemicolons.length === 0, commentSemicolons.slice(0, 3).join(" | "));
  // CONTROL. 6i passes trivially against a scan that matches no lines at all.
  ok("6i-control. the comment scan does see comment lines, so 6i is not vacuous",
    sql.lines.filter(l => /^\s*--/.test(l)).length > 60,
    `${sql.lines.filter(l => /^\s*--/.test(l)).length} comment lines`);

  const nonAscii = sql.lines.filter(l => /[^\x00-\x7F]/.test(l));
  ok("6j. the DDL is ASCII only", nonAscii.length === 0, nonAscii.slice(0, 2).join(" | "));

  ok("6k. no plpgsql and no do-blocks",
    !/\$\$/.test(sql.text) && !/^\s*do\s/im.test(sql.text));

  // ⚠ cardinality, NOT array_length. array_length('{}', 1) is NULL and a NULL check constraint PASSES.
  ok("6l. ⚠ the `what was not checked` array uses cardinality, so an empty array cannot sail through",
    /check \(cardinality\(safety_checks_not_run\) >= 1\)/.test(sql.text)
    && !/array_length\(safety_checks_not_run/.test(sql.text));

  ok("6m. the three acts that are meaningless without words are refused by the DATABASE, not by code",
    /check \(event_type not in \('dose_changed', 'discontinued', 'safety_override'\)/.test(sql.text)
    && /char_length\(btrim\(reason\)\) > 0/.test(sql.text));

  ok("6n. `working` is NOT NULL with a non-empty check -- s3's transparent display is a column, not a preference",
    /working text not null check \(char_length\(btrim\(working\)\) > 0\)/.test(sql.text));

  ok("6o. neither immutable table has an updated_at",
    !/practice_medication_event[\s\S]*?updated_at[\s\S]*?\);/.test(sql.text.split("create table if not exists practice_medication_dose_calculation")[0].split("create table if not exists practice_medication_event")[1] ?? ""));

  // ══ 7. NOTHING UPDATES THE APPEND-ONLY TABLES ═════════════════════════════════════════════════════
  section("7. HISTORY IS NEVER REWRITTEN (source scan)");

  const sources = practiceSources();
  const updatesOn = (table: string) => sources.filter(f =>
    new RegExp(`from\\(\\s*(?:"${table}"|${table.toUpperCase().replace(/[a-z_]/g, "")})`).test(f.text)
    && new RegExp(`from\\([^)]*${table}[^)]*\\)\\s*\\n?\\s*\\.update\\(`).test(f.text));

  const eventUpdates = sources.filter(f => /\.from\((MEDICATION_EVENT_TABLE|"practice_medication_event")\)\s*\.?\s*\n?\s*\.update\(/.test(f.text));
  const doseUpdates = sources.filter(f => /\.from\((MEDICATION_DOSE_TABLE|"practice_medication_dose_calculation")\)\s*\.?\s*\n?\s*\.update\(/.test(f.text));
  ok("7a. ⚠ nothing in the practice tree UPDATEs the medication timeline or a dose calculation",
    eventUpdates.length === 0 && doseUpdates.length === 0,
    [...eventUpdates, ...doseUpdates].map(f => f.path).join(", "));

  // CONTROL. 7a passes against a scan that cannot see an update at all.
  const scanCanSee = /\.from\((MEDICATION_EVENT_TABLE|"practice_medication_event")\)\s*\.?\s*\n?\s*\.update\(/
    .test(`await admin.from(MEDICATION_EVENT_TABLE).update({ reason: "x" })`);
  ok("7a-control. the scan CAN see such a write, so 7a is not vacuous", scanCanSee);
  ok("7a-control-b. and the scan really read the practice tree",
    sources.length > 100 && updatesOn("practice_medication").length >= 0, `${sources.length} files`);

  // ⚠ THE PARENT IS UPDATED AND THAT IS CORRECT. 7a passes against an engine that writes nothing at all.
  const medUpdates = sources.filter(f => /\.from\(MEDICATION_TABLE\)\s*\n?\s*\.update\(/.test(f.text));
  ok("7b-control. the medication row itself IS updated somewhere -- current state must be able to change",
    medUpdates.length >= 1, medUpdates.map(f => f.path).join(", "));

  // ⚠ ONE-CLICK CARRY-FORWARD OF A DOSE. carryForwardTreatment copies a free-text dose as TEXT.
  const medSrc = readFileSync(join(process.cwd(), "src", "lib", "practice", "medication.ts"), "utf8");
  ok("7c. ⚠ the legacy free-text dose is carried as TEXT and is never parsed into a number",
    /THE FREE-TEXT DOSE IS CARRIED AS TEXT AND IS NOT PARSED/.test(medSrc)
    && !/parseFloat\(t\.dose|Number\(t\.dose/.test(medSrc));

  // ══ 8. EVERY SURFACE PRINTS WHAT WAS NOT CHECKED ══════════════════════════════════════════════════
  section("8. THE THREE SURFACES, AND THE PANEL NONE OF THEM MAY OMIT");

  const surfaces = [
    join(process.cwd(), "src", "app", "practice", "(shell)", "patients", "[patientId]", "MedicationPanel.tsx"),
    join(process.cwd(), "src", "app", "practice", "(shell)", "encounters", "[encounterId]", "MedicationConsole.tsx"),
    join(process.cwd(), "src", "app", "practice", "(shell)", "medications", "page.tsx"),
  ];
  ok("8a-control. all three surfaces exist and were read",
    surfaces.every(p => existsSync(p) && readFileSync(p, "utf8").length > 2000));
  ok("8a. ⚠ all three render the not-checked panel",
    surfaces.every(p => /NotCheckedPanel/.test(readFileSync(p, "utf8"))));

  const consoleSrc = readFileSync(surfaces[1], "utf8");
  ok("8b. ⚠ the prescribing console renders the working AND the safety notice with the figure",
    /dose\.working\.map/.test(consoleSrc) && /doseSafetyNotice\(\)/.test(consoleSrc));
  ok("8c. ⚠ and it renders the allergy list beside the form, with the sentence saying it is not matched",
    /record\.allergies\.items/.test(consoleSrc) && /record\.allergyNotice/.test(consoleSrc));
  ok("8d. ⚠ the override reason field appears ONLY for a stale or implausible weight",
    /overrideOffered = needsWeight && \(record\.weight\.state === "stale" \|\| record\.weight\.state === "implausible"\)/.test(consoleSrc));

  const worklistSrc = readFileSync(surfaces[2], "utf8");
  ok("8e. the practice page names the missing migration rather than leaving a reader to guess",
    /store\.migration/.test(worklistSrc) && /store\.tables\.map/.test(worklistSrc));

  // ══ 9. NAVIGATION -- NINE ITEMS, AND THE PAGE SHIPS FIRST ═════════════════════════════════════════
  section("9. NAVIGATION");

  ok("9a. ⚠ /practice/medications has NO nav entry -- CPR-MED-001 contains no navigation section",
    !PRACTICE_NAV.some(i => i.href.startsWith("/practice/medications")));
  // ⚠ THIS PINNED "NINE" AND THE SIDEBAR WAS LEGITIMATELY REFROZEN AT ELEVEN.
  //
  // CPR-V5-002 froze PRIMARY_ORDER at nine; CPR-HFE-001 v1.1 superseded that with eleven items in
  // five sections, and practice-handle-reachability-harness carries the authoritative pin ("PRIMARY_ORDER
  // is CPR-HFE-001 v1.1's eleven, in order", written out in full, green today). This assertion was a
  // SECOND COPY of a number that lives somewhere else, so a decision taken properly in one place
  // reddened a harness in another.
  //
  // THE CLAIM HERE WAS NEVER ABOUT THE NUMBER. It is "my feature added nothing to the sidebar", and
  // that is now asserted two ways that cannot go stale: the primary list agrees with PRIMARY_ORDER
  // (one source of truth, whatever it holds), and this domain contributes none of it.
  ok("9b. and the primary list is exactly PRIMARY_ORDER -- medications contributes none of it",
    PRACTICE_NAV.filter(i => i.primary).length === PRIMARY_ORDER.length
    && PRACTICE_NAV.filter(i => i.primary).every(i => PRIMARY_ORDER.includes(i.href)),
    `${PRACTICE_NAV.filter(i => i.primary).length} vs ${PRIMARY_ORDER.length}`);
  ok("9c-control. PRACTICE_NAV really was loaded", PRACTICE_NAV.length >= PRIMARY_ORDER.length);
  ok("9d. the page exists, so an entry added later cannot be a 404",
    existsSync(join(process.cwd(), "src", "app", "practice", "(shell)", "medications", "page.tsx")));
  ok("9e. the current-activity harness carries the written reason for having no entry",
    /medications: "CPR-MED-001 has no navigation section/.test(
      readFileSync(join(process.cwd(), "scripts", "practice-current-activity-harness.ts"), "utf8")));

  // ══ 10. THE LIVE STORE ════════════════════════════════════════════════════════════════════════════
  section(`10. THE STORE (${store.state.toUpperCase()})`);

  ok("10a. the store presence is asked of the database, three tables, one answer",
    store.tables.length === 3 && store.migration === MEDICATION_MIGRATION
    && store.tables.map(t => t.table).sort().join(",")
    === [MEDICATION_TABLE, MEDICATION_EVENT_TABLE, MEDICATION_DOSE_TABLE].sort().join(","),
    JSON.stringify(store));

  const { data: caps } = await admin.from("practice_role_capabilities").select("capability_code");
  const seeded = new Set(((caps ?? []) as { capability_code: string }[]).map(c => c.capability_code));
  const seededMed = MEDICATION_CAPABILITIES.filter(c => seeded.has(c));
  ok("10b-control. the capability catalogue really was read", seeded.size >= 40, `${seeded.size} codes`);

  // ── Fixtures: a patient, the core parameter library, an activated weight and one measurement ───────
  const patientRes = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Dose Child", sex: "female", birthDate: "2020-04-01",
    phone: "+256700000501",
    actorId: USER_A, correlationId: "harness-med",
  });
  const patient = patientRes.ok ? patientRes.data.id : null;
  await ensureCoreLibrary(admin);
  const { data: defs } = await admin.from("practice_parameter_definition")
    .select("id, code").is("workspace_id", null).in("code", ["weight", "standing_height"]);
  const defRows = (defs ?? []) as { id: string; code: string }[];
  const WEIGHT = defRows.find(d => d.code === "weight")!.id;
  const HEIGHT = defRows.find(d => d.code === "standing_height")!.id;
  await setActivation(admin, ctxA, { definitionId: WEIGHT, state: "active", collectionRule: "every_visit", ...base });
  await setActivation(admin, ctxA, { definitionId: HEIGHT, state: "active", collectionRule: "every_visit", ...base });
  ok("10c-control. the fixtures are real: a patient and an activated weight parameter",
    !!patient && !!WEIGHT && !!HEIGHT, JSON.stringify({ patient, WEIGHT, HEIGHT }));

  const noWeightYet = patient ? await dosingWeight(admin, medCtx, patient) : null;
  ok("10d. ⚠ with nothing weighed, the verdict is `absent` and refuses to be usable",
    !!noWeightYet && noWeightYet.verdict.state === "absent" && !noWeightYet.verdict.usable,
    JSON.stringify(noWeightYet?.verdict));

  if (patient) {
    await recordMeasurement(admin, ctxA, { patientId: patient, definitionId: WEIGHT, value: 18.4, unit: "kg", ...base });
    await recordMeasurement(admin, ctxA, { patientId: patient, definitionId: HEIGHT, value: 110, unit: "cm", ...base });
  }

  const weighed = patient ? await dosingWeight(admin, medCtx, patient) : null;
  // ⚠ THE LIVE VERSION OF 2b. A weight now EXISTS, is plausible, and NO MONITORING PLAN governs it. A
  // green tick here would be the engine reassuring from the value.
  ok("10e. ⚠ a recorded weight with no monitoring plan reads `age_unjudged`, NOT a tick",
    !!weighed && weighed.verdict.state === "age_unjudged" && !weighed.verdict.reassuring
    && weighed.verdict.valueKg === 18.4 && !!weighed.measurement.measurementId,
    JSON.stringify(weighed?.verdict));

  // CONTROL. Give the weight a plan whose next due date is in the future, live.
  if (patient) {
    await upsertPlanEntry(admin, ctxA, {
      patientId: patient, definitionId: WEIGHT, state: "required", schedule: "monthly",
      reason: "harness control: a plan that states when the next weight is due", ...base,
    });
  }
  const planned = patient ? await dosingWeight(admin, medCtx, patient) : null;
  ok("10e-control. ⚠ once a plan states when the next one is due, the SAME weight becomes `current`",
    !!planned && planned.verdict.state === "current" && planned.verdict.reassuring,
    JSON.stringify(planned?.verdict));

  // ── the record read ───────────────────────────────────────────────────────────────────────────────
  const record = patient ? await patientMedications(admin, medCtx, patient) : null;
  ok("10f. ⚠ the nine deferred checks travel in the PATIENT payload, not in a document",
    !!record && record.notChecked.length === 9 && record.allergyNotice.length > 50);

  const denied = patient ? await patientMedications(admin, { ...ctxA, capabilities: [] }, patient) : null;
  ok("10f-control. a caller without medication.view gets permitted:false, not an empty list",
    !!denied && !denied.permitted && denied.active.length === 0);

  const worklist = await medicationWorklist(admin, medCtx);
  ok("10g. the worklist payload carries the same nine checks and the same boundary",
    worklist.notChecked.length === 9 && worklist.boundary === MEDICATION_LIST_BOUNDARY);

  // ── 10h. THE WORKLIST RUNS ON THE PRACTICE'S CLOCK, NOT THE SERVER'S ──────────────────────────
  //
  // ⚠ medicationWorklist USED TO TAKE `today = todayIso()` -- the server's UTC day -- AS A DEFAULT,
  // and every caller outside the engine omitted the argument, so the default was the production
  // value on /practice/medications and its API route. reviewsOverdue and daysOverdue were computed
  // on it while the Intelligence medication panel counted the same rows on the practice day. The two
  // surfaces disagreed for three hours every evening and nothing on either one showed it.
  //
  // ⚠ THE ZONE IS CHOSEN AT RUNTIME SO THIS TEST NEVER PASSES BY LUCK. A fixed zone would only
  // expose the bug during the hours its day happens to differ from UTC's -- which is exactly how the
  // bug survived. UTC+14 differs from UTC whenever the UTC hour is >= 10; UTC-11 differs whenever it
  // is < 10. One of the two always differs, so the assertion below has teeth at every hour.
  const utcHour = new Date().getUTCHours();
  const skewZone = utcHour >= 10 ? "Pacific/Kiritimati" : "Pacific/Niue";
  const zoneDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: skewZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const utcDay = new Date().toISOString().slice(0, 10);
  ok("10h-control. ⚠ the chosen zone is on a DIFFERENT DAY from the server right now",
    zoneDay !== utcDay, `${skewZone} is on ${zoneDay}, the server on ${utcDay}`);

  // A medication whose review falls due on the PRACTICE's today. On the server's day it is either
  // not yet due (zone ahead) or overdue by a day (zone behind) -- never exactly today.
  await admin.from("practice_workspace").update({ timezone: skewZone }).eq("id", wsA);
  const { data: dueMed, error: dueErr } = await admin.from(MEDICATION_TABLE).insert({
    workspace_id: wsA, patient_id: patient, generic_name: "ClockTestDrug",
    dose_text: "1 tab", status: "active", next_review_on: zoneDay,
  }).select("id").maybeSingle();
  // ⚠ THE ERROR IS REPORTED, NOT DISCARDED. A `!!dueMed` that reads `null` says the row is absent
  // and nothing about why -- which sends the next reader looking at the engine instead of the insert.
  ok("10h-fixture. a medication exists with its review due on the practice's today",
    !!dueMed, dueErr ? `${dueErr.code}: ${dueErr.message}` : JSON.stringify(dueMed));

  const skewed = await medicationWorklist(admin, medCtx);
  const dueIds = skewed.reviewsOverdue.permitted ? skewed.reviewsOverdue.items.map(r => r.id) : [];
  ok("10h. ⚠ a review due on the PRACTICE's today is on the worklist, whatever day the server is on",
    !!dueMed && dueIds.includes(dueMed.id),
    `worklist ran on ${skewZone}; server day ${utcDay}; ids ${JSON.stringify(dueIds)}`);

  // CONTROL. 10h would pass against an engine that simply called everything due.
  const { data: futureMed, error: futureErr } = await admin.from(MEDICATION_TABLE).insert({
    workspace_id: wsA, patient_id: patient, generic_name: "ClockTestFuture",
    dose_text: "1 tab", status: "active",
    // Three days on, computed here rather than imported: the engine's own addDays is not exported,
    // and a control that borrowed the engine's arithmetic would be the engine checking itself.
    next_review_on: new Date(Date.parse(`${zoneDay}T00:00:00Z`) + 3 * 86400000).toISOString().slice(0, 10),
  }).select("id").maybeSingle();
  const after = await medicationWorklist(admin, medCtx);
  const afterIds = after.reviewsOverdue.permitted ? after.reviewsOverdue.items.map(r => r.id) : [];
  ok("10h-control-b. and one due three days out is NOT, so 10h is not counting everything",
    !!futureMed && !afterIds.includes(futureMed.id),
    futureErr ? `${futureErr.code}: ${futureErr.message}` : JSON.stringify(afterIds));

  // Put the fixture back, so nothing after this point inherits a skewed clock.
  await admin.from("practice_workspace").update({ timezone: "Africa/Kampala" }).eq("id", wsA);
  await admin.from(MEDICATION_TABLE).delete().in(
    "id", [dueMed?.id, futureMed?.id].filter(Boolean) as string[]);

  // ══ 11. TWO SUITES: the store-absent contract, or the full flow ═══════════════════════════════════
  if (!store.present) {
    section("11. STORE ABSENT -- the contract this deployment actually ships");
    console.log(`  (migration "${MEDICATION_MIGRATION}" has not been applied)`);

    ok("11a. ⚠ the three capability codes are NOT yet seeded, and the migration that seeds them is named",
      seededMed.length === 0,
      `seeded: ${seededMed.join(",") || "none"} -- expected none until ${MEDICATION_MIGRATION}`);

    ok("11b. ⚠ the patient record reports storeState `absent`, NOT an empty list",
      !!record && record.storeState === "absent" && !!record.storeNotice
      && /has not been applied/.test(record.storeNotice)
      && /NOT an empty medication list/.test(record.storeNotice), JSON.stringify(record?.storeNotice));

    ok("11c. ⚠ and it is NOT reported as reconciled -- with no store there is nothing to reconcile into",
      !!record && !record.reconciliation.reassuring, JSON.stringify(record?.reconciliation));

    ok("11d. the legacy treatments, the allergies and the weight are STILL read -- they live in tables that exist",
      !!record && !record.legacy.unavailable && !record.allergies.unavailable
      && record.weight.state !== "unreadable", JSON.stringify({
        legacy: record?.legacy.unavailable, allergies: record?.allergies.unavailable, weight: record?.weight.state,
      }));

    const write = patient ? await recordMedication(admin, medCtx, {
      patientId: patient, genericName: "Amoxicillin", doseText: "375 mg", ...base,
    }) : null;
    ok("11e. ⚠ a write returns STORE_ABSENT with a 503, not a stack trace",
      !!write && !write.ok && write.code === "STORE_ABSENT" && write.status === 503
      && write.message.includes(MEDICATION_MIGRATION), JSON.stringify(write));

    ok("11f. the worklist reports absent too, and does not invent an empty practice",
      worklist.storeState === "absent" && !!worklist.storeNotice);

    // ⚠ THE ARITHMETIC STILL RUNS AND THE PAYLOAD SAYS IT WAS NOT SAVED. A prescriber who asked for a
    // number and got a database error would do the multiplication on paper. What must not happen is the
    // number coming back as though it had been recorded.
    const dose = patient ? await calculateDose(admin, medCtx, {
      patientId: patient, basis: "mg_per_kg", rateValue: 15, doseUnit: "mg", ...base,
    }) : null;
    ok("11g. ⚠ the dose arithmetic still returns, with its working, and reports id:null because nothing stored it",
      !!dose && dose.ok && dose.data.perDose === 276 && dose.data.id === null
      && dose.data.working.length >= 3 && dose.data.notChecked.length === 9
      && dose.data.safetyNotice.length > 50, JSON.stringify(dose?.ok ? { id: dose.data.id, perDose: dose.data.perDose } : dose));

    const timeline = await medicationTimeline(admin, medCtx, "00000000-0000-4000-8000-000000000001");
    ok("11h. the timeline reports absent rather than `no such medication`",
      timeline.storeState === "absent" && timeline.entries.length === 0);

    console.log("\n  ⚠ NOT ASSERTED IN THIS RUN, because the store is absent:");
    for (const s of [
      "a medication records and opens its timeline with a `started` entry",
      "a dose change is refused without a reason (by the DATABASE constraint)",
      "the immutable dose calculation survives a later weight byte-identical",
      "a patient-reported row is unverified until medication.override confirms it",
      "a legacy treatment is carried across exactly once",
      "MED s7 requires a parameter for safety and raises a follow-up",
    ]) console.log(`     - ${s}`);
  } else {
    section("11. STORE PRESENT -- the full flow");

    ok("11a. ⚠ all three capability codes are seeded",
      seededMed.length === 3, `seeded: ${seededMed.join(",")}`);

    const rec = patient ? await recordMedication(admin, medCtx, {
      patientId: patient, genericName: "Amoxicillin", doseText: "375 mg", route: "oral",
      frequency: "three times a day", frequencyPerDay: 3, indication: "otitis media", ...base,
    }) : null;
    ok("11b. a medication records", !!rec && rec.ok, JSON.stringify(rec));
    const medId = rec && rec.ok ? rec.data.id : null;

    const tl = medId ? await medicationTimeline(admin, medCtx, medId) : null;
    ok("11c. ⚠ and its timeline OPENS with a `started` entry -- a history that begins with an edit begins in the middle",
      !!tl && tl.entries.length === 1 && tl.entries[0].eventType === "started",
      JSON.stringify(tl?.entries.map(e => e.eventType)));

    const noReason = medId ? await changeMedication(admin, medCtx, {
      medicationId: medId, eventType: "dose_changed", doseText: "500 mg", reason: "", ...base,
    }) : null;
    ok("11d. ⚠ a dose change with no reason is REFUSED",
      !!noReason && !noReason.ok && noReason.code === "VALIDATION_ERROR", JSON.stringify(noReason));
    const withReason = medId ? await changeMedication(admin, medCtx, {
      medicationId: medId, eventType: "dose_changed", doseText: "500 mg", reason: "poor response at 375 mg", ...base,
    }) : null;
    ok("11d-control. the same change WITH a reason succeeds, so 11d is not vacuous",
      !!withReason && withReason.ok, JSON.stringify(withReason));

    const dose1 = patient && medId ? await calculateDose(admin, medCtx, {
      patientId: patient, medicationId: medId, basis: "mg_per_kg", rateValue: 15, doseUnit: "mg", ...base,
    }) : null;
    ok("11e. a dose calculation stores its working, its weight and what was not checked",
      !!dose1 && dose1.ok && !!dose1.data.id && dose1.data.perDose === 276, JSON.stringify(dose1?.ok ? dose1.data.id : dose1));

    // ⚠ LCP s9: "A later weight update must not recalculate or rewrite a historical prescription."
    const before = dose1 && dose1.ok && dose1.data.id
      ? (await admin.from(MEDICATION_DOSE_TABLE).select("*").eq("id", dose1.data.id).single()).data : null;
    if (patient) await recordMeasurement(admin, ctxA, { patientId: patient, definitionId: WEIGHT, value: 21.2, unit: "kg", ...base });
    const after = dose1 && dose1.ok && dose1.data.id
      ? (await admin.from(MEDICATION_DOSE_TABLE).select("*").eq("id", dose1.data.id).single()).data : null;
    ok("11f. ⚠ a LATER WEIGHT leaves the earlier calculation byte-identical",
      !!before && !!after && JSON.stringify(before) === JSON.stringify(after));
    ok("11f-control. and the new weight really did land, so 11f is not comparing two failed reads",
      !!before && !!after && (await dosingWeight(admin, medCtx, patient!)).verdict.valueKg === 21.2);

    const reported = patient ? await recordMedication(admin, medCtx, {
      patientId: patient, genericName: "Salbutamol inhaler", doseText: "2 puffs as needed",
      source: "patient_reported", ...base,
    }) : null;
    const reportedId = reported && reported.ok ? reported.data.id : null;
    const cannotVerify = reportedId ? await verifyMedication(admin, recordNoOverride, { medicationId: reportedId, ...base }) : null;
    ok("11g. ⚠ confirming a patient-reported row needs medication.override, not medication.record",
      !!cannotVerify && !cannotVerify.ok && cannotVerify.code === "FORBIDDEN", JSON.stringify(cannotVerify));
    const canVerify = reportedId ? await verifyMedication(admin, medCtx, { medicationId: reportedId, ...base }) : null;
    ok("11g-control. and a practitioner CAN, so 11g is not vacuous", !!canVerify && canVerify.ok);

    const review = medId ? await setMedicationReview(admin, medCtx, {
      medicationId: medId, reviewIntervalDays: 30, requireParameterId: WEIGHT,
      scheduleFollowUp: true, reason: "weight-based dosing", ...base,
    }) : null;
    ok("11h. MED s7 requires the weight for safety in CPR-LCP-001 and raises a follow-up in the existing rail",
      !!review && review.ok && review.data.parameterActivated && !!review.data.followUpId
      && !!review.data.nextReviewOn, JSON.stringify(review));

    const viewCannotWrite = patient ? await recordMedication(admin, viewOnly, {
      patientId: patient, genericName: "Paracetamol", doseText: "250 mg", ...base,
    }) : null;
    ok("11i. medication.view alone cannot record anything",
      !!viewCannotWrite && !viewCannotWrite.ok && viewCannotWrite.code === "FORBIDDEN");
  }

  // ══ 12. THE VOCABULARY MATCHES THE CHECK CONSTRAINTS ══════════════════════════════════════════════
  section("12. THE VOCABULARY IS THE MIGRATION'S");

  const inSql = (values: readonly string[], column: string) =>
    values.every(v => new RegExp(`${column}[\\s\\S]{0,400}?'${v}'`).test(sql.text));
  ok("12a. every status, source, event type and dose basis appears in its own CHECK",
    inSql(MEDICATION_STATUS_CODES, "status text not null default 'active'")
    && inSql(MEDICATION_SOURCE_CODES, "recorded_source text not null")
    && inSql(MEDICATION_EVENT_TYPE_CODES, "event_type text not null")
    && inSql(DOSE_BASIS_CODES, "basis text not null"));
  ok("12a-control. a value that is NOT in the vocabulary is not in the SQL either",
    !/'significant'/.test(sql.text) && !/'entered_in_error'/.test(sql.text));

  await cleanup();

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`  - ${f}`)); process.exit(1); }
}

// ⚠ TEARDOWN ON A KILL, NOT ONLY ON A THROW. The catch below covers a run that FAILS; it does not
// cover one that is KILLED, which in this environment is the ordinary case -- a command timeout, an
// agent watchdog, a stopped task. Six abandoned Practice workspaces accumulated that way and the
// landlord Mission Control counted every one of them as a real practice. Best effort: SIGKILL cannot
// be caught, and scripts/estate-hygiene-harness.ts is the backstop for what still gets through.
cleanupOnKill(cleanup);
main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
