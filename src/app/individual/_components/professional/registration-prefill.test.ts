import { describe, expect, it } from "vitest";
import { fieldProps } from "./registration";

// HFE-01 Wave 3 (F6): the Professional setup offers the shared profile's country as the starting answer for
// where the person practises -- never over something already on record, and never saved by itself.
const spec = { key: "jurisdiction", label: "Country or jurisdiction where you practise", required: true, input: "select",
  options: [{ code: "kenya", label: "Kenya" }, { code: "uganda", label: "Uganda" }] } as never;
const none = { profession: [] } as never;

describe("registration prefill", () => {
  it("selects the profile country when nothing is on record", () => {
    expect(fieldProps(spec, null, none, { country: "Kenya" })).toMatchObject({ code: "kenya" });
  });
  it("offers a country outside the list as typed text", () => {
    expect(fieldProps(spec, null, none, { country: "Atlantis" })).toMatchObject({ code: null, value: "Atlantis" });
  });
  it("never replaces what is already on record, and does nothing without a profile country", () => {
    const row = { practice_jurisdiction_code: "uganda", self_declared_practice_jurisdiction: "Uganda" } as never;
    expect(fieldProps(spec, row, none, { country: "Kenya" })).toMatchObject({ code: "uganda" });
    expect(fieldProps(spec, null, none, { country: null })).toMatchObject({ code: null, value: null });
  });
  it("touches no other field", () => {
    const other = { ...(spec as object), key: "profession" } as never;
    expect(fieldProps(other, null, none, { country: "Kenya" })).toMatchObject({ code: null, value: null });
  });
});
