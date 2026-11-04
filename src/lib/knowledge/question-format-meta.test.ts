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

// SQIE-CLOSE-2026-11 (997): calculation, safety markers and the structured variants, authored in the HQ form, saved by the
// validator exactly as scoring-rules.ts reads them, and copied to the learner unchanged.
import { libraryCopyOf as copyOf, libraryKeyText } from "@/lib/individual/scholar/library-format";
import { calculationSpecOf } from "@/lib/individual/scholar/scoring-rules";

const calcFields = {
  format: "calculation", stem: "Run 500 mL over 4 hours. Calculate the rate in mL/h to one decimal place.", rationale: "500 / 4 = 125.0 mL/h.",
  calc: { value: "125", unit: "mL/h", equivalentUnits: "", roundingMode: "decimal_places", places: "1", toleranceKind: "percent", toleranceAmount: "5", safetyCritical: true, working: "500 / 4", unsafe: "" },
};

describe("calculation in the library (WS-A contract)", () => {
  it("the form builds a key the scoring rules read; the copy is a short item with answer.format calculation", () => {
    const v = validateLibraryQuestion(questionContentFromFields(calcFields));
    if (!v.ok) throw new Error(v.error);
    expect(v.content.answerKey).toMatchObject({ format: "calculation", value: 125, unit: "mL/h", rounding: { mode: "decimal_places", places: 1 }, tolerance: { kind: "percent", amount: 5 }, safetyCritical: true, accepted: ["125 mL/hour"] });
    const copy = copyOf(v.content)!;
    expect(copy.kind).toBe("short");
    expect(calculationSpecOf(copy.answer)).toMatchObject({ value: 125, unit: "mL/h", safetyCritical: true });
    expect(libraryKeyText(v.content)).toBe("125 mL/hour");
  });
  it("round-trips through the form", () => {
    const v = validateLibraryQuestion(questionContentFromFields(calcFields));
    if (!v.ok) throw new Error(v.error);
    const again = validateLibraryQuestion(questionContentFromFields(fieldsFromQuestionContent(v.content)));
    expect(again.ok && again.content).toEqual(v.content);
  });
  it("refuses what the scoring rules refuse, field by field", () => {
    const bad = (calc: Record<string, unknown>) => validateLibraryQuestion(questionContentFromFields({ ...calcFields, calc: { ...calcFields.calc, ...calc } }));
    expect(bad({ unit: "mL/h", equivalentUnits: "mg" })).toMatchObject({ ok: false, error: expect.stringMatching(/equivalentUnits/) });
    expect(bad({ value: "125.04" })).toMatchObject({ ok: false, error: expect.stringMatching(/not rounded/) });
    expect(bad({ toleranceAmount: "20" })).toMatchObject({ ok: false, error: expect.stringMatching(/tolerance/) });
    expect(bad({ value: "" }).ok).toBe(false);
  });
  it("safety-critical by default", () => {
    const v = validateLibraryQuestion({ format: "calculation", stem: "Give 1.5 mg/kg to a 70 kg adult. Calculate the dose.", rationale: "70 x 1.5 = 105 mg.", options: [], answerKey: { value: 105, unit: "mg" }, marking: "deterministic" });
    expect(v.ok && (v.content.answerKey as Record<string, unknown>).safetyCritical).toBe(true);
  });
});

