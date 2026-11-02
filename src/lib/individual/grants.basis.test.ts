import { describe, it, expect } from "vitest";
import { validateGrant, isGrantRefusal, ordinaryEndDateRefusal, ORDINARY_MAX_ACCESS_DAYS } from "./grants";
import { ORDINARY_MAX_ACCESS_DAYS as FROM_INVITATIONS } from "./invitations";

// The HQ grant to an existing account has two bases. "pilot" (default) is today's behaviour. "complimentary" is
// an ordinary invitee given more access later: source hq_grant, end date REQUIRED, at most 366 days.

const id = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-11-02T10:00:00Z");
const base = { targetUserId: id, experiences: ["professional"] };

describe("validateGrant -- basis", () => {
  it("defaults to pilot: source pilot, the end date optional (open-ended allowed)", () => {
    const r = validateGrant(base, now);
    expect(isGrantRefusal(r)).toBe(false);
    if (!isGrantRefusal(r)) { expect(r.source).toBe("pilot"); expect(r.basis).toBe("pilot"); expect(r.endsAt).toBeNull(); }
    const dated = validateGrant({ ...base, basis: "pilot", endsOn: "2030-01-01" }, now);
    if (!isGrantRefusal(dated)) expect(dated.endsAt).toBe("2030-01-01T23:59:59.999Z");
  });
  it("complimentary requires the end date", () => {
    for (const endsOn of [undefined, null, ""]) {
      const r = validateGrant({ ...base, basis: "complimentary", endsOn }, now);
      expect(isGrantRefusal(r) && [r.status, r.code]).toEqual([400, "END_DATE_REQUIRED"]);
    }
  });
  it("complimentary maps to source hq_grant", () => {
    const r = validateGrant({ ...base, basis: "complimentary", endsOn: "2027-01-31" }, now);
    expect(isGrantRefusal(r)).toBe(false);
    if (!isGrantRefusal(r)) { expect(r.source).toBe("hq_grant"); expect(r.basis).toBe("complimentary"); expect(r.endsAt).toBe("2027-01-31T23:59:59.999Z"); }
  });
  it("complimentary: today is allowed, yesterday is not, 366 days is the cap", () => {
    expect(isGrantRefusal(validateGrant({ ...base, basis: "complimentary", endsOn: "2026-11-02" }, now))).toBe(false);
    const past = validateGrant({ ...base, basis: "complimentary", endsOn: "2026-11-01" }, now);
    expect(isGrantRefusal(past) && past.message).toBe("The access end date must be today or later.");
    expect(isGrantRefusal(validateGrant({ ...base, basis: "complimentary", endsOn: "2027-11-03" }, now))).toBe(false); // +366
    const far = validateGrant({ ...base, basis: "complimentary", endsOn: "2027-11-04" }, now); // +367
    expect(isGrantRefusal(far) && far.message).toBe("Access can be given for at most 366 days.");
  });
  it("a malformed date or an unknown basis is refused", () => {
    expect(isGrantRefusal(validateGrant({ ...base, basis: "complimentary", endsOn: "soon" }, now))).toBe(true);
    const odd = validateGrant({ ...base, basis: "free", endsOn: "2027-01-31" }, now);
    expect(isGrantRefusal(odd) && odd.code).toBe("VALIDATION_ERROR");
  });
  it("D8 still holds for a complimentary Scholar grant", () => {
    const r = validateGrant({ targetUserId: id, experiences: ["scholar"], basis: "complimentary", endsOn: "2027-01-31" }, now);
    expect(isGrantRefusal(r) && r.code).toBe("AGE_ELIGIBILITY_REQUIRED");
  });
  it("shares one rule and one cap with the ordinary invitation", () => {
    expect(ORDINARY_MAX_ACCESS_DAYS).toBe(366);
    expect(FROM_INVITATIONS).toBe(366);
    expect(ordinaryEndDateRefusal("2027-01-31", null, now)?.code).toBe("END_DATE_REQUIRED");
    expect(ordinaryEndDateRefusal("2027-01-31", "2027-01-31T23:59:59.999Z", now)).toBeNull();
  });
});
