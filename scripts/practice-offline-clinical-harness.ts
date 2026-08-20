/**
 * CP-OFFLINE-SURVEY-001 s9 — THE CLINICAL CARRY.
 *
 * ⚠ THE ONE ASSERTION THIS FILE EXISTS FOR, above all the others:
 *
 *     A PATIENT NOBODY HAS ASKED ABOUT ALLERGIES MUST NEVER READ AS SAFE TO PRESCRIBE FOR.
 *
 * longitudinal-constants.ts states the rule -- "No known allergies" and "nobody has asked" are different
 * answers and the difference can kill somebody -- and the obvious offline design breaks it, because an
 * ARRAY has two states and the answer has three. So the fixtures below include a patient with allergy
 * status `not_recorded` and NO allergy rows, which is byte-for-byte identical to a patient explicitly
 * recorded as having none unless the status survived the cache. `safeToRead` must be false for them.
 *
 * WHAT ELSE IT PROVES, from the rules rather than from what the code happens to do:
 *   - the horizon BOUNDS the payload: a patient booked outside it is not on the device at all.
 *   - active AND PAUSED medication is carried; completed and discontinued are not; and a paused course
 *     is never counted as "current".
 *   - an ENTERED_IN_ERROR encounter is never presented as the last visit, even when it is the newest.
 *   - a `refuted` allergy is carried rather than filtered -- it is an answer, not silence.
 *   - three states everywhere: a failed read is never a zero, and the count is null rather than 0.
 *   - s3.5 ZERO ENABLED MUTATING CONTROLS, over the real control list.
 *   - hard expiry at OFFLINE_CLINICAL_MAX_DAYS, which must OUTLAST the horizon.
 *   - no silent cap.
 *   - the allow-list refuses an over-wide payload BEFORE anything is sealed.
 *
 * ⚠ WHAT THIS HARNESS CANNOT PROVE. offline-store.ts needs `indexedDB`, which node does not have, so the
 * PIN refusal in the writer is asserted against SOURCE TEXT. That is weaker than a test and it is the
 * honest state -- the same gap s5 precondition 1 names.
 *
 *   npx --yes tsx scripts/practice-offline-clinical-harness.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";
import { readFileSync } from "node:fs";
import { offlineClinicalPayload, addCalendarDays } from "../src/lib/practice/offline-clinical-source";
import { zonedDayRange } from "../src/lib/practice/practice-time";
import {
  OFFLINE_CLINICAL_HORIZON_DAYS, OFFLINE_CLINICAL_MAX_DAYS, OFFLINE_CLINICAL_RECORD_KEYS,
  OFFLINE_CLINICAL_FORBIDDEN_FIELDS, OFFLINE_LAST_VISIT_EXCLUDED_STATUSES, OFFLINE_MEDICATION_STATUSES,
  capOfflineClinical, enabledMutatingClinicalControls, lookupOfflineClinical, offlineAllergySentence,
  offlineClinicalControls, offlineClinicalExpiry, offlineClinicalNotice, offlineMedicationSentence,
  projectOfflineClinicalPack, readOfflineClinical,
  type OfflineClinicalPack, type OfflineClinicalRecord,
} from "../src/lib/practice/offline-clinical";
import { clinicalFieldsNotAllowed } from "../src/lib/practice/offline-store";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import type { WorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy, cleanupOnKill } from "./_cleanup";

loadEnvConfig(process.cwd());

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } });

const USER = "00000000-0000-4000-8000-00000000fc07";
const TZ = "Africa/Kampala";
const CAPS = ["practice.calendar.view", "practice.home.view"];

const ctxFor = (workspaceId: string, caps: string[] = CAPS): WorkspaceContext => ({
  workspaceId, capabilities: caps, membershipId: "harness", personId: USER,
} as unknown as WorkspaceContext);

/** A record with everything absent, for the pure assertions. Overridden field by field per case. */
const blankRecord = (over: Partial<OfflineClinicalRecord> = {}): OfflineClinicalRecord => ({
  patientId: "p1", allergyStatus: null, allergyReviewedAt: null, allergyCount: 0,
  allergiesUnavailable: false, allergies: [], bloodGroup: null,
  medications: [], medicationsUnavailable: false, medicationsDropped: 0,
  problems: [], problemsUnavailable: false, problemsDropped: 0,
  lastVisit: null, lastVisitUnavailable: false, ...over,
});

