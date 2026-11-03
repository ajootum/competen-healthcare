import { describe, expect, it } from "vitest";
import { CHECK_FEEDBACK_HEADING, CHECK_LABEL, CHECK_NO_AI_WHY, isNonePoint, parseCheckFeedback, referenceAnswer } from "./learn-check";
import { learnPromptVersion, learnSystem, parseVerdict, runLearn, type Passage } from "./generation";
import { PROMPT_VERSIONS } from "./config";

const P = (i: number, content: string): Passage => ({ chunkId: `c${i}`, materialId: "m", materialTitle: "Paediatric notes", ordinal: i, pageFrom: i, pageTo: i, content });
const passages = [P(1, "A deteriorating child is recognised by a rising breathing rate and a falling level of alertness. The nurse escalates to the doctor straight away."), P(2, "Oxygen is given through a mask while help is on its way.")];

const FEEDBACK = [
  "VERDICT: partly",
  "RIGHT:",
  "- You said the nurse escalates to the doctor straight away [S1].",
  "MISSING:",
  "- The answer did not mention the rising breathing rate or the falling level of alertness that show deterioration [S1].",
  "MISCONCEPTIONS: Nothing to correct.",
  "KEY POINTS:",
  "- A deteriorating child shows a rising breathing rate and a falling level of alertness [S1].",
  "- The nurse escalates to the doctor straight away [S1] and gives oxygen through a mask while help is on its way [S2].",
  "NEXT: Re-read the signs of deterioration [S1].",
].join("\n");

describe("parseCheckFeedback: the labelled parts of a clarification", () => {
  it("reads every part, drops the 'nothing' sentinels and keeps the citations in each point", () => {
    const { verdict, rest } = parseVerdict(FEEDBACK);
    expect(verdict).toBe("partly");
    const p = parseCheckFeedback(rest)!;
    expect(p.right).toEqual(["You said the nurse escalates to the doctor straight away [S1]."]);
    expect(p.missing).toHaveLength(1);
    expect(p.misconceptions).toEqual([]);
    expect(p.keyPoints).toHaveLength(2);
    expect(p.keyPoints[1]).toContain("[S2]");
    expect(p.next).toBe("Re-read the signs of deterioration [S1].");
  });
  it("tolerates markdown around the labels, 'Key learning points', and a wrapped bullet", () => {
    const p = parseCheckFeedback("**Right:** - escalates [S1]\n### Key learning points:\n- a rising breathing\n  rate [S1]\n> Next: none")!;
    expect(p.right).toEqual(["escalates [S1]"]);
    expect(p.keyPoints).toEqual(["a rising breathing rate [S1]"]);
    expect(p.next).toBeNull();
  });
  it("a clarification with no label (written before the structure) is not structured", () => {
    expect(parseCheckFeedback("You got the escalation right [S1]. The signs are a rising breathing rate [S1].")).toBeNull();
  });
  it("recognises the sentinels the prompt asks for", () => {
    for (const s of ["None spotted.", "Nothing to correct.", "Nothing important missing.", "none", "N/A"]) expect(isNonePoint(s)).toBe(true);
    expect(isNonePoint("Nothing in the notes says when oxygen is stopped [S2].")).toBe(false);
  });
  it("every part has a heading for the page", () => {
    for (const k of Object.keys(CHECK_LABEL) as (keyof typeof CHECK_LABEL)[]) expect(CHECK_FEEDBACK_HEADING[k]).toBeTruthy();
    expect(Object.keys(CHECK_NO_AI_WHY).sort()).toEqual(["clarify", "continuity", "error", "unavailable", "withheld"]);
  });
});

describe("referenceAnswer: the self-review's reference, with no AI", () => {
  const sources = [{ tag: "S1", chunkId: "c1", materialId: "m", citation: "Paediatric notes, p1" }, { tag: "S2", chunkId: "c2", materialId: "m", citation: "Paediatric notes, p2" }];
  it("gives the lesson's key points and only the sections the question cites", () => {
    const r = referenceAnswer({ rawQuestion: "How is a deteriorating child recognised? [S1]", lessonPoints: ["A rising breathing rate [S1]", " "], sources });
    expect(r.points).toEqual(["A rising breathing rate [S1]"]);
    expect(r.sources.map(s => s.tag)).toEqual(["S1"]);
  });
  it("a question that cites nothing (or is not known) falls back to every section of the lesson", () => {
    expect(referenceAnswer({ rawQuestion: "Why is oxygen given?", lessonPoints: [], sources }).sources).toHaveLength(2);
    expect(referenceAnswer({ rawQuestion: null, lessonPoints: [], sources }).sources).toHaveLength(2);
  });
});

describe("the clarify prompt asks for the parts and carries its own version", () => {
  it("names every label, keeps the verdict first, and stays within the notes", () => {
    const s = learnSystem("clarify", { depth: "standard", background: false, references: false });
    for (const l of Object.values(CHECK_LABEL)) expect(s).toContain(l);
    expect(s).toContain("'VERDICT: understood', 'VERDICT: partly' or 'VERDICT: not_yet'");
    expect(s).toContain("Do not judge anything the passages do not cover");
    expect(s).not.toContain("###");
  });
  it("clarify moves its own version only; the artefact actions keep theirs", () => {
    expect(learnPromptVersion("clarify")).toBe(`${PROMPT_VERSIONS.learn}:clarify+${PROMPT_VERSIONS.learnClarify}`);
    expect(learnPromptVersion("explain")).toBe(`${PROMPT_VERSIONS.learn}:explain`);
    expect(learnPromptVersion("check")).toBe(`${PROMPT_VERSIONS.learn}:check`);
  });
  it("a structured clarification passes the grounding check, with its verdict and parts", async () => {
    const r = await runLearn("u", { action: "clarify", question: "Your check question was: How is a deteriorating child recognised? [S1]\nMy answer: the nurse escalates to the doctor", passages, references: [], depth: "standard", background: false, history: [], learnerContext: null },
      async () => ({ ok: true, text: FEEDBACK, model: "test", provider: "test", requestId: "r" } as never));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.verdict).toBe("partly");
    expect(r.check.ok).toBe(true);
    if (r.check.ok) { expect(parseCheckFeedback(r.check.text)?.keyPoints).toHaveLength(2); expect(r.check.cited).toEqual([1, 2]); }
  });
});
