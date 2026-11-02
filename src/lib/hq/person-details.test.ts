import { describe, expect, it } from "vitest";
import { cleanPersonDetails, cleanPrefill, composeFullName, isParticipation, PREFILL_KEYS } from "./person-details";

// Migration 850 / owner GO "HQ User Management, Invitations and Individual Profile Completion" (2 Nov 2026).

describe("composeFullName", () => {
  it("joins given, middle and family in that order, collapsing spaces", () => {
    expect(composeFullName({ givenName: "Amina", middleNames: "Grace  Atim", familyName: "Okello" })).toBe("Amina Grace Atim Okello");
    expect(composeFullName({ givenName: "Amina", middleNames: null, familyName: "Okello" })).toBe("Amina Okello");
  });
  it("is null when there are no parts: it never invents a name", () => {
    expect(composeFullName({ givenName: null, middleNames: null, familyName: null })).toBeNull();
  });
});

describe("cleanPersonDetails", () => {
  it("cleans the six details and treats blank as not recorded", () => {
    expect(cleanPersonDetails({ givenName: " Amina ", middleNames: "", familyName: "Okello", preferredName: " Mina ", phone: "+256 700 000000", country: "Uganda" }))
      .toEqual({ ok: true, value: { givenName: "Amina", middleNames: null, familyName: "Okello", preferredName: "Mina", phone: "+256 700 000000", country: "Uganda" } });
  });
  it("applies the own-profile limits and the phone rule", () => {
    expect(cleanPersonDetails({ givenName: "x".repeat(101) })).toMatchObject({ ok: false });
    expect(cleanPersonDetails({ middleNames: "x".repeat(101) })).toMatchObject({ ok: false });
    expect(cleanPersonDetails({ country: "x".repeat(81) })).toMatchObject({ ok: false });
    expect(cleanPersonDetails({ phone: "call me" })).toMatchObject({ ok: false });
    expect(cleanPersonDetails({ preferredName: "x".repeat(81) })).toMatchObject({ ok: false });
    expect(cleanPersonDetails({ givenName: 4 })).toMatchObject({ ok: false });
  });
  it("refuses parts whose composed full name is longer than a full name may be", () => {
    expect(cleanPersonDetails({ givenName: "a".repeat(50), middleNames: "b".repeat(50), familyName: "c".repeat(50) })).toMatchObject({ ok: false });
  });
  it("accepts a body with none of them", () => {
    expect(cleanPersonDetails({})).toMatchObject({ ok: true });
  });
});

describe("cleanPrefill -- an allowlist", () => {
  it("keeps only the allowlisted keys, trimmed, and drops blanks", () => {
    const r = cleanPrefill({ profession: " Nurse ", institution: "", role: "super_admin", email: "x@y.z" });
    expect(r).toEqual({ ok: true, value: { profession: "Nurse" } });
  });
  it("is null when nothing remains, and for no prefill", () => {
    expect(cleanPrefill({ institution: " " })).toEqual({ ok: true, value: null });
    expect(cleanPrefill(undefined)).toEqual({ ok: true, value: null });
  });
  it("refuses non-text, an over-long value and a non-object", () => {
    expect(cleanPrefill({ profession: 3 })).toMatchObject({ ok: false });
    expect(cleanPrefill({ position: "x".repeat(201) })).toMatchObject({ ok: false });
    expect(cleanPrefill({ position: "x".repeat(200) })).toMatchObject({ ok: true });
    expect(cleanPrefill(["a"])).toMatchObject({ ok: false });
    expect(cleanPrefill("nurse")).toMatchObject({ ok: false });
  });
  it("the allowlist is exactly the eight agreed keys", () => {
    expect([...PREFILL_KEYS]).toEqual(["profession", "qualification", "institution", "programme", "trainingLevel", "organisation", "facility", "position"]);
  });
});

describe("participation", () => {
  it("is one of regular, pilot, staff_tester", () => {
    expect(["regular", "pilot", "staff_tester"].every(isParticipation)).toBe(true);
    expect(isParticipation("admin")).toBe(false);
    expect(isParticipation(undefined)).toBe(false);
  });
});
