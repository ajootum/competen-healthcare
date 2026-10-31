import { describe, expect, it } from "vitest";
import { LEARN_ACTIONS, LEARN_ACTION_LABEL, TEACHING_ACTIONS, isClassicLearnAction, isLearnAction } from "./config";
import { ARTEFACT_ACTIONS, isArtefactAction } from "./learn";
import { checkTeachingAnswer, learnPromptVersion, learnSystem, parseVerdict, type Passage } from "./generation";
import {
  TEACHING_AI_ACTIVITY, TEACHING_EVENT_ACTION, challengeNextLevels, eventVerdict, examClaimViolations, extractQuestion, highYieldExamRule, learningEventAction,
  meteredActivity, nextChallengeLevel, normaliseTeachingMarkdown, parseTeachingRequest, teachingBase, teachingInstruction, teachingMaxTokens, teachingPrompt, teachingTexts,
} from "./learn-teaching";
import { SCHOLAR_AI_ACTIVITIES } from "./ai-standing";
import { matchExamQuestions } from "./exam-evidence";
import { EXPLAIN_SYSTEM } from "./generation";

const P = (i: number, content: string): Passage => ({ chunkId: `c${i}`, materialId: "m", materialTitle: "Respiratory notes", ordinal: i, pageFrom: i, pageTo: i, content });
const passages = [P(1, "Oxygen therapy is given to treat low oxygen levels in the blood. The nurse checks the breathing rate and the colour of the skin.")];

describe("the teaching actions are wired as Learn actions", () => {
  it("are in LEARN_ACTIONS with labels, and the original seven are unchanged", () => {
    expect(TEACHING_ACTIONS).toEqual(["ask_me", "guide", "challenge", "mistake", "teach_back", "high_yield"]);
    for (const a of TEACHING_ACTIONS) { expect(LEARN_ACTIONS).toContain(a); expect(isLearnAction(a)).toBe(true); expect(LEARN_ACTION_LABEL[a]).toBeTruthy(); expect(isClassicLearnAction(a)).toBe(false); }
    expect(LEARN_ACTION_LABEL).toMatchObject({ ask_me: "Ask me", guide: "Guide me", challenge: "Challenge me", mistake: "Explain my mistake", teach_back: "Teach back", high_yield: "High-yield" });
    expect(LEARN_ACTIONS.slice(0, 7)).toEqual(["teach", "explain", "simplify", "deeper", "examples", "summary", "ask"]);
  });
  it("are never saved artefacts (415's CHECK lists only six)", () => {
    expect([...ARTEFACT_ACTIONS]).toEqual(["teach", "explain", "simplify", "deeper", "examples", "summary"]);
    for (const a of TEACHING_ACTIONS) expect(isArtefactAction(a)).toBe(false);
  });
  it("map onto learning_event values 414's CHECK allows, and on metering activities the engine lists", () => {
    const allowed = ["teach", "explain", "simplify", "deeper", "examples", "summary", "ask", "check", "clarify", "skip", "revisit", "resume"];
    expect(TEACHING_EVENT_ACTION).toEqual({ ask_me: "check", challenge: "check", guide: "explain", mistake: "clarify", teach_back: "clarify", high_yield: "summary" });
    for (const a of TEACHING_ACTIONS) { expect(allowed).toContain(TEACHING_EVENT_ACTION[a]); expect(SCHOLAR_AI_ACTIVITIES as readonly string[]).toContain(TEACHING_AI_ACTIVITY[a]); }
    expect(learningEventAction("teach_back")).toBe("clarify");
    expect(learningEventAction("teach")).toBe("teach");
    expect(meteredActivity("high_yield")).toBe("summary");
    expect(meteredActivity("ask")).toBe("ask");
  });
  it("carries a verdict only where 414 allows one (clarify): a teach back", () => {
    expect(eventVerdict("teach_back", "partly")).toBe("partly");
    expect(eventVerdict("clarify", "understood")).toBe("understood");
    for (const a of ["mistake", "ask_me", "challenge", "guide", "high_yield", "teach"]) expect(eventVerdict(a, "partly")).toBeNull();
  });
  it("have their own prompt version", () => {
    expect(learnPromptVersion("ask_me")).toBe("scholar-learn-v3:ask_me+scholar-learn-teaching-v1");
    expect(learnPromptVersion("teach")).toContain("scholar-learn-teach-v2");
  });
  it("keep their output short, except high-yield which follows the depth mapping", () => {
    for (const a of ["ask_me", "challenge", "guide", "mistake", "teach_back"] as const) expect(teachingMaxTokens(a, "detailed")).toBeLessThanOrEqual(600);
    expect(teachingMaxTokens("high_yield", "standard")).toBe(800);
    expect(teachingMaxTokens("high_yield", "detailed")).toBe(1100);
  });
});

