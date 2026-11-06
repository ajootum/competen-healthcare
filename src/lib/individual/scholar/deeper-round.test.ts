import { describe, expect, it } from "vitest";
import { GO_DEEPER_LEVELS, composeDeeperAnswer, deeperEvidenceStatement, deeperNotesOnlyText, deeperPlainText, deeperSectionText, levelOfDepth, parseDeeperAnswer } from "./deeper-format";
import { DEEPER_MAX_TOKENS, deeperInstruction, notesClaimViolations, notesSectionSupported, scholarClaimViolations } from "./deeper-prompt";
import { buildTaughtSoFar, taughtSoFarBlock } from "./learn-context";
import { parseTeachAnswer } from "./teach-format";
import { coversLesson, restoredSources } from "./learn-journey";
import { checkDeeperAnswer, cumulativePromptVersion, learnPromptVersion, learnSystem, legacyLearnPromptVersions, runLearn, savedLearningPassage, type Passage } from "./generation";

// SCHOLAR-GO-DEEPER-001: the structured round, what it may claim and what becomes of rounds already saved.

const passage = (content: string, i = 0): Passage => ({ chunkId: `c${i}`, materialId: "m", materialTitle: "Growth", ordinal: i, pageFrom: i + 1, pageTo: i + 1, content });
const NOTES = [
  passage("Development proceeds in a cephalocaudal direction, from the head downwards. Head control comes before sitting, and sitting comes before walking. Primitive reflexes disappear as the nervous system matures."),
  passage("Assessment of development compares the child's milestones with expected ages. Red flags should prompt referral for further assessment.", 1),
];
const ROUND = [
  "FOCUS QUESTION: Why does a child control the head before walking?",
  "COVERS: How the direction of development explains the order of milestones.",
  "SECTION: principle | notes | Development runs from the head downwards",
  "Development proceeds in a cephalocaudal direction, from the head downwards [S1]. Head control comes before sitting, and sitting comes before walking [S1].",
  "SECTION: science | scholar | Why the order follows the nervous system",
  "Nerve pathways serving the upper body tend to mature earlier than those serving the legs, so control arrives from the top down.",
  "",
  "FLOW: pathways mature -> reflexes fade -> voluntary control appears",
  "SECTION: compare | notes | Reflex and voluntary movement",
  "| Feature | Milestones |",
  "| --- | --- |",
  "| Reflexes | Primitive reflexes disappear as the nervous system matures [S1] |",
  "SECTION: misconception | scholar | A late milestone is not a diagnosis",
  "Students often read one late milestone as a disorder. A single finding has to be weighed with the rest of the picture.",
  "CHECK YOUR REASONING:",
  "- How would you reason about a child who sits but has not yet walked? [S1]",
  "  a) Compare with the expected order",
  "  b) Treat it as a disorder at once",
  "KEY TAKEAWAYS:",
  "- Head control comes before sitting [S1]",
  "- Control arrives from the top down",
].join("\n");

