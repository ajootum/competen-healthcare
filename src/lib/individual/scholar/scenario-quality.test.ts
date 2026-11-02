/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { checkRevisionDraft } from "./revision";
import { REVISION_SYSTEM, revisionPromptVersion, runRevisionQuestions } from "./generation";
import { citationFlaw, parseScenarioRaw, scenarioFlaw, SCENARIO_INSUFFICIENT_NOTE, SCENARIO_SCOPE_LINE, stageAnswers } from "./scenario";
import { caseReadiness } from "./sufficiency";
import { unsupportedTerms } from "./question-quality";
import { GOOD, LEAKING, LIVE_FOUR_STAGES, LIVE_RECALL, NOTE, STUDENT_FRAMED, UNCITED, detPassage, passage } from "./scenario.fixture";

// SCHOLAR-CE-2026 CE-05, owner decision 2 Nov ("content quality correction"): a scenario is a patient-centred clinical story that develops, asks a
// decision at each stage, gives no stage's answer away earlier, invents nothing, and cites every stage. These are canned model outputs (a small
// representative set, not an evaluation programme): what a good reply looks like, and the three ways a reply is wrong.

const verdictOn = (raw: unknown) => { const c = checkRevisionDraft("scenario", raw, detPassage); return c.ok ? "accepted" : c.reason; };
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
  const two = (mut: (r: any) => void, i = 1) => { const r = JSON.parse(JSON.stringify(GOOD)); r.stages = [r.stages[0], r.stages[i]]; mut(r); return r; };
  it("answer leakage: a stage's key or correct option text in the opening or an EARLIER stage's reveal or question, normalised, two or more content words", () => {
    expect(verdict(two(r => { r.stages[0].prompt = "The person may need to give oxygen as prescribed, so what should happen when the score is rising?"; }))).toBe("answer_leaked");
    expect(verdict(sc(r => { r.stages[2].reveal = "Oxygen is given: give oxygen as prescribed, and the person now also has a fever and a fast heart rate."; }))).toBe("accepted"); // a LATER stage may mention an earlier answer
    expect(verdict(sc(r => { r.stages[0].reveal = ""; r.situation = `${r.situation} The Raised-Respiratory RATE is noted.`; r.stages[0].options[0] = "Raised respiratory rate"; r.stages[0].keyPoint = "x"; }))).not.toBe("accepted");
    // a single content word is not held to the rule, and a synonym is not considered
    const single = parseScenarioRaw(sc(r => { r.situation += " Sepsis is on the ward's mind."; }) as any)!;
    expect(scenarioFlaw(single)).toBeNull();
  });
  it("a stage that repeats another's answer is refused", () => {
    expect(verdict(two(r => { r.stages[1] = { ...r.stages[0], reveal: "Later still the person has a fever.", prompt: "What should be done about it now?" }; }))).toBe("repeated_stage");
  });
  it("stems that talk of notes, a passage, a learner or revising are refused, in any stage", () => {
    for (const text of ["Your notes say it is serious.", "The notes also say it is serious.", "A learner is revising this topic.", "As in the passage, the person is unwell."])
      expect(verdict(sc(r => { r.stages[1].reveal = `Some time later the oxygen saturation falls. ${text}`; })), text).toBe("not_a_scenario");
  });
  it("every stage must be cited: no source, a source quoted from nowhere, or a key the source does not support", () => {
    expect(verdict(two(r => { delete r.stages[1].source; }))).toBe("uncited_stage");
    expect(verdict(two(r => { r.stages[1].source = "Sepsis is always fatal without antibiotics."; }, 2))).toBe("uncited_stage");
    expect(verdict(sc(r => { r.stages[0].source = "An early warning score combines several observations, such as respiratory rate, oxygen saturation, heart rate and blood pressure."; }))).toBe("uncited_stage");
    expect(verdict(two(r => { r.stages[1].accepted = ["start a fluid bolus"]; }))).not.toBe("accepted");
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
  it("scholar-scenario-v3: a patient-centred clinical story, a decision at every stage, no invented findings, cited", () => {
    expect(revisionPromptVersion("scenario")).toBe("scholar-scenario-v3");
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

describe("the clinical content is held to the cited sentences, not the story around it", () => {
  const sc = (mut: (r: any) => void) => { const r = JSON.parse(JSON.stringify(GOOD)); mut(r); return r; };
  const two = (mut: (r: any) => void, i = 1) => { const r = JSON.parse(JSON.stringify(GOOD)); r.stages = [r.stages[0], r.stages[i]]; mut(r); return r; };
  it("narrative scaffolding -- a person, a setting, time passing, the team -- never causes a rejection", () => {
    expect(verdict(sc(r => { r.stages[1].reveal = "Some time later, the team notices the person is quiet and awake, and the result arrives. The oxygen saturation falls."; }))).toBe("accepted");
    expect(verdict(sc(r => { r.stages[1].reveal = "Shortly afterwards, while the family visits, the oxygen saturation falls."; }))).toBe("accepted");
    expect(verdict(sc(r => { r.situation = "A person who was admitted to a medical ward yesterday is resting in bed, and the team has just taken their observations and worked out the early warning score."; }))).toBe("accepted");
  });
  it("a reveal that introduces a finding the cited sentence does not hold is refused, even though its citation is real", () => {
    expect(verdict(two(r => { r.stages[1].reveal = "Some time later the person reports chest pain and the oxygen saturation falls."; }))).toBe("ungrounded_reveal");
    expect(verdict(two(r => { r.stages[1].reveal = "The person is now also drowsy and has a fever and a fast heart rate."; }, 2))).toBe("ungrounded_reveal");
  });
  it("a figure the section does not hold is refused in the opening, in digits or in words", () => {
    expect(verdict(sc(r => { r.situation += " The oxygen saturation is 88."; }))).toBe("ungrounded_number");
    expect(verdict(sc(r => { r.situation += " The lactate is four."; }))).toBe("ungrounded_number");
    expect(verdict(sc(r => { r.situation += " Thirty minutes ago the score was worked out."; }))).toBe("ungrounded_number");
  });
  it("a stage whose reveal invents a figure or a finding is LEFT OUT, not rewritten: the other stages are kept, nothing is added", () => {
    const c = checkRevisionDraft("scenario", sc(r => { r.stages[2].reveal = "The lactate is 4 and the person has a fever and a fast heart rate."; }), passage);
    expect(c.ok).toBe(true);
    const kept = c.ok ? (c.draft.answer as any).stages : [];
    expect(kept).toHaveLength(2);
    expect(JSON.stringify(kept)).not.toContain("lactate");
    // and with too few stages left, the draft is refused with the reason the stage was left out
    expect(verdict(two(r => { r.stages[1].reveal = "The lactate is 4 and the person has a fever and a fast heart rate."; }, 2))).toBe("ungrounded_reveal");
    expect(verdict(two(r => { r.stages[1].reveal = "Thirty minutes later the oxygen saturation falls."; }))).toBe("ungrounded_reveal");
  });
  it("an invented finding under an UNCITED source is refused as uncited, before it is read for its content", () => {
    expect(verdict(two(r => { r.stages[1].reveal = "The person reports chest pain."; r.stages[1].source = "Chest pain needs an urgent electrocardiogram."; }))).toBe("uncited_stage");
  });
  it("an opening that names a finding the section does not hold is refused", () => {
    expect(verdict(sc(r => { r.situation = "A person on a medical ward is vomiting, drowsy, jaundiced, sweating, shivering and wheezing, and the early warning score has been worked out."; }))).toBe("ungrounded_opening");
  });
  it("the identifier screen still runs on every word", () => {
    expect(verdict(sc(r => { r.stages[1].reveal = "Some time later the oxygen saturation falls. NHS number 943 476 5919."; }))).toBe("identifier");
  });
  it("why a draft was dropped is the rule's own name, so the audit's counts say it (dropped:2(ungrounded_reveal:2))", async () => {
    const bad = two(r => { r.stages[1].reveal = "Some time later the person reports chest pain and the oxygen saturation falls."; });
    const run = async () => ({ ok: true as const, text: JSON.stringify([bad]), model: "fake", provider: "fake" }) as never;
    const r = await runRevisionQuestions("u1", "scenario", passage, 3, run as any, {});
    expect(r.ok && r.kept).toHaveLength(0);
    expect(r.ok && r.dropped).toEqual(["ungrounded_reveal", "ungrounded_reveal"]);
  });
  it("a draft that is not well formed says how, by code", () => {
    expect(verdict(sc(r => { r.stages = r.stages.slice(0, 1); }))).toBe("scenario_stage_count");
    expect(verdict(two(r => { r.stages[1].reveal = ""; }))).toBe("scenario_no_reveal");
    expect(verdict(sc(r => { r.stages[0].options = ["a", "a", "b", "c"]; }))).toBe("scenario_options");
    expect(verdict(two(r => { r.stages[1].prompt = "Tell me about the oxygen"; }))).toBe("scenario_prompt");
    expect(verdict(sc(r => { r.situation = ""; }))).toBe("scenario_opening");
  });
});

describe("the shape of what the live model writes from a four-line list of guidance", () => {
  it("is cut to the stages that evolve: a plan narrated as a 'reveal' is left out, the rest kept, nothing rewritten or added", () => {
    const c = checkRevisionDraft("scenario", LIVE_FOUR_STAGES, detPassage);
    expect(c.ok).toBe(true);
    const stages = c.ok ? (c.draft.answer as any).stages : [];
    expect(stages.map((s: any) => s.reveal)).toEqual(["", "Shortly afterwards the person becomes newly confused."]);
    expect(stages.every((s: any) => s.source && detPassage.content.includes(s.source))).toBe(true);
    // the explanation is built from the kept stages' key points, and never speaks of "the passage"
    expect(c.ok && c.draft.rationale).toBe("A raised respiratory rate is often the first sign of deterioration. A new confusion is a red flag that needs urgent escalation.");
    expect(c.ok && c.draft.rationale).not.toMatch(/passage|notes/i);
    expect(c.ok && c.draft.sourceQuote).toBe(stages[1].source);
  });
  it("with only one stage left standing the draft is refused, and the reason is why a stage was left out", () => {
    const one = { ...LIVE_FOUR_STAGES, stages: [LIVE_FOUR_STAGES.stages[0], LIVE_FOUR_STAGES.stages[3]] };
    expect(verdictOn(one)).toBe("reveal_plan");
  });
});

describe("every question is a decision about this person, not plain recall (scholar-scenario-v3)", () => {
  const sc = (mut: (r: any) => void) => { const r = JSON.parse(JSON.stringify(GOOD)); mut(r); return r; };
  const two = (mut: (r: any) => void, i = 1) => { const r = JSON.parse(JSON.stringify(GOOD)); r.stages = [r.stages[0], r.stages[i]]; mut(r); return r; };
  it("the old live reply -- 'Which observation is often the first sign...' -- is refused as a recall question", () => {
    expect(verdictOn(LIVE_RECALL)).toBe("generic_question");
  });
  it("the recall frames are refused: which X is often, what is the, what does X stand for, according to", () => {
    for (const q of ["Which sign is usually the first to show a person is getting worse?", "What is the purpose of an early warning score?", "What does SBAR stand for?", "According to the guidance, how is it escalated?", "Which observations does NEWS2 combine?"])
      expect(verdict(two(r => { r.stages[0].prompt = q; })), q).toBe("generic_question");
  });
  it("the same frames are fine once they point at this person or this moment", () => {
    for (const q of ["What is the priority for this person now?", "What should you do first here?", "What does this change suggest, and what is the next step?", "Which finding here most needs acting on?"])
      expect(verdict(sc(r => { r.stages[0].prompt = q; })), q).toBe("accepted");
  });
  it("a later stage that is plain recall is left out, and the draft survives on the others", () => {
    const c = checkRevisionDraft("scenario", sc(r => { r.stages[2].prompt = "What is the commonest sign of sepsis?"; }), passage);
    expect(c.ok).toBe(true);
    expect(c.ok && (c.draft.answer as any).stages).toHaveLength(2);
  });
  it("the prompt asks for three stages, a decision each, and names the three roles", () => {
    const p = REVISION_SYSTEM.scenario;
    for (const must of ["THREE STAGES WHEN THE MATERIAL SUPPORTS THEM", "EVERY QUESTION IS A DECISION", "What should the team do first now?", "NEVER a generic recall question", "meaningful CHANGE", "clinical judgement"]) expect(p, must).toContain(must);
  });
});
