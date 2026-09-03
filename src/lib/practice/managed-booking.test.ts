/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 * CPR-BOOK-MGMT-006 §23 -- THE MINIMUM AUTOMATED TEST MATRIX, less the two rows already held elsewhere.
 *
 *   Select earlier slot other location   reschedule-crosslocation.test.ts
 *   New slot taken before commit         reschedule-crosslocation.test.ts
 *   Add to calendar                      calendar-invite.test.ts
 *
 * ⚠ WHAT A FAKE DATABASE CAN AND CANNOT PROVE, said once here rather than hedged in every test below.
 *
 * These are unit tests over the manage engines with a table-dispatch fake. They prove what each engine
 * ASKS the database to do, and what it tells the patient. They cannot prove the database did it: "the
 * slot was released" is migration 255's partial exclusion constraint, and "the row really changed" is a
 * write. Those are proven against a real Supabase in scripts/practice-patient-manage-harness.ts, which
 * books, moves and cancels for real and then re-reads the offer to show the freed time come back.
 *
 * The division is deliberate rather than convenient. The harness needs credentials and a live database,
 * so it is not what CI runs on every push; these are, and they are the layer that catches a refusal
 * turning into a permission, a location being dropped from a write, or a screen claiming a message was
 * sent when nothing was.
 * ════════════════════════════════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fakeAdmin, buildWorld, HANDLE, TOKEN, REFERENCE, APPT_ID, PATIENT_EMAIL,
  TMR, NSAMBYA, CURRENT_AT, NOW, WS,
  appointment, bookingRequest, session, challenge, nsambyaSession,
} from "./manage-fixture";

const rescheduleAppointment = vi.fn();
const transitionAppointment = vi.fn();
const publicBookingNotice = vi.fn();
const recordCancellation = vi.fn();
const audit = vi.fn();

// ⚠ EVERY ONE OF THESE IS PARTIAL. Only the four functions that WRITE or SEND are replaced; the state
// machine, APPOINTMENT_TRANSITIONS, the availability engine and the rule ladder all stay real, so
// nothing below can pass by having removed the rule it claims to exercise.
vi.mock("@/lib/practice/scheduling", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/practice/scheduling")>()),
  rescheduleAppointment: (...a: unknown[]) => rescheduleAppointment(...a),
  transitionAppointment: (...a: unknown[]) => transitionAppointment(...a),
}));
vi.mock("@/lib/practice/messaging", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/practice/messaging")>()),
  publicBookingNotice: (...a: unknown[]) => publicBookingNotice(...a),
}));
vi.mock("@/lib/practice/booking-cancellation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/practice/booking-cancellation")>()),
  recordCancellation: (...a: unknown[]) => recordCancellation(...a),
}));
vi.mock("./audit", () => ({ audit: (...a: unknown[]) => audit(...a) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(NOW) });
  // The defaults are the SUCCESS path, so a test that cares about a failure has to say so and cannot
  // get one by forgetting to set it up.
  transitionAppointment.mockResolvedValue({ ok: true, data: { status: "CANCELLED" } });
  recordCancellation.mockResolvedValue({ stored: true });
  publicBookingNotice.mockResolvedValue({
    appointmentId: APPT_ID, purpose: "appointment_cancelled", notAttempted: null,
    attempted: { kind: "email", status: "handed_over", messageId: "m-1" },
  });
});
afterEach(() => { vi.useRealTimers(); });

