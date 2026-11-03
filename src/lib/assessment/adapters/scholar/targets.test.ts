import { describe, expect, it } from "vitest";
import { describeTarget, TARGET_KIND_COMPETENCY, TARGET_KIND_INSTRUMENT } from "./targets";

describe("describeTarget", () => {
  const labels = new Map([[`${TARGET_KIND_INSTRUMENT}:i1`, "Ward audit (RA-1)"], [`${TARGET_KIND_COMPETENCY}:c1`, "Hand hygiene (HH)"]]);
  it("shows the kind and the code and name", () => {
    expect(describeTarget({ kind: "instrument", ref: "i1" }, labels)).toBe("Checklist instrument: Ward audit (RA-1)");
    expect(describeTarget({ kind: "competency", ref: "c1" }, labels)).toBe("Competency: Hand hygiene (HH)");
  });
  it("says so when there is no target, and falls back to the id when the label is unreadable", () => {
    expect(describeTarget({ kind: "person_stage", ref: null }, labels)).toBe("No target (set at creation)");
    expect(describeTarget({ kind: "instrument", ref: "abcdef1234" }, labels)).toBe("Checklist instrument: abcdef12");
  });
});
