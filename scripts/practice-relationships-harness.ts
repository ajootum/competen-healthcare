/**
 * Patient relationships harness -- CPR-PRM-001 s6, s10, s4. Migration 221.
 *
 * WHAT IT PROVES:
 *   1. AGE IS EXACT AND DERIVED -- years, months and days (s4), computed in the practice's calendar.
 *   2. THE GUARDIAN RULE IS DERIVED FROM THE DATE OF BIRTH, NOT STORED. A patient one day under 18
 *      needs a guardian; the same patient one day over does not -- with nothing having run overnight.
 *   3. A PATIENT WITH NO DATE OF BIRTH IS NOT TREATED AS AN ADULT. Assuming majority is the unsafe
 *      direction, and it is refused.
 *   4. NOT EVERY RELATIONSHIP CAN HOLD LEGAL AUTHORITY -- an interpreter cannot be a guardian.
 *   5. ONE PRIMARY CONTACT AT A TIME, enforced by a partial unique index AND by displacement.
 *   6. A RELATIONSHIP IS ENDED, NOT DELETED, and an ended one stops counting immediately.
 *   7. A CHILD CANNOT CONSENT FOR THEMSELVES -- consent must name the guardian who gave it.
 *   8. CONSENT HAS THREE STATES, so "never asked" and "asked and declined" stay different facts.
 *   9. WITHDRAWING CONSENT SUPERSEDES GIVING IT, and the history keeps both.
 *  10. TAGS ARE NORMALISED, so one label is one tag.
 *  11. THE GAP LIST PUTS CHILDREN FIRST and drops a patient the moment their record is complete.
 *  12. patient.edit IS REQUIRED TO WRITE, with a control.
 *  13. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-relationships-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  ageFrom, relationshipExpectation, patientRelationships, addRelationship, endRelationship,
  recordConsent, updatePatientAdmin, relationshipGaps, RELATIONSHIP_TYPES, CONSENT_TYPES, MAJORITY_AGE,
} from "../src/lib/practice/relationships";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-00000000pr01".replace("pr01", "cf01");
const OTHER = "00000000-0000-4000-8000-00000000cf02";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-rel-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-rel",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-rel", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [OWNER, OTHER]) {
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
  // ⚠ The workspace delete lives in _cleanup.ts: it unpicks the six tables referencing
  // practice_parameter_definition with no on-delete clause, and REPORTS a failure instead of
  // discarding it. Anything deleted above still runs first and is unchanged.
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}

const base = { actorId: OWNER, correlationId: "harness-rel" };

/* eslint-disable @typescript-eslint/no-explicit-any */

async function withoutCapability(workspaceId: string, userId: string, capability: string): Promise<WorkspaceContext> {
  const { data: mine } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", workspaceId).eq("user_id", userId);
  await admin.from("practice_role_assignment").update({ effective_to: new Date().toISOString() })
    .in("membership_id", ((mine ?? []) as any[]).map(m => m.id))
    .eq("capability_code", capability).is("effective_to", null);
  const res = await resolveWorkspaceContext(admin, userId, workspaceId);
  if (!res.ok) throw new Error("context failed");
  return res.ctx;
}

