import { describe, expect, it } from "vitest";
import { GUIDE_STEPS_MAX, followUpOf, guideGround, guideKeyContext, guidePrompt, guideStepCount, guideTeachStepOf, guideVerdictOf, guideVersionTurn, guidedLessonOutcome, isUncertainAnswer, mergeStatus, moveAfterVerdict, parseGuideAsk, progressWords, resumeStep } from "./guide-me";
import { guideInstruction, GUIDED_CLARIFY } from "./guide-me-prompt";
import { parseDeeperAnswer } from "./deeper-format";
import { isGuideAidVersion, isGuideTurnVersion, newestSavedLesson } from "./learn-journey";
import { buildTaughtSoFar, taughtSoFarBlock } from "./learn-context";
import { checkDeeperAnswer, checkGuidedFeedback, learnPromptVersion, learnSystem, runLearn, type Passage } from "./generation";

// SCHOLAR-GUIDE-ME-001: progress is what happened; the teaching and its question; what a response leads to.

const passage = (content: string, i = 0): Passage => ({ chunkId: `c${i}`, materialId: "m", materialTitle: "Growth", ordinal: i, pageFrom: i + 1, pageTo: i + 1, content });
const NOTES = [passage("Development proceeds in a cephalocaudal direction, from the head downwards. Head control comes before sitting, and sitting comes before walking. Primitive reflexes disappear as the nervous system matures.")];
const TURN = [
  "FOCUS QUESTION: Control comes from the head down",
  "SECTION: principle | notes | The order of development",
  "Development proceeds in a cephalocaudal direction, from the head downwards [S1]. Head control comes before sitting [S1].",
  "SECTION: science | scholar | Why the order holds",
  "Nerve pathways serving the upper body tend to mature earlier, so control arrives from the top down.",
  "SECTION: memory | scholar | A way to remember it",
  "Think of control pouring down from the head like water down a slope.",
  "CHECK YOUR REASONING:",
  "- Why would a child sit steadily before walking? [S1]",
  "- A second question that must not be kept? [S1]",
  "KEY TAKEAWAYS:",
  "- Head control comes before sitting [S1]",
].join("\n");
const check = (text: string, opts: Partial<Parameters<typeof checkDeeperAnswer>[4]> = {}) => checkDeeperAnswer(text, "Teach me", NOTES, [], { scholar: true, title: "Growth", focusIsHeading: true, requireNotes: true, maxQuestions: 1, keepTakeaways: false, ...opts });

describe("the request", () => {
  it("bounds a guided request, and anything else is not one", () => {
    expect(parseGuideAsk({ turn: "hint", step: 1, level: 2, question: " Why? " })).toEqual({ turn: "hint", step: 1, level: 2, question: "Why?" });
    expect(parseGuideAsk({ turn: "teach", step: 99 })).toMatchObject({ step: 0, level: 1 });
    expect(parseGuideAsk({ turn: "mark_me" })).toBeNull();
    expect(parseGuideAsk(null)).toBeNull();
    expect(parseGuideAsk({ turn: "hint", question: "x".repeat(900) })!.question).toHaveLength(400);
  });
  it("a step count follows the lesson, up to the most", () => {
    expect([1, 3, 4, 6, 7, 16].map(guideStepCount)).toEqual([1, 1, 2, 2, 3, GUIDE_STEPS_MAX]);
    expect(guideStepCount(0)).toBe(1);
  });
  it("each step covers its own headings, and together they cover them all", () => {
    const h = ["a", "b", "c", "d", "e", "f", "g"];
    expect([0, 1, 2].flatMap(s => guideGround(h, s, 3))).toEqual(h);
    expect(guideGround([], 0, 1)).toEqual([]);
  });
  it("the same turn on the same step is the same saved answer; a hint keeps its level; help is for the question in hand", () => {
    const k = (turn: "teach" | "hint" | "explain", step: number, level: 1 | 2, question = "Q?") => guideKeyContext({ turn, step, level, question }, 3);
    expect(k("teach", 1, 1, "A?")).toBe(k("teach", 1, 2, "B?"));
    expect(k("hint", 1, 1)).not.toBe(k("hint", 1, 2));
    expect(k("teach", 0, 1)).not.toBe(k("explain", 0, 1));
    expect(k("hint", 0, 1, "A?")).not.toBe(k("hint", 0, 1, "B?"));
    expect(k("explain", 0, 1, "A?")).not.toBe(k("explain", 0, 1, "B?"));
  });
  it("says the question it is about", () => {
    expect(guidePrompt({ turn: "hint", step: 0, level: 1, question: "Why?" })).toContain("The question I am working on: Why?");
  });
});