describe("the format", () => {
  it("reads a round back in its parts, and composing it gives the same parts", () => {
    const p = parseDeeperAnswer(ROUND)!;
    expect(p.focus).toBe("Why does a child control the head before walking?");
    expect(p.sections.map(s => `${s.kind}:${s.source}`)).toEqual(["principle:notes", "science:scholar", "compare:notes", "misconception:scholar"]);
    expect(p.sections[1].blocks.map(b => b.t)).toEqual(["p", "flow"]);
    expect(p.sections[2].blocks[0]).toEqual({ t: "table", rows: [["Feature", "Milestones"], ["Reflexes", "Primitive reflexes disappear as the nervous system matures [S1]"]] });
    expect(p.questions[0].options).toEqual(["Compare with the expected order", "Treat it as a disorder at once"]);
    expect(p.takeaways).toHaveLength(2);
    expect(parseDeeperAnswer(composeDeeperAnswer(p))).toEqual(p);
  });
  it("an earlier round (Teach me's parts) is not a structured round, and a structured round is not a Teach me lesson", () => {
    const v2 = "OVERVIEW: About growth [S1].\n\nUNDERSTANDING:\nIt runs from the head [S1].\n\nKEY POINTS:\n- Head first [S1]";
    expect(parseDeeperAnswer(v2)).toBeNull();
    expect(parseTeachAnswer(ROUND)).toBeNull();
    expect(parseDeeperAnswer("FOCUS QUESTION: Why?")).toBeNull();
  });
  it("an unknown source is notes, so it faces the stricter check; a malformed table still reads", () => {
    const p = parseDeeperAnswer("FOCUS QUESTION: Why?\nSECTION: nonsense | whatever | A heading\nText [S1].\n| a | b |\n| c |")!;
    expect(p.sections[0]).toMatchObject({ kind: "science", source: "notes", title: "A heading" });
    expect(p.sections[0].blocks[1].t).toBe("list");
  });
  it("reading aloud and the notes-only text carry no labels, and the notes-only text no Scholar words", () => {
    const p = parseDeeperAnswer(ROUND)!;
    expect(deeperPlainText(p)).not.toMatch(/FOCUS QUESTION|SECTION:|\|/);
    const notes = deeperNotesOnlyText(p);
    expect(notes).toContain("cephalocaudal");
    expect(notes).not.toMatch(/Nerve pathways|top down/);
  });
  it("each level is an existing depth, so a round's level is already stored and in its key", () => {
    expect(GO_DEEPER_LEVELS.map(l => l.depth)).toEqual(["brief", "standard", "detailed"]);
    expect(levelOfDepth("detailed").label).toBe("Advanced");
    expect(levelOfDepth(null).label).toBe("Explore");
  });
  it("always states the evidence limit, and never claims research that was not consulted", () => {
    expect(deeperEvidenceStatement({ research: false, scholar: true })).toMatch(/No published research was consulted/);
    expect(deeperEvidenceStatement({ research: false, scholar: true })).toMatch(/not from your notes/);
    expect(deeperEvidenceStatement({ research: true, scholar: false })).not.toMatch(/No published research/);
  });
});

describe("what a section may claim", () => {
  it.each(["Studies show that this happens.", "Research shows myelin matters.", "A randomised trial found this.", "Smith et al describe it.", "The evidence suggests it.", "Guidelines recommend it.", "Researchers think so."])("Scholar may not present as scholarship: %s", t => {
    expect(scholarClaimViolations(t)).toContain("scholarly_claim");
  });
  it.each(["This always means a disorder.", "A late walker definitely indicates delay.", "This confirms the diagnosis.", "That rules it out."])("no firm conclusion from a finding: %s", t => {
    expect(scholarClaimViolations(t)).toContain("deterministic");
  });
  it("no instruction about treating someone", () => {
    expect(scholarClaimViolations("You should refer the child at once.")).toContain("patient_directive");
    expect(scholarClaimViolations("Prescribe a course of therapy.")).toContain("patient_directive");
  });
  it("ordinary teaching passes", () => {
    expect(scholarClaimViolations("Nerve pathways serving the upper body tend to mature earlier, and the reason is debated.")).toEqual([]);
  });
  it("a notes section may say firmly what the notes say firmly, not add it", () => {
    expect(notesClaimViolations("This confirms the diagnosis [S1].", ["An X-ray confirms the diagnosis."])).toEqual([]);
    expect(notesClaimViolations("This confirms the diagnosis [S1].", ["An X-ray is taken."])).toEqual(["deterministic"]);
  });
  it("'From your notes' must rest on what is cited", () => {
    expect(notesSectionSupported("Head control comes before sitting, and sitting comes before walking [S1].", NOTES)).toBe(true);
    expect(notesSectionSupported("Myelination of corticospinal tracts advances along the spinal cord in rostral sequence [S1].", NOTES)).toBe(false);
    expect(notesSectionSupported("Head control comes before sitting, and sitting comes before walking.", NOTES)).toBe(false); // no tag
    expect(notesSectionSupported("Primitive reflexes disappear [S1].", NOTES)).toBe(true); // short: excused from the share, it still has its tag
  });
});

