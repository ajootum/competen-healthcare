import { describe, expect, it } from "vitest";
import { DEEPER_ROUNDS_MAX, ROUND_MAX, TAUGHT_BLOCK_MAX, TAUGHT_HEADER, buildTaughtSoFar, parseDepthReached, parsePriorChecks, priorCheckTexts, taughtHash, taughtSoFarBlock } from "./learn-context";

// SCHOLAR-CUMULATIVE-TEACHING-01: the taught-so-far block is built from saved teaching and this visit's checks, round by
// round, concise, deduplicated, bounded, and never part of the passages.

const TEACH = [
  "OVERVIEW: A daily bed-bath is standard care and a chance to assess the skin [S2].",
  "UNDERSTANDING:",
  "Being moved is painful for many critically ill patients, so pain relief may be given before the bath [S2]. The bath is planned around rounds and visits [S3].",
  "",
  "A long bath lets heat escape; the vasoconstriction that follows may lead to cardiovascular instability [S3].",
  "KEY POINTS:",
  "- A daily bed-bath with intermittent washes is standard care [S2].",
  "- Increase the frequency for patients who are sweating, incontinent, bleeding or with leaking wounds [S2].",
  "EXAMPLE: A patient who is sweating heavily is washed more often [S2].",
  "CHECK YOUR UNDERSTANDING:",
  "- Why might a long bed-bath be a concern? [S3]",
].join("\n");
const DEEPER = [
  "Here is how the ideas connect.",
  "",
  "The timing of the bath follows the patient's condition: an unstable patient is moved slowly [S1].",
  "- Privacy must be ensured [S3].",
].join("\n");

describe("buildTaughtSoFar", () => {
  it("nothing taught, nothing answered: not taught, and no block", () => {
    const t = buildTaughtSoFar([], []);
    expect(t.taught).toBe(false);
    expect(taughtSoFarBlock(t)).toBeNull();
  });
  it("reads a structured lesson and a free-text round into rounds, concepts, mechanisms, examples and questions", () => {
    const t = buildTaughtSoFar([{ action: "teach", content: TEACH, createdAt: "2026-11-03T10:00:00Z" }, { action: "deeper", content: DEEPER, createdAt: "2026-11-03T10:05:00Z" }]);
    expect(t.taught).toBe(true);
    expect(t.rounds).toEqual({ teach: 1, deeper: 1 });
    expect(t.records.map(r => r.action)).toEqual(["teach", "deeper"]);
    expect(t.concepts).toEqual([
      "A daily bed-bath with intermittent washes is standard care.",
      "Increase the frequency for patients who are sweating, incontinent, bleeding or with leaking wounds.",
      "Privacy must be ensured.",
    ]);
    expect(t.understanding[0]).toMatch(/^Being moved is painful/);
    expect(t.understanding[1]).toMatch(/^A long bath lets heat escape/);
    expect(t.understanding).toContain("The timing of the bath follows the patient's condition: an unstable patient is moved slowly.");
    expect(t.examples).toEqual(["A patient who is sweating heavily is washed more often."]);
    expect(t.questionsAsked).toEqual(["Why might a long bed-bath be a concern?"]);
    const block = taughtSoFarBlock(t)!;
    expect(block).toMatch(/Round 1, Teach me \(the lesson\):[\s\S]*Round 2, Go deeper:/);
    // No citation tag survives into the block: it is not the passages.
    expect(block).not.toMatch(/\[S\d+\]/);
  });
  it("only the newest Teach me counts (a refreshed lesson replaced the older one); other rounds all count, in time order", () => {
    const t = buildTaughtSoFar([
      { action: "deeper", content: DEEPER, createdAt: "2026-11-03T10:05:00Z" },
      { action: "teach", content: TEACH, createdAt: "2026-11-03T10:00:00Z" },
      { action: "teach", content: "OVERVIEW: An older lesson about bed baths [S2].\nKEY POINTS:\n- Wash daily [S2].", createdAt: "2026-11-03T09:00:00Z" },
    ]);
    expect(t.rounds).toEqual({ teach: 1, deeper: 1 });
    expect(t.records[0].action).toBe("teach");
    expect(t.concepts.some(c => /Wash daily/.test(c))).toBe(false);
    expect(t.concepts.filter(c => /daily bed-bath/.test(c))).toHaveLength(1);
  });
  it("reads the learner's checks: the question, the answer, the verdict and the clarification's parts; open points follow", () => {
    const feedback = "VERDICT: partly\nRIGHT:\n- Sweating patients need more washes [S2].\nMISSING:\n- Pain relief before the bath [S2].\nMISCONCEPTIONS:\n- Pain relief is not given afterwards on complaint; it is anticipated [S2].\nKEY POINTS:\n- Wash more often when sweating [S2].\nNEXT: Re-read the Think Pain line [S2].";
    const t = buildTaughtSoFar([], [{ question: "Why increase the frequency of washes?", answer: "Because they get dirty faster.", verdict: "partly", feedback }]);
    expect(t.taught).toBe(true);
    expect(t.responses).toHaveLength(1);
    expect(t.responses[0]).toMatchObject({ verdict: "partly", answer: "Because they get dirty faster.", right: ["Sweating patients need more washes."], missing: ["Pain relief before the bath."] });
    expect(t.responses[0].misconceptions[0]).toMatch(/anticipated/);
    expect(t.open).toEqual(["Pain relief before the bath.", "Pain relief is not given afterwards on complaint; it is anticipated."]);
    expect(t.questionsAsked).toEqual(["Why increase the frequency of washes?"]);
    const block = taughtSoFarBlock(t)!;
    expect(block.startsWith(TAUGHT_HEADER)).toBe(true);
    expect(block).toMatch(/judged: partly/);
    expect(block).toMatch(/Still open or not yet taught/);
  });
  it("a lesson heading the teaching never used the words of is still open", () => {
    const t = buildTaughtSoFar([{ action: "teach", content: TEACH }], [], { focus: ["Bed Bath", "Skin Tears", "Eye Care Assessment"] });
    expect(t.open).toEqual(["Skin Tears", "Eye Care Assessment"]);
  });
});

