/**
 * Patients workspace harness -- CPR-V5-006. No migration; every table it touches is 191-226.
 *
 * WHAT IT PROVES:
 *   1.  UNIVERSAL SEARCH REACHES A PERSON BY EVERY ROUTE THE SPEC NAMES -- practice ID, hospital
 *       number, national ID, passport, phone, email, name -- and by the one it adds: PARENT/GUARDIAN
 *       PHONE, typed without the spaces the record holds.
 *   2.  RANKING IS IDENTITY, NOT TEXT. An exact identifier hit outranks a partial name hit, proven on
 *       two DIFFERENT patients so the wrong order would be visible.
 *   3.  AN EMPTY BOX HAS NOT SEARCHED. ran:false, never "no results".
 *   4.  A FAILED READ IS NEVER A ZERO. Every count is null when the read failed, the database's own
 *       words come back with it, and each refusal has a control proving it is not refusing everything.
 *   5.  EVERY FIGURE IS THE LENGTH OF A LIST YOU CAN OPEN -- count === rows.length, and the patient ids
 *       behind it open a filtered cohort.
 *   6.  PENDING RESULTS ARE WHAT ARRIVED, NOT WHAT WAS ORDERED. A planned investigation is present in
 *       the record and is deliberately NOT in the results worklist.
 *   7.  "TODAY" IS THE PRACTICE'S TODAY. A registration timestamped inside the Kampala day but outside
 *       the UTC day is counted; one an hour before the Kampala day started is not.
 *   8.  DUE IS DERIVED. An overdue follow-up is listed; a future one is not.
 *   9.  THE COHORT'S SEVEN COLUMNS, four of them derived, with pagination whose page size is a field.
 *  10.  patient.view GATES NAMES, patient.list GATES LISTS -- the de-identified list is the same length
 *       as the named one, so withholding a name is not withholding the fact.
 *  11.  THE CONTEXT BANNER carries identifiers, derived age, outstanding counts and a care setting that
 *       says what it is based on.
 *  12.  MEDICATIONS ARE INTENTIONS AND SAY SO, and an investigation never appears among them.
 *  13.  FAMILY: parents and guardians are REPORTED, siblings are INFERRED from a shared guardian, and a
 *       guardian who shares only the name is NOT inferred.
 *  14.  Cross-workspace isolation, non-vacuously, on every surface.
 *  15.  NO RATES, PERCENTAGES, TARGETS OR BASELINES anywhere in the payload.
 *
 *   npx --yes tsx scripts/practice-patient-workspace-harness.ts
 */
import { PATIENT_STATUS_SWATCH, WORKLIST_SWATCH } from "../src/lib/practice/palette";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { addFacility, addPatientIdentifier } from "../src/lib/practice/facilities";
import { addRelationship } from "../src/lib/practice/relationships";
import { launchEncounter, transitionEncounter, recordTreatment, recordDiagnosis } from "../src/lib/practice/encounters";
import { createFollowUp } from "../src/lib/practice/follow-ups";
import { recordIncoming, reviewIncoming } from "../src/lib/practice/communication";
import { zonedDayRange, practiceToday } from "../src/lib/practice/practice-time";
import {
  universalSearch, worklists, myPatients, patientSummary, patientContextBanner,
  familyRelationships, patientsWorkspace,
} from "../src/lib/practice/patient-workspace";
import {
  WORKLIST_KEYS, REFUSES, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, COHORT_STATUS_LABELS,
} from "../src/lib/practice/patient-workspace-constants";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-00000000pw01".replace("pw01", "df01");
const OTHER = "00000000-0000-4000-8000-00000000df02";
const CID = "harness-pw";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

/* eslint-disable @typescript-eslint/no-explicit-any */

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  // ⚠ THE ERROR WAS DISCARDED HERE AND THE KEY WAS STATIC, WHICH IS TWO HALVES OF ONE FAILURE.
  //
  // `harness-pw-a` collides with any row left behind by a run that did not reach its cleanup -- which is
  // what happens when a harness is interrupted, and this one was. The insert then failed, `data` came
  // back undefined, and `req!.id` threw `Cannot read properties of null (reading 'id')` from a line
  // that has nothing to do with the actual problem. Ten minutes of looking in the wrong place.
  //
  // Date.now() in the key matches what the current-activity harness already does, and capturing the
  // error means the next collision says so in one line instead of pointing at a null dereference. The
  // discarded-error rule applies to test code as much as to engines -- arguably more, because a harness
  // that misreports its own failure sends you hunting through the code it was supposed to be checking.
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-pw-${suffix}-${Date.now()}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: CID,
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row returned"}`);
  const run = await runProvisioning(admin, { id: req.id, target_user_id: user, correlation_id: CID, workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [OWNER, OTHER]) {
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) await admin.from("practice_workspace").delete().eq("id", w.id);
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
}

async function withoutCapabilities(workspaceId: string, userId: string, capabilities: string[]): Promise<WorkspaceContext> {
  const { data: mine } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", workspaceId).eq("user_id", userId);
  await admin.from("practice_role_assignment").update({ effective_to: new Date().toISOString() })
    .in("membership_id", ((mine ?? []) as any[]).map(m => m.id))
    .in("capability_code", capabilities).is("effective_to", null);
  const res = await resolveWorkspaceContext(admin, userId, workspaceId);
  if (!res.ok) throw new Error("context failed");
  return res.ctx;
}

async function restoreCapabilities(workspaceId: string, userId: string, capabilities: string[]) {
  const { data: mine } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", workspaceId).eq("user_id", userId);
  await admin.from("practice_role_assignment").update({ effective_to: null })
    .in("membership_id", ((mine ?? []) as any[]).map(m => m.id))
    .in("capability_code", capabilities);
}

/**
 * A client that FAILS on named tables and works everywhere else.
 *
 * This is how "a failed read is never a zero" is proven without breaking the database for everybody:
 * one table answers with an error, every other table answers normally, and the assertion checks that
 * the count came back null rather than 0 AND that the neighbouring counts are still real -- which is
 * the control that stops the refusal from being "it refused everything".
 */
