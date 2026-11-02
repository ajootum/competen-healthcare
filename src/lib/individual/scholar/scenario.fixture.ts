// Canned model outputs for the scenario quality tests (SCHOLAR-CE-2026 CE-05): a good clinical scenario and the three ways a reply is wrong.
import type { Passage } from "./generation";

export const NOTE = [
  "A raised respiratory rate is often the first sign that a person is getting worse.",
  "An early warning score combines several observations, such as respiratory rate, oxygen saturation, heart rate and blood pressure.",
  "A rising score means the person should be escalated to a senior colleague or doctor.",
  "If the oxygen saturation falls, give oxygen as prescribed and recheck the observations.",
  "Sepsis may be suspected when a person has a fever and a fast heart rate.",
].join("\n");
export const passage: Passage = { chunkId: "c1", materialId: "m1", materialTitle: "Recognising deterioration", ordinal: 1, pageFrom: 1, pageTo: 1, content: NOTE };

export const common = {
  rationale: "The notes describe the signs, the score and what is done.", sourceQuote: "A rising score means the person should be escalated to a senior colleague or doctor.",
  difficulty: 2, level: "application", objective: "Follow a person who is getting worse.", keyPoints: ["A rising score means escalation"], misconceptions: [], references: [],
};

/** 1. A GOOD reply: a person in practice, new information at each stage, a decision at each, each stage cited. */
export const GOOD = {
  ...common,
  situation: "A person on a medical ward has had their observations taken, and the early warning score has been worked out.",
  stages: [
    {
      reveal: "", prompt: "What should happen when the score is rising?", kind: "mcq",
      options: ["The person should be escalated to a senior colleague or doctor", "The observations should be left", "The person should be discharged", "The score should be ignored"], correct: [0], weight: 1,
      keyPoint: "A rising score means the person should be escalated to a senior colleague or doctor.", source: "A rising score means the person should be escalated to a senior colleague or doctor.",
    },
    {
      reveal: "Some time later the oxygen saturation falls.", prompt: "What should be done about the oxygen?", kind: "short", accepted: ["give oxygen as prescribed"], weight: 2,
      keyPoint: "Give oxygen as prescribed and recheck the observations.", source: "If the oxygen saturation falls, give oxygen as prescribed and recheck the observations.",
    },
    {
      reveal: "The person now also has a fever and a fast heart rate.", prompt: "What may be suspected?", kind: "mcq", options: ["Sepsis", "Dehydration", "Anxiety", "Pain"], correct: [0], weight: 2,
      keyPoint: "Sepsis may be suspected when a person has a fever and a fast heart rate.", source: "Sepsis may be suspected when a person has a fever and a fast heart rate.",
    },
  ],
};

/** 2. ANSWER LEAKAGE: the opening names what stage 1 asks for. */
export const LEAKING = {
  ...GOOD,
  situation: "A person on a medical ward is getting worse. A raised respiratory rate is often the first sign, and an early warning score combines several observations.",
  stages: [
    {
      reveal: "", prompt: "What is often the first sign that a person is getting worse?", kind: "mcq", options: ["A raised respiratory rate", "A fever", "A fast heart rate", "A low blood pressure"], correct: [0], weight: 1,
      keyPoint: "A raised respiratory rate is often the first sign that a person is getting worse.", source: "A raised respiratory rate is often the first sign that a person is getting worse.",
    },
    GOOD.stages[1],
  ],
};

/** 3. FRAMED AS A STUDENT REVISING NOTES (the owner's own example). */
export const STUDENT_FRAMED = {
  ...GOOD,
  situation: "A healthcare student is revising how to recognise when a person is getting worse. Their notes say a raised respiratory rate is often the first sign, and that an early warning score combines several observations.",
  stages: [{ ...GOOD.stages[0], prompt: "According to the notes, what should happen when the score is rising?" }, GOOD.stages[1]],
};

/** 4. AN UNCITED FINDING: a stage whose citation is not in the section (an invented management step). */
export const UNCITED = {
  ...GOOD,
  stages: [GOOD.stages[0], { ...GOOD.stages[1], source: "Start a bolus of fluids and repeat the blood gas straight away." }],
};


/** The staging learner's real "Recognising deterioration: short notes" section (four lines of guidance), and the SHAPE of what the live model wrote from it. */
export const DET_NOTE = [
  "Recognising deterioration: short notes",
  "1. A raised respiratory rate is often the first sign that a person is getting worse, so count it over a full minute.",
  "2. Use an early warning score such as NEWS2 to combine respiratory rate, oxygen saturation, blood pressure, pulse, temperature and level of consciousness.",
  "3. A new confusion or a drop in the level of consciousness is a red flag and needs urgent escalation.",
  "4. Escalate using SBAR: situation, background, assessment and recommendation, and record the escalation.",
].join("\n");
export const detPassage: Passage = { chunkId: "c2", materialId: "m2", materialTitle: "Recognising deterioration", ordinal: 1, pageFrom: 1, pageTo: 1, content: DET_NOTE };
const DET_SRC = DET_NOTE.split("\n").slice(1).map(l => l.replace(/^[0-9]+[.] /, ""));
export const LIVE_FOUR_STAGES = {
  situation: "A person on the ward looks less well than earlier in the shift. A member of staff begins a set of observations to see whether the person is getting worse.",
  stages: [
    { reveal: "", prompt: "Which observation is often the first sign that a person is getting worse?", kind: "mcq", options: ["A raised respiratory rate", "A drop in blood pressure", "A raised temperature", "A change in pulse"], correct: [0], weight: 1, keyPoint: "A raised respiratory rate is often the first sign of deterioration.", source: DET_SRC[0], references: [] },
    { reveal: "The team decide to use an early warning score to bring the observations together.", prompt: "Which observations does NEWS2 combine?", kind: "short", accepted: ["respiratory rate, oxygen saturation, blood pressure, pulse, temperature and level of consciousness"], weight: 2, keyPoint: "NEWS2 combines respiratory rate, oxygen saturation, blood pressure, pulse, temperature and level of consciousness.", source: DET_SRC[1], references: [] },
    { reveal: "Shortly afterwards the person becomes newly confused.", prompt: "What does this new confusion mean and what does it need?", kind: "mcq", options: ["It is a sign the person is improving", "It should be rechecked over a full minute", "It is a red flag and needs urgent escalation", "It is expected and needs no action"], correct: [2], weight: 2, keyPoint: "A new confusion is a red flag that needs urgent escalation.", source: DET_SRC[2], references: [] },
    { reveal: "A colleague prepares to escalate the person's deterioration.", prompt: "Which structure should be used to escalate?", kind: "short", accepted: ["SBAR", "Escalate using SBAR"], weight: 2, keyPoint: "Escalate using SBAR and record the escalation.", source: DET_SRC[3], references: [] },
  ],
  rationale: "The passage states a raised respiratory rate is often the first sign, NEWS2 combines the listed observations, new confusion is a red flag and SBAR is used to escalate.",
  sourceQuote: DET_SRC[2], difficulty: 2, level: "application", objective: "Recognise early deterioration and escalate.", keyPoints: ["A raised respiratory rate is often the first sign"], misconceptions: [], references: [],
};
