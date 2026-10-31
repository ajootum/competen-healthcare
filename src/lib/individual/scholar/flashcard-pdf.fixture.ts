import type { FlashcardView } from "./flashcards";
import { ORIGIN_LABEL } from "./flashcards";

// SCHOLAR-FLASHCARDS-01 s8-12: a respiratory assessment deck, as loadCardSelection returns one, for the PDF tests and
// the sample files (scripts/flashcard-pdf-samples.ts). Fixture data only: never read by the app.

export const RESP_GENERATED_AT = "2026-10-31T09:30:00.000Z";
const MAT = { id: "00000000-0000-4000-8000-0000000000a1", title: "Respiratory v2" };

let n = 0;
const card = (over: Partial<FlashcardView> & Pick<FlashcardView, "front" | "back">): FlashcardView => {
  n++;
  const origin = over.origin ?? "notes";
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, explanation: null, origin, originLabel: ORIGIN_LABEL[origin],
    topic: "Systematic respiratory assessment", objective: null, keyPoints: [], level: "recall", difficulty: 2,
    competency: { id: "00000000-0000-4000-8000-0000000000c1", title: "CFCA: Respiratory Assessment and Monitoring" },
    sources: origin === "notes" ? [{ origin: "notes", label: "Your uploaded notes", citation: `${MAT.title}, page ${n}`, quote: n === 1 ? "A systematic respiratory assessment follows a consistent order so that nothing is missed, from history through inspection, palpation, percussion and auscultation, and is repeated whenever the condition changes." : null, materialId: MAT.id, chunkId: `chunk-${n}`, libraryVersionId: null, referenceIds: [] }]
      : origin === "library" ? [{ origin: "library", label: "From the Competen library (clinically reviewed)", citation: "Competen library, version 3", quote: null, materialId: null, chunkId: null, libraryVersionId: "lib-v3", referenceIds: [] }]
        : [],
    createdAt: "2026-10-28T10:00:00Z", updatedAt: null, contentVersion: 1, version: "revision-flashcard-v3",
    material: MAT, chunkId: `chunk-${n}`,
    review: { state: "new", nextReviewAt: null, lastReviewedAt: null, reviews: 0, intervalDays: null, ease: null, status: null, history: [] },
    bookmarked: false, note: null, issue: null, deckIds: [], editable: origin === "learner",
    ...over,
  };
};

export const respiratoryCards = (): FlashcardView[] => {
  n = 0;
  return [
    card({
      front: "What are the key components of a systematic respiratory assessment?",
      back: "History, inspection, palpation, percussion and auscultation, followed by observations and a documented plan.",
      explanation: "Working in the same order every time means nothing is missed and changes can be compared between assessments.",
      objective: "Describe the components of a systematic respiratory assessment",
      keyPoints: ["History (e.g. breathlessness, cough)", "Inspection (work of breathing, chest shape)", "Palpation (chest expansion)", "Percussion (resonance or dullness)", "Auscultation (breath sounds)"],
    }),
    card({
      front: "What is the normal respiratory rate for an adult at rest?",
      back: "12 to 20 breaths per minute.",
      topic: "Respiratory rate and oxygen saturation",
      objective: "State normal respiratory rate ranges",
      keyPoints: ["Count for a full 60 seconds", "Adult normal range 12-20 breaths/min"],
    }),
    card({
      front: "What is the normal respiratory rate in children?",
      back: "Age dependent: about 30-40 breaths/min in infants, 20-30 at 1-5 years and 15-20 from about 12 years.",
      topic: "Respiratory rate and oxygen saturation",
      objective: "State normal respiratory rate ranges",
    }),
    card({
      front: "What target SpO₂ range is usual for most acutely ill adults?",
      back: "94-98%, unless the patient is at risk of hypercapnic respiratory failure, when 88-92% is usual (≥ 88%).",
      topic: "Respiratory rate and oxygen saturation",
      objective: "Recall oxygen saturation targets",
      keyPoints: ["SpO2 target 94-98% for most adults", "88-92% where hypercapnia is a risk"],
      sources: [
        { origin: "notes", label: "Your uploaded notes", citation: `${MAT.title}, page 4`, quote: "Target saturation for most acutely ill adults is 94 to 98 percent.", materialId: MAT.id, chunkId: "chunk-4", libraryVersionId: null, referenceIds: [] },
        { origin: "external", label: "Approved references", citation: "Clinically approved references linked to your notes", quote: null, materialId: null, chunkId: null, libraryVersionId: null, referenceIds: ["ref-bts-o2"] },
      ],
    }),
    card({
      front: "What are signs of increased work of breathing?",
      back: "Tachypnoea, nasal flaring, tracheal tug, intercostal or subcostal recession and use of accessory muscles.",
      topic: "Work of breathing",
      objective: "Recognise signs of increased work of breathing",
      keyPoints: ["Tachypnoea and nasal flaring", "Tracheal tug and recession", "Accessory muscle use"],
    }),
    card({
      front: "What does a silent chest suggest in acute asthma?",
      back: "Life-threatening asthma: too little air movement to generate a wheeze. Escalate immediately.",
      origin: "library", topic: "Work of breathing", competency: null, version: "Competen library version 3", level: null,
    }),
    card({
      front: "Which breath sounds are recorded on auscultation?",
      back: "Vesicular breath sounds, and any added sounds such as wheeze, crackles or a pleural rub, compared side to side.",
      objective: "Describe the components of a systematic respiratory assessment",
    }),
    card({
      front: "A 68-year-old with COPD is drowsy with SpO2 86% on room air. What do you do first?",
      back: "Call for help, start controlled oxygen to a target of 88-92%, and get an arterial blood gas to check for CO2 retention.",
      explanation: "In hypercapnic risk, too much oxygen can worsen CO2 retention; reduced consciousness is a red flag for escalation.",
      topic: "Escalation", level: "application", objective: "Apply oxygen targets in a patient at risk of hypercapnia",
      keyPoints: ["Controlled oxygen 88-92%", "Arterial blood gas", "Escalate reduced consciousness"],
    }),
    card({
      front: "A patient's respiratory rate rises from 18 to 26 over two hours. How do you respond?",
      back: "Repeat a full set of observations, calculate the early warning score and escalate per local policy; a rising rate is an early sign of deterioration.",
      topic: "Escalation", level: "reasoning", objective: "Escalate a deteriorating respiratory rate",
    }),
    card({
      front: "Why record findings and escalation clearly?",
      back: "So trends can be compared and the team knows what was found, what was done and when to review.",
      origin: "learner", topic: "Escalation", competency: null, level: null, version: "Your card, version 1",
    }),
  ];
};

/** Another learner's card: must never appear in this learner's download. */
export const otherLearnerFront = "What is the OTHER LEARNER'S private card about pleural effusion?";
