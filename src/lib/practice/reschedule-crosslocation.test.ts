/**
 * CPR-BOOK-MGMT-006 §11 / AC-12 -- CROSS-LOCATION RESCHEDULING.
 *
 * ⚠ THE ONE ASSERTION THIS FILE EXISTS FOR: when a patient moves a booking to a time that exists at a
 * DIFFERENT hospital, the appointment's location moves with it. Getting that wrong sends somebody to the
 * wrong building while every screen agrees with the wrong answer -- the confirmation, the manage page and
 * the practitioner's own diary would all say the new place, and only the patient would be somewhere else.
 *
 * The engine already did this correctly and had no test. The UI that exposes it did not label the
 * location at all until this was built, which is why the pair is worth pinning together.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

const WS = "ws-1";
const TMR = "loc-tmr";
const NSAMBYA = "loc-nsambya";

/**
 * A table-dispatch fake. Every builder is chainable and thenable; a table with no entry answers empty
 * rather than throwing, so a missing one shows up as a behavioural failure rather than a stack trace.
 */
function fakeAdmin(tables: Record<string, any[]>) {
  const build = (rows: any[]): any => {
    const q: any = {
      select: () => q, eq: () => q, in: () => q, not: () => q, is: () => q,
      gte: () => q, lte: () => q, gt: () => q, lt: () => q, order: () => q,
      limit: () => q, range: () => q,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      single: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: any) => resolve({ data: rows, error: null }),
    };
    return q;
  };
  return {
    from: (table: string) => {
      return build(tables[table] ?? []);
    },
  };
}

beforeEach(() => { vi.clearAllMocks(); });

/** A published, link-only booking page offering both hospitals and the one appointment type. */
const bookingAccess = {
  workspace_id: WS, handle: "elisham1", mode: "link_only", publish_state: "published",
  otp_required: true, otp_channel: "any", guest_booking_allowed: false,
  visible_location_ids: [TMR, NSAMBYA],
  visible_appointment_types: ["new_consultation"],
  brand_display_name: "Trial Healthcare", instructions: null, privacy_notice: null,
  consent_text: null, consent_required: false,
  fallback_email: null, fallback_phone: null, emergency_notice: null,
};

const locations = [
  { id: TMR, name: "TMR International Hospital", active: true, type: "hospital", address: null, map_url: null },
  { id: NSAMBYA, name: "Nsambya Hospital", active: true, type: "hospital", address: null, map_url: null },
];

/** A live session, minted from a consumed challenge for this practice and this inbox. */
const AHEAD = new Date(Date.now() + 3600_000).toISOString();
const session = { id: "sess-1", challenge_id: "chal-1", expires_at: AHEAD, revoked_at: null };
const challenge = {
  id: "chal-1", workspace_id: WS, destination: "patient@example.com",
  channel: "email", consumed_at: new Date().toISOString(),
};

// ── §11's own example ────────────────────────────────────────────────────────────────────────────
//   Current:     Saturday 3 October, 11:00, TMR International Hospital
//   Alternative: Thursday 1 October, 08:30, Nsambya Hospital -- earlier, and somewhere else.
const REQ_ID = "ddc19d00-0000-4000-8000-000000000000";
const REFERENCE = "CP-DDC19D";                       // referenceFrom(): CP- + first six hex, uppercased
const APPT_ID = "appt-1";
const CURRENT_AT = "2026-10-03T08:00:00.000Z";       // 11:00 Kampala, Saturday, at TMR
const TARGET_AT = "2026-10-01T05:30:00.000Z";        // 08:30 Kampala, Thursday, at Nsambya

const bookingRequest = {
  id: REQ_ID, appointment_id: APPT_ID,
  contact_phone: null, contact_email: "patient@example.com",
  appointment_type: "new_consultation", location_id: TMR, requested_start: CURRENT_AT,
};

const appointment = {
  id: APPT_ID, status: "CONFIRMED", scheduled_at: CURRENT_AT,
  duration_minutes: 60, location_id: TMR, appointment_type: "new_consultation",
};

/** A rule that permits self-rescheduling, with a horizon and notice the target comfortably satisfies. */
const bookingRule = {
  id: "rule-1", workspace_id: WS, location_id: null, appointment_type: null,
  lead_time_minutes: 30, booking_horizon_days: 120, cancellation_notice_minutes: 0,
  reschedule_notice_minutes: null, self_cancel_allowed: true, self_reschedule_allowed: true,
  visibility: "public", active: true, status: "active", priority: 0,
  effective_from: null, effective_to: null, overbooking_allowed: 0,
  capacity_total: null, capacity_new: null, capacity_follow_up: null, capacity_urgent_reserve: null,
  confirmation_mode: "instant", patient_eligibility: "any", version: 1,
};

/** The Thursday session at NSAMBYA that makes the alternative real. */
const nsambyaSession = {
  id: "slot-nsambya", location_id: NSAMBYA,
  starts_at: "2026-10-01T05:30:00.000Z", ends_at: "2026-10-01T12:00:00.000Z",
  slot_kind: "clinic", status: "OPEN", generated_from_template_id: "tpl-nsambya",
};

const world = {
  practice_booking_access: [bookingAccess],
  practice_location: locations,
  practice_patient_session: [session],
  practice_otp_challenge: [challenge],
  practice_booking_request: [bookingRequest],
  practice_appointment: [appointment],
  practice_booking_rule: [bookingRule],
  practice_availability_slot: [nsambyaSession],
  practice_availability_template: [{ id: "tpl-nsambya", booking_mode: "link_only", capacity: null }],
  // ⚠ WITHOUT THIS THE SESSION OFFERS NOTHING, and the engine is right to drop it: a session opened to
  // patients that links no appointment type is not patient-bookable. Discovered by the fixture returning
  // an empty offer, which is the rule working rather than the stub failing.
  practice_session_appointment_type: [{ template_id: "tpl-nsambya", appointment_type: "new_consultation" }],
  practice_workspace: [{ id: WS, timezone: "Africa/Kampala" }],
  practice_configuration: [{ workspace_id: WS, default_appointment_minutes: 60, is_effective: true }],
};

describe("§11 / AC-12 -- moving to an earlier time at another hospital", () => {
  it("⚠ CARRIES THE NEW LOCATION INTO THE WRITE, not only the new time", async () => {
    rescheduleAppointment.mockResolvedValue({
      ok: true,
      data: { scheduledAt: TARGET_AT, from: { scheduledAt: CURRENT_AT } },
    });
    const { rescheduleManagedBooking } = await import("./patient-booking");

    const r: any = await rescheduleManagedBooking(fakeAdmin(world) as any, {
      handle: "elisham1", token: "t", reference: REFERENCE,
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
    const r: any = await rescheduleManagedBooking(fakeAdmin(world) as any, {
      handle: "elisham1", token: "t", reference: REFERENCE,
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
    const r: any = await rescheduleManagedBooking(fakeAdmin(world) as any, {
      handle: "elisham1", token: "t", reference: REFERENCE,
      scheduledAt: TARGET_AT, correlationId: "c",
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("SLOT_TAKEN");
    expect(r.message).toContain("just been taken");
  });
});

