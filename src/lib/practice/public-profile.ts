import { resolveHandle, bookingPath } from "@/lib/practice/identity-service";
import { publicBookingEntry, nextAvailableDates } from "@/lib/practice/patient-booking";
import { appointmentTypeLabel } from "@/lib/practice/practice-session-constants";
import { practiceToday } from "@/lib/practice/practice-time";
import { photoUrl } from "@/lib/practice/practitioner-photo";
import { formatTime } from "@/lib/datetime";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-BOOK-PROFILE-001 s14 -- THE PUBLIC PROJECTION. One function, one allowlist, two renderers.
//
// The public page used to compose itself from two reads at the screen: publicView(identity) for the
// person and publicBookingEntry() for the booking. That is how a public page acquires a field nobody
// approved -- the practitioner's CP number and the raw booking URL were both on it, not because anyone
// decided they should be, but because they were in an object the screen already had.
//
// So the projection is now the boundary. What is not on this DTO cannot reach a patient's browser, and
// the field list is exported as data so a test can assert the whole surface rather than the fields
// somebody remembered to check.
//
// ---- WHAT IS DELIBERATELY NOT HERE -----------------------------------------------------------------
//
//   practitionerNumber  s4: the internal CP identifier must not appear in the primary patient UI. It is
//                       not narrowed or masked here -- it is absent, because a field that is absent
//                       cannot be rendered by the next person who adds a line to the page.
//   bookingUrl          s5/AC-04: the patient is ALREADY at that address. Printing it is practitioner
//                       tooling, and it lives in Practice Setup where the sharing tools are.
//   location ids        s8: the booking journey needs a location handle and re-validates it server-side
//                       (submitBookingRequest refuses one that was never offered), so the wizard's own
//                       read carries ids. The PROFILE does not, because nothing on it needs one.
//   workspace id,       s15: nothing about the practice's internal records is a patient's business, and
//   user id             the two ids are how every other leak in this codebase started.
//
// ---- AND WHAT IS HERE ONLY WHEN IT IS TRUE ---------------------------------------------------------
//
// `verified` is the one field on this DTO that makes a claim ABOUT a person rather than describing what
// they offer, so it is the one with a rule rather than a value: see VERIFICATION below.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ THE ALLOWLIST, AS DATA. s14: "Only fields approved for public display may enter the public
 * projection." A comment saying so is a wish; this is checked, because public-profile.test.ts asserts
 * that the object this module builds has these keys and no others.
 */
export const PUBLIC_PROFILE_FIELDS = [
  "handle", "displayName", "initials", "photoUrl", "credentials", "specialty", "subSpecialty",
  "bio", "languages", "practiceName", "locations", "consultationTypes",
  "booking", "availabilityNote", "help", "privacyNotice", "instructions",
] as const;

export type PublicProfileLocation = { name: string; mode: "in_person" | "virtual" };
export type PublicProfileType = { code: string; label: string };

/**
 * ⚠ THREE STATES, AND THE MIDDLE ONE IS THE POINT.
 *
 * s6: "Never cache or fabricate a slot in a way that could mislead the patient", and s17: "No
 * availability -> explain that no online times are currently available; do not imply a system failure."
 * Those are two different sentences and they need two different states behind them, because a scan that
 * FAILED and a scan that found NOTHING are not the same fact:
 *
 *   found          a real slot, from the engine, computed now. The only state that may name a time.
 *   none_in_window nothing bookable inside the engine's own scan window. A true, useful sentence.
 *   unreadable     nobody knows. The patient is offered the calendar and told nothing either way --
 *                  never "no times available", which would be a claim this state did not establish.
 */
export type PublicProfileAvailability = {
  state: "found" | "none_in_window" | "unreadable";
  /** Populated for `found` only. The instant, so a screen never re-derives one. */
  atIso: string | null;
  /** "Tomorrow, 10:30 am" -- already in the PRACTICE's timezone, so no browser has to guess. */
  label: string | null;
};

