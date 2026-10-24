import { describe, expect, it } from "vitest";
import { learnerView, validateBlueprint } from "@/lib/cases/blueprint";
import { applyAnswer } from "@/lib/cases/library";
import { judgeOffer } from "@/lib/cases/candidates";
import {
  blueprintFromDraft, caseDebrief, caseSourceKey, checkPrivateCase, markDecision, privateCaseSnapshot, s4CaseBlueprint, verbatimCheck,
} from "./clinical";
import type { Passage } from "./generation";

// COMPETEN-SCHOLAR-CLINICAL-REASONING-01 (Stage 5A): the pure rules of a private case. The routes and the model are
// exercised over HTTP on staging (scripts/scholar-clinical01-harness.ts).

const P = (i: number, content: string): Passage => ({ chunkId: `00000000-0000-4000-8000-00000000000${i}`, materialId: "m", materialTitle: "Oxygen therapy notes", ordinal: i, pageFrom: i, pageTo: i, content });
const PASSAGES = [
  P(1, "Oxygen is a medicine and must be prescribed with a target saturation range. Monitor the oxygen saturation and the respiratory rate."),
  P(2, "A low oxygen saturation shows hypoxaemia. Escalate to the nurse in charge if hypoxaemia worsens."),
];
const COMP = "aced295d-5d77-4f67-8fb6-b346d80fb289";
const DRAFT = {
  title: "Breathless on the ward",
  intro: "A patient on the ward is breathless.",
  stages: ["Recognise the problem", "Decide what to do"],
  facts: [
    { ref: "F1", kind: "observation", label: "Oxygen saturation", value: "low", shown: "request", safetyCritical: true },
    { ref: "F2", kind: "observation", label: "Respiratory rate", value: "monitored", shown: "start" },
  ],
  decisions: [
    { stage: 1, prompt: "What does a low oxygen saturation show?", kind: "single", dimension: "interpretation", canAskFor: ["F1"], sources: ["S2"],
      options: [{ text: "Hypoxaemia", correct: true }, { text: "A target saturation range", correct: false }], rationale: "A low oxygen saturation shows hypoxaemia." },
    { stage: 2, prompt: "Hypoxaemia worsens. What do you do?", kind: "single", dimension: "escalation", sources: ["S2"], safety: "Escalate to the nurse in charge if hypoxaemia worsens.",
      options: [{ text: "Escalate to the nurse in charge", correct: true }, { text: "Monitor the oxygen saturation", correct: false }], rationale: "Escalate to the nurse in charge if hypoxaemia worsens." },
  ],
  objectives: [{ text: "Escalate when hypoxaemia worsens", competencies: ["C1"] }],
};

describe("CR3: a private case is made by code from the draft, and checked", () => {
  const b = blueprintFromDraft(DRAFT, { passages: PASSAGES, competencies: [{ id: COMP }] })!;
  it("assigns ids, runs linear, keeps sources and competencies from their tags, and is a valid private blueprint", () => {
    expect(b.stages.map(s => s.id)).toEqual(["s1", "s2"]);
    expect(b.decisionPoints.map(d => [d.id, d.stageId])).toEqual([["d1", "s1"], ["d2", "s2"]]);
    expect(b.progression).toEqual([]);
    expect(b.decisionPoints[0].permittedReveals).toEqual(["f1"]);
    expect(b.decisionPoints[0].sourceRefs).toEqual([PASSAGES[1].chunkId]);
    expect(b.learningObjectives[0].competencyIds).toEqual([COMP]);
    expect(b.safetyCriteria).toEqual([{ id: "c1", text: "Escalate to the nurse in charge if hypoxaemia worsens.", decisionPointId: "d2", mustSelect: ["a"], mustNotSelect: undefined }]);
    expect(b.metadata.provenance).toEqual({ kind: "private", rights: "student_private" });
    expect(validateBlueprint(b, "private")).toEqual([]);
    expect(checkPrivateCase(b, PASSAGES.map(p => p.content))).toEqual([]);
  });
  it("refuses a case that adds a value the notes do not hold, or identifies a person", () => {
    const invented = blueprintFromDraft({ ...DRAFT, facts: [{ ref: "F1", label: "Oxygen saturation", value: "88%", shown: "start" }] }, { passages: PASSAGES, competencies: [] })!;
    expect(checkPrivateCase(invented, PASSAGES.map(p => p.content)).map(p => p.kind)).toContain("ungrounded");
    const named = blueprintFromDraft({ ...DRAFT, intro: "Mr John Smith, NHS number 943 476 5919, is breathless." }, { passages: PASSAGES, competencies: [] })!;
    expect(checkPrivateCase(named, PASSAGES.map(p => p.content)).map(p => p.kind)).toContain("identifier");
    expect(blueprintFromDraft({ stages: [] }, { passages: PASSAGES, competencies: [] })).toBeNull();
  });
  it("the learner view shows the first stage only, no future stage, no key, no source references", () => {
    const v = learnerView(b, { reachedStageIds: ["s1"], revealedFactIds: [] }, "salt-salt-salt-salt-salt");
    const json = JSON.stringify(v);
    expect(v.stages).toHaveLength(1);
    for (const leak of ["correct", "rationale", "sourceRefs", "Hypoxaemia worsens", PASSAGES[1].chunkId, "Oxygen saturation\":"]) expect(json).not.toContain(leak);
    expect(v.stages[0].decisionPoints[0].canReveal.map(r => r.label)).toEqual(["Oxygen saturation"]);
  });
});

