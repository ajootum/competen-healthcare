/**
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * THE WORLD CPR-BOOK-MGMT-006 §23's TEST MATRIX IS RUN AGAINST.
 *
 * One practice, two hospitals, one appointment type, one live patient session, and §11's own worked
 * example: a Saturday appointment at TMR with an earlier Thursday alternative at Nsambya. Both matrix
 * files build on this rather than each declaring a practice of their own, because two fixtures that drift
 * apart are two different products being tested.
 *
 * ⚠ THIS FILE IS NOT A TEST AND HOLDS NO ASSERTIONS. It is imported by *.test.ts only.
 *
 * ⚠ WHY THE FAKE FILTERS AT ALL. A stub whose `.eq()` returns everything makes an authorization test pass
 * for the wrong reason -- present a stranger's token and the session row comes back anyway, so "an
 * invalid token exposes nothing" would be asserting that the fixture has one session rather than that the
 * code checked anything. Every refusal in this product's manage path is a filter that must actually bite,
 * so eq/in/is are applied here for real.
 *
 * ⚠ AND WHY THEY ARE APPLIED ONLY TO COLUMNS THE FIXTURE MODELS. A filter on a column no row declares is
 * a no-op rather than a match against undefined. Otherwise every row would have to carry a workspace_id,
 * a status and a tenant column it plays no part in, and the first missed one would empty a table silently
 * -- which reads exactly like the code under test refusing, and is the most expensive kind of wrong
 * answer a fixture can give. The rule is stated so a reader knows which filters are load-bearing here:
 * the ones on columns the rows below actually have.
 *
 * Range filters (gte/lte/gt/lt/order/limit) are deliberately NOT applied -- this world is small enough
 * that every row is in every window, and the engines under test do their own time arithmetic on what
 * comes back. A test that depends on a range filter biting belongs against the real database, in
 * scripts/practice-patient-manage-harness.ts.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";

export const WS = "ws-1";
export const TMR = "loc-tmr";
export const NSAMBYA = "loc-nsambya";
export const HANDLE = "elisham1";

/** The bearer the tests present. checkPatientSession looks the session up by sha256 of it. */
export const TOKEN = "t";
export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

// ── §11's own example ────────────────────────────────────────────────────────────────────────────────
//   Current:     Saturday 3 October 2026, 11:00, TMR International Hospital
//   Alternative: Thursday 1 October, 08:30, Nsambya Hospital -- earlier, and somewhere else.
export const REQ_ID = "ddc19d00-0000-4000-8000-000000000000";
/** referenceFrom(): CP- + the id's first six hex characters, uppercased. */
export const REFERENCE = "CP-DDC19D";
export const APPT_ID = "appt-1";
export const CURRENT_AT = "2026-10-03T08:00:00.000Z";   // 11:00 Kampala, Saturday, at TMR
export const TARGET_AT = "2026-10-01T05:30:00.000Z";    // 08:30 Kampala, Thursday, at Nsambya

export const PATIENT_EMAIL = "patient@example.com";

/**
 * ⚠ THE CLOCK THE MATRIX RUNS AT, AND WHY IT IS FROZEN.
 *
 * Every row above is an absolute instant, and every gate in the manage path is decided against `now`:
 * the appointment must be ahead of it, the session must not have expired, the booking horizon and the
 * lead time are both measured from it. Left on the real clock these tests pass today and start failing
 * on 3 October 2026 -- when the worked example quietly becomes a PAST appointment and managedBookings
 * correctly drops it, so the whole file reds for a reason that has nothing to do with the code.
 *
 * A test whose result depends on the day it is run is not a control. Both matrix files install this
 * instant with vi.setSystemTime before they assert anything.
 */
export const NOW = "2026-09-05T06:00:00.000Z";   // Saturday, four weeks before the worked example

/** A row set keyed by table name, as the fake serves it. */
export type World = Record<string, any[]>;

/** A mutation the code under test attempted. Recorded rather than performed. */
export type Write = { table: string; verb: "insert" | "update" | "upsert" | "delete"; payload: unknown };

/**
 * A table-dispatch fake admin client.
 *
 * Chainable and thenable, because the engines await the builder itself rather than a promise handed back
 * by the last `.eq()`. A table with no entry answers empty rather than throwing, so a fixture missing a
 * table shows up as the behaviour it actually causes instead of a stack trace in an unrelated place.
 *
 * `writes` collects every attempted mutation. Nothing is applied: a read after a write sees the world as
 * declared. That is a limitation worth naming -- "the row really changed" is the real database's answer
 * and the harness's job, and these tests assert what was ASKED for, not what a fake pretended happened.
 */
