/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { NO_SUGGESTIONS, groupSuggestions, loadSuggestions } from "./suggestions";

const TAX = [{ id: "t-prof", kind: "profession" }, { id: "t-body", kind: "registration_body" }, { id: "t-spec", kind: "specialty" }];

describe("taxonomy suggestions (COMPETEN-CONFIG-002 item 8)", () => {
  it("groups terms by kind, keeps the vocabulary order, trims and drops duplicates and other kinds", () => {
    expect(groupSuggestions(TAX, [
      { taxonomy_id: "t-prof", value: "Nursing" }, { taxonomy_id: "t-prof", value: "  Medicine " }, { taxonomy_id: "t-prof", value: "nursing" },
      { taxonomy_id: "t-body", value: "Nursing and Midwifery Council" }, { taxonomy_id: "t-spec", value: "Oncology" },
      { taxonomy_id: "t-prof", value: "" }, { taxonomy_id: "t-gone", value: "Orphan" },
    ])).toEqual({ profession: ["Nursing", "Medicine"], registrationBody: ["Nursing and Midwifery Council"] });
  });

  it("with no registration_body kind, that field simply has no suggestions", () => {
    expect(groupSuggestions([TAX[0]], [{ taxonomy_id: "t-prof", value: "Pharmacy" }])).toEqual({ profession: ["Pharmacy"], registrationBody: [] });
  });

  it("fails soft to no suggestions, so the fields stay plain free text", async () => {
    expect(await loadSuggestions({ from: () => { throw new Error("down"); } })).toEqual(NO_SUGGESTIONS);
    const errored: any = { from: () => ({ select: () => ({ in: async () => ({ data: null, error: { message: "x" } }) }) }) };
    expect(await loadSuggestions(errored)).toEqual(NO_SUGGESTIONS);
  });
});