describe("checkDeeperAnswer", () => {
  const check = (text: string, scholar = true) => checkDeeperAnswer(text, "Help me understand", NOTES, [], { scholar, title: "Growth" });
  it("keeps a sound round in its canonical form, with what it cites", () => {
    const c = check(ROUND);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const p = parseDeeperAnswer(c.text)!;
    expect(p.sections.map(s => s.source)).toEqual(["notes", "scholar", "notes", "scholar"]);
    expect(c.cited).toEqual([1]);
    expect(c.salvaged).toBeUndefined();
    expect(p.questions[0].options).toHaveLength(2);
  });
  it("one sentence of inference moves to Scholar's explanation, and what the notes hold stays in the notes section", () => {
    const c = check(ROUND.replace("Head control comes before sitting, and sitting comes before walking [S1].", "Head control comes before sitting, and sitting comes before walking [S1]. Corticospinal myelination explains this rostral sequence entirely, because insulated fibres carry signals faster and so allow finer control of the neck [S1]."));
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const p = parseDeeperAnswer(c.text)!;
    expect(deeperSectionText(p.sections[0])).toContain("cephalocaudal");
    expect(deeperSectionText(p.sections[0])).not.toContain("myelination");
    expect(p.sections[1]).toMatchObject({ source: "scholar", title: "Development runs from the head downwards, beyond your notes" });
    expect(deeperSectionText(p.sections[1])).toContain("Corticospinal myelination explains");
  });
  it("a sentence that is neither in the notes nor sound as Scholar's own is left out and counted; a safety sentence never moves", () => {
    const figure = check(ROUND.replace("Head control comes before sitting, and sitting comes before walking [S1].", "Head control comes before sitting, and sitting comes before walking [S1]. Infants master corticospinal control within eighteen months of birth, always [S1]."));
    expect(figure.ok).toBe(true);
    if (figure.ok) expect(figure.text).not.toContain("eighteen");
    const safety = check(ROUND.replace("SECTION: misconception | scholar | A late milestone is not a diagnosis\nStudents often read one late milestone as a disorder. A single finding has to be weighed with the rest of the picture.", "SECTION: safety | notes | Red flags\nRed flags should prompt referral for further assessment [S2]. Unexplained corticospinal asymmetry demands neuroimaging urgently [S2]."));
    expect(safety.ok).toBe(true);
    if (safety.ok) { expect(safety.text).toContain("Red flags should prompt referral"); expect(safety.text).not.toContain("neuroimaging"); }
  });
  it("a model's note inside a tag is cleaned off and costs nothing", () => {
    const c = check(ROUND.replace("from the head downwards [S1].", "from the head downwards [S8 is cognitive; use] [S1]."));
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.text).not.toContain("cognitive; use");
  });
  it("a tag on an option is taken off, so an option never points at its own answer", () => {
    const c = check(ROUND.replace("a) Compare with the expected order", "a) Compare with the expected order [S1]"));
    expect(c.ok).toBe(true);
    if (c.ok) expect(parseDeeperAnswer(c.text)!.questions[0].options[0]).toBe("Compare with the expected order");
  });
  it("a mechanism wearing a citation it does not rest on is re-labelled Scholar's explanation, its tags removed", () => {
    const c = check(ROUND.replace("SECTION: compare | notes | Reflex and voluntary movement\n| Feature | Milestones |\n| --- | --- |\n| Reflexes | Primitive reflexes disappear as the nervous system matures [S1] |", "SECTION: science | notes | Myelin\nMyelination of corticospinal tracts advances along the spinal cord in rostral sequence [S1]."));
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const myelin = parseDeeperAnswer(c.text)!.sections.find(s => s.title === "Myelin")!;
    expect(myelin.source).toBe("scholar");
    expect(deeperSectionText(myelin)).not.toMatch(/\[S/);
    expect(c.salvaged).toBeUndefined();
  });
  it("Scholar's section with a figure, a dose or a research claim is left out and counted; the round stands", () => {
    for (const bad of ["Nerve pathways mature by 18 months.", "Give 5 mg of it.", "Studies show nerve pathways mature early."]) {
      const c = check(ROUND.replace("Nerve pathways serving the upper body tend to mature earlier than those serving the legs, so control arrives from the top down.", bad));
      expect(c.ok, bad).toBe(true);
      if (!c.ok) continue;
      expect(parseDeeperAnswer(c.text)!.sections.some(s => s.title.startsWith("Why the order"))).toBe(false);
      expect(c.salvaged?.parts.sections).toBe(1);
    }
  });
  it("a safety section is never Scholar's own, whatever it says", () => {
    const c = check(ROUND.replace("SECTION: misconception | scholar | A late milestone is not a diagnosis", "SECTION: safety | scholar | When to worry"));
    expect(c.ok).toBe(true);
    if (c.ok) expect(parseDeeperAnswer(c.text)!.sections.some(s => s.kind === "safety")).toBe(false);
  });
  it("a round that rests on nothing in the notes is withheld", () => {
    const c = check("FOCUS QUESTION: Why?\nSECTION: science | scholar | Own words\nPathways mature from the top down.");
    expect(c.ok).toBe(false);
  });
  it("with Scholar's explanation off by policy, its sections and re-labels are left out", () => {
    const c = check(ROUND, false);
    expect(c.ok).toBe(true);
    if (c.ok) expect(parseDeeperAnswer(c.text)!.sections.every(s => s.source === "notes")).toBe(true);
  });
  it("an identifier anywhere withholds the round", () => {
    expect(check(`${ROUND}\n- NHS number 943 476 5919`).ok).toBe(false);
  });
  it("dosing in a notes section withholds the round, as a lesson's salvage does", () => {
    const c = check(ROUND.replace("Head control comes before sitting, and sitting comes before walking [S1].", "Give 5 mg of paracetamol [S1]."));
    expect(c.ok).toBe(false);
  });
  it("a focus question with a figure the notes lack costs its wording, never the round", () => {
    const c = check(ROUND.replace("Why does a child control the head before walking?", "Why does a child walk at 12 months?"));
    expect(c.ok).toBe(true);
    if (c.ok) expect(parseDeeperAnswer(c.text)!.focus).toBe("What lies behind Growth?");
  });
  it("a question with no citation is dropped; an option with a figure costs the options, not the question", () => {
    const noTag = check(ROUND.replace("has not yet walked? [S1]", "has not yet walked?"));
    if (noTag.ok) expect(parseDeeperAnswer(noTag.text)!.questions).toHaveLength(0);
    const figure = check(ROUND.replace("Compare with the expected order", "Wait until 18 months"));
    expect(figure.ok).toBe(true);
    if (figure.ok) expect(parseDeeperAnswer(figure.text)!.questions[0].options).toEqual([]);
  });
  it("a reply without the structured labels falls back to the lesson check, and is never shown raw", () => {
    expect(check("OVERVIEW: Development runs from the head downwards [S1].\n\nKEY POINTS:\n- Head control comes before sitting [S1]").ok).toBe(true);
    expect(check("Some free text with no citation.").ok).toBe(false);
  });
});

