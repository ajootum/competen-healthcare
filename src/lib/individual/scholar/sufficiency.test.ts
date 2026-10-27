import { describe, expect, it } from "vitest";
import { caseReadiness } from "./sufficiency";

// COMPETEN-SCHOLAR-AI-OPT-01 Wave 2: content, not length, decides whether notes can carry a clinical case.

const GLOSSARY = [
  "Glossary for anatomy revision.",
  "The femur is the longest bone in the human body. The tibia is the larger of the two bones of the lower leg.",
  "The humerus is the bone of the upper arm. The scapula is the shoulder blade. The clavicle is the collar bone.",
  "Long bones have a shaft called the diaphysis and two ends called epiphyses.",
].join("\n");

// Short, but it follows a patient: presentation, what it means, what is done, what happens next.
const SHORT_CASE_READY = [
  "A patient with sepsis presents with a raised respiratory rate and new confusion. Low blood pressure is a warning sign.",
  "These signs indicate possible organ dysfunction. Escalate for prompt senior review.",
  "After any intervention, recheck the observations and escalate again if the person does not improve.",
].join("\n");

// The acceptance note's observation section: what to record, but nothing done and nothing following.
const OBSERVATIONS_ONLY = "A full set of observations includes respiratory rate, oxygen saturation, blood pressure, pulse rate, level of consciousness or new confusion, and temperature. Respiratory rate is the earliest and most sensitive sign of deterioration.";

describe("caseReadiness", () => {
  it("notes with no presentation and no action are insufficient, however long, and Teach me is offered", () => {
    const long = Array.from({ length: 20 }, () => GLOSSARY).join("\n");
    const r = caseReadiness([long], "case_steps");
    expect(r.outcome).toBe("insufficient");
    expect(r.alternative).toBe("teach");
    expect(r.message).toMatch(/what a patient presents with/);
  });
  it("short notes that follow a patient are sufficient: length is not the test", () => {
    expect(SHORT_CASE_READY.split(/\s+/).length).toBeLessThan(60);
    const r = caseReadiness([SHORT_CASE_READY], "case_steps");
    expect(r.outcome).toBe("sufficient");
    expect(r.message).toBeNull();
  });
  it("findings with nothing done about them support a case question instead, and say what is missing", () => {
    const r = caseReadiness([OBSERVATIONS_ONLY], "case_steps");
    expect(r.outcome).toBe("simpler");
    expect(r.alternative).toBe("case_question");
    expect(r.missing).toContain("action");
    expect(r.message).toMatch(/case question/);
  });
  it("reads across several sections for the Apply case", () => {
    const r = caseReadiness([OBSERVATIONS_ONLY, "Escalate using SBAR. After escalation, increase the frequency of observations and recheck after any intervention."], "case_blueprint");
    expect(r.outcome).toBe("sufficient");
  });
  it("a single stray clinical word is not enough for sufficient", () => {
    const r = caseReadiness(["Pain is subjective. Escalate concerns."], "case_steps");
    expect(r.outcome).not.toBe("sufficient");
  });
});
