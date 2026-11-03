import { describe, expect, it } from "vitest";
import type { GenerateResult } from "@/lib/ai/client";
import { PROMPT_VERSIONS } from "./config";
import { checkLearnMain, checkTeachAnswer, cumulativePromptVersion, learnInstruction, learnSystem, learnUserPrompt, lessonBriefBlock, runLearn, scholarNamedTerms, type Passage } from "./generation";
import { DEPTH_REACHED, TAUGHT_HEADER, buildTaughtSoFar, taughtSoFarBlock } from "./learn-context";
import { artefactKey, headingFamily, lessonOutline, planSteps, sectionProfile, type SectionProfile } from "./learn";
import { composeTeachAnswer, parseTeachAnswer } from "./teach-format";
import type { SectionRef } from "./store";

// SCHOLAR-CUMULATIVE-TEACHING-01 (owner GO, 3 Nov 2026): the prompt assembly, the parsing and the planner changes, without a model.

const P = (i: number, content: string): Passage => ({ chunkId: `c${i}`, materialId: "m", materialTitle: "Essential Nursing Care", ordinal: i + 10, pageFrom: i + 10, pageTo: i + 10, unit: "slide", content });
const BED_BATH = [
  P(1, "Bed Bath\nA daily bed-bath with intermittent washes of the face and hands is standard care. Increase frequency as necessary for patients who are sweating, incontinent, bleeding or with leaking wounds. Think Pain: being moved is painful for many critically ill patients - it may be appropriate to give prophylactic pain relief before a bed-bath."),
  P(2, "Bed Bath\nTiming of a bed-bath and personal hygiene is important. Planning ahead with respect to events such as medical rounds, chest X-ray requirements and family visits. Ensure privacy for the patient. Length of time providing bed bath - vasoconstriction from heat loss may lead to cardiovascular instability."),
  P(3, "Eye Care\nReceiving PPV - develop conjunctival edema (Chemosis or Ventilator eye). CPAP may lead to drying."),
];
const LESSON_V3 = [
  "OVERVIEW: A bed-bath is standard daily care and a chance to assess the skin [S1].",
  "UNDERSTANDING:",
  "Being moved is painful for many critically ill patients, so pain relief may be given before the bath [S1].",
  "",
  "A long bath lets heat escape; the vasoconstriction that follows may lead to cardiovascular instability, so timing and length matter [S2].",
  "KEY POINTS:",
  "- Increase the frequency of washes for patients who are sweating, incontinent, bleeding or with leaking wounds [S1].",
  "- Plan the bath around rounds, X-rays and family visits, and ensure privacy [S2].",
  "CHECK YOUR UNDERSTANDING:",
  "- Why might a long bed-bath be a concern for a critically ill patient? [S2]",
].join("\n");

describe("the lesson's parts (teach v3, deeper v2)", () => {
  it("UNDERSTANDING paragraphs are parsed (blank lines apart), composed back and round-trip", () => {
    const parts = parseTeachAnswer(LESSON_V3)!;
    expect(parts.understanding).toHaveLength(2);
    expect(parts.understanding![1]).toMatch(/^A long bath lets heat escape/);
    expect(parts.points).toHaveLength(2);
    expect(parseTeachAnswer(composeTeachAnswer(parts))).toEqual(parts);
    expect(composeTeachAnswer(parts)).toMatch(/UNDERSTANDING:\nBeing moved[^\n]*\n\nA long bath/);
  });
  it("is checked part by part: an ungrounded understanding paragraph is salvaged on its own; a figure in one still withholds", () => {
    const r = checkTeachAnswer(LESSON_V3.replace("so timing and length matter [S2].", "so timing and length matter, and the patient should be reassessed as improved [S2]."), "Teach me this step.", BED_BATH, []);
    expect(r.check.ok).toBe(true);
    if (!r.check.ok) return;
    expect(r.check.text).not.toMatch(/improved/);
    expect(r.check.text).toMatch(/Being moved is painful/);
    expect(r.check.salvaged).toMatchObject({ removed: 1, parts: { understanding: 1, points: 0 } });
    const unsafe = checkTeachAnswer(LESSON_V3.replace("so timing and length matter [S2].", "so keep it under 10 minutes [S2]."), "Teach me this step.", BED_BATH, []);
    expect(unsafe.check.ok).toBe(false);
  });
  it("the system prompt asks for the five parts, gives a lesson room, and names the gap rule for the explanation beyond the notes", () => {
    const s = learnSystem("teach", { depth: "standard", background: true, references: false });
    expect(s).toMatch(/OVERVIEW:[\s\S]*UNDERSTANDING:[\s\S]*KEY POINTS:[\s\S]*EXAMPLE:[\s\S]*CHECK YOUR UNDERSTANDING:/);
    expect(s).toMatch(/under 520 words/);
    expect(s).toMatch(/name the gap first/);
    expect(learnSystem("deeper", { depth: "standard", background: false, references: false })).toMatch(/MODE: GO DEEPER[\s\S]*UNDERSTANDING:/);
    expect(learnSystem("explain", { depth: "standard", background: true, references: false })).toMatch(/under 220 words/);
  });
});

