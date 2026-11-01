import { describe, expect, it } from "vitest";
import { cautiousIntentFeatures, contextOverlap, intentFeatures, type IntentContext } from "./request-intent";

// Owner instruction 1 Nov 2026 items 5 and 8: context-aware intent, read over the corrected reading as well as the typed one.

const DONABEDIAN: IntentContext = { surface: "learn", lessonTitle: "Donabedian model: structure, process and outcome", materialTopics: ["quality of care"] };

describe("lesson context", () => {
  it("a request about the lesson's content overlaps it; person and action words never do", () => {
    expect(contextOverlap("what about the outcome bit?", DONABEDIAN)).toBe(true);
    expect(contextOverlap("the processes again", DONABEDIAN)).toBe(true);
    expect(contextOverlap("what should I give the patient now", DONABEDIAN)).toBe(false);
    expect(contextOverlap("what about the outcome bit?", { surface: "personal_ai" })).toBe(false);
    expect(contextOverlap("what about the outcome bit?", null)).toBe(false);
    expect(contextOverlap("outcome", { surface: "nope" as never, lessonTitle: "outcome" })).toBe(false);
  });
  it("context is a framing signal only: real-patient evidence is unchanged by it", () => {
    const f = intentFeatures("my patient in bed 3 is septic what now", { ...DONABEDIAN, lessonTitle: "Septic shock: recognition" });
    expect(f.realPatient).not.toBeNull();
    expect(f.contextFraming).toBe(true);
  });
});

describe("cautious over every reading", () => {
  it("a misspelt study verb is study framing", () => {
    expect(intentFeatures("expalin sepssis managment").studyFraming).toBe(false);
    const f = cautiousIntentFeatures("expalin sepssis managment");
    expect(f.studyFraming).toBe(true);
    expect(f.normalised.display).toBe("explain sepssis management");
  });
  it("a misspelt giving decision is still a giving decision (to him: category 4)", () => {
    expect(intentFeatures("shuld i giv him paracetamol").administration).toBe(false);
    const f = cautiousIntentFeatures("shuld i giv him paracetamol");
    expect(f.administration && f.firstPersonAdministration).toBe(true);
    expect(f.realPatient).toBe("administration");
  });
  it("the most serious reason in any reading wins", () => {
    expect(cautiousIntentFeatures("my patient is not breathing right now").realPatient).toBe("emergency");
  });
});