describe("safety markers and structured variants (WS-B / WS-C contracts)", () => {
  it("short: safety-critical and unsafe answers kept and round-tripped", () => {
    const v = validateLibraryQuestion(questionContentFromFields({ format: "short", stem: "Name the first action for a patient with no pulse.", rationale: "Start compressions and call for help.", accepted: "Start chest compressions", safetyCritical: true, unsafe: "Wait and reassess" }));
    if (!v.ok) throw new Error(v.error);
    expect(v.content.answerKey).toEqual({ accepted: ["Start chest compressions"], safetyCritical: true, unsafe: ["Wait and reassess"] });
    expect(fieldsFromQuestionContent(v.content)).toMatchObject({ safetyCritical: true, unsafe: "Wait and reassess" });
  });
  it("extended: safety-critical key points must be key points", () => {
    const base = { format: "extended", stem: "Explain how you would assess a deteriorating adult.", rationale: "ABCDE finds the most urgent problem first.", modelAnswer: "Assess A, B, C, D and E in turn and escalate early.", keyPoints: "Airway first\nBreathing\nEscalate early", rubric: { level: "application" } };
    const ok = validateLibraryQuestion(questionContentFromFields({ ...base, safetyCriticalPoints: [0, 2], unsafe: "Leave the patient" }));
    expect(ok.ok && ok.content.answerKey).toMatchObject({ safetyCriticalPoints: [0, 2], unsafe: ["Leave the patient"] });
    expect(validateLibraryQuestion(questionContentFromFields({ ...base, safetyCriticalPoints: [5] })).ok).toBe(false);
  });
  it("structured answer and justify: a choice part, criteria, markers; round trip", () => {
    const fields = { format: "structured", stem: "SpO2 86% on air and breathless.", rationale: "Hypoxaemia needs oxygen titrated to target.", variant: "answer_justify", parts: [
      { prompt: "What do you do first?", marks: 1, accepted: "", role: "answer", options: "Give oxygen\nGive paracetamol", correct: 0, criteria: [], safetyCritical: true, unsafe: "Give paracetamol" },
      { prompt: "Justify your choice.", marks: 3, accepted: "Hypoxaemia is life-threatening", role: "justify", options: "", correct: "", criteria: [{ text: "Names hypoxaemia", weight: 2, safetyCritical: true }], safetyCritical: false, unsafe: "" },
    ] };
    const v = validateLibraryQuestion(questionContentFromFields(fields));
    if (!v.ok) throw new Error(v.error);
    const parts = (v.content.answerKey as { parts: Record<string, unknown>[]; variant: string }).parts;
    expect((v.content.answerKey as { variant: string }).variant).toBe("answer_justify");
    expect(parts[0]).toMatchObject({ accepted: ["Give oxygen"], options: ["Give oxygen", "Give paracetamol"], correct: 0, role: "answer", safetyCritical: true, unsafe: ["Give paracetamol"] });
    expect(parts[1]).toMatchObject({ role: "justify", criteria: [{ text: "Names hypoxaemia", weight: 2, safetyCritical: true }] });
    const again = validateLibraryQuestion(questionContentFromFields(fieldsFromQuestionContent(v.content)));
    expect(again.ok && again.content).toEqual(v.content);
  });
  it("an interpretation question needs its findings; an empty choice index is never read as the first option", () => {
    const parts = [{ prompt: "What do they suggest?", marks: 2, accepted: "Respiratory compromise", role: "interpret" }, { prompt: "What do you do?", marks: 2, accepted: "Escalate", options: "Escalate\nWait", correct: "" }];
    expect(validateLibraryQuestion(questionContentFromFields({ format: "structured", stem: "Interpret these observations.", rationale: "Several parameters are abnormal.", variant: "interpretation", parts: parts.slice(0, 1).concat([{ prompt: "What do you do?", marks: 2, accepted: "Escalate", role: "answer" }]) })))
      .toMatchObject({ ok: false, error: expect.stringMatching(/findings/) });
    const withChoice = validateLibraryQuestion(questionContentFromFields({ format: "structured", stem: "Interpret these observations.", rationale: "Several parameters are abnormal.", findings: [{ label: "RR", value: "26", unit: "/min" }], variant: "interpretation", parts }));
    expect(withChoice).toMatchObject({ ok: false, error: expect.stringMatching(/choice part/) });
  });
});

import { presentQuestion } from "./question-present";
describe("the reviewer sees what they approve (997)", () => {
  it("a calculation: answer, units, rounding, a tolerance marked NOT in use, safety", () => {
    const v = validateLibraryQuestion(questionContentFromFields(calcFields));
    if (!v.ok) throw new Error(v.error);
    const items = JSON.stringify(presentQuestion(v.content)?.blocks);
    expect(items).toMatch(/Answer: 125 mL\/hour/);
    expect(items).toMatch(/NOT in use/);
    expect(items).toMatch(/tenfold/);
  });
  it("a structured answer-and-justify: kind, choice, weighted criteria, safety", () => {
    const v = validateLibraryQuestion({ format: "structured", stem: "SpO2 86% on air and breathless.", rationale: "Hypoxaemia needs oxygen titrated to target.", options: [], marking: "deterministic",
      answerKey: { variant: "answer_justify", parts: [
        { prompt: "What do you do first?", marks: 1, accepted: ["Give oxygen"], role: "answer", options: ["Give oxygen", "Give paracetamol"], correct: 0, unsafe: ["Give paracetamol"] },
        { prompt: "Justify your choice.", marks: 3, accepted: ["Hypoxaemia"], role: "justify", criteria: [{ text: "Names hypoxaemia", weight: 2, safetyCritical: true }] }] } });
    if (!v.ok) throw new Error(v.error);
    const items = JSON.stringify(presentQuestion(v.content)?.blocks);
    expect(items).toMatch(/Answer and justify/);
    expect(items).toMatch(/Names hypoxaemia \(2\) -- safety-critical/);
    expect(items).toMatch(/Unsafe answer .*Give paracetamol/);
  });
});