describe("taughtSoFarBlock", () => {
  it("is bounded: the oldest rounds are told in one line each until the block fits; the newest round stays whole", () => {
    const names = ["airway", "breathing", "circulation", "disability", "exposure", "fluids", "glucose", "handover", "infection", "kidney", "lungs", "mobility", "nutrition", "oxygen"];
    const points = (tag: string) => names.map(n => `- The ${tag} ${n} point says something the passages explain at some length so the block grows [S1].`);
    const t = buildTaughtSoFar([
      { action: "teach", content: `KEY POINTS:\n${points("first").join("\n")}`, createdAt: "1" },
      { action: "deeper", content: `KEY POINTS:\n${points("second").join("\n")}`, createdAt: "2" },
    ]);
    expect(t.records[0].concepts).toHaveLength(ROUND_MAX.concepts);
    const block = taughtSoFarBlock(t, 1500)!;
    expect(block.length).toBeLessThanOrEqual(1500);
    expect(block).toMatch(/The second airway point/);
    expect(block).toMatch(/The second glucose point/); // the newest round in full (ROUND_MAX.concepts of it)
    expect(block).not.toMatch(/The first breathing point/); // the oldest trimmed to one point
    expect(taughtSoFarBlock(t)!.length).toBeLessThanOrEqual(TAUGHT_BLOCK_MAX);
  });
});

describe("taughtHash", () => {
  it("is stable for the same ground and changes when the ground changes", () => {
    const a = buildTaughtSoFar([{ action: "teach", content: TEACH }]);
    const b = buildTaughtSoFar([{ action: "teach", content: TEACH }]);
    const c = buildTaughtSoFar([{ action: "teach", content: TEACH }, { action: "deeper", content: DEEPER }]);
    expect(taughtHash(a)).toBe(taughtHash(b));
    expect(taughtHash(a)).not.toBe(taughtHash(c));
    expect(taughtHash(a)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("parsePriorChecks", () => {
  it("keeps well-formed checks, bounded, the last few only; drops the rest", () => {
    const raw = [
      { question: "Q1?", answer: "A1", verdict: "understood", feedback: "RIGHT:\n- yes" },
      { question: "", answer: "no question" },
      "junk",
      { question: "Q2?", verdict: "maybe", answer: 42 },
      { question: "Q3?", answer: "x".repeat(2000), verdict: "not_yet" },
      { question: "Q4?" }, { question: "Q5?" }, { question: "Q6?" },
    ];
    const out = parsePriorChecks(raw);
    expect(out.map(c => c.question)).toEqual(["Q3?", "Q4?", "Q5?", "Q6?"]);
    expect(out.find(c => c.question === "Q3?")!.answer!.length).toBe(1500);
    expect(parsePriorChecks(null)).toEqual([]);
    expect(parsePriorChecks([{ question: "Q2?", verdict: "maybe" }])[0].verdict).toBeNull();
    expect(priorCheckTexts([{ question: "q", answer: "typed", verdict: null, feedback: null }, { question: "q", answer: null, verdict: null, feedback: null }])).toEqual(["typed"]);
  });
});

describe("depth reached", () => {
  it("the marker on the first line, then the suggestion; anything else is a lesson", () => {
    expect(parseDepthReached("DEPTH_REACHED: Try the questions on skin tears instead [S4].")).toEqual({ suggestion: "Try the questions on skin tears instead." });
    expect(parseDepthReached("depth_reached\nGo on to eye care [S5].")).toEqual({ suggestion: "Go on to eye care." });
    expect(parseDepthReached("OVERVIEW: more [S1]")).toBeNull();
    expect(DEEPER_ROUNDS_MAX).toBeGreaterThanOrEqual(2);
  });
});
