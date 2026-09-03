/**
 * CPR-BOOK-MGMT-006 §21 / CPR-BOOK-AVAIL-001 -- THE REGULAR-WEEK GATE.
 *
 * ⚠ THIS FILE EXISTS BECAUSE A FORTNIGHTLY CLINIC WAS UNBOOKABLE AND NOTHING NOTICED.
 *
 * locationFromRegularWeek is what submitBookingRequest uses to refuse a hand-crafted out-of-hours
 * instant. It filtered session templates to `recurrence_weeks === 1`, which excluded a fortnightly
 * session from the regular week entirely -- on its own weeks as well as its off ones. The slot generator
 * honours the recurrence properly, so the public calendar DREW a Saturday the commit then refused with
 * "that time is not offered here", every time, with no way through.
 *
 * The two sides disagreeing is the failure mode worth pinning: the offering engine and the gate must
 * answer the same question the same way. These tests fail if the filter ever goes back to asking whether
 * a session repeats weekly instead of whether it runs on THIS date.
 */
import { describe, it, expect } from "vitest";
import { locationFromRegularWeek } from "./session-location";

const KAMPALA = "Africa/Kampala";
const TMR = "loc-tmr";

/** A template row as the table stores it. weekday is ISO: 1 = Monday .. 7 = Sunday. */
const saturdayClinic = (over: Record<string, unknown> = {}) => ({
  id: "tpl-sat", location_id: TMR,
  starts_minute: 540, ends_minute: 900,          // 09:00 - 15:00 local
  recurrence_weeks: 1, recurrence_anchor_date: null,
  effective_from: null, effective_to: null, session_name: "Saturday clinic",
  ...over,
});

/**
 * The admin client, only as far as this function reaches into it: one select with four eq()s, awaited.
 * ⚠ The chain is thenable rather than a promise returned by the last eq, because the code awaits the
 * builder itself -- a stub that returned a promise from `.eq` would pass while the real client differs.
 */
function stubAdmin(rows: any[] | null, error: { message: string } | null = null) {
  const seen: Record<string, unknown> = {};
  const q: any = {
    select: () => q,
    eq: (col: string, val: unknown) => { seen[col] = val; return q; },
    then: (resolve: any) => resolve({ data: rows, error }),
  };
  return { admin: { from: () => q }, seen };
}

describe("§4 -- a fortnightly session is inside the regular week on its own weeks", () => {
  // 3 October 2026 is a Saturday. 08:00Z is 11:00 in Kampala, inside 09:00-15:00.
  const SAT_3_OCT_11AM = "2026-10-03T08:00:00.000Z";

  it("admits a WEEKLY Saturday session", async () => {
    const { admin } = stubAdmin([saturdayClinic()]);
    const v = await locationFromRegularWeek(admin, "ws", SAT_3_OCT_11AM, KAMPALA);
    expect(v.outsideRegularWeek).toBe(false);
    expect(v.locationId).toBe(TMR);
  });

  it("⚠ ADMITS A FORTNIGHTLY SESSION ON ITS ANCHOR'S OWN WEEK -- the booking-blocking bug", async () => {
    // Anchored 19 September; 3 October is two weeks later, so it runs.
    const { admin } = stubAdmin([
      saturdayClinic({ recurrence_weeks: 2, recurrence_anchor_date: "2026-09-19" }),
    ]);
    const v = await locationFromRegularWeek(admin, "ws", SAT_3_OCT_11AM, KAMPALA);
    expect(v.outsideRegularWeek).toBe(false);
    expect(v.locationId).toBe(TMR);
  });

  it("REFUSES the same session on an off week, so the fix did not open the blank ones", async () => {
    // Anchored 26 September; 3 October is one week later, which is not its week.
    const { admin } = stubAdmin([
      saturdayClinic({ recurrence_weeks: 2, recurrence_anchor_date: "2026-09-26" }),
    ]);
    const v = await locationFromRegularWeek(admin, "ws", SAT_3_OCT_11AM, KAMPALA);
    expect(v.outsideRegularWeek).toBe(true);
    expect(v.locationId).toBeNull();
  });

  it("refuses an interval with no anchor, which the database will not store anyway", async () => {
    // occursOn's own rule: under-offering costs a screen, over-offering sends somebody to a locked door.
    const { admin } = stubAdmin([
      saturdayClinic({ recurrence_weeks: 2, recurrence_anchor_date: null }),
    ]);
    expect((await locationFromRegularWeek(admin, "ws", SAT_3_OCT_11AM, KAMPALA)).outsideRegularWeek).toBe(true);
  });
});

describe("the rest of the gate still holds", () => {
  const SAT_3_OCT_11AM = "2026-10-03T08:00:00.000Z";
  const SAT_3_OCT_6PM = "2026-10-03T15:00:00.000Z";   // 18:00 Kampala, after the clinic ends

  it("queries the ISO weekday, not the JavaScript one", async () => {
    // Saturday is 6 either way; SUNDAY is where the conventions part (JS 0, ISO 7), and a template
    // stored as 7 would never be found by a query asking for 0.
    const { admin, seen } = stubAdmin([]);
    await locationFromRegularWeek(admin, "ws", "2026-10-04T08:00:00.000Z", KAMPALA);  // a Sunday
    expect(seen.weekday).toBe(7);
  });

  it("refuses a time after the session ends", async () => {
    const { admin } = stubAdmin([saturdayClinic()]);
    expect((await locationFromRegularWeek(admin, "ws", SAT_3_OCT_6PM, KAMPALA)).outsideRegularWeek).toBe(true);
  });

  it("refuses a date outside the session's effective window", async () => {
    const { admin } = stubAdmin([saturdayClinic({ effective_to: "2026-09-30" })]);
    expect((await locationFromRegularWeek(admin, "ws", SAT_3_OCT_11AM, KAMPALA)).outsideRegularWeek).toBe(true);
  });

  it("assumes NOTHING when two locations cover the same time", async () => {
    // ⚠ The worst outcome this module can produce is a patient at the wrong hospital, so ambiguity
    // resolves to no answer -- and NOT to outsideRegularWeek, because the time is genuinely offered.
    const { admin } = stubAdmin([saturdayClinic(), saturdayClinic({ id: "b", location_id: "loc-other" })]);
    const v = await locationFromRegularWeek(admin, "ws", SAT_3_OCT_11AM, KAMPALA);
    expect(v.locationId).toBeNull();
    expect(v.outsideRegularWeek).toBe(false);
  });

  it("⚠ A FAILED READ IS NOT AN EMPTY WEEK", async () => {
    // Reporting "outside the regular week" for a query that failed would refuse a real booking and tell
    // the patient the practitioner works nowhere that day.
    const { admin } = stubAdmin(null, { message: "connection reset" });
    const v = await locationFromRegularWeek(admin, "ws", SAT_3_OCT_11AM, KAMPALA);
    expect(v.outsideRegularWeek).toBe(false);
    expect(v.locationId).toBeNull();
    expect(v.reason).toContain("could not be read");
  });
});