const BROKEN = "harness: simulated read failure on";
function failingOn(tables: string[]) {
  const broken = (table: string): any => {
    const result = { data: null, error: { message: `${BROKEN} ${table}` } };
    const b: any = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (res: any, rej: any) => Promise.resolve(result).then(res, rej);
        return () => b;
      },
    });
    return b;
  };
  return new Proxy(admin, {
    get(target, prop, receiver) {
      if (prop === "from") {
        return (table: string) => (tables.includes(table) ? broken(table) : (target as any).from(table));
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as any;
}

function birthDateFor(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

/** Every key in a payload, however deep. Used to prove no rate ever appears. */
function allKeys(value: any, acc: string[] = [], depth = 0): string[] {
  if (depth > 12 || value === null || typeof value !== "object") return acc;
  if (Array.isArray(value)) { for (const v of value) allKeys(v, acc, depth + 1); return acc; }
  for (const [k, v] of Object.entries(value)) { acc.push(k); allKeys(v, acc, depth + 1); }
  return acc;
}

/**
 * Rate-shaped WORDS, not substrings.
 *
 * The first version of this test matched /ratio/ against every key and flagged `duration`, which
 * contains it. A detector that fires on a false positive is a detector nobody will keep, so keys are
 * split on camel case and underscores and the words are compared whole.
 */
const RATE_WORDS = ["rate", "rates", "percent", "percentage", "pct", "ratio", "target", "goal", "baseline", "benchmark", "score"];
function rateShapedKeys(keys: string[]): string[] {
  const words = keys.flatMap(k =>
    k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_]+/).map(x => x.toLowerCase()));
  return [...new Set(words.filter(x => RATE_WORDS.includes(x)))];
}

async function main() {
  console.log("\nPatients workspace harness (CPR-V5-006, no migration)\n");
  await cleanup();

  const wsA = await provision(OWNER, "HARNESS Patients A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Patients B (synthetic)", "b");
  const ra = await resolveWorkspaceContext(admin, OWNER, wsA);
  const rb = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!ra.ok || !rb.ok) { ok("workspace contexts resolve", false); return report(); }
  const a = ra.ctx, b = rb.ctx;
  const base = { actorId: OWNER, correlationId: CID };

  // ══ FIXTURE ════════════════════════════════════════════════════════════════
  //
  // Two children who share a mother (name AND phone), one adult whose "mother" shares only the NAME,
  // an adult with a full clinical record, and a never-seen registration. The shapes are chosen so that
  // the WRONG answer is a different answer -- a sibling inference on the name alone would pick up the
  // third patient, and it must not.

  const child = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Nakato Aisha", sex: "female",
    birthDate: birthDateFor(6), phone: "0700 111 001", ...base,
  });
  const sibling = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Nakato Brian", sex: "male",
    birthDate: birthDateFor(3), phone: "0700 111 002", ...base,
  });
  const namesake = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Nakato Clara", sex: "female",
    birthDate: birthDateFor(9), phone: "0700 111 003", ...base,
  });
  const adult = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Okello Daniel", sex: "male",
    birthDate: birthDateFor(41), phone: "0700 111 004", email: "daniel.okello@example.test",
    identifiers: [{ type: "national_id", value: "CM90210" }, { type: "passport", value: "UG556677" }],
    ...base,
  });
  const fresh = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Namubiru Esther", sex: "female",
    ageEstimateYears: 30, phone: "0700 111 005", ...base,
  });
  const waitingPatient = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Ssebunya Frank", sex: "male",
    birthDate: birthDateFor(52), phone: "0700 111 006", ...base,
  });
  const registeredYesterday = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Kizza Grace", sex: "female",
    birthDate: birthDateFor(28), phone: "0700 111 007", ...base,
  });
  const registeredEarly = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Lubega Henry", sex: "male",
    birthDate: birthDateFor(33), phone: "0700 111 008", ...base,
  });
  // A MONONYM. "Nakato" alone is a whole name -- patients.ts says so and refuses to demand three parts.
  // It is here because it is the only way to make the ranking test non-vacuous: searching "Nakato" then
  // produces an EXACT name hit on this record and PARTIAL hits on three others, so an implementation
  // that ranked them equally, or the wrong way round, would show.
  const mononym = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Nakato", sex: "female",
    birthDate: birthDateFor(25), phone: "0700 111 009", ...base,
  });
  const everyone = [child, sibling, namesake, adult, fresh, waitingPatient, registeredYesterday, registeredEarly, mononym];
  ok("the nine fixture patients register", everyone.every(p => p.ok),
    everyone.map(p => (p.ok ? "ok" : p.message)).join(" | "));
  if (!child.ok || !sibling.ok || !namesake.ok || !adult.ok || !fresh.ok || !waitingPatient.ok
    || !registeredYesterday.ok || !registeredEarly.ok || !mononym.ok) return report();

  // Hospital numbers, issued by a named facility (migration 222).
  const facility = await addFacility(admin, a, { name: "Mulago National Referral", facilityType: "hospital", correlationId: CID });
  ok("a facility is recorded", facility.ok, facility.ok ? "" : facility.message);
  if (!facility.ok) return report();
  const hosp1 = await addPatientIdentifier(admin, a, {
    patientId: adult.data.id, identifierType: "hospital_number", value: "MUL-778899",
    facilityId: facility.data.id, correlationId: CID,
  });
  const hosp2 = await addPatientIdentifier(admin, a, {
    patientId: adult.data.id, identifierType: "outpatient_number", value: "OPD-4242",
    facilityId: facility.data.id, correlationId: CID,
  });
  ok("two hospital numbers are recorded against one patient", hosp1.ok && hosp2.ok,
    [hosp1, hosp2].map(r => (r.ok ? "ok" : r.message)).join(" | "));

  // The shared mother -- same name, same number, against two children.
  const MOTHER_PHONE = "0772 400 010";
  const relChild = await addRelationship(admin, a, {
    patientId: child.data.id, relationshipType: "mother", fullName: "Nakato Sarah",
    phone: MOTHER_PHONE, email: "sarah.nakato@example.test",
    isLegalGuardian: true, mayReceiveInformation: true, isPrimary: true, correlationId: CID,
  });
  const relSibling = await addRelationship(admin, a, {
    patientId: sibling.data.id, relationshipType: "mother", fullName: "Nakato Sarah",
    phone: MOTHER_PHONE, isLegalGuardian: true, isPrimary: true, correlationId: CID,
  });
  // THE CONTROL FOR THE INFERENCE: the same name, a DIFFERENT number. A rule that matched on the name
  // alone would call this child a sibling of the other two, and it is not.
  const relNamesake = await addRelationship(admin, a, {
    patientId: namesake.data.id, relationshipType: "mother", fullName: "Nakato Sarah",
    phone: "0772 999 999", isLegalGuardian: true, isPrimary: true, correlationId: CID,
  });
  const relSib = await addRelationship(admin, a, {
    patientId: child.data.id, relationshipType: "sibling", fullName: "Nakato Brian", correlationId: CID,
  });
  ok("the guardian fixture is recorded", relChild.ok && relSibling.ok && relNamesake.ok && relSib.ok,
    [relChild, relSibling, relNamesake, relSib].map(r => (r.ok ? "ok" : r.message)).join(" | "));

  // A PLACE FOR THE CONSULTATION TO HAPPEN IN. The location is where the room is; the facility comes
  // through the activity the encounter is opened inside (migration 232), which is the only route this
  // schema has from an encounter to a hospital.
  const { data: location } = await admin.from("practice_location")
    .insert({ workspace_id: wsA, name: "Kampala Consulting Rooms", type: "clinic", country: "UG" })
    .select("id").single();
  const { data: activity } = await admin.from("practice_activity").insert({
    workspace_id: wsA, practitioner_id: OWNER, activity_type: "outpatient_clinic",
    title: "Morning clinic", facility_id: facility.data.id, location_id: location!.id,
    plan_date: practiceToday("Africa/Kampala"), planned_start_minute: 540, planned_end_minute: 720,
  }).select("id").single();

  // A completed consultation for the adult, with a diagnosis, two medications and an investigation.
  const enc1 = await launchEncounter(admin, {
    workspaceId: wsA, patientId: adult.data.id, pathway: "booked",
    reasonForVisit: "Headache for three weeks", ...base,
  });
  if (!enc1.ok) { ok("the adult's encounter launches", false, enc1.message); return report(); }
  await admin.from("practice_encounter")
    .update({ location_id: location!.id, activity_id: activity!.id }).eq("id", enc1.data.id);
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: enc1.data.id, to: "ACTIVE", ...base });
  const diag = await recordDiagnosis(admin, {
    workspaceId: wsA, encounterId: enc1.data.id, label: "Migraine without aura",
    certainty: "confirmed", isPrimary: true, problemLabel: "Migraine", ...base,
  });
  const med = await recordTreatment(admin, {
    workspaceId: wsA, encounterId: enc1.data.id, treatmentType: "medication",
    label: "Propranolol", dose: "40mg", route: "oral", frequency: "twice daily", ...base,
  });
  // A SECOND MEDICATION, CANCELLED. This is the control for "no active subset is computed": an engine
  // that filtered to planned/in_progress to build a "current" list would silently drop this row.
  const med2 = await recordTreatment(admin, {
    workspaceId: wsA, encounterId: enc1.data.id, treatmentType: "medication",
    label: "Amitriptyline", dose: "10mg", route: "oral", frequency: "at night",
    duration: "until review", ...base,
  });
  if (med2.ok) await admin.from("practice_treatment").update({ status: "cancelled" }).eq("id", med2.data.id);
  const inv = await recordTreatment(admin, {
    workspaceId: wsA, encounterId: enc1.data.id, treatmentType: "investigation",
    label: "MRI Brain", notes: "Rule out secondary cause", ...base,
  });
  ok("a diagnosis, two medications and an investigation are recorded",
    diag.ok && med.ok && med2.ok && inv.ok,
    [diag, med, med2, inv].map(r => (r.ok ? "ok" : r.message)).join(" | "));
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: enc1.data.id, to: "COMPLETED", ...base });

  // A live consultation for the child -- one ACTIVE at a time, so this comes after the first completes.
  const enc2 = await launchEncounter(admin, {
    workspaceId: wsA, patientId: child.data.id, pathway: "new_walk_in", reasonForVisit: "Fever", ...base,
  });
  if (enc2.ok) await transitionEncounter(admin, { workspaceId: wsA, encounterId: enc2.data.id, to: "ACTIVE", ...base });
  ok("a second consultation is open for the child", enc2.ok, enc2.ok ? "" : enc2.message);

  // Follow-ups: one overdue, one in the future. The future one is what makes "due" non-vacuous.
  const { timezone, today } = await (async () => {
    const { data } = await admin.from("practice_workspace").select("timezone").eq("id", wsA).maybeSingle();
    const tz = data?.timezone || "UTC";
    return { timezone: tz, today: practiceToday(tz) };
  })();
  const overdueFu = await createFollowUp(admin, {
    workspaceId: wsA, patientId: adult.data.id, reason: "Review headache after MRI",
    dueOn: new Date(Date.parse(`${today}T00:00:00Z`) - 5 * 86400000).toISOString().slice(0, 10), ...base,
  });
  const futureFu = await createFollowUp(admin, {
    workspaceId: wsA, patientId: fresh.data.id, reason: "Annual review",
    dueOn: new Date(Date.parse(`${today}T00:00:00Z`) + 60 * 86400000).toISOString().slice(0, 10), ...base,
  });
  // ⚠ A SECOND OVERDUE OBLIGATION FOR THE SAME PATIENT, AND IT IS THE WHOLE POINT OF 43a.
  //
  // Without it every worklist row is a distinct person, so a ROW count and a PATIENT count agree by
  // accident -- and the deliberate break that put `count` back to the row count SAT GREEN. An assertion
  // whose right and wrong answers coincide in the fixture proves nothing, which is the third time that
  // trap has been sprung in this codebase (CPR-300's equal tile counts, CPR-350's escape-hatch control).
  // One patient owing two things is also the ordinary case, not a contrived one.
  const secondOverdueFu = await createFollowUp(admin, {
    workspaceId: wsA, patientId: adult.data.id, reason: "Repeat bloods before the next visit",
    dueOn: new Date(Date.parse(`${today}T00:00:00Z`) - 3 * 86400000).toISOString().slice(0, 10), ...base,
  });
  ok("one overdue and one future follow-up exist", overdueFu.ok && futureFu.ok,
    [overdueFu, futureFu].map(r => (r.ok ? "ok" : r.message)).join(" | "));
  ok("and one patient owes TWO of them, so rows and people cannot agree by accident",
    secondOverdueFu.ok, secondOverdueFu.ok ? "" : secondOverdueFu.message);

  // Incoming: one unreviewed, one already reviewed. The reviewed one makes "pending" non-vacuous.
  const arrived = await recordIncoming(admin, {
    workspaceId: wsA, patientId: adult.data.id, docType: "imaging_report",
    source: "Mulago Radiology", title: "MRI Brain report", priority: "urgent", ...base,
  });
  const alreadySeen = await recordIncoming(admin, {
    workspaceId: wsA, patientId: adult.data.id, docType: "lab_result",
    source: "Kampala Lab", title: "Full blood count", ...base,
  });
  if (alreadySeen.ok) await reviewIncoming(admin, { workspaceId: wsA, incomingId: alreadySeen.data.id, note: "normal", ...base });
  ok("one result is unreviewed and one has been reviewed", arrived.ok && alreadySeen.ok,
    [arrived, alreadySeen].map(r => (r.ok ? "ok" : r.message)).join(" | "));

  // The queue: one walk-in with no booking, one waiting patient attached to a booking.
  const { data: bookedAppt } = await admin.from("practice_appointment").insert({
    workspace_id: wsA, patient_id: registeredYesterday.data.id, patient_name: "Kizza Grace",
    scheduled_at: new Date().toISOString(), appointment_type: "new_consultation", status: "ARRIVED",
  }).select("id").single();
  await admin.from("practice_queue_entry").insert([
    { workspace_id: wsA, patient_id: waitingPatient.data.id, patient_name: "Ssebunya Frank", status: "WAITING" },
    { workspace_id: wsA, patient_id: registeredYesterday.data.id, patient_name: "Kizza Grace", status: "READY", appointment_id: bookedAppt!.id },
  ]);

  // THE CLOCK FIXTURE. One registration timestamped an hour INTO the practice's day, and one an hour
  // BEFORE it started. In Kampala the day begins at 21:00 UTC the previous evening, so the first is
  // "yesterday" to any implementation that uses the UTC date -- which is the wrong answer this pair
  // exists to catch.
  const { startIso } = zonedDayRange(today, timezone);
  const insideKampalaDay = new Date(Date.parse(startIso) + 3600000).toISOString();
  const beforeKampalaDay = new Date(Date.parse(startIso) - 3600000).toISOString();
  await admin.from("practice_patient").update({ created_at: insideKampalaDay }).eq("id", registeredEarly.data.id);
  await admin.from("practice_patient").update({ created_at: beforeKampalaDay }).eq("id", registeredYesterday.data.id);

  // ══ 1. UNIVERSAL SEARCH ════════════════════════════════════════════════════
  console.log("\n-- Universal search --");

  const { data: pidRow } = await admin.from("practice_patient_identifier")
    .select("value").eq("patient_id", adult.data.id).eq("identifier_type", "practice_id").maybeSingle();
  const practiceId = pidRow!.value as string;

  const byPracticeId = await universalSearch(admin, a, practiceId, { correlationId: CID });
  ok("1. FOUND BY PRACTICE ID",
    byPracticeId.results.length === 1 && byPracticeId.results[0].patientId === adult.data.id &&
    byPracticeId.results[0].matchedBy === "identifier:practice_id",
    JSON.stringify(byPracticeId.results.map(r => r.matchedBy)));
  ok("1b. and the hit carries its hospital numbers, not just a name",
    byPracticeId.results[0]?.hospitalNumbers.length === 2 &&
    byPracticeId.results[0].hospitalNumbers.every(h => h.facilityName === "Mulago National Referral"),
    JSON.stringify(byPracticeId.results[0]?.hospitalNumbers.map(h => `${h.type}:${h.value}@${h.facilityName}`)));

  const byHospital = await universalSearch(admin, a, "mul-778899", { correlationId: CID });
  ok("1c. FOUND BY HOSPITAL NUMBER (case-insensitive)",
    byHospital.results.some(r => r.patientId === adult.data.id && r.matchedBy === "identifier:hospital_number"),
    JSON.stringify(byHospital.results.map(r => r.matchedBy)));

  const byNational = await universalSearch(admin, a, "CM90210", { correlationId: CID });
  const byPassport = await universalSearch(admin, a, "UG556677", { correlationId: CID });
  ok("1d. FOUND BY NATIONAL ID AND BY PASSPORT",
    byNational.results.some(r => r.patientId === adult.data.id) &&
    byPassport.results.some(r => r.patientId === adult.data.id),
    JSON.stringify([byNational.results.length, byPassport.results.length]));

  const byPhone = await universalSearch(admin, a, "0700111004", { correlationId: CID });
  ok("1e. FOUND BY PHONE typed without the spaces the record holds",
    byPhone.results.some(r => r.patientId === adult.data.id && r.matchedBy === "phone"),
    JSON.stringify(byPhone.results.map(r => r.matchedBy)));

  const byEmail = await universalSearch(admin, a, "daniel.okello@example.test", { correlationId: CID });
  ok("1f. FOUND BY EMAIL",
    byEmail.results.some(r => r.patientId === adult.data.id && r.matchedBy === "email"),
    JSON.stringify(byEmail.results.map(r => r.matchedBy)));

  // THE ONE THE SPEC ADDS. Typed with no spaces; stored with them. A child of six has no phone of
  // their own, and this is the number the practice actually has for them.
  const byGuardian = await universalSearch(admin, a, "0772400010", { correlationId: CID });
  const guardianIds = byGuardian.results.map(r => r.patientId);
  ok("2. FOUND BY PARENT/GUARDIAN PHONE -- both of that mother's children",
    guardianIds.includes(child.data.id) && guardianIds.includes(sibling.data.id),
    JSON.stringify(byGuardian.results.map(r => `${r.matchedBy}/${r.matchedVia}`)));
  // ⚠ THE LENGTH CHECK IS LOAD-BEARING. `.every()` over an empty array is true, so without it this
  // assertion passes when the guardian route returns nothing at all -- which is precisely the failure
  // it exists to catch. A deliberate break proved it, and it is the trap this harness is written against.
  ok("2b. and the hit says WHOSE number it was, so the desk is not told it is the patient's",
    byGuardian.results.length === 2 && byGuardian.results.every(r => r.matchedVia === "guardian" &&
      r.matchedGuardian?.name === "Nakato Sarah" && r.matchedGuardian.relationshipLabel === "Mother"),
    JSON.stringify(byGuardian.results.map(r => r.matchedGuardian)));
  ok("2c. NON-VACUOUS: that number belongs to no patient's own contact record",
    !guardianIds.includes(adult.data.id) && byGuardian.results.length === 2,
    JSON.stringify(byGuardian.results.length));
  const unrelatedNumber = await universalSearch(admin, a, "0755123456", { correlationId: CID });
  ok("2d. CONTROL: an unrelated number finds nobody, so the route is a match rather than a catch-all",
    unrelatedNumber.ran === true && unrelatedNumber.results.length === 0 && unrelatedNumber.complete === true);

  // RANKING, on two DIFFERENT patients so the wrong order would be visible. "Nakato" is a partial name
  // match for three children; the adult's national ID is an exact identifier hit. Searching the
  // identifier must not surface a name-partial above it.
  const mixed = await universalSearch(admin, a, "Nakato", { correlationId: CID });
  ok("3. AN EXACT NAME OUTRANKS A PARTIAL, with both present on DIFFERENT patients",
    mixed.results.length === 4 &&
    mixed.results[0].patientId === mononym.data.id && mixed.results[0].matchedBy === "name" &&
    mixed.results.slice(1).every(r => r.matchedBy === "name_partial") &&
    mixed.results[0].rank > mixed.results[1].rank,
    JSON.stringify(mixed.results.map(r => `${r.displayName}:${r.matchedBy}:${r.rank}`)));
  ok("3b. and the partial still reaches all three Nakato children -- a mononym does not shadow them",
    ["Nakato Aisha", "Nakato Brian", "Nakato Clara"].every(n => mixed.results.some(r => r.displayName === n)),
    JSON.stringify(mixed.results.map(r => r.displayName)));
  ok("3c. AND AN IDENTIFIER HIT OUTRANKS EVERY NAME MATCH",
    byPracticeId.results[0].rank > mixed.results[0].rank,
    JSON.stringify([byPracticeId.results[0].rank, mixed.results[0].rank]));

  const emptySearch = await universalSearch(admin, a, "   ", { correlationId: CID });
  ok("4. AN EMPTY BOX HAS NOT SEARCHED -- ran:false, not 'no results'",
    emptySearch.ran === false && emptySearch.results.length === 0 && emptySearch.unavailable === false,
    JSON.stringify({ ran: emptySearch.ran, unavailable: emptySearch.unavailable }));

  ok("4b. and a real search reports what it searched BY, in the spec's own list",
    byPracticeId.searchedBy.includes("Parent/guardian phone") && byPracticeId.searchedBy.includes("Practice ID") &&
    byPracticeId.complete === true,
    JSON.stringify(byPracticeId.searchedBy));

  // A FAILED READ IS NEVER "NOT FOUND".
  const brokenIdentifiers = failingOn(["practice_patient_identifier"]);
  const brokenSearch = await universalSearch(brokenIdentifiers, a, "CM90210", { correlationId: CID });
  ok("5. A FAILED IDENTIFIER READ IS NOT 'no such patient'",
    brokenSearch.complete === false && brokenSearch.unavailable === true &&
    brokenSearch.probes.identifiers.unavailable === true &&
    String(brokenSearch.probes.identifiers.error).includes(BROKEN),
    JSON.stringify(brokenSearch.probes.identifiers));
  ok("5b. CONTROL: the other probes still ran, so the failure is scoped and not a blanket refusal",
    brokenSearch.probes.nameExact.unavailable === false && brokenSearch.probes.guardianPhone.unavailable === false,
    JSON.stringify(Object.entries(brokenSearch.probes).map(([k, v]) => `${k}:${v.unavailable}`)));
  const stillWorks = await universalSearch(admin, a, "CM90210", { correlationId: CID });
  ok("5c. CONTROL: with the table healthy the same query finds the patient",
    stillWorks.complete === true && stillWorks.results.length === 1);

  // ══ 2. WORKLISTS ═══════════════════════════════════════════════════════════
  console.log("\n-- Operational worklists --");

  const lists = await worklists(admin, a);
  ok("6. THE SIX WORKLISTS CPR-V5-006 NAMES, in a fixed order stated as data",
    JSON.stringify(lists.worklists.map(w => w.key)) === JSON.stringify([...WORKLIST_KEYS]),
    JSON.stringify(lists.worklists.map(w => w.key)));

  const w = (k: string) => lists.worklists.find(x => x.key === k)!;
  // ⚠ THE CONTRACT CHANGED HERE, AND THIS ASSERTION IS THE ONE THAT NOTICED. It read
  // `count === rows.length`, which was true only while `count` was the ROW count -- and that was the
  // bug: clicking a tile filters to deduplicated patients, so a tile saying 2 opened a list of 1.
  // `count` is now the people and `rowCount` the rows, so the figure on the card is the length of the
  // list the card opens.
  ok("7. EVERY FIGURE IS THE LENGTH OF A LIST YOU CAN OPEN",
    lists.worklists.every(x => x.unavailable
      || (x.count === x.patientIds.length && x.rowCount === x.rows.length)),
    JSON.stringify(lists.worklists.map(x => `${x.key}: count ${x.count} vs ids ${x.patientIds.length}, rowCount ${x.rowCount} vs rows ${x.rows.length}`)));

  ok("7b. WAITING holds the two people in the room, by name",
    w("waiting").count === 2 &&
    w("waiting").rows.map(r => r.patientName).sort().join("|") === "Kizza Grace|Ssebunya Frank",
    JSON.stringify(w("waiting").rows.map(r => r.patientName)));

  ok("8. DUE FOLLOW-UPS HOLDS THE OVERDUE ONE",
    w("dueFollowUps").count === 1 && w("dueFollowUps").rows[0].patientId === adult.data.id &&
    /overdue/.test(w("dueFollowUps").rows[0].note),
    JSON.stringify(w("dueFollowUps").rows.map(r => r.note)));
  ok("8b. NON-VACUOUS: the follow-up due in sixty days is NOT on it, though it exists",
    !w("dueFollowUps").rows.some(r => r.patientId === fresh.data.id),
    JSON.stringify(w("dueFollowUps").rows.map(r => r.patientId)));

  ok("9. PENDING RESULTS IS WHAT ARRIVED AND WAS NOT REVIEWED",
    w("pendingResults").count === 1 && /MRI Brain report/.test(w("pendingResults").rows[0].note),
    JSON.stringify(w("pendingResults").rows.map(r => r.note)));
  ok("9b. NON-VACUOUS: the result that HAS been reviewed is not on it",
    !w("pendingResults").rows.some(r => /Full blood count/.test(r.note)),
    JSON.stringify(w("pendingResults").rows.map(r => r.note)));
  // THE TRAP THIS PRODUCT MUST NOT FALL INTO. A planned investigation exists on the record and is a
  // real row; it is NOT a pending result, because nobody sent it anywhere and nothing is awaited.
  ok("9c. AND THE PLANNED 'MRI Brain' INVESTIGATION IS NOT COUNTED AS A PENDING RESULT",
    !w("pendingResults").rows.some(r => r.id === (inv.ok ? inv.data.id : "")) &&
    w("pendingResults").rows.every(r => !/Rule out secondary cause/.test(r.note)),
    JSON.stringify(w("pendingResults").rows.map(r => r.note)));
  ok("9d. and the boundary travels with the payload rather than living in a document",
    /knows what came back, not what was requested/i.test(lists.pendingResultsBoundary));

  ok("10. WALK-INS ARE THE PEOPLE WITH NO BOOKING BEHIND THEM",
    w("walkIns").count === 1 && w("walkIns").rows[0].patientId === waitingPatient.data.id,
    JSON.stringify(w("walkIns").rows.map(r => `${r.patientName}:${r.note}`)));
  ok("10b. NON-VACUOUS: the queued patient who DOES have an appointment is not a walk-in",
    !w("walkIns").rows.some(r => r.patientId === registeredYesterday.data.id));

  ok("11. RECENT PATIENTS IS THE ENCOUNTER ORDER, newest first",
    w("recentPatients").count === 2 && w("recentPatients").rows[0].patientId === child.data.id,
    JSON.stringify(w("recentPatients").rows.map(r => r.patientName)));

  // THE CLOCK. In Kampala the day starts at 21:00 UTC the previous evening.
  const newReg = w("newRegistrations").rows.map(r => r.patientId);
  ok("12. 'TODAY' IS THE PRACTICE'S TODAY -- a registration an hour into the Kampala day is counted",
    newReg.includes(registeredEarly.data.id),
    JSON.stringify({ today: lists.today, timezone: lists.timezone, ids: newReg.length }));
  ok("12b. NON-VACUOUS: one an hour BEFORE the Kampala day started is not",
    !newReg.includes(registeredYesterday.data.id),
    JSON.stringify(newReg.length));
  ok("12c. and the day is the workspace's, not the server's",
    lists.timezone === "Africa/Kampala" && lists.today === practiceToday("Africa/Kampala"),
    `${lists.timezone} ${lists.today}`);

  // A FAILED READ IS NEVER A ZERO -- with a control beside it.
  const brokenFollowUps = failingOn(["practice_follow_up"]);
  const brokenLists = await worklists(brokenFollowUps, a);
  const bw = (k: string) => brokenLists.worklists.find(x => x.key === k)!;
  ok("13. A FAILED FOLLOW-UP READ GIVES null, NOT 0 -- and carries the database's own words",
    bw("dueFollowUps").count === null && bw("dueFollowUps").unavailable === true &&
    bw("dueFollowUps").reason === "read_failed" && String(bw("dueFollowUps").error).includes(BROKEN),
    JSON.stringify({ count: bw("dueFollowUps").count, error: bw("dueFollowUps").error }));
  ok("13b. and it is named in blindSpots, so the screen says so instead of showing nothing",
    brokenLists.blindSpots.some(s => s.key === "dueFollowUps" && s.reason === "read_failed"),
    JSON.stringify(brokenLists.blindSpots.map(s => s.key)));
  ok("13c. CONTROL: every other worklist still returns its real count",
    bw("waiting").count === 2 && bw("pendingResults").count === 1 && bw("recentPatients").count === 2,
    JSON.stringify(brokenLists.worklists.map(x => `${x.key}:${x.count}`)));

  // CAPABILITY, which is a different unavailability from a broken read -- and it must not read as zero
  // either, because there IS an overdue follow-up sitting behind it.
  const noFollowUp = await withoutCapabilities(wsA, OWNER, ["followup.view"]);
  const gatedLists = await worklists(admin, noFollowUp);
  const gw = (k: string) => gatedLists.worklists.find(x => x.key === k)!;
  ok("14. WITHOUT followup.view THE DUE LIST IS ABSENT, NOT EMPTY",
    gw("dueFollowUps").count === null && gw("dueFollowUps").reason === "capability" &&
    gw("dueFollowUps").error === null,
    JSON.stringify({ count: gw("dueFollowUps").count, reason: gw("dueFollowUps").reason }));
  ok("14b. CONTROL: the lists the caller may still see are counted, so it is not refusing everything",
    gw("waiting").count === 2 && gw("newRegistrations").unavailable === false,
    JSON.stringify(gatedLists.worklists.map(x => `${x.key}:${x.reason ?? "ok"}`)));
  await restoreCapabilities(wsA, OWNER, ["followup.view"]);

  // ══ 3. MY PATIENTS ═════════════════════════════════════════════════════════
  console.log("\n-- My Patients --");

  const cohort = await myPatients(admin, a, { pageSize: MAX_PAGE_SIZE });
  ok("15. THE COHORT CARRIES CPR-V5-006'S SEVEN COLUMNS",
    cohort.rows.length === 9 && cohort.rows.every(r =>
      "name" in r && "practiceId" in r && "hospitalNumbers" in r && "lastSeen" in r &&
      "nextFollowUp" in r && "currentStatus" in r && "location" in r),
    JSON.stringify(cohort.rows.length));

  const rowOf = (id: string) => cohort.rows.find(r => r.patientId === id)!;
  ok("15b. PRACTICE ID AND EVERY HOSPITAL NUMBER SIT TOGETHER, not hidden in demographics",
    rowOf(adult.data.id).practiceId === practiceId &&
    rowOf(adult.data.id).hospitalNumbers.map(h => h.value).sort().join("|") === "MUL-778899|OPD-4242",
    JSON.stringify(rowOf(adult.data.id).hospitalNumbers.map(h => h.value)));

  ok("15c. THE LOCATION COLUMN IS A PLACE -- room, kind of place and facility -- and NOT a care setting",
    rowOf(adult.data.id).location.locationName === "Kampala Consulting Rooms" &&
    rowOf(adult.data.id).location.locationType === "clinic" &&
    rowOf(adult.data.id).location.facilityName === "Mulago National Referral" &&
    rowOf(adult.data.id).location.careSettingStored === false &&
    rowOf(adult.data.id).location.source === "encounter",
    JSON.stringify(rowOf(adult.data.id).location));
  ok("15d. NON-VACUOUS: a patient with no encounter has no place and no invented one",
    rowOf(fresh.data.id).location.locationName === null &&
    rowOf(fresh.data.id).location.source === null,
    JSON.stringify(rowOf(fresh.data.id).location));

  ok("16. LAST SEEN IS DERIVED FROM THE ENCOUNTER, not stored on the patient",
    rowOf(adult.data.id).lastSeen !== null && rowOf(adult.data.id).lastSeenKnown === true,
    String(rowOf(adult.data.id).lastSeen));
  ok("16b. NON-VACUOUS: a patient with no encounter has null AND is known to have none",
    rowOf(fresh.data.id).lastSeen === null && rowOf(fresh.data.id).lastSeenKnown === true,
    JSON.stringify({ lastSeen: rowOf(fresh.data.id).lastSeen, known: rowOf(fresh.data.id).lastSeenKnown }));

  ok("17. CURRENT STATUS IS DERIVED, and three patients give three different answers",
    rowOf(child.data.id).currentStatus.code === "in_consultation" &&
    rowOf(waitingPatient.data.id).currentStatus.code === "waiting" &&
    rowOf(fresh.data.id).currentStatus.code === "registered_not_seen" &&
    rowOf(adult.data.id).currentStatus.code === "seen",
    JSON.stringify(cohort.rows.map(r => `${r.name}:${r.currentStatus.code}`)));

  ok("18. NEXT FOLLOW-UP IS THE EARLIEST OPEN ONE, with overdue derived",
    rowOf(adult.data.id).nextFollowUp?.overdue === true &&
    rowOf(fresh.data.id).nextFollowUp?.overdue === false &&
    rowOf(child.data.id).nextFollowUp === null,
    JSON.stringify(cohort.rows.map(r => r.nextFollowUp?.overdue ?? null)));

  const page0 = await myPatients(admin, a, { pageSize: 3, page: 0 });
  const page1 = await myPatients(admin, a, { pageSize: 3, page: 1 });
  ok("19. PAGINATION IS EXPLICIT AND THE PAGE SIZE IS A FIELD, not page text",
    page0.rows.length === 3 && page0.pageSize === 3 && page0.hasMore === true &&
    page1.rows.length === 3 && page1.page === 1,
    JSON.stringify({ p0: page0.rows.length, hasMore: page0.hasMore, pageSize: page0.pageSize }));
  ok("19b. and page two holds different people from page one",
    page1.rows.every(r => !page0.rows.some(p => p.patientId === r.patientId)),
    JSON.stringify([page0.rows.map(r => r.name), page1.rows.map(r => r.name)]));
  ok("19c. THE TOTAL IS COUNTED SEPARATELY, never inferred from the page",
    page0.total === 9 && page0.total !== page0.rows.length, JSON.stringify(page0.total));
  ok("19d. an oversized page size is clamped rather than silently honoured",
    (await myPatients(admin, a, { pageSize: 10000 })).pageSize === MAX_PAGE_SIZE);
  ok("19e. and the default is stated once, in the constants",
    (await myPatients(admin, a, {})).pageSize === DEFAULT_PAGE_SIZE);

  ok("20. SORTING BY LAST SEEN IS DECLARED UNAVAILABLE rather than quietly wrong across pages",
    cohort.sortOptions.find(s => s.key === "lastSeen")?.available === false &&
    /only be true within one page/i.test(cohort.sortOptions.find(s => s.key === "lastSeen")!.note ?? ""),
    JSON.stringify(cohort.sortOptions));

  // THE BRIDGE FROM A FIGURE TO A LIST.
  const fromTile = await myPatients(admin, a, { patientIds: w("waiting").patientIds });
  ok("21. A WORKLIST'S PATIENT IDS OPEN A FILTERED COHORT -- the figure is clickable",
    fromTile.rows.length === 2 && fromTile.total === 2 &&
    fromTile.rows.every(r => w("waiting").patientIds.includes(r.patientId)),
    JSON.stringify(fromTile.rows.map(r => r.name)));

  // DE-IDENTIFICATION. patient.list without patient.view.
  const noView = await withoutCapabilities(wsA, OWNER, ["patient.view"]);
  const blind = await myPatients(admin, noView, { pageSize: MAX_PAGE_SIZE });
  ok("22. WITHOUT patient.view THE LIST IS THE SAME LENGTH -- withholding a name is not withholding the fact",
    blind.rows.length === cohort.rows.length && blind.total === cohort.total && blind.unavailable === false,
    JSON.stringify({ rows: blind.rows.length, total: blind.total }));
  ok("22b. AND NO NAME, PRACTICE ID OR HOSPITAL NUMBER COMES BACK",
    blind.rows.every(r => r.name === null && r.deIdentified === true && r.practiceId === null && r.hospitalNumbers.length === 0),
    JSON.stringify(blind.rows.slice(0, 2)));
  ok("22c. but the operational facts still do, which is the point of the split",
    blind.rows.some(r => r.currentStatus.code === "in_consultation") &&
    blind.rows.some(r => r.lastSeen !== null),
    JSON.stringify(blind.rows.map(r => r.currentStatus.code)));
  const blindLists = await worklists(admin, noView);
  ok("22d. and the worklists count people without naming them",
    blindLists.worklists.find(x => x.key === "waiting")!.count === 2 &&
    blindLists.worklists.find(x => x.key === "waiting")!.rows.every(r => r.patientName === null && r.deIdentified),
    JSON.stringify(blindLists.worklists.find(x => x.key === "waiting")!.rows));
  const blindSearch = await universalSearch(admin, noView, practiceId, { correlationId: CID });
  ok("22e. SEARCH IS REFUSED OUTRIGHT without patient.view -- '2 results hidden' is itself a disclosure",
    blindSearch.unavailable === true && blindSearch.reason === "capability" &&
    blindSearch.results.length === 0 && blindSearch.ran === false,
    JSON.stringify({ reason: blindSearch.reason, ran: blindSearch.ran }));
  const blindSummary = await patientSummary(admin, noView, adult.data.id);
  ok("22f. and so is the summary", !blindSummary.ok && (blindSummary as any).code === "FORBIDDEN");
  await restoreCapabilities(wsA, OWNER, ["patient.view"]);

  const noList = await withoutCapabilities(wsA, OWNER, ["patient.list"]);
  const refusedCohort = await myPatients(admin, noList, {});
  ok("23. WITHOUT patient.list THE COHORT IS ABSENT, and total is null rather than 0",
    refusedCohort.unavailable === true && refusedCohort.reason === "capability" && refusedCohort.total === null,
    JSON.stringify({ reason: refusedCohort.reason, total: refusedCohort.total }));
  const stillSummary = await patientSummary(admin, noList, adult.data.id);
  ok("23b. CONTROL: the individual patient is still readable on patient.view, so it is not a blanket lock",
    stillSummary.ok === true);
  await restoreCapabilities(wsA, OWNER, ["patient.list"]);

  const brokenCohortClient = failingOn(["practice_encounter"]);
  const brokenCohort = await myPatients(brokenCohortClient, a, { pageSize: MAX_PAGE_SIZE });
  ok("24. A FAILED ENCOUNTER READ DOES NOT TURN 'seen' INTO 'never seen'",
    brokenCohort.rows.every(r => r.lastSeenKnown === false) &&
    brokenCohort.enrichment.encounters.ok === false &&
    String(brokenCohort.enrichment.encounters.error).includes(BROKEN),
    JSON.stringify(brokenCohort.enrichment.encounters));
  ok("24b. CONTROL: the rest of the row is intact -- identifiers and follow-ups still resolve",
    brokenCohort.rows.length === 9 &&
    brokenCohort.rows.find(r => r.patientId === adult.data.id)!.practiceId === practiceId &&
    brokenCohort.rows.find(r => r.patientId === adult.data.id)!.nextFollowUp !== null,
    JSON.stringify(brokenCohort.enrichment));

  // ══ 4/5. SUMMARY AND CONTEXT BANNER ════════════════════════════════════════
  console.log("\n-- Patient summary and context banner --");

  const summaryResult = await patientSummary(admin, a, adult.data.id, { correlationId: CID });
  ok("25. THE SUMMARY LOADS", summaryResult.ok, summaryResult.ok ? "" : (summaryResult as any).message);
  if (!summaryResult.ok) return report();
  const s = summaryResult.data;

  ok("25b. IDENTIFIERS ARE SURFACED TOGETHER -- practice ID plus every hospital number",
    s.identifiers.practiceId === practiceId && s.identifiers.hospitalNumbers.length === 2 &&
    s.identifiers.otherIdentifiers.map(i => i.type).sort().join("|") === "national_id|passport",
    JSON.stringify({ p: s.identifiers.practiceId, h: s.identifiers.hospitalNumbers.length, o: s.identifiers.otherIdentifiers.length }));

  ok("26. MEDICATIONS ARE WHAT WAS DECIDED HERE, and the payload says it is NOT a current-medication list",
    s.medicationsDecided.count === 2 &&
    s.isCurrentMedicationList === false &&
    /duration is free text/i.test(s.medicationNotCurrentReason) &&
    /NOT a current-medication list/i.test(s.medicationBoundary),
    JSON.stringify({ count: s.medicationsDecided.count, reason: s.medicationNotCurrentReason }));
  // NON-VACUOUS, AND THIS IS THE ONE THAT MATTERS. A cancelled medication is in the fixture. An
  // implementation that filtered to planned/in_progress -- the obvious way to build a "current" list --
  // would drop it, and would be presenting a guess about what is still running.
  ok("26b. NO 'ACTIVE' SUBSET IS COMPUTED -- the cancelled course is returned too, with its status",
    s.medicationsDecided.rows.some((r: any) => r.label === "Amitriptyline" && r.status === "cancelled") &&
    s.medicationsDecided.rows.some((r: any) => r.label === "Propranolol" && r.status === "planned"),
    JSON.stringify(s.medicationsDecided.rows.map((r: any) => `${r.label}:${r.status}`)));
  ok("26c. and each carries the encounter and the date it was decided in",
    s.medicationsDecided.rows.every((r: any) => r.encounter_id === enc1.data.id && r.created_at),
    JSON.stringify(s.medicationsDecided.rows.map((r: any) => r.encounter_id)));
  ok("26d. NON-VACUOUS: the planned MRI is an INVESTIGATION and never appears among the medications",
    s.recordedInvestigations.count === 1 &&
    (s.recordedInvestigations.rows[0] as any).label === "MRI Brain" &&
    !s.medicationsDecided.rows.some((r: any) => r.label === "MRI Brain") &&
    !s.recordedInvestigations.rows.some((r: any) => r.label === "Propranolol"),
    JSON.stringify([s.recordedInvestigations.rows, s.medicationsDecided.rows].map(r => (r as any[]).map(x => x.label))));

  ok("27. PENDING RESULTS ON THE SUMMARY ARE THE UNREVIEWED ARRIVALS ONLY",
    s.pendingResults.count === 1 && (s.pendingResults.rows[0] as any).title === "MRI Brain report",
    JSON.stringify(s.pendingResults.rows.map((r: any) => r.title)));

  ok("28. DIAGNOSES, PROBLEMS, ENCOUNTERS, FOLLOW-UPS AND DOCUMENTS EACH CARRY THEIR OWN AVAILABILITY",
    [s.diagnoses, s.problems, s.recentEncounters, s.activeFollowUps, s.documents, s.contacts, s.relationships]
      .every(p => "unavailable" in p && "reason" in p && "error" in p && "limit" in p),
    "");
  ok("28b. and the real ones are populated",
    // activeFollowUps is >= 1: the fixture deliberately gives this patient TWO overdue obligations so
    // that 43a can tell a row count from a people count. Pinning it to 1 would make this assertion a
    // record of the fixture rather than of the engine.
    s.diagnoses.count === 1 && s.problems.count === 1 && s.recentEncounters.count === 1 &&
    (s.activeFollowUps.count ?? 0) >= 1,
    JSON.stringify([s.diagnoses.count, s.problems.count, s.recentEncounters.count, s.activeFollowUps.count]));

  const banner = s.banner;
  ok("29. THE CONTEXT BANNER CARRIES WHAT STAYS ON SCREEN across patient views",
    banner.name === "Okello Daniel" && banner.practiceId === practiceId &&
    banner.hospitalNumbers.length === 2 && banner.sex === "male" &&
    banner.age?.years === 41 && banner.ageBasis === "birth_date" &&
    banner.lastSeen !== null && banner.activeFollowUp?.overdue === true &&
    banner.recentDiagnoses.length === 1,
    JSON.stringify({ age: banner.age?.years, hosp: banner.hospitalNumbers.length, diag: banner.recentDiagnoses.length }));
  ok("29b. AGE IS DERIVED FROM birth_date AT READ TIME, and an estimate says it is one",
    (await patientContextBanner(admin, a, fresh.data.id)).ok &&
    ((await patientContextBanner(admin, a, fresh.data.id)) as any).data.ageBasis === "estimate" &&
    ((await patientContextBanner(admin, a, fresh.data.id)) as any).data.age === null,
    "");
  ok("29c. EVERY OUTSTANDING FIGURE IS THE LENGTH OF A BLOCK IN THE SAME PAYLOAD",
    banner.outstanding.find(o => o.key === "followUps")!.count === s.activeFollowUps.rows.length &&
    banner.outstanding.find(o => o.key === "pendingResults")!.count === s.pendingResults.rows.length &&
    banner.outstanding.find(o => o.key === "medicationsDecided")!.count === s.medicationsDecided.rows.length,
    JSON.stringify(banner.outstanding.map(o => `${o.key}:${o.count}`)));
  ok("29d. THE BANNER REPORTS A PLACE AND REFUSES TO CALL IT A CARE SETTING",
    banner.place.careSettingStored === false &&
    /not a care setting/i.test(banner.place.basis) &&
    banner.place.encounterMode === "in_person",
    JSON.stringify({ stored: banner.place.careSettingStored, basis: banner.place.basis }));
  ok("29e. and the place it does report is the real location and facility, resolved through the activity",
    banner.place.locationName === "Kampala Consulting Rooms" && banner.place.locationType === "clinic" &&
    banner.place.facilityName === "Mulago National Referral" &&
    banner.place.activityType === "outpatient_clinic",
    JSON.stringify(banner.place));
  const liveBanner = await patientContextBanner(admin, a, child.data.id);
  ok("29f. and a patient in an open consultation reads as such",
    liveBanner.ok && /open encounter/i.test((liveBanner as any).data.place.label),
    liveBanner.ok ? (liveBanner as any).data.place.label : "");
  ok("29g. a patient never seen here has no place, and knows that it is 'never' rather than 'unknown'",
    ((await patientContextBanner(admin, a, fresh.data.id)) as any).data.place.known === true &&
    ((await patientContextBanner(admin, a, fresh.data.id)) as any).data.place.locationName === null,
    "");

  const brokenMeds = failingOn(["practice_treatment"]);
  const brokenSummary = await patientSummary(brokenMeds, a, adult.data.id);
  ok("30. A FAILED MEDICATION READ IS NOT A PATIENT ON NO MEDICATION",
    brokenSummary.ok && brokenSummary.data.medicationsDecided.count === null &&
    brokenSummary.data.medicationsDecided.unavailable === true &&
    String(brokenSummary.data.medicationsDecided.error).includes(BROKEN) &&
    brokenSummary.data.banner.outstanding.find(o => o.key === "medicationsDecided")!.count === null,
    JSON.stringify(brokenSummary.ok ? brokenSummary.data.medicationsDecided : brokenSummary));
  ok("30b. CONTROL: the diagnoses and follow-ups on the same summary are still real",
    brokenSummary.ok && brokenSummary.data.diagnoses.count === 1 && (brokenSummary.data.activeFollowUps.count ?? 0) >= 1,
    "");
  const brokenRelationships = failingOn(["practice_patient_relationship"]);
  const noRelSummary = await patientSummary(brokenRelationships, a, child.data.id);
  ok("31. A FAILED RELATIONSHIP READ DOES NOT REPORT A CHILD AS HAVING NO GUARDIAN",
    noRelSummary.ok && noRelSummary.data.relationshipExpectation === null &&
    noRelSummary.data.relationships.unavailable === true,
    JSON.stringify(noRelSummary.ok ? noRelSummary.data.relationshipExpectation : null));
  const goodRelSummary = await patientSummary(admin, a, child.data.id);
  ok("31b. CONTROL: read successfully, the same child's guardian requirement IS satisfied and named",
    goodRelSummary.ok && goodRelSummary.data.relationshipExpectation?.satisfied === true &&
    /Nakato Sarah/.test(goodRelSummary.data.relationshipExpectation!.reason),
    goodRelSummary.ok ? goodRelSummary.data.relationshipExpectation?.reason : "");

  // ══ 6. FAMILY ══════════════════════════════════════════════════════════════
  console.log("\n-- Family relationships --");

  const famResult = await familyRelationships(admin, a, child.data.id);
  ok("32. THE FAMILY VIEW LOADS", famResult.ok, famResult.ok ? "" : (famResult as any).message);
  if (!famResult.ok) return report();
  const fam = famResult.data;

  ok("32b. PARENT-CHILD AND GUARDIAN-CHILD ARE REPORTED as recorded facts",
    fam.parents.length === 1 && fam.parents[0].fullName === "Nakato Sarah" &&
    fam.parents[0].isLegalGuardian === true && fam.guardians.length === 0,
    JSON.stringify({ parents: fam.parents.map(p => p.fullName), guardians: fam.guardians.length }));
  ok("32c. A RECORDED SIBLING IS A NAMED PERSON, and says so by never claiming a patient record",
    fam.namedSiblings.length === 1 && fam.namedSiblings[0].fullName === "Nakato Brian" &&
    fam.namedSiblings[0].patientRecordId === null,
    JSON.stringify(fam.namedSiblings));

  ok("33. SIBLINGS ARE INFERRED FROM A SHARED LIVE GUARDIAN, and the basis travels with the row",
    fam.inferredSiblings.length === 1 &&
    fam.inferredSiblings[0].patientId === sibling.data.id &&
    fam.inferredSiblings[0].name === "Nakato Brian" &&
    fam.inferredSiblings[0].basis === "shared_live_guardian_name_and_phone" &&
    fam.inferredSiblings[0].sharedGuardian.fullName === "Nakato Sarah",
    JSON.stringify(fam.inferredSiblings));
  ok("33b. NON-VACUOUS: the third child whose mother shares only the NAME is NOT inferred a sibling",
    !fam.inferredSiblings.some(x => x.patientId === namesake.data.id),
    JSON.stringify(fam.inferredSiblings.map(x => x.name)));
  ok("33c. and the inference never dresses itself as a recorded fact",
    /a match, not a recorded fact/i.test(fam.inference.note) && fam.inference.ok === true,
    fam.inference.note);

  // TENANCY, NON-VACUOUSLY: workspace B has a child with the SAME mother name and SAME number.
  const bChild = await registerPatient(admin, {
    workspaceId: wsB, displayName: "Nakato Zoe", sex: "female", birthDate: birthDateFor(5),
    phone: "0700 222 001", actorId: OTHER, correlationId: CID,
  });
  ok("workspace B registers a child of its own", bChild.ok, bChild.ok ? "" : (bChild as any).message);
  if (bChild.ok) {
    await addRelationship(admin, b, {
      patientId: bChild.data.id, relationshipType: "mother", fullName: "Nakato Sarah",
      phone: MOTHER_PHONE, isLegalGuardian: true, isPrimary: true, correlationId: CID,
    });
  }
  const famAgain = await familyRelationships(admin, a, child.data.id);
  ok("34. ANOTHER PRACTICE'S CHILD WITH THE SAME MOTHER IS NOT INFERRED INTO THIS FAMILY",
    famAgain.ok && famAgain.data.inferredSiblings.length === 1 &&
    !famAgain.data.inferredSiblings.some(x => bChild.ok && x.patientId === bChild.data.id),
    JSON.stringify(famAgain.ok ? famAgain.data.inferredSiblings.map(x => x.name) : null));
  ok("34b. CONTROL: workspace B's own family view finds its own guardian, so the isolation is not emptiness",
    bChild.ok && (await familyRelationships(admin, b, bChild.data.id)).ok &&
    ((await familyRelationships(admin, b, bChild.data.id)) as any).data.parents.length === 1,
    "");

  const brokenFamily = await familyRelationships(failingOn(["practice_patient_relationship"]), a, child.data.id);
  ok("35. A FAILED FAMILY READ IS 'unavailable', NOT 'no family recorded'",
    brokenFamily.ok && brokenFamily.data.unavailable === true &&
    brokenFamily.data.reason === "read_failed" && String(brokenFamily.data.error).includes(BROKEN),
    JSON.stringify(brokenFamily.ok ? brokenFamily.data.reason : null));

  // ══ 7. TENANCY ACROSS EVERY SURFACE ════════════════════════════════════════
  console.log("\n-- Tenancy --");

  const crossSummary = await patientSummary(admin, b, adult.data.id);
  ok("36. ANOTHER PRACTICE'S PATIENT IS A 404, the same answer an absent one gives",
    !crossSummary.ok && (crossSummary as any).status === 404 && (crossSummary as any).code === "NOT_FOUND");
  const absent = await patientSummary(admin, a, "00000000-0000-4000-8000-000000000000");
  ok("36b. CONTROL: an id that does not exist gives exactly the same answer, so nothing is confirmed",
    !absent.ok && (absent as any).status === 404 &&
    (absent as any).message === (crossSummary as any).message);
  const crossFamily = await familyRelationships(admin, b, child.data.id);
  ok("36c. and so does the family view", !crossFamily.ok && (crossFamily as any).status === 404);
  const crossSearch = await universalSearch(admin, b, practiceId, { correlationId: CID });
  ok("37. ANOTHER PRACTICE'S SEARCH DOES NOT REACH THIS ONE'S PATIENTS",
    crossSearch.ran === true && crossSearch.results.length === 0,
    JSON.stringify(crossSearch.results.length));
  ok("37b. CONTROL: and it finds its own, so the isolation is not a broken search",
    bChild.ok && (await universalSearch(admin, b, "Nakato Zoe", { correlationId: CID })).results.length === 1,
    "");
  const crossCohort = await myPatients(admin, b, { pageSize: MAX_PAGE_SIZE });
  ok("37c. nor its cohort", crossCohort.total === 1 && crossCohort.rows.every(r => r.patientId !== adult.data.id),
    JSON.stringify(crossCohort.total));
  const crossLists = await worklists(admin, b);
  ok("37d. nor its worklists",
    crossLists.worklists.every(x => x.patientIds.every(id => !everyone.some(p => p.ok && p.data.id === id))),
    JSON.stringify(crossLists.worklists.map(x => `${x.key}:${x.count}`)));

  // ══ 8. DOCTRINE ════════════════════════════════════════════════════════════
  console.log("\n-- Doctrine --");

  const whole = await patientsWorkspace(admin, a, { pageSize: 5 });
  const keys = [...new Set([...allKeys(whole), ...allKeys(s)])];
  ok("38. NO RATE, PERCENTAGE, TARGET, BASELINE OR SCORE APPEARS ANYWHERE IN THE PAYLOAD",
    rateShapedKeys(keys).length === 0, JSON.stringify(rateShapedKeys(keys)));
  ok("38b. NON-VACUOUS: the scan really did walk the payload",
    keys.includes("count") && keys.includes("hospitalNumbers") && keys.includes("currentStatus") &&
    keys.length > 60, String(keys.length));
  ok("38c. CONTROL: the detector is not a no-op -- it flags a rate and leaves 'duration' alone",
    JSON.stringify(rateShapedKeys(["completionRate", "utilisation_percent", "targetDays", "duration", "durationMinutes"]))
    === JSON.stringify(["rate", "percent", "target"]),
    JSON.stringify(rateShapedKeys(["completionRate", "utilisation_percent", "targetDays", "duration", "durationMinutes"])));

  ok("39. THE WORKSPACE ASSEMBLES ITS TWO HALVES in one call, with the capabilities it used",
    // Held against WORKLIST_KEYS rather than a literal. This read `=== 6` and went stale the moment
    // CPR-PAT-002 added three cards -- a number typed here is a record of what the engine did on the day
    // somebody wrote it, not of what it promises.
    whole.worklists.worklists.length === WORKLIST_KEYS.length && whole.cohort.rows.length === 5 &&
    whole.capabilities.mayList === true && whole.capabilities.mayView === true &&
    whole.today === lists.today,
    JSON.stringify(whole.capabilities));

  ok("40. WHAT IT WILL NOT CLAIM IS NAMED, not omitted",
    REFUSES.some(r => r.key === "orders_placed") &&
    REFUSES.some(r => r.key === "current_medications") &&
    REFUSES.some(r => r.key === "care_setting") &&
    REFUSES.some(r => r.key === "asserted_family_links") &&
    whole.refuses.length === REFUSES.length && s.refuses.length === REFUSES.length,
    JSON.stringify(REFUSES.map(r => r.key)));

  const { count: accessRows } = await admin.from("practice_access_log")
    .select("id", { count: "exact", head: true }).eq("workspace_id", wsA).eq("actor_id", OWNER);
  ok("41. READS ARE LOGGED -- opening a patient and running a search both leave a trail",
    (accessRows ?? 0) > 0, String(accessRows));

  // ── 43. THE FIGURE ON A TILE IS THE LENGTH OF THE LIST IT OPENS ─────────────────────────────────
  //
  // ⚠ IT WAS NOT. `count` was the ROW count while clicking the tile filters the register to
  // `patientIds`, which is deduplicated -- so one patient with two overdue obligations made the card say
  // 2 and the table show 1. The disagreement reads as a bug in the TABLE, which is the half a
  // practitioner would otherwise trust, and it is this module's own stated doctrine that every figure is
  // the length of a list you can open.
  //
  // BOTH ARE CARRIED NOW, because a row IS the unit of work for some of these: "results to review"
  // counts DOCUMENTS, and seven documents are seven things to read even if they belong to five people.
  // Two values as two fields; never one number standing for both.
  const wl = await worklists(admin, a);
  const mismatched = wl.worklists
    .filter(w => !w.unavailable)
    .filter(w => w.count !== w.patientIds.length);
  ok("43a. ⚠ every tile's count equals the number of patients its filter opens",
    mismatched.length === 0,
    mismatched.map(w => `${w.key}: count=${w.count} ids=${w.patientIds.length}`).join(" | "));

  ok("43b. and the row count is carried separately, with the noun it counts",
    wl.worklists.every(w => (w.rowCount === null || typeof w.rowCount === "number") && !!w.rowNoun),
    JSON.stringify(wl.worklists.map(w => ({ k: w.key, n: w.rowCount, noun: w.rowNoun }))));

  // ⚠ THE CONTROL THAT MAKES 43a MEAN ANYTHING, and its first version did not.
  //
  // "At least one worklist is non-empty" was not enough: with every row a distinct person, a row count
  // and a patient count agree, and the deliberate break putting `count` back to `p.count` SAT GREEN.
  // The control now requires the fixture to contain a worklist where they genuinely DIFFER -- one
  // patient owing two obligations -- so 43a is testing the distinction it was written for.
  const differing = wl.worklists.filter(w => !w.unavailable && (w.rowCount ?? 0) > w.patientIds.length);
  ok("43a-control. ⚠ some worklist really has more ROWS than PATIENTS, so 43a is not comparing equals",
    differing.length > 0,
    JSON.stringify(wl.worklists.map(w => `${w.key}: ${w.rowCount} rows / ${w.patientIds.length} people`)));

  // ⚠ AND "RECENTLY SEEN" NOW HAS A WINDOW. It read every encounter ever, ordered by date and capped by
  // the row limit -- so the figure was neither a period nor a total, and in any practice past the cap it
  // meant "the most recent 50", which the card labelled as a period. Asserted through the SOURCE,
  // because proving a 30-day boundary against live data needs a fixture older than 30 days that the
  // harness would have to fabricate by writing a past timestamp -- which tests the fixture, not the query.
  const engineSrc = readFileSync(join(process.cwd(), "src", "lib", "practice", "patient-workspace.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const recentBlock = engineSrc.slice(engineSrc.indexOf("recentPatients.capability"));
  ok("43c. the recent-patients read is bounded by RECENT_WINDOW_DAYS, not just ordered and capped",
    /RECENT_WINDOW_DAYS/.test(recentBlock.slice(0, 500)) && /gte\("started_at"/.test(recentBlock.slice(0, 500)),
    recentBlock.slice(0, 300));

  // ── 42. THE SWATCHES ARE KEYED ON THE ENGINE'S OWN VOCABULARY ───────────────────────────────────
  //
  // ⚠ THIRD TIME THIS CLASS. PERFORMANCE_SWATCH was keyed `avg_consult` against the page's
  // `average_consult_time`; GLANCE_SWATCH `walk_ins` against `walk_in`. Both compiled perfectly and both
  // rendered real figures in dead grey, with nothing anywhere saying a lookup had missed. Writing this
  // screen's status swatch I reached first for the COMP'S labels -- "Follow-up Due", "Active", "New
  // Patient" -- and not one of them is a status this engine emits.
  //
  // Asserted as an EQUALITY in both directions, not a subset: a swatch key with no status is a colour
  // nobody will ever see, and a status with no swatch is a chip that silently goes grey.
  const statusKeys = Object.keys(COHORT_STATUS_LABELS).sort();
  const swatchKeys = Object.keys(PATIENT_STATUS_SWATCH).sort();
  ok("42a. every cohort status has a colour, and every colour has a status",
    statusKeys.join() === swatchKeys.join(),
    `statuses: ${statusKeys.join()} | swatches: ${swatchKeys.join()}`);

  const worklistKeys = [...WORKLIST_KEYS].sort();
  const worklistSwatchKeys = Object.keys(WORKLIST_SWATCH).sort();
  ok("42b. and every worklist tile has one -- a missing key is a grey tile among five coloured ones",
    worklistKeys.join() === worklistSwatchKeys.join(),
    `worklists: ${worklistKeys.join()} | swatches: ${worklistSwatchKeys.join()}`);

  // The purpose of this control is that 42a and 42b are not comparing two empty lists. It said
  // `worklistKeys.length === 6`, which is not that purpose -- it is a second, weaker copy of the count
  // assertion above, and it broke when the count legitimately changed while proving nothing either way.
  ok("42-control. both vocabularies are non-empty, so the equalities are not comparing nothing",
    statusKeys.length >= 5 && worklistKeys.length >= 6,
    `${statusKeys.length} statuses, ${worklistKeys.length} worklists`);

  // ⚠ AND THE SCREEN MUST ACTUALLY USE THEM. Half-fixing this was the original mistake: the design
  // system existed from day one and the page drew six grey boxes anyway. Source-checked, because a
  // Tailwind class cannot be reached from here -- the same reason adaptive-4 and timeline-3 exist.
  const dir = (f: string) => join(process.cwd(), "src", "app", "practice", "(shell)", "patients", f);
  const tiles = readFileSync(dir("WorklistTiles.tsx"), "utf8");
  const table = readFileSync(dir("CohortTable.tsx"), "utf8");
  ok("42c. the worklist tiles and the cohort table read their colours FROM palette.ts",
    /WORKLIST_SWATCH/.test(tiles) && /from "@\/lib\/practice\/palette"/.test(tiles)
    && /PATIENT_STATUS_SWATCH/.test(table) && /from "@\/lib\/practice\/palette"/.test(table),
    `tiles=${/WORKLIST_SWATCH/.test(tiles)} table=${/PATIENT_STATUS_SWATCH/.test(table)}`);
  ok("42d. and neither keeps a private colour map of its own",
    !/const [A-Z_]*TINT[A-Z_]*: Record/.test(tiles) && !/const [A-Z_]*TINT[A-Z_]*: Record/.test(table),
    "a local colour map is how two screens start disagreeing about what amber means");

  await cleanup();
  return report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
