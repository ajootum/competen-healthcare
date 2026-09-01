/**
 * CPR-BOOK-PROFILE-001 -- the public booking profile, against a real database.
 *
 * ⚠ WHAT THIS COVERS THAT THE RENDER TEST CANNOT. ProfileView.test.tsx pins the OUTPUT for a fixture;
 * this pins the PROJECTION for a world that was actually provisioned -- the allowlist over a real
 * object, the four routing outcomes, and the states a fixture cannot honestly manufacture (a handle
 * that resolves to nothing, a read that fails, a practice whose page was never published).
 *
 * ⚠ IT BUILDS ITS OWN WORLD AND PURGES IT. Nothing here addresses the owner's live practice.
 *
 *   npx tsx scripts/practice-public-profile-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { issueIdentity, claimHandle, updateIdentity } from "../src/lib/practice/identity-service";
import { createLocation } from "../src/lib/practice/configuration";
import { saveSession } from "../src/lib/practice/practice-sessions";
import { generateSlots } from "../src/lib/practice/availability-config";
import { saveBookingAccess, setPublishState } from "../src/lib/practice/patient-access";
import {
  publicBookingProfile, profileAvailability, initialsOf, PUBLIC_PROFILE_FIELDS,
} from "../src/lib/practice/public-profile";
import { publicBookingEntry } from "../src/lib/practice/patient-booking";
import { purgeWorkspacesOwnedBy, cleanupOnKill } from "./_cleanup";

/* eslint-disable @typescript-eslint/no-explicit-any */

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

// ⚠ ITS OWN OWNER AND ITS OWN HANDLE. The live practice is being walked by the owner; nothing here
// addresses it.
const OWNER = "00000000-0000-4000-8000-0000000b00f1";
const CORR = "harness-public-profile";
const HANDLE = "harnessprofile";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};
const section = (n: string) => console.log(`\n  -- ${n} --`);

/** A client that refuses one table, so a fail-closed branch can actually be reached. */
function blindTo(table: string, message: string) {
  const result = { data: null, error: { message, code: "XX000" }, count: null };
  const thenable: any = new Proxy(function () {} as any, {
    get(_t, prop) {
      if (prop === "then") return (res: any) => Promise.resolve(result).then(res);
      return () => thenable;
    },
    apply() { return thenable; },
  });
  return new Proxy(admin as any, {
    get(target, prop) {
      if (prop === "from") return (t: string) => (t === table ? thenable : (target as any).from(t));
      return (target as any)[prop];
    },
  });
}

const PAYLOAD: IndividualRequest = {
  displayName: "HARNESS Profile Practice", countryCode: "UG", timezone: "Africa/Kampala",
  professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
  termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
};

async function cleanup() {
  await admin.from("practice_practitioner_identity").delete().eq("user_id", OWNER);
  await admin.from("practice_handle_history").delete().eq("user_id", OWNER);
  await admin.from("practice_booking_access").delete().eq("handle", HANDLE);
  await purgeWorkspacesOwnedBy(admin, [OWNER]);
  await admin.from("provisioning_request").delete().eq("target_user_id", OWNER);
}