describe("nextChallengeLevel", () => {
  it("understood goes up one, not yet down one, partly stays", () => {
    expect(nextChallengeLevel("understanding", "understood")).toBe("application");
    expect(nextChallengeLevel("understanding", "not_yet")).toBe("recall");
    expect(nextChallengeLevel("understanding", "partly")).toBe("understanding");
    expect(nextChallengeLevel("understanding", null)).toBe("understanding");
  });
  it("stops at the ends of the ladder", () => {
    expect(nextChallengeLevel("reasoning", "understood")).toBe("reasoning");
    expect(nextChallengeLevel("recall", "not_yet")).toBe("recall");
    expect(nextChallengeLevel("recall", "understood")).toBe("understanding");
  });
  it("gives the next rung for every verdict, for the client to pick", () => {
    expect(challengeNextLevels("application")).toEqual({ understood: "reasoning", partly: "application", not_yet: "understanding" });
  });
});

describe("parseTeachingRequest", () => {
  it("ask me and challenge default to understanding and refuse an unknown level", () => {
    expect(parseTeachingRequest("ask_me", {})).toEqual({ ok: true, value: { action: "ask_me", level: "understanding" } });
    expect(parseTeachingRequest("challenge", { level: "reasoning" })).toEqual({ ok: true, value: { action: "challenge", level: "reasoning" } });
    expect(parseTeachingRequest("ask_me", { level: "expert" }).ok).toBe(false);
  });
  it("guide needs a hint level 1 to 3 and bounds the attempt", () => {
    expect(parseTeachingRequest("guide", {}).ok).toBe(false);
    expect(parseTeachingRequest("guide", { hintLevel: 4 }).ok).toBe(false);
    expect(parseTeachingRequest("guide", { hintLevel: "2" }).ok).toBe(false);
    expect(parseTeachingRequest("guide", { hintLevel: 2, attempt: " I think it is oxygen " })).toEqual({ ok: true, value: { action: "guide", hintLevel: 2, attempt: "I think it is oxygen", question: "" } });
    expect(parseTeachingRequest("guide", { hintLevel: 1, attempt: "x".repeat(1501) }).ok).toBe(false);
    expect(parseTeachingRequest("guide", { hintLevel: 1, attempt: "x".repeat(1500) }).ok).toBe(true);
  });
  it("mistake needs both fields within their limits", () => {
    expect(parseTeachingRequest("mistake", { question: "Why?" }).ok).toBe(false);
    expect(parseTeachingRequest("mistake", { question: "q".repeat(601), learnerAnswer: "a" }).ok).toBe(false);
    expect(parseTeachingRequest("mistake", { question: "q", learnerAnswer: "a".repeat(1501) }).ok).toBe(false);
    expect(parseTeachingRequest("mistake", { question: "Why?", learnerAnswer: "Because" }).ok).toBe(true);
  });
  it("teach back needs an explanation of up to 3000 characters", () => {
    expect(parseTeachingRequest("teach_back", { explanation: "  " }).ok).toBe(false);
    expect(parseTeachingRequest("teach_back", { explanation: "e".repeat(3001) }).ok).toBe(false);
    expect(parseTeachingRequest("teach_back", { explanation: "e".repeat(3000) }).ok).toBe(true);
  });
  it("high-yield needs nothing, and every learner text is listed for the risk gate and the identifier screen", () => {
    expect(parseTeachingRequest("high_yield", null).ok).toBe(true);
    const g = parseTeachingRequest("guide", { hintLevel: 1, attempt: "A", question: "Q" });
    expect(g.ok && teachingTexts(g.value)).toEqual(["A", "Q"]);
    const m = parseTeachingRequest("mistake", { question: "Q", learnerAnswer: "A" });
    expect(m.ok && teachingTexts(m.value)).toEqual(["Q", "A"]);
    const t = parseTeachingRequest("teach_back", { explanation: "E" });
    expect(t.ok && teachingTexts(t.value)).toEqual(["E"]);
  });
});

