import { describe, expect, it } from "vitest";
import { initialsOf } from "./initials";

describe("initialsOf", () => {
  it("uses the first and the LAST word of a full name, not the first two", () => {
    expect(initialsOf({ fullName: "Amani Grace Odhiambo-Kamau" })).toBe("AO");
    expect(initialsOf({ fullName: "Amani Grace Wanjiru Odhiambo" })).toBe("AO");
  });
  it("uses given and family name when known", () => {
    expect(initialsOf({ givenName: "amani", familyName: "Odhiambo-Kamau", fullName: "Custom Display" })).toBe("AO");
  });
  it("two words, one word, extra spaces", () => {
    expect(initialsOf({ fullName: "Amina Okello" })).toBe("AO");
    expect(initialsOf({ fullName: "  Amina  " })).toBe("A");
    expect(initialsOf({ fullName: "  Amina   Grace   Okello " })).toBe("AO");
  });
  it("falls back to the email, then to ?", () => {
    expect(initialsOf({ fullName: null, email: "zed@example.com" })).toBe("Z");
    expect(initialsOf({ fullName: "", email: null })).toBe("?");
  });
});
