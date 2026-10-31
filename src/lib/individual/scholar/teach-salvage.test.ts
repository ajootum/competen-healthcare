import { describe, expect, it } from "vitest";
import { checkTeachAnswer, describeViolations, learnSystem, type Passage } from "./generation";
import { LEARN_TEACH_LEGACY, PROMPT_VERSIONS } from "./config";
import { legacyLearnPromptVersions, learnPromptVersion } from "./generation";

// SCHOLAR-GUIDED-LEARNING-01 (owner, 31 Oct): partial grounding is salvaged part by part; the clinical safeguards
// (dosing, an invented safety-critical number, an identifier, a bad citation) still withhold the whole lesson.
// Slides 14 and 15: the citation adds no small number to the grounding.
const P = (i: number, content: string): Passage => ({ chunkId: `c${i}`, materialId: "m", materialTitle: "Just Culture", ordinal: i + 13, pageFrom: i + 13, pageTo: i + 13, unit: "slide", content });
const JC = [
  P(1, "Just Culture. A just culture balances accountability and learning. Staff report errors without fear of blame."),
  P(2, "Human error is consoled, at-risk behaviour is coached, and reckless behaviour is sanctioned. Paracetamol is given as prescribed."),
];
const lesson = (overview: string, points: string[], extra = "") =>
  `OVERVIEW: ${overview}\nKEY POINTS:\n${points.map(p => `- ${p}`).join("\n")}${extra}\nCHECK YOUR UNDERSTANDING:\n- Why is human error consoled rather than punished? [S2]`;

describe("partial grounding: keep the supported parts", () => {
  it("the production case: 'the number two' no longer withholds the whole Just Culture lesson", () => {
    const r = checkTeachAnswer(lesson("A just culture balances accountability and learning [S1].",
      ["The idea was set out two decades ago [S1].", "Staff report errors without fear of blame [S1].", "Human error is consoled and at-risk behaviour is coached [S2]."]), "Teach me this step.", JC, []);
    expect(r.check.ok).toBe(true);
    if (!r.check.ok) return;
    expect(r.check.text).not.toMatch(/two decades/);
    expect(r.check.text).toMatch(/Staff report errors/);
    expect(r.check.salvaged).toMatchObject({ removed: 1, parts: { overview: false, points: 1 } });
    expect(describeViolations(r.check.salvaged!.violations)).toMatch(/two/);
  });
  it("an ordinary structuring count passes outright: nothing to salvage", () => {
    const r = checkTeachAnswer(lesson("A just culture separates two types of behaviour from reckless behaviour [S2].", ["Staff report errors without fear of blame [S1]."]), "Teach me this step.", JC, []);
    expect(r.check.ok && r.check.salvaged).toBe(undefined);
  });
  it("the overview fails but the key points pass: the key points are shown", () => {
    const r = checkTeachAnswer(lesson("Just culture began two decades ago [S1].", ["Staff report errors without fear of blame [S1]."]), "Teach me this step.", JC, []);
    expect(r.check.ok).toBe(true);
    if (!r.check.ok) return;
    expect(r.check.text).not.toMatch(/OVERVIEW/);
    expect(r.check.text).toMatch(/KEY POINTS:\n- Staff report errors/);
    expect(r.check.salvaged?.parts.overview).toBe(true);
  });
  it("control: nothing passes, so the whole lesson is withheld", () => {
    const r = checkTeachAnswer(lesson("It began two decades ago [S1].", ["Three decades of research followed [S2]."]), "Teach me this step.", JC, []);
    expect(r.check).toMatchObject({ ok: false, reason: "ungrounded" });
  });
  it("control: an invented dose or a safety-critical number withholds the whole lesson (never salvaged)", () => {
    const dose = checkTeachAnswer(lesson("A just culture balances accountability and learning [S1].", ["Give two tablets of paracetamol [S2].", "Staff report errors without fear of blame [S1]."]), "Teach me this step.", JC, []);
    expect(dose.check).toMatchObject({ ok: false, reason: "ungrounded" });
    const mg = checkTeachAnswer(lesson("A just culture balances accountability and learning [S1].", ["Paracetamol is given at 500 mg [S2].", "Staff report errors without fear of blame [S1]."]), "Teach me this step.", JC, []);
    expect(mg.check).toMatchObject({ ok: false, reason: "ungrounded" });
    const hours = checkTeachAnswer(lesson("A just culture balances accountability and learning [S1].", ["Report within two hours [S1].", "Staff report errors without fear of blame [S1]."]), "Teach me this step.", JC, []);
    expect(hours.check).toMatchObject({ ok: false, reason: "ungrounded" });
  });
  it("control: an identifier anywhere, or a bad citation, withholds the whole lesson", () => {
    const id = checkTeachAnswer(lesson("A just culture balances accountability and learning [S1].", ["MRN 00482913 was harmed two decades ago [S1].", "Staff report errors without fear of blame [S1]."]), "Teach me this step.", JC, []);
    expect(id.check.ok).toBe(false);
    const cite = checkTeachAnswer(lesson("A just culture balances accountability and learning [S1].", ["It began two decades ago [S9].", "Staff report errors without fear of blame [S1]."]), "Teach me this step.", JC, []);
    expect(cite.check).toMatchObject({ ok: false, reason: "bad_citation" });
  });
  it("an unsupported example is counted as removed", () => {
    const r = checkTeachAnswer(lesson("A just culture balances accountability and learning [S1].", ["Staff report errors without fear of blame [S1]."], "\nEXAMPLE: A nurse was examined by a panel [S1]."), "Teach me this step.", JC, []);
    expect(r.check.ok && r.check.salvaged?.parts.example).toBe(true);
  });
});

describe("the teach prompt v2", () => {
  it("is versioned, tells the model not to count without the notes, and keeps v1 lessons openable", () => {
    expect(PROMPT_VERSIONS.learnTeach).toBe("scholar-learn-teach-v2");
    expect(learnSystem("teach", { depth: "standard", background: false, references: false })).toMatch(/Never say how many of something there are \('two types'/);
    expect(LEARN_TEACH_LEGACY).toEqual(["scholar-learn-teach-v1"]);
    expect(legacyLearnPromptVersions("teach")).toEqual([`${PROMPT_VERSIONS.learn}:teach+scholar-learn-teach-v1`]);
    expect(legacyLearnPromptVersions("explain")).toEqual([]);
    expect(learnPromptVersion("teach")).toBe(`${PROMPT_VERSIONS.learn}:teach+scholar-learn-teach-v2`);
  });
});
