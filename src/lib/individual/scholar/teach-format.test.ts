import { describe, expect, it } from "vitest";
import type { GenerateResult } from "@/lib/ai/client";
import { checkTeachAnswer, learnPromptVersion, learnSystem, runLearn, type Passage } from "./generation";
import { PROMPT_VERSIONS } from "./config";
import { citationSegments, composeTeachAnswer, parseTeachAnswer, questionText, replyState, type LearnGrounding } from "./teach-format";

// SCHOLAR-LEARN-FIX-01 L-B: the structured Teach Me answer -- parsed, checked part by part (never more loosely), and
// the grounding outcome shown as a UI state.

const P = (i: number, content: string): Passage => ({ chunkId: `c${i}`, materialId: "m", materialTitle: "QI notes", ordinal: i, pageFrom: i, pageTo: i, unit: "slide", content });
const NOTES = [
  P(1, "The Model for Improvement asks what we are trying to accomplish, how we will know a change is an improvement, and what changes we can make."),
  P(2, "A PDSA cycle tests a change on a small scale: plan the test, do it, study the results and act on what was learned. A ward team tested a new handover sheet with one nurse on one shift before using it more widely."),
];
const GOOD = [
  "**Overview:** The Model for Improvement gives a team questions to guide a change [S1].",
  "",
  "KEY POINTS:",
  "- It asks what the team is trying to accomplish [S1].",
  "- A PDSA cycle tests a change on a small scale before it is used more widely [S2].",
  "  The team studies the results and acts on what was learned [S2].",
  "EXAMPLE: A ward team tested a new handover sheet with one nurse on one shift [S2].",
  "CHECK YOUR UNDERSTANDING:",
  "- Why is a change tested on a small scale first? [S2]",
  "- What does the Model for Improvement ask a team? [S1]",
].join("\n");

describe("parseTeachAnswer / composeTeachAnswer", () => {
  it("reads the labelled parts, tolerating markdown and wrapped key points", () => {
    expect(parseTeachAnswer(GOOD)).toEqual({
      overview: "The Model for Improvement gives a team questions to guide a change [S1].",
      points: ["It asks what the team is trying to accomplish [S1].", "A PDSA cycle tests a change on a small scale before it is used more widely [S2]. The team studies the results and acts on what was learned [S2]."],
      example: "A ward team tested a new handover sheet with one nurse on one shift [S2].",
      questions: ["Why is a change tested on a small scale first? [S2]", "What does the Model for Improvement ask a team? [S1]"],
    });
  });
  it("an answer with no OVERVIEW or KEY POINTS label (saved before the structure) is not structured", () => {
    expect(parseTeachAnswer("The Model for Improvement asks three questions [S1].")).toBeNull();
    expect(parseTeachAnswer("EXAMPLE: something [S1]")).toBeNull();
  });
  it("round-trips through the canonical form, leaving empty parts out", () => {
    const p = parseTeachAnswer(GOOD)!;
    expect(parseTeachAnswer(composeTeachAnswer(p))).toEqual(p);
    expect(composeTeachAnswer({ ...p, example: null, questions: [] })).not.toMatch(/EXAMPLE:|CHECK YOUR UNDERSTANDING:/);
  });
  it("citations become segments; a question loses its tags for answering", () => {
    expect(citationSegments("A [S1] and [S12].")).toEqual([{ text: "A " }, { tag: 1 }, { text: " and " }, { tag: 12 }, { text: "." }]);
    expect(questionText("Why is it tested first? [S2] [S1]")).toBe("Why is it tested first?");
  });
});