export type PublicBookingProfile = {
  handle: string;
  displayName: string;
  /** s4's fallback when there is no photograph. Composed here so both renderers agree on it. */
  initials: string;
  /**
   * s4's optional photograph, as a public address. Null is the ordinary case and renders as initials --
   * s17: "No photo -> use initials/avatar fallback; do not show broken image."
   */
  photoUrl: string | null;
  credentials: string | null;
  specialty: string | null;
  subSpecialty: string | null;
  bio: string | null;
  languages: string | null;
  /** What the practice calls itself on its own booking page, where it chose a name. */
  practiceName: string | null;
  locations: PublicProfileLocation[];
  consultationTypes: PublicProfileType[];
  booking: {
    state: "open" | "closed" | "unreadable";
    canBook: boolean;
    canRequestWithoutCode: boolean;
    requestNote: string | null;
    /** One sentence, true today, whenever neither offer stands. */
    whyNot: string | null;
    /** ⚠ A ROUTE, NOT A URL. s5/AC-04 -- the page links, it does not print an address. */
    bookingPath: string | null;
  };
  /**
   * ⚠ AVAILABILITY IS NOT ON THIS OBJECT, AND THAT IS A PERFORMANCE DECISION WITH A MEASUREMENT BEHIND
   * IT. One slot scan costs the same as five run in parallel -- measured at ~3s each against the live
   * database from a developer machine, and identical for a 14-day and a 120-day window -- because the
   * cost is round trips, not arithmetic. Blocking the whole page on it put the practitioner's NAME
   * behind a diary scan.
   *
   * So the scan is `profileAvailability()`, awaited inside a <Suspense> boundary: identity and the
   * booking button render immediately, the next-available shortcut arrives when it is known. Nothing is
   * cached and nothing is guessed -- s6's rule is about fabricating slots, not about when a true one is
   * painted. (Next 16 serves bots the fully-resolved page, so indexing is unaffected.)
   *
   * s17's soft note DOES travel here, because it is a fact about the practice's configuration rather
   * than about the diary, and it must not wait behind a scan it has nothing to do with.
   */
  availabilityNote: string | null;
  /** s15: the practice's OWN published contacts (migration 291), never a private staff address. */
  help: { email: string | null; phone: string | null };
  privacyNotice: string | null;
  instructions: string | null;
};

/**
 * ⚠ THERE IS NO `verified` FIELD ON THIS PROJECTION, AND THAT IS A RULING RATHER THAN AN OMISSION.
 *
 * CPR-BOOK-PROFILE-001 s4 permits a "Verified practitioner" indicator "only if CP has a canonical
 * verification state THAT JUSTIFIES THE CLAIM", and the comp that came with the spec showed the badge
 * under a real clinician's name. This build shipped it for exactly as long as it took a harness to
 * disagree: practice-booking-link-harness 5b-tick went red, and it was right.
 *
 * What this product holds is `licence_verified_at` beside `licence_verified_by` -- and identity-service's
 * own NOT_BUILT list already describes what that is: "a provenance record rather than a verification.
 * Nothing here contacts a council." A blue tick beside a clinician's name tells a patient a REGULATOR
 * was checked. Nothing in this deployment has ever checked one, so the state does not justify the claim
 * and s4's own condition is unmet.
 *
 * Two things follow, and both are deliberate:
 *   - the projection carries no licence field at all, so no screen can render a badge by accident;
 *   - turning it on later is not a UI change. It needs a real verification behind it, and it is the
 *     owner's decision, taken with the council-integration work s14 defers.
 *
 * The schema, for its part, already refuses the weaker version: `practice_identity_licence_has_a_verifier`
 * rejects a licence_verified_at with no licence_verified_by, so even the internal record cannot be a tick
 * with nobody behind it.
 */

/**
 * s4's initials fallback. Two letters at most, from the first and last words of the display name.
 *
 * ⚠ IT NEVER RETURNS EMPTY. A blank avatar reads as a broken image, which is the one outcome s17 names
 * ("do not show broken image"), so a name that yields no letters falls back to a person glyph.
 */
export function initialsOf(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(w => /[\p{L}]/u.test(w));
  if (words.length === 0) return "·";
  const first = [...words[0]].find(c => /[\p{L}]/u.test(c)) ?? "";
  const last = words.length > 1
    ? [...words[words.length - 1]].find(c => /[\p{L}]/u.test(c)) ?? ""
    : "";
  return (first + last).toUpperCase() || "·";
}

/**
 * "Tomorrow, 10:30 am", in the practice's own day.
 *
 * ⚠ THE DAY WORDS ARE COMPUTED AGAINST THE PRACTICE'S TODAY, NOT THE SERVER'S. A practice in Kampala
 * and a server in Cleveland disagree about what "tomorrow" means for eight hours of every day, and this
 * codebase has already paid for that mistake once (see practice-time.ts). practiceToday is the only
 * function allowed to answer the question.
 */
function whenLabel(atIso: string, timezone: string): string {
  const today = practiceToday(timezone);
  const tomorrow = practiceToday(timezone, new Date(Date.now() + 86400000));
  const day = practiceToday(timezone, new Date(atIso));
  const time = formatTime(atIso, timezone);
  if (day === today) return `Today, ${time}`;
  if (day === tomorrow) return `Tomorrow, ${time}`;
  let date: string;
  try {
    date = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, weekday: "long", day: "numeric", month: "long",
    }).format(new Date(atIso));
  } catch {
    date = day;
  }
  return `${date}, ${time}`;
}

/**
 * The earliest bookable time across everything this page offers.
 *
 * ⚠ EVERY OFFERED TYPE IS ASKED, AND THE EARLIEST WINS. A page that offers five kinds of appointment
 * and computes "next available" from one of them is showing a shortcut that is wrong for the other
 * four -- and wrong in the direction that matters, because it hides earlier times.
 *
 * ⚠ ONE FAILED SCAN POISONS THE ANSWER, DELIBERATELY. If any type could not be read, the earliest
 * across the rest is not the earliest -- it is the earliest of what happened to answer. Naming a later
 * time as "next available" is precisely the misleading shortcut s6 forbids, so a partial read reports
 * `unreadable` and the page offers the calendar instead of a claim.
 */
