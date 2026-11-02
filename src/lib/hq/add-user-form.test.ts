import { describe, expect, it } from "vitest";
import { displayDate, endDateFor, individualBody, individualReady, individualRefusalText, individualSuccess, type IndividualForm } from "./add-user-form";

const NOW = new Date("2026-11-02T10:00:00Z");
const form: IndividualForm = {
  email: " a@example.org ", givenName: "Amina", middleNames: "", familyName: "Okello", preferredName: "", accountType: "human",
  scholar: true, professional: false, adultConfirmed: true, endsOn: "2027-01-31", participation: "regular", expiresInDays: "14",
  phone: "", country: "", note: "", profession: "Nurse", qualification: "", institution: "", programme: "", trainingLevel: "", organisation: "", facility: "", position: "",
};

describe("Add User -- individual path", () => {
  it("names exactly what was given", () => {
    expect(individualSuccess({ email: "a@example.org", scholar: true, professional: false, endsOn: "2027-01-31" }))
      .toBe("Invitation sent to a@example.org. Competen Scholar until 31 Jan 2027. No organisation role.");
    expect(individualSuccess({ email: "a@example.org", scholar: true, professional: true, endsOn: "2027-01-31", warnings: ["Careful."] }))
      .toBe("Invitation sent to a@example.org. Competen Scholar and Competen Professional until 31 Jan 2027. No organisation role. Careful.");
  });
  it("dates are fixed in UTC and presets count from today", () => {
    expect(displayDate("2027-01-31")).toBe("31 Jan 2027");
    expect(endDateFor(30, NOW)).toBe("2026-12-02");
    expect(endDateFor(365, NOW)).toBe("2027-11-02");
  });
  it("posts the ordinary basis, the typed parts, and only the optional values that were filled in", () => {
    expect(individualBody(form)).toEqual({
      basis: "ordinary", email: "a@example.org", givenName: "Amina", familyName: "Okello", prefill: { profession: "Nurse" },
      experiences: ["scholar"], adultConfirmed: true, endsOn: "2027-01-31", participation: "regular", expiresInDays: 14, accountType: "human",
    });
  });
  it("is ready only with names, an email, a product, the 18+ confirmation and a valid end date", () => {
    expect(individualReady(form, NOW)).toBe(true);
    expect(individualReady({ ...form, givenName: " " }, NOW)).toBe(false);
    expect(individualReady({ ...form, adultConfirmed: false }, NOW)).toBe(false);
    expect(individualReady({ ...form, scholar: false, professional: false }, NOW)).toBe(false);
    expect(individualReady({ ...form, endsOn: "" }, NOW)).toBe(false);
    expect(individualReady({ ...form, endsOn: "2026-11-01" }, NOW)).toBe(false);
    expect(individualReady({ ...form, endsOn: "2027-11-04" }, NOW)).toBe(false);
    expect(individualReady({ ...form, endsOn: "2027-11-03" }, NOW)).toBe(true);
    expect(individualReady({ ...form, scholar: false, professional: true, adultConfirmed: false }, NOW)).toBe(true);
  });
  it("explains each refusal in plain words", () => {
    expect(individualRefusalText({ status: 403 })).toMatch(/Individual access right/);
    expect(individualRefusalText({ status: 404 })).toMatch(/not switched on/);
    expect(individualRefusalText({ status: 409, code: "ACCOUNT_EXISTS" })).toMatch(/already has a Competen account/);
    expect(individualRefusalText({ status: 503, code: "NOT_SET_UP" })).toMatch(/not set up/);
    expect(individualRefusalText({ status: 400, message: "Pick a date." })).toBe("Pick a date.");
  });
});
