import { describe, expect, it } from "vitest";
import { validateLibraryQuestion } from "@/lib/individual/scholar/library-format";
import { fieldsFromQuestionContent, questionContentFromFields } from "./question-format";

// SQIE-CLOSE-2026-11 WS-E: editing a draft in the HQ form keeps its metadata and the provenance the form does not show
// (the pilot batch's references, source verification, competency mapping and calculation).

const pilotKeys = {
  programme_code: "nursing-ug-diploma", programme_label: "Nursing (Uganda), diploma",
  qualification_level: "pre_registration_diploma", qualification_label: "Pre-registration nursing, diploma", difficulty: "intermediate",
  references: [{ id: "RM-10", supports: "MAP formula" }], source_verification: { status: "not_verified", label: "source not verified" },
  competency_mapping: { status: "draft", framework_code: "NUR-CCF", framework_version: "1.0.0" },
  calculation: { value: 66, unit: "mmHg" }, misconception_tags: ["unit-omitted"], topic: "Cardiovascular assessment", question_type: "calculation", pilot_batch: "SQIE-PILOT-2026-11-v1",
};
const shortQ = {
  format: "short", stem: "Calculate the MAP for 102/48 mmHg, as a whole number with its unit.", options: [], answerKey: { accepted: ["66 mmHg"] },
  marking: "deterministic", rationale: "MAP = (102 + 2 x 48) / 3 = 66 mmHg.",
};

describe("HQ form round trip", () => {
  it("an HQ edit round-trips the metadata AND keeps the provenance it does not show", () => {
    const stored = validateLibraryQuestion({ ...shortQ, ...pilotKeys });
    if (!stored.ok) throw new Error(stored.error);
    const fields = fieldsFromQuestionContent(stored.content);
    expect(fields).toMatchObject({ programmeCode: "nursing-ug-diploma", qualificationLevel: "pre_registration_diploma", difficulty: "intermediate" });
    const again = validateLibraryQuestion(questionContentFromFields({ ...fields, accepted: "66 mmHg" }));
    expect(again.ok && again.content).toMatchObject(pilotKeys);
  });
});
