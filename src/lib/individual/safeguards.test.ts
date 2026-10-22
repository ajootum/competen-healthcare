import { describe, it, expect } from "vitest";
import { foldAccess } from "./access";
import { entityLegal, publishedVersions, acceptanceState, DATA_ROLES, type EntityLegal } from "./legal";
import { termsGate } from "./terms";
import { validateGrant, isGrantRefusal } from "./grants";

// The safeguards the COMPETEN-IND-003 owner rulings require: D2 terms acceptance before use, D8 Scholar
// 18+ at grant time, D9 the grant request contract. Each "refuses" case is paired with the case it admits.

const ENV = {
  INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_VERSION: "h-terms-1",
  INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_VERSION: "h-priv-1",
  INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_VERSION: "s-terms-1",
  INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_VERSION: "s-priv-1",
};
const legalFrom = (env: Record<string, string | undefined>) => (e: EntityLegal["entity"]) => entityLegal(e, env);
const H = { termsVersion: "h-terms-1", privacyVersion: "h-priv-1" };
const S = { termsVersion: "s-terms-1", privacyVersion: "s-priv-1" };

describe("D2 legal configuration", () => {
  it("publishes nothing it was not given -- no invented version and no invented company name", () => {
    const l = entityLegal("scholar_operator", {});
    expect(l.terms).toBeNull();
    expect(l.privacy).toBeNull();
    expect(l.registeredName).toBeNull();
    expect(publishedVersions(l)).toBeNull();
  });

  it("needs BOTH documents before anything counts as published", () => {
    expect(publishedVersions(entityLegal("competen_holdings", { INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_VERSION: "t" }))).toBeNull();
    expect(publishedVersions(entityLegal("competen_holdings", ENV))).toEqual({ terms: "h-terms-1", privacy: "h-priv-1" });
  });

  it("treats acceptance of an older version as not accepted", () => {
    expect(acceptanceState({ terms: "v2", privacy: "p1" }, { termsVersion: "v1", privacyVersion: "p1" })).toBe("required");
    expect(acceptanceState({ terms: "v2", privacy: "p1" }, { termsVersion: "v2", privacyVersion: "p1" })).toBe("accepted");
    expect(acceptanceState(null, H)).toBe("unpublished");
  });

  it("keeps the data roles configurable and marked unconfirmed", () => {
    expect(DATA_ROLES.confirmed).toBe(false);
    expect(DATA_ROLES.sharedFoundation.manager).toBe("competen_holdings");
    expect(DATA_ROLES.experienceService.scholar).toBe("scholar_operator");
  });
});

describe("D2 terms gate", () => {
  it("keeps an experience closed while its terms are unpublished, whatever was accepted", () => {
    const g = termsGate({ experience: "scholar", foundationAcceptance: H, experienceAcceptance: [S], legalOf: legalFrom({}) });
    expect(g.usable).toBe(false);
    expect(g.experience.state).toBe("unpublished");
  });

  it("asks a Scholar for BOTH the foundation's and the operator's documents", () => {
    const none = termsGate({ experience: "scholar", foundationAcceptance: null, experienceAcceptance: [], legalOf: legalFrom(ENV) });
    expect([none.foundation.state, none.experience.state, none.usable]).toEqual(["required", "required", false]);
    const onlyFoundation = termsGate({ experience: "scholar", foundationAcceptance: H, experienceAcceptance: [], legalOf: legalFrom(ENV) });
    expect(onlyFoundation.usable).toBe(false);
    const both = termsGate({ experience: "scholar", foundationAcceptance: H, experienceAcceptance: [S], legalOf: legalFrom(ENV) });
    expect(both.usable).toBe(true);
  });

  it("does not make a Professional accept Holdings' identical documents twice", () => {
    const g = termsGate({ experience: "professional", foundationAcceptance: H, experienceAcceptance: [], legalOf: legalFrom(ENV) });
    expect(g.usable).toBe(true);
  });

  it("refuses everything once the foundation publishes a new version", () => {
    const env = { ...ENV, INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_VERSION: "h-terms-2" };
    expect(termsGate({ experience: "professional", foundationAcceptance: H, experienceAcceptance: [], legalOf: legalFrom(env) }).usable).toBe(false);
  });

  it("carries the recorded acceptances out of the access read", () => {
    const a = foldAccess(
      { data: { id: "m", status: "active", foundation_accepted_at: "2026-10-22T00:00:00Z", foundation_terms_version: "h-terms-1", foundation_privacy_version: "h-priv-1" }, error: null },
      { data: [{ experience_code: "scholar", terms_version: "s-terms-1", privacy_version: "s-priv-1" }, { experience_code: "professional", terms_version: null, privacy_version: null }], error: null },
    );
    if (a.state !== "member") throw new Error("expected member");
    expect(a.membership.foundationAcceptance).toEqual(H);
    expect(a.experienceAcceptance.scholar).toEqual([S]);
    expect(a.experienceAcceptance.professional).toBeUndefined();
  });
});

describe("D8 / D9 grant request", () => {
  const id = "11111111-2222-3333-4444-555555555555";

  it("refuses a Scholar grant without the 18+ confirmation", () => {
    const r = validateGrant({ targetUserId: id, experiences: ["scholar"] });
    expect(isGrantRefusal(r) && r.code).toBe("AGE_ELIGIBILITY_REQUIRED");
  });

  it("admits a Scholar grant with it, and a Professional grant without needing it", () => {
    expect(isGrantRefusal(validateGrant({ targetUserId: id, experiences: ["scholar"], adultConfirmed: true }))).toBe(false);
    expect(isGrantRefusal(validateGrant({ targetUserId: id, experiences: ["professional"] }))).toBe(false);
  });

  it("refuses unknown experiences, an empty list and a malformed id", () => {
    expect(isGrantRefusal(validateGrant({ targetUserId: id, experiences: ["recruitment"] }))).toBe(true);
    expect(isGrantRefusal(validateGrant({ targetUserId: id, experiences: [] }))).toBe(true);
    expect(isGrantRefusal(validateGrant({ targetUserId: "bob", experiences: ["professional"] }))).toBe(true);
  });

  it("only treats adultConfirmed === true as confirmation", () => {
    expect(isGrantRefusal(validateGrant({ targetUserId: id, experiences: ["scholar"], adultConfirmed: "yes" }))).toBe(true);
  });
});