export function fakeAdmin(tables: World): { admin: any; writes: Write[] } {
  const writes: Write[] = [];

  const build = (table: string, rows: any[]): any => {
    let current = rows;
    const declares = (col: string) => rows.some(r => Object.prototype.hasOwnProperty.call(r, col));
    const q: any = {
      select: () => q,
      eq: (col: string, val: unknown) => {
        if (declares(col)) current = current.filter(r => r[col] === val);
        return q;
      },
      in: (col: string, vals: unknown[]) => {
        if (declares(col)) current = current.filter(r => (vals ?? []).includes(r[col]));
        return q;
      },
      is: (col: string, val: unknown) => {
        if (declares(col) && val === null) current = current.filter(r => r[col] == null);
        return q;
      },
      not: (col: string, _op: string, val: unknown) => {
        if (declares(col) && val === null) current = current.filter(r => r[col] != null);
        return q;
      },
      // Range and shaping: see the header for why these do not narrow.
      gte: () => q, lte: () => q, gt: () => q, lt: () => q,
      order: () => q, limit: () => q, range: () => q,
      // Mutations are recorded and answer as a write that changed nothing, which is what a fake can
      // honestly claim. The engines that matter here are mocked at their own boundary instead.
      insert: (payload: unknown) => { writes.push({ table, verb: "insert", payload }); return q; },
      update: (payload: unknown) => { writes.push({ table, verb: "update", payload }); return q; },
      upsert: (payload: unknown) => { writes.push({ table, verb: "upsert", payload }); return q; },
      delete: () => { writes.push({ table, verb: "delete", payload: null }); return q; },
      maybeSingle: async () => ({ data: current[0] ?? null, error: null }),
      single: async () => ({ data: current[0] ?? null, error: null }),
      then: (resolve: any) => resolve({ data: current, error: null }),
    };
    return q;
  };

  return { admin: { from: (table: string) => build(table, tables[table] ?? []) }, writes };
}

/** A published, link-only booking page offering both hospitals and the one appointment type. */
export const bookingAccess = {
  workspace_id: WS, handle: HANDLE, mode: "link_only", publish_state: "published",
  otp_required: true, otp_channel: "any", guest_booking_allowed: false,
  visible_location_ids: [TMR, NSAMBYA],
  visible_appointment_types: ["new_consultation"],
  brand_display_name: "Trial Healthcare", instructions: null, privacy_notice: null,
  consent_text: null, consent_required: false,
  fallback_email: null, fallback_phone: null, emergency_notice: null,
};

export const locations = [
  {
    id: TMR, name: "TMR International Hospital", active: true, type: "hospital",
    // §8: an address the practice actually set, so directions are offered from stored data and never
    // invented. Nsambya below has none -- the pair is what makes "only where it exists" testable.
    address: "Plot 6, Nakasero Road, Kampala", map_url: null,
  },
  { id: NSAMBYA, name: "Nsambya Hospital", active: true, type: "hospital", address: null, map_url: null },
];

/**
 * A live session, minted from a consumed challenge for this practice and this inbox.
 *
 * ⚠ ABSOLUTE, NOT `Date.now() + an hour`. These constants are read when the module is imported, which is
 * before a test installs the frozen clock -- so a relative expiry would be an hour past the REAL now and
 * three weeks before the frozen one, and every session would arrive already expired.
 */
export const SESSION_EXPIRES = "2026-09-05T09:00:00.000Z";   // three hours after NOW
export const session = {
  id: "sess-1", challenge_id: "chal-1", token_hash: sha256(TOKEN),
  expires_at: SESSION_EXPIRES, revoked_at: null,
};
export const challenge = {
  id: "chal-1", workspace_id: WS, destination: PATIENT_EMAIL,
  channel: "email", consumed_at: "2026-09-05T05:55:00.000Z",
};

export const bookingRequest = {
  id: REQ_ID, appointment_id: APPT_ID,
  contact_phone: null, contact_email: PATIENT_EMAIL,
  appointment_type: "new_consultation", location_id: TMR, requested_start: CURRENT_AT,
};

export const appointment = {
  id: APPT_ID, status: "CONFIRMED", scheduled_at: CURRENT_AT,
  duration_minutes: 60, location_id: TMR, appointment_type: "new_consultation",
};

/** A rule permitting self-service, with a horizon and notice the worked example comfortably satisfies. */
export const bookingRule = {
  id: "rule-1", workspace_id: WS, location_id: null, appointment_type: null,
  lead_time_minutes: 30, booking_horizon_days: 120, cancellation_notice_minutes: 0,
  reschedule_notice_minutes: null, self_cancel_allowed: true, self_reschedule_allowed: true,
  visibility: "public", active: true, status: "active", priority: 0,
  effective_from: null, effective_to: null, overbooking_allowed: 0,
  capacity_total: null, capacity_new: null, capacity_follow_up: null, capacity_urgent_reserve: null,
  confirmation_mode: "instant", patient_eligibility: "any", version: 1,
};

/** The Thursday session at NSAMBYA that makes the earlier alternative real. */
export const nsambyaSession = {
  id: "slot-nsambya", location_id: NSAMBYA,
  starts_at: "2026-10-01T05:30:00.000Z", ends_at: "2026-10-01T12:00:00.000Z",
  slot_kind: "clinic", status: "OPEN", generated_from_template_id: "tpl-nsambya",
};

/**
 * The world, with per-table replacements merged in.
 *
 * ⚠ REPLACEMENT, NOT CONCATENATION. A test that needs a cancelled appointment must be able to say so
 * without the confirmed one still sitting in the table beside it.
 */
export function buildWorld(over: World = {}): World {
  return {
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
    // patients that links no appointment type is not patient-bookable. Discovered by the fixture
    // returning an empty offer, which was the rule working rather than the stub failing.
    practice_session_appointment_type: [{ template_id: "tpl-nsambya", appointment_type: "new_consultation" }],
    practice_workspace: [{ id: WS, name: "Trial Healthcare", timezone: "Africa/Kampala" }],
    practice_configuration: [{ workspace_id: WS, default_appointment_minutes: 60, is_effective: true }],
    ...over,
  };
}
