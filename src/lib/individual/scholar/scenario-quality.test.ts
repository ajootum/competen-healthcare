/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { checkRevisionDraft } from "./revision";
import { REVISION_SYSTEM, revisionPromptVersion, runRevisionQuestions } from "./generation";
import { citationFlaw, parseScenarioRaw, scenarioFlaw, SCENARIO_INSUFFICIENT_NOTE, SCENARIO_SCOPE_LINE, stageAnswers } from "./scenario";
import { caseReadiness } from "./sufficiency";
import { unsupportedTerms } from "./question-quality";
import { GOOD, LEAKING, NOTE, STUDENT_FRAMED, UNCITED, passage } from "./scenario.fixture";

// SCHOLAR-CE-2026 CE-05, owner decision 2 Nov ("content quality correction"): a scenario is a patient-centred clinical story that develops, asks a
// decision at each stage, gives no stage's answer away earlier, invents nothing, and cites every stage. These are canned model outputs (a small
// representative set, not an evaluation programme): what a good reply looks like, and the three ways a reply is wrong.

const verdict = (raw: unknown, refs: any = {}) => { const c = checkRevisionDraft("scenario", raw, passage, refs); return c.ok ? "accepted" : c.reason; };

describe("canned model outputs: what is accepted and what is refused", () => {
  it("1. a good clinical scenario is accepted, with every stage cited", () => {
    expect(verdict(GOOD)).toBe("accepted");
    const c = checkRevisionDraft("scenario", GOOD, passage);
    expect(c.ok && (c.draft.answer as any).stages.every((s: any) => s.source.length > 20)).toBe(true);
  });
  it("2. a reply whose opening gives away a stage's answer is refused", () => {
    expect(verdict(LEAKING)).toBe("answer_leaked");
  });
  it("3. a reply framed around a student revising notes is refused (the owner's own example)", () => {
    expect(scenarioFlaw(parseScenarioRaw(STUDENT_FRAMED as any)!)).toBe("not_a_scenario");
    expect(verdict(STUDENT_FRAMED)).toBe("not_a_scenario");
  });
  it("4. a reply with a finding or action the section does not hold is refused", () => {
    expect(verdict(UNCITED)).toBe("uncited_stage");
  });
});

describe("the validation rules, one at a time", () => {
  const sc = (mut: (r: any) => void) => { const r = JSON.parse(JSON.stringify(GOOD)); mut(r); return r; };
  it("answer leakage: a stage's key or correct option text in the opening or an EARLIER stage's reveal or question, normalised, two or more content words", () => {
    expect(verdict(sc(r => { r.stages[0].prompt = "The person may need to give oxygen as prescribed, so what should happen when the score is rising?"; }))).toBe("answer_leaked");
    expect(verdict(sc(r => { r.stages[2].reveal = "Oxygen is given: give oxygen as prescribed, and the person now also has a fever and a fast heart rate."; }))).toBe("accepted"); // a LATER stage may mention an earlier answer
    expect(verdict(sc(r => { r.stages[0].reveal = ""; r.situation = `${r.situation} The Raised-Respiratory RATE is noted.`; r.stages[0].options[0] = "Raised respiratory rate"; r.stages[0].keyPoint = "x"; }))).not.toBe("accepted");
    // a single content word is not held to the rule, and a synonym is not considered
    const single = parseScenarioRaw(sc(r => { r.situation += " Sepsis is on the ward's mind."; }) as any)!;
    expect(scenarioFlaw(single)).toBeNull();
  });
  it("a stage that repeats another's answer is refused", () => {
    expect(verdict(sc(r => { r.stages[2] = { ...r.stages[1], reveal: "Later still the oxygen saturation falls again.", prompt: "What should be done about it now?" }; }))).toBe("repeated_stage");
  });
  it("stems that talk of notes, a passage, a learner or revising are refused, in any stage", () => {
    for (const text of ["Your notes say it is serious.", "The notes also say it is serious.", "A learner is revising this topic.", "As in the passage, the person is unwell."])
      expect(verdict(sc(r => { r.stages[1].reveal = `Some time later the oxygen saturation falls. ${text}`; })), text).toBe("not_a_scenario");
  });
  it("every stage must be cited: no source, a source quoted from nowhere, or a key the source does not support", () => {
    expect(verdict(sc(r => { delete r.stages[1].source; }))).toBe("uncited_stage");
    expect(verdict(sc(r => { r.stages[2].source = "Sepsis is always fatal without antibiotics."; }))).toBe("uncited_stage");
    expect(verdict(sc(r => { r.stages[0].source = "An early warning score combines several observations, such as respiratory rate, oxygen saturation, heart rate and blood pressure."; }))).toBe("uncited_stage");
    expect(verdict(sc(r => { r.stages[1].accepted = ["start a fluid bolus"]; }))).not.toBe("accepted");
  });
  it("an approved reference given for this session is a citation; a reference never given is not", () => {
    const spec = parseScenarioRaw(sc(r => { delete r.stages[2].source; r.stages[2].references = ["R1"]; }) as any)!;
    const refs = new Map([["R1", "Sepsis may be suspected with a fever and a fast heart rate"]]);
    expect(citationFlaw(spec.stages, NOTE, refs, unsupportedTerms)).toBeNull();
    expect(citationFlaw(spec.stages, NOTE, new Map(), unsupportedTerms)).toBe("uncited_stage");
    expect(stageAnswers(spec.stages[2])).toEqual(["Sepsis"]);
  });
  it("the stage that is cited keeps its citation, for the feedback", () => {
    const c = checkRevisionDraft("scenario", GOOD, passage);
    expect(c.ok && (c.draft.answer as any).stages[1].source).toBe("If the oxygen saturation falls, give oxygen as prescribed and recheck the observations.");
  });
});

