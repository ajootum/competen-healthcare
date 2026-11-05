import { describe, expect, it } from "vitest";
import { DEPTHS, REVISION_INTENT, REVISION_INTENTS, aboutTheDocument, depthAimLine, depthOfAnswer, differentFactsFirst, factKeyOf, followUpConcepts, intentFormats, looksLikeCitation, thinForQuestions, withoutPartLabel } from "./revision-depth";
import { flashcardDraftProblem, generationContextBlock, matchPairProblem, NO_CONTEXT, parseRubric, rubricOf } from "./question-intel";
import { pickQuestions, type PoolItem } from "./revision";
import { EVALUATE_SYSTEM, REVISION_SYSTEM, QUESTION_SYSTEM, parseEvaluation } from "./generation";
import { PROMPT_VERSIONS } from "./config";

const item = (id: string, over: Partial<PoolItem> = {}): PoolItem => ({
  id, kind: "mcq", difficulty: 2, chunkId: "c1", createdAt: `2026-11-01T00:00:0${id.length}Z`, latestCorrect: null, misses: 0, lastAnsweredAt: null, due: false, ...over,
});
const pick = (pool: PoolItem[], over: Partial<Parameters<typeof pickQuestions>[0]> = {}) =>
  pickQuestions({ mode: "quick", pool, quantity: 2, formats: ["mcq"], difficulty: "any", seed: "s", ...over });

describe("the six depth categories", () => {
  it("are exactly the owner's six, in order", () => {
    expect(DEPTHS).toEqual(["recall", "understand", "interpret", "apply", "analyse", "evaluate"]);
  });
  it("reads a stored depth, and an older item's level as a depth, and nothing for an item with no rubric", () => {
    expect(depthOfAnswer({ rubric: { depth: "interpret", level: "application" } })).toBe("interpret");
    expect(depthOfAnswer({ rubric: { level: "understanding" } })).toBe("understand");
    expect(depthOfAnswer({ rubric: { level: "reasoning" } })).toBe("analyse");
    expect(depthOfAnswer({})).toBeNull();
    expect(depthOfAnswer(null)).toBeNull();
  });
  it("keeps a generated depth in the rubric, and ignores an invented one", () => {
    const made = parseRubric({ level: "application", depth: "evaluate", objective: "x" }, ["x"], { expectedAnswer: null, difficulty: 3 });
    expect(made.depth).toBe("evaluate");
    expect(parseRubric({ level: "recall", depth: "memorise" }, [], { expectedAnswer: null, difficulty: 1 }).depth).toBe("recall");
  });
  it("still reads a rubric written before depth existed", () => {
    expect(rubricOf({ rubric: { level: "recall", objective: "o" } })?.level).toBe("recall");
    expect(rubricOf({ rubric: { level: "recall", depth: "apply" } })?.depth).toBe("apply");
  });
  it("steers only when a sitting aims at depths, and says to stay within the passage", () => {
    expect(depthAimLine([])).toBeNull();
    expect(generationContextBlock(NO_CONTEXT)).toBe("");
    const block = generationContextBlock({ ...NO_CONTEXT, depths: ["apply", "analyse"] });
    expect(block).toContain('DEPTH AIM for this sitting: "apply" or "analyse"');
    expect(block).toContain("If it does not, write what it does support.");
  });
});

describe("the prompts", () => {
  it("ask for depth and a different fact on the formats that moved", () => {
    for (const k of ["mrq", "short", "flashcard", "match", "sequence", "structured", "true_false", "extended"] as const) expect(REVISION_SYSTEM[k]).toContain("DEPTH. Every item also has");
    expect(QUESTION_SYSTEM.mcq).toContain("must tempt someone who has not understood");
    expect(REVISION_SYSTEM.short).toContain("explain why, interpret a finding");
    expect(REVISION_SYSTEM.match).toContain("never repeats its left term");
  });
  it("leave the scenario prompt alone, because a stored scenario is served only at its current version", () => {
    expect(REVISION_SYSTEM.scenario).not.toContain("DEPTH. Every item also has");
    expect(PROMPT_VERSIONS.scenario).toBe("scholar-scenario-v3");
  });
});

