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

// SCHOLAR-AI-OPT-01 (owner D3 follow-up, 28 Oct): two of the first three live clinical Learn answers were withheld for
// "the number one" on a section with no "one" in it. Ordinary "one" is not a count; a counted "one" still is.
describe("the number check and the ordinary word 'one'", () => {
  const SECTION = ["Document the call, the advice given and the time. Increase the frequency of observations as agreed, recheck after any intervention, and escalate again if the person does not improve or gets worse."];
  it("'one' in ordinary phrasing is not read as the number 1", () => {
    expect(numbers("One of the things to document is the advice given.", SECTION)).toEqual([]);
    expect(numbers("No one should skip the recheck after any intervention.", SECTION)).toEqual([]);
    expect(numbers("Each one of the observations is repeated as agreed. One way to remember: document, recheck, escalate.", SECTION)).toEqual([]);
    expect(numbers("Which one should you escalate? The one who does not improve.", SECTION)).toEqual([]);
  });
  it("control: 'one' as a quantity is still the number 1, alone or beside an ordinary use", () => {
    expect(numbers("Recheck after one hour.", SECTION)).toEqual([{ kind: "ungrounded_number", token: "one" }]);
    expect(numbers("Give one dose.", SECTION)).toEqual([{ kind: "ungrounded_number", token: "one" }]);
    expect(numbers("One of the signs is confusion; recheck after one hour.", SECTION)).toEqual([{ kind: "ungrounded_number", token: "one" }]);
    expect(numbers("Recheck after one hour.", ["Recheck after 1 hour."])).toEqual([]);
  });
  it("control: every other number word, and the digits, are untouched", () => {
    expect(numbers("One of the two signs.", SECTION)).toEqual([{ kind: "ungrounded_number", token: "two" }]);
    expect(numbers("One of the signs, every 4 hours.", SECTION)).toEqual([{ kind: "ungrounded_number", token: "4" }]);
  });
  it("control: the Practice verifier is unchanged and still reads 'one of' as 1", () => {
    expect(verifyGrounded("One of the findings was noted.", [{ label: "finding noted" }]).filter(v => v.kind === "ungrounded_number"))
      .toEqual([{ kind: "ungrounded_number", token: "one" }]);
  });
});

// SCHOLAR-GUIDED-LEARNING-01 (owner, 31 Oct): a structuring count passes, a safety-critical number stays strict.
describe("the number check and ordinary structuring counts", () => {
  const JC = ["Just Culture distinguishes human error from at-risk behaviour and reckless behaviour. Errors are reported without blame."];
  it("'two types of error', 'three key steps', 'first/second' and 'one of' pass when the notes give no number", () => {
    expect(numbers("There are two types of error in a just culture.", JC)).toEqual([]);
    expect(numbers("The approach has three key steps. First, report. Second, learn.", JC)).toEqual([]);
    expect(numbers("One of the aims is learning, and there are two main ways to report.", JC)).toEqual([]);
  });
  it("control: a count attached to a dose, unit, frequency, duration or a gas term stays strict", () => {
    expect(numbers("Give two tablets.", JC).map(v => v.token)).toEqual(["two"]);
    expect(numbers("The patient had two doses.", JC).map(v => v.token)).toEqual(["two"]);
    expect(numbers("Give 2 mg.", JC).map(v => v.token)).toEqual(["2"]);
    expect(numbers("Give it twice daily.", JC).map(v => v.token)).toEqual(["twice"]);
    expect(numbers("Wait two hours.", JC).map(v => v.token)).toEqual(["two"]);
    expect(numbers("Check the SpO2 two times.", JC).map(v => v.token)).toContain("two");
  });
  it("control: a structural phrase in a sentence with a safety word, or a second non-structural use, stays strict", () => {
    expect(numbers("There are two types of medication error.", JC).map(v => v.token)).toEqual(["two"]);
    expect(numbers("There are two types of error, and two patients were harmed.", JC).map(v => v.token)).toEqual(["two"]);
  });
  it("'twice' is supported only when the notes say it", () => {
    expect(numbers("Turn the patient twice.", ["Turn the patient twice a shift."])).toEqual([]);
    expect(numbers("Turn the patient twice.", ["Turn the patient regularly."]).map(v => v.token)).toEqual(["twice"]);
  });
});

describe("the finding check and morphological variants", () => {
  const findings = (out: string, src: string[]) => textGroundingViolations(out, src).filter(v => v.kind === "asserted_finding").map(v => v.token);
  it("a listed finding word is supported by the same root in the notes", () => {
    expect(findings("Errors were reduced.", ["A reduction in errors followed."])).toEqual([]);
    expect(findings("Care improved.", ["The improvement in care was clear."])).toEqual([]);
    expect(findings("This was significant.", ["Its significance is discussed."])).toEqual([]);
  });
  it("control: a different word, or a word off the list, stays strict", () => {
    expect(findings("The result was normal.", ["An abnormal result needs review."])).toEqual(["normal"]);
    expect(findings("The test was positive.", ["The position of the patient matters."])).toEqual(["positive"]);
    expect(findings("Levels were raised.", ["Staff raise concerns."])).toEqual(["raised"]);
    expect(findings("Errors were reduced.", ["Errors are reported."])).toEqual(["reduced"]);
  });
});