describe("the prompt and the level", () => {
  it("scholar-scenario-v2: a patient-centred clinical story, no invented findings, a decision per stage, cited", () => {
    expect(revisionPromptVersion("scenario")).toBe("scholar-scenario-v2");
    const p = REVISION_SYSTEM.scenario;
    for (const must of ["PATIENT-CENTRED CLINICAL SCENARIO", "NEVER mention notes", "MUST reveal NEW clinical information", "NO LEAKAGE", "NOTHING INVENTED", "never repeats a question", "If the passage does not describe", "reply []"])
      expect(p, must).toContain(must);
  });
  const generate = async (level: string | null) => {
    const users: string[] = [];
    const run = async (g: any) => { users.push(g.user); return { ok: true as const, text: JSON.stringify([GOOD]), model: "fake", provider: "fake" } as never; };
    const r = await runRevisionQuestions("u1", "scenario", passage, 3, run as any, { context: { concepts: [], competency: null, level, difficulty: null, mode: "notes", references: [] } });
    return { r, user: users[0] };
  };
  it("the learner's level reaches the prompt, with the scope line", async () => {
    const { r, user } = await generate("Adult nursing, second year");
    expect(r.ok && r.kept).toHaveLength(1);
    expect(user).toContain("MY LEVEL: Adult nursing, second year");
    expect(user).toContain(SCENARIO_SCOPE_LINE);
  });
  it("with no level the scope is a neutral pre-registration healthcare student", async () => {
    const { user } = await generate(null);
    expect(user).toContain(SCENARIO_SCOPE_LINE);
    expect(SCENARIO_SCOPE_LINE).toContain("pre-registration healthcare student");
    expect(user).not.toContain("MY LEVEL:");
  });
  it("a leaking reply is dropped and the one retry the generation pattern allows is used", async () => {
    const replies = [JSON.stringify([LEAKING]), JSON.stringify([GOOD])];
    const parts: string[] = [];
    const run = async (_g: any, part?: string) => { parts.push(part ?? "main"); return { ok: true as const, text: replies.shift()!, model: "fake", provider: "fake" } as never; };
    const r = await runRevisionQuestions("u1", "scenario", passage, 3, run as any, {});
    expect(parts).toEqual(["main", "retry"]);
    expect(r.ok && r.kept).toHaveLength(1);
    expect(r.ok && r.dropped).toEqual(["answer_leaked"]);
  });
});

describe("when the notes cannot carry a scenario, the existing source-sufficiency path says so and nothing is forced", () => {
  const QI = "Plan Do Study Act cycles are used to test a change. A driver diagram links an aim to change ideas. Run charts show a measure over time.";
  it("clinical notes that describe a presentation, what it means and what is done are ready; a methods deck is not", () => {
    expect(["sufficient", "uncertain"]).toContain(caseReadiness([NOTE], "case_blueprint").outcome);
    expect(["insufficient", "simpler"]).toContain(caseReadiness([QI], "case_blueprint").outcome);
  });
  it("the note the session shows", () => {
    expect(SCENARIO_INSUFFICIENT_NOTE).toBe("Your notes don't have enough clinical detail for an evolving scenario on this topic.");
  });
});
