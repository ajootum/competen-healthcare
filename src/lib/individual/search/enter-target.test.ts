import { describe, expect, it } from "vitest";
import { professionalEnterTarget } from "./enter-target";

describe("professionalEnterTarget", () => {
  it("skips a module with no page search and uses the next area", () => {
    expect(professionalEnterTarget([{ morePath: null }, { morePath: "cpd?q=x" }], "registration#sec-reg")).toBe("cpd?q=x");
  });
  it("falls back to the first record where no area has a search box", () => {
    expect(professionalEnterTarget([{ morePath: null }], "registration#sec-reg")).toBe("registration#sec-reg");
  });
  it("goes nowhere with nothing found", () => {
    expect(professionalEnterTarget([], null)).toBeNull();
  });
});