describe("a response decides what happens next", () => {
  it.each(["I don't know", "dont know", "not sure", "No idea.", "idk", "?", "-", "I'm stuck", "I can't remember", "unsure", "I have no idea", "Sorry, I don't know", "idk really"])("met with help, not a verdict: %s", t => {
    expect(isUncertainAnswer(t)).toBe(true);
  });
  it.each(["", "   ", "The head comes first because pathways mature from the top", "I don't know exactly, but the nerves mature from the top down, so head control comes first in a child", "Lost fluid lowers preload, so output falls", "Confused patients are at risk of falls", "Stuck receptors cannot bind", "not sure, but perhaps it lowers afterload"])("not treated as uncertainty: %s", t => {
    expect(isUncertainAnswer(t)).toBe(false);
  });
  it("correct advances; partial gets another go; a misconception gets a new question where there is one", () => {
    expect(moveAfterVerdict("understood", null)).toEqual({ primary: "next", status: "understood" });
    expect(moveAfterVerdict("partly", "Why?")).toEqual({ primary: "retry", status: "attempted" });
    expect(moveAfterVerdict("not_yet", "Why would that be?")).toEqual({ primary: "new_question", status: "attempted" });
    expect(moveAfterVerdict("not_yet", null)).toEqual({ primary: "retry", status: "attempted" });
  });
  it("a follow-up question comes from the feedback's NEXT line, without its citation", () => {
    expect(followUpOf("Now apply it. Why does sitting come first? [S1]")).toBe("Why does sitting come first?");
    expect(followUpOf("Revise the order of development [S1].")).toBeNull();
    expect(followUpOf(null)).toBeNull();
    expect(followUpOf(`${"word ".repeat(90)}why?`)).toBeNull(); // longer than the route can take
  });
});

describe("progress is what happened", () => {
  it("nothing is said to be done that was only shown", () => {
    expect(progressWords(["open", "open", "open"])).toBe("Nothing answered yet");
    expect(progressWords(["understood", "explained", "skipped"])).toBe("1 understood · 1 explained to you · 1 moved on");
  });
  it("understanding is never undone, and moving on never counts as it", () => {
    expect(mergeStatus("understood", "attempted")).toBe("understood");
    expect(mergeStatus("attempted", "understood")).toBe("understood");
    expect(mergeStatus("open", "skipped")).toBe("skipped");
  });
  it("resumes at the first step left open or not yet understood, and past the end when none is", () => {
    expect(resumeStep(["understood", "attempted", "open"])).toBe(1);
    expect(resumeStep(["understood", "explained", "skipped"])).toBe(3);
  });
});

describe("progress after a reopen comes from what is kept", () => {
  const Q = "Why does sitting come first?";
  it("reads a step's own question", () => {
    expect(guideVerdictOf(Q, [])).toBeNull();
    expect(guideVerdictOf(Q, [{ question: Q, verdict: "not_yet", next: null }])).toBe("attempted");
    expect(guideVerdictOf(Q, [{ question: Q, verdict: "not_yet", next: null }, { question: Q, verdict: "understood", next: null }])).toBe("understood");
    expect(guideVerdictOf(Q, [{ question: "Another?", verdict: "understood", next: null }])).toBeNull();
  });
  it("follows the new question feedback offered, so understanding reached there counts", () => {
    const F = "What would that mean for a child who sits late?";
    expect(guideVerdictOf(Q, [{ question: Q, verdict: "not_yet", next: `Now apply it. ${F} [S1]` }, { question: F, verdict: "understood", next: null }])).toBe("understood");
    expect(guideVerdictOf(Q, [{ question: Q, verdict: "not_yet", next: F }, { question: F, verdict: "partly", next: null }])).toBe("attempted");
  });
  it("a loop in the follow-ups cannot hang it", () => {
    expect(guideVerdictOf("A?", [{ question: "A?", verdict: "not_yet", next: "B is the one to ask?" }, { question: "B is the one to ask?", verdict: "not_yet", next: "A?" }])).toBe("attempted");
  });
});

