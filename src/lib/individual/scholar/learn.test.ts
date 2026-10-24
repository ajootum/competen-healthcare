import { describe, expect, it } from "vitest";
import { planSteps, stepTitle } from "./learn";
import { offeredActions } from "./learn-view";
import { buildLearnerContext } from "./learner-context";
import { STEP_MAX_SECTIONS } from "./config";
import {
  checkCheckQuestion, checkFlags, checkLearnMain, learnSystem, parseVerdict, splitLearnAnswer, FLAG_MARKER, SUPPLEMENTARY_MARKER,
  type GovernedReference, type Passage,
} from "./generation";
import type { SectionRef } from "./store";

// COMPETEN-SCHOLAR-LEARN-01 (owner GO 2026-10-24): the pure pieces of Stage 3. The routes, the store and the
// model are covered over HTTP on staging (scripts/scholar-learn01-harness.ts).

const sec = (id: string, m: string, ordinal: number): SectionRef => ({ chunkId: id, materialId: m, ordinal, pageFrom: ordinal, pageTo: ordinal, materialTitle: m.toUpperCase(), unit: "page" });
const P = (i: number, content: string): Passage => ({ chunkId: `c${i}`, materialId: "m", materialTitle: "Respiratory notes", ordinal: i, pageFrom: i, pageTo: i, content });
const PASSAGES = [
  P(1, "Oxygen is prescribed to a target saturation range. A Venturi mask delivers a fixed concentration of oxygen."),
  P(2, "Hypoxaemia means a low level of oxygen in the blood. Monitor the oxygen saturation and escalate if it falls."),
];
const REFS: GovernedReference[] = [{ title: "Oxygen therapy", code: null, outcome: "Administer oxygen safely to a prescribed target range", status: "Not clinically reviewed" }];

describe("L3: the suggested steps (no AI)", () => {
  const sections = [sec("a1", "a", 1), sec("a2", "a", 2), sec("a3", "a", 3), sec("a4", "a", 4), sec("b1", "b", 1)];
  it("groups consecutive sections of one material, up to the step size, never across materials", () => {
    const { steps, coverage } = planSteps(sections, new Map(), 10);
    expect(steps.map(s => s.sections.map(x => x.chunkId))).toEqual([["a1", "a2", "a3"], ["a4"], ["b1"]]);
    expect(steps.every(s => s.sections.length <= STEP_MAX_SECTIONS)).toBe(true);
    expect(coverage).toEqual({ sections: 5, of: 5 });
  });
  it("starts a new step where the topics change, and states coverage when the steps are capped", () => {
    const topics = new Map([["a1", ["Airway"]], ["a2", ["airway", "Larynx"]], ["a3", ["Gas exchange"]], ["a4", ["gas exchange"]]]);
    expect(planSteps(sections, topics, 10).steps.map(s => s.sections.map(x => x.chunkId))).toEqual([["a1", "a2"], ["a3", "a4"], ["b1"]]);
    const capped = planSteps(sections, topics, 2);
    expect(capped.steps).toHaveLength(2);
    expect(capped.coverage).toEqual({ sections: 4, of: 5 });
  });
  it("names a step by its topics, or by where it is in the notes", () => {
    const [first] = planSteps([sec("a1", "a", 1)], new Map(), 5).steps;
    expect(stepTitle(first, new Map([["a1", ["Airway", "airway", "Larynx"]]]))).toBe("Airway, Larynx");
    expect(stepTitle(first, new Map())).toBe("A, page 1");
  });
});