describe("TAUGHT SO FAR changes what each action does (spec s3, s4)", () => {
  it("deeper extends and may declare the depth reached; explain becomes Explain again; never without the block", () => {
    expect(learnInstruction("deeper", true)).toMatch(/GO DEEPER EXTENDS[\s\S]*Repeat nothing from TAUGHT SO FAR/);
    expect(learnInstruction("deeper", true)).toContain(DEPTH_REACHED);
    expect(learnInstruction("deeper", false)).not.toContain(DEPTH_REACHED);
    expect(learnInstruction("explain", true)).toMatch(/EXPLAIN AGAIN[\s\S]*Introduce no new mechanism/);
    expect(learnInstruction("explain", false)).not.toMatch(/EXPLAIN AGAIN/);
    expect(learnInstruction("check", true)).toMatch(/ask a different one/);
    expect(learnInstruction("clarify", true)).toMatch(/Judge this answer in that light/);
    expect(learnSystem("deeper", { depth: "standard", background: false, references: false, taught: true })).toMatch(/GO DEEPER EXTENDS/);
  });
  it("the user prompt carries the lesson brief and the block before the passages, neither as a passage; Ask carries neither", () => {
    const t = buildTaughtSoFar([{ action: "teach", content: LESSON_V3 }]);
    const block = taughtSoFarBlock(t)!;
    const u = learnUserPrompt("Help me understand this in more depth.", BED_BATH, [], [], null, [], null, { taught: block, lesson: { title: "Bed bath", objective: "Explain bed bath, including skin tears.", sections: ["Bed Bath", "Skin Tears"] } });
    expect(u.indexOf("THIS LESSON: Bed bath.")).toBeLessThan(u.indexOf(TAUGHT_HEADER));
    expect(u.indexOf(TAUGHT_HEADER)).toBeLessThan(u.indexOf("PASSAGES FROM MY NOTES:"));
    expect(u).toMatch(/headings, in order: Bed Bath; Skin Tears/);
    expect(lessonBriefBlock(null)).toBe("");
    // The block is not grounding: a claim from it that the passages lack is still withheld.
    expect(checkLearnMain("The nurse reassessed the patient as improved [S1].", "x", BED_BATH, []).ok).toBe(false);
  });
  it("runLearn: deeper on taught ground may answer DEPTH_REACHED (no lesson, a suggestion), and carries the cumulative version", async () => {
    const r = await runLearn("u", { action: "deeper", question: "Help me understand this in more depth.", passages: BED_BATH, references: [], depth: "standard", background: false, history: [], learnerContext: null, taught: "TAUGHT SO FAR ..." },
      async () => ({ ok: true, text: `${DEPTH_REACHED}: Try explaining why privacy matters during the bath [S2].`, model: "m", provider: "anthropic" } as GenerateResult));
    if (!r.ok) throw new Error("expected ok");
    expect(r.depthReached).toEqual({ suggestion: "Try explaining why privacy matters during the bath." });
    expect(r.promptVersion).toBe(cumulativePromptVersion(`${PROMPT_VERSIONS.learn}:deeper+${PROMPT_VERSIONS.learnDeeper}`));
    // Without the block the marker is just text, checked like any answer (and withheld: it cites nothing).
    const plain = await runLearn("u", { action: "deeper", question: "q", passages: BED_BATH, references: [], depth: "standard", background: false, history: [], learnerContext: null },
      async () => ({ ok: true, text: `${DEPTH_REACHED}: nothing`, model: "m", provider: "anthropic" } as GenerateResult));
    expect(plain.ok && plain.depthReached).toBeFalsy();
    expect(plain.ok && plain.promptVersion).toBe(`${PROMPT_VERSIONS.learn}:deeper+${PROMPT_VERSIONS.learnDeeper}`);
  });
  it("the learner's earlier check answers ground the next reply, as a clarify's answer always did", async () => {
    const r = await runLearn("u", { action: "deeper", question: "q", passages: BED_BATH, references: [], depth: "standard", background: false, history: [], learnerContext: null, taught: "TAUGHT SO FAR ...", learnerTexts: ["I think the bath should take under 10 minutes"] },
      async () => ({ ok: true, text: "OVERVIEW: You said under 10 minutes; the notes give no time, only that a long bath risks heat loss [S2].\nKEY POINTS:\n- Length of time matters because of vasoconstriction from heat loss [S2].", model: "m", provider: "anthropic" } as GenerateResult));
    expect(r.ok && r.check.ok).toBe(true);
  });
  it("the saved-answer key changes with the taught ground, and only then", () => {
    const base = { action: "deeper", depth: "standard", chunkIds: ["a", "b"], promptVersion: "v", references: [], background: false };
    expect(artefactKey(base)).toBe(artefactKey({ ...base, context: null }));
    expect(artefactKey({ ...base, context: "1a2b3c4d" })).not.toBe(artefactKey(base));
    expect(artefactKey({ ...base, context: "1a2b3c4d" })).not.toBe(artefactKey({ ...base, context: "ffffffff" }));
  });
});