describe("CR2/CR4: played on the shared engine, marked by code, debriefed from the record", () => {
  const b = blueprintFromDraft(DRAFT, { passages: PASSAGES, competencies: [{ id: COMP }] })!;
  it("an answer moves the case on by its own progression, and the last one finishes it", () => {
    const r1 = applyAnswer(b, { reached_stage_ids: ["s1"], revealed_fact_ids: [], answers: [] }, "d1", ["a"], null, "t1");
    expect(r1).toMatchObject({ reached: ["s1", "s2"], completed: false });
    const r2 = applyAnswer(b, { reached_stage_ids: ["s1", "s2"], revealed_fact_ids: [], answers: "answers" in r1 ? r1.answers : [] }, "d2", ["b"], null, "t2");
    expect(r2).toMatchObject({ completed: true, safety: 1 });
  });
  it("marks a choice by its key, never a written answer", () => {
    expect(markDecision(b, "d1", ["a"])).toEqual({ correct: true, score: 1 });
    expect(markDecision(b, "d2", ["b"])).toEqual({ correct: false, score: 0 });
  });
  it("the debrief: by dimension, the safety point missed, the finding never asked for, where to go back to", () => {
    const d = caseDebrief(b, [
      { decisionPointId: "d1", chosen: ["a"], correct: true, safety: [], marking: "deterministic" },
      { decisionPointId: "d2", chosen: ["b"], correct: false, safety: ["c1"], marking: "deterministic" },
    ], [], ["s1", "s2"]);
    expect(d.dimensions).toEqual([{ dimension: "interpretation", answered: 1, correct: 1, written: 0 }, { dimension: "escalation", answered: 1, correct: 0, written: 0 }]);
    expect(d.safetyEvents).toEqual(["Escalate to the nurse in charge if hypoxaemia worsens."]);
    expect(d.missedFindings).toEqual([{ label: "Oxygen saturation" }]);
    expect(d.revisit).toEqual([{ decisionPointId: "d2", chunkIds: [PASSAGES[1].chunkId] }]);
    expect(d.label).toMatch(/not an assessment/);
  });
});

describe("5B, the Scholar side: what is offered, and only that", () => {
  const b = blueprintFromDraft(DRAFT, { passages: PASSAGES, competencies: [{ id: COMP }] })!;
  it("the snapshot drops the student's source references, carries the attestation, and is a valid candidate", () => {
    const s = privateCaseSnapshot(b, "own_notes", "case-attest/1");
    expect(JSON.stringify(s)).not.toContain(PASSAGES[1].chunkId);
    expect(s.metadata.provenance).toEqual({ kind: "candidate", rights: "own_notes", attestationVersion: "case-attest/1" });
    expect(judgeOffer(s, verbatimCheck(s, ["completely different notes about something else entirely"]))).toEqual({ valid: true, reasons: [] });
  });
  it("the verbatim check fails a case that copies twelve words of the notes in a row", () => {
    const copied = { ...b, learnerIntro: "Oxygen is a medicine and must be prescribed with a target saturation range. Monitor the oxygen saturation." };
    expect(verbatimCheck(copied, PASSAGES.map(p => p.content)).passed).toBe(false);
    expect(verbatimCheck(b, PASSAGES.map(p => p.content)).passed).toBe(true);
    expect(caseSourceKey("case", "ABC-123-def")).toBe("scholar:case:abc-123-def");
  });
  it("an existing S4 practice case converts to the minimal private blueprint, as it is", () => {
    const s4 = s4CaseBlueprint([
      { stem: "What do you assess first?", options: ["Airway", "Wound", "Diet", "Visitors"], correctIndex: 0, rationale: "Airway first.", caseTitle: "After surgery" },
      { stem: "What next?", options: ["Escalate", "Wait", "Leave", "Sleep"], correctIndex: 0, rationale: "Escalate." },
    ])!;
    expect(validateBlueprint(s4, "private")).toEqual([]);
    expect(s4.title).toBe("After surgery");
    expect(s4CaseBlueprint([{ stem: "x", options: ["a", "b"], correctIndex: 0, rationale: "r" }])).toBeNull();
  });
});