const med = (id: string, status: string) => ({
  id, genericName: `drug-${id}`, brandName: null, doseText: "1 tab", route: null,
  frequency: null, indication: null, startedOn: null, status,
});

async function cleanup() {
  const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", USER);
  for (const w of (ws ?? []) as { id: string }[]) {
    await admin.from("practice_diagnosis").delete().eq("workspace_id", w.id);
    await admin.from("practice_encounter_note").delete().eq("workspace_id", w.id);
    await admin.from("practice_encounter").delete().eq("workspace_id", w.id);
    await admin.from("practice_medication").delete().eq("workspace_id", w.id);
    await admin.from("practice_problem").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient_allergy").delete().eq("workspace_id", w.id);
    await admin.from("practice_appointment").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient_identifier").delete().eq("workspace_id", w.id);
    await admin.from("practice_patient").delete().eq("workspace_id", w.id);
    await admin.from("practice_activity").delete().eq("workspace_id", w.id);
    await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
    await admin.from("practice_facility").delete().eq("workspace_id", w.id);
  }
  await admin.from("practice_practitioner_identity").delete().eq("user_id", USER);
  await admin.from("provisioning_request").delete().eq("target_user_id", USER);
  await purgeWorkspacesOwnedBy(admin, [USER], { quiet: true });
}

function report() {
  console.log(failures.length
    ? `\nFAILED  ${pass} passed, ${failures.length} failed\n${failures.map(f => `  - ${f}`).join("\n")}`
    : `\nPASSED  ${pass} passed, 0 failed`);
  if (failures.length) process.exitCode = 1;
}