describe("named therapy terms are not test results (the acceptance run's three withheld answers)", () => {
  it("'positive pressure ventilation' and PEEP pass; 'positive' alone is still a finding word", () => {
    expect(scholarNamedTerms("positive pressure ventilation and positive end-expiratory pressure")).not.toMatch(/\bpositive\b/);
    expect(scholarNamedTerms("the swab was positive")).toMatch(/positive/);
    expect(checkLearnMain("Patients receiving positive pressure ventilation may develop chemosis [S3].", "q", BED_BATH, []).ok).toBe(true);
    expect(checkLearnMain("The culture came back positive [S3].", "q", BED_BATH, []).ok).toBe(false);
  });
});

// Lesson planning (spec s5): a deck shaped like the owner's "Essential Nursing Care of the Critically Ill" around Bed bath.
const sec = (i: number): SectionRef => ({ chunkId: `s${i}`, materialId: "ncc", ordinal: i, pageFrom: i, pageTo: i, materialTitle: "NCC", unit: "slide" });
const DECK: [string, number][] = [
  ["Personal Hygiene", 555], ["Consider", 333], ["Personal Hygiene", 449], ["Personal Hygiene", 669], ["Skin & Tissue Assessment", 24], ["Bed Bath", 336], ["Bed Bath", 485], ["Skin Tears", 108],
  ["Eye Care", 475], ["Eye Care", 275], ["Eye Care Assessment", 174], ["Eye Care Assessment", 232], ["Eye Care Essential Care (Grade 1)", 243], ["Eye Care Essential Care (Grade 2)", 125], ["Eye Care Essential Care Protocol", 425], ["Eye Care Essential Care Procedure", 626], ["Eye Care Conjunctival Edema (Chemosis)", 443], ["Eye Care Conjunctival Edema (Chemosis)", 104],
  ["Oral Care", 428], ["Oral Care", 336], ["Oral Care Assessment", 203], ["Oral Care Essential Care (Goals)", 331], ["Oral Care Essential Care", 389], ["Oral Care Essential Care", 494],
];
const text = (h: string, n: number) => (`${h}\n` + "personal hygiene, eye care and oral care of the critically ill patient are described here in more words. ".repeat(30)).slice(0, n);
const secs = DECK.map((_, i) => sec(i + 1));
const profiles = new Map<string, SectionProfile>(DECK.map(([h, n], i) => [`s${i + 1}`, sectionProfile(text(h, n))]));

describe("SCHOLAR-CUMULATIVE-TEACHING-01: lessons follow the heading families", () => {
  it("never cuts inside a heading family where the cap allows: Eye care is one lesson, Oral care another", () => {
    const { steps } = planSteps(secs, new Map(), 3, profiles);
    const ids = steps.map(s => s.sections.map(x => x.ordinal));
    expect(ids).toEqual([[1, 2, 3, 4, 5, 6, 7, 8], [9, 10, 11, 12, 13, 14, 15, 16, 17, 18], [19, 20, 21, 22, 23, 24]]);
  });
  it("a lesson is titled by the heading family carrying most of its text, with the others in the objective", () => {
    const { steps } = planSteps(secs, new Map(), 3, profiles);
    const o = lessonOutline(steps[1], new Map(), profiles);
    expect(o.title).toBe("Eye care");
    expect(o.objective).toMatch(/^Explain eye care, including/);
    expect(lessonOutline(steps[0], new Map(), profiles).title).toBe("Personal hygiene");
    expect(headingFamily("Eye Care Essential Care (Grade 1)")).toBe("eye");
    expect(headingFamily("The International NPUAP Pressure Ulcer Classification System")).toBe("inter");
    expect(headingFamily(null)).toBeNull();
  });
});
