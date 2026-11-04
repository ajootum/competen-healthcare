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

/**
 * LEARNING-CLOSE-2026-11 CE-04 / CE-05 (SALE-13): a SYNTHETIC demonstration case for the deterioration timeline, the patient
 * conversation, the SBAR handover and the debrief together. NOT clinically reviewed and NOT library content: on staging it is
 * taken through Case Studio, a synthetic independent reviewer and a synthetic publisher as a STAGING EXERCISE only
 * (scripts/staging-seed-ce0405-demo.ts), and retired afterwards. Invented, coarse and generic on purpose. The competency is
 * filled in by the seed (a library case names one); here it is empty.
 *
 * Paths: d1 a then d2 a escalates at minute 5 (in time: the window closes at 15). d2 b ("recheck in 30 minutes") costs 30
 * minutes, so the escalation at d2b comes at minute 40: LATE. Events at minutes 10 and 20 change the observations.
 */
export const CE0405_DEMO_CODE = "CASE-DEMO-CE0405";
export const CE0405_DEMO: Blueprint = {
  schema: "case-blueprint/1",
  title: "DRAFT demo: a man who is getting worse on the ward",
  summary: "Synthetic demonstration for the deterioration timeline, the conversation, the handover and the debrief. Not clinically reviewed. Staging exercise only.",
  learnerIntro: "You are the nurse looking after a man in his seventies on a medical ward. He says he feels more short of breath than earlier.",
  patient: { ageBand: "70-79", sex: "male", setting: "Medical ward", presentingComplaint: "More short of breath than this morning", background: ["Admitted yesterday", "Lives alone"] },
  facts: [
    { id: "f_onset", kind: "history", label: "Onset", value: "Breathless since this morning, worse when he moves", revealedAt: "start", safetyCritical: false },
    { id: "f_pain", kind: "history", label: "Chest pain", value: "No chest pain", revealedAt: "request", safetyCritical: true, aliases: ["pain in chest"] },
    { id: "f_rr", kind: "observation", label: "Respiratory rate", value: "22", unit: "breaths per minute", revealedAt: "start", safetyCritical: true },
    { id: "f_hr", kind: "observation", label: "Heart rate", value: "96", unit: "beats per minute", revealedAt: "start", safetyCritical: false },
    { id: "f_spo2", kind: "observation", label: "Oxygen saturation", value: "94", unit: "% on room air", revealedAt: "request", safetyCritical: true, aliases: ["sats", "spo2"] },
    { id: "f_alert", kind: "observation", label: "Alertness", value: "Alert and talking", revealedAt: "start", safetyCritical: true },
    { id: "f_conf", kind: "examination", label: "New confusion", value: "Not sure where he is", revealedAt: "request", safetyCritical: true },
  ],
  stages: [
    { id: "s1", title: "First look", reveals: [], decisionPointIds: ["d1"] },
    { id: "s2", title: "After your assessment", reveals: [], decisionPointIds: ["d2"] },
    { id: "s2b", title: "Thirty minutes later", reveals: [], decisionPointIds: ["d2b"], narrativeHint: "You come back to him after half an hour." },
    { id: "s3", title: "Hand over", reveals: [], decisionPointIds: ["d3"] },
  ],
  decisionPoints: [
    { id: "d1", stageId: "s1", kind: "single", dimension: "recognition", prompt: "What do you do first?", permittedReveals: ["f_spo2", "f_pain"],
      options: [
        { id: "a", text: "Take a full set of observations and ask him about his breathing", correct: true, rationale: "A full set of observations shows how unwell he is." },
        { id: "b", text: "Come back to him after the medicine round", correct: false, rationale: "That delays assessing a breathing problem." },
      ] },
    { id: "d2", stageId: "s2", kind: "single", dimension: "escalation", prompt: "His observations are worse than this morning. What do you do now?", permittedReveals: [],
      options: [
        { id: "a", text: "Call for an urgent medical review now", correct: true, rationale: "Worsening observations need an urgent review." },
        { id: "b", text: "Give him a drink and recheck the observations in 30 minutes", correct: false, rationale: "Waiting while he gets worse delays care." },
      ] },
    { id: "d2b", stageId: "s2b", kind: "single", dimension: "escalation", prompt: "He is now drowsy and confused. What do you do now?", permittedReveals: [],
      options: [
        { id: "a", text: "Call for an urgent medical review now", correct: true, rationale: "He needs an urgent review now." },
        { id: "b", text: "Let him sleep and check on him later", correct: false, rationale: "Drowsiness here is a sign of deterioration." },
      ] },
    { id: "d3", stageId: "s3", kind: "handover", dimension: "escalation", prompt: "The doctor answers the phone. Write your SBAR handover now.", permittedReveals: [], options: [],
      rationale: "A clear handover says what is wrong now, the background, what you found, and what you need and by when.",
      handover: {
        minWords: 4, passMark: 0.7,
        elements: [
          { id: "e_problem", label: "Says the problem: worsening breathlessness", section: "situation", terms: ["breathless", "short of breath", "breathing"] },
          { id: "e_rr", label: "Gives the respiratory rate", section: "assessment", terms: ["respiratory rate", "rr", "breaths"] },
          { id: "e_spo2", label: "Gives the oxygen saturation", section: "assessment", terms: ["saturation", "spo2", "sats", "oxygen"] },
          { id: "e_alert", label: "Reports a change in alertness", section: "assessment", terms: ["drowsy", "confused", "less alert", "sleepy"] },
          { id: "e_urgent", label: "Asks for an urgent review", section: "recommendation", terms: ["urgent", "review", "come now", "straight away", "immediately"] },
        ],
      } },
  ],
  progression: [
    { from: "s1", isDefault: true, to: "s2", consequenceFactIds: [] },
    { from: "s2", onOptions: ["a"], to: "s3", consequenceFactIds: [] },
    { from: "s2", onOptions: ["b"], to: "s2b", consequenceFactIds: [] },
    { from: "s2b", isDefault: true, to: "s3", consequenceFactIds: [] },
  ],
  learningObjectives: [{ id: "o1", text: "Recognise a deteriorating patient, escalate in time and hand over in a structured way", competencyIds: [] }],
  safetyCriteria: [
    { id: "c1", text: "Assess his breathing before carrying on with other work", decisionPointId: "d1", mustNotSelect: ["b"] },
    { id: "c2", text: "Do not leave a drowsy, confused patient to sleep", decisionPointId: "d2b", mustNotSelect: ["b"] },
  ],
  feedback: { debrief: "Draft debrief for the demonstration case: rising breathing rate and new confusion are signs of deterioration.", onSafetyEvent: "Escalate a deteriorating patient." },
  assessment: null, references: [{ citation: "Synthetic demonstration case: no clinical source (staging exercise only)" }],
  expectedReasoning: "Draft: his observations worsen over time, so he needs an urgent review and a clear handover.",
  variation: { rules: [] },
  aiBoundary: { patientVoice: true, phraseReveals: false, explain: true },
  voice: {
    speaker: "patient",
    persona: "A man in his seventies on a ward. Polite, a little frightened, and tired.",
    style: "Short sentences, a little out of breath, plain everyday words, no medical terms.",
    knowsFactIds: ["f_onset", "f_pain"],
    knowsStatements: [
      { id: "v_alone", text: "I live on my own, so I did not want to be a bother.", from: "start" },
      { id: "v_tired", text: "I feel very tired now.", from: "s2b" },
    ],
    keyQuestions: [
      { id: "q_onset", label: "When the breathlessness started", terms: ["start", "began", "when", "how long"] },
      { id: "q_pain", label: "Whether he has any chest pain", terms: ["chest pain", "pain"] },
    ],
    notKnownReply: "I am sorry, I do not know. Nobody has told me.",
  },
  timeline: {
    costs: { answer: 5, reveal: 2, talkTurn: 1 },
    optionMinutes: [{ decisionPointId: "d2", optionId: "b", minutes: 30 }],
    events: [
      { id: "t10", at: 10, label: "His breathing is faster and his heart rate has gone up", updates: [{ factId: "f_rr", value: "28" }, { factId: "f_hr", value: "112" }] },
      { id: "t20", at: 20, label: "He is drowsy and seems confused", updates: [{ factId: "f_rr", value: "32" }, { factId: "f_spo2", value: "89" }, { factId: "f_alert", value: "Drowsy, opens his eyes when spoken to" }], reveals: ["f_conf"] },
    ],
    escalation: [
      { id: "w_review", label: "Call for an urgent medical review", escalate: [{ decisionPointId: "d2", optionIds: ["a"] }, { decisionPointId: "d2b", optionIds: ["a"] }],
        recognise: [{ decisionPointId: "d1", optionIds: ["a"] }], closesAt: 15, safetyCritical: true },
    ],
  },
  metadata: { level: "foundation", complexity: 2, risk: "standard", professionTermId: null, specialtyTermIds: [], cfcaDomainIds: [], cpuIds: [],
    provenance: { kind: "educator", rights: "educator_original", note: "Synthetic draft for CE-04/CE-05 demonstration. Not clinically reviewed. Staging exercise only." } },
};
