/**
 * CPR-LCP-001 -- configurable longitudinal clinical parameters and patient monitoring, on migration 246.
 *
 *   npx --yes tsx scripts/practice-parameters-harness.ts
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * THE SIX ASSERTIONS THIS FILE EXISTS FOR. Everything else is scaffolding around them.
 *
 *  ⚠ 1. AN UNCHECKED THING SAYS SO. A threshold with no rule row renders "Not checked" -- never a blank,
 *       never a green tick. The fixtures are arranged so the WRONG answer is the one a broken engine
 *       gives: a value is supplied with no rule behind it, which is exactly the shape that returns
 *       "within range" if the verdict is decided from the value instead of from the rule. This is
 *       migration 238's allergy lesson in a second domain -- an unwarned screen reads as a cleared one.
 *
 *  ⚠ 2. HIDING AND SAFETY, IN BOTH DIRECTIONS. LCP s9: "Patient-level hiding of weight must not suppress
 *       a medication-triggered safety requirement." Asserted twice over: that `hidden` DOES remove a
 *       parameter from routine collection, AND that a safety requirement puts the same parameter back on
 *       the safety list and on the encounter form. One direction alone passes against an engine that
 *       never hides anything; the other alone passes against one that never hides successfully.
 *
 *  ⚠ 3. HISTORY IS NEVER REWRITTEN. A weight is recorded, a BMI is derived from it, a NEW weight is
 *       recorded -- and the first derived row is read back and compared field for field. It must be
 *       byte-identical, with its original source measurement ids. LCP s9: "A later weight update must
 *       not recalculate or rewrite a historical prescription."
 *
 *  ⚠ 4. NO PERCENTILES. The design comp draws a percentile band chart. Migration 246 s8 explains at
 *       length why there is no percentile column. The series payload carries `percentileBands: null` and
 *       a refusal naming WHO 2006 and CDC 2000, and a source scan proves nothing in the practice tree
 *       computes a centile, a z-score or an LMS fit.
 *
 *  ⚠ 5. ONE-CLICK CARRY-FORWARD IS PROHIBITED. LCP s10.3. A patient with a prior weight opens a new
 *       encounter: the prior value is present as HISTORY (`latest`) and absent as an entry
 *       (`recordedThisEncounter` is null). Both halves are asserted, because "no prior value" would also
 *       satisfy the second one.
 *
 *  ⚠ 6. THE FOUR CAPABILITY CODES ARE REAL. practice-audit-harness's capabilityCodesInSource() only
 *       matches inline double-quoted literals, so a code reached through a constants object is not
 *       checked anywhere. PARAMETER_CAPABILITIES is asserted against practice_role_capabilities here,
 *       the way LONGITUDINAL_CAPABILITIES is.
 *
 * EVERY REFUSAL IS PAIRED WITH A CONTROL. A function that returns "not checked" for everything is safe
 * and useless, and it passes assertion 1 on its own.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { loadEnvConfig } from "@next/env";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { launchEncounter, transitionEncounter } from "../src/lib/practice/encounters";
import {
  ensureCoreLibrary, parameterLibrary, monitoringPlan, encounterParameters, parameterSeries,
  setActivation, createDefinition, setDefinitionStatus, createPack, setPackItem, installPack,
  upsertPlanEntry, restoreInherited, requireForSafety, recordMeasurement, resolveAlert,
  addEncounterParameter, resolveActivation, toCanonical, computeNextDue, CORE_LIBRARY,
  type ActivationRow,
} from "../src/lib/practice/parameters";
import {
  PARAMETER_CAPABILITIES, thresholdLine, plausibilityLine, dueLine, valueLine, trendLine,
  ACTIVATION_SCOPES_BY_PRECEDENCE, PLAN_STATE_CODES, PLAN_SCHEDULE_CODES, ALERT_TYPE_CODES,
  ALERT_SEVERITY_CODES, MEASUREMENT_SOURCE_CODES, STATES_OUT_OF_ROUTINE_VIEW,
  NO_PERCENTILE_BANDS, PARAMETER_REFUSALS, SCOPE_SENTINEL, THRESHOLD_TONE,
} from "../src/lib/practice/parameters-constants";
import { CALCULATORS } from "../src/lib/practice/clinical-calculators";
import { findRates, REFUSED_PATIENT_STATES } from "../src/lib/practice/intelligence-constants";
import { PRACTICE_NAV } from "../src/lib/practice/navigation";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const USER_A = "00000000-0000-4000-8000-0000000e0fa1";
const USER_B = "00000000-0000-4000-8000-0000000e0fa2";

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
    idempotency_key: `harness-param-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-param",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-param", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [USER_A, USER_B]);
}

const base = { actorId: USER_A, correlationId: "harness-param" };

/** A client whose reads of ONE table fail and whose reads of everything else are real. */
function failingOn(table: string, message: string) {
  return {
    from: (t: string) => {
      if (t !== table) return admin.from(t);
      const chain: Record<string, unknown> = {};
      const result = { data: null, error: { message }, count: null };
      for (const m of ["select", "eq", "in", "or", "order", "not", "is", "neq", "lt", "gt", "gte", "lte"]) chain[m] = () => chain;
      chain.limit = async () => result;
      chain.maybeSingle = async () => result;
      chain.single = async () => result;
      (chain as { then?: unknown }).then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
      return chain;
    },
  };
}

