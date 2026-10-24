import type { Blueprint } from "./blueprint";

// Test fixtures shared by the case tests, kept out of any test file so importing one never re-runs its suite.

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
