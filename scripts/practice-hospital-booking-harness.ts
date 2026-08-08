/**
 * Multi-hospital booking harness -- migration 228.
 *
 * WHAT IT PROVES:
 *   1. THE LOCATION IS VALIDATED. Booking has written location_id straight through since migration 192,
 *      so another practice's hospital could be named on your appointment. It is refused now.
 *   2. A CLOSED SITE CANNOT BE BOOKED INTO.
 *   3. THE TRAVEL CONFLICT EXISTS AND ONLY BITES ACROSS SITES. 09:00 at Hospital A and 09:30 at
 *      Hospital B do not overlap, so the old double-booking check passed them -- and nobody is in two
 *      hospitals half an hour apart. Back-to-back at the SAME site stays legal.
 *   4. THE BUFFER BELONGS TO THE DESTINATION, and a gap that clears it is allowed.
 *   5. BOOKING INTO A HOSPITAL SURFACES THAT PATIENT'S NUMBER AT THAT HOSPITAL -- and not their number
 *      at a different one. This is the whole point of the feature.
 *   6. A HOSPITAL LINKED TO NO FACILITY SAYS SO rather than showing a blank where a number goes.
 *   7. ONE FACILITY, ONE LOCATION -- two sites cannot both claim to be Mulago.
 *   8. A FACILITY IN ANOTHER PRACTICE CANNOT BE LINKED, which would leak their patient numbering.
 *   9. locationDay REPORTS AN IMPOSSIBLE MOVE that already exists in the diary.
 *  10. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-hospital-booking-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { bookAppointment } from "../src/lib/practice/scheduling";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { addFacility, addPatientIdentifier } from "../src/lib/practice/facilities";
import { purgeWorkspacesOwnedBy } from "./_cleanup";
import {
  bookingLocations, linkLocationToFacility, setTravelBuffer, locationDay,
} from "../src/lib/practice/hospital-booking";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000bb001";
const OTHER = "00000000-0000-4000-8000-0000000bb002";

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
  const { data: req, error } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-hb-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-hb",
  }).select("id").single();
  if (error || !req) throw new Error(`provisioning request refused: ${error?.message ?? "no row"}`);
  const run = await runProvisioning(admin, { id: req.id, target_user_id: user, correlation_id: "harness-hb", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [OWNER, OTHER]) {
    await admin.from("practice_practitioner_identity").delete().eq("user_id", u);
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) {
      await admin.from("practice_patient_identifier").delete().eq("workspace_id", w.id);
      await admin.from("practice_location").update({ facility_id: null }).eq("workspace_id", w.id);
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

/** A time on a fixed future day, in UTC, so the harness never straddles "now". */
const at = (hhmm: string) => {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + 30);
  return `${d.toISOString().slice(0, 10)}T${hhmm}:00.000Z`;
};