describe("the prompts", () => {
  it("carry everything the learner typed, so the risk gate reads it and the grounding check allows it", () => {
    expect(teachingPrompt({ action: "mistake", question: "Why give oxygen?", learnerAnswer: "To cool the patient" })).toContain("To cool the patient");
    expect(teachingPrompt({ action: "teach_back", explanation: "It treats low oxygen" })).toContain("It treats low oxygen");
    expect(teachingPrompt({ action: "guide", hintLevel: 2, attempt: "my try", question: "" })).toContain("my try");
  });
  it("guide: only a hint, never the full answer, and the learner may choose to be told directly", () => {
    for (const n of [1, 2, 3] as const) {
      const t = teachingInstruction("guide", { hintLevel: n });
      expect(t).toMatch(/NEVER give the full answer/);
      expect(t).toContain("Explain it directly");
      expect(t).toContain(`rung ${n} of 3`);
    }
    expect(teachingInstruction("guide", { hintLevel: 1 })).toMatch(/RUNG 1, a nudge/);
    expect(teachingInstruction("guide", { hintLevel: 2 })).toMatch(/RUNG 2, a pointer/);
    expect(teachingInstruction("guide", { hintLevel: 3 })).toMatch(/RUNG 3, a near-complete scaffold/);
  });
  it("ask me gives no answer; challenge names its rung; teach back asks for a verdict line", () => {
    expect(teachingInstruction("ask_me", { level: "recall" })).toMatch(/no answer, no hint/);
    expect(teachingInstruction("challenge", { level: "application" })).toContain("Application rung");
    expect(teachingInstruction("teach_back", {})).toContain("VERDICT: understood");
    expect(teachingInstruction("mistake", {})).toContain("Quick check");
  });
  it("the system prompt replaces the plain-text rule with the markdown subset and keeps the grounding rules", () => {
    expect(EXPLAIN_SYSTEM).toContain("No markdown headings");
    const base = teachingBase(EXPLAIN_SYSTEM);
    expect(base).not.toContain("No markdown headings");
    expect(base).toContain("Use ONLY the passages");
    expect(base).toContain("> [!SUMMARY]");
    const sys = learnSystem("high_yield", { depth: "standard", background: true, references: true });
    expect(sys).toContain("GOVERNED REFERENCES");
    expect(sys).not.toContain("BEYOND THE NOTES");
    expect(learnSystem("ask_me", { depth: "standard", background: false, references: false })).not.toContain("CHECK THIS");
  });
});

describe("high-yield exam wording", () => {
  const none = null, some = { papers: 2, questions: 7 };
  it("without evidence: heading Key concepts and NO exam-frequency language allowed", () => {
    const rule = highYieldExamRule(none);
    expect(rule).toContain("## Key concepts");
    expect(rule).toMatch(/NO information about what is examined/);
    expect(rule).not.toContain("Appears in");
    expect(teachingInstruction("high_yield", { examEvidence: none })).toContain("## Key concepts");
    expect(teachingInstruction("high_yield", { examEvidence: { papers: 0, questions: 0 } })).toContain("## Key concepts");
    expect(teachingPrompt({ action: "high_yield" }, none)).not.toMatch(/past-paper/);
  });
  it("with evidence: only the counted sentence, and the number reaches the prompt", () => {
    const rule = highYieldExamRule(some);
    expect(rule).toContain("Appears in 7 of your past-paper questions.");
    expect(rule).toContain("## High-yield concepts");
    expect(rule).toMatch(/do not say or imply that anything is frequently examined/);
    expect(teachingInstruction("high_yield", { examEvidence: some })).toContain("Appears in 7 of your past-paper questions.");
    const p = teachingPrompt({ action: "high_yield" }, some);
    expect(p).toContain("7 of my past-paper questions");
    expect(p).toContain("2 of my papers");
  });
  it("a high-yield answer is withheld when it claims what the evidence does not allow", () => {
    expect(examClaimViolations("Oxygen therapy treats low oxygen. [S1]", none)).toEqual([]);
    expect(examClaimViolations("This is frequently examined. [S1]", none).length).toBe(1);
    expect(examClaimViolations("A high-yield idea. [S1]", none).length).toBe(1);
    expect(examClaimViolations("It appears in your past papers.", none).length).toBe(1);
    expect(examClaimViolations("Appears in 7 of your past-paper questions. [S1]", some)).toEqual([]);
    expect(examClaimViolations("Appears in 9 of your past-paper questions.", some).length).toBe(1);
    expect(examClaimViolations("Appears in 7 of your past-paper questions. It is frequently tested.", some).length).toBe(1);
    expect(examClaimViolations("Appears in 7 of your past-paper questions.", none).length).toBe(1);
  });
  it("checkTeachingAnswer applies it only to high-yield", () => {
    const text = "## Key concepts\n- Oxygen therapy treats low oxygen levels in the blood. [S1]\n> This is high-yield for exams. [S1]";
    expect(checkTeachingAnswer("high_yield", text, "q", passages, [])).toMatchObject({ ok: false, reason: "ungrounded" });
    expect(checkTeachingAnswer("mistake", text, "q", passages, []).ok).toBe(true);
  });
});

