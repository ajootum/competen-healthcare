/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { checkRevisionDraft } from "./revision";
import { REVISION_SYSTEM, revisionPromptVersion, runRevisionQuestions, type Passage } from "./generation";
import { citationFlaw, parseScenarioRaw, scenarioFlaw, SCENARIO_INSUFFICIENT_NOTE, SCENARIO_SCOPE_LINE, stageAnswers } from "./scenario";
import { caseReadiness } from "./sufficiency";
import { unsupportedTerms } from "./question-quality";

// SCHOLAR-CE-2026 CE-05, owner decision 2 Nov ("content quality correction"): a scenario is a patient-centred clinical story that develops, asks a
// decision at each stage, gives no stage's answer away earlier, invents nothing, and cites every stage. These are canned model outputs (a small
// representative set, not an evaluation programme): what a good reply looks like, and the three ways a reply is wrong.

const NOTE = [
  "A raised respiratory rate is often the first sign that a person is getting worse.",
  "An early warning score combines several observations, such as respiratory rate, oxygen saturation, heart rate and blood pressure.",
  "A rising score means the person should be escalated to a senior nurse or doctor.",
  "If the oxygen saturation falls, give oxygen as prescribed and recheck the observations.",
  "Sepsis may be suspected when a person has a fever and a fast heart rate.",
].join("\n");
const passage: Passage = { chunkId: "c1", materialId: "m1", materialTitle: "Recognising deterioration", ordinal: 1, pageFrom: 1, pageTo: 1, content: NOTE };

const common = {
  rationale: "The notes describe the signs, the score and what is done.", sourceQuote: "A rising score means the person should be escalated to a senior nurse or doctor.",
  difficulty: 2, level: "application", objective: "Follow a person who is getting worse.", keyPoints: ["A rising score means escalation"], misconceptions: [], references: [],
};

/** 1. A GOOD reply: a person in practice, new information at each stage, a decision at each, each stage cited. */
const GOOD = {
  ...common,
  situation: "A person on a medical ward has had their observations taken, and the early warning score has been worked out.",
  stages: [
    {
      reveal: "", prompt: "What should happen when the score is rising?", kind: "mcq",
      options: ["The person should be escalated to a senior nurse or doctor", "The observations should be left", "The person should be discharged", "The score should be ignored"], correct: [0], weight: 1,
      keyPoint: "A rising score means the person should be escalated to a senior nurse or doctor.", source: "A rising score means the person should be escalated to a senior nurse or doctor.",
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
const LEAKING = {
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
const STUDENT_FRAMED = {
  ...GOOD,
  situation: "A healthcare student is revising how to recognise when a person is getting worse. Their notes say a raised respiratory rate is often the first sign, and that an early warning score combines several observations.",
  stages: [{ ...GOOD.stages[0], prompt: "According to the notes, what should happen when the score is rising?" }, GOOD.stages[1]],
};

/** 4. AN UNCITED FINDING: a stage whose citation is not in the section (an invented management step). */
const UNCITED = {
  ...GOOD,
  stages: [GOOD.stages[0], { ...GOOD.stages[1], source: "Start a bolus of fluids and repeat the blood gas straight away." }, GOOD.stages[2]],
};

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
