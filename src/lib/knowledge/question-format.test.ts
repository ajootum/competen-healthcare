import { describe, expect, it } from "vitest";
import { questionContentFromFields, fieldsFromQuestionContent } from "./question-format";
import { libraryKeyText, validateLibraryQuestion } from "@/lib/individual/scholar/library-format";

// SQIE-LIBRARY-EXPANSION-01: what the educator form builds is exactly what Scholar's validator accepts.
const R = "Because the evidence in the guideline says so.";

describe("the educator form builds what the validator accepts", () => {
  it("each format from plain form fields, and back", () => {
    const forms: Record<string, Record<string, unknown>> = {
      mcq: { format: "mcq", stem: "Which drug reverses opioid toxicity?", options: ["Naloxone", "Flumazenil", "Atropine", "Glucagon"], correctIndex: 0, rationale: R },
      mrq: { format: "mrq", stem: "Which are signs of sepsis? Choose all.", options: ["Fever", "Tachycardia", "Bradypnoea", "Hypotension"], correct: [0, 1, 3], rationale: R },
      true_false: { format: "true_false", stem: "Naloxone reverses benzodiazepine toxicity.", truth: "false", rationale: R },
      extended: { format: "extended", stem: "Explain the initial management of anaphylaxis.", modelAnswer: "Call for help, give adrenaline, support the airway.", keyPoints: "Help\nAdrenaline\nAirway", marks: "6", rationale: R },
      sequence: { format: "sequence", stem: "Put the steps of hand hygiene in order.", steps: "Wet hands\nApply soap\nRinse", rationale: R },
      structured: { format: "structured", stem: "A patient presents with chest pain. Answer the parts.", parts: [{ prompt: "What test first?", marks: 1, accepted: "ECG" }, { prompt: "Which enzyme?", marks: 2, accepted: "Troponin\nTroponin I" }], rationale: R },
      match: { format: "match", stem: "Match each drug to its class.", pairs: [{ prompt: "Amoxicillin", match: "Penicillin" }, { prompt: "Furosemide", match: "Loop diuretic" }, { prompt: "Metoprolol", match: "Beta blocker" }], rationale: R },
    };
    for (const [f, form] of Object.entries(forms)) {
      const content = questionContentFromFields(form);
      const v = validateLibraryQuestion(content);
      expect(v, f).toMatchObject({ ok: true });
      if (!v.ok) continue;
      const again = validateLibraryQuestion(questionContentFromFields(fieldsFromQuestionContent(v.content)));
      expect(again.ok && again.content, f).toEqual(v.content);
    }
    // A single best answer question without a rubric stays in the 442 shape exactly.
    expect("format" in questionContentFromFields(forms.mcq)).toBe(false);
    // A sequence is stored shuffled, and its key restores the order the educator gave.
    const seq = validateLibraryQuestion(questionContentFromFields(forms.sequence));
    expect(seq.ok && libraryKeyText(seq.content)).toBe("Wet hands -> Apply soap -> Rinse");
    expect(seq.ok && (seq.content.options as string[]).join("|")).not.toBe("Wet hands|Apply soap|Rinse");
  });
});
