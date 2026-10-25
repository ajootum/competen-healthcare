import { describe, expect, it } from "vitest";
import { textGroundingViolations, verifyGrounded } from "./grounding";

// The number check reads named gas terms (SpO2, O2, CO2 ...) as names, not as the number 2 (IND-004, staging,
// 25 October 2026). Every assertion that it now PASSES something is paired with a control proving the same sentence
// shape still FAILS when it carries a real invented quantity, so the narrowing cannot hide a loosening.

const NOTES = ["Oxygen saturation is measured with a pulse oximeter. Give oxygen as prescribed and escalate a falling saturation."];
const numbers = (out: string, src = NOTES) => textGroundingViolations(out, src).filter(v => v.kind === "ungrounded_number");

describe("the number check and named gas terms", () => {
  it("SpO2, O2, CO2 and the blood-gas names are not read as the number 2", () => {
    expect(numbers("Check the SpO2 and escalate.")).toEqual([]);
    expect(numbers("Give O2 as prescribed.")).toEqual([]);
    expect(numbers("A rising CO2 or PaCO2 means escalate. Note the FiO2, SaO2 and EtCO2.")).toEqual([]);
  });

  it("control: a quantity next to a named term is still checked", () => {
    expect(numbers("Give O2 at 2 L/min.")).toEqual([{ kind: "ungrounded_number", token: "2" }]);
    expect(numbers("Keep SpO2 above 94%.")).toEqual([{ kind: "ungrounded_number", token: "94" }]);
    expect(numbers("Give O2 at 2 L/min.", ["Give oxygen at 2 L/min."])).toEqual([]);
  });

  it("control: a digit attached to letters is still a number where it is a quantity (q6h when the source says q4h)", () => {
    expect(numbers("Observe q6h.", ["Observe q4h."])).toEqual([{ kind: "ungrounded_number", token: "6" }]);
    expect(numbers("Give it 2x daily.")).toEqual([{ kind: "ungrounded_number", token: "2" }]);
  });

  it("control: only the exact names are excused, so a look-alike is still a number", () => {
    expect(numbers("Give O3 now.")).toEqual([{ kind: "ungrounded_number", token: "3" }]);
    expect(numbers("Check the SpO22.")).toEqual([{ kind: "ungrounded_number", token: "22" }]);
  });

  it("the Practice verifier reads the payload the same way: a fact that says SpO2 grounds no number", () => {
    expect(verifyGrounded("SpO2 92% on air.", [{ label: "SpO2", detail: "on air" }]).filter(v => v.kind === "ungrounded_number"))
      .toEqual([{ kind: "ungrounded_number", token: "92" }]);
  });
});