async function main() {
  console.log("\n=== MULTI-HOSPITAL BOOKING (migration 228) ===\n");
  await cleanup();

  const wsA = await provision(OWNER, "Dr Hospital A", "a");
  const wsB = await provision(OTHER, "Dr Hospital B", "b");
  const ctxA = await resolveWorkspaceContext(admin, OWNER, wsA);
  const ctxB = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!ctxA.ok || !ctxB.ok) throw new Error("context resolution failed");

  // ---- Two hospitals and a consulting room in practice A ------------------------------------------
  const mk = async (wsId: string, name: string, type: string) => {
    const { data, error } = await admin.from("practice_location")
      .insert({ workspace_id: wsId, name, type, active: true }).select("id").single();
    if (error || !data) throw new Error(`location insert failed: ${error?.message}`);
    return data.id as string;
  };
  const mulago = await mk(wsA, "Mulago Hospital", "hospital");
  const nsambya = await mk(wsA, "Nsambya Hospital", "hospital");
  const room = await mk(wsA, "Kololo consulting room", "clinic");
  const theirs = await mk(wsB, "Their Hospital", "hospital");

  // ---- 1. The location is validated ---------------------------------------------------------------
  const crossTenant = await bookAppointment(admin, {
    workspaceId: wsA, patientName: "Cross Tenant", appointmentType: "hospital_consultation",
    scheduledAt: at("08:00"), locationId: theirs, actorId: OWNER, correlationId: "hb-1",
  });
  ok("1a another practice's location is refused", !crossTenant.ok && crossTenant.code === "NOT_FOUND",
    JSON.stringify(crossTenant));

  const control1 = await bookAppointment(admin, {
    workspaceId: wsA, patientName: "Control One", appointmentType: "hospital_consultation",
    scheduledAt: at("08:00"), locationId: mulago, actorId: OWNER, correlationId: "hb-1c",
  });
  ok("1b CONTROL: our own location books", control1.ok, JSON.stringify(control1));

  // ---- 2. A closed site cannot be booked into -----------------------------------------------------
  const closed = await mk(wsA, "Closed Outreach", "outreach");
  await admin.from("practice_location").update({ active: false }).eq("id", closed);
  const intoClosed = await bookAppointment(admin, {
    workspaceId: wsA, patientName: "Into Closed", appointmentType: "hospital_consultation",
    scheduledAt: at("14:00"), locationId: closed, actorId: OWNER, correlationId: "hb-2",
  });
  ok("2 a closed location is refused", !intoClosed.ok && intoClosed.code === "LOCATION_CLOSED",
    JSON.stringify(intoClosed));

  // ---- 3. The travel conflict, and that it only bites across sites ---------------------------------
  // Control One is 08:00-08:20 at Mulago. 08:30 at Nsambya does not overlap it.
  const acrossSites = await bookAppointment(admin, {
    workspaceId: wsA, patientName: "Across Sites", appointmentType: "hospital_consultation",
    scheduledAt: at("08:30"), locationId: nsambya, actorId: OWNER, correlationId: "hb-3",
  });
  ok("3a a non-overlapping booking at ANOTHER hospital is refused",
    !acrossSites.ok && acrossSites.code === "TRAVEL_CONFLICT", JSON.stringify(acrossSites));

  const sameSite = await bookAppointment(admin, {
    workspaceId: wsA, patientName: "Same Site", appointmentType: "hospital_consultation",
    scheduledAt: at("08:30"), locationId: mulago, actorId: OWNER, correlationId: "hb-3b",
  });
  ok("3b CONTROL: back-to-back at the SAME hospital is allowed", sameSite.ok, JSON.stringify(sameSite));

  // ---- 4. The buffer belongs to the destination, and a clear gap passes -----------------------------
  const buffer = await setTravelBuffer(admin, ctxA.ctx, {
    locationId: nsambya, minutes: 45, actorId: OWNER, correlationId: "hb-4",
  });
  ok("4a the travel buffer is settable", buffer.ok && buffer.data.minutes === 45, JSON.stringify(buffer));

  // Same Site ends 08:50 at Mulago. 09:20 at Nsambya = 30 min gap, under the 45 it now needs.
  const tooTight = await bookAppointment(admin, {
    workspaceId: wsA, patientName: "Too Tight", appointmentType: "hospital_consultation",
    scheduledAt: at("09:20"), locationId: nsambya, actorId: OWNER, correlationId: "hb-4b",
  });
  ok("4b a gap under the destination's buffer is refused",
    !tooTight.ok && tooTight.code === "TRAVEL_CONFLICT", JSON.stringify(tooTight));
  ok("4c the refusal names the minutes and the site",
    !tooTight.ok && /45/.test(tooTight.message) && /Nsambya/.test(tooTight.message), JSON.stringify(tooTight));

  const clearGap = await bookAppointment(admin, {
    workspaceId: wsA, patientName: "Clear Gap", appointmentType: "hospital_consultation",
    scheduledAt: at("09:40"), locationId: nsambya, actorId: OWNER, correlationId: "hb-4c",
  });
  ok("4d CONTROL: a gap that clears the buffer is allowed", clearGap.ok, JSON.stringify(clearGap));

  // ---- 5. Booking into a hospital surfaces that patient's number AT THAT HOSPITAL ------------------
  const fMulago = await addFacility(admin, ctxA.ctx, {
    name: "Mulago Hospital", facilityType: "hospital", correlationId: "hb-5a",
  });
  const fNsambya = await addFacility(admin, ctxA.ctx, {
    name: "Nsambya Hospital", facilityType: "hospital", correlationId: "hb-5b",
  });
  ok("5a facilities created", fMulago.ok && fNsambya.ok, JSON.stringify([fMulago, fNsambya]));
  if (!fMulago.ok || !fNsambya.ok) throw new Error("facility setup failed");

  const linkM = await linkLocationToFacility(admin, ctxA.ctx, {
    locationId: mulago, facilityId: fMulago.data.id, actorId: OWNER, correlationId: "hb-5c",
  });
  const linkN = await linkLocationToFacility(admin, ctxA.ctx, {
    locationId: nsambya, facilityId: fNsambya.data.id, actorId: OWNER, correlationId: "hb-5d",
  });
  ok("5b locations linked to the facilities they are", linkM.ok && linkN.ok, JSON.stringify([linkM, linkN]));

  const pat = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Number Carrier", birthDate: "1990-03-03", phone: "+256700111222",
    actorId: OWNER, correlationId: "hb-5e",
  });
  ok("5c patient registered", pat.ok, JSON.stringify(pat));
  if (!pat.ok) throw new Error("patient setup failed");

  const idM = await addPatientIdentifier(admin, ctxA.ctx, {
    patientId: pat.data.id, identifierType: "hospital_mrn", value: "MUL-88888",
    facilityId: fMulago.data.id, correlationId: "hb-5f",
  });
  const idN = await addPatientIdentifier(admin, ctxA.ctx, {
    patientId: pat.data.id, identifierType: "hospital_mrn", value: "NSA-44444",
    facilityId: fNsambya.data.id, correlationId: "hb-5g",
  });
  ok("5d the same patient carries a number at each hospital", idM.ok && idN.ok, JSON.stringify([idM, idN]));

  const locs = await bookingLocations(admin, ctxA.ctx, pat.data.id);
  const mulagoRow = locs.find(l => l.id === mulago);
  const nsambyaRow = locs.find(l => l.id === nsambya);
  ok("5e Mulago shows the Mulago number",
    mulagoRow?.patientIdentifiers.some(i => i.value === "MUL-88888") === true,
    JSON.stringify(mulagoRow?.patientIdentifiers));
  ok("5f Mulago does NOT show the Nsambya number",
    mulagoRow?.patientIdentifiers.some(i => i.value === "NSA-44444") === false,
    JSON.stringify(mulagoRow?.patientIdentifiers));
  ok("5g Nsambya shows its own number, not Mulago's",
    nsambyaRow?.patientIdentifiers.some(i => i.value === "NSA-44444") === true &&
    nsambyaRow?.patientIdentifiers.some(i => i.value === "MUL-88888") === false,
    JSON.stringify(nsambyaRow?.patientIdentifiers));
  ok("5h a closed location is not offered for booking", !locs.some(l => l.id === closed));

  // ---- 6. An unlinked hospital says why it can show no number -------------------------------------
  const unlinkedHospital = await mk(wsA, "Kisubi Hospital", "hospital");
  const locs2 = await bookingLocations(admin, ctxA.ctx, pat.data.id);
  const kisubi = locs2.find(l => l.id === unlinkedHospital);
  const roomRow = locs2.find(l => l.id === room);
  ok("6a an unlinked hospital explains the blank",
    kisubi?.identifierNote !== null && /not linked/.test(kisubi?.identifierNote ?? ""), kisubi?.identifierNote ?? "null");
  ok("6b a consulting room is not treated as a gap", roomRow?.identifierNote === null, roomRow?.identifierNote ?? "");

  // ---- 7. One facility, one location ---------------------------------------------------------------
  const doubleClaim = await linkLocationToFacility(admin, ctxA.ctx, {
    locationId: unlinkedHospital, facilityId: fMulago.data.id, actorId: OWNER, correlationId: "hb-7",
  });
  ok("7 two locations cannot both claim to be Mulago",
    !doubleClaim.ok && doubleClaim.code === "FACILITY_ALREADY_LINKED", JSON.stringify(doubleClaim));

  // ---- 8. A facility in another practice cannot be linked ------------------------------------------
  const theirFacility = await addFacility(admin, ctxB.ctx, {
    name: "Their Facility", facilityType: "hospital", correlationId: "hb-8",
  });
  if (!theirFacility.ok) throw new Error("their facility setup failed");
  const leak = await linkLocationToFacility(admin, ctxA.ctx, {
    locationId: unlinkedHospital, facilityId: theirFacility.data.id, actorId: OWNER, correlationId: "hb-8b",
  });
  ok("8a another practice's facility cannot be linked", !leak.ok && leak.code === "NOT_FOUND", JSON.stringify(leak));

  const ownLink = await linkLocationToFacility(admin, ctxA.ctx, {
    locationId: unlinkedHospital, facilityId: fNsambya.data.id, actorId: OWNER, correlationId: "hb-8c",
  });
  // Nsambya is taken, so this must be the ALREADY_LINKED refusal -- proving 8a's NOT_FOUND was about
  // tenancy and not about linking being broken outright.
  ok("8b CONTROL: the same call reaches the linking rule for our own facility",
    !ownLink.ok && ownLink.code === "FACILITY_ALREADY_LINKED", JSON.stringify(ownLink));

  // ---- 9. locationDay reports an impossible move already in the diary -------------------------------
  // Force one through: allowOverlap skips the travel check the same way it skips double-booking.
  const forced = await bookAppointment(admin, {
    workspaceId: wsA, patientName: "Forced Move", appointmentType: "hospital_consultation",
    scheduledAt: at("10:05"), locationId: mulago, allowOverlap: true,
    actorId: OWNER, correlationId: "hb-9",
  });
  ok("9a a deliberate override still books", forced.ok, JSON.stringify(forced));

  const day = at("00:00").slice(0, 10);
  const route = await locationDay(admin, ctxA.ctx, `${day}T00:00:00.000Z`, `${day}T23:59:59.999Z`);
  ok("9b the day is grouped into blocks per site", route.blocks.length >= 3,
    JSON.stringify(route.blocks.map(b => `${b.name}@${b.firstAt.slice(11, 16)}`)));
  ok("9c the impossible hop is reported",
    route.impossible.some(m => /Nsambya/.test(m.fromName) && /Mulago/.test(m.toName)),
    JSON.stringify(route.impossible));
  ok("9d consecutive same-site appointments collapse into one block",
    route.blocks.filter(b => b.locationId === mulago).some(b => b.appointmentCount >= 2),
    JSON.stringify(route.blocks.map(b => [b.name, b.appointmentCount])));
  ok("9e the facility name rides along with the block",
    route.blocks.some(b => b.facilityName === "Mulago Hospital"),
    JSON.stringify(route.blocks.map(b => b.facilityName)));

  // ---- 10. Cross-workspace isolation, non-vacuously -------------------------------------------------
  const bLocs = await bookingLocations(admin, ctxB.ctx, pat.data.id);
  ok("10a practice B sees only its own locations",
    bLocs.length > 0 && bLocs.every(l => l.id === theirs), JSON.stringify(bLocs.map(l => l.name)));
  ok("10b practice A's patient carries no number into practice B",
    bLocs.every(l => l.patientIdentifiers.length === 0));
  const aLocs = await bookingLocations(admin, ctxA.ctx, pat.data.id);
  ok("10c CONTROL: practice A does see its own, so 10a is not vacuous", aLocs.length >= 4);

  await cleanup();

  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