describe("the lesson-level guided check (owner decision RELEASE-001 item 3)", () => {
  it("does not count until every step has been taught", () => {
    expect(guidedLessonOutcome(["understood"], 3)).toEqual({ complete: false, verdict: null });
    expect(guidedLessonOutcome(["understood", "understood"], 3)).toEqual({ complete: false, verdict: null });
    expect(guidedLessonOutcome([], 1)).toEqual({ complete: false, verdict: null });
  });
  it("then says what the steps show, and never more", () => {
    expect(guidedLessonOutcome(["understood", "understood", "understood"], 3)).toEqual({ complete: true, verdict: "understood" });
    expect(guidedLessonOutcome(["understood", "attempted", null], 3)).toEqual({ complete: true, verdict: "partly" });
    expect(guidedLessonOutcome(["understood", null, null], 3)).toEqual({ complete: true, verdict: "partly" });
    expect(guidedLessonOutcome([null, null, null], 3)).toEqual({ complete: true, verdict: null });
  });
  it("reads a teaching step's place from its version, and nothing else", () => {
    expect(guideTeachStepOf(learnPromptVersion("explain", { guide: guideVersionTurn("teach", 2) }))).toBe(2);
    expect(guideTeachStepOf(learnPromptVersion("explain", { guide: guideVersionTurn("hint", 2) }))).toBeNull();
    expect(guideTeachStepOf(learnPromptVersion("explain", { guide: guideVersionTurn("explain", 2) }))).toBeNull();
    expect(guideTeachStepOf(learnPromptVersion("explain"))).toBeNull();
    expect(guideTeachStepOf(`${learnPromptVersion("explain", { guide: guideVersionTurn("teach", 1) })}+scholar-learn-cumulative-v1`)).toBe(1);
  });
});