describe("a lesson over the stored source limit", () => {
  const ids = Array.from({ length: 16 }, (_, i) => `c${i}`);
  it("still finds the teaching written for it, so it has taught ground and its rounds reopen", () => {
    expect(coversLesson(ids.slice(0, 10), ids)).toBe(true);
    expect(coversLesson([...ids.slice(0, 9), "other"], ids)).toBe(false);
    expect(coversLesson(ids.slice(1, 11), ids)).toBe(false);
    expect(coversLesson(ids.slice(0, 9), ids)).toBe(false);
  });
  it("a lesson within the limit is judged exactly as before", () => {
    expect(coversLesson(["a", "b", "x"], ["a", "b"])).toBe(true);
    expect(coversLesson(["b", "a"], ["a", "b"])).toBe(true);
    expect(coversLesson(["a"], ["a", "b"])).toBe(false);
  });
  it("its later citations are restored on reopen; anything else is what was stored", () => {
    expect(restoredSources(ids.slice(0, 10), ids)).toEqual(ids);
    expect(restoredSources(["a", "b", "x"], ["a", "b"])).toEqual(["a", "b", "x"]);
    expect(restoredSources(["z", ...ids.slice(1, 10)], ids)).toEqual(["z", ...ids.slice(1, 10)]);
  });
});