describe("L2 and s7: four kinds of content, kept apart and checked", () => {
  it("splits the notes, the background and the AI flags, in either order", () => {
    const raw = `Oxygen is prescribed to a target range [S1].\n${FLAG_MARKER}\n- Check the escalation rule in [S2].\n${SUPPLEMENTARY_MARKER}\nGeneral principle.`;
    expect(splitLearnAnswer(raw)).toEqual({ main: "Oxygen is prescribed to a target range [S1].", background: "General principle.", flags: "- Check the escalation rule in [S2]." });
    expect(splitLearnAnswer("Just notes [S1].")).toEqual({ main: "Just notes [S1].", background: null, flags: null });
  });
  it("shows a cited answer that may cite a governed reference, and withholds an invented tag or an added figure", () => {
    expect(checkLearnMain("A Venturi mask delivers a fixed concentration [S1]. This supports your outcome [R1].", "Teach me.", PASSAGES, REFS)).toMatchObject({ ok: true, cited: [1] });
    expect(checkLearnMain("Oxygen is prescribed [S1] and see [R2].", "x", PASSAGES, REFS)).toMatchObject({ ok: false, reason: "bad_citation" });
    expect(checkLearnMain("Oxygen is prescribed [S3].", "x", PASSAGES, REFS)).toMatchObject({ ok: false, reason: "bad_citation" });
    expect(checkLearnMain("Aim for 94 percent [S1].", "x", PASSAGES, REFS)).toMatchObject({ ok: false, reason: "ungrounded" });
    expect(checkLearnMain("A governed reference alone [R1].", "x", PASSAGES, REFS)).toMatchObject({ ok: false, reason: "no_citation" });
    expect(checkLearnMain("NOT_IN_NOTES", "x", PASSAGES, REFS)).toMatchObject({ ok: false, reason: "not_in_notes" });
  });
  it("keeps only flags that cite a given passage and add nothing", () => {
    const r = checkFlags("- The escalation rule in [S2] is unclear: check it with your supervisor.\n- Something uncited.\n- Give 40 percent oxygen [S1].", PASSAGES);
    expect(r.kept.map(f => f.cited)).toEqual([[2]]);
    expect(r.dropped).toBe(2);
    expect(checkFlags(null, PASSAGES)).toEqual({ kept: [], dropped: 0 });
  });
});

describe("L3: the informal check and the clarification", () => {
  it("accepts one grounded open question, and refuses a malformed or ungrounded one", () => {
    expect(checkCheckQuestion("QUESTION: Why is oxygen given to a target saturation range?", PASSAGES)).toEqual({ ok: true, question: "Why is oxygen given to a target saturation range?" });
    expect(checkCheckQuestion("Why oxygen", PASSAGES)).toMatchObject({ ok: false, reason: "malformed" });
    expect(checkCheckQuestion("QUESTION: What does 28 percent mean?", PASSAGES)).toMatchObject({ ok: false, reason: "ungrounded" });
  });
  it("reads the verdict line, and only the three verdicts", () => {
    expect(parseVerdict("VERDICT: partly\nYou named the target range [S1].")).toEqual({ verdict: "partly", rest: "You named the target range [S1]." });
    expect(parseVerdict("**VERDICT: not yet**\nLook again [S2].").verdict).toBe("not_yet");
    expect(parseVerdict("VERDICT: excellent\nWell done [S1].").verdict).toBeNull();
  });
});

describe("L5: what the policy decides", () => {
  it("asks for background only where policy allows it and the action may carry it, and offers references only when there are some", () => {
    expect(learnSystem("teach", { depth: "standard", background: true, references: true })).toContain(SUPPLEMENTARY_MARKER);
    expect(learnSystem("summary", { depth: "standard", background: true, references: false })).not.toContain(SUPPLEMENTARY_MARKER);
    expect(learnSystem("teach", { depth: "standard", background: false, references: false })).not.toContain(SUPPLEMENTARY_MARKER);
    expect(learnSystem("teach", { depth: "brief", background: false, references: true })).toMatch(/under 120 words[\s\S]*GOVERNED REFERENCES/);
    expect(learnSystem("check", { depth: "detailed", background: true, references: true })).not.toMatch(/GOVERNED REFERENCES|CHECK THIS/);
  });
  it("offers the policy's actions, in Scholar's order, starting with the student's choice where it is on", () => {
    const policy = { scholarLearningActions: ["ask", "teach", "summary"] as ("ask" | "teach" | "summary")[], scholarDefaultAction: "teach" as const };
    expect(offeredActions(policy)).toEqual({ actions: ["teach", "summary", "ask"], start: "teach" });
    expect(offeredActions(policy, "summary").start).toBe("summary");
    expect(offeredActions(policy, "deeper").start).toBe("teach");
    expect(offeredActions({ scholarLearningActions: ["summary"], scholarDefaultAction: "teach" }).start).toBe("summary");
  });
  it("pitches to the student's level, words only", () => {
    expect(buildLearnerContext({ programme: "Nursing (Uganda), diploma", level: "Year 2", passageCompetencies: [], progress: null }))
      .toBe("I study: Nursing (Uganda), diploma.\nMy level: Year two. Pitch explanations to it.");
  });
});
