/**
 * Facilities and facility identifiers harness -- CPR-PRM-001 s3, s7, s11. Migration 222.
 *
 * WHAT IT PROVES:
 *   1. THE SAME NUMBER AT TWO DIFFERENT FACILITIES IS TWO DIFFERENT NUMBERS. Migration 193's index made
 *      this a false duplicate; s11 says identifiers are unique WITHIN a facility.
 *   2. AND THE SAME NUMBER TWICE AT ONE FACILITY IS REFUSED -- with the owner named, so the clash can
 *      be resolved rather than merely reported.
 *   3. A FACILITY-SCOPED IDENTIFIER WITHOUT A FACILITY IS REFUSED, and a national one WITH a facility is
 *      refused too -- both directions.
 *   4. TWO SPELLINGS OF ONE HOSPITAL CANNOT BOTH EXIST, or its numbering splits in half.
 *   5. ACTIVE/HISTORICAL IS DERIVED FROM valid_to, never a stored status.
 *   6. A RETIRED NUMBER STILL FINDS THE PATIENT and says it is retired -- last year's discharge summary
 *      carries last year's number.
 *   7. THE PRACTICE ID CANNOT BE RETIRED; it is how this product finds its own records.
 *   8. ENCOUNTER IDENTIFIERS ARE SEPARATE FROM PATIENT ONES (s7), and search finds both.
 *   9. A FACILITY IS CLOSED, NOT DELETED, and the database refuses to delete one that is referenced.
 *  10. CAPABILITIES: facilities take practice.locations.manage, identifiers patient.edit -- each with a
 *      control.
 *  11. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-facilities-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter } from "../src/lib/practice/encounters";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import { purgeWorkspacesOwnedBy, cleanupOnKill } from "./_cleanup";
import {
  listFacilities, addFacility, closeFacility, patientIdentifiers, addPatientIdentifier,
  retireIdentifier, addEncounterIdentifier, encounterIdentifiers, findByIdentifier,
  PATIENT_IDENTIFIER_TYPES, ENCOUNTER_IDENTIFIER_TYPES, FACILITY_TYPES,
} from "../src/lib/practice/facilities";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-00000000fa01";
const OTHER = "00000000-0000-4000-8000-00000000fa02";

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
    idempotency_key: `harness-fac-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-fac",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-fac", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}${run.detail ? " -- " + run.detail : ""}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [OWNER, OTHER]) {
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) {
      // Identifiers reference facilities with ON DELETE RESTRICT, so they go before the workspace does.
      await admin.from("practice_patient_identifier").delete().eq("workspace_id", w.id);
      await admin.from("practice_encounter_identifier").delete().eq("workspace_id", w.id);
      await admin.from("practice_facility").delete().eq("workspace_id", w.id);
    }
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
  // ⚠ The workspace delete itself lives in _cleanup.ts: it unpicks the six tables that reference
  // practice_parameter_definition with no on-delete clause, and REPORTS a failure instead of
  // discarding it. The bespoke unpick above runs first and is unchanged.
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}

const base = { actorId: OWNER, correlationId: "harness-fac" };

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

async function main() {
  console.log("\nFacilities and facility identifiers harness (CPR-PRM-001 s3/s7/s11, migration 222)\n");
  await cleanup();

  const wsA = await provision(OWNER, "HARNESS Facilities A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Facilities B (synthetic)", "b");
  const a = await resolveWorkspaceContext(admin, OWNER, wsA);
  const b = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!a.ok || !b.ok) { ok("workspace contexts resolve", false); return report(); }

  // ── 4. Two spellings of one hospital ───────────────────────────────────────
  const mulago = await addFacility(admin, a.ctx, {
    name: "Mulago National Referral Hospital", facilityType: "hospital", country: "UG",
    correlationId: "harness-fac",
  });
  ok("a facility is added", mulago.ok, mulago.ok ? "" : mulago.message);
  if (!mulago.ok) return report();
  const spellingAgain = await addFacility(admin, a.ctx, {
    name: "  mulago   national referral   hospital ", correlationId: "harness-fac",
  });
  ok("4. TWO SPELLINGS OF ONE HOSPITAL CANNOT BOTH EXIST -- its numbering would split in half",
    !spellingAgain.ok && spellingAgain.code === "ALREADY_EXISTS",
    spellingAgain.ok ? "both were created" : spellingAgain.code);

  const nsambya = await addFacility(admin, a.ctx, {
    name: "Nsambya Hospital", facilityType: "hospital", correlationId: "harness-fac",
  });
  ok("4b. CONTROL: a genuinely different hospital IS added", nsambya.ok, nsambya.ok ? "" : nsambya.message);
  if (!nsambya.ok) return report();

  // ── The fixture ────────────────────────────────────────────────────────────
  const p1 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Achieng Mary", sex: "female", birthDate: "1988-04-04",
    phone: "0772 222 101", ...base,
  });
  const p2 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Opio Samuel", sex: "male", birthDate: "1975-06-06",
    phone: "0772 222 102", ...base,
  });
  ok("two patients register", p1.ok && p2.ok, [p1, p2].map(p => p.ok ? "ok" : p.message).join(" | "));
  if (!p1.ok || !p2.ok) return report();

  // ── 1. The same number at two facilities ───────────────────────────────────
  const atMulago = await addPatientIdentifier(admin, a.ctx, {
    patientId: p1.data.id, identifierType: "hospital_mrn", value: "12345",
    facilityId: (mulago as any).data.id, correlationId: "harness-fac",
  });
  ok("an MRN is recorded at one hospital", atMulago.ok, atMulago.ok ? "" : atMulago.message);
  const sameAtNsambya = await addPatientIdentifier(admin, a.ctx, {
    patientId: p2.data.id, identifierType: "hospital_mrn", value: "12345",
    facilityId: (nsambya as any).data.id, correlationId: "harness-fac",
  });
  ok("1. THE SAME NUMBER AT A DIFFERENT HOSPITAL IS A DIFFERENT NUMBER -- 193 called this a duplicate",
    sameAtNsambya.ok, sameAtNsambya.ok ? "" : sameAtNsambya.message);

  // ── 2. The same number twice at one facility ───────────────────────────────
  const clash = await addPatientIdentifier(admin, a.ctx, {
    patientId: p2.data.id, identifierType: "hospital_mrn", value: " 12 345 ",
    facilityId: (mulago as any).data.id, correlationId: "harness-fac",
  });
  ok("2. THE SAME NUMBER TWICE AT ONE HOSPITAL IS REFUSED -- spacing does not make it a new number",
    !clash.ok && clash.code === "IDENTIFIER_IN_USE", clash.ok ? "it was accepted" : clash.code);
  ok("2b. AND THE OWNER IS NAMED, so the clash can be resolved rather than merely reported",
    !clash.ok && /Achieng Mary/.test(clash.message), clash.ok ? "" : clash.message);

  // ── 3. Both directions of the facility rule ────────────────────────────────
  const mrnNoFacility = await addPatientIdentifier(admin, a.ctx, {
    patientId: p1.data.id, identifierType: "hospital_number", value: "H-900",
    correlationId: "harness-fac",
  });
  ok("3. A HOSPITAL NUMBER WITH NO HOSPITAL IS REFUSED -- it cannot be checked against anything",
    !mrnNoFacility.ok && mrnNoFacility.code === "FACILITY_REQUIRED",
    mrnNoFacility.ok ? "it was accepted" : mrnNoFacility.code);
  const nationalWithFacility = await addPatientIdentifier(admin, a.ctx, {
    patientId: p1.data.id, identifierType: "national_id", value: "CM88888888XYZ",
    facilityId: (mulago as any).data.id, correlationId: "harness-fac",
  });
  ok("3b. AND A NATIONAL ID ISSUED BY A HOSPITAL IS REFUSED TOO -- a country issues those",
    !nationalWithFacility.ok && nationalWithFacility.code === "FACILITY_NOT_APPLICABLE",
    nationalWithFacility.ok ? "it was accepted" : nationalWithFacility.code);
  const nationalOk = await addPatientIdentifier(admin, a.ctx, {
    patientId: p1.data.id, identifierType: "national_id", value: "CM88888888XYZ",
    correlationId: "harness-fac",
  });
  ok("3c. CONTROL: without a facility, the national ID is accepted", nationalOk.ok,
    nationalOk.ok ? "" : nationalOk.message);
  const nationalTwice = await addPatientIdentifier(admin, a.ctx, {
    patientId: p2.data.id, identifierType: "national_id", value: "CM88888888XYZ",
    correlationId: "harness-fac",
  });
  ok("3d. and a national ID is still unique across the whole practice",
    !nationalTwice.ok && nationalTwice.code === "IDENTIFIER_IN_USE");

  // ── 5, 6, 7. Active, historical, and the practice ID ───────────────────────
  const before = await patientIdentifiers(admin, a.ctx, p1.data.id);
  ok("5. STATUS IS DERIVED FROM valid_to, never stored",
    before!.identifiers.every(i => i.status === (i.valid_to ? "historical" : "active")) &&
    before!.active >= 2 && before!.historical === 0,
    JSON.stringify({ a: before!.active, h: before!.historical }));
  ok("5b. and each identifier says whether its kind is facility-issued",
    before!.identifiers.find(i => i.identifier_type === "hospital_mrn")!.facilityScoped === true &&
    before!.identifiers.find(i => i.identifier_type === "national_id")!.facilityScoped === false);
  ok("5c. and a facility-issued one names the facility",
    before!.identifiers.find(i => i.identifier_type === "hospital_mrn")!.facility?.name === "Mulago National Referral Hospital",
    JSON.stringify(before!.identifiers.find(i => i.identifier_type === "hospital_mrn")?.facility));

  // ── 7. THE LEGACY PRACTICE ID STILL CANNOT BE RETIRED ─────────────────────
  //
  // ⚠ THE FIXTURE USED TO GET ONE FOR FREE AND CANNOT ANY MORE, which is why this went red.
  // Migration 289 (CPR-PID-001, FROZEN, owner decision 2026-08-11) stopped issuing P-XXXXXX at
  // registration -- "existing practice ids RETIRE to searchable legacy aliases... New registrations
  // stop issuing them" -- so a patient registered by this harness has a patient_number and no
  // practice_id row at all, and the assertion was reading an absence rather than testing a rule.
  //
  // ⚠ THE RULE IT TESTS IS STILL LIVE, AND DELETING THE ASSERTION WOULD HAVE BEEN THE WRONG READ.
  // Ten of the sixty patients in this database still carry a legacy alias; retireIdentifier still
  // refuses to retire one, and it must, because that alias is the number printed on last year's
  // discharge summary -- the exact case assertion 6 above exists for. So the fixture MINTS one
  // deliberately, which is honest: adding a practice_id today is precisely creating a legacy alias.
  const legacyAlias = await addPatientIdentifier(admin, a.ctx, {
    patientId: p1.data.id, identifierType: "practice_id", value: "P-000777",
    correlationId: "harness-fac",
  });
  ok("7-setup. a legacy practice id can still be recorded on a record that predates the numbering",
    legacyAlias.ok, legacyAlias.ok ? "" : legacyAlias.message);
  const after7 = await patientIdentifiers(admin, a.ctx, p1.data.id);
  const practiceId = after7!.identifiers.find(i => i.identifier_type === "practice_id");
  ok("7. THE LEGACY PRACTICE ID CANNOT BE RETIRED -- it is the number on documents already sent out",
    !!practiceId &&
    !(await retireIdentifier(admin, a.ctx, { id: practiceId.id, correlationId: "harness-fac" })).ok,
    practiceId ? "" : "no practice id was issued");
  // ⚠ THE CONTROL, because 7 is a NEGATIVE and a retire that refused EVERYTHING would satisfy it.
  //
  // ⚠ ON A THROWAWAY IDENTIFIER, ON THE OTHER PATIENT, AND BOTH HALVES OF THAT MATTER. The first
  // version of this control retired p1's national_id -- which assertion 6b counts twenty lines further
  // down, so the control broke it and reported {"a":1,"h":2}. A control that mutates state a later
  // assertion measures is not a control; it is a second fixture nobody declared. p2's identifiers are
  // read only by 6c (its hospital_mrn, which must stay active), so a passport minted here for this one
  // purpose is touched by nothing else in the file.
  const throwaway = await addPatientIdentifier(admin, a.ctx, {
    patientId: p2.data.id, identifierType: "passport", value: "PA-CONTROL-7",
    correlationId: "harness-fac",
  });
  ok("7-control-setup. a throwaway identifier exists to try the verb on",
    throwaway.ok, throwaway.ok ? "" : throwaway.message);
  ok("7-control. and an ordinary identifier IS retirable, so 7 names this type and not the verb",
    throwaway.ok && (await retireIdentifier(admin, a.ctx, { id: throwaway.data.id, correlationId: "harness-fac" })).ok,
    throwaway.ok ? "" : "nothing to try");

  const mrnId = before!.identifiers.find(i => i.identifier_type === "hospital_mrn")!.id;
  const retired = await retireIdentifier(admin, a.ctx, { id: mrnId, correlationId: "harness-fac" });
  ok("6. AN MRN IS RETIRED", retired.ok, retired.ok ? "" : retired.message);
  const after = await patientIdentifiers(admin, a.ctx, p1.data.id);
  ok("6b. AND THE ROW SURVIVES, now historical",
    after!.historical === 1 && after!.identifiers.find(i => i.id === mrnId)!.status === "historical",
    JSON.stringify({ a: after!.active, h: after!.historical }));

  const foundRetired = await findByIdentifier(admin, a.ctx, "12345");
  ok("6c. A RETIRED NUMBER STILL FINDS THE PATIENT -- last year's discharge summary carries last year's number",
    foundRetired.patients.some(p => p.patientId === p1.data.id && p.status === "historical"),
    JSON.stringify(foundRetired.patients.map(p => `${p.displayName}:${p.status}`)));
  ok("6d. and the still-live one at the other hospital is found as active",
    foundRetired.patients.some(p => p.patientId === p2.data.id && p.status === "active"),
    JSON.stringify(foundRetired.patients.map(p => `${p.displayName}:${p.status}`)));
  // AND THE FREED NUMBER CAN BE REISSUED at that facility, which is what retiring is for.
  const reissue = await addPatientIdentifier(admin, a.ctx, {
    patientId: p2.data.id, identifierType: "hospital_mrn", value: "12345",
    facilityId: (mulago as any).data.id, correlationId: "harness-fac",
  });
  ok("6e. and retiring frees the number at that facility for reuse", reissue.ok,
    reissue.ok ? "" : reissue.message);

  // ── 8. Encounter identifiers are separate ──────────────────────────────────
  const enc = await launchEncounter(admin, {
    workspaceId: wsA, patientId: p1.data.id, pathway: "new_walk_in", reasonForVisit: "Review", ...base,
  });
  ok("an encounter launches", enc.ok, enc.ok ? "" : enc.message);
  if (!enc.ok) return report();

  const visit = await addEncounterIdentifier(admin, a.ctx, {
    encounterId: enc.data.id, identifierType: "visit_number", value: "V-2026-0001",
    facilityId: (mulago as any).data.id, correlationId: "harness-fac",
  });
  ok("8. A VISIT NUMBER IS RECORDED AGAINST THE ATTENDANCE, not the person", visit.ok,
    visit.ok ? "" : visit.message);
  const onEncounter = await encounterIdentifiers(admin, a.ctx, enc.data.id);
  ok("8b. and it appears on the encounter", onEncounter.length === 1 && onEncounter[0].value === "V-2026-0001");
  const onPatient = await patientIdentifiers(admin, a.ctx, p1.data.id);
  ok("8c. AND NOT ON THE PATIENT -- a visit number identifies a visit, not a person",
    !onPatient!.identifiers.some(i => i.value === "V-2026-0001"),
    JSON.stringify(onPatient!.identifiers.map(i => i.value)));
  const searchVisit = await findByIdentifier(admin, a.ctx, "v-2026-0001");
  ok("8d. s7's 'search by any facility identifier' finds it -- somebody holding a piece of paper does not know which kind it is",
    searchVisit.encounters.length === 1 && searchVisit.encounters[0].encounterId === enc.data.id &&
    searchVisit.patients.length === 0,
    JSON.stringify({ e: searchVisit.encounters.length, p: searchVisit.patients.length }));
  const visitTwice = await addEncounterIdentifier(admin, a.ctx, {
    encounterId: enc.data.id, identifierType: "visit_number", value: "V-2026-0001",
    facilityId: (mulago as any).data.id, correlationId: "harness-fac",
  });
  ok("8e. and one visit number is used once at a facility",
    !visitTwice.ok && visitTwice.code === "IDENTIFIER_IN_USE");

  // ── 9. Closed, not deleted ─────────────────────────────────────────────────
  const { error: deleteError } = await admin.from("practice_facility")
    .delete().eq("id", (mulago as any).data.id);
  ok("9. THE DATABASE REFUSES TO DELETE A FACILITY THAT IDENTIFIERS POINT AT",
    deleteError !== null, deleteError?.message ?? "the delete succeeded");
  const closed = await closeFacility(admin, a.ctx, { id: (nsambya as any).data.id, correlationId: "harness-fac" });
  ok("9b. CONTROL: it can be closed instead", closed.ok, closed.ok ? "" : closed.message);
  const open = await listFacilities(admin, a.ctx);
  ok("9c. and a closed facility drops out of the list",
    open.length === 1 && open[0].name === "Mulago National Referral Hospital",
    JSON.stringify(open.map(f => f.name)));
  const all = await listFacilities(admin, a.ctx, true);
  ok("9d. but is still there when asked for", all.length === 2, String(all.length));
  ok("9e. and the list says how many numbers each facility accounts for",
    open[0].identifiers >= 1, String(open[0].identifiers));
  const closedFacilityUse = await addPatientIdentifier(admin, a.ctx, {
    patientId: p1.data.id, identifierType: "clinic_number", value: "C-1",
    facilityId: (nsambya as any).data.id, correlationId: "harness-fac",
  });
  ok("9f. and a closed facility cannot issue new numbers",
    !closedFacilityUse.ok && closedFacilityUse.code === "FACILITY_CLOSED");

  // ── 10. Capabilities ───────────────────────────────────────────────────────
  const noLocations = await withoutCapability(wsA, OWNER, "practice.locations.manage");
  const refusedFacility = await addFacility(admin, noLocations, {
    name: "Should Not Land Hospital", correlationId: "harness-fac",
  });
  ok("10. ADDING A FACILITY NEEDS practice.locations.manage",
    !refusedFacility.ok && refusedFacility.code === "FORBIDDEN");
  const stillLists = await listFacilities(admin, noLocations);
  ok("10b. CONTROL: reading them does not -- the refusal is about maintaining, not seeing",
    stillLists.length === 1);
  const noEdit = await withoutCapability(wsA, OWNER, "patient.edit");
  const refusedIdentifier = await addPatientIdentifier(admin, noEdit, {
    patientId: p1.data.id, identifierType: "passport", value: "A1234567", correlationId: "harness-fac",
  });
  ok("10c. and adding an identifier needs patient.edit",
    !refusedIdentifier.ok && refusedIdentifier.code === "FORBIDDEN");

  // ── 11. Cross-workspace isolation ──────────────────────────────────────────
  const crossFacilities = await listFacilities(admin, b.ctx);
  ok("11. ANOTHER PRACTICE SEES NONE OF THIS ONE'S FACILITIES", crossFacilities.length === 0,
    String(crossFacilities.length));
  const crossIdentifier = await addPatientIdentifier(admin, b.ctx, {
    patientId: p1.data.id, identifierType: "hospital_mrn", value: "99999",
    facilityId: (mulago as any).data.id, correlationId: "harness-fac",
  });
  ok("11b. nor can it add an identifier to this one's patient",
    !crossIdentifier.ok && crossIdentifier.code === "NOT_FOUND");
  const crossSearch = await findByIdentifier(admin, b.ctx, "12345");
  ok("11c. and searching that number finds nothing there",
    crossSearch.patients.length === 0 && crossSearch.encounters.length === 0,
    JSON.stringify({ p: crossSearch.patients.length, e: crossSearch.encounters.length }));
  // NON-VACUOUS: workspace B works on its own records.
  const bFacility = await addFacility(admin, b.ctx, {
    name: "Their Own Hospital", correlationId: "harness-fac",
  });
  ok("11d. CONTROL: workspace B manages its own facilities perfectly well", bFacility.ok,
    bFacility.ok ? "" : bFacility.message);

  ok("s7's identifier types are all present",
    ["hospital_mrn", "hospital_number", "clinic_number", "outpatient_number"]
      .every(t => PATIENT_IDENTIFIER_TYPES.some(x => x.key === t)) &&
    ENCOUNTER_IDENTIFIER_TYPES.length >= 5 && FACILITY_TYPES.length >= 6);

  await cleanup();
  return report();
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
