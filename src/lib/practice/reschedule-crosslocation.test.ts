/**
 * CPR-BOOK-MGMT-006 §23 -- CROSS-LOCATION RESCHEDULING (AC-12, AC-14).
 *
 * ⚠ THE ONE ASSERTION THIS FILE EXISTS FOR: when a patient moves a booking to a time that exists at a
 * DIFFERENT hospital, the appointment's location moves with it. Getting that wrong sends somebody to the
 * wrong building while every screen agrees with the wrong answer -- the confirmation, the manage page and
 * the practitioner's own diary would all say the new place, and only the patient would be somewhere else.
 *
 * The engine already did this correctly and had no test. The UI that exposes it did not label the
 * location at all until this arc, which is why the pair is worth pinning together.
 *
 * The world is manage-fixture.ts; §23's other rows are in managed-booking.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fakeAdmin, buildWorld, HANDLE, TOKEN, REFERENCE, APPT_ID,
  NSAMBYA, CURRENT_AT, TARGET_AT, NOW,
} from "./manage-fixture";

const rescheduleAppointment = vi.fn();
const audit = vi.fn();

// ⚠ PARTIAL. Only the WRITE is replaced -- everything else in the scheduling module (its state machine,
// its transition table, checkPlacement) stays real, so this fixture cannot pass by removing the rules it
// is meant to exercise.
vi.mock("@/lib/practice/scheduling", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/practice/scheduling")>()),
  rescheduleAppointment: (...a: unknown[]) => rescheduleAppointment(...a),
}));
vi.mock("./audit", () => ({ audit: (...a: unknown[]) => audit(...a) }));

// ⚠ FROZEN. See NOW in manage-fixture.ts: every gate here is decided against the clock, and on the real
// one this file would start failing on 3 October 2026 for reasons unrelated to the code.
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(NOW) });
});
afterEach(() => { vi.useRealTimers(); });

const world = buildWorld();

describe("§23 -- select earlier slot, other location", () => {
  it("⚠ CARRIES THE NEW LOCATION INTO THE WRITE, not only the new time", async () => {
    rescheduleAppointment.mockResolvedValue({
      ok: true,
      data: { scheduledAt: TARGET_AT, from: { scheduledAt: CURRENT_AT } },
    });
    const { rescheduleManagedBooking } = await import("./patient-booking");

    const r: any = await rescheduleManagedBooking(fakeAdmin(world).admin, {
      handle: HANDLE, token: TOKEN, reference: REFERENCE,
      scheduledAt: TARGET_AT, correlationId: "c",
    });

    expect(r.ok).toBe(true);
    expect(rescheduleAppointment).toHaveBeenCalledOnce();
    const written = rescheduleAppointment.mock.calls[0][1] as any;
    // THE ASSERTION. Time and place move together, or a patient goes to the wrong hospital while every
    // screen agrees with the wrong answer.
    expect(written.scheduledAt).toBe(TARGET_AT);
    expect(written.locationId).toBe(NSAMBYA);
    expect(written.appointmentId).toBe(APPT_ID);
  });

  it("refuses a time the availability engine would not have offered", async () => {
    // ⚠ THE OTHER HALF OF THE SAME RULE. Cross-location freedom must not become "any instant at any
    // location": the replacement is checked against the same computation a fresh booking gets, so a
    // hand-edited request for 22:00 at Nsambya is refused rather than written.
    const { rescheduleManagedBooking } = await import("./patient-booking");
    const r: any = await rescheduleManagedBooking(fakeAdmin(world).admin, {
      handle: HANDLE, token: TOKEN, reference: REFERENCE,
      scheduledAt: "2026-10-01T19:00:00.000Z", correlationId: "c",   // 22:00 Kampala, outside the session
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("SLOT_NOT_OFFERED");
    expect(rescheduleAppointment).not.toHaveBeenCalled();
  });

  it("⚠ KEEPS THE ORIGINAL APPOINTMENT WHEN THE NEW SLOT IS TAKEN (AC-14, §20)", async () => {
    // The exclusion constraint fires between offer and write. The patient must keep what they had.
    rescheduleAppointment.mockResolvedValue({
      ok: false, code: "DOUBLE_BOOKED",
      message: 'conflicting key value violates exclusion constraint "no_overlap"',
    });
    const { rescheduleManagedBooking } = await import("./patient-booking");
    const r: any = await rescheduleManagedBooking(fakeAdmin(world).admin, {
      handle: HANDLE, token: TOKEN, reference: REFERENCE,
      scheduledAt: TARGET_AT, correlationId: "c",
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("SLOT_TAKEN");
    expect(r.message).toContain("just been taken");
  });
});