async function main() {
  console.log("\nCPR-BOOK-PROFILE-001 -- public booking profile\n");
  cleanupOnKill(async () => { await cleanup(); });
  await cleanup();

  // ── 0. Pure helpers, before any world exists ──────────────────────────────
  section("0. initials (s4's fallback)");
  ok("0a. two words give two letters", initialsOf("Mullen Elisha") === "ME", initialsOf("Mullen Elisha"));
  ok("0b. one word gives one letter", initialsOf("Prince") === "P", initialsOf("Prince"));
  ok("0c. three words take the first and the last", initialsOf("Ada Grace Lovelace") === "AL", initialsOf("Ada Grace Lovelace"));
  // ⚠ NEVER EMPTY. An empty avatar renders as a broken circle, which is the one outcome s17 forbids.
  ok("0d. a name with no letters still yields a mark, never an empty avatar",
    initialsOf("  ").length > 0 && initialsOf("123").length > 0, `[${initialsOf("  ")}][${initialsOf("123")}]`);
  ok("0e. non-Latin letters survive", initialsOf("Ngozi Ọkafor").length === 2, initialsOf("Ngozi Ọkafor"));

  // ── 1. A world ────────────────────────────────────────────────────────────
  const { data: reqRow } = await admin.from("provisioning_request").insert({
    idempotency_key: `${CORR}-${Date.now()}`, request_type: "pilot",
    actor_user_id: OWNER, target_user_id: OWNER, payload_hash: CORR, correlation_id: CORR,
  }).select("id").single();
  const prov = await runProvisioning(admin,
    { id: reqRow!.id, target_user_id: OWNER, correlation_id: CORR, workspace_id: null }, PAYLOAD);
  if (!prov.ok || !prov.workspaceId) { console.error("provisioning failed"); await cleanup(); process.exit(1); }
  const ws = prov.workspaceId;
  const resolvedCtx = await resolveWorkspaceContext(admin, OWNER, ws);
  if (!resolvedCtx.ok) { console.error("ctx failed"); await cleanup(); process.exit(1); }
  const ctx = resolvedCtx.ctx;

  // ⚠ PROVISIONING HAS ALREADY ISSUED AN IDENTITY BY THIS POINT, under the practice's own name -- so
  // issueIdentity is a no-op here and the display name must be SET rather than assumed. The first run
  // of this harness asserted a name nothing had written, which is the fixture-that-cannot-be-trusted
  // shape: it would have passed just as happily against a page showing the wrong person.
  await issueIdentity(admin, { userId: OWNER, displayName: "Amara Nsubuga", correlationId: CORR });
  await updateIdentity(admin, {
    userId: OWNER, displayName: "Amara Nsubuga", qualifications: "MBChB", specialties: "Paediatrics",
    // ⚠ THE FIELD THE PUBLIC PAGE MUST IGNORE (AC-05). Set to exactly the value the owner's live
    // profile carries, so this asserts the real regression rather than a hypothetical one.
    consultationTypes: "All types",
    languages: "English, Luganda", correlationId: CORR,
  });
  await claimHandle(admin, { userId: OWNER, handle: HANDLE, correlationId: CORR });
  // ⚠ AN IDENTITY IS HIDDEN AND 'created' UNTIL SOMEBODY DECIDES OTHERWISE, and resolveHandle is right
  // to answer `none` for both -- which the first run of this harness proved by failing here. A world
  // that skips this step is testing a profile no patient could ever open.
  await updateIdentity(admin, { userId: OWNER, discovery: "link_only", correlationId: CORR });
  await admin.from("practice_practitioner_identity").update({ status: "active" }).eq("user_id", OWNER);

  // ── 2. Routing outcomes (AC-15) ───────────────────────────────────────────
  section("2. routing");
  const unknown = await publicBookingProfile(admin, "nosuchhandleatall");
  ok("2a. an unknown handle is `none`, and discloses nothing else", unknown.kind === "none", unknown.kind);
  const malformed = await publicBookingProfile(admin, "A!!");
  ok("2b. a malformed handle is `none` rather than an error", malformed.kind === "none", malformed.kind);

  // ⚠ A READ THAT FAILED IS NOT A PRACTITIONER WHO DOES NOT EXIST. Serving a 404 to a patient holding
  // a printed card for a live clinician is the defect this state exists to prevent.
  const blind = await publicBookingProfile(blindTo("practice_practitioner_identity", "harness: identity unreadable"), HANDLE);
  ok("2c. AN UNREADABLE STORE IS `unreadable`, NEVER `none`", blind.kind === "unreadable", blind.kind);

  const found = await publicBookingProfile(admin, HANDLE);
  ok("2d. a claimed handle resolves", found.kind === "found", found.kind);
  if (found.kind !== "found") { await cleanup(); process.exit(1); }

  // ── 3. The allowlist (AC-11) ──────────────────────────────────────────────
  section("3. the public field allowlist");
  const keys = Object.keys(found.profile).sort();
  const allowed: string[] = [...PUBLIC_PROFILE_FIELDS].sort();
  ok("3a. the projection carries EXACTLY the allowlisted fields -- no more, no fewer",
    JSON.stringify(keys) === JSON.stringify(allowed),
    `extra=[${keys.filter(k => !allowed.includes(k))}] missing=[${allowed.filter(k => !keys.includes(k))}]`);

  const flat = JSON.stringify(found.profile);
  // ⚠ THE THREE THINGS THAT WERE ON THE LIVE PAGE BEFORE THIS ARC, asserted over the whole serialised
  // object rather than over the fields somebody remembered to check.
  ok("3b. no internal id of any kind is serialised (s14, s15)",
    !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(flat), flat.slice(0, 200));
  ok("3c. the internal CP practitioner number is absent (AC-02)", !/CP-\d{6}-\d/.test(flat));
  // ⚠ NARROWED FROM "no absolute URL at all", WHICH WAS TRUE ONLY UNTIL PHOTOGRAPHS EXISTED. A photo is
  // served from storage and its address is legitimately absolute; what AC-04 forbids is printing the
  // BOOKING address on a page the patient is already reading. The broad version would have failed the
  // first time anybody uploaded a photograph, for a reason that has nothing to do with the rule.
  ok("3d. the booking address is never serialised -- the page links, it does not print it (AC-04)",
    !/https?:\/\/[^"]*\/practice\/book/.test(flat) && !/competenhealthcare\.com/.test(flat),
    flat.match(/https?:\/\/[^"]+/)?.[0] ?? "");
  ok("3e. the identity's free-text consultation field never reaches the projection (AC-05)",
    !/All types/i.test(flat));

  // ── 3f-3h. The photograph (s4, migration 362) ─────────────────────────────
  //
  // ⚠ THESE PASS BOTH BEFORE AND AFTER THE MIGRATION IS APPLIED, deliberately. Migrations here are run
  // by hand, so a harness that only passes afterwards turns a pending owner action into a red build --
  // and a harness that only passes BEFORE would never notice the feature arriving. What is asserted is
  // the invariant that holds either way: no photograph means no photo URL and no <img> anywhere near
  // this projection, and a stored path is composed into exactly one public address.
  ok("3f. a practitioner with no photograph has a null photoUrl, never an empty string",
    found.profile.photoUrl === null, JSON.stringify(found.profile.photoUrl));

  const { error: photoErr } = await admin.from("practice_practitioner_identity")
    .update({ photo_path: "harness-fake.jpg", photo_updated_at: new Date().toISOString() })
    .eq("user_id", OWNER);
  if (photoErr && /photo_path|column/i.test(photoErr.message)) {
    console.log("  SKIP  3g/3h. migration 362 is not applied on this database yet -- the photo columns do not exist");
  } else {
    ok("3g. a stored path becomes exactly one public address, composed from the configured host",
      !photoErr, photoErr?.message ?? "");
    const withPhoto = await publicBookingProfile(admin, HANDLE);
    const url = withPhoto.kind === "found" ? withPhoto.profile.photoUrl : null;
    ok("3h. and the address points at the photographs bucket and the stored object, nothing else",
      typeof url === "string"
      && url.includes("/storage/v1/object/public/practitioner-photos/")
      && url.endsWith("harness-fake.jpg"),
      String(url));
    await admin.from("practice_practitioner_identity")
      .update({ photo_path: null, photo_updated_at: null }).eq("user_id", OWNER);
  }

  // ── 4. Verification: the badge that is NOT built (s4) ─────────────────────
  //
  // ⚠ THE COMP SHOWED A "VERIFIED PRACTITIONER" BADGE AND THIS ARC BUILT IT, until
  // practice-booking-link-harness 5b-tick went red and turned out to be right: identity-service's own
  // NOT_BUILT list records that licence_verified_at is "a provenance record rather than a verification.
  // Nothing here contacts a council." s4 permits the indicator only where the state JUSTIFIES the claim,
  // so the condition is unmet and the badge is not shipped.
  //
  // These assertions therefore pin the ABSENCE, including under the state that would most tempt a future
  // edit: an identity that really has been licence-checked internally.
  section("4. the verified badge is not built");
  ok("4a. no licence or verification field reaches the public projection",
    !Object.keys(found.profile).some(k => /verif|licence|license/i.test(k)),
    Object.keys(found.profile).join(", "));

  // ⚠ THE DATABASE ENFORCES THE WEAKER RULE TOO, and this harness discovered it by being refused:
  // `practice_identity_licence_has_a_verifier` rejects a licence_verified_at with no
  // licence_verified_by, so even the INTERNAL record cannot be a tick with nobody behind it.
  const { error: verifyErr } = await admin.from("practice_practitioner_identity")
    .update({
      licence_verified_at: new Date().toISOString(),
      licence_verified_by: OWNER,
      licence_reference: "harness-ref",
    })
    .eq("user_id", OWNER);
  ok("4b. an internal licence check can be recorded, with its verifier (the constraint holds)",
    !verifyErr, verifyErr?.message ?? "");

  const verified = await publicBookingProfile(admin, HANDLE);
  ok("4c. ⚠ AND EVEN THEN NOTHING ABOUT IT REACHES A PATIENT -- the internal record stays internal",
    verified.kind === "found"
    && !Object.keys(verified.profile).some(k => /verif|licence|license/i.test(k))
    && !/verif|licence|license/i.test(JSON.stringify(verified.profile)),
    verified.kind === "found" ? Object.keys(verified.profile).join(", ") : verified.kind);

  await admin.from("practice_practitioner_identity")
    .update({ licence_verified_at: null, licence_verified_by: null, status: "active" })
    .eq("user_id", OWNER);
  const activeOnly = await publicBookingProfile(admin, HANDLE);
  ok("4d. an ACTIVE identity carries no verification claim either",
    activeOnly.kind === "found"
    && !/verif|licence|license/i.test(JSON.stringify(activeOnly.profile)));

  // ── 5. Booking eligibility (AC-12) ────────────────────────────────────────
  section("5. what the page offers");
  ok("5a. before a page is published, nothing can be booked and there is no path",
    activeOnly.kind === "found" && activeOnly.profile.booking.canBook === false
    && activeOnly.profile.booking.bookingPath === null,
    JSON.stringify(activeOnly.kind === "found" ? activeOnly.profile.booking : {}));
  ok("5b. and the projection says why, in a sentence",
    activeOnly.kind === "found" && !!activeOnly.profile.booking.whyNot,
    activeOnly.kind === "found" ? String(activeOnly.profile.booking.whyNot) : "");
  ok("5c. an unpublished page offers no locations and no consultation types",
    activeOnly.kind === "found" && activeOnly.profile.locations.length === 0
    && activeOnly.profile.consultationTypes.length === 0);

  const loc = await createLocation(admin, {
    workspaceId: ws, name: "Harness Clinic House", type: "clinic",
    actorId: OWNER, correlationId: CORR,
  });
  if (!loc.ok) { console.error("location failed"); await cleanup(); process.exit(1); }
  const tele = await createLocation(admin, {
    workspaceId: ws, name: "Harness Video Clinic", type: "teleconsultation",
    actorId: OWNER, correlationId: CORR,
  });
  if (!tele.ok) { console.error("tele location failed"); await cleanup(); process.exit(1); }

  await saveSession(admin, ctx, {
    weekday: 3, startsMinute: 8 * 60 + 30, endsMinute: 12 * 60 + 30,
    locationId: loc.data.id, sessionName: "Harness Wednesday Clinic",
    bookingMode: "public", appointmentTypes: ["new_consultation", "scheduled_followup"],
    appointmentMinutes: 30, actorId: OWNER, correlationId: CORR,
  } as any);
  await generateSlots(admin, ctx, {
    fromDate: new Date().toISOString().slice(0, 10),
    toDate: new Date(Date.now() + 13 * 86400000).toISOString().slice(0, 10),
    actorId: OWNER, correlationId: CORR,
  });
  await saveBookingAccess(admin, ctx, {
    mode: "public",
    visibleLocationIds: [loc.data.id, tele.data.id],
    visibleAppointmentTypes: ["new_consultation", "scheduled_followup"],
    actorId: OWNER, correlationId: CORR,
  } as any);
  await setPublishState(admin, ctx, {
    to: "published", acceptWarnings: true, actorId: OWNER, correlationId: CORR,
  } as any);

  const open = await publicBookingProfile(admin, HANDLE);
  if (open.kind !== "found") { console.error("open profile failed"); await cleanup(); process.exit(1); }
  ok("5d. a published page with a public clinic can be booked, and carries a path",
    open.profile.booking.canBook === true && !!open.profile.booking.bookingPath,
    JSON.stringify(open.profile.booking));
  ok("5e. the path is a ROUTE, never an absolute address (AC-04)",
    open.profile.booking.bookingPath === `/practice/book/@${HANDLE}/appointment`,
    String(open.profile.booking.bookingPath));

  // ── 5f-5h. The emergency notice (CPR-BOOK-FLOW-002 s8.5, migration 363) ───
  section("5b. the emergency notice");
  {
    const entryBefore = await publicBookingEntry(admin, HANDLE);
    ok("5f. a practice that wrote none carries null -- nothing is composed on its behalf",
      entryBefore.emergencyNotice === null, String(entryBefore.emergencyNotice));

    const OWN = "This clinic does not handle emergencies. For urgent help go to the nearest emergency department.";
    const saved = await saveBookingAccess(admin, ctx, {
      emergencyNotice: OWN, actorId: OWNER, correlationId: CORR,
    } as any);
    ok("5g. a practice's own wording saves", (saved as any).ok, JSON.stringify(saved).slice(0, 120));

    const entryAfter = await publicBookingEntry(admin, HANDLE);
    ok("5h. and reaches the patient page verbatim, never summarised or rewritten",
      entryAfter.emergencyNotice === OWN, String(entryAfter.emergencyNotice));

    // ⚠ CLEARING IT MUST GENUINELY UNSET IT. A blank stored as "" would render an empty amber box on a
    // patient's booking form -- a warning shaped like a warning with nothing in it.
    await saveBookingAccess(admin, ctx, { emergencyNotice: "", actorId: OWNER, correlationId: CORR } as any);
    const entryCleared = await publicBookingEntry(admin, HANDLE);
    ok("5i. clearing it unsets it rather than storing an empty string",
      entryCleared.emergencyNotice === null, JSON.stringify(entryCleared.emergencyNotice));
  }

  // ── 6. Consultation types and mode (AC-05, AC-06) ─────────────────────────
  section("6. what a patient is offered");
  const labels = open.profile.consultationTypes.map(t => t.label);
  ok("6a. types come from the BOOKING PAGE and are named in patient words",
    labels.includes("New patient") && labels.includes("Follow-up") && labels.length === 2, labels.join(","));
  ok("6b. the identity's 'All types' is nowhere near the rendered surface (AC-05)",
    !JSON.stringify(open.profile).includes("All types"));
  const modes = Object.fromEntries(open.profile.locations.map(l => [l.name, l.mode]));
  ok("6c. a clinic is in-person and a teleconsultation location is virtual (AC-06)",
    modes["Harness Clinic House"] === "in_person" && modes["Harness Video Clinic"] === "virtual",
    JSON.stringify(modes));
  // ⚠ THE OPERATIONAL CODE MUST NOT TRAVEL. s8: no internal location ids or operational codes.
  ok("6d. neither the location's kind nor its id is serialised (s8)",
    !JSON.stringify(open.profile.locations).includes("teleconsultation")
    && !JSON.stringify(open.profile.locations).includes(loc.data.id));

  // ── 7. Availability, and its three states (s6, s17) ───────────────────────
  section("7. next available");
  const avail = await profileAvailability(admin, {
    handle: HANDLE, types: open.profile.consultationTypes.map(t => t.code),
  });
  ok("7a. a diary with generated slots reports a real next-available time",
    avail.state === "found" && !!avail.atIso && !!avail.label, JSON.stringify(avail));
  // The label is the practice's own day, not the server's.
  // ⚠ THE ASSERTION THAT WAS WRONG THE FIRST TIME: it rejected any label containing "T" to catch an
  // ISO instant, and "Tomorrow, 08:30" contains one. The thing actually worth asserting is that no ISO
  // timestamp reaches a patient, so that is what is matched.
  ok("7b. the label is a day and a time in words, never an ISO instant",
    !!avail.label && /\d{1,2}:\d{2}/.test(avail.label)
    && !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(avail.label), String(avail.label));

  const noTypes = await profileAvailability(admin, { handle: HANDLE, types: [] });
  ok("7c. nothing offered is `none_in_window`, never a claim that times exist",
    noTypes.state === "none_in_window" && noTypes.atIso === null, JSON.stringify(noTypes));

  // ⚠ A SCAN THAT FAILED IS `unreadable`, AND IT IS NOT `none_in_window`. The two produce opposite
  // sentences on the page -- "there are no times" versus "choose a date" -- and only one of them is a
  // claim. This is the assertion that keeps a failed read from being reported as an empty diary.
  const blindScan = await profileAvailability(
    blindTo("practice_availability_slot", "harness: slots unreadable"),
    { handle: HANDLE, types: open.profile.consultationTypes.map(t => t.code) });
  ok("7d. AN UNREADABLE SCAN IS `unreadable`, NEVER AN EMPTY DIARY",
    blindScan.state === "unreadable", JSON.stringify(blindScan));

  // ⚠ AND ONE FAILED TYPE POISONS THE WHOLE ANSWER. The earliest across the types that happened to
  // answer is not the earliest -- naming it would hide a genuinely earlier time.
  const partial = await profileAvailability(admin, {
    handle: HANDLE, types: [...open.profile.consultationTypes.map(t => t.code), "no_such_type_at_all"],
  });
  ok("7e. a type that cannot be scanned makes the whole answer unreadable rather than partial",
    partial.state === "unreadable", JSON.stringify(partial));

  // ── 8. Paused and unpublished (s17, AC-12) ────────────────────────────────
  section("8. closed states");
  await setPublishState(admin, ctx, { to: "paused", actorId: OWNER, correlationId: CORR } as any);
  const paused = await publicBookingProfile(admin, HANDLE);
  ok("8a. a paused page cannot be booked and offers no path",
    paused.kind === "found" && paused.profile.booking.canBook === false
    && paused.profile.booking.bookingPath === null);
  ok("8b. and it says so in the patient's words rather than falling silent",
    paused.kind === "found" && !!paused.profile.booking.whyNot,
    paused.kind === "found" ? String(paused.profile.booking.whyNot) : "");
  ok("8c. a closed page still renders the practitioner -- the person is not the booking",
    paused.kind === "found" && paused.profile.displayName === "Amara Nsubuga"
    && paused.profile.specialty === "Paediatrics");

  console.log(`\n  ${pass} passed, ${fails.length} failed`);
  for (const f of fails) console.log(`   - ${f}`);
  await cleanup();
  console.log("  cleaned up.\n");
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
