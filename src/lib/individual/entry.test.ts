import { describe, it, expect } from "vitest";
import {
  requestedExperience, entryDestination, signInHref, experienceOfPath, isIndividualNext, signInProductName, forQuery,
} from "./entry";
import { parseEndDate, validateGrant, isGrantRefusal, normaliseLookupEmail } from "./grants";

// COMPETEN-IND-ACCESS-001 -- entry and destination. Every value these return is one of a fixed set of
// /individual paths; nothing a visitor types can become a redirect target.

describe("entry destinations", () => {
  it("an explicit experience goes straight to it, none goes to the landing (s3)", () => {
    expect(entryDestination("scholar")).toBe("/individual/scholar");
    expect(entryDestination("professional")).toBe("/individual/professional");
    expect(entryDestination(null)).toBe("/individual/home");
  });

  it("the sign-in href carries the destination through the ONE Competen login", () => {
    expect(signInHref("scholar")).toBe("/login?next=%2Findividual%2Fscholar");
    expect(signInHref(null)).toBe("/login?next=%2Findividual%2Fhome");
  });

  it("only a known experience key is honoured as a request -- never echoed input", () => {
    expect(requestedExperience("scholar")).toBe("scholar");
    expect(requestedExperience(["professional", "scholar"])).toBe("professional");
    for (const bad of ["//evil.example", "/individual/scholar", "Scholar", "enterprise", "", undefined, null, 3])
      expect(requestedExperience(bad)).toBeNull();
    expect(forQuery(requestedExperience("https://evil.example"))).toBe("");
  });

  it("the experience a requested path names", () => {
    expect(experienceOfPath("/individual/scholar")).toBe("scholar");
    expect(experienceOfPath("/individual/professional/cpd")).toBe("professional");
    expect(experienceOfPath("/individual/home")).toBeNull();
    expect(experienceOfPath("/individual/scholarship")).toBeNull();
    expect(experienceOfPath("/scholar")).toBeNull();
    expect(experienceOfPath(null)).toBeNull();
  });

  it("an Individual next is a plain /individual path, never an open redirect", () => {
    expect(isIndividualNext("/individual/scholar/learn")).toBe(true);
    for (const bad of ["//evil.example", "/individual", "/individual/../super-admin", "https://x/individual/a", "/individual/a?b=c", "/enterprise"])
      expect(isIndividualNext(bad)).toBe(false);
  });

  it("the sign-in presentation names the product the door was for, and nothing for other products", () => {
    expect(signInProductName("/individual/scholar")).toBe("Competen Scholar");
    expect(signInProductName("/individual/professional/passport")).toBe("Competen Professional");
    expect(signInProductName("/individual/home")).toBe("Competen Individual");
    expect(signInProductName("/enterprise")).toBeNull();
    expect(signInProductName(null)).toBeNull();
  });
});

describe("pilot grant validity (s4)", () => {
  const id = "00000000-0000-4000-8000-000000000001";

  it("an end date is the end of that day in UTC; empty is open-ended; anything else is refused", () => {
    expect(parseEndDate("2027-03-31")).toBe("2027-03-31T23:59:59.999Z");
    expect(parseEndDate("")).toBeNull();
    expect(parseEndDate(undefined)).toBeNull();
    for (const bad of ["2027-02-30", "31/03/2027", "2027-3-1", "tomorrow", 20270331]) expect(parseEndDate(bad)).toBe(false);
  });

  it("validateGrant carries endsAt, and refuses a malformed one before anything is written", () => {
    const ok = validateGrant({ targetUserId: id, experiences: ["professional"], endsOn: "2027-01-15" });
    expect(isGrantRefusal(ok)).toBe(false);
    if (!isGrantRefusal(ok)) expect(ok.endsAt).toBe("2027-01-15T23:59:59.999Z");
    const open = validateGrant({ targetUserId: id, experiences: ["professional"] });
    if (!isGrantRefusal(open)) expect(open.endsAt).toBeNull();
    const bad = validateGrant({ targetUserId: id, experiences: ["professional"], endsOn: "soon" });
    expect(isGrantRefusal(bad) && bad.status).toBe(400);
  });

  it("D8 still holds with a validity date: Scholar without the 18+ confirmation is refused", () => {
    const r = validateGrant({ targetUserId: id, experiences: ["scholar"], endsOn: "2027-01-15" });
    expect(isGrantRefusal(r) && r.code).toBe("AGE_ELIGIBILITY_REQUIRED");
  });

  it("the lookup email is normalised and must look like an address", () => {
    expect(normaliseLookupEmail("  Ada@Example.ORG ")).toBe("ada@example.org");
    for (const bad of ["", "ada", "a@b", "a b@c.d", null, 5]) expect(normaliseLookupEmail(bad)).toBeNull();
  });
});