describe("the teaching turn", () => {
  it("keeps one question, its sources and a real memory aid, under the same checks as Go Deeper", () => {
    const c = check(TURN);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const p = parseDeeperAnswer(c.text)!;
    expect(p.focus).toBe("Control comes from the head down");
    expect(p.questions.map(q => q.text)).toEqual(["Why would a child sit steadily before walking? [S1]"]);
    expect(p.takeaways).toEqual([]);
    expect(p.sections.map(s => `${s.kind}:${s.source}`)).toEqual(["principle:notes", "science:scholar", "memory:scholar"]);
  });
  it("a teaching step that rests on nothing in the notes is withheld; a hint or an example need not", () => {
    const own = "FOCUS QUESTION: The idea\nSECTION: principle | scholar | Think about it\nConsider what has to mature before a limb can be aimed.";
    expect(check(own).ok).toBe(false);
    expect(check(own, { requireNotes: false, maxQuestions: 0 }).ok).toBe(true);
  });
  it.each(["Click Next step when you are ready to continue.", "Use the hint button if you are stuck.", "Always check the airway first.", "Give the child a feed first, every time."])("a memory aid is memory, not an instruction: %s", t => {
    const c = check(`FOCUS QUESTION: X\nSECTION: principle | notes | N\nHead control comes before sitting, and sitting comes before walking [S1].\nSECTION: memory | scholar | Remember\n${t}`);
    expect(c.ok).toBe(true);
    if (c.ok) expect(parseDeeperAnswer(c.text)!.sections.some(s => s.kind === "memory")).toBe(false);
  });
  it("a hint holds no question and the same bans", () => {
    const c = check("FOCUS QUESTION: The idea\nSECTION: principle | scholar | Think\nStudies show this confirms the diagnosis.\nCHECK YOUR REASONING:\n- Why? [S1]", { requireNotes: false, maxQuestions: 0 });
    expect(c.ok).toBe(false);
  });
  it("the prompt teaches first, asks one meaningful question, and never sends the learner to the wording", () => {
    const t = guideInstruction({ turn: "teach", step: 0, of: 3, ground: ["Reflexes"], depth: "standard", scholar: true, taught: true, level: 1 });
    expect(t).toMatch(/teach first, then ask/);
    expect(t).toMatch(/exactly ONE question/);
    expect(t).toMatch(/Never ask them to find, repeat, list or recall wording/);
    expect(t).toContain("step 1 of 3");
    expect(t).toContain("Reflexes");
    expect(t).toMatch(/never for an instruction/);
    expect(t).not.toMatch(/\[!MEMORY\]/);
  });
  it("a hint or an example does not pretend to have seen an answer", () => {
    for (const turn of ["hint", "example"] as const) expect(guideInstruction({ turn, step: 0, of: 1, ground: [], depth: "standard", scholar: true, taught: false, level: 1 })).toMatch(/do not judge/);
  });
  it("Just explain it asks for substance, with more room than a step", () => {
    const t = guideInstruction({ turn: "explain", step: 0, of: 1, ground: [], depth: "standard", scholar: true, taught: false, level: 1 });
    expect(t).toMatch(/substantive explanation, not a restatement of the notes/);
    expect(t).toContain("under 430 words");
  });
  it("Scholar's explanation is not asked for where policy does not allow it", () => {
    expect(guideInstruction({ turn: "teach", step: 0, of: 1, ground: [], depth: "brief", scholar: false, taught: false, level: 1 })).not.toMatch(/source 'scholar'/);
  });
});

describe("feedback on a real answer", () => {
  const P = [passage("Head control comes before sitting. Red flags should prompt referral.")];
  it("one word does not cost a learner all of it; the bullet goes, the rest stands, and it says so", () => {
    const c = checkGuidedFeedback("RIGHT:\n- Head control comes before sitting [S1].\n\nKEY POINTS:\n- The two can coexist [S1].\n- Red flags should prompt referral [S1].", "my answer", P, [], "partly");
    expect(c.ok).toBe(true);
    if (c.ok) { expect(c.text).not.toContain("The two"); expect(c.text).toContain("Red flags"); expect(c.salvaged?.removed).toBe(1); }
  });
  it("a dose in the feedback still withholds it all", () => {
    expect(checkGuidedFeedback("RIGHT:\n- Head control comes before sitting [S1].\n- Give 5 mg of it [S1].", "my answer", P, [], "partly").ok).toBe(false);
  });
  it("a correction is never quietly lost on an answer not understood", () => {
    expect(checkGuidedFeedback("RIGHT:\n- Head control comes before sitting [S1].\n\nMISCONCEPTIONS:\n- The two come together [S1].", "my answer", P, [], "not_yet").ok).toBe(false);
    expect(checkGuidedFeedback("RIGHT:\n- Head control comes before sitting [S1].\n\nMISSING:\n- The two come together [S1].", "my answer", P, [], "partly").ok).toBe(false);
  });
  it("only a whole bullet can go: a label's own text or a wrapped line withholds, so nothing is misfiled", () => {
    expect(checkGuidedFeedback("RIGHT:\n- Head control comes before sitting [S1].\n\nKEY POINTS: The two come together [S1].\n- Red flags should prompt referral [S1].", "my answer", P, [], "partly").ok).toBe(false);
    expect(checkGuidedFeedback("RIGHT:\n- Head control comes before sitting [S1].\nand the two together [S1].", "my answer", P, [], "partly").ok).toBe(false);
  });
  it("a guided answer with no verdict is not judged, and 'VERDICT: partly.' reads as partly", async () => {
    const reply = (text: string) => (async () => ({ ok: true, text, model: "m", provider: "p" })) as never;
    const args = { action: "clarify" as const, question: "Q", passages: P, references: [], depth: "standard" as const, background: false, history: [], learnerContext: null, guidedClarify: true };
    const none = await runLearn("u", args, reply("RIGHT:\n- Head control comes before sitting [S1]."));
    expect(none.ok && none.check.ok).toBe(false);
    const dotted = await runLearn("u", args, reply("VERDICT: partly.\nRIGHT:\n- Head control comes before sitting [S1]."));
    expect(dotted.ok && dotted.verdict).toBe("partly");
  });
  it("a kind-less section can still say it is Scholar's, and nothing else escapes the notes rules", () => {
    expect(parseDeeperAnswer("FOCUS QUESTION: X\nSECTION: scholar | A heading\nText.")!.sections[0]).toMatchObject({ source: "scholar", title: "A heading" });
    expect(parseDeeperAnswer("FOCUS QUESTION: X\nSECTION: principle | A heading\nText.")!.sections[0].source).toBe("notes");
  });
  it("'two-way' is an exchange, not a count", () => {
    const c = check("FOCUS QUESTION: X\nSECTION: principle | notes | N\nHead control comes before sitting, and sitting comes before walking [S1].\nSECTION: science | scholar | S\nThe exchange becomes two-way as the infant responds.");
    expect(c.ok && parseDeeperAnswer(c.text)!.sections.length).toBe(2);
  });
});

