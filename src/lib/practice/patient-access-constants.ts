// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-V5-007 PHASE 4 -- PATIENT BOOKING ACCESS. The constants half.
//
// s19's Phase 4 is five things: "Handle, link-only page, OTP, registration intake, confirmation", with
// the exit condition "PATIENTS CAN SECURELY REQUEST/BOOK ELIGIBLE APPOINTMENTS".
//
// ⚠ FOUR OF THOSE FIVE ARE NOT IN THIS BUILD, AND THE FIFTH CANNOT COMPLETE. This file is where that is
// written down as DATA rather than as prose in a comment, so the engine, the patient-facing page and the
// harness all read the same list and cannot drift from each other.
//
//   handle              needs a store. Not written here -- migrations are somebody else's to write.
//   link-only page      needs the handle. A page nobody can address is a page with no visitors.
//   OTP                 EXISTS (migration 224, messaging.ts) and is hardened by this phase -- but see
//                       DELIVERY below, which is why it can never be completed by a patient today.
//   registration intake needs a store.
//   confirmation        needs delivery.
//
// ---- ⚠ DELIVERY IS THE BLOCKER THAT OUTRANKS ALL THE OTHERS ---------------------------------------
//
// A patient-facing OTP is a code sent to a phone or an inbox. This deployment configures no SMS gateway
// and no mail provider (messagingStatus() reads the environment and finds none), and every practice's
// message channel is off by default. issueOtp is right to refuse in that state -- "A CODE THAT COULD NOT
// BE SENT IS NOT A CODE" -- and it does. The consequence is not a degraded patient booking flow: it is
// NO patient booking flow, because there is no step after "enter the code we did not send you".
//
// So the door stays shut, and this file names the reason rather than letting a screen imply the feature
// is coming along nicely. INTAKE_NOT_BUILT below is deliberately a fact about the BUILD rather than
// about the deployment, so that configuring a gateway tomorrow does not silently open a door with
// nothing behind it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * s8's four access modes, verbatim in meaning.
 *
 * `reachable` is what THIS BUILD can honour, and it is false for every mode that implies a patient can
 * arrive. Recorded as a choice, rendered as not-yet-built -- the position BOOKING_MODES already takes on
 * `link_only` and `public` sessions, for the same reason.
 */
export const PATIENT_ACCESS_MODES = [
  {
    code: "internal_only", label: "Internal only",
    description: "Only you and authorised staff can create bookings.",
    reachable: true,
    note: "This is what every practice is on today, whether or not anybody chose it.",
  },
  {
    code: "link_only", label: "Link only",
    description: "Accessible only through the booking URL you share.",
    // ⚠ TRUE NOW. It read false while the handle, the page and the intake did not exist. All three do.
    reachable: true,
    note: "s8 recommends this as the first patient-facing mode. It works: the handle is claimed in Practice Setup, and the page publishes once the database is satisfied. A patient still cannot finish without a channel that can send the code.",
  },
  {
    code: "public", label: "Public",
    description: "A discoverable booking page, where product policy permits.",
    // ⚠ TRUE AS A BUILD FACT, WHICH IS WHAT THIS FIELD MEANS. Whether a practice SHOULD choose it is a
    // product judgement and stays in the note, where it is advice rather than a broken switch.
    reachable: true,
    note: "Recommended only after link-only has been run with real patients. Nothing stops it: the page is governed by the same publish constraint either way.",
  },
  {
    code: "paused", label: "Paused",
    description: "Existing bookings remain; no new patient-facing requests are accepted.",
    // ⚠ TRUE NOW: setPublishState pauses a live page, and resolveBookingPage refuses to resolve a paused
    // one. It was meaningless only while nothing could be published in the first place.
    reachable: true,
    note: "A paused page stops resolving for patients and keeps the bookings already made.",
  },
] as const;

export type PatientAccessMode = (typeof PATIENT_ACCESS_MODES)[number]["code"];