/** A birth date that makes somebody exactly `years` old, offset by `days`. */
function birthDateFor(years: number, offsetDays = 0): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log("\nPatient relationships harness (CPR-PRM-001 s6/s10/s4, migration 221)\n");
  await cleanup();

  // ── 1. Age, pure and before any data ───────────────────────────────────────
  ok("1. AGE IS EXACT: years, months and days (s4)",
    JSON.stringify(ageFrom("2000-01-15", "2026-03-20")) ===
    JSON.stringify({ years: 26, months: 2, days: 5, label: "26 years" }),
    JSON.stringify(ageFrom("2000-01-15", "2026-03-20")));
  ok("1b. AN INFANT IS NOT '0 YEARS' -- months and days, because paediatric dosing turns on them",
    ageFrom("2026-01-01", "2026-02-12")?.label === "1 months, 11 days",
    ageFrom("2026-01-01", "2026-02-12")?.label);
  ok("1c. and a few days old reads in days",
    ageFrom("2026-03-15", "2026-03-20")?.label === "5 days", ageFrom("2026-03-15", "2026-03-20")?.label);
  ok("1d. the day before a birthday is still the younger age",
    ageFrom("2008-08-05", "2026-08-04")?.years === 17, String(ageFrom("2008-08-05", "2026-08-04")?.years));
  ok("1e. and the birthday itself turns it over",
    ageFrom("2008-08-04", "2026-08-04")?.years === 18, String(ageFrom("2008-08-04", "2026-08-04")?.years));
  ok("1f. an unparseable or future date returns nothing rather than a negative age",
    ageFrom("not a date", "2026-08-04") === null && ageFrom(null, "2026-08-04") === null &&
    ageFrom("2030-01-01", "2026-08-04") === null);

  // ── 2. The rule is derived ─────────────────────────────────────────────────
  const dayBefore = ageFrom(birthDateFor(MAJORITY_AGE, 1), new Date().toISOString().slice(0, 10));
  const dayAfter = ageFrom(birthDateFor(MAJORITY_AGE, -1), new Date().toISOString().slice(0, 10));
  ok("2. ONE DAY UNDER 18 EXPECTS A GUARDIAN",
    relationshipExpectation(dayBefore, []).required === "guardian",
    JSON.stringify({ age: dayBefore?.years, req: relationshipExpectation(dayBefore, []).required }));
  ok("2b. ONE DAY OVER 18 EXPECTS A NEXT OF KIN -- with nothing having run overnight",
    relationshipExpectation(dayAfter, []).required === "next_of_kin",
    JSON.stringify({ age: dayAfter?.years, req: relationshipExpectation(dayAfter, []).required }));

  // ── 3. No date of birth is not an adult ────────────────────────────────────
  const unknown = relationshipExpectation(null, []);
  ok("3. NO DATE OF BIRTH IS NOT TREATED AS AN ADULT -- the unsafe assumption is refused",
    unknown.required === "unknown" && unknown.satisfied === false &&
    /cannot be worked out/i.test(unknown.reason),
    JSON.stringify(unknown));

  const wsA = await provision(OWNER, "HARNESS Relationships A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Relationships B (synthetic)", "b");
  const a = await resolveWorkspaceContext(admin, OWNER, wsA);
  const b = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!a.ok || !b.ok) { ok("workspace contexts resolve", false); return report(); }

  // ── The fixture: a child, an adult, and somebody with no date of birth ─────
  const child = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Nakato Baby", sex: "female",
    birthDate: birthDateFor(6), phone: "0772 221 001", ...base,
  });
  const adult = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Mukasa David", sex: "male",
    birthDate: birthDateFor(44), phone: "0772 221 002", ...base,
  });
  // A WALK-IN WHOSE AGE WAS ESTIMATED AT THE DOOR, right on the boundary. registerPatient requires a
  // date OR an estimate (CPR-V2-005's minimum dataset), so this is the common case, not an edge one.
  const noDob = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Unknown Walkin", sex: "unspecified",
    ageEstimateYears: MAJORITY_AGE, phone: "0772 221 003", ...base,
  });
  // And one estimated well below it, where the estimate IS good enough to decide.
  const estimatedChild = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Estimated Child", sex: "male",
    ageEstimateYears: 7, phone: "0772 221 004", ...base,
  });
  ok("the four fixture patients register", child.ok && adult.ok && noDob.ok && estimatedChild.ok,
    [child, adult, noDob, estimatedChild].map(p => p.ok ? "ok" : p.message).join(" | "));
  if (!child.ok || !adult.ok || !noDob.ok || !estimatedChild.ok) return report();

  // ── 3b. An estimate decides when it is clear, and refuses when it is not ───
  const estimatedDetail = await patientRelationships(admin, a.ctx, estimatedChild.data.id);
  ok("3b. AN ESTIMATE OF SEVEN IS ENOUGH TO KNOW A GUARDIAN IS NEEDED",
    estimatedDetail!.expectation.required === "guardian" &&
    /estimated age/i.test(estimatedDetail!.expectation.reason),
    JSON.stringify(estimatedDetail!.expectation));
  const boundaryDetail = await patientRelationships(admin, a.ctx, noDob.data.id);
  ok("3c. AN ESTIMATE OF EIGHTEEN IS NOT -- deciding either way would be a glance, not a fact",
    boundaryDetail!.expectation.required === "unknown" &&
    /too close to 18|Record a date of birth/i.test(boundaryDetail!.expectation.reason),
    JSON.stringify(boundaryDetail!.expectation));

  const childBefore = await patientRelationships(admin, a.ctx, child.data.id);
  ok("2c. THE CHILD'S RECORD SAYS A GUARDIAN IS EXPECTED AND MISSING",
    childBefore!.expectation.required === "guardian" && childBefore!.expectation.satisfied === false,
    JSON.stringify(childBefore!.expectation));
  ok("2d. and it names the age in the reason, so it reads as a fact rather than a rule",
    /6 years/.test(childBefore!.expectation.reason), childBefore!.expectation.reason);

  // ── 4. Not every relationship can hold authority ───────────────────────────
  const interpreterGuardian = await addRelationship(admin, a.ctx, {
    patientId: child.data.id, relationshipType: "interpreter", fullName: "Sarah Translator",
    isLegalGuardian: true, correlationId: "harness-rel",
  });
  ok("4. AN INTERPRETER CANNOT HOLD LEGAL GUARDIANSHIP",
    !interpreterGuardian.ok && interpreterGuardian.code === "CANNOT_BE_GUARDIAN",
    interpreterGuardian.ok ? "it was allowed" : interpreterGuardian.code);
  const interpreterPlain = await addRelationship(admin, a.ctx, {
    patientId: child.data.id, relationshipType: "interpreter", fullName: "Sarah Translator",
    correlationId: "harness-rel",
  });
  ok("4b. CONTROL: but they can be recorded as an interpreter", interpreterPlain.ok,
    interpreterPlain.ok ? "" : interpreterPlain.message);

  const mother = await addRelationship(admin, a.ctx, {
    patientId: child.data.id, relationshipType: "mother", fullName: "Nakato Sarah",
    phone: "0772 221 010", isLegalGuardian: true, mayReceiveInformation: true, isPrimary: true,
    correlationId: "harness-rel",
  });
  ok("a mother with legal guardianship is recorded", mother.ok, mother.ok ? "" : mother.message);
  const childAfter = await patientRelationships(admin, a.ctx, child.data.id);
  ok("2e. AND THE EXPECTATION IS NOW SATISFIED, naming who",
    childAfter!.expectation.satisfied === true && /Nakato Sarah/.test(childAfter!.expectation.reason),
    childAfter!.expectation.reason);

  // ── 5. One primary at a time ───────────────────────────────────────────────
  const father = await addRelationship(admin, a.ctx, {
    patientId: child.data.id, relationshipType: "father", fullName: "Mukasa Peter",
    isLegalGuardian: true, isPrimary: true, correlationId: "harness-rel",
  });
  ok("5. A NEW PRIMARY IS ACCEPTED", father.ok, father.ok ? "" : father.message);
  const primaries = (await patientRelationships(admin, a.ctx, child.data.id))!
    .relationships.filter(r => r.is_primary && r.live);
  ok("5b. AND THERE IS EXACTLY ONE -- the previous primary was displaced, not collided with",
    primaries.length === 1 && primaries[0].full_name === "Mukasa Peter",
    JSON.stringify(primaries.map(p => p.full_name)));
  // THE INDEX IS THE BACKSTOP, proven directly: an engine that forgot to displace must still fail.
  const { error: rawPrimary } = await admin.from("practice_patient_relationship").insert({
    workspace_id: wsA, patient_id: child.data.id, relationship_type: "sibling",
    full_name: "Sneaky Second Primary", is_primary: true,
  });
  ok("5c. AND THE DATABASE REFUSES A SECOND, for a writer that bypasses the engine",
    rawPrimary !== null, rawPrimary?.message ?? "the insert succeeded");

  // ── 6. Ended, not deleted ──────────────────────────────────────────────────
  const ended = await endRelationship(admin, a.ctx, {
    id: (mother as any).data.id, correlationId: "harness-rel",
  });
  ok("6. A RELATIONSHIP IS ENDED", ended.ok, ended.ok ? "" : ended.message);
  const afterEnd = await patientRelationships(admin, a.ctx, child.data.id);
  ok("6b. THE ROW SURVIVES -- who was authorised in March is a fact about the record",
    afterEnd!.relationships.some(r => r.full_name === "Nakato Sarah"),
    JSON.stringify(afterEnd!.relationships.map(r => r.full_name)));
  ok("6c. but it no longer counts as live",
    afterEnd!.relationships.find(r => r.full_name === "Nakato Sarah")!.live === false);
  const backwards = await endRelationship(admin, a.ctx, {
    id: (father as any).data.id, on: "2000-01-01", correlationId: "harness-rel",
  });
  ok("6d. and it cannot be ended before it began",
    !backwards.ok && backwards.code === "ENDS_BEFORE_START");

  // ── 7, 8, 9. Consent ───────────────────────────────────────────────────────
  const childSelfConsent = await recordConsent(admin, a.ctx, {
    patientId: child.data.id, consentType: "data_processing", state: "given",
    correlationId: "harness-rel",
  });
  ok("7. A CHILD CANNOT CONSENT FOR THEMSELVES",
    !childSelfConsent.ok && childSelfConsent.code === "GUARDIAN_REQUIRED",
    childSelfConsent.ok ? "it was accepted" : childSelfConsent.code);
  const viaGuardian = await recordConsent(admin, a.ctx, {
    patientId: child.data.id, consentType: "data_processing", state: "given",
    givenByRelationshipId: (father as any).data.id, givenByName: "Mukasa Peter",
    noticeVersion: "privacy-1", correlationId: "harness-rel",
  });
  ok("7b. CONTROL: the guardian can, and the record names them", viaGuardian.ok,
    viaGuardian.ok ? "" : viaGuardian.message);
  const viaInterpreter = await recordConsent(admin, a.ctx, {
    patientId: child.data.id, consentType: "contact_by_practice", state: "given",
    givenByRelationshipId: (interpreterPlain as any).data.id, correlationId: "harness-rel",
  });
  ok("7c. and naming somebody who is NOT the guardian does not satisfy it",
    !viaInterpreter.ok && viaInterpreter.code === "GUARDIAN_REQUIRED");

  const adultConsent = await patientRelationships(admin, a.ctx, adult.data.id);
  ok("8. CONSENT STARTS AS 'not_recorded', NOT AS false -- never asked is not the same as declined",
    adultConsent!.consent.every(c => c.state === "not_recorded") &&
    adultConsent!.consent.length === CONSENT_TYPES.length,
    JSON.stringify(adultConsent!.consent.map(c => c.state)));

  await recordConsent(admin, a.ctx, {
    patientId: adult.data.id, consentType: "data_processing", state: "given",
    noticeVersion: "privacy-1", correlationId: "harness-rel",
  });
  await recordConsent(admin, a.ctx, {
    patientId: adult.data.id, consentType: "data_processing", state: "withdrawn",
    correlationId: "harness-rel",
  });
  const withdrawn = await patientRelationships(admin, a.ctx, adult.data.id);
  ok("9. WITHDRAWING SUPERSEDES GIVING -- the latest state is what counts",
    withdrawn!.consent.find(c => c.key === "data_processing")!.state === "withdrawn",
    withdrawn!.consent.find(c => c.key === "data_processing")!.state);
  ok("9b. and the history keeps both, so 'they consented in June' stays answerable",
    withdrawn!.consentHistory.filter((c: any) => c.consent_type === "data_processing").length === 2,
    String(withdrawn!.consentHistory.length));

  // ── 10. Tags ───────────────────────────────────────────────────────────────
  const tagged = await updatePatientAdmin(admin, a.ctx, {
    patientId: adult.data.id, tags: [" Diabetic ", "diabetic", "DIABETIC", "hypertension"],
    preferredContactMethod: "phone", preferredLanguage: "Luganda", correlationId: "harness-rel",
  });
  ok("10. TAGS ARE ACCEPTED", tagged.ok, tagged.ok ? "" : tagged.message);
  const taggedPatient = await patientRelationships(admin, a.ctx, adult.data.id);
  ok("10b. AND NORMALISED -- one label is one tag, not three in a report nobody can read",
    JSON.stringify(taggedPatient!.patient.tags) === JSON.stringify(["diabetic", "hypertension"]),
    JSON.stringify(taggedPatient!.patient.tags));
  ok("10c. and the preference is recorded as ADVISORY -- nothing here routes a message",
    taggedPatient!.patient.preferred_contact_method === "phone" &&
    taggedPatient!.contactPreferenceIsAdvisoryOnly === true);
  const badMethod = await updatePatientAdmin(admin, a.ctx, {
    patientId: adult.data.id, preferredContactMethod: "carrier_pigeon", correlationId: "harness-rel",
  });
  ok("10d. an unknown contact method is refused", !badMethod.ok && badMethod.code === "VALIDATION_ERROR");

  // ── 11. The gap list ───────────────────────────────────────────────────────
  const gaps = await relationshipGaps(admin, a.ctx);
  ok("11. THE GAP LIST FINDS THE PATIENTS WHOSE RECORDS ARE INCOMPLETE",
    gaps.gaps.length === 3 && gaps.checked === 4,
    JSON.stringify(gaps.gaps.map(g => `${g.displayName}:${g.expectation.required}`)));
  ok("11b. THE CHILD IS NOT ON IT -- their guardian is recorded",
    !gaps.gaps.some(g => g.patientId === child.data.id));
  ok("11c. and the boundary estimate is flagged unknown rather than assumed adult",
    gaps.gaps.some(g => g.patientId === noDob.data.id && g.expectation.required === "unknown"),
    JSON.stringify(gaps.gaps.map(g => g.expectation.required)));
  ok("11d. CHILDREN COME FIRST -- a missing guardian outranks a missing next of kin",
    gaps.gaps[0].expectation.required === "guardian" &&
    gaps.gaps[gaps.gaps.length - 1].expectation.required === "next_of_kin",
    JSON.stringify(gaps.gaps.map(g => g.expectation.required)));

  // ── 12. patient.edit is required ───────────────────────────────────────────
  const readOnly = await withoutCapability(wsA, OWNER, "patient.edit");
  const refused = await addRelationship(admin, readOnly, {
    patientId: adult.data.id, relationshipType: "spouse", fullName: "Should Not Land",
    correlationId: "harness-rel",
  });
  ok("12. WRITING A RELATIONSHIP NEEDS patient.edit", !refused.ok && refused.code === "FORBIDDEN");
  const refusedConsent = await recordConsent(admin, readOnly, {
    patientId: adult.data.id, consentType: "data_processing", state: "given", correlationId: "harness-rel",
  });
  ok("12b. and so does recording consent", !refusedConsent.ok && refusedConsent.code === "FORBIDDEN");
  const stillReads = await patientRelationships(admin, readOnly, adult.data.id);
  ok("12c. CONTROL: reading still works without it -- the refusal is about writing",
    stillReads !== null && stillReads.relationships.length >= 0);

  // ── 13. Cross-workspace isolation ──────────────────────────────────────────
  const crossRead = await patientRelationships(admin, b.ctx, child.data.id);
  ok("13. ANOTHER PRACTICE CANNOT READ THIS ONE'S PATIENT", crossRead === null);
  const crossWrite = await addRelationship(admin, b.ctx, {
    patientId: child.data.id, relationshipType: "spouse", fullName: "Not Their Patient",
    correlationId: "harness-rel",
  });
  ok("13b. nor add a relationship to them", !crossWrite.ok && crossWrite.code === "NOT_FOUND");
  const crossGaps = await relationshipGaps(admin, b.ctx);
  ok("13c. and its gap list holds none of this one's patients",
    crossGaps.gaps.length === 0 && crossGaps.checked === 0, JSON.stringify(crossGaps.gaps.length));
  // NON-VACUOUS: workspace B works on its own records.
  const bPatient = await registerPatient(admin, {
    workspaceId: wsB, displayName: "Their Own Patient", sex: "female", birthDate: birthDateFor(9),
    phone: "0772 222 001", actorId: OTHER, correlationId: "harness-rel",
  });
  ok("workspace B can register its own patient", bPatient.ok, bPatient.ok ? "" : bPatient.message);
  const bRel = bPatient.ok ? await addRelationship(admin, b.ctx, {
    patientId: bPatient.data.id, relationshipType: "mother", fullName: "Their Own Mother",
    isLegalGuardian: true, correlationId: "harness-rel",
  }) : null;
  ok("13d. CONTROL: workspace B manages its own patients perfectly well", !!bRel?.ok,
    bRel && !bRel.ok ? bRel.message : "");

  ok("the relationship taxonomy covers what s6 lists", RELATIONSHIP_TYPES.length >= 12 &&
    ["guardian", "mother", "father", "spouse", "emergency_contact", "interpreter", "employer", "insurance_contact"]
      .every(t => RELATIONSHIP_TYPES.some(([k]) => k === t)),
    String(RELATIONSHIP_TYPES.length));

  await cleanup();
  return report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