describe("one call, its own version, never an Explain", () => {
  const G = { turn: "teach" as const, step: 0, of: 1, ground: [], level: 1 as const };
  it("one model call a turn, under Guide Me's version and prompt", async () => {
    const calls: { system: string; maxTokens?: number }[] = [];
    const run = (async (g: { system: string; maxTokens?: number }) => { calls.push(g); return { ok: true, text: TURN, model: "m", provider: "p" }; }) as never;
    const r = await runLearn("u", { action: "explain", question: "Teach", passages: NOTES, references: [], depth: "standard", background: true, history: [], learnerContext: null, guide: G }, run);
    expect(calls).toHaveLength(1);
    expect(calls[0].system).toContain("MODE: GUIDE ME");
    expect(calls[0].maxTokens).toBe(1100);
    expect(r.ok && r.promptVersion).toContain("+scholar-guide-me-v1:teach:0");
  });
  it("without the policy's request an Explain is exactly an Explain", () => {
    expect(learnPromptVersion("explain")).not.toContain("guide-me");
    expect(learnSystem("explain", { depth: "standard", background: true, references: false })).not.toContain("GUIDE ME");
    expect(learnSystem("clarify", { depth: "standard", background: false, references: false })).not.toContain(GUIDED_CLARIFY);
    expect(learnSystem("clarify", { depth: "standard", background: false, references: false, guidedClarify: true })).toContain(GUIDED_CLARIFY);
  });
  it("a saved turn is taught ground, told as Guide me, and is never reopened as an Explain", () => {
    const guide = { action: "guide", content: TURN, createdAt: "2026-11-02" };
    expect(taughtSoFarBlock(buildTaughtSoFar([guide]))).toContain("Guide me");
    const v = learnPromptVersion("explain", { guide: "teach:0" });
    expect(isGuideAidVersion(v)).toBe(false);
    expect(isGuideAidVersion(learnPromptVersion("explain", { guide: "hint" }))).toBe(true);
    expect(isGuideAidVersion(learnPromptVersion("explain", { guide: "example" }))).toBe(true);
    expect(isGuideAidVersion(learnPromptVersion("explain"))).toBe(false);
    expect(isGuideTurnVersion(v)).toBe(true);
    expect(isGuideTurnVersion(learnPromptVersion("explain"))).toBe(false);
    const row = { action: "explain", materialId: "m", sources: ["c0"], createdAt: "2026-11-02", promptVersion: v };
    expect(newestSavedLesson([row], { action: "explain", chunkIds: ["c0"] })).toBeNull();
    expect(newestSavedLesson([{ ...row, promptVersion: learnPromptVersion("explain") }], { action: "explain", chunkIds: ["c0"] })).not.toBeNull();
  });
});
