import { describe, expect, it } from "vitest";
import { learnerView, nextStage, safetyEvents, validateBlueprint, variationWithinBounds, type Blueprint } from "./blueprint";

// One blueprint for private, educator and library cases (Stage 5 case interface approval s2), checked against
// IND-004's review: governed facts apart from narrative, reveals per decision point, machine-checkable safety
// criteria, answers server-side only, and Scholar's existing cases valid as they are.

/** Scholar's existing private case (S4): 2 to 5 single-choice steps, a deterministic key, a rationale, no reveals. */
export const MINIMAL_S4: Blueprint = {
  schema: "case-blueprint/1",
  title: "Breathless after surgery",
  facts: [], progression: [], learningObjectives: [], safetyCriteria: [], references: [],
  stages: [{ id: "s1", title: "Step 1", reveals: [], decisionPointIds: ["d1"] }, { id: "s2", title: "Step 2", reveals: [], decisionPointIds: ["d2"] }],
  decisionPoints: [
    { id: "d1", stageId: "s1", kind: "single", prompt: "A patient is breathless two days after surgery. What do you assess first?", permittedReveals: [],
      options: [{ id: "a", text: "Airway and breathing", correct: true, rationale: "Assess A then B first." }, { id: "b", text: "Wound dressing", correct: false, rationale: "Not the priority." }] },
    { id: "d2", stageId: "s2", kind: "single", prompt: "Respiratory rate is 30. What next?", permittedReveals: [],
      options: [{ id: "a", text: "Escalate using SBAR", correct: true, rationale: "A rate of 30 needs urgent review." }, { id: "b", text: "Recheck in an hour", correct: false, rationale: "Delays care." }] },
  ],
  variation: { rules: [] }, aiBoundary: { patientVoice: false, phraseReveals: false, explain: true },
  metadata: { level: "foundation", complexity: 1, risk: "standard", professionTermId: null, specialtyTermIds: [], cfcaDomainIds: [], cpuIds: [],
    provenance: { kind: "private", rights: "student_private" } },
};

const COMP = "aced295d-5d77-4f67-8fb6-b346d80fb289";
const LIBRARY: Blueprint = {
  ...MINIMAL_S4,
  title: "Deteriorating patient on the ward",
  summary: "Recognise and escalate respiratory deterioration.",
  patient: { ageBand: "60-69", sex: "unspecified", setting: "Surgical ward", presentingComplaint: "Breathlessness", background: ["Day 2 after abdominal surgery"] },
  facts: [
    { id: "rr", kind: "observation", label: "Respiratory rate", value: "30", unit: "breaths/min", revealedAt: "s2", safetyCritical: true },
    { id: "spo2", kind: "observation", label: "SpO2", value: "91", unit: "%", revealedAt: "s2", safetyCritical: false },
    { id: "temp", kind: "observation", label: "Temperature", value: "37.9", unit: "C", revealedAt: "s1", safetyCritical: false },
  ],
  decisionPoints: MINIMAL_S4.decisionPoints.map(d => (d.id === "d1" ? { ...d, permittedReveals: ["temp"] } : d)),
  progression: [{ from: "s1", onOptions: ["a"], to: "s2", consequenceFactIds: [] }, { from: "s1", isDefault: true, to: "s2", consequenceFactIds: ["spo2"] }],
  learningObjectives: [{ id: "lo1", text: "Recognise and escalate deterioration", competencyIds: [COMP] }],
  safetyCriteria: [{ id: "sc1", text: "Escalate a rate of 30", decisionPointId: "d2", mustSelect: ["a"], mustNotSelect: ["b"] }],
  feedback: { debrief: "A rising respiratory rate is an early sign.", onSafetyEvent: "Delaying escalation risks harm." },
  variation: { rules: [{ factId: "temp", range: { min: 37.5, max: 38.5 } }] },
  metadata: { ...MINIMAL_S4.metadata, level: "intermediate", complexity: 2, provenance: { kind: "educator", rights: "educator_original" } },
};

