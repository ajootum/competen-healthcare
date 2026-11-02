import { describe, expect, it } from "vitest";
import { grantStanding, offerFilter, type OfferGrant, type OfferVersion } from "./offer";

const NOW = Date.parse("2026-11-03T10:00:00Z");
const v = (o: Partial<OfferVersion> = {}): OfferVersion => ({
  instrumentId: "i1", code: "CHK-RESP-ASSESS", name: "Respiratory assessment", versionId: "v1", versionNo: 1, state: "published", title: null, summary: null,
  deliveryModes: ["self_assessment"], respondentRoles: ["self"], methodCodes: ["self_assessment"], ...o,
});
const g = (o: Partial<OfferGrant> = {}): OfferGrant => ({
  id: "g1", instrumentId: "i1", acceptedAt: null, endedAt: null, validFrom: "2026-11-01T00:00:00Z", validUntil: null, respondentName: "A. Assessor", reason: "Placement", ...o,
});

describe("what a learner is offered", () => {
  it("offers nothing while the policy list is empty, whatever is published", () => {
    expect(offerFilter({ policyCodes: [], versions: [v()], grants: [], now: NOW })).toEqual([]);
  });
  it("offers a published instrument that is in the policy list and allows self-assessment, with Start Self-Assessment", () => {
    const [c] = offerFilter({ policyCodes: ["CHK-RESP-ASSESS"], versions: [v()], grants: [], now: NOW });
    expect(c).toMatchObject({ code: "CHK-RESP-ASSESS", selfAssessment: true, assessorLed: null, modes: ["self_assessment"], title: "Respiratory assessment" });
  });
  it("does not offer an instrument whose code is not in the policy list", () => {
    expect(offerFilter({ policyCodes: ["OTHER-ONE"], versions: [v()], grants: [], now: NOW })).toEqual([]);
  });
  it("does not offer an instrument whose published version does not allow self-assessment", () => {
    expect(offerFilter({ policyCodes: ["CHK-RESP-ASSESS"], versions: [v({ deliveryModes: ["assessor_led"], respondentRoles: ["assessor"] })], grants: [], now: NOW })).toEqual([]);
  });
  it("never offers a draft, in review, approved or retired version", () => {
    for (const state of ["draft", "in_review", "approved", "retired"]) expect(offerFilter({ policyCodes: ["CHK-RESP-ASSESS"], versions: [v({ state })], grants: [], now: NOW })).toEqual([]);
  });
  it("offers the latest published version", () => {
    const cards = offerFilter({ policyCodes: ["CHK-RESP-ASSESS"], versions: [v({ versionId: "v1" }), v({ versionId: "v2", versionNo: 2 }), v({ versionId: "v3", versionNo: 3, state: "draft" })], grants: [], now: NOW });
    expect(cards).toHaveLength(1);
    expect(cards[0].versionId).toBe("v2");
  });
  it("adds an assessor-led card only beside a grant for this learner: awaiting acceptance, then live", () => {
    const both = v({ deliveryModes: ["self_assessment", "assessor_led"], respondentRoles: ["self", "assessor"] });
    expect(offerFilter({ policyCodes: ["CHK-RESP-ASSESS"], versions: [both], grants: [], now: NOW })[0].assessorLed).toBeNull();
    expect(offerFilter({ policyCodes: ["CHK-RESP-ASSESS"], versions: [both], grants: [g()], now: NOW })[0].assessorLed).toMatchObject({ standing: "awaiting_acceptance", grantId: "g1", assessorName: "A. Assessor" });
    expect(offerFilter({ policyCodes: ["CHK-RESP-ASSESS"], versions: [both], grants: [g({ acceptedAt: "2026-11-02T00:00:00Z" })], now: NOW })[0].assessorLed?.standing).toBe("live");
  });
  it("shows an assessor-led card from a grant even when the policy does not list the instrument for self-assessment, and then offers no self-assessment", () => {
    const both = v({ deliveryModes: ["self_assessment", "assessor_led"], respondentRoles: ["self", "assessor"] });
    const [c] = offerFilter({ policyCodes: [], versions: [both], grants: [g({ acceptedAt: "2026-11-02T00:00:00Z" })], now: NOW });
    expect(c.selfAssessment).toBe(false);
    expect(c.assessorLed?.standing).toBe("live");
    expect(c.modes).toEqual(["assessor_led"]);
  });
  it("ignores an ended grant, one not yet valid and one that has expired", () => {
    const both = v({ deliveryModes: ["self_assessment", "assessor_led"], respondentRoles: ["self", "assessor"] });
    for (const grant of [g({ endedAt: "2026-11-02T00:00:00Z" }), g({ validFrom: "2026-12-01T00:00:00Z" }), g({ validUntil: "2026-11-02T00:00:00Z" })]) {
      expect(offerFilter({ policyCodes: ["CHK-RESP-ASSESS"], versions: [both], grants: [grant], now: NOW })[0].assessorLed).toBeNull();
    }
  });
  it("needs the definition to allow an assessor respondent for an assessor-led card", () => {
    expect(offerFilter({ policyCodes: [], versions: [v()], grants: [g({ acceptedAt: "2026-11-02T00:00:00Z" })], now: NOW })).toEqual([]);
  });
  it("a live grant outranks one still awaiting acceptance, and the cards are sorted by name", () => {
    const both = v({ deliveryModes: ["self_assessment", "assessor_led"], respondentRoles: ["self", "assessor"] });
    const [c] = offerFilter({ policyCodes: ["CHK-RESP-ASSESS"], versions: [both], grants: [g({ id: "a" }), g({ id: "b", acceptedAt: "2026-11-02T00:00:00Z" })], now: NOW });
    expect(c.assessorLed?.grantId).toBe("b");
    const two = offerFilter({ policyCodes: ["CHK-RESP-ASSESS", "AAA-FIRST"], versions: [v(), v({ instrumentId: "i2", code: "AAA-FIRST", name: "Airway", versionId: "w1" })], grants: [], now: NOW });
    expect(two.map(x => x.name)).toEqual(["Airway", "Respiratory assessment"]);
  });
  it("grantStanding is null for anything that offers nothing", () => {
    expect(grantStanding(g(), NOW)).toBe("awaiting_acceptance");
    expect(grantStanding(g({ acceptedAt: "2026-11-02T00:00:00Z" }), NOW)).toBe("live");
    expect(grantStanding(g({ endedAt: "2026-11-02T00:00:00Z", acceptedAt: "2026-11-02T00:00:00Z" }), NOW)).toBeNull();
  });
});
