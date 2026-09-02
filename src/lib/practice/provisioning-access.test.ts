/**
 * CPR-PD-PROV-001 §4 step 2 -- the access period as part of a provisioning REQUEST.
 *
 * ⚠ THIS FILE EXISTS FOR ONE ASSERTION, AND IT IS THE HASH. PROV-001 §8 makes the Idempotency-Key the
 * arbiter of a replayed request: same key + same payload hash returns the ORIGINAL result rather than
 * running again. Leaving the chosen period out of the hash would have been invisible in every other
 * test -- a Director who corrected 30 days to 90 and resubmitted under the same key would be handed the
 * first run's answer, told it succeeded, and given the practice the duration they had just changed away
 * from. No type, no route test and no harness would have objected.
 */
import { describe, it, expect } from "vitest";
import { payloadHash, type IndividualRequest } from "./provisioning";

const BASE: IndividualRequest = {
  displayName: "Nakato Family Practice",
  countryCode: "UG",
  timezone: "Africa/Kampala",
  professionCode: "medical_doctor",
  defaultPracticeType: "clinic",
  locale: "en-UG",
  termsVersion: "practice-terms-2026-08",
  privacyNoticeVersion: "practice-privacy-2026-08",
  source: "pilot",
};

const withAccess = (over: Partial<NonNullable<IndividualRequest["access"]>>): IndividualRequest => ({
  ...BASE,
  access: {
    planCode: "practice_trial", basis: "trial",
    startsAt: "2026-09-02T12:00:00.000Z", endsAt: "2026-10-02T12:00:00.000Z",
    ...over,
  },
});

describe("§8 -- the idempotency hash covers the access period", () => {
  it("a different END DATE is a different request", () => {
    expect(payloadHash(withAccess({})))
      .not.toBe(payloadHash(withAccess({ endsAt: "2026-12-01T12:00:00.000Z" })));
  });

  it("a different PLAN is a different request", () => {
    expect(payloadHash(withAccess({})))
      .not.toBe(payloadHash(withAccess({ planCode: "practice_standard" })));
  });

  it("a different BASIS is a different request", () => {
    expect(payloadHash(withAccess({})))
      .not.toBe(payloadHash(withAccess({ basis: "active" })));
  });

  it("a different START is a different request", () => {
    expect(payloadHash(withAccess({})))
      .not.toBe(payloadHash(withAccess({ startsAt: "2026-09-09T12:00:00.000Z" })));
  });

  it("choosing a period at all differs from letting the plan decide", () => {
    // The self-serve path sends no access block. It must not collide with a Director's explicit choice.
    expect(payloadHash(BASE)).not.toBe(payloadHash(withAccess({})));
  });

  it("the SAME period hashes the same, so a genuine replay is still recognised", () => {
    // ⚠ THE CONTROL. Without it, a hash that simply included a random value would pass every case above
    // while destroying idempotency altogether -- every retry would look like a new request.
    expect(payloadHash(withAccess({}))).toBe(payloadHash(withAccess({})));
    expect(payloadHash(BASE)).toBe(payloadHash({ ...BASE }));
  });

  it("an open-ended period differs from a dated one", () => {
    expect(payloadHash(withAccess({ endsAt: null }))).not.toBe(payloadHash(withAccess({})));
  });
});
