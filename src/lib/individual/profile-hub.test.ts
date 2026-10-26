import { describe, expect, it } from "vitest";
import { HUB_KINDS, completion, hubCards, isHubExperience, kindAllowed } from "./profile-hub";
import { parseIdentityPatch } from "./identity";

// COMPETEN-INDIVIDUAL-IDENTITY-HUB-01: the shared Personal & Professional Identity Hub.

const ALL = ["overview", "qualifications", "registrations", "employment", "specialties", "aspirations"] as const;
const both = { scholar: true, professional: true }, scholarOnly = { scholar: true, professional: false };

describe("the cards", () => {
  it("follow the mock-up, with registration and CPD only where Professional is held, and studies only for Scholar", () => {
    expect(hubCards(ALL, "professional", { scholar: false, professional: true }).map(c => c.card))
      .toEqual(["personal", "summary", "education", "registration", "work", "skills", "training", "objectives", "portfolio"]);
    expect(hubCards(ALL, "scholar", scholarOnly).map(c => c.card))
      .toEqual(["personal", "summary", "education", "work", "skills", "training", "objectives", "portfolio", "studies"]);
  });
  it("a record card the configuration removes is not shown; the rest always are", () => {
    const c = hubCards(["qualifications"], "professional", both).map(x => x.card);
    expect(c).toContain("education");
    expect(c).not.toContain("work");
    expect(c).not.toContain("registration");
    expect(c).toContain("personal");
  });
  it("registrations are never added here (their home is My practice), and Scholar never adds a specialty", () => {
    expect(hubCards(ALL, "professional", both).flatMap(c => c.kinds.map(k => k.kind))).not.toContain("registration");
    expect(kindAllowed("professional", "registration")).toBe(false);
    expect(kindAllowed("scholar", "specialty")).toBe(false);
    expect(kindAllowed("scholar", "skill") && kindAllowed("professional", "skill")).toBe(true);
    expect(HUB_KINDS.professional.every(k => kindAllowed("professional", k))).toBe(true);
    expect(isHubExperience("estate")).toBe(false);
  });
});

describe("progressive completion", () => {
  it("counts what is there, requires nothing, and prompts the next three useful things", () => {
    const cards = hubCards(ALL, "scholar", scholarOnly);
    const none = completion(cards, { photo: false, headline: false, biography: false, counts: {} });
    expect(none.done).toBe(0);
    expect(none.prompts.map(p => p.key)).toEqual(["photo", "headline", "biography"]);
    const some = completion(cards, { photo: true, headline: true, biography: true, counts: { qualification: 1 } });
    expect(some.done).toBe(4);
    expect(some.prompts[0].key).toBe("work");
  });
});

describe("the identity fields", () => {
  it("accepts only the four fields, cleaned and bounded", () => {
    const r = parseIdentityPatch({ headline: "  Registered   nurse ", role: "admin", email: "x@y" });
    expect(r).toEqual({ ok: true, patch: { headline: "Registered nurse" } });
    expect(parseIdentityPatch({ headline: "x".repeat(141) }).ok).toBe(false);
    expect(parseIdentityPatch({ biography: "Line one\r\n\r\nLine two" })).toEqual({ ok: true, patch: { biography: "Line one\n\nLine two" } });
    expect(parseIdentityPatch({ location: "" })).toEqual({ ok: true, patch: { location: null } });
    expect(parseIdentityPatch({}).ok).toBe(false);
  });
});