describe("saved rounds and versions", () => {
  it("the structured version is ADDED: v2 stays in force with the policy off, and is a legacy version with it on", () => {
    expect(learnPromptVersion("deeper")).toContain("scholar-learn-deeper-v2");
    expect(learnPromptVersion("deeper", { deeperStructured: true })).toContain("scholar-learn-deeper-v3");
    // Not a legacy version of the structured request: asking for a round must never be answered with an old one. A saved v2 round still opens (findSavedLesson, alsoSaved).
    expect(legacyLearnPromptVersions("deeper")).not.toContain(learnPromptVersion("deeper"));
    expect(cumulativePromptVersion(learnPromptVersion("deeper", { deeperStructured: true }))).toContain("+scholar-learn-cumulative-v1");
  });
  it("rounds of both forms count as taught ground and towards the round limit", () => {
    const v2 = { action: "deeper", content: "OVERVIEW: Earlier [S1].\n\nUNDERSTANDING:\nThe old mechanism was taught here [S1].\n\nKEY POINTS:\n- Old point [S1]", createdAt: "2026-11-01" };
    const v3 = { action: "deeper", content: ROUND, createdAt: "2026-11-02" };
    const t = buildTaughtSoFar([v2, v3]);
    expect(t.rounds.deeper).toBe(2);
    const block = taughtSoFarBlock(t)!;
    expect(block).toContain("The old mechanism was taught here");
    expect(block).toContain("Why does a child control the head before walking?");
    expect(block).toContain("Why the order follows the nervous system");
    expect(block).toContain("How would you reason about a child");
    expect(block).not.toMatch(/SECTION:|FOCUS QUESTION:/);
  });
  it("a saved round used as a passage carries only what the notes hold", () => {
    const p = savedLearningPassage({ id: "a", kind: "artefact", materialId: "m", createdAt: "2026-11-02", content: `${ROUND}\n\nFROM RESEARCH:\nA finding [E1].` });
    expect(p.content).toContain("cephalocaudal");
    expect(p.content).not.toMatch(/Nerve pathways|Students often|FROM RESEARCH|\[S1\]/);
  });
});

describe("the prompt and the call", () => {
  it("off: Go deeper's system prompt is unchanged, and on it asks for the structure", () => {
    const off = learnSystem("deeper", { depth: "standard", background: true, references: false, taught: true });
    expect(off).toContain("MODE: GO DEEPER.");
    expect(off).not.toContain("FOCUS QUESTION");
    const on = learnSystem("deeper", { depth: "standard", background: true, references: false, taught: true, deeperStructured: true });
    expect(on).toContain("FOCUS QUESTION:");
    expect(on).toContain("LEVEL: EXPLORE");
    expect(on).toContain("TAUGHT SO FAR");
    expect(on).toContain("never claim research");
    expect(on).not.toContain("BEYOND THE NOTES");
  });
  it("Scholar's explanation is not asked for when policy does not allow it", () => {
    expect(deeperInstruction({ depth: "brief", scholar: false, taught: false, depthReached: "DEPTH_REACHED" })).not.toMatch(/source 'scholar'/);
  });
  it.each(["brief", "standard", "detailed"] as const)("one model call a round at %s, with that level's room, and no second call when a section is left out", async depth => {
    const calls: { maxTokens?: number }[] = [];
    const run = (async (g: { maxTokens?: number }) => { calls.push(g); return { ok: true, text: ROUND.replace("Nerve pathways serving the upper body", "Studies show pathways"), model: "m", provider: "p" }; }) as never;
    const r = await runLearn("u", { action: "deeper", question: "Help me", passages: NOTES, references: [], depth, background: true, history: [], learnerContext: null, deeperStructured: true }, run);
    expect(calls).toHaveLength(1);
    expect(calls[0].maxTokens).toBe(DEEPER_MAX_TOKENS[depth]);
    expect(r.ok && r.promptVersion).toContain("scholar-learn-deeper-v3");
    expect(r.ok && r.check.ok && r.check.salvaged?.parts.sections).toBe(1);
  });
  it("the structured flag only reaches Go deeper", async () => {
    const calls: { system: string }[] = [];
    const run = (async (g: { system: string }) => { calls.push(g); return { ok: true, text: "OVERVIEW: Head first [S1].\n\nKEY POINTS:\n- Head first [S1]", model: "m", provider: "p" }; }) as never;
    await runLearn("u", { action: "teach", question: "Teach", passages: NOTES, references: [], depth: "standard", background: true, history: [], learnerContext: null, deeperStructured: true }, run);
    expect(calls[0].system).not.toContain("FOCUS QUESTION");
  });
});