export async function profileAvailability(admin: any, args: {
  handle: string; types: string[];
}): Promise<PublicProfileAvailability> {
  const nothing = (state: PublicProfileAvailability["state"]): PublicProfileAvailability =>
    ({ state, atIso: null, label: null });

  if (args.types.length === 0) return nothing("none_in_window");

  const fromIso = new Date().toISOString();
  const scans = await Promise.all(args.types.map(appointmentType =>
    nextAvailableDates(admin, { handle: args.handle, appointmentType, fromIso, limit: 1 })
      .catch(() => ({ ok: false as const, status: 503, code: "THREW", message: "the scan did not complete" }))));

  // ⚠ A REFUSAL IS NOT AN EMPTY DIARY. Both arrive as "no dates" if the code is careless enough to read
  // only `.data`, and the two produce opposite sentences on the page.
  if (scans.some(s => !s.ok)) return nothing("unreadable");

  let best: { atIso: string; timezone: string } | null = null;
  for (const scan of scans) {
    if (!scan.ok) continue;
    const first = scan.data.dates[0];
    if (!first) continue;
    if (!best || first.firstFreeAt < best.atIso)
      best = { atIso: first.firstFreeAt, timezone: scan.data.timezone };
  }

  if (!best) return nothing("none_in_window");
  return { state: "found", atIso: best.atIso, label: whenLabel(best.atIso, best.timezone) };
}

/**
 * THE ONE READ BOTH RENDERERS USE (s13: "Preview must use the same rendering/data contract as the
 * public page to prevent configuration/preview drift").
 *
 * Returns the same four outcomes resolveHandle does, because a profile cannot be more certain than the
 * handle behind it: a database that would not answer is not a practitioner who does not exist.
 */
export async function publicBookingProfile(admin: any, rawHandle: string): Promise<
  /**
   * ⚠  SITS BESIDE THE PROFILE, NEVER INSIDE IT. The public projection is allowlisted and
   * a harness asserts its key set exactly; an internal id in there would be the leak this whole module
   * exists to prevent. But a SERVER-side caller legitimately needs one -- s19 counts a page view against
   * a practice -- so it travels one level up, where nothing serialises it to a browser.
   */
  | { kind: "found"; profile: PublicBookingProfile; workspaceId: string | null }
  | { kind: "redirect"; to: string }
  | { kind: "none" }
  | { kind: "unreadable"; reason: string }
> {
  const resolved = await resolveHandle(admin, rawHandle);
  if (resolved.kind !== "found") return resolved;
  const p = resolved.profile;
  if (!p.handle) return { kind: "none" };

  const entry = await publicBookingEntry(admin, p.handle);

  // ⚠ CANONICAL TYPES, NEVER THE IDENTITY'S FREE TEXT. AC-05, and it is not hypothetical: the owner's
  // own live profile carries consultation_types = "All types", which was being rendered to patients as
  // this practitioner's list of consultations. The booking page's visible_appointment_types is what a
  // patient may actually choose, and appointmentTypeLabel is the patient word for each one.
  const consultationTypes: PublicProfileType[] = entry.state === "open"
    ? entry.appointmentTypes.map(code => ({ code, label: appointmentTypeLabel(code) }))
    : [];

  const locations: PublicProfileLocation[] = entry.state === "open"
    ? entry.locations.map(l => ({ name: l.name, mode: l.mode }))
    : [];

  return {
    kind: "found",
    workspaceId: entry.workspaceId,
    profile: {
      handle: p.handle,
      displayName: p.displayName,
      initials: initialsOf(p.displayName),
      // ⚠ THE ADDRESS IS COMPOSED HERE AND NOWHERE ELSE, from the stored path. A screen that built it
      // from the path itself would be a second construction of the same URL -- the mistake the booking
      // link already taught this codebase.
      photoUrl: photoUrl(p.photoPath),
      credentials: p.qualifications ?? null,
      specialty: p.specialties ?? null,
      subSpecialty: p.subSpecialty ?? null,
      bio: p.biography ?? null,
      languages: p.languages ?? null,
      practiceName: entry.displayName,
      locations,
      consultationTypes,
      booking: {
        state: entry.state,
        canBook: entry.canBook,
        canRequestWithoutCode: entry.canRequestWithoutCode,
        requestNote: entry.requestNote,
        whyNot: entry.whyNot,
        bookingPath: entry.canBook || entry.canRequestWithoutCode
          ? `${bookingPath(p.handle)}/appointment`
          : null,
      },
      // s17's soft state belongs to the practice's CONFIGURATION rather than to the diary scan -- the
      // page is open, and no clinic's governing rule offers times beyond internal. It travels with the
      // profile so it renders immediately, not with the scan it has nothing to do with.
      availabilityNote: entry.availability.patientNote,
      help: { email: entry.fallbackEmail, phone: entry.fallbackPhone },
      privacyNotice: entry.privacyNotice,
      instructions: entry.instructions,
    },
  };
}
