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

/**
 * SCHOLAR-CE-2026 CE-04: a SYNTHETIC DRAFT demonstration case for "Talk to the patient" and the SBAR handover task.
 * NOT clinically reviewed and NOT library content: it stays a Case Studio draft until a clinical reviewer approves it
 * (422), and no learner can play it before that. Invented, coarse and generic on purpose. Used by the tests and by
 * scripts/staging-seed-ce04-demo.ts (staging only, owner-run).
 */
export const CE04_DEMO_CODE = "CASE-DEMO-CE04";
export const CE04_DEMO: Blueprint = {
  schema: "case-blueprint/1",
  title: "DRAFT demo: breathless on the ward, then a handover",
  summary: "Synthetic demonstration for the conversation and handover features. Draft. Not clinically reviewed. Not for learners.",
  learnerIntro: "You are the nurse looking after a man in his sixties on a medical ward. He says he is more short of breath than he was.",
  patient: { ageBand: "60-69", sex: "male", setting: "Medical ward", presentingComplaint: "More short of breath since this morning", background: ["Admitted two days ago", "Lives with his wife"] },
  facts: [
    { id: "f_onset", kind: "history", label: "Onset", value: "Short of breath since this morning, worse when he walks to the toilet", revealedAt: "start", safetyCritical: false, aliases: ["when did it start"] },
    { id: "f_cough", kind: "history", label: "Cough", value: "A dry cough for two days", revealedAt: "start", safetyCritical: false },
    { id: "f_pain", kind: "history", label: "Chest pain", value: "No chest pain", revealedAt: "request", safetyCritical: true, aliases: ["pain in chest"] },
    { id: "f_rr1", kind: "observation", label: "Respiratory rate", value: "28", unit: "breaths per minute", revealedAt: "start", safetyCritical: true },
    { id: "f_spo2", kind: "observation", label: "Oxygen saturation", value: "88", unit: "% on room air", revealedAt: "request", safetyCritical: true, aliases: ["sats", "spo2"] },
    { id: "f_rr2", kind: "observation", label: "Respiratory rate now", value: "34", unit: "breaths per minute", revealedAt: "s2", safetyCritical: true },
    { id: "f_alert", kind: "observation", label: "Alertness now", value: "Drowsy, opens eyes to voice", revealedAt: "s2", safetyCritical: true },
  ],
  stages: [
    { id: "s1", title: "First assessment", reveals: [], decisionPointIds: ["d1"] },
    { id: "s2", title: "He is getting worse", reveals: ["f_rr2", "f_alert"], decisionPointIds: ["d2"], narrativeHint: "Ten minutes later his breathing is faster and he is sleepy." },
  ],
  decisionPoints: [
    { id: "d1", stageId: "s1", kind: "single", dimension: "prioritisation", prompt: "What do you do first?", permittedReveals: ["f_spo2", "f_pain"],
      options: [
        { id: "a", text: "Assess his airway and breathing and check his oxygen saturation", correct: true, rationale: "Airway and breathing come first." },
        { id: "b", text: "Finish the medicine round, then come back", correct: false, rationale: "That delays assessing a breathing problem." },
      ] },
    { id: "d2", stageId: "s2", kind: "handover", dimension: "escalation", prompt: "Hand over to the doctor by phone. Write your SBAR handover for him now.", permittedReveals: [], options: [],
      rationale: "A clear handover says what is wrong now, the relevant background, what you found, and what you need and by when.",
      handover: {
        minWords: 4, passMark: 0.7,
        elements: [
          { id: "e_problem", label: "Says the problem: worsening breathlessness", section: "situation", terms: ["breathless", "short of breath", "breathing", "respiratory"] },
          { id: "e_rr", label: "Gives the respiratory rate", section: "assessment", terms: ["34", "respiratory rate", "rr"] },
          { id: "e_spo2", label: "Gives the oxygen saturation", section: "assessment", terms: ["88", "saturation", "spo2", "sats"] },
          { id: "e_alert", label: "Reports he is drowsy", section: "assessment", terms: ["drowsy", "sleepy", "less alert", "reduced alertness"] },
          { id: "e_urgent", label: "Asks for an urgent review", section: "recommendation", terms: ["urgent", "review", "come now", "straight away", "immediately"] },
          { id: "e_support", label: "Says what support he needs now", section: "recommendation", terms: ["oxygen", "monitor", "observations"] },
        ],
      } },
  ],
  progression: [],
  learningObjectives: [{ id: "o1", text: "Recognise a deteriorating breathing problem and hand it over in a structured way", competencyIds: [] }],
  safetyCriteria: [{ id: "c1", text: "Airway and breathing must be assessed first", decisionPointId: "d1", mustSelect: ["a"] }],
  feedback: { debrief: "Draft debrief for the demonstration case.", onSafetyEvent: "Airway and breathing come first." },
  assessment: null, references: [],
  differentials: [{ label: "Chest infection", reasoning: "Draft reasoning for the demonstration." }],
  expectedReasoning: "Draft: he is deteriorating and needs a structured, urgent call.",
  variation: { rules: [] },
  aiBoundary: { patientVoice: true, phraseReveals: false, explain: true },
  voice: {
    speaker: "patient",
    persona: "A man in his sixties on a ward. Anxious but polite. He worries about his wife and wants to know what is happening.",
    style: "Short sentences, a little out of breath, plain everyday words, no medical terms.",
    knowsFactIds: ["f_onset", "f_cough", "f_pain"],
    knowsStatements: [
      { id: "v_worry", text: "I felt fine yesterday, so this has frightened me.", from: "start" },
      { id: "v_wife", text: "My wife is due to visit this afternoon.", from: "start" },
      { id: "v_tired", text: "I feel very tired now and it is hard to keep my eyes open.", from: "s2" },
    ],
    keyQuestions: [
      { id: "q_onset", label: "When the breathlessness started", terms: ["start", "began", "when", "how long", "onset"] },
      { id: "q_pain", label: "Whether he has any chest pain", terms: ["chest pain", "pain"] },
      { id: "q_cough", label: "Whether he has a cough", terms: ["cough"] },
    ],
    notKnownReply: "I'm sorry, I don't know. Nobody has told me.",
  },
  metadata: { level: "foundation", complexity: 2, risk: "standard", professionTermId: null, specialtyTermIds: [], cfcaDomainIds: [], cpuIds: [],
    provenance: { kind: "educator", rights: "educator_original", note: "Synthetic draft for CE-04 demonstration. Not clinically reviewed." } },
};