/** The modes this build can actually honour. Everything else is stored, shown, and said to be shut. */
export const PATIENT_ACCESS_MODES_REACHABLE: string[] =
  PATIENT_ACCESS_MODES.filter(m => m.reachable).map(m => m.code);

export const patientAccessMode = (code: string) =>
  PATIENT_ACCESS_MODES.find(m => m.code === code) ?? null;

/**
 * The launch flag. ⚠ ABSENT FROM practice_platform_flags, WHICH IS HOW IT DEFAULTS TO OFF.
 *
 * platformFlag() returns false for a flag with no row, so the default is off without anything having to
 * remember to write `enabled: false` -- and turning it on is an INSERT written by whoever writes
 * migrations, not a toggle in a UI. practice_sign_in and practice_public_signup are live flags on live
 * pages; this one is deliberately not reachable by the same PATCH endpoint yet, because there is nothing
 * behind it worth flipping.
 */
export const PATIENT_BOOKING_FLAG = "practice_patient_booking";

/**
 * ⚠ EVERY CAPABILITY CODE THIS AREA NAMES, AS AN EXPORTED ARRAY.
 *
 * The audit harness scans source for capability codes written as inline double-quoted literals inside
 * requirePracticeContext(...) / hasCapability(...) / capabilities.includes(...). A code introduced
 * through a constants object is INVISIBLE to that scan -- so it would never be checked against
 * practice_role_capabilities, which is exactly how six invented codes have shipped here already.
 *
 * Exporting the array lets the harness assert these against the live catalogue directly. Both are real:
 * probed against the 47 seeded codes rather than remembered.
 */
export const PATIENT_ACCESS_CAPABILITIES: string[] = [
  // Configuring who may reach the practice from outside is the same decision as configuring the
  // timezone or the AI disclosure: it changes what the practice exposes. Same capability, s14's
  // "Publish booking page -- account owner: yes; authorised staff: explicit permission only".
  "practice.settings.manage",
  // Making the booking itself, once a patient-facing request arrives. s14's "Create booking".
  "appointment.manage",
];

/**
 * The stores Phase 4 needs and this build does not have.
 *
 * ⚠ THIS IS NOT A WISHLIST -- the engine PROBES for these, so `present` is read from the live database
 * rather than asserted here. Naming them in one place means the report, the gate and the harness cannot
 * disagree about what is missing.
 */
export const PATIENT_ACCESS_STORES = [
  {
    table: "practice_booking_access",
    holds: "s12's BookingAccessProfile: the practitioner handle, the access mode, branding, the privacy notice and the publish state.",
    whyItMatters: "Without a handle there is no URL a patient can be given, so there is no link-only page to build.",
  },
  {
    table: "practice_booking_request",
    holds: "s12's BookingRequest: a patient-submitted request before it becomes an appointment, with the intake fields s9 lists and the applied rule id and version.",
    whyItMatters: "A patient booking is not an appointment until it is accepted; writing one straight into practice_appointment would put an unverified stranger in a clinician's diary.",
  },
  {
    table: "practice_patient_session",
    holds: "A verified patient's session: the OTP challenge it came from, its expiry, and nothing else.",
    whyItMatters: "A patient session must not be a practitioner session. Reusing the platform auth token would give a patient an identity the practice shell knows how to let in.",
  },
] as const;

/**
 * The reasons patient booking is shut, as codes.
 *
 * ORDERED. The delivery channel comes first because it is the one a practice cannot fix by configuring
 * anything, and a list that buried it under "you have not chosen a mode yet" would send somebody off to
 * choose a mode that changes nothing.
 */