describe("checkTeachAnswer: part by part, never looser than checkLearnMain", () => {
  it("keeps a supported example and grounded, cited questions", () => {
    const r = checkTeachAnswer(GOOD, "Teach me this step.", NOTES, []);
    expect(r.dropped).toEqual({ example: false, questions: 0 });
    expect(r.check).toMatchObject({ ok: true, cited: [1, 2] });
    const parts = parseTeachAnswer((r.check as { text: string }).text)!;
    expect(parts.example).toContain("handover sheet");
    expect(parts.questions).toHaveLength(2);
  });
  it("drops an invented example and an ungrounded or uncited question, and keeps the lesson", () => {
    const raw = GOOD
      .replace("A ward team tested a new handover sheet with one nurse on one shift [S2].", "A patient with sepsis had a lactate of 4 mmol/L and the team tested a change [S2].")
      .replace("- What does the Model for Improvement ask a team? [S1]", "- What does the Model for Improvement ask a team?\n- Why was the lactate of 4 important? [S1]");
    const r = checkTeachAnswer(raw, "Teach me this step.", NOTES, []);
    expect(r.check.ok).toBe(true);
    expect(r.dropped).toEqual({ example: true, questions: 2 });
    const text = (r.check as { text: string }).text;
    expect(text).not.toMatch(/lactate|EXAMPLE:/);
    expect(parseTeachAnswer(text)!.questions).toEqual(["Why is a change tested on a small scale first? [S2]"]);
  });
  it("an uncited example is dropped, never shown as the notes'", () => {
    const r = checkTeachAnswer(GOOD.replace("one shift [S2].", "one shift."), "Teach me", NOTES, []);
    expect(r.dropped.example).toBe(true);
  });
  it("an invented digit in a key point still withholds the whole answer (never salvaged: SCHOLAR-GUIDED-LEARNING-01)", () => {
    const r = checkTeachAnswer(GOOD.replace("small scale before", "small scale of 3 patients before"), "Teach me", NOTES, []);
    expect(r.check).toMatchObject({ ok: false, reason: "ungrounded" });
  });
  it("a tag it was not given withholds; a labelled NOT_IN_NOTES is not_in_notes", () => {
    expect(checkTeachAnswer(GOOD.replace("[S1].\n\nKEY", "[S9].\n\nKEY"), "Teach me", NOTES, []).check).toMatchObject({ ok: false, reason: "bad_citation" });
    expect(checkTeachAnswer("OVERVIEW: NOT_IN_NOTES", "Teach me", NOTES, []).check).toMatchObject({ ok: false, reason: "not_in_notes" });
  });
  it("at most two questions are kept", () => {
    const raw = `${GOOD}\n- What is studied in a PDSA cycle? [S2]`;
    expect(parseTeachAnswer((checkTeachAnswer(raw, "Teach me", NOTES, []).check as { text: string }).text)!.questions).toHaveLength(2);
  });
  it("an unstructured answer is checked as a whole, as before", () => {
    expect(checkTeachAnswer("A PDSA cycle tests a change on a small scale [S2].", "Teach me", NOTES, []).check).toMatchObject({ ok: true, text: "A PDSA cycle tests a change on a small scale [S2].", cited: [2] });
  });
});

describe("runLearn teach: the structured prompt and its own version", () => {
  it("asks for the labelled parts and checks the answer by them; only teach moves version", async () => {
    let system = "";
    const r = await runLearn("u", { action: "teach", question: "Teach me this step.", passages: NOTES, references: [], depth: "standard", background: false, history: [], learnerContext: null },
      async g => { system = g.system ?? ""; return { ok: true, text: GOOD.replace("one shift [S2].", "one shift."), model: "m", provider: "anthropic" } as GenerateResult; });
    if (!r.ok) throw new Error("expected ok");
    expect(system).toMatch(/OVERVIEW:[\s\S]*KEY POINTS:[\s\S]*EXAMPLE:[\s\S]*Never invent an example[\s\S]*CHECK YOUR UNDERSTANDING:/);
    expect(r.check.ok && r.check.text).not.toMatch(/EXAMPLE:/);
    expect(r.promptVersion).toBe(`${PROMPT_VERSIONS.learn}:teach+${PROMPT_VERSIONS.learnTeach}`);
    expect(learnPromptVersion("explain")).toBe(`${PROMPT_VERSIONS.learn}:explain`);
    expect(learnSystem("explain", { depth: "standard", background: false, references: false })).not.toContain("CHECK YOUR UNDERSTANDING:");
  });
});

describe("replyState: the grounding outcome as what the learner sees", () => {
  const g = (outcome: LearnGrounding["outcome"], uncoveredTerms: string[] = []): LearnGrounding => ({ outcome, keyTerms: ["a", ...uncoveredTerms], covered: ["a"], uncoveredTerms, wider: outcome === "sufficient" ? null : "notes_and_library" });
  it("sufficient teaches; partial teaches then names the gaps; withheld is recovery; continuity is continuity", () => {
    expect(replyState({ answer: "x [S1]", action: "teach", grounding: g("sufficient") })).toBe("teach");
    expect(replyState({ answer: "x [S1]", action: "teach", grounding: g("partial", ["spc"]) })).toBe("partial");
    expect(replyState({ answer: "x [S1]", action: "teach", grounding: g("insufficient", ["spc"]) })).toBe("partial");
    expect(replyState({ withheld: true, action: "teach", grounding: g("insufficient", ["spc"]) })).toBe("recovery");
    expect(replyState({ continuity: { message: "" }, action: "teach" })).toBe("continuity");
  });
  it("an older reply with no grounding, and a check or clarification, are plain teaching", () => {
    expect(replyState({ answer: "x [S1]", action: "teach" })).toBe("teach");
    expect(replyState({ answer: "x [S1]", action: "clarify", grounding: g("partial", ["spc"]) })).toBe("teach");
  });
});