/** Source with comments removed -- this build's comments quote the sentences a scan hunts for. */
function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter(l => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const iso = (offsetDays: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

async function main() {
  console.log("\nCPR-LCP-001 clinical parameters harness (migration 246)\n");
  await cleanup();

  // ══ 0. MIGRATION GATE ═══════════════════════════════════════════════════════════════════════════
  section("0. the schema is there before anything is claimed about it");
  const TABLES = [
    "practice_parameter_definition", "practice_parameter_definition_version",
    "practice_parameter_pack", "practice_parameter_pack_item", "practice_parameter_activation",
    "practice_patient_monitoring_plan", "practice_patient_monitoring_plan_event",
    "practice_parameter_measurement", "practice_parameter_derived", "practice_parameter_alert",
  ];
  let present = 0;
  for (const t of TABLES) {
    const r = await admin.from(t).select("id").limit(1);
    if (!r.error) present++;
    else console.log(`      ${t}: ${r.error.message}`);
  }
  ok("0a. all ten of migration 246's tables are applied", present === TABLES.length, `${present}/${TABLES.length}`);
  if (present !== TABLES.length) { console.log("\n  Stopping: migration 246 is not applied.\n"); return report(); }

  // ══ 1. ⚠ THE THRESHOLD READER -- "NOT CHECKED" IS NOT "FINE" ════════════════════════════════════
  //
  // Fixtures arranged so the wrong answer is the one a broken engine gives.
  section("1. thresholdLine: an unchecked thing says so, and only one verdict is reassuring");

  // ⚠ A VALUE IS SUPPLIED AND NO RULE IS. This is exactly the shape that returns "within range" if the
  // verdict is decided from the value rather than from the rule.
  const noRule = thresholdLine({ value: 30, unit: "kg", target: null, practiceThreshold: null, unavailable: false });
  ok("t-1. ⚠ a value with NO threshold rule reads `not_checked`, is not reassuring, and says so in words",
    noRule.state === "not_checked" && noRule.reassuring === false && /not checked/i.test(noRule.text)
    && noRule.ruleSource === null,
    JSON.stringify(noRule));

  // ⚠ THE CONTROL. Without it, a function returning `not_checked` for everything passes t-1 and is
  // perfectly safe and perfectly useless.
  const inside = thresholdLine({ value: 30, unit: "kg", target: null, practiceThreshold: { low: 10, high: 50 }, unavailable: false });
  ok("t-2. CONTROL: with a practice range and a value inside it, the verdict IS reassuring",
    inside.state === "within" && inside.reassuring === true && inside.ruleSource === "practice_threshold",
    JSON.stringify(inside));

  const outside = thresholdLine({ value: 60, unit: "kg", target: null, practiceThreshold: { low: 10, high: 50 }, unavailable: false });
  ok("t-3. a value above the range is breached and never reassuring",
    outside.state === "breached" && outside.reassuring === false && /above/.test(outside.text),
    JSON.stringify(outside));

  // ⚠ THE TWO RULES DISAGREE ON PURPOSE. 30 is INSIDE the practice range and OUTSIDE the patient target,
  // so an engine that got s4's precedence backwards returns `within` here.
  const patientWins = thresholdLine({
    value: 30, unit: "kg", target: { low: 20, high: 25 },
    practiceThreshold: { low: 10, high: 50 }, unavailable: false,
  });
  ok("t-4. ⚠ the PATIENT target beats the practice threshold (s4 precedence), and the two disagree here",
    patientWins.state === "breached" && patientWins.ruleSource === "patient_target",
    JSON.stringify(patientWins));

  const nothingMeasured = thresholdLine({ value: null, unit: "kg", target: { low: 20, high: 25 }, practiceThreshold: null, unavailable: false });
  ok("t-5. a rule with nothing measured against it is `no_value`, not `within`",
    nothingMeasured.state === "no_value" && nothingMeasured.reassuring === false,
    JSON.stringify(nothingMeasured));

  // ⚠ THE VALUE IS INSIDE THE RANGE, so a failed read that fell through would report `within`.
  const unread = thresholdLine({ value: 30, unit: "kg", target: null, practiceThreshold: { low: 10, high: 50 }, unavailable: true });
  ok("t-6. ⚠ a FAILED read is its own answer, even when the value it could not read is inside the range",
    unread.state === "unreadable" && unread.reassuring === false && !/within/i.test(unread.text),
    JSON.stringify(unread));

  const allStates = [noRule, inside, outside, patientWins, nothingMeasured, unread];
  ok("t-7. ⚠ exactly ONE verdict in the set sets `reassuring`, and it is the one with a rule and a value inside it",
    allStates.filter(v => v.reassuring).length === 1 && allStates.find(v => v.reassuring)?.state === "within",
    allStates.map(v => `${v.state}:${v.reassuring}`).join(" "));

  ok("t-8. the tone map draws `not_checked` as neither green nor red, and gives it a visible mark",
    THRESHOLD_TONE.not_checked.mark !== "" && !/emerald|green|rose|red/.test(THRESHOLD_TONE.not_checked.chip)
    && /emerald/.test(THRESHOLD_TONE.within.chip),
    JSON.stringify(THRESHOLD_TONE.not_checked));

  // ── plausibility is NOT a clinical check and must not read like one ────────────────────────────────
  const noLimits = plausibilityLine({ value: 30, unit: "kg", min: null, max: null });
  ok("p-1. a parameter with no plausibility limits says so rather than reporting the value as plausible",
    noLimits.state === "no_limits", JSON.stringify(noLimits));
  const implausible = plausibilityLine({ value: 0.1, unit: "kg", min: 0.3, max: 400 });
  ok("p-2. CONTROL: a value outside the window IS flagged", implausible.state === "implausible", implausible.text);
  const plausible = plausibilityLine({ value: 30, unit: "kg", min: 0.3, max: 400 });
  ok("p-3. ⚠ and a plausible value says in words that this is NOT a clinical range check",
    plausible.state === "plausible" && /not a clinical/i.test(plausible.text), plausible.text);

  // ══ 2. DUE-NESS IS DERIVED, NEVER STORED ════════════════════════════════════════════════════════
  section("2. dueLine: overdue is computed from a clock, and an event-driven schedule has no date");

  const today = iso(0);
  const late = dueLine({ schedule: "monthly", nextDueOn: iso(-3), today, unavailable: false });
  ok("d-1. a due date three days past reads overdue by 3", late.state === "overdue" && late.daysOverdue === 3, JSON.stringify(late));
  ok("d-2. a due date of today reads due today",
    dueLine({ schedule: "monthly", nextDueOn: today, today, unavailable: false }).state === "due_today");
  const later = dueLine({ schedule: "monthly", nextDueOn: iso(5), today, unavailable: false });
  ok("d-3. a future due date is not overdue and carries no days-overdue figure",
    later.state === "due_later" && later.daysOverdue === null, JSON.stringify(later));

  // ⚠ THE ONE THAT LOOKS LIKE UP-TO-DATE. Migration 246 s6: "A schedule that cannot be evaluated
  // produces a parameter that is never due, which on a monitoring screen is indistinguishable from a
  // parameter that is up to date."
  const eventDriven = dueLine({ schedule: "every_encounter", nextDueOn: null, today, unavailable: false });
  ok("d-4. ⚠ an EVENT-driven schedule gets its own state and its own sentence, not silence",
    eventDriven.state === "on_next_contact" && eventDriven.daysOverdue === null
    && /visit|date/i.test(eventDriven.text), JSON.stringify(eventDriven));
  ok("d-5. CONTROL: no schedule at all is a different answer again",
    dueLine({ schedule: null, nextDueOn: null, today, unavailable: false }).state === "no_schedule");

  // ⚠ THE DATE IS THREE DAYS PAST, so a failed read that fell through would report overdue.
  const dueUnread = dueLine({ schedule: "monthly", nextDueOn: iso(-3), today, unavailable: true });
  ok("d-6. ⚠ a failed read does not become `overdue`, even with a date that is past",
    dueUnread.state === "unreadable" && dueUnread.daysOverdue === null, JSON.stringify(dueUnread));

  ok("d-7. computeNextDue advances a calendar schedule and refuses to invent a date for an event one",
    computeNextDue({ schedule: "monthly", from: "2026-01-01" }) === "2026-01-31"
    && computeNextDue({ schedule: "every_encounter", from: "2026-01-01" }) === null
    && computeNextDue({ schedule: null, from: "2026-01-01" }) === null,
    String(computeNextDue({ schedule: "monthly", from: "2026-01-01" })));
  ok("d-8. and an \"until a date\" schedule stops being due once the date has passed",
    computeNextDue({ schedule: "monthly", from: "2026-01-01", untilDate: "2026-01-15" }) === null);

  // ══ 3. VALUE PROVENANCE -- s10.3's four-way distinction ═════════════════════════════════════════
  section("3. valueLine: measured, patient-reported, imported and calculated are four different things");

  ok("v-1. nothing recorded says so", valueLine({ text: null, source: null, calculated: false, permitted: true, unavailable: false }).state === "none");
  // ⚠ A VALUE IS SUPPLIED in both of the next two, so a fall-through reports it.
  const vDenied = valueLine({ text: "18.4 kg", source: "practitioner", calculated: false, permitted: false, unavailable: false });
  ok("v-2. ⚠ a caller who may not see the value gets `not_permitted`, not the value",
    vDenied.state === "not_permitted" && !/18\.4/.test(vDenied.text), JSON.stringify(vDenied));
  const vUnread = valueLine({ text: "18.4 kg", source: "practitioner", calculated: false, permitted: true, unavailable: true });
  ok("v-3. ⚠ a failed read is `unreadable` and says it is not the same as nothing recorded",
    vUnread.state === "unreadable" && /not the same/i.test(vUnread.text), JSON.stringify(vUnread));
  ok("v-4. a calculated value is labelled calculated, never measured",
    valueLine({ text: "13.0", source: null, calculated: true, permitted: true, unavailable: false }).provenance === "calculated");
  // CONTROL: provenance is not always the same word.
  ok("v-5. CONTROL: a patient-reported value is labelled patient-reported and a practitioner one measured",
    valueLine({ text: "1", source: "patient_reported", calculated: false, permitted: true, unavailable: false }).provenance === "patient_reported"
    && valueLine({ text: "1", source: "practitioner", calculated: false, permitted: true, unavailable: false }).provenance === "measured");

  // ══ 4. ⚠ THE REFUSAL LCP s7.2 LIFTS, AND THE PRECONDITION IT KEEPS ══════════════════════════════
  section("4. trendLine: improving is computable only from measurements with a direction agreed in advance");

  // ⚠ A RISING SERIES WITH NO AGREED DIRECTION. An engine that reads the sign of the change calls this
  // "improving"; there is no basis in the record for saying so.
  const rising = [{ value: 14, at: "2026-01-10T09:00:00Z" }, { value: 18, at: "2026-05-10T09:00:00Z" }];
  const noDirection = trendLine({ series: rising, agreedDirection: null, unavailable: false });
  ok("tr-1. ⚠ a rising series with NO agreed direction claims neither improving nor deteriorating",
    noDirection.state === "no_direction_agreed" && noDirection.basis === null,
    JSON.stringify(noDirection));

  const up = trendLine({ series: rising, agreedDirection: "up", unavailable: false });
  ok("tr-2. CONTROL: with `up` agreed in advance, the same series IS improving, and cites both values",
    up.state === "improving" && up.basis?.fromValue === 14 && up.basis?.toValue === 18
    && up.basis?.fromAt === rising[0].at && up.change === 4,
    JSON.stringify(up));

  // ⚠ SAME DATA, OPPOSITE ANSWER. This proves the agreed direction is load-bearing rather than the sign
  // of the change being read and dressed up.
  const down = trendLine({ series: rising, agreedDirection: "down", unavailable: false });
  ok("tr-3. ⚠ the SAME rising series with `down` agreed is DETERIORATING -- the direction is the input",
    down.state === "deteriorating" && down.change === 4, JSON.stringify(down));

  ok("tr-4. one measurement is not a direction",
    trendLine({ series: [rising[0]], agreedDirection: "up", unavailable: false }).state === "too_few_measurements");
  ok("tr-5. ⚠ a failed read does not become a direction, even with a full series and an agreed direction",
    trendLine({ series: rising, agreedDirection: "up", unavailable: true }).state === "unreadable");
  ok("tr-6. an unchanged series is unchanged, not improving",
    trendLine({ series: [{ value: 18, at: "2026-01-01T00:00:00Z" }, { value: 18, at: "2026-05-01T00:00:00Z" }], agreedDirection: "up", unavailable: false }).state === "unchanged");

  // The refusal it lifts is REWRITTEN, not deleted, and still true where it is still true.
  const improvingRefusal = REFUSED_PATIENT_STATES.find(r => r.key === "improving");
  ok("tr-7. ⚠ REFUSED_PATIENT_STATES still holds `improving` -- rewritten, not deleted",
    !!improvingRefusal && improvingRefusal.why.length > 100 && improvingRefusal.wouldRequire.length > 60,
    JSON.stringify(improvingRefusal?.key));
  ok("tr-8. and it still names the failure mode the unlock does not fix (attendance is not a trajectory)",
    /went elsewhere/.test(improvingRefusal?.why ?? ""), (improvingRefusal?.why ?? "").slice(0, 90));
  ok("tr-9. high_complexity is untouched and still refused",
    REFUSED_PATIENT_STATES.some(r => r.key === "high_complexity"),
    REFUSED_PATIENT_STATES.map(r => r.key).join(","));
  ok("tr-10. ⚠ nothing in the trend reader reads attendance, encounters or appointments",
    !/encounter|appointment|attend|visit_count/i.test(
      withoutComments(readFileSync(join(process.cwd(), "src/lib/practice/parameters-constants.ts"), "utf8"))
        .split("export function trendLine")[1]?.split("export const")[0] ?? "ENCOUNTER"),
    "trendLine's body mentions an attendance source");

  // ══ 5. VOCABULARIES MIRROR THE SPECIFICATION AND THE SCHEMA ═════════════════════════════════════
  section("5. the closed lists are the specification's, written out");

  ok("voc-1. LCP s7's EIGHT patient-level states, verbatim",
    PLAN_STATE_CODES.length === 8 && PLAN_STATE_CODES.join(",") ===
    "inherited,active,required,optional,paused,resolved,hidden,conditionally_required",
    PLAN_STATE_CODES.join(","));
  ok("voc-2. LCP s7.1's FOURTEEN schedules, verbatim",
    PLAN_SCHEDULE_CODES.length === 14 && PLAN_SCHEDULE_CODES.includes("for_n_encounters")
    && PLAN_SCHEDULE_CODES.includes("until_resolved"), `${PLAN_SCHEDULE_CODES.length}`);
  ok("voc-3. LCP s7.2's SEVEN alert types, verbatim",
    ALERT_TYPE_CODES.length === 7 && ALERT_TYPE_CODES.includes("trend_deviation"), ALERT_TYPE_CODES.join(","));
  ok("voc-4. the four-level severity is PIE s7's, with `action_required` as the third",
    ALERT_SEVERITY_CODES.join(",") === "informational,advisory,action_required,critical",
    ALERT_SEVERITY_CODES.join(","));
  ok("voc-5. LCP s12's FIVE sources, verbatim",
    MEASUREMENT_SOURCE_CODES.join(",") === "practitioner,team,patient_reported,imported,device",
    MEASUREMENT_SOURCE_CODES.join(","));
  // ⚠ WRITTEN OUT IN FULL. s4 states the precedence; an array assertion updated to match whatever the
  // code does is a transcript, not an assertion.
  ok("voc-6. ⚠ s4's precedence order, written out: encounter -> session -> clinic -> practitioner -> practice",
    [...ACTIVATION_SCOPES_BY_PRECEDENCE].join(",") === "encounter,session,clinic,practitioner,practice",
    ACTIVATION_SCOPES_BY_PRECEDENCE.join(","));
  ok("voc-7. the three states that leave routine collection are s7's three, and `inactive` is not one",
    [...STATES_OUT_OF_ROUTINE_VIEW].join(",") === "paused,resolved,hidden",
    STATES_OUT_OF_ROUTINE_VIEW.join(","));

  // resolveActivation walks that array. Arranged so the two rows DISAGREE.
  const rows: ActivationRow[] = [
    { id: "p", definitionId: "d1", packId: null, packVersion: null, scope: "practice", scopeId: SCOPE_SENTINEL, state: "active", collectionRule: "annual", localLabel: "practice", visibility: "team", thresholdOverride: {} },
    { id: "e", definitionId: "d1", packId: null, packVersion: null, scope: "encounter", scopeId: "enc-1", state: "active", collectionRule: "every_visit", localLabel: "encounter", visibility: "team", thresholdOverride: {} },
  ];
  ok("voc-8. ⚠ resolveActivation returns the ENCOUNTER row when one exists, and the two rows disagree here",
    resolveActivation(rows, "d1", { encounterId: "enc-1" })?.localLabel === "encounter",
    JSON.stringify(resolveActivation(rows, "d1", { encounterId: "enc-1" })?.localLabel));
  ok("voc-9. CONTROL: with no encounter in context it falls back to the practice row",
    resolveActivation(rows, "d1", {})?.localLabel === "practice");

  ok("unit-1. unit conversion is deterministic and refuses what it cannot convert",
    (() => {
      const good = toCanonical({ value: 40, unit: "lb", canonicalUnit: "kg", conversions: { kg: 1, lb: 0.45359237 } });
      const bad = toCanonical({ value: 40, unit: "stone", canonicalUnit: "kg", conversions: { kg: 1, lb: 0.45359237 } });
      return good.ok && Math.abs(good.value - 18.143695) < 0.001 && !bad.ok;
    })(), JSON.stringify(toCanonical({ value: 40, unit: "lb", canonicalUnit: "kg", conversions: { kg: 1, lb: 0.45359237 } })));
  ok("unit-2. ⚠ an unconvertible unit is REFUSED, not silently treated as canonical (a factor-of-two dose error)",
    !toCanonical({ value: 40, unit: "stone", canonicalUnit: "kg", conversions: { kg: 1 } }).ok);

  // ══ 6. SOURCE RULES ═════════════════════════════════════════════════════════════════════════════
  section("6. the rules enforced by shape rather than by everybody remembering");

  const srcFiles = walk(join(process.cwd(), "src", "lib", "practice"))
    .concat(walk(join(process.cwd(), "src", "app", "practice")))
    .concat(walk(join(process.cwd(), "src", "app", "api", "v1", "practice")));
  ok("src-0. control: the scan actually read the practice source tree", srcFiles.length > 100, `${srcFiles.length} files`);

  const updatesOn = (table: string) => srcFiles.filter(f =>
    new RegExp(`from\\("${table}"\\)[\\s\\S]{0,300}\\.update\\(`).test(readFileSync(f, "utf8")));

  ok("src-1. ⚠ NOTHING in the practice tree UPDATEs practice_parameter_measurement",
    updatesOn("practice_parameter_measurement").length === 0,
    updatesOn("practice_parameter_measurement").map(f => f.replace(process.cwd(), "")).join(", "));
  ok("src-2. ⚠ NOTHING in the practice tree UPDATEs practice_parameter_derived",
    updatesOn("practice_parameter_derived").length === 0,
    updatesOn("practice_parameter_derived").map(f => f.replace(process.cwd(), "")).join(", "));
  // ⚠ THE CONTROL THAT MAKES src-1 AND src-2 MEAN ANYTHING. The same regex over a table that IS updated
  // must find something, or the two assertions above are passing because the scan is blind.
  ok("src-3. CONTROL: the same scan DOES find the update on practice_patient_monitoring_plan, which is mutable",
    updatesOn("practice_patient_monitoring_plan").length > 0,
    `${updatesOn("practice_patient_monitoring_plan").length} file(s)`);

  // s10.3's carry-forward prohibition, as a scan of the two panels that could break it.
  const panelFiles = [
    "src/app/practice/(shell)/encounters/[encounterId]/ParameterCollection.tsx",
    "src/app/practice/(shell)/patients/[patientId]/MonitoringPlanPanel.tsx",
  ].map(p => join(process.cwd(), p));
  const CARRY = /(value|defaultValue)=\{[^}]*\blatest\b/;
  const carryOffenders = panelFiles.filter(f => CARRY.test(withoutComments(readFileSync(f, "utf8"))));
  ok("src-4. ⚠ no parameter input is bound to a PRIOR measurement (LCP s10.3 carry-forward prohibition)",
    carryOffenders.length === 0, carryOffenders.join(", "));
  ok("src-5. CONTROL: the carry-forward scan can see such a binding when it is there",
    CARRY.test('<input value={e.latest.value} />'));
  ok("src-6. and neither panel uses defaultValue at all",
    !panelFiles.some(f => /defaultValue/.test(withoutComments(readFileSync(f, "utf8")))));

  // ⚠ NO PERCENTILE ANYWHERE, IN TWO ASSERTIONS RATHER THAN ONE.
  //
  // ⚠ NO \b IN EITHER REGEX, AND THE FIRST VERSION OF THIS SCAN HAD ONE. `\bpercentile\b` does not
  // match `weightForAgePercentile` -- there is no word boundary between `e` and `P` -- so the scan
  // matched only the spelling a TypeScript codebase would never use, and its own control failed. This is
  // the exact trap intelligence-constants.ts records against RATE_SHAPED_KEY, hit a second time.
  // `lms_` keeps its underscore so the scan does not fire on `films` or `helms`.
  //
  // NAMING A REFUSAL IS NOT MAKING THE CLAIM, which is the distinction practice-longitudinal-harness
  // draws for "No known allergies". So the first assertion names WHERE the word may live and the second
  // proves that in none of those places is a centile ever ASSIGNED A VALUE.
  const CENTILE = /(percentile|centile|z_?score|lms_)/i;
  const centileFiles = srcFiles
    .filter(f => CENTILE.test(withoutComments(readFileSync(f, "utf8"))))
    .map(f => f.split(/[\\/]/).pop() ?? f)
    .sort();
  // ⚠ A FOURTH PLACE, ADDED DELIBERATELY AND NOT TO MAKE THIS PASS. CPR-PIE-001's
  // intelligence-constants.ts carries `growth_percentiles` in PIE_NOT_BUILDABLE -- a refusal card that
  // COMPUTES NOTHING and quotes migration 246 s8's own sentence back at the reader. src-9 below, which
  // is the assertion that actually matters, does not match that file at all: no centile is assigned a
  // value anywhere in it.
  //
  // Enumerating a fourth place is what this assertion was designed to do -- see its own comment above:
  // naming a refusal is not making the claim. Widening the COUNT while src-9 stays exact is the honest
  // edit. Deleting src-9, relaxing its right-hand-side list, or dropping the file names from here would
  // not be.
  ok("src-7. ⚠ the word lives in exactly four named places: the refusal, the payload that carries it, the panel that prints it, and PIE's not-buildable card",
    centileFiles.length === 4
    && centileFiles.includes("parameters-constants.ts")
    && centileFiles.includes("parameters.ts")
    && centileFiles.includes("MonitoringPlanPanel.tsx")
    && centileFiles.includes("intelligence-constants.ts"),
    centileFiles.join(", "));
  ok("src-8. CONTROL: the centile scan is not blind (it matches a camelCase identifier, which \\b would not)",
    CENTILE.test("const p = weightForAgePercentile(x)") && centileFiles.length > 0);

  // ⚠ AND NOWHERE IS A CENTILE GIVEN A VALUE. The right-hand sides that are permitted are written out:
  // `null` (the refusal itself), a `string` type annotation, a string literal, and the two named refusal
  // constants. Anything else on the right of a centile-shaped name is a computed centile, which is the
  // fabrication migration 246 s8 refused. `percentileBands: computeBands(age, sex)` is the case this is
  // written against.
  const CENTILE_ASSIGNED =
    /(percentile|centile|z_?score)[A-Za-z]*\s*[:=]\s*(?!null|string|"|'|PERCENTILE_REFUSAL_TEXT|NO_PERCENTILE_BANDS)[A-Za-z0-9_(]/i;
  const assigners = srcFiles.filter(f => CENTILE_ASSIGNED.test(withoutComments(readFileSync(f, "utf8"))));
  ok("src-9. ⚠ and NOTHING assigns a percentile, a centile or a z-score a computed value",
    assigners.length === 0, assigners.map(f => f.replace(process.cwd(), "")).join(", "));
  ok("src-10. CONTROL: the assignment scan fires on a computed one and stays quiet on the refusal",
    CENTILE_ASSIGNED.test("percentileBands: computeBands(age, sex)")
    && CENTILE_ASSIGNED.test("const zScore = lmsFit(w, age)")
    && !CENTILE_ASSIGNED.test("percentileBands: null,")
    && !CENTILE_ASSIGNED.test("percentileBandsRefusal: string;"));

  // ⚠ 6. THE CAPABILITY CODES. The audit harness cannot see these.
  ok("cap-1. PARAMETER_CAPABILITIES is exactly the four migration 246 s11 seeds",
    [...PARAMETER_CAPABILITIES].join(",") === "parameter.view,parameter.record,parameter.configure,pack.install",
    PARAMETER_CAPABILITIES.join(","));
  const { data: seededCaps, error: capErr } = await admin.from("practice_role_capabilities").select("capability_code");
  ok("cap-2. control: the capability catalogue is readable and populated",
    !capErr && ((seededCaps ?? []) as unknown[]).length >= 30, capErr?.message ?? `${(seededCaps ?? []).length}`);
  const catalogue = new Set(((seededCaps ?? []) as { capability_code: string }[]).map(c => c.capability_code));
  ok("cap-3. ⚠ every capability this engine gates on EXISTS -- an invented one is a silent 403 for everybody",
    PARAMETER_CAPABILITIES.every(c => catalogue.has(c)),
    PARAMETER_CAPABILITIES.filter(c => !catalogue.has(c)).join(", "));
  ok("cap-4. control: the catalogue check can say no (a code nobody seeded reads as absent)",
    !catalogue.has("parameter.approve"));

  // ⚠ NAVIGATION: NOTHING MOVED.
  const primary = PRACTICE_NAV.filter(i => i.primary);
  ok("nav-1. ⚠ PRIMARY_ORDER is still nine items and LCP-001 added none",
    primary.length === 9, `${primary.length}: ${primary.map(i => i.label).join(", ")}`);
  ok("nav-2. and there is no /practice/parameters route in the catalogue",
    !PRACTICE_NAV.some(i => i.href.includes("parameter")), "a parameter route reached navigation.ts");

  // ══ THE LIVE HALF ═══════════════════════════════════════════════════════════════════════════════
  section("7. the platform library seeds once, idempotently, and only what LCP s5 names");

  const wsA = await provision(USER_A, "HARNESS Parameters A (synthetic)", "a");
  const wsB = await provision(USER_B, "HARNESS Parameters B (synthetic)", "b");
  const ctxARes = await resolveWorkspaceContext(admin, USER_A, wsA);
  const ctxBRes = await resolveWorkspaceContext(admin, USER_B, wsB);
  if (!ctxARes.ok || !ctxBRes.ok) { ok("workspace contexts resolve", false); return report(); }
  const ctxA: WorkspaceContext = ctxARes.ctx;
  const ctxB: WorkspaceContext = ctxBRes.ctx;

  ok("cap-5. ⚠ the provisioned practitioner actually HOLDS all four (migration 246's backfill worked)",
    PARAMETER_CAPABILITIES.every(c => ctxA.capabilities.includes(c)),
    PARAMETER_CAPABILITIES.filter(c => !ctxA.capabilities.includes(c)).join(", "));

  const seed1 = await ensureCoreLibrary(admin);
  const seed2 = await ensureCoreLibrary(admin);
  ok("lib-1. the core library is present after seeding, and a second seed creates nothing",
    seed1.ok && seed2.ok && seed2.data.created === 0
    && (seed1.data.created + seed1.data.existing) >= CORE_LIBRARY.length,
    JSON.stringify({ a: seed1.ok ? seed1.data : seed1, b: seed2.ok ? seed2.data : seed2 }));

  const { data: platformDefs } = await admin.from("practice_parameter_definition")
    .select("id, code, category, data_type, canonical_unit, formula, version").is("workspace_id", null);
  const platformCodes = new Set(((platformDefs ?? []) as { code: string }[]).map(d => d.code));
  ok("lib-2. every one of LCP s5's core parameters is in the platform library",
    CORE_LIBRARY.every(c => platformCodes.has(c.code)),
    CORE_LIBRARY.filter(c => !platformCodes.has(c.code)).map(c => c.code).join(", "));

  // ⚠ s5.3's OWN EXCLUSION, honoured. "Additional observations such as AVPU, Glasgow Coma Scale,
  // capillary refill or glucose are not enabled as universal defaults."
  const EXCLUDED = ["avpu", "glasgow_coma_scale", "gcs", "capillary_refill", "glucose", "blood_glucose"];
  ok("lib-3. ⚠ s5.3's four named non-defaults are NOT in the core library",
    EXCLUDED.every(c => !platformCodes.has(c)), EXCLUDED.filter(c => platformCodes.has(c)).join(", "));
  ok("lib-4. CONTROL: the check is looking at a real library (weight and temperature ARE there)",
    platformCodes.has("weight") && platformCodes.has("temperature"), `${platformCodes.size} codes`);

  // ⚠ NO PERCENTILE PARAMETER EXISTS. s5.2 lists growth percentiles; migration 246 s8 refuses them.
  ok("lib-5. ⚠ no growth-percentile or z-score parameter was seeded, though s5.2 lists them",
    ![...platformCodes].some(c => /percentile|zscore|z_score|centile|for_age/.test(c)),
    [...platformCodes].filter(c => /percentile|zscore|centile|for_age/.test(c)).join(", "));
  ok("lib-6. and the refusal that explains it names a reference population",
    /WHO 2006/.test(NO_PERCENTILE_BANDS.detail) && /CDC 2000/.test(NO_PERCENTILE_BANDS.detail)
    && PARAMETER_REFUSALS.some(r => r.key === "growth_percentiles"));

  const { data: versions } = await admin.from("practice_parameter_definition_version")
    .select("definition_id, version").in("definition_id", ((platformDefs ?? []) as { id: string }[]).map(d => d.id));
  ok("lib-7. every seeded definition has a version-1 snapshot (s3: definitions remain versioned)",
    ((versions ?? []) as unknown[]).length >= (platformDefs ?? []).length,
    `${(versions ?? []).length} versions for ${(platformDefs ?? []).length} definitions`);

  // ⚠ BLOOD PRESSURE IS TWO SERIES, because one numeric column cannot hold 112/70.
  ok("lib-8. blood pressure is two definitions, so a systolic can be charted and compared",
    platformCodes.has("blood_pressure_systolic") && platformCodes.has("blood_pressure_diastolic"));

  const defId = (code: string) => ((platformDefs ?? []) as { id: string; code: string }[]).find(d => d.code === code)!.id;
  const WEIGHT = defId("weight"), HEIGHT = defId("standing_height"), BMI = defId("bmi");
  const TEMP = defId("temperature"), HC = defId("head_circumference"), SPO2 = defId("oxygen_saturation");
  // ⚠ DELIBERATELY NEVER ACTIVATED ANYWHERE IN THIS FILE. It is the fixture for s4's encounter override,
  // whose own example ("Postural BP today only") is a parameter the practice does NOT routinely collect.
  // The first version of enc-9..enc-11 used a pack-installed parameter instead, which made enc-10 pass
  // against an engine that wrote the addition to practice scope -- the upsert simply found the existing
  // practice row and the count did not move. A control whose fixture already satisfies the thing being
  // controlled for is not a control.
  const WAIST = defId("waist_circumference");

  // ══ 8. ACTIVATION -- s10.1 ══════════════════════════════════════════════════════════════════════
  section("8. activation: a state, never a delete, and never a write to a platform row");

  const actWeight = await setActivation(admin, ctxA, { definitionId: WEIGHT, state: "active", collectionRule: "every_visit", ...base });
  const actHeight = await setActivation(admin, ctxA, { definitionId: HEIGHT, state: "active", collectionRule: "every_visit", ...base });
  const actHc = await setActivation(admin, ctxA, { definitionId: HC, state: "active", collectionRule: "scheduled", ...base });
  const actTemp = await setActivation(admin, ctxA, { definitionId: TEMP, state: "active", ...base });
  ok("act-1. four parameters activate at practice scope",
    actWeight.ok && actHeight.ok && actHc.ok && actTemp.ok,
    [actWeight, actHeight, actHc, actTemp].filter(r => !r.ok).map(r => (r as { message: string }).message).join(" | "));

  const lib = await parameterLibrary(admin, ctxA);
  ok("act-2. the library reports them as collected, and the figure is the length of a list",
    lib.permitted && lib.counts.active === 4
    && lib.parameters.items.filter(p => p.activation?.state === "active").length === 4,
    JSON.stringify(lib.counts));

  // ⚠ A DEACTIVATION IS A ROW, NOT AN ABSENCE. CPL s2: an inactive row must survive a pack reinstall.
  await setActivation(admin, ctxA, { definitionId: TEMP, state: "inactive", ...base });
  const { data: tempRow } = await admin.from("practice_parameter_activation")
    .select("state").eq("workspace_id", wsA).eq("definition_id", TEMP).maybeSingle();
  ok("act-3. ⚠ deactivating writes state=inactive and does NOT delete the row",
    tempRow?.state === "inactive", JSON.stringify(tempRow));

  const noConfig: WorkspaceContext = { ...ctxA, capabilities: ctxA.capabilities.filter(c => c !== "parameter.configure") };
  const refusedAct = await setActivation(admin, noConfig, { definitionId: SPO2, state: "active", ...base });
  ok("act-4. a caller without parameter.configure cannot activate anything",
    !refusedAct.ok && refusedAct.code === "FORBIDDEN", refusedAct.ok ? "was allowed" : refusedAct.code);

  // ⚠ THE PLATFORM ROW IS NEVER WRITTEN. Migration 246 s1: "the engine must refuse a workspace write to
  // a platform row."
  const platformStatus = await setDefinitionStatus(admin, ctxA, {
    definitionId: WEIGHT, status: "retired", changeNote: "trying to retire a platform parameter", ...base,
  });
  ok("act-5. ⚠ a practice cannot change the STATUS of a platform definition",
    !platformStatus.ok && platformStatus.code === "NOT_FOUND", platformStatus.ok ? "was allowed" : platformStatus.code);
  const { data: weightStill } = await admin.from("practice_parameter_definition").select("status").eq("id", WEIGHT).maybeSingle();
  ok("act-6. and the platform row is untouched", weightStill?.status === "active", JSON.stringify(weightStill));

  // A custom definition, and a licensed one that cannot go live.
  const custom = await createDefinition(admin, ctxA, {
    code: "seizure_frequency", displayName: "Seizure frequency", category: "specialty", dataType: "integer",
    canonicalUnit: "/month", permittedUnits: ["/month"], unitConversions: { "/month": 1 },
    minPlausible: 0, maxPlausible: 500, ...base,
  });
  ok("def-1. a custom parameter is created as a DRAFT with a version snapshot",
    custom.ok, custom.ok ? "" : custom.message);
  const SEIZ = custom.ok ? custom.data.id : "";

  const licensed = await createDefinition(admin, ctxA, {
    code: "phq9", displayName: "PHQ-9", category: "score", dataType: "integer",
    canonicalUnit: "points", permittedUnits: ["points"], riskClass: "licensed", ...base,
  });
  const licenceGate = licensed.ok
    ? await setDefinitionStatus(admin, ctxA, { definitionId: licensed.data.id, status: "active", changeNote: "go live", ...base })
    : null;
  ok("def-2. ⚠ CPL s23: a LICENSED parameter cannot go active without a recorded licence reference",
    licensed.ok && !!licenceGate && !licenceGate.ok && licenceGate.code === "LICENCE_REQUIRED",
    licenceGate && licenceGate.ok ? "was allowed" : JSON.stringify(licenceGate?.code));

  const publish = SEIZ ? await setDefinitionStatus(admin, ctxA, { definitionId: SEIZ, status: "active", changeNote: "reviewed and adopted", ...base }) : null;
  ok("def-3. CONTROL: an UNLICENSED custom parameter does go active, and its version is bumped",
    !!publish && publish.ok && publish.data.version === 2, JSON.stringify(publish));
  const noNote = SEIZ ? await setDefinitionStatus(admin, ctxA, { definitionId: SEIZ, status: "draft", changeNote: "  ", ...base }) : null;
  ok("def-4. a status change with no change note is refused (a version nobody can review)",
    !!noNote && !noNote.ok && noNote.code === "VALIDATION_ERROR", JSON.stringify(noNote));

  const cloned = await createDefinition(admin, ctxA, {
    code: "weight_home", displayName: "Weight (home scales)", category: "anthropometric", dataType: "decimal",
    cloneOf: WEIGHT, ...base,
  });
  ok("def-5. CPL s22: a clone preserves source attribution and names what it came from",
    cloned.ok, cloned.ok ? "" : cloned.message);
  if (cloned.ok) {
    const { data: cl } = await admin.from("practice_parameter_definition")
      .select("cloned_from_id, source, canonical_unit").eq("id", cloned.data.id).maybeSingle();
    ok("def-6. and it carries cloned_from_id, the origin in its source, and the origin's unit",
      cl?.cloned_from_id === WEIGHT && /weight/i.test(cl?.source ?? "") && cl?.canonical_unit === "kg",
      JSON.stringify(cl));
  }

  // ⚠ CROSS-WORKSPACE. The library read uses a PostgREST or-filter with a null test, which this codebase
  // has twice written in a way that quietly matched every row.
  const libB = await parameterLibrary(admin, ctxB);
  ok("iso-1. ⚠ workspace B does NOT see workspace A's custom parameter",
    !libB.parameters.items.some(p => p.code === "seizure_frequency"),
    libB.parameters.items.filter(p => !p.platform).map(p => p.code).join(", "));
  ok("iso-2. CONTROL: workspace B DOES see the platform library (so iso-1 is not passing on an empty read)",
    libB.parameters.items.some(p => p.code === "weight" && p.platform), `${libB.parameters.items.length} visible`);
  ok("iso-3. and B sees none of A's activations",
    libB.counts.active === 0, JSON.stringify(libB.counts));
  const foreignActivate = SEIZ ? await setActivation(admin, ctxB, { definitionId: SEIZ, state: "active", ...base }) : null;
  ok("iso-4. workspace B cannot activate workspace A's custom parameter",
    !!foreignActivate && !foreignActivate.ok && foreignActivate.code === "NOT_FOUND", JSON.stringify(foreignActivate));

  // ══ 9. PACKS -- the machinery ═══════════════════════════════════════════════════════════════════
  section("9. pack machinery: install, remember which pack, and never undo a deliberate switch-off");

  const pack = await createPack(admin, ctxA, {
    code: "paed_neuro", name: "Paediatric neurology", specialty: "Neurology", ...base,
  });
  ok("pack-1. a pack is created as a draft", pack.ok, pack.ok ? "" : pack.message);
  const PACK = pack.ok ? pack.data.id : "";

  if (PACK) {
    await setPackItem(admin, ctxA, { packId: PACK, definitionId: HC, collectionRule: "scheduled", position: 1, ...base });
    await setPackItem(admin, ctxA, { packId: PACK, definitionId: SPO2, position: 2, ...base });
    // ⚠ TEMP WAS DELIBERATELY SWITCHED OFF ABOVE. Putting it in the pack is the fixture: a naive upsert
    // would flip it back on, and the assertion below would not be able to tell the difference if the
    // pack held only parameters nobody had touched.
    await setPackItem(admin, ctxA, { packId: PACK, definitionId: TEMP, position: 3, ...base });

    const install = await installPack(admin, ctxA, { packId: PACK, ...base });
    ok("pack-2. installing activates the pack's parameters",
      install.ok && install.data.activated === 2, JSON.stringify(install));
    ok("pack-3. ⚠ and a parameter this practice had DELIBERATELY switched off stays off",
      install.ok && install.data.skippedInactive === 1, JSON.stringify(install));
    const { data: tempAfter } = await admin.from("practice_parameter_activation")
      .select("state").eq("workspace_id", wsA).eq("definition_id", TEMP).eq("scope", "practice").maybeSingle();
    ok("pack-4. CONTROL: temperature is still inactive after the install", tempAfter?.state === "inactive", JSON.stringify(tempAfter));

    // CPL s24: "which practice, pack and version caused a parameter to appear."
    const { data: hcAct } = await admin.from("practice_parameter_activation")
      .select("pack_id, pack_version, state").eq("workspace_id", wsA).eq("definition_id", HC).eq("scope", "practice").maybeSingle();
    ok("pack-5. CPL s24: the activation records WHICH pack and WHICH version put it there",
      hcAct?.pack_id === PACK && hcAct?.pack_version === 1 && hcAct?.state === "active", JSON.stringify(hcAct));

    const clone = await createPack(admin, ctxA, { code: "paed_neuro_local", name: "Paediatric neurology (ours)", cloneOf: PACK, ...base });
    ok("pack-6. cloning a pack copies its items and records the origin",
      clone.ok && clone.data.itemsCopied === 3, JSON.stringify(clone));

    const noPackCap: WorkspaceContext = { ...ctxA, capabilities: ctxA.capabilities.filter(c => c !== "pack.install") };
    const refusedInstall = await installPack(admin, noPackCap, { packId: PACK, ...base });
    ok("pack-7. a caller without pack.install cannot install one",
      !refusedInstall.ok && refusedInstall.code === "FORBIDDEN", JSON.stringify(refusedInstall));

    // ⚠ NOT A LITERAL TOTAL ANY MORE, AND THE REASON MATTERS. This asserted `items.length === 2` back
    // when the platform pack tier was empty -- so the number 2 silently encoded "no platform pack
    // exists". CPR-CPL-001's catalogue now seeds five platform packs through ensurePlatformCatalogue,
    // and migration 246 s3's read filter means every practice sees its own packs PLUS the platform
    // ones. A pinned total would now break each time the catalogue grows, and -- worse -- it could
    // have passed for the wrong reason: two platform packs and ZERO of this practice's own would also
    // have made it 2. So the two halves are asserted separately.
    const libPacks = (await parameterLibrary(admin, ctxA)).packs.items;
    ok("pack-8. the library reports the packs it can see -- this practice's own AND the platform catalogue's",
      libPacks.filter(p => !p.platform).length === 2
      && libPacks.some(p => p.code === "paed_neuro_local" && !p.platform)
      && libPacks.some(p => p.platform),
      libPacks.map(p => `${p.code}${p.platform ? " (platform)" : ""}`).join(", "));
  }

  // ══ 10. THE MONITORING PLAN -- s10.2 ════════════════════════════════════════════════════════════
  section("10. ⚠ the monitoring plan, and LCP s9's two directions");

  const pa = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Nakato Sarah", birthDate: "2019-04-01", sex: "female",
    phone: "0772 555 411", ...base,
  });
  if (!pa.ok) { ok("a patient registers for the live half", false, pa.message); return report(); }
  const patient = pa.data.id;

  const plan0 = await monitoringPlan(admin, ctxA, patient);
  ok("plan-1. a new patient inherits the practice's active parameters, all in state `inherited`",
    plan0.permitted && plan0.all.items.length > 0 && plan0.all.items.every(e => e.state === "inherited"),
    `${plan0.all.items.length} entries`);
  ok("plan-2. and each says where it came from rather than looking like a patient-specific decision",
    plan0.all.items.every(e => e.inheritedFrom !== "Patient Monitoring Plan"),
    plan0.all.items.map(e => e.inheritedFrom).join(","));

  // ⚠ DOCTRINE 2, LIVE. Nothing has a threshold yet, so everything reads "not checked" and nothing
  // reads as fine.
  ok("plan-3. ⚠ with no threshold anywhere, every parameter reads `not_checked` and NONE is reassuring",
    plan0.all.items.every(e => e.threshold.state === "not_checked" && e.threshold.reassuring === false)
    && plan0.counts.notChecked === plan0.all.items.length,
    JSON.stringify({ n: plan0.counts.notChecked, of: plan0.all.items.length }));

  const noReason = await upsertPlanEntry(admin, ctxA, {
    patientId: patient, definitionId: HC, state: "required", schedule: "monthly", reason: "   ", ...base,
  });
  ok("plan-4. s11: a patient-specific change with no reason is refused",
    !noReason.ok && noReason.code === "VALIDATION_ERROR", JSON.stringify(noReason));

  const setHc = await upsertPlanEntry(admin, ctxA, {
    patientId: patient, definitionId: HC, state: "required", schedule: "monthly",
    targetLow: 40, targetHigh: 48, reason: "Shunt in situ; monthly OFC agreed at the March review", ...base,
  });
  ok("plan-5. head circumference is required monthly for this patient, with a target",
    setHc.ok && !!setHc.data.nextDueOn, JSON.stringify(setHc));

  const untilNoDate = await upsertPlanEntry(admin, ctxA, {
    patientId: patient, definitionId: SPO2, state: "active", schedule: "until_date", reason: "x", ...base,
  });
  ok("plan-6. an \"until a date\" schedule with no date is refused (never due is not up to date)",
    !untilNoDate.ok && untilNoDate.code === "VALIDATION_ERROR", JSON.stringify(untilNoDate));
  const nForNoCount = await upsertPlanEntry(admin, ctxA, {
    patientId: patient, definitionId: SPO2, state: "active", schedule: "for_n_encounters", reason: "x", ...base,
  });
  ok("plan-7. and a \"for N encounters\" schedule with no N is refused for the same reason",
    !nForNoCount.ok && nForNoCount.code === "VALIDATION_ERROR", JSON.stringify(nForNoCount));

  // ⚠ s9, DIRECTION ONE: HIDING HIDES. Weight is hidden for this patient.
  const hideWeight = await upsertPlanEntry(admin, ctxA, {
    patientId: patient, definitionId: WEIGHT, state: "hidden",
    reason: "Family asked for weight not to be discussed at routine visits", ...base,
  });
  ok("plan-8. weight is hidden for this patient", hideWeight.ok, JSON.stringify(hideWeight));

  const planHidden = await monitoringPlan(admin, ctxA, patient);
  const routineCodes = planHidden.routine.map(e => e.code);
  ok("plan-9. ⚠ s9 DIRECTION ONE: a HIDDEN parameter is absent from routine collection",
    !routineCodes.includes("weight") && planHidden.all.items.some(e => e.code === "weight"),
    routineCodes.join(","));
  // ⚠ THE CONTROL THAT MAKES plan-9 MEAN ANYTHING. An engine that hid EVERYTHING would pass plan-9.
  ok("plan-10. CONTROL: the parameters that were not hidden ARE still in routine collection",
    routineCodes.includes("standing_height") && routineCodes.includes("head_circumference")
    && planHidden.routine.length === planHidden.all.items.length - 1,
    `${planHidden.routine.length} routine of ${planHidden.all.items.length}`);
  ok("plan-11. and the hidden parameter is NOT on the safety list, because nothing has required it yet",
    !planHidden.safetyRequired.some(e => e.code === "weight") && planHidden.counts.safetyRequired === 0,
    JSON.stringify(planHidden.counts.safetyRequired));

  // ⚠ s9, DIRECTION TWO: A SAFETY REQUIREMENT RE-SURFACES IT. The state is NOT changed.
  const safety = await requireForSafety(admin, ctxA, {
    patientId: patient, definitionId: WEIGHT,
    reason: "A weight-dependent paediatric dose needs a usable dosing weight",
    triggerSource: "medication", ...base,
  });
  ok("plan-12. a safety requirement is recorded against the hidden weight",
    safety.ok && safety.data.safetyRequired === true && safety.data.state === "hidden",
    JSON.stringify(safety));

  const planSafety = await monitoringPlan(admin, ctxA, patient);
  const weightEntry = planSafety.all.items.find(e => e.code === "weight")!;
  ok("plan-13. ⚠ s9 DIRECTION TWO: the hidden weight IS on the safety list and is flagged as re-surfaced",
    planSafety.safetyRequired.some(e => e.code === "weight") && weightEntry.resurfacedForSafety === true
    && !!weightEntry.safetyRequiredReason,
    JSON.stringify({ n: planSafety.counts.safetyRequired, r: weightEntry.resurfacedForSafety }));
  ok("plan-14. ⚠ AND IT IS STILL HIDDEN FROM ROUTINE COLLECTION -- the two are separate fields",
    !planSafety.routine.some(e => e.code === "weight") && weightEntry.state === "hidden",
    planSafety.routine.map(e => e.code).join(","));
  // ⚠ THE CONTROL. An engine where safetyRequired returned everything would pass plan-13.
  ok("plan-15. CONTROL: exactly ONE parameter is on the safety list, not all of them",
    planSafety.counts.safetyRequired === 1 && planSafety.all.items.length > 1,
    `${planSafety.counts.safetyRequired} of ${planSafety.all.items.length}`);

  // s11: a safety-required parameter cannot be quietly moved out of view.
  const safeHeight = await requireForSafety(admin, ctxA, {
    patientId: patient, definitionId: HEIGHT, reason: "BSA-based dosing needs a height", triggerSource: "medication", ...base,
  });
  const tryPause = await upsertPlanEntry(admin, ctxA, {
    patientId: patient, definitionId: HEIGHT, state: "paused", reason: "not needed today", ...base,
  });
  ok("plan-16. ⚠ s11: pausing a safety-required parameter is refused without an authorised override",
    safeHeight.ok && !tryPause.ok && tryPause.code === "SAFETY_OVERRIDE_REQUIRED",
    tryPause.ok ? "was allowed" : JSON.stringify(tryPause.code));
  const trySetRequired = await upsertPlanEntry(admin, ctxA, {
    patientId: patient, definitionId: HEIGHT, state: "required", schedule: "every_encounter", reason: "confirmed at review", ...base,
  });
  ok("plan-17. CONTROL: the same call to a state that keeps it in view IS allowed",
    trySetRequired.ok, JSON.stringify(trySetRequired));

  // s11's audit trail: five fields.
  const planEvents = await monitoringPlan(admin, ctxA, patient);
  const hcEvents = planEvents.history.items.filter(h => h.reason.includes("Shunt"));
  ok("plan-18. s11: every change records who, when, what it was, what it is now and why",
    planEvents.history.items.length > 0 && hcEvents.length > 0
    && planEvents.history.items.every(h => !!h.reason && !!h.occurredAt && !!h.field)
    && planEvents.history.items.some(h => h.actorId === USER_A),
    `${planEvents.history.items.length} events`);

  // s10.2's "Restore inherited defaults".
  const restore = await restoreInherited(admin, ctxA, {
    patientId: patient, definitionId: HEIGHT, reason: "Back to the practice default", ...base,
  });
  ok("plan-19. restoring inherited defaults sets state=inherited and clears the patient's own schedule",
    restore.ok && restore.data.state === "inherited", JSON.stringify(restore));
  ok("plan-20. ⚠ and it does NOT lift the safety requirement, which was raised elsewhere",
    restore.ok && restore.data.safetyRequirementKept === true, JSON.stringify(restore));

  // ⚠ A FAILED PLAN READ IS NOT AN EMPTY PLAN.
  const brokenPlan = await monitoringPlan(
    failingOn("practice_patient_monitoring_plan", "simulated plan failure") as never, ctxA, patient);
  ok("plan-21. ⚠ a failed plan read reports unavailable, NOT a patient with nothing monitored",
    brokenPlan.all.unavailable === true && brokenPlan.permitted === true
    && brokenPlan.counts.inPlan === null && brokenPlan.counts.safetyRequired === null
    && /simulated plan failure/.test(brokenPlan.all.detail ?? ""),
    JSON.stringify({ u: brokenPlan.all.unavailable, c: brokenPlan.counts }));

  const blindCtx: WorkspaceContext = { ...ctxA, capabilities: ctxA.capabilities.filter(c => c !== "parameter.view") };
  const deniedPlan = await monitoringPlan(admin, blindCtx, patient);
  ok("plan-22. a caller without parameter.view gets permitted:false, which is a different sentence again",
    deniedPlan.permitted === false && deniedPlan.all.unavailable === false && deniedPlan.counts.inPlan === null,
    JSON.stringify({ p: deniedPlan.permitted, u: deniedPlan.all.unavailable }));

  // ══ 11. MEASUREMENT -- s8, s12 ══════════════════════════════════════════════════════════════════
  section("11. ⚠ measurements are inserted, never updated; history is never rewritten");

  const w1 = await recordMeasurement(admin, ctxA, {
    patientId: patient, definitionId: WEIGHT, value: 18.4, unit: "kg", ...base,
  });
  ok("meas-1. a weight records, converts to the canonical unit and cites the definition version",
    w1.ok && w1.data.canonicalValue === 18.4 && w1.data.canonicalUnit === "kg" && !!w1.data.definitionVersionId,
    JSON.stringify(w1.ok ? w1.data : w1));

  // ⚠ 40 lb IS NOT 40 kg. A conversion that silently passed the number through is a factor-of-two dose.
  const wLb = await recordMeasurement(admin, ctxA, {
    patientId: patient, definitionId: WEIGHT, value: 40, unit: "lb", effectiveAt: "2026-01-10T09:00:00Z", ...base,
  });
  ok("meas-2. ⚠ a weight in POUNDS is converted, not passed through (40 lb is 18.14 kg, not 40 kg)",
    wLb.ok && Math.abs((wLb.data.canonicalValue ?? 0) - 18.143695) < 0.01,
    JSON.stringify(wLb.ok ? wLb.data.canonicalValue : wLb));

  const wStone = await recordMeasurement(admin, ctxA, { patientId: patient, definitionId: WEIGHT, value: 3, unit: "stone", ...base });
  ok("meas-3. a unit the definition does not permit is refused rather than assumed",
    !wStone.ok && (wStone.code === "UNIT_NOT_PERMITTED" || wStone.code === "UNIT_NOT_CONVERTIBLE"), JSON.stringify(wStone));

  const spo2Decimal = await recordMeasurement(admin, ctxA, { patientId: patient, definitionId: SPO2, value: 98.6, unit: "%", ...base });
  ok("meas-4. an integer parameter refuses a fraction", !spo2Decimal.ok && spo2Decimal.code === "VALIDATION_ERROR", JSON.stringify(spo2Decimal));

  const typedBmi = await recordMeasurement(admin, ctxA, { patientId: patient, definitionId: BMI, value: 13, unit: "kg/m2", ...base });
  ok("meas-5. ⚠ a CALCULATED parameter cannot be typed in -- it is derived, with its formula on the row",
    !typedBmi.ok && typedBmi.code === "CALCULATED_PARAMETER", JSON.stringify(typedBmi));

  const unitless = await createDefinition(admin, ctxA, {
    code: "unitless_number", displayName: "A number with no unit", category: "custom", dataType: "decimal", ...base,
  });
  const noUnit = unitless.ok
    ? await recordMeasurement(admin, ctxA, { patientId: patient, definitionId: unitless.data.id, value: 70, ...base })
    : null;
  ok("meas-6. ⚠ a numeric value with no unit anywhere is REFUSED (70 kg and 70 lb are the same digits)",
    !!noUnit && !noUnit.ok && noUnit.code === "UNIT_REQUIRED", JSON.stringify(noUnit));

  // ⚠ PLAUSIBILITY WARNS, IT DOES NOT REFUSE.
  //
  // ⚠ DATED INTO THE PAST ON PURPOSE, and the first version of this file did not do that. A 0.1 kg
  // weight recorded "now" became the LATEST weight, clinical-calculators.ts correctly refused to compute
  // a BMI from it, and no derived row was written at all -- which left deriv-3 ("a new weight produces a
  // NEW derived row") comparing 0 rows against 1 and passing for nothing. A vacuous assertion looks
  // exactly like a passing one. The implausible value still has to be RECORDED and still has to be
  // FLAGGED; it just must not be the row the derivation reads.
  const tiny = await recordMeasurement(admin, ctxA, { patientId: patient, definitionId: WEIGHT, value: 0.1, unit: "kg", effectiveAt: "2025-06-01T09:00:00Z", ...base });
  ok("meas-7. ⚠ an implausible value is RECORDED (a refused measurement is one nobody records)...",
    tiny.ok, JSON.stringify(tiny));
  ok("meas-8. ...and it is flagged, with an alert whose rationale says what is wrong",
    tiny.ok && tiny.data.plausibility.state === "implausible" && tiny.data.alertsRaised.length > 0
    && tiny.data.alertsRaised.every(a => a.rationale.trim().length > 0),
    JSON.stringify(tiny.ok ? tiny.data.plausibility : tiny));

  const noRecordCtx: WorkspaceContext = { ...ctxA, capabilities: ctxA.capabilities.filter(c => c !== "parameter.record") };
  const refusedRecord = await recordMeasurement(admin, noRecordCtx, { patientId: patient, definitionId: WEIGHT, value: 19, unit: "kg", ...base });
  ok("meas-9. a caller without parameter.record cannot record anything",
    !refusedRecord.ok && refusedRecord.code === "FORBIDDEN", JSON.stringify(refusedRecord));

  const foreignRecord = await recordMeasurement(admin, ctxB, { patientId: patient, definitionId: WEIGHT, value: 19, unit: "kg", ...base });
  ok("meas-10. workspace B cannot record against workspace A's patient",
    !foreignRecord.ok && foreignRecord.code === "NOT_FOUND", JSON.stringify(foreignRecord));

  // ── ⚠ THE HISTORY RULE ────────────────────────────────────────────────────────────────────────────
  const h1 = await recordMeasurement(admin, ctxA, { patientId: patient, definitionId: HEIGHT, value: 100, unit: "cm", ...base });
  ok("meas-11. a height records, which gives BMI both of its inputs", h1.ok, JSON.stringify(h1.ok ? h1.data.id : h1));

  const { data: derived1 } = await admin.from("practice_parameter_derived")
    .select("id, value, unit, formula, source_measurement_ids, calculated_at")
    .eq("patient_id", patient).eq("definition_id", BMI).order("calculated_at", { ascending: true });
  const firstBmi = ((derived1 ?? []) as { id: string; value: number; formula: string; source_measurement_ids: string[] }[])[0];
  ok("deriv-1. LCP s13: a BMI is derived, and it carries its published formula and its source rows",
    !!firstBmi && /weight \(kg\) \/ height \(m\)\^2/.test(firstBmi.formula)
    && firstBmi.source_measurement_ids.length === 2,
    JSON.stringify(firstBmi));

  // ⚠ REUSE, NOT RE-IMPLEMENTATION. The engine's number must equal clinical-calculators.ts's own.
  const bmiCalc = CALCULATORS.find(c => c.key === "bmi")!.compute({ weight: "18.4", height: "100" });
  ok("deriv-2. ⚠ and the value is clinical-calculators.ts's own output, not new arithmetic",
    !!firstBmi && bmiCalc.ok && Math.abs(Number(firstBmi.value) - bmiCalc.value) < 0.001,
    JSON.stringify({ engine: firstBmi?.value, calculator: bmiCalc.ok ? bmiCalc.value : bmiCalc }));

  // ⚠ THE ASSERTION THIS SECTION EXISTS FOR. A LATER WEIGHT MUST NOT REWRITE THE OLD DERIVED ROW.
  const before = JSON.stringify(firstBmi);
  const w2 = await recordMeasurement(admin, ctxA, { patientId: patient, definitionId: WEIGHT, value: 20.0, unit: "kg", ...base });
  const { data: derived2 } = await admin.from("practice_parameter_derived")
    .select("id, value, unit, formula, source_measurement_ids, calculated_at")
    .eq("patient_id", patient).eq("definition_id", BMI).order("calculated_at", { ascending: true });
  const rows2 = (derived2 ?? []) as { id: string; value: number; formula: string; source_measurement_ids: string[] }[];
  ok("deriv-3. a new weight produces a NEW derived row rather than changing the old one",
    w2.ok && rows2.length === ((derived1 ?? []).length + 1), `${(derived1 ?? []).length} -> ${rows2.length}`);
  ok("deriv-4. ⚠ LCP s9: THE FIRST DERIVED ROW IS BYTE-IDENTICAL AFTERWARDS, with its original sources",
    JSON.stringify(rows2[0]) === before, `${before}\n         vs ${JSON.stringify(rows2[0])}`);
  ok("deriv-5. and the new row cites the NEW weight, so the two are distinguishable",
    rows2.length >= 2 && w2.ok && rows2[rows2.length - 1].source_measurement_ids.includes(w2.data.id),
    JSON.stringify(rows2[rows2.length - 1]?.source_measurement_ids));

  // ⚠ HALF THE INPUTS MEANS NO DERIVED ROW. LCP s13: a weight-based entry REQUESTS a usable weight.
  const pb = await registerPatient(admin, { workspaceId: wsA, displayName: "Okello Brian", birthDate: "2018-02-02", sex: "male", ...base });
  if (pb.ok) {
    await recordMeasurement(admin, ctxA, { patientId: pb.data.id, definitionId: HEIGHT, value: 110, unit: "cm", ...base });
    const { count: partial } = await admin.from("practice_parameter_derived")
      .select("*", { count: "exact", head: true }).eq("patient_id", pb.data.id);
    ok("deriv-6. ⚠ a height with no weight derives NOTHING -- a BMI from half the inputs is an estimate",
      (partial ?? -1) === 0, `${partial} derived row(s)`);
  }

  // ── Corrections are new rows ──────────────────────────────────────────────────────────────────────
  const originalId = w1.ok ? w1.data.id : "";
  const { data: originalBefore } = await admin.from("practice_parameter_measurement")
    .select("id, value_numeric, canonical_value, unit, status, recorded_at").eq("id", originalId).maybeSingle();

  const noReasonAmend = await recordMeasurement(admin, ctxA, {
    patientId: patient, definitionId: WEIGHT, value: 18.9, unit: "kg", amendsMeasurementId: originalId, ...base,
  });
  ok("amend-1. a correction with no reason is refused",
    !noReasonAmend.ok && noReasonAmend.code === "VALIDATION_ERROR", JSON.stringify(noReasonAmend));

  const amend = await recordMeasurement(admin, ctxA, {
    patientId: patient, definitionId: WEIGHT, value: 18.9, unit: "kg",
    amendsMeasurementId: originalId, amendmentReason: "Scales were not zeroed", ...base,
  });
  const { data: originalAfter } = await admin.from("practice_parameter_measurement")
    .select("id, value_numeric, canonical_value, unit, status, recorded_at").eq("id", originalId).maybeSingle();
  ok("amend-2. a correction is a NEW ROW naming the one it corrects", amend.ok, JSON.stringify(amend));
  ok("amend-3. ⚠ and the ORIGINAL row is untouched, field for field",
    JSON.stringify(originalBefore) === JSON.stringify(originalAfter),
    `${JSON.stringify(originalBefore)}\n         vs ${JSON.stringify(originalAfter)}`);
  ok("amend-4. there is no `amended` status -- being amended is a LATER ROW naming you, which is a read",
    originalAfter?.status === "active", JSON.stringify(originalAfter?.status));

  const retractNoTarget = await recordMeasurement(admin, ctxA, {
    patientId: patient, definitionId: WEIGHT, value: null, enteredInError: true, ...base,
  });
  ok("amend-5. a retraction that names nothing is refused",
    !retractNoTarget.ok && retractNoTarget.code === "VALIDATION_ERROR", JSON.stringify(retractNoTarget));

  // ── Alerts: s8 steps 7 and 8 ──────────────────────────────────────────────────────────────────────
  const hcOver = await recordMeasurement(admin, ctxA, { patientId: patient, definitionId: HC, value: 55, unit: "cm", ...base });
  ok("alert-1. a value outside the PATIENT's target raises an alert with a rationale",
    hcOver.ok && hcOver.data.alertsRaised.length > 0
    && hcOver.data.alertsRaised.every(a => a.rationale.trim().length > 10),
    JSON.stringify(hcOver.ok ? hcOver.data.alertsRaised : hcOver));
  ok("alert-2. ⚠ its severity is `action_required`, not `critical` -- how dangerous depends on the patient",
    hcOver.ok && hcOver.data.alertsRaised.some(a => a.severity === "action_required"),
    JSON.stringify(hcOver.ok ? hcOver.data.alertsRaised.map(a => a.severity) : hcOver));
  ok("alert-3. CONTROL: a value INSIDE the target raises none",
    (await recordMeasurement(admin, ctxA, { patientId: patient, definitionId: HC, value: 44, unit: "cm", effectiveAt: "2026-02-01T09:00:00Z", ...base }))
      .ok === true
    && ((await recordMeasurement(admin, ctxA, { patientId: patient, definitionId: HC, value: 45, unit: "cm", effectiveAt: "2026-02-02T09:00:00Z", ...base }) as { ok: true; data: { alertsRaised: unknown[] } }).data.alertsRaised.length === 0));

  // ⚠ A NULL SEVERITY RENDERS AS "NOT CLASSIFIED", NEVER AS THE LOWEST LEVEL.
  await admin.from("practice_parameter_alert").insert({
    workspace_id: wsA, patient_id: patient, definition_id: HC, alert_type: "trend_deviation",
    severity: null, rationale: "A rule with no severity fired", status: "open",
  });
  const planAlerts = await monitoringPlan(admin, ctxA, patient);
  const unclassified = planAlerts.alerts.items.find(a => a.severity === null);
  ok("alert-4. ⚠ a NULL severity reads \"Not classified\", never `informational` and never a blank",
    !!unclassified && unclassified.severityLabel === "Not classified",
    JSON.stringify(unclassified?.severityLabel));
  ok("alert-5. CONTROL: a classified alert reads its own level",
    planAlerts.alerts.items.some(a => a.severity === "action_required" && a.severityLabel === "Action required"),
    planAlerts.alerts.items.map(a => a.severityLabel).join(","));

  const anAlert = planAlerts.alerts.items.find(a => a.severity !== null);
  const noOverrideReason = anAlert ? await resolveAlert(admin, ctxA, { alertId: anAlert.id, status: "overridden", ...base }) : null;
  ok("alert-6. s11: an override with no justification is refused",
    !!noOverrideReason && !noOverrideReason.ok && noOverrideReason.code === "OVERRIDE_REASON_REQUIRED",
    JSON.stringify(noOverrideReason));
  const withReason = anAlert
    ? await resolveAlert(admin, ctxA, { alertId: anAlert.id, status: "overridden", overrideReason: "Measured over a dressing; repeating next week", ...base })
    : null;
  ok("alert-7. CONTROL: the same override WITH a reason is accepted", !!withReason && withReason.ok, JSON.stringify(withReason));

  // ⚠ A FAILED ALERT READ IS NOT "NO ALERTS".
  const brokenAlerts = await monitoringPlan(failingOn("practice_parameter_alert", "simulated alert failure") as never, ctxA, patient);
  ok("alert-8. ⚠ a failed alert read says so, and the open-alert count is null rather than nought",
    brokenAlerts.alerts.unavailable === true && brokenAlerts.counts.openAlerts === null,
    JSON.stringify({ u: brokenAlerts.alerts.unavailable, n: brokenAlerts.counts.openAlerts }));

  // ══ 12. THE SERIES AND THE TREND ════════════════════════════════════════════════════════════════
  section("12. ⚠ the raw series, with no centile bands behind it");

  const series = await parameterSeries(admin, ctxA, patient, WEIGHT);
  ok("ser-1. the series comes back in date order with its canonical values",
    series.permitted && !series.unavailable && series.points.length >= 3
    && series.points.every((p, i) => i === 0 || p.at >= series.points[i - 1].at),
    `${series.points.length} points`);
  ok("ser-2. ⚠ percentileBands is null and the payload carries the reason, naming WHO 2006 and CDC 2000",
    series.percentileBands === null && /WHO 2006/.test(series.percentileBandsRefusal)
    && /CDC 2000/.test(series.percentileBandsRefusal),
    series.percentileBandsRefusal.slice(0, 60));
  ok("ser-3. corrections stay visible in the series rather than replacing what they correct",
    series.amendments.length >= 1 && series.amendments.every(a => !!a.reason),
    JSON.stringify(series.amendments.map(a => a.reason)));
  ok("ser-4. ⚠ with no direction agreed, the trend refuses to say improving or deteriorating",
    series.trend.state === "no_direction_agreed", JSON.stringify(series.trend.state));

  await upsertPlanEntry(admin, ctxA, {
    patientId: patient, definitionId: WEIGHT, state: "hidden",
    improvingDirection: "up", reason: "Weight gain is the goal; agreed with the family in May", ...base,
  });
  const series2 = await parameterSeries(admin, ctxA, patient, WEIGHT);
  ok("ser-5. CONTROL: once `up` is agreed IN ADVANCE, the same series does yield a direction, with its basis",
    ["improving", "deteriorating", "unchanged"].includes(series2.trend.state) && !!series2.trend.basis,
    JSON.stringify(series2.trend));
  ok("ser-6. and the change is an absolute figure about ONE patient, with the two dates it spans",
    !!series2.change && typeof series2.change.absolute === "number" && !!series2.change.fromAt && !!series2.change.toAt,
    JSON.stringify(series2.change));

  // ⚠ A BOUNDARY WORTH RECORDING RATHER THAN GUESSING AT. The intelligence engine's no-rates detector
  // walks field names, and `percent` is one of them -- so this payload must never be merged into an
  // intelligence payload. Asserting that findRates FIRES here is the proof the guard is still armed.
  ok("ser-7. ⚠ findRates DOES fire on the series payload, so it must stay out of the intelligence payload",
    findRates(series2).some(v => /percent/.test(v.sample)),
    JSON.stringify(findRates(series2).map(v => v.path)));

  const brokenSeries = await parameterSeries(failingOn("practice_parameter_measurement", "simulated series failure") as never, ctxA, patient, WEIGHT);
  ok("ser-8. ⚠ a failed series read is unavailable with zero points, never a patient with no history",
    brokenSeries.unavailable === true && brokenSeries.points.length === 0
    && /simulated series failure/.test(brokenSeries.detail ?? ""),
    JSON.stringify({ u: brokenSeries.unavailable, d: brokenSeries.detail }));

  // ══ 13. THE ENCOUNTER FORM -- s10.3 ═════════════════════════════════════════════════════════════
  section("13. ⚠ collection during a visit, and the carry-forward prohibition");

  const enc = await launchEncounter(admin, {
    workspaceId: wsA, patientId: patient, pathway: "scheduled_followup", reasonForVisit: "shunt review", ...base,
  });
  if (!enc.ok) { ok("an encounter launches", false, enc.message); return report(); }
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: enc.data.id, to: "ACTIVE", ...base });

  const form = await encounterParameters(admin, ctxA, enc.data.id);
  ok("enc-1. the collection form loads with the patient's parameters split into priority and optional",
    form.permitted && !form.unavailable && (form.counts.priority ?? 0) > 0,
    JSON.stringify(form.counts));
  ok("enc-2. s10.3: due, required and safety-required parameters are the ones shown first",
    form.priority.every(e => ["safety_required", "overdue", "due_today", "required", "every_visit", "encounter_addition"].includes(e.reasonShown)),
    form.priority.map(e => `${e.code}:${e.reasonShown}`).join(", "));

  // ⚠ THE CARRY-FORWARD ASSERTION, BOTH HALVES.
  const weightOnForm = [...form.priority, ...form.optional].find(e => e.code === "weight");
  ok("enc-3. ⚠ LCP s10.3: a prior value is PRESENT as history...",
    !!weightOnForm && weightOnForm.latest !== null && weightOnForm.value.state === "value",
    JSON.stringify(weightOnForm?.latest?.value));
  ok("enc-4. ⚠ ...and ABSENT as an entry for this encounter (nothing is carried forward)",
    !!weightOnForm && weightOnForm.recordedThisEncounter === null,
    JSON.stringify(weightOnForm?.recordedThisEncounter));
  ok("enc-5. and the payload carries the prohibition itself, so a screen cannot lose it",
    form.carryForwardProhibited === true);

  // ⚠ s9 AT THE POINT OF COLLECTION. Weight is hidden on the plan AND required for safety.
  ok("enc-6. ⚠ the HIDDEN, safety-required weight DOES appear on the encounter form",
    !!weightOnForm && weightOnForm.state === "hidden" && weightOnForm.safetyRequired === true
    && form.priority.some(e => e.code === "weight" && e.reasonShown === "safety_required"),
    JSON.stringify({ s: weightOnForm?.state, r: weightOnForm?.reasonShown }));

  // ⚠ THE CONTROL. Hidden WITHOUT a safety requirement must NOT appear.
  await upsertPlanEntry(admin, ctxA, {
    patientId: patient, definitionId: HC, state: "hidden", reason: "OFC no longer monitored routinely", ...base,
  });
  const form2 = await encounterParameters(admin, ctxA, enc.data.id);
  ok("enc-7. ⚠ CONTROL: a parameter hidden WITHOUT a safety requirement does NOT appear on the form",
    !form2.priority.some(e => e.code === "head_circumference")
    && !form2.optional.some(e => e.code === "head_circumference")
    && form2.priority.some(e => e.code === "weight"),
    [...form2.priority, ...form2.optional].map(e => e.code).join(", "));

  const recordedHere = await recordMeasurement(admin, ctxA, {
    patientId: patient, definitionId: WEIGHT, value: 21.2, unit: "kg", encounterId: enc.data.id, ...base,
  });
  const form3 = await encounterParameters(admin, ctxA, enc.data.id);
  const weightNow = [...form3.priority, ...form3.optional].find(e => e.code === "weight");
  ok("enc-8. CONTROL: a value recorded IN this encounter DOES show as recorded here",
    recordedHere.ok && !!weightNow?.recordedThisEncounter
    && /21.2/.test(weightNow.recordedThisEncounter.value),
    JSON.stringify(weightNow?.recordedThisEncounter));

  // s4's encounter override: "Adds a one-off parameter for a specific review. | Postural BP today only."
  //
  // ⚠ THE FIXTURE IS A PARAMETER THE PRACTICE DOES NOT COLLECT. See the note over WAIST.
  const formBefore = await encounterParameters(admin, ctxA, enc.data.id);
  ok("enc-9a. CONTROL: the parameter about to be added for today is NOT otherwise on the form",
    ![...formBefore.priority, ...formBefore.optional].some(e => e.code === "waist_circumference"),
    [...formBefore.priority, ...formBefore.optional].map(e => e.code).join(", "));

  const { count: practiceScopeBefore } = await admin.from("practice_parameter_activation")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("scope", "practice");
  const addition = await addEncounterParameter(admin, ctxA, {
    encounterId: enc.data.id, definitionId: WAIST, reason: "one-off today", ...base,
  });
  const { count: practiceScopeAfter } = await admin.from("practice_parameter_activation")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("scope", "practice");
  ok("enc-9. s4: a one-off addition is written at ENCOUNTER scope with the encounter's id",
    addition.ok, JSON.stringify(addition));
  ok("enc-10. ⚠ and it does NOT become a practice default (the practice-scope count is unchanged)",
    practiceScopeBefore === practiceScopeAfter, `${practiceScopeBefore} -> ${practiceScopeAfter}`);

  const form4 = await encounterParameters(admin, ctxA, enc.data.id);
  ok("enc-11. the addition appears on THIS review's form, labelled as added for today",
    form4.additions.some(e => e.code === "waist_circumference")
    && form4.priority.some(e => e.code === "waist_circumference" && e.reasonShown === "encounter_addition"),
    form4.additions.map(e => e.code).join(", "));

  await transitionEncounter(admin, { workspaceId: wsA, encounterId: enc.data.id, to: "COMPLETED", ...base });
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: enc.data.id, to: "SIGNED", ...base });
  const lateAddition = await addEncounterParameter(admin, ctxA, { encounterId: enc.data.id, definitionId: TEMP, ...base });
  ok("enc-13. nothing can be added to a signed encounter",
    !lateAddition.ok && lateAddition.code === "LOCKED", JSON.stringify(lateAddition));

  // A second encounter must NOT inherit the one-off.
  //
  // ⚠ LAUNCHED ONLY AFTER THE FIRST IS SIGNED, and the first version of this file did not do that.
  // launchEncounter RESUMES a live encounter rather than creating a second one, so `enc2` was `enc` --
  // and the control was asserting that an encounter's own additions were not its own additions. The
  // identity check below is what stops that recurring: a control whose fixture is the thing it is
  // controlling against is not a control.
  const enc2 = await launchEncounter(admin, {
    workspaceId: wsA, patientId: patient, pathway: "scheduled_followup", reasonForVisit: "later visit", ...base,
  });
  ok("enc-12a. CONTROL: the second encounter really is a DIFFERENT encounter, not a resumed one",
    enc2.ok && enc2.data.id !== enc.data.id && enc2.data.resumed === false,
    JSON.stringify(enc2.ok ? { id: enc2.data.id, resumed: enc2.data.resumed } : enc2));
  if (enc2.ok && enc2.data.id !== enc.data.id) {
    const otherForm = await encounterParameters(admin, ctxA, enc2.data.id);
    ok("enc-12. ⚠ CONTROL: the NEXT encounter does not inherit the one-off addition",
      otherForm.additions.length === 0
      && !otherForm.priority.some(e => e.reasonShown === "encounter_addition"),
      otherForm.additions.map(e => e.code).join(", "));
    ok("enc-12b. and it is not empty either -- the practice's own active parameters are still offered",
      otherForm.priority.length + otherForm.optional.length > 0,
      `${otherForm.priority.length} + ${otherForm.optional.length}`);
  }

  const brokenForm = await encounterParameters(failingOn("practice_encounter", "simulated encounter failure") as never, ctxA, enc.data.id);
  ok("enc-14. ⚠ a failed encounter read is unavailable, NOT an empty collection form",
    brokenForm.unavailable === true && brokenForm.priority.length === 0
    && brokenForm.counts.priority === null && /simulated encounter failure/.test(brokenForm.detail ?? ""),
    JSON.stringify({ u: brokenForm.unavailable, c: brokenForm.counts }));

  const deniedForm = await encounterParameters(admin, blindCtx, enc.data.id);
  ok("enc-15. and a caller who may not see parameters gets permitted:false, not an empty form",
    deniedForm.permitted === false && deniedForm.unavailable === false, JSON.stringify(deniedForm.permitted));

  // ══ 14. LIBRARY THREE-STATE + RLS ═══════════════════════════════════════════════════════════════
  section("14. the library's own three states, and row-level security");

  const brokenLib = await parameterLibrary(failingOn("practice_parameter_definition", "simulated library failure") as never, ctxA);
  ok("lib-8b. ⚠ a failed library read is unavailable with null counts, never \"nothing is configured\"",
    brokenLib.parameters.unavailable === true && brokenLib.counts.inLibrary === null
    && /simulated library failure/.test(brokenLib.parameters.detail ?? ""),
    JSON.stringify(brokenLib.counts));

  const brokenActivations = await parameterLibrary(failingOn("practice_parameter_activation", "simulated activation failure") as never, ctxA);
  ok("lib-9. ⚠ a failed ACTIVATION read makes every threshold `unreadable`, not `not_checked`",
    brokenActivations.parameters.items.length > 0
    && brokenActivations.parameters.items.every(p => p.threshold.state === "unreadable")
    && brokenActivations.counts.active === null,
    JSON.stringify(brokenActivations.counts));

  const deniedLib = await parameterLibrary(admin, blindCtx);
  ok("lib-10. a caller without parameter.view gets permitted:false and null counts",
    deniedLib.permitted === false && deniedLib.counts.inLibrary === null);

  let svcRows = 0, leaked = 0;
  const RLS_TABLES = [
    "practice_parameter_definition", "practice_parameter_activation",
    "practice_patient_monitoring_plan", "practice_parameter_measurement",
    "practice_parameter_derived", "practice_parameter_alert",
    "practice_patient_monitoring_plan_event",
  ];
  for (const t of RLS_TABLES) {
    const { count: svc } = await admin.from(t).select("*", { count: "exact", head: true });
    if ((svc ?? 0) > 0) svcRows++;
    const { count: a } = await anon.from(t).select("*", { count: "exact", head: true });
    if ((a ?? 0) > 0) leaked++;
  }
  ok("rls-1. control: the service role sees rows in every table under test (the denial test is not vacuous)",
    svcRows === RLS_TABLES.length, `${svcRows}/${RLS_TABLES.length}`);
  ok("rls-2. anon reads 0 rows from all of them", leaked === 0, `${leaked} table(s) leaked`);

  // ══ 15. CLEANUP ═════════════════════════════════════════════════════════════════════════════════
  section("15. cleanup");
  await cleanup();
  const { count: leftMeasurements } = await admin.from("practice_parameter_measurement")
    .select("*", { count: "exact", head: true }).eq("patient_id", patient);
  ok("clean-1. the synthetic patient's measurements are gone (cascade)", (leftMeasurements ?? -1) === 0, `${leftMeasurements}`);
  const { count: leftPlatform } = await admin.from("practice_parameter_definition")
    .select("*", { count: "exact", head: true }).is("workspace_id", null);
  ok("clean-2. ⚠ and the PLATFORM library survives -- it belongs to nobody's workspace",
    (leftPlatform ?? 0) >= CORE_LIBRARY.length, `${leftPlatform}`);

  report();
}

function report() {
  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}\n`);
  process.exit(fails.length ? 1 : 0);
}

main();