export const PATIENT_ACCESS_BLOCKERS = [
  {
    code: "DELIVERY_CHANNEL_ABSENT",
    severity: "blocker",
    headline: "There is no way to send a patient a code.",
    detail:
      "Patient booking is protected by a one-time code sent to the patient's phone or inbox. This deployment has no SMS gateway and no mail provider configured, so there is nothing to send it with -- and a code that cannot be sent is not a code. Nothing here writes a code to the screen or returns it in a response instead.",
  },
  {
    code: "INTAKE_NOT_BUILT",
    severity: "blocker",
    headline: "The patient-facing intake is not built in this release.",
    detail:
      "s19's Phase 4 asks for a handle, a link-only page, registration intake and confirmation. The stores those need are not in this build, so there is no place for a patient's answers to go. This is a fact about the code, not about your configuration -- configuring a gateway will not open it.",
  },
  {
    code: "ACCESS_PROFILE_STORE_ABSENT",
    severity: "blocker",
    headline: "This practice has no booking handle.",
    detail:
      "s8.1 gives each practitioner their own handle and URL. The store that would hold it does not exist, so there is no address a patient could be given.",
  },
  {
    code: "FLAG_OFF",
    severity: "blocker",
    headline: "Patient booking is switched off for this deployment.",
    detail:
      "The launch flag that governs the patient-facing surface is off. It is off by default and turning it on is a deliberate act.",
  },
  {
    code: "NO_BOOKABLE_SESSION",
    severity: "blocker",
    headline: "No session is marked as patient-bookable.",
    detail:
      "s10.2 requires at least one bookable session before a booking page may be published. Sessions are opened one at a time, on purpose -- defaulting them to bookable would publish a ward round.",
  },
  {
    code: "NO_PATIENT_RULE",
    severity: "warning",
    headline: "No booking rule mentions patient self-booking.",
    detail:
      "s7.3 makes the channel part of a rule's scope, so a patient booking would be decided by whichever wider rule happens to cover it. That is legal, and it is worth knowing before it decides anything.",
  },
  {
    code: "READ_FAILED",
    severity: "blocker",
    headline: "Something needed to answer this could not be read.",
    detail:
      "A failed read is not an empty answer. Patient booking stays shut until whatever could not be read can be.",
  },
] as const;

export type PatientAccessBlockerCode = (typeof PATIENT_ACCESS_BLOCKERS)[number]["code"];

export const patientAccessBlocker = (code: string) =>
  PATIENT_ACCESS_BLOCKERS.find(b => b.code === code) ?? null;

/** The codes that shut the door, as opposed to the ones that are merely worth saying. */
export const PATIENT_ACCESS_BLOCKING_CODES: string[] =
  PATIENT_ACCESS_BLOCKERS.filter(b => b.severity === "blocker").map(b => b.code);

/**
 * ⚠ THE BLOCKERS NO CONFIGURATION CAN CLEAR. EMPTY NOW, AND THAT IS THE POINT.
 *
 * It held INTAKE_NOT_BUILT for as long as that was true: s19's Phase 4 asks for a handle, a link-only
 * page, registration intake and confirmation, and the last two did not exist, so no amount of
 * configuration could open the door.
 *
 * All four exist now -- the handle is claimed in Practice Setup, migration 254's stores landed,
 * patient-booking.ts carries the intake and the confirmation, and booking-rules.ts gives the
 * patient_self channel a door guarded by a verified session rather than by a capability. So the list is
 * empty, and the door WILL open once a practice is configured for it.
 *
 * ⚠ WHAT STOPS IT TODAY IS DELIVERY_CHANNEL_ABSENT, WHICH IS A FACT ABOUT THE DEPLOYMENT RATHER THAN
 * ABOUT THE CODE. There is no SMS gateway and no mail provider, so no code can be sent and no patient
 * can complete a verification. That is a configuration somebody can change, and when they do, patient
 * booking starts working -- which is exactly what an empty list here means and why it must not be
 * padded to keep an old assertion passing.
 */
export const PATIENT_ACCESS_BUILD_BLOCKERS: string[] = [];

/**
 * The address a practice falls back to when its diary has nothing to offer, until it sets its own.
 *
 * The owner chose it, 2026-08-12. ONE constant, so migration 291's backfill and the seed applied when
 * a booking page is created cannot drift apart -- a default applied once in a migration is a default
 * that stops applying the next day, which the harness proved within minutes of 291 landing.
 */
export const BOOKING_FALLBACK_EMAIL = "competenhealth@gmail.com";