describe("the answer", () => {
  it("numbered list markers become bullets (every digit is a claim to the grounding check)", () => {
    expect(normaliseTeachingMarkdown("1. First idea [S1]\n2) Second idea [S1]\n> 3. Quoted [S1]")).toBe("- First idea [S1]\n- Second idea [S1]\n> - Quoted [S1]");
    const c = checkTeachingAnswer("high_yield", "1. Oxygen therapy treats low oxygen levels in the blood. [S1]\n2. The nurse checks the breathing rate. [S1]", "q", passages, []);
    expect(c.ok).toBe(true);
  });
  it("is checked exactly as any Learn answer: a citation is required and nothing ungrounded is shown", () => {
    expect(checkTeachingAnswer("guide", "Think about why oxygen is given.", "q", passages, [])).toMatchObject({ ok: false, reason: "no_citation" });
    expect(checkTeachingAnswer("guide", "Look again at [S4].", "q", passages, [])).toMatchObject({ ok: false, reason: "bad_citation" });
    expect(checkTeachingAnswer("guide", "NOT_IN_NOTES", "q", passages, [])).toMatchObject({ ok: false, reason: "not_in_notes" });
    expect(checkTeachingAnswer("guide", "### Hint\nWhat does the nurse check? [S1]", "q", passages, [])).toMatchObject({ ok: true });
  });
  it("teach back's verdict line is read by the existing parseVerdict", () => {
    const raw = "### What you got right\n- Oxygen treats low oxygen. [S1]\n\nVERDICT: partly";
    const { verdict, rest } = parseVerdict(raw);
    expect(verdict).toBe("partly");
    expect(rest).not.toContain("VERDICT");
  });
  it("extractQuestion takes exactly one question, without tags or markup", () => {
    expect(extractQuestion("### Question\nWhy is oxygen therapy given? [S1]")).toBe("Why is oxygen therapy given?");
    expect(extractQuestion("### Question\n**Why is oxygen therapy given?** [S1]")).toBe("Why is oxygen therapy given?");
    expect(extractQuestion("### Question\nWhy is it given? [S1]\nAnd what does the nurse check? [S1]")).toBeNull();
    expect(extractQuestion("### Question\nOxygen is given. [S1]")).toBeNull();
    expect(extractQuestion("### Question\nWhy?")).toBeNull();
  });
});

describe("matchExamQuestions", () => {
  const rows = [
    { materialId: "p1", stem: "Describe how oxygen therapy treats low oxygen levels." },
    { materialId: "p1", stem: "Name the layers of the skin." },
    { materialId: "p2", stem: "Explain why oxygen is given and what the nurse checks in breathing." },
    { materialId: "p3", stem: "Discuss the Mental Capacity Act." },
  ];
  it("counts questions sharing at least two key terms, and the papers they are in", () => {
    expect(matchExamQuestions(rows, ["oxygen", "therapy", "breathing"])).toEqual({ papers: 2, questions: 2 });
  });
  it("is no evidence with fewer than two key terms, or no overlap", () => {
    expect(matchExamQuestions(rows, ["oxygen"])).toEqual({ papers: 0, questions: 0 });
    expect(matchExamQuestions(rows, ["capacity", "consent"])).toEqual({ papers: 0, questions: 0 });
    expect(matchExamQuestions([], ["oxygen", "therapy"])).toEqual({ papers: 0, questions: 0 });
  });
});