const open = () => fakeAdmin(buildWorld());

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// ROW: Open valid confirmed appointment -> "Confirmed state with complete appointment details."
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe("§23 -- opening a valid confirmed appointment", () => {
  it("returns every field the confirmed state has to render, from stored data", async () => {
    const { managedBookings } = await import("./patient-booking");
    const r: any = await managedBookings(open().admin, { handle: HANDLE, token: TOKEN });

    expect(r.ok).toBe(true);
    expect(r.data.bookings).toHaveLength(1);
    const b = r.data.bookings[0];

    // AC-02: date/time, location, mode, type, duration -- each read, none defaulted into existence.
    expect(b).toMatchObject({
      reference: REFERENCE,
      appointmentId: APPT_ID,
      status: "CONFIRMED",
      scheduledAt: CURRENT_AT,
      durationMinutes: 60,
      appointmentType: "new_consultation",
      locationId: TMR,
      locationName: "TMR International Hospital",
      // ⚠ THE DELIVERY MODE, NOT THE KIND OF BUILDING. The location's `type` is "hospital"; `mode` is
      // how the appointment happens, and a patient reading "hospital" where the screen means "come in
      // person" is one who cannot tell it apart from a video call.
      locationMode: "in_person",
      locationAddress: "Plot 6, Nakasero Road, Kampala",
    });
    // AC-05/AC-04: both actions are open here, so nothing has to be explained away.
    expect(b.canReschedule).toBe(true);
    expect(b.canCancel).toBe(true);
    expect(b.whyNot).toBeNull();
    // ⚠ A SHORT LIST MUST NEVER BE SILENTLY PRESENTED AS A WHOLE ONE.
    expect(r.data.listIncomplete).toBe(false);
  });

  it("⚠ INVENTS NO ADDRESS FOR A LOCATION THAT HAS NONE (AC-08)", async () => {
    // Nsambya is stored with no address and no map link. §8 allows directions only where verified
    // location data exists, and the failure mode is a confident map pin at a hospital's front gate
    // when the clinic is somewhere on the site -- so the absence has to survive the read.
    const world = buildWorld({
      practice_appointment: [{ ...appointment, location_id: NSAMBYA }],
      practice_booking_request: [{ ...bookingRequest, location_id: NSAMBYA }],
    });
    const { managedBookings } = await import("./patient-booking");
    const r: any = await managedBookings(fakeAdmin(world).admin, { handle: HANDLE, token: TOKEN });

    const b = r.data.bookings[0];
    expect(b.locationName).toBe("Nsambya Hospital");
    expect(b.locationAddress).toBeNull();
    expect(b.locationMapUrl).toBeNull();
  });

  it("explains a shut action instead of just hiding the button", async () => {
    // A practice that takes no online cancellations: the control goes, and a sentence takes its place.
    // AC-05 and §20 both turn on the patient being told why, rather than finding an absence.
    const world = buildWorld({
      practice_booking_rule: [{ ...buildWorld().practice_booking_rule[0], self_cancel_allowed: false }],
    });
    const { managedBookings } = await import("./patient-booking");
    const r: any = await managedBookings(fakeAdmin(world).admin, { handle: HANDLE, token: TOKEN });

    const b = r.data.bookings[0];
    expect(b.canCancel).toBe(false);
    expect(b.canReschedule).toBe(true);
    expect(b.whyNot).toContain("does not take cancellations online");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// ROWS: Start reschedule -> "Original appointment remains held."
//       Cancel then back out -> "Appointment remains confirmed."
//
// ⚠ WHAT THESE TWO ROWS SHARE, AND THE HALF THEY DO NOT COVER. Both say that OPENING a panel changes
// nothing -- the slot is not released while alternatives are on screen (AC-13), and arming the cancel
// does not cancel. The engine half of that is testable and tested here: the reads those panels run
// perform no writes at all.
//
// ⚠ THE UI HALF IS NOT COVERED BY ANY TEST IN THIS REPOSITORY. That the cancel button opens a
// confirmation rather than acting, and that backing out of it returns to a confirmed appointment, lives
// in ManageConsole's own useState and this project's component tests render with renderToString, which
// cannot click. Said plainly rather than approximated: a test asserting "we did not call the thing we
// did not call" would pass whatever the screen does.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe("§23 -- opening a panel holds the appointment as it was", () => {
  it("⚠ LISTING REPLACEMENT TIMES WRITES NOTHING, so the original slot is still held (AC-13)", async () => {
    const { admin, writes } = open();
    const { bookableSlots } = await import("./patient-booking");
    const r: any = await bookableSlots(admin, {
      handle: HANDLE, appointmentType: "new_consultation",
      fromIso: "2026-10-01T00:00:00.000Z", toIso: "2026-10-02T00:00:00.000Z",
    });

    expect(r.ok).toBe(true);
    expect(r.data.slots.length).toBeGreaterThan(0);   // the panel really had something to show
    expect(writes).toEqual([]);
    expect(rescheduleAppointment).not.toHaveBeenCalled();
    expect(transitionAppointment).not.toHaveBeenCalled();
  });

  it("reading the booking to arm a cancellation writes nothing either", async () => {
    const { admin, writes } = open();
    const { managedBookings } = await import("./patient-booking");
    const r: any = await managedBookings(admin, { handle: HANDLE, token: TOKEN, reference: REFERENCE });

    expect(r.data.bookings[0].status).toBe("CONFIRMED");
    expect(writes).toEqual([]);
    expect(transitionAppointment).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// ROW: Select new slot same location -> "Atomic successful reschedule."
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe("§23 -- moving to another time at the same hospital", () => {
  /** A second TMR session that afternoon, so a same-location alternative exists to move to. */
  const SAME_LOCATION_AT = "2026-10-03T10:00:00.000Z";   // 13:00 Kampala, same Saturday, still TMR
  const withTmrAfternoon = () => buildWorld({
    practice_availability_slot: [
      nsambyaSession,
      {
        id: "slot-tmr-pm", location_id: TMR,
        starts_at: SAME_LOCATION_AT, ends_at: "2026-10-03T13:00:00.000Z",
        slot_kind: "clinic", status: "OPEN", generated_from_template_id: "tpl-tmr",
      },
    ],
    practice_availability_template: [
      { id: "tpl-nsambya", booking_mode: "link_only", capacity: null },
      { id: "tpl-tmr", booking_mode: "link_only", capacity: null },
    ],
    practice_session_appointment_type: [
      { template_id: "tpl-nsambya", appointment_type: "new_consultation" },
      { template_id: "tpl-tmr", appointment_type: "new_consultation" },
    ],
  });

  it("commits in ONE write carrying the new time, and keeps the hospital it was already at", async () => {
    rescheduleAppointment.mockResolvedValue({
      ok: true, data: { scheduledAt: SAME_LOCATION_AT, from: { scheduledAt: CURRENT_AT } },
    });
    const { rescheduleManagedBooking } = await import("./patient-booking");
    const r: any = await rescheduleManagedBooking(fakeAdmin(withTmrAfternoon()).admin, {
      handle: HANDLE, token: TOKEN, reference: REFERENCE,
      scheduledAt: SAME_LOCATION_AT, correlationId: "c",
    });

    expect(r.ok).toBe(true);
    // ⚠ ONE CALL, NOT A CANCEL FOLLOWED BY A BOOK. AC-14's atomicity is the whole point: two writes can
    // leave a patient with no appointment at all if the second one fails.
    expect(rescheduleAppointment).toHaveBeenCalledOnce();
    expect(transitionAppointment).not.toHaveBeenCalled();
    const written = rescheduleAppointment.mock.calls[0][1] as any;
    expect(written.scheduledAt).toBe(SAME_LOCATION_AT);
    expect(written.locationId).toBe(TMR);
    // ⚠ NO allowOverlap. The exclusion constraint is what makes the commit safe, and passing this would
    // switch it off -- the one flag whose absence a reader cannot see.
    expect(written.allowOverlap).toBeUndefined();
    // The patient is told both ends of the move, so a confirmation can say what changed.
    expect(r.data).toMatchObject({ reference: REFERENCE, from: CURRENT_AT, to: SAME_LOCATION_AT });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// ROWS: Confirm cancellation -> "Cancelled state; slot released; communication event triggered."
//       Communication failure after cancellation -> "Cancellation remains successful; issue shown
//       separately."
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe("§23 -- confirming a cancellation", () => {
  it("asks the state machine for CANCELLED, records it, and tells the patient", async () => {
    const { cancelManagedBooking } = await import("./patient-booking");
    const r: any = await cancelManagedBooking(open().admin, {
      handle: HANDLE, token: TOKEN, reference: REFERENCE, reason: "I am away", correlationId: "c",
    });

    expect(r.ok).toBe(true);
    expect(r.data.status).toBe("CANCELLED");

    // ⚠ THE RELEASE IS THE STATUS AND NOTHING ELSE. Migration 255's constraint covers
    // REQUESTED/CONFIRMED/ARRIVED only, so a CANCELLED row stops holding the time the instant it is
    // written -- there is no second "free the slot" write to look for, and a test expecting one would be
    // asserting an implementation this product deliberately does not have. That the time comes back on
    // offer is proven end-to-end by the harness.
    expect(transitionAppointment).toHaveBeenCalledOnce();
    expect(transitionAppointment.mock.calls[0][1]).toMatchObject({
      appointmentId: APPT_ID, to: "CANCELLED", workspaceId: WS,
    });

    // §21's communication event, sent to the address the session PROVED rather than one off a form.
    expect(publicBookingNotice).toHaveBeenCalledOnce();
    expect(publicBookingNotice.mock.calls[0][1]).toMatchObject({
      appointmentId: APPT_ID, kind: "email", destination: PATIENT_EMAIL,
    });
    expect(r.data.confirmationSent).toBe(true);

    // The reason reaches the booking through the one helper the practice path also uses.
    expect(recordCancellation).toHaveBeenCalledOnce();
    expect(recordCancellation.mock.calls[0][3]).toMatchObject({ reason: "I am away", actorKind: "patient" });
    expect(r.data.reasonStoredOnBooking).toBe(true);
  });

  it("⚠ KEEPS THE CANCELLATION WHEN THE MESSAGE FAILS, and does not claim one was sent (§20)", async () => {
    publicBookingNotice.mockResolvedValue({
      appointmentId: APPT_ID, purpose: null, attempted: null,
      notAttempted: "the mail provider refused the message",
    });
    const { cancelManagedBooking } = await import("./patient-booking");
    const r: any = await cancelManagedBooking(open().admin, {
      handle: HANDLE, token: TOKEN, reference: REFERENCE, correlationId: "c",
    });

    // The mutation stands. A failed send must never roll back a cancellation the diary has accepted --
    // the practice would keep a slot for somebody who believes they cancelled.
    expect(r.ok).toBe(true);
    expect(r.data.status).toBe("CANCELLED");
    expect(transitionAppointment).toHaveBeenCalledOnce();

    // ⚠ AND THE COMMUNICATION PROBLEM IS ITS OWN SENTENCE, not silence and not a claim. The note has to
    // stop the patient waiting for a message that is not coming.
    expect(r.data.confirmationSent).toBe(false);
    expect(r.data.confirmationNote).toContain("Nothing was sent to you");
    expect(r.data.confirmationNote).not.toMatch(/on its way/i);
  });

  it("refuses a second cancellation on the state machine's own ground", async () => {
    // CANCELLED has no transition to CANCELLED, so the gate shuts before any write is attempted and the
    // patient gets a sentence rather than a stack trace.
    const world = buildWorld({ practice_appointment: [{ ...appointment, status: "CANCELLED" }] });
    const { cancelManagedBooking } = await import("./patient-booking");
    const r: any = await cancelManagedBooking(fakeAdmin(world).admin, {
      handle: HANDLE, token: TOKEN, reference: REFERENCE, correlationId: "c",
    });

    expect(r.ok).toBe(false);
    expect(r.code).toBe("CANCEL_NOT_ALLOWED");
    expect(r.message).toContain("cancelled");
    expect(transitionAppointment).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// ROW: Invalid/expired management token -> "No appointment data exposed." (AC-16)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe("§23 -- an invalid or expired management context", () => {
  /** Everything the fixture's booking could leak. Nothing in a refusal may contain any of it. */
  const SECRETS = [REFERENCE, APPT_ID, CURRENT_AT, PATIENT_EMAIL, "TMR International"];

  const cases: Array<[string, { token?: string; world?: ReturnType<typeof buildWorld> }]> = [
    ["a token no session was ever minted for", { token: "somebody-elses-token" }],
    ["no token at all", { token: "" }],
    ["a session that has expired", {
      world: buildWorld({
        practice_patient_session: [{ ...session, expires_at: "2026-09-05T05:00:00.000Z" }],   // an hour before NOW
      }),
    }],
    ["a session that was revoked", {
      world: buildWorld({
        practice_patient_session: [{ ...session, revoked_at: "2026-09-05T05:30:00.000Z" }],
      }),
    }],
    ["a session minted for a different practice", {
      world: buildWorld({
        practice_otp_challenge: [{ ...challenge, workspace_id: "ws-somewhere-else" }],
      }),
    }],
    ["a verification that was never completed", {
      world: buildWorld({ practice_otp_challenge: [{ ...challenge, consumed_at: null }] }),
    }],
  ];

  for (const [name, c] of cases) {
    it(`exposes nothing to ${name}`, async () => {
      const { managedBookings } = await import("./patient-booking");
      const r: any = await managedBookings(fakeAdmin(c.world ?? buildWorld()).admin, {
        handle: HANDLE, token: c.token ?? TOKEN,
      });

      expect(r.ok).toBe(false);
      expect(r.status).toBe(403);
      // ⚠ THE WHOLE RESPONSE, NOT THE FIELDS WE REMEMBERED TO CHECK. A refusal that carries the booking
      // in a message, a reason or a debug field has still disclosed it.
      const body = JSON.stringify(r);
      for (const secret of SECRETS) expect(body).not.toContain(secret);
    });
  }

  it("⚠ AND CANNOT MUTATE EITHER -- a bad token reaches no write (AC-16)", async () => {
    const { cancelManagedBooking, rescheduleManagedBooking } = await import("./patient-booking");
    const cancelled: any = await cancelManagedBooking(open().admin, {
      handle: HANDLE, token: "somebody-elses-token", reference: REFERENCE, correlationId: "c",
    });
    const moved: any = await rescheduleManagedBooking(open().admin, {
      handle: HANDLE, token: "somebody-elses-token", reference: REFERENCE,
      scheduledAt: "2026-10-01T05:30:00.000Z", correlationId: "c",
    });

    expect(cancelled.ok).toBe(false);
    expect(moved.ok).toBe(false);
    expect(transitionAppointment).not.toHaveBeenCalled();
    expect(rescheduleAppointment).not.toHaveBeenCalled();
    expect(publicBookingNotice).not.toHaveBeenCalled();
  });

  it("a valid session opens nothing belonging to somebody else", async () => {
    // ⚠ A REFERENCE IS AN IDENTIFIER, NEVER A CREDENTIAL. The booking below is real and the reference is
    // correct; it simply belongs to another inbox. It must narrow to nothing rather than to theirs.
    const world = buildWorld({
      practice_booking_request: [{ ...bookingRequest, contact_email: "someone.else@example.com" }],
    });
    const { managedBookings } = await import("./patient-booking");
    const r: any = await managedBookings(fakeAdmin(world).admin, {
      handle: HANDLE, token: TOKEN, reference: REFERENCE,
    });

    expect(r.ok).toBe(true);            // the session itself is fine
    expect(r.data.bookings).toEqual([]); // and it opens nothing
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// ROW: Past appointment -> "Retrospective/read-only state as prescribed."
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe("§23 -- an appointment that has already happened", () => {
  const past = () => buildWorld({
    practice_appointment: [{ ...appointment, scheduled_at: "2026-08-15T08:00:00.000Z" }],
    practice_booking_request: [{ ...bookingRequest, requested_start: "2026-08-15T08:00:00.000Z" }],
  });

  it("⚠ IS NOT SHOWN AT ALL -- WHICH IS NOT WHAT §7 PRESCRIBES, and this test says so rather than blessing it", async () => {
    // WHAT THE ENGINE DOES: managedBookings decides "still ahead of me" on the appointment and drops
    // anything behind it, so a patient who attended yesterday sees an empty list.
    //
    // WHAT THE SPEC ASKS FOR: §7's state table gives Past/completed a "read-only retrospective view; no
    // prospective mutation controls", and §18 allows past records to stay viewable under the retention
    // policy. There is no such view, and building one is a product decision -- what it shows, whether it
    // offers "book again", and how far back it reaches -- not something to infer from a test matrix.
    //
    // So this pins the behaviour that actually ships, and names the gap it leaves. The half that IS
    // settled is asserted below: whatever the page eventually shows, it must never offer a mutation on
    // an appointment that has already happened.
    const { managedBookings } = await import("./patient-booking");
    const r: any = await managedBookings(fakeAdmin(past()).admin, { handle: HANDLE, token: TOKEN });

    expect(r.ok).toBe(true);
    expect(r.data.bookings).toEqual([]);
  });

  it("offers no mutation on it, by either door", async () => {
    const { cancelManagedBooking, rescheduleManagedBooking } = await import("./patient-booking");
    const cancelled: any = await cancelManagedBooking(fakeAdmin(past()).admin, {
      handle: HANDLE, token: TOKEN, reference: REFERENCE, correlationId: "c",
    });
    const moved: any = await rescheduleManagedBooking(fakeAdmin(past()).admin, {
      handle: HANDLE, token: TOKEN, reference: REFERENCE,
      scheduledAt: "2026-10-01T05:30:00.000Z", correlationId: "c",
    });

    expect(cancelled.ok).toBe(false);
    expect(moved.ok).toBe(false);
    expect(transitionAppointment).not.toHaveBeenCalled();
    expect(rescheduleAppointment).not.toHaveBeenCalled();
  });
});