describe("the evaluator", () => {
  const g = ["kidney infection fever loin pain"];
  it("is told what can count as missing", () => {
    expect(EVALUATE_SYSTEM).toContain("Only what the accepted answers and key points require can be missing");
  });
  it("shows nothing missing beside a correct verdict, and keeps it beside a partial one", () => {
    const body = "RIGHT: kidney infection
MISSING: fever
WHY: loin pain";
    const yes = parseEvaluation(`VERDICT: correct
${body}`, g);
    expect(yes.ok && yes.parts?.missing).toEqual([]);
    expect(yes.ok && yes.feedback).not.toContain("fever");
    const partly = parseEvaluation(`VERDICT: partly
${body}`, g);
    expect(partly.ok && partly.parts?.missing).toEqual(["fever"]);
  });
  it("keeps the list on an extended answer, which is scored by the key points it matched", () => {
    const r = parseEvaluation("VERDICT: correct
MATCHED: 1
RIGHT: kidney infection
MISSING: fever", g, { keyPoints: 2 });
    expect(r.ok && r.parts?.missing).toEqual(["fever"]);
  });
});

describe("the four intentions", () => {
  it("are the owner's four, with the owner's names", () => {
    expect(REVISION_INTENTS.map(i => REVISION_INTENT[i].label)).toEqual(["Quick Recall", "Deep Understanding", "Clinical Reasoning", "Mixed Challenge"]);
  });
  it("offer only what HQ offers, and everything where none of their formats is offered", () => {
    expect(intentFormats("clinical_reasoning", ["mcq", "short", "match"])).toEqual(["mcq", "short"]);
    expect(intentFormats("clinical_reasoning", ["match"])).toEqual(["match"]);
    expect(intentFormats("mixed_challenge", ["mcq", "match"])).toEqual(["mcq", "match"]);
  });
  it("prefer the depth asked for, then fill from the rest", () => {
    const pool = [item("a", { depth: "recall" }), item("bb", { depth: "apply" }), item("ccc", { depth: "recall" })];
    expect(pick(pool, { depths: ["apply"] }).ids).toEqual(["bb", "a"]);
  });
});

describe("a set of different facts", () => {
  it("fills with different facts first, and treats no objective as no repeat", () => {
    const xs = [{ id: 1, factKey: "a" }, { id: 2, factKey: "a" }, { id: 3, factKey: null }, { id: 4, factKey: null }, { id: 5, factKey: "b" }];
    expect(differentFactsFirst(xs).map(x => x.id)).toEqual([1, 3, 4, 5, 2]);
    expect(factKeyOf("c", " Name the  Stages! ")).toBe(factKeyOf("c", "name the stages"));
    expect(factKeyOf("c", null)).toBeNull();
  });
  it("does not offer the same objective twice while another fact is available", () => {
    const pool = [item("a", { factKey: "f" }), item("bb", { factKey: "f" }), item("ccc", { factKey: "g" })];
    expect(pick(pool).ids).toEqual(["a", "ccc"]);
  });
  it("prefers what the current prompt wrote among what is unseen", () => {
    const pool = [item("a"), item("bb", { current: true })];
    expect(pick(pool, { quantity: 1 }).ids).toEqual(["bb"]);
  });
  it("leaves what is due and what was missed in their order", () => {
    const pool = [item("a", { due: true }), item("bb", { due: true, current: true })];
    expect(pick(pool, { mode: "spaced", quantity: 2 }).ids).toEqual(["a", "bb"]);
  });
});

describe("after a miss", () => {
  it("never offers the question just missed", () => {
    expect(pick([item("a"), item("bb")], { exclude: ["a"], quantity: 2 }).ids).toEqual(["bb"]);
  });
  it("focuses on what the answer missed, each once", () => {
    expect(followUpConcepts({ missing: ["Oxygen"], misconceptions: ["oxygen", "Airway first"], keyPoints: ["Reassess"] })).toEqual(["Oxygen", "Airway first", "Reassess"]);
  });
});

describe("format checks", () => {
  it("refuses a flashcard that holds its own answer, or a scenario disguised as one", () => {
    expect(flashcardDraftProblem("Which nerve, the vagus nerve, slows the heart?", "the vagus nerve", "x")).toBe("answer_in_front");
    expect(flashcardDraftProblem(`${"A patient arrives and ".repeat(10)}what now?`, "Assess", "x")).toBe("front_long");
    expect(flashcardDraftProblem("Which nerve slows the heart?", "The vagus nerve", "x")).toBeNull();
  });
  it("refuses matching where the pairs give themselves away, and allows a shared ordinary word", () => {
    expect(matchPairProblem([{ left: "Bradycardia", right: "bradycardia means slow" }, { left: "Tachycardia", right: "tachycardia means fast" }, { left: "Apnoea", right: "stopped breathing" }])).toBe("answer_in_pair");
    expect(matchPairProblem([{ left: "Bradycardia", right: "a slow heart rate" }, { left: "Tachycardia", right: "a fast heart rate" }, { left: "Apnoea", right: "stopped breathing" }])).toBeNull();
  });
});

describe("test the subject, not the slide", () => {
  it("spots a question about the document, and leaves ordinary clinical wording alone", () => {
    for (const s of ["According to the passage, what is the focus?", "Which of the following are listed among the objectives?", "What does the slide say about hygiene?", "The objectives include determining the elements of care.", "The passage frames quality as supported by what, as shown in its subtitle?"]) expect(aboutTheDocument(s)).toBe(true);
    for (const s of ["A patient declines a hygiene measure. What does this reflect?", "Why might a patient require a blanket while bathing?", "What is the aim of a bed bath?"]) expect(aboutTheDocument(s)).toBe(false);
  });
  it("does not write from a title, an objectives slide or a reference list", () => {
    expect(thinForQuestions("Essential Nursing Care of the Critically Ill")).toBe(true);
    expect(thinForQuestions(`Objectives: ${"describe the care of a patient and its reasons in practice ".repeat(4)}`)).toBe(true);
    expect(thinForQuestions(`References ${"word ".repeat(200)}`)).toBe(true);
    expect(thinForQuestions(`Waldman, 2006, Systems thinking, 17(1), 117-130. http://dx.doi.org/10.1080/1 ${"more words here ".repeat(12)}`)).toBe(true);
    expect(thinForQuestions("Skin assessment during a bath shows pressure damage early. ".repeat(8))).toBe(false);
  });
  it("spots a citation, and a clinical sentence with a number is not one", () => {
    expect(looksLikeCitation("Waldman, J.D. & Schargel, F.P., 2006, 'Twins in trouble', 17(1), 117-130. http://dx.doi.org/10.1080/x")).toBe(true);
    expect(looksLikeCitation("Give 500 mg every 6 hours and reassess after 30 minutes.")).toBe(false);
  });
  it("takes a part label off, because the screen numbers the parts", () => {
    expect(withoutPartLabel("part (a): Why move slowly?")).toBe("Why move slowly?");
    expect(withoutPartLabel("Part b. Why?")).toBe("Why?");
    expect(withoutPartLabel("Particular care is needed why?")).toBe("Particular care is needed why?");
  });
  it("mixes formats in Mixed Challenge rather than serving what is due in one format", () => {
    const pool = [item("a", { kind: "flashcard", due: true }), item("bb", { kind: "flashcard", due: true }), item("ccc", { kind: "mcq" })];
    expect(pickQuestions({ mode: "today", pool, quantity: 2, formats: ["flashcard", "mcq"], difficulty: "any", seed: "s", varied: true }).ids).toEqual(["a", "ccc"]);
  });
});