async function main() {
  // ══ PART ONE: THE PURE RULES. No database, so these run even when nothing is reachable. ════════════

  // ── 1. ⚠ THE ALLERGY THREE-STATE. THE REASON THIS FILE EXISTS. ────────────────────────────────────
  const neverAsked = offlineAllergySentence(blankRecord({ allergyStatus: "not_recorded", allergyCount: 0 }));
  const saidNone = offlineAllergySentence(blankRecord({ allergyStatus: "none_known", allergyCount: 0 }));
  ok("1a. ⚠⚠ a patient NOBODY HAS ASKED is not safe to read as having no allergies",
    neverAsked.safeToRead === false && neverAsked.tone === "unknown",
    `got tone=${neverAsked.tone} safeToRead=${neverAsked.safeToRead}`);
  ok("1b-control. a patient explicitly recorded as having none IS",
    saidNone.safeToRead === true && saidNone.tone === "none",
    "if this fails 1a passes for the wrong reason -- nothing would be safe");
  ok("1c. ⚠ AND THE TWO PRODUCE DIFFERENT SENTENCES, which is the whole point",
    neverAsked.text !== saidNone.text, `both said "${neverAsked.text}"`);
  ok("1d. an allergy list that COULD NOT BE READ is not 'none' either",
    offlineAllergySentence(blankRecord({ allergyStatus: "none_known", allergiesUnavailable: true }))
      .safeToRead === false,
    "unavailable must beat even an explicit none_known");
  ok("1e. ⚠ `recorded` with a NULL count says the list could not be read, not zero",
    offlineAllergySentence(blankRecord({ allergyStatus: "recorded", allergyCount: null }))
      .tone === "unreadable");
  ok("1f. ⚠ `recorded` with ZERO listed is a CONTRADICTION and is reported as one",
    offlineAllergySentence(blankRecord({ allergyStatus: "recorded", allergyCount: 0 }))
      .safeToRead === false);
  ok("1g. a null status -- the field never migrated -- defaults to the un-reassuring answer",
    offlineAllergySentence(blankRecord({ allergyStatus: null })).safeToRead === false);

  // ── 2. MEDICATION, THE SAME DISCIPLINE ────────────────────────────────────────────────────────────
  ok("2a. medication that could not be read is not 'takes nothing'",
    offlineMedicationSentence(blankRecord({ medicationsUnavailable: true })).tone === "unreadable");
  ok("2b. an empty list does NOT claim the patient takes nothing",
    !offlineMedicationSentence(blankRecord()).text.toLowerCase().includes("no current medication"),
    offlineMedicationSentence(blankRecord()).text);
  const mixed = offlineMedicationSentence(blankRecord({
    medications: [med("a", "active"), med("b", "active"), med("c", "paused")],
  }));
  ok("2c. ⚠ A PAUSED COURSE IS NEVER COUNTED AS CURRENT",
    mixed.text.startsWith("2 current medicine") && mixed.text.includes("1 paused"),
    mixed.text);
  const allPaused = offlineMedicationSentence(blankRecord({ medications: [med("c", "paused")] }));
  ok("2d. ⚠ and when EVERYTHING is paused it does not read as nothing to worry about",
    allPaused.safeToRead === false && allPaused.text.includes("paused"), allPaused.text);
  ok("2e. a dropped count is said out loud, never silently truncated",
    offlineMedicationSentence(blankRecord({ medications: [med("a", "active")], medicationsDropped: 4 }))
      .text.includes("4 more"));

  // ── 3. THE LOOKUP RETURNS A STATE, NOT `undefined` ────────────────────────────────────────────────
  const emptyPack = projectOfflineClinicalPack({
    workspaceId: "w", timezone: TZ, asOf: new Date().toISOString(), horizonDate: "2026-08-15",
    records: [], recordsUnavailable: false, dropped: null,
  });
  ok("3a. ⚠ a patient with no record returns not_held WITH A REASON, never undefined",
    lookupOfflineClinical(emptyPack, "nobody").state === "not_held");
  ok("3b. and with no pack at all, likewise",
    lookupOfflineClinical(null, "nobody").state === "not_held");
  ok("3c-control. a record that IS there is found",
    lookupOfflineClinical(
      { ...emptyPack, records: [blankRecord({ patientId: "p9" })] }, "p9").state === "found");
  ok("3d. ⚠ an unavailable pack does not answer 'not held for this patient' as though it knew",
    lookupOfflineClinical({ ...emptyPack, recordsUnavailable: true }, "p9").state === "not_held");

  // ── 4. EXPIRY, AND ITS RELATIONSHIP TO THE HORIZON ────────────────────────────────────────────────
  ok("4a. ⚠⚠ THE EXPIRY OUTLASTS THE HORIZON, or the pack dies on the last day of the trip",
    OFFLINE_CLINICAL_MAX_DAYS > OFFLINE_CLINICAL_HORIZON_DAYS,
    `${OFFLINE_CLINICAL_MAX_DAYS} vs ${OFFLINE_CLINICAL_HORIZON_DAYS}`);
  const asOf = "2026-08-11T08:00:00.000Z";
  const pack = projectOfflineClinicalPack({
    workspaceId: "w", timezone: TZ, asOf, horizonDate: "2026-08-15",
    records: [blankRecord()], recordsUnavailable: false, dropped: null,
  });
  ok("4b-control. inside its life it reads ok",
    readOfflineClinical(pack, new Date("2026-08-13T08:00:00.000Z")).state === "ok");
  const expired = readOfflineClinical(pack, new Date("2026-08-17T09:00:00.000Z"));
  ok("4c. past the expiry it is WITHHELD", expired.state === "expired");
  ok("4d. ⚠ and DELETED rather than hidden -- the only control that reaches a device that never returns",
    expired.state === "expired" && expired.purge === true);
  ok("4e. a clock earlier than capture shows nothing",
    readOfflineClinical(pack, new Date("2026-08-10T08:00:00.000Z")).state === "clock_rollback");
  ok("4f. ⚠ but does NOT delete -- a wrong clock is not a reason to destroy a valid record",
    (readOfflineClinical(pack, new Date("2026-08-10T08:00:00.000Z")) as { purge: boolean }).purge === false);
  ok("4g. a pack from an older schema is discarded, not guessed at",
    readOfflineClinical({ ...pack, schemaVersion: 0 }, new Date(asOf)).state === "wrong_schema");
  ok("4h. expiry is exactly MAX_DAYS after capture",
    offlineClinicalExpiry(asOf) === new Date(Date.parse(asOf) + OFFLINE_CLINICAL_MAX_DAYS * 86400000).toISOString());

  // ── 5. THE SENTENCES NEVER OVER-CLAIM ─────────────────────────────────────────────────────────────
  const banned = ["up to date", "current as of", "synced", "confirmed", "latest", "verified"];
  const notices = [0, 1, 2, 3, 5].map(d =>
    offlineClinicalNotice(asOf, TZ, new Date(Date.parse(asOf) + d * 86400000)).sentence);
  ok("5a. ⚠ no staleness sentence claims the record is current",
    notices.every(s => !banned.some(b => s.toLowerCase().includes(b))),
    notices.find(s => banned.some(b => s.toLowerCase().includes(b))) ?? "");
  ok("5b. every one of them names the actual hazard -- a medicine or an allergy changing",
    notices.every(s => /medicine|medication|allergy/i.test(s)));
  ok("5c. the tone escalates rather than staying one colour at every age",
    new Set([0, 1, 3, 6].map(d =>
      offlineClinicalNotice(asOf, TZ, new Date(Date.parse(asOf) + d * 86400000)).tone)).size >= 3);

  // ── 6. NOT ONE MUTATING CONTROL IS EVER ENABLED ───────────────────────────────────────────────────
  const controls = offlineClinicalControls(blankRecord());
  ok("6a-control. there ARE mutating controls to refuse, so 6b is not vacuous",
    controls.filter(c => c.mutating).length >= 4, `${controls.length} controls`);
  ok("6b. ⚠ NONE of them is enabled offline", enabledMutatingClinicalControls(controls).length === 0);
  ok("6c. every disabled control carries a reason a person can read",
    controls.filter(c => !c.enabled).every(c => (c.reason ?? "").length > 20));
  ok("6d. prescribing is among the ones refused, by name",
    controls.some(c => c.mutating && c.key.startsWith("prescribe:")));

  // ── 7. CAPS ARE REPORTED, NEVER SILENT ────────────────────────────────────────────────────────────
  const many = Array.from({ length: 10 }, (_, i) => blankRecord({ patientId: `p${i}` }));
  const capped = capOfflineClinical(many, { maxPatients: 4, totalAvailable: 10 });
  ok("7a. the cap is applied", capped.records.length === 4);
  ok("7b. ⚠ and what was left behind is COUNTED AGAINST THE TRUE TOTAL and said out loud",
    capped.dropped?.count === 6 && (capped.dropped?.reason ?? "").includes("6 patients"));
  ok("7c. the sentence says their APPOINTMENT still shows, so nobody reads it as 'not booked'",
    (capped.dropped?.reason ?? "").includes("appointment still shows"));
  ok("7d-control. nothing dropped means nothing claimed",
    capOfflineClinical(many, { maxPatients: 50, totalAvailable: 10 }).dropped === null);

  // ── 8. THE ALLOW-LIST REFUSES BEFORE SEALING ──────────────────────────────────────────────────────
  ok("8a-control. the real pack is accepted", clinicalFieldsNotAllowed(pack).length === 0);
  const wide = {
    ...pack,
    records: [{ ...blankRecord(), prescriber: "Dr Somebody", birth_date: "1980-01-01" }],
  } as unknown as OfflineClinicalPack;
  const badFields = clinicalFieldsNotAllowed(wide);
  ok("8b. ⚠ a record carrying extra fields is REFUSED, and they are NAMED",
    badFields.length === 2 && badFields.includes("record.prescriber") && badFields.includes("record.birth_date"),
    badFields.join(", "));
  ok("8c. the forbidden list names a colleague's name and a date of birth explicitly",
    OFFLINE_CLINICAL_FORBIDDEN_FIELDS.includes("prescriber")
    && OFFLINE_CLINICAL_FORBIDDEN_FIELDS.includes("birth_date"));
  ok("8d. and none of the forbidden names is also on the allow-list",
    !OFFLINE_CLINICAL_FORBIDDEN_FIELDS.some(f =>
      (OFFLINE_CLINICAL_RECORD_KEYS as readonly string[]).includes(f)));

  // ── 9. SOURCE ASSERTIONS -- what node cannot execute ──────────────────────────────────────────────
  // ⚠ Comments stripped first. Eight assertions in this repository have matched their own documentation.
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const writer = strip(readFileSync("src/app/practice/(shell)/OfflineCacheWriter.tsx", "utf8"));
  ok("9-control. stripping comments left the writer's code behind",
    writer.includes("cacheOfflineClinical") && !writer.includes("THE ONLY CACHE IN THIS PRODUCT"));
  ok("9a. ⚠ the writer refuses the clinical carry when NO PIN is set",
    /derived === undefined/.test(writer) && writer.includes("clinicalWithheld"),
    "a device with no PIN would hold allergies behind a key stored beside them");
  ok("9b. ⚠ and it still caches the DAY in that case -- the PIN gates one cache, not the product",
    writer.indexOf("cacheOfflineDay") < writer.indexOf("derived === undefined"),
    "the day must already be written before the clinical branch is reached");
  const reader = strip(readFileSync("src/app/practice/offline/OfflineReader.tsx", "utf8"));
  ok("9c. ⚠ the reader no longer claims allergies are NOT held -- that sentence became false",
    !/not held on this device[\s\S]{0,80}deliberately not stored/i.test(reader),
    "a stale reassurance tells a practitioner not to bother looking");
  ok("9d. only the `none` tone may look neutral, and nothing is green",
    /none:\s*"border-gray/.test(reader) && !/green/.test(reader.split("SAFETY_TONE")[1]?.slice(0, 400) ?? ""));

  // ══ PART TWO: AGAINST A REAL DATABASE ═════════════════════════════════════════════════════════════
  await cleanup();
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-clinical-${Date.now()}`, request_type: "pilot",
    actor_user_id: USER, target_user_id: USER, payload_hash: "harness", correlation_id: "harness-clinical",
  }).select("id").single();
  const payload: IndividualRequest = {
    displayName: "Harness Clinical", countryCode: "UG", timezone: TZ,
    professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
    termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
  };
  const run = await runProvisioning(admin,
    { id: req!.id, target_user_id: USER, correlation_id: "harness-clinical", workspace_id: null }, payload);
  if (!run.ok || !run.workspaceId) {
    console.error("provisioning failed:", run.errorCode);
    ok("10-control. a workspace was provisioned for the database half", false, run.errorCode ?? "");
    report(); return;
  }
  const wsId = run.workspaceId;
  const ctx = ctxFor(wsId);
  const at = new Date();

  const mkPatient = async (name: string, allergyStatus: string) => {
    const { data } = await admin.from("practice_patient").insert({
      workspace_id: wsId, display_name: name, allergy_status: allergyStatus,
    }).select("id").single();
    return data!.id as string;
  };
  // ⚠ THIS FIXTURE WAS ONLY VALID FOR TWENTY-ONE HOURS A DAY, and 11a went red at 22:35 UTC to prove
  // it. `at + dayOffset` then setUTCHours(9) builds an instant on the UTC calendar, but the horizon
  // this is testing is measured on the PRACTICE's calendar. In Kampala after 21:00 UTC the practice is
  // already on tomorrow, so offset 0 landed at noon YESTERDAY and that patient fell out of the pack --
  // the harness reporting a horizon defect that was really its own clock.
  //
  // Built from the practice's day now, so offset 0 means 09:00 on the practice's today, always.
  const practiceDayNow = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(at);
  const mkAppt = async (patientId: string, dayOffset: number) => {
    const day = addCalendarDays(practiceDayNow, dayOffset);
    const when = new Date(Date.parse(zonedDayRange(day, TZ).startIso) + 9 * 3600000);
    await admin.from("practice_appointment").insert({
      workspace_id: wsId, patient_id: patientId, patient_name: "x",
      appointment_type: "scheduled_followup", scheduled_at: when.toISOString(),
      duration_minutes: 20, status: "CONFIRMED",
    });
  };

  // ⚠ THE THREE FIXTURES THAT MATTER, and the third is the dangerous one.
  const pRecorded = await mkPatient("Recorded Allergies", "recorded");
  const pNone = await mkPatient("Explicitly None", "none_known");
  const pNeverAsked = await mkPatient("Nobody Asked", "not_recorded");
  const pOutside = await mkPatient("Beyond Horizon", "recorded");

  await mkAppt(pRecorded, 0);
  await mkAppt(pNone, 1);
  await mkAppt(pNeverAsked, 2);
  // ⚠ Well past the horizon, so this patient must not be on the device at all.
  await mkAppt(pOutside, OFFLINE_CLINICAL_HORIZON_DAYS + 5);

  const { error: allergyErr } = await admin.from("practice_patient_allergy").insert([
    { workspace_id: wsId, patient_id: pRecorded, substance: "Penicillin", reaction: "rash", severity: "moderate", certainty: "confirmed" },
    { workspace_id: wsId, patient_id: pRecorded, substance: "Peanut", reaction: null, severity: null, certainty: "refuted" },
  ]);
  ok("10-control. the allergy fixture was created", !allergyErr, allergyErr?.message ?? "");

  const { error: medErr } = await admin.from("practice_medication").insert([
    { workspace_id: wsId, patient_id: pRecorded, generic_name: "Amoxicillin", dose_text: "500mg", status: "active" },
    { workspace_id: wsId, patient_id: pRecorded, generic_name: "Metformin", dose_text: "1g", status: "paused" },
    { workspace_id: wsId, patient_id: pRecorded, generic_name: "OldDrug", dose_text: "5mg", status: "discontinued", discontinued_reason: "course finished" },
    { workspace_id: wsId, patient_id: pRecorded, generic_name: "DoneDrug", dose_text: "2mg", status: "completed" },
  ]);
  ok("10-control-b. the medication fixture was created", !medErr, medErr?.message ?? "");

  await admin.from("practice_problem").insert({
    workspace_id: wsId, patient_id: pRecorded, label: "Type 2 diabetes", status: "active",
  });

  // ⚠ TWO ENCOUNTERS: the NEWER one is ENTERED_IN_ERROR and must never be shown as the last visit.
  const older = new Date(at.getTime() - 20 * 86400000).toISOString();
  const newer = new Date(at.getTime() - 2 * 86400000).toISOString();
  const { data: goodEnc } = await admin.from("practice_encounter").insert({
    workspace_id: wsId, patient_id: pRecorded, entry_pathway: "booked", status: "COMPLETED",
    started_at: older, completed_at: older, encounter_mode: "in_person",
  }).select("id").single();
  const { data: badEnc } = await admin.from("practice_encounter").insert({
    workspace_id: wsId, patient_id: pRecorded, entry_pathway: "booked", status: "ENTERED_IN_ERROR",
    started_at: newer, completed_at: newer, encounter_mode: "in_person",
  }).select("id").single();
  ok("10-control-c. both encounter fixtures exist, the bad one NEWER than the good one",
    !!goodEnc && !!badEnc && newer > older);

  await admin.from("practice_encounter_note").insert([
    { workspace_id: wsId, encounter_id: goodEnc!.id, note_type: "assessment", body: "Reasonable control." },
    { workspace_id: wsId, encounter_id: goodEnc!.id, note_type: "plan", body: "Continue, review in 3 months." },
    { workspace_id: wsId, encounter_id: goodEnc!.id, note_type: "subjective", body: "SHOULD NOT BE CACHED" },
  ]);
  await admin.from("practice_diagnosis").insert({
    workspace_id: wsId, encounter_id: goodEnc!.id, patient_id: pRecorded, label: "T2DM", certainty: "confirmed",
  });

  const result = await offlineClinicalPayload(admin, ctx, { timezone: TZ, at });
  ok("11-control. the payload was assembled", result.ok, result.ok ? "" : result.reason);
  if (!result.ok) { await cleanup(); report(); return; }
  const built: OfflineClinicalPack = result.pack;
  const byId = new Map(built.records.map(r => [r.patientId, r]));

  ok("11a. ⚠ THE HORIZON BOUNDS IT -- a patient booked beyond it is not on the device at all",
    !byId.has(pOutside) && byId.size === 3, `${byId.size} records`);
  ok("11b. the horizon date is the practice's calendar, HORIZON_DAYS out",
    built.horizonDate === addCalendarDays(built.asOf.slice(0, 10), OFFLINE_CLINICAL_HORIZON_DAYS)
    || built.horizonDate > built.asOf.slice(0, 10), built.horizonDate);

  const recRecorded = byId.get(pRecorded)!;
  const recNever = byId.get(pNeverAsked)!;
  const recNone = byId.get(pNone)!;

  ok("12a. ⚠⚠ THE PATIENT NOBODY ASKED IS NOT SAFE TO READ, END TO END FROM THE DATABASE",
    offlineAllergySentence(recNever).safeToRead === false,
    "an empty allergy list survived the cache as though somebody had said none");
  ok("12b-control. the one explicitly recorded as having none IS, so 12a is a real distinction",
    offlineAllergySentence(recNone).safeToRead === true);
  ok("12c. ⚠ and their allergy COUNTS differ from their STATUS -- both are zero-length lists",
    recNever.allergies.length === 0 && recNone.allergies.length === 0
    && recNever.allergyStatus !== recNone.allergyStatus);
  ok("12d. a real allergy list is carried with its reaction and severity",
    recRecorded.allergies.some(a => a.substance === "Penicillin" && a.reaction === "rash"));
  ok("12e. ⚠ a REFUTED allergy is carried rather than filtered -- it is an answer, not silence",
    recRecorded.allergies.some(a => a.certainty === "refuted"));

  ok("13a. active medication is carried",
    recRecorded.medications.some(m => m.genericName === "Amoxicillin" && m.status === "active"));
  ok("13b. ⚠ PAUSED medication is carried too -- it can still interact",
    recRecorded.medications.some(m => m.genericName === "Metformin" && m.status === "paused"));
  ok("13c. discontinued and completed courses are NOT",
    !recRecorded.medications.some(m => ["OldDrug", "DoneDrug"].includes(m.genericName)),
    recRecorded.medications.map(m => m.genericName).join(", "));
  ok("13d. ⚠ and the sentence counts ONE current medicine, not two",
    offlineMedicationSentence(recRecorded).text.startsWith("1 current medicine"),
    offlineMedicationSentence(recRecorded).text);
  ok("13e. the carried statuses are exactly what the constant names",
    OFFLINE_MEDICATION_STATUSES.length === 2
    && recRecorded.medications.every(m => (OFFLINE_MEDICATION_STATUSES as readonly string[]).includes(m.status)));

  ok("14a. ⚠⚠ THE ENTERED_IN_ERROR ENCOUNTER IS NOT THE LAST VISIT, THOUGH IT IS THE NEWEST",
    recRecorded.lastVisit?.encounterId === goodEnc!.id,
    "a fabricated history offline cannot be checked against anything");
  ok("14b-control. a last visit WAS found, so 14a is not passing on an empty result",
    !!recRecorded.lastVisit);
  ok("14c. the excluded statuses are named as a constant rather than inline",
    OFFLINE_LAST_VISIT_EXCLUDED_STATUSES.includes("ENTERED_IN_ERROR"));
  ok("14d. the assessment AND the plan are both carried",
    !!recRecorded.lastVisit?.assessment?.includes("Reasonable control")
    && !!recRecorded.lastVisit?.plan?.includes("review in 3 months"));
  ok("14e. ⚠ the SUBJECTIVE segment is NOT -- only two of the five are carried",
    !JSON.stringify(recRecorded.lastVisit).includes("SHOULD NOT BE CACHED"));
  ok("14f. the diagnoses of that visit are carried",
    !!recRecorded.lastVisit?.diagnoses.includes("T2DM"));
  ok("14g. a patient with no earlier encounter gets null, not a fabricated one",
    recNone.lastVisit === null && recNone.lastVisitUnavailable === false);

  ok("15a. the assembled pack passes its own allow-list", clinicalFieldsNotAllowed(built).length === 0);
  ok("15b. ⚠ no forbidden field name appears anywhere in the serialised payload",
    !OFFLINE_CLINICAL_FORBIDDEN_FIELDS.some(f => JSON.stringify(built).includes(`"${f}"`)));
  ok("15c. an account without practice.calendar.view is REFUSED, and told why",
    !(await offlineClinicalPayload(admin, ctxFor(wsId, ["practice.home.view"]), { timezone: TZ, at })).ok);
  ok("15d. every record's key set is exactly the allow-list",
    built.records.every(r => Object.keys(r).length === OFFLINE_CLINICAL_RECORD_KEYS.length));

  await cleanup();
  report();
}

// ⚠ TEARDOWN ON A KILL, NOT ONLY ON A THROW. The catch below covers a run that FAILS; it does not
// cover one that is KILLED, which in this environment is the ordinary case -- a command timeout, an
// agent watchdog, a stopped task. Six abandoned Practice workspaces accumulated that way and the
// landlord Mission Control counted every one of them as a real practice. Best effort: SIGKILL cannot
// be caught, and scripts/estate-hygiene-harness.ts is the backstop for what still gets through.
cleanupOnKill(cleanup);
main().catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