describe("the clinical case blueprint", () => {
  it("Scholar's existing private case is a valid private blueprint, as it is", () => {
    expect(validateBlueprint(MINIMAL_S4, "private")).toEqual([]);
  });

  it("a private case is not a library case until it is offered, screened and promoted", () => {
    expect(validateBlueprint(MINIMAL_S4, "library")).toEqual(expect.arrayContaining([expect.stringMatching(/private case cannot be a library case/)]));
  });

  it("a governed library case validates, and one structure serves both", () => {
    expect(validateBlueprint(LIBRARY, "library")).toEqual([]);
    expect(validateBlueprint(LIBRARY, "private")).toEqual([]);
  });

  it("a single choice has exactly one key, every id resolves, progression is deterministic", () => {
    const twoKeys = { ...MINIMAL_S4, decisionPoints: [{ ...MINIMAL_S4.decisionPoints[0], options: MINIMAL_S4.decisionPoints[0].options.map(o => ({ ...o, correct: true })) }, MINIMAL_S4.decisionPoints[1]] };
    expect(validateBlueprint(twoKeys, "private").join(" ")).toMatch(/exactly one correct/);
    const twoDefaults = { ...LIBRARY, progression: [...LIBRARY.progression, { from: "s1", isDefault: true, to: "s1", consequenceFactIds: [] }] };
    expect(validateBlueprint(twoDefaults, "library").join(" ")).toMatch(/only one default/);
    const ghost = { ...LIBRARY, decisionPoints: LIBRARY.decisionPoints.map(d => ({ ...d, permittedReveals: ["nope"] })) };
    expect(validateBlueprint(ghost, "library").join(" ")).toMatch(/unknown fact nope/);
  });

  it("a safety-critical fact never varies, and a variation inside the rules is still the approved version", () => {
    const bad = { ...LIBRARY, variation: { rules: [{ factId: "rr", values: ["24", "30"] }] } };
    expect(validateBlueprint(bad, "library").join(" ")).toMatch(/safety-critical fact rr cannot vary/);
    expect(variationWithinBounds(LIBRARY, { temp: "38.1" })).toBe(true);
    expect(variationWithinBounds(LIBRARY, { temp: "39.5" })).toBe(false);
    expect(variationWithinBounds(LIBRARY, { rr: "24" })).toBe(false);
  });

  it("progression is the blueprint's: by option, by default, or the stages in order", () => {
    expect(nextStage(LIBRARY, "s1", ["a"])).toEqual({ stageId: "s2", consequenceFactIds: [] });
    expect(nextStage(LIBRARY, "s1", ["b"])).toEqual({ stageId: "s2", consequenceFactIds: ["spo2"] });
    expect(nextStage(MINIMAL_S4, "s1", ["b"]).stageId).toBe("s2");
    expect(nextStage(MINIMAL_S4, "s2", ["a"]).stageId).toBeNull();
  });

  it("safety events are machine-checked from the answer", () => {
    expect(safetyEvents(LIBRARY, "d2", ["a"])).toEqual([]);
    expect(safetyEvents(LIBRARY, "d2", ["b"]).map(c => c.id)).toEqual(["sc1"]);
  });

  it("the learner view carries no key, rationale, expected response, rubric, consequence or unrevealed fact", () => {
    const v = learnerView({ ...LIBRARY, decisionPoints: [...LIBRARY.decisionPoints, { id: "d3", stageId: "s2", kind: "free_text", prompt: "Hand over.", permittedReveals: [], options: [], expectedResponse: "SBAR with RR 30", rubric: [{ id: "r1", criterion: "states RR", weight: 1, safetyCritical: true }] }] }, new Set());
    const json = JSON.stringify(v);
    for (const leak of ["correct", "rationale", "expectedResponse", "rubric", "consequence", "safetyCritical", "SBAR with RR 30", "Assess A then B"]) expect(json).not.toContain(leak);
    expect(v.facts.map(f => f.id)).toEqual([]);                       // nothing is revealed at start here
    expect(v.decisionPoints[0].canReveal).toEqual([{ id: "temp", label: "Temperature" }]);
    expect(learnerView(LIBRARY, new Set(["rr"])).facts.map(f => f.id)).toEqual(["rr"]);
  });
});
