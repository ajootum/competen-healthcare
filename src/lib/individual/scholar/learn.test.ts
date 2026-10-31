import { describe, expect, it } from "vitest";
import { LESSON_MAX_CHARS, LESSON_MAX_SECTIONS, LESSON_THIN_CHARS, artefactKey, isArtefactAction, lessonOutline, planSteps, sectionHeading, sectionProfile, stepTitle } from "./learn";
import { activityState, getScholarAiStanding, type AiStanding } from "./ai-standing";
import { offeredActions, sessionView } from "./learn-view";
import { buildLearnerContext } from "./learner-context";
import {
  checkCheckQuestion, checkFlags, checkLearnMain, learnSystem, parseVerdict, splitLearnAnswer, FLAG_MARKER, SUPPLEMENTARY_MARKER,
  type GovernedReference, type Passage,
} from "./generation";
import type { SectionRef } from "./store";

// COMPETEN-SCHOLAR-LEARN-01 (owner GO 2026-10-24): the pure pieces of Stage 3. The routes, the store and the
// model are covered over HTTP on staging (scripts/scholar-learn01-harness.ts).

const sec = (id: string, m: string, ordinal: number): SectionRef => ({ chunkId: id, materialId: m, ordinal, pageFrom: ordinal, pageTo: ordinal, materialTitle: m.toUpperCase(), unit: "page" });
const P = (i: number, content: string): Passage => ({ chunkId: `c${i}`, materialId: "m", materialTitle: "Respiratory notes", ordinal: i, pageFrom: i, pageTo: i, content });
const PASSAGES = [
  P(1, "Oxygen is prescribed to a target saturation range. A Venturi mask delivers a fixed concentration of oxygen."),
  P(2, "Hypoxaemia means a low level of oxygen in the blood. Monitor the oxygen saturation and escalate if it falls."),
];
const REFS: GovernedReference[] = [{ title: "Oxygen therapy", code: null, outcome: "Administer oxygen safely to a prescribed target range", status: "Not clinically reviewed" }];

describe("L3: the suggested steps (no AI)", () => {
  const sections = [sec("a1", "a", 1), sec("a2", "a", 2), sec("a3", "a", 3), sec("a4", "a", 4), sec("b1", "b", 1)];
  it("groups consecutive sections of one material into balanced lessons, never across materials", () => {
    const { steps, coverage } = planSteps(sections, new Map(), 10);
    // SCHOLAR-LEARN-FIX-01: four ordinary sections make two balanced lessons (was 3 + 1 at the old step size).
    expect(steps.map(s => s.sections.map(x => x.chunkId))).toEqual([["a1", "a2"], ["a3", "a4"], ["b1"]]);
    expect(steps.every(s => s.sections.length <= LESSON_MAX_SECTIONS && new Set(s.sections.map(x => x.materialId)).size === 1)).toBe(true);
    expect(coverage).toEqual({ sections: 5, of: 5 });
  });
  it("cuts where the topics change, and covers everything it can when the steps are capped", () => {
    const topics = new Map([["a1", ["Airway"]], ["a2", ["airway", "Larynx"]], ["a3", ["Gas exchange"]], ["a4", ["gas exchange"]]]);
    expect(planSteps(sections, topics, 10).steps.map(s => s.sections.map(x => x.chunkId))).toEqual([["a1", "a2"], ["a3", "a4"], ["b1"]]);
    // SCHOLAR-LEARN-FIX-01: capped at two, the lessons hold all five sections (was 4 of 5: a step size of 3 truncated).
    const capped = planSteps(sections, topics, 2);
    expect(capped.steps.map(s => s.sections.map(x => x.chunkId))).toEqual([["a1", "a2", "a3", "a4"], ["b1"]]);
    expect(capped.coverage).toEqual({ sections: 5, of: 5 });
  });
  it("names a step by its topics, or by where it is in the notes", () => {
    const [first] = planSteps([sec("a1", "a", 1)], new Map(), 5).steps;
    // SCHOLAR-LEARN-FIX-01: the top two topics phrased as a title (was "Airway, Larynx").
    expect(stepTitle(first, new Map([["a1", ["Airway", "airway", "Larynx"]]]))).toBe("Airway and larynx");
    expect(stepTitle(first, new Map())).toBe("A, page 1");
  });
});

// SCHOLAR-LEARN-FIX-01 L-A. A deck shaped like production's "Quality Improvement Science and Methods" (47 sections,
// a 64-character title slide, an agenda, runs of slides under one heading, a 23-character divider, a short last slide
// of a run). Production gave 8 steps over 9 of its 47 sections, step 1 the title slide alone.
const DECK: [string, number][] = [
  ["Improving care: science and methods", 64], ["Objectives", 154], ["What is quality in care?", 350], ["Dimensions of care quality", 241],
  ["Dimensions of care quality", 672], ["What is improvement?", 357], ["Patient safety", 396], ["Error", 189], ["Adverse event", 238], ["Near miss", 200],
  ["Harm and systems", 462], ["Harm and systems thinking", 492], ["", 372], ["Systems: a framework", 196], ["Systems thinking", 588], ["A systemic problem", 346],
  ["Layers of defence", 190], ["Attribution error", 292], ["Attribution error", 563], ["Fair culture", 410], ["Fair culture", 496], ["Fair culture", 554],
  ["Improvement model", 1051], ["Improvement model", 1051], ["Improvement model", 1010], ["Measures", 577], ["", 921], ["", 1035],
  ["Tools for safety", 23], ["Tools", 177], ["Cause and effect diagram", 415], ["Cause and effect diagram", 254],
  ["Driver diagram", 283], ["Driver diagram", 322], ["Driver diagram", 265], ["Driver diagram", 243],
  ["Failure modes analysis", 497], ["Failure modes analysis", 287], ["Failure modes analysis", 462], ["Failure modes analysis", 41],
  ["Study worksheet", 383], ["Study worksheet", 319], ["Study worksheet", 804], ["Study worksheet", 471], ["Study worksheet", 460], ["Study worksheet", 566], ["Study worksheet", 542],
];
const deckSecs = DECK.map((_, i) => ({ chunkId: `s${i + 1}`, materialId: "qi", ordinal: i + 1, pageFrom: i + 1, pageTo: i + 1, materialTitle: "QI", unit: "slide" as const }));
const deckText = (heading: string, chars: number) => {
  const body = heading ? `${heading}\n` : "Every system is perfectly designed to get the results it gets.\n";
  return (body + "the improvement of care and its measures is described here in more words. ".repeat(40)).slice(0, chars);
};
const deckProfiles = new Map(DECK.map(([h, n], i) => [`s${i + 1}`, sectionProfile(deckText(h, n))]));

describe("SCHOLAR-LEARN-FIX-01: lessons, not slides", () => {
  const plan = planSteps(deckSecs, new Map(), 8, deckProfiles);
  const ids = plan.steps.map(s => s.sections.map(x => x.chunkId));
  it("covers the whole deck in at most maxSteps lessons, in document order, each lesson contiguous", () => {
    expect(plan.steps.length).toBeLessThanOrEqual(8);
    expect(plan.coverage).toEqual({ sections: 47, of: 47 });
    expect(ids.flat()).toEqual(deckSecs.map(s => s.chunkId));
    expect(plan.steps.map(s => s.step)).toEqual(plan.steps.map((_, i) => i));
  });
  it("never makes a thin title, agenda or divider slide a lesson of its own", () => {
    expect(ids[0].slice(0, 3)).toEqual(["s1", "s2", "s3"]);
    for (const s of plan.steps) expect(s.sections.reduce((n, x) => n + deckProfiles.get(x.chunkId)!.chars, 0)).toBeGreaterThanOrEqual(LESSON_THIN_CHARS);
    // The divider ("Tools for safety", 23 characters) leads into what follows; the short last slide of a run stays with its run.
    expect(ids.findIndex(l => l.includes("s29"))).toBe(ids.findIndex(l => l.includes("s30")));
    expect(ids.findIndex(l => l.includes("s40"))).toBe(ids.findIndex(l => l.includes("s39")));
  });
  it("keeps a run of slides under one heading together, and balances the lessons", () => {
    const together = (from: number, to: number) => new Set(Array.from({ length: to - from + 1 }, (_, i) => ids.findIndex(l => l.includes(`s${from + i}`)))).size === 1;
    expect([together(20, 22), together(23, 25), together(33, 36), together(41, 47)]).toEqual([true, true, true, true]);
    expect(plan.steps.every(s => s.sections.length <= LESSON_MAX_SECTIONS)).toBe(true);
  });
  it("is deterministic", () => {
    expect(planSteps(deckSecs, new Map(), 8, deckProfiles)).toEqual(plan);
  });
  it("beyond capacity: one contiguous run from the start, and coverage says how much", () => {
    const many = Array.from({ length: 300 }, (_, i) => sec(`x${i}`, "x", i + 1));
    const big = new Map(many.map(s => [s.chunkId, { heading: null, chars: 1200 }]));
    const r = planSteps(many, new Map(), 3, big);
    expect(r.steps.length).toBe(3);
    expect(r.steps.flatMap(s => s.sections.map(x => x.chunkId))).toEqual(many.slice(0, r.coverage.sections).map(s => s.chunkId));
    expect(r.coverage.of).toBe(300);
    expect(r.coverage.sections).toBe(18); // 3 lessons x 7200 characters
    expect(r.steps.every(s => s.sections.reduce((n, x) => n + big.get(x.chunkId)!.chars, 0) <= LESSON_MAX_CHARS)).toBe(true);
  });
});

describe("SCHOLAR-LEARN-FIX-01: lesson titles and objectives (deterministic, no AI)", () => {
  const step = (...xs: [string, string][]) => ({
    step: { step: 0, sections: xs.map(([id], i) => sec(id, "m", i + 1)) },
    profiles: new Map(xs.map(([id, text]) => [id, sectionProfile(text)])),
  });
  it("titles a lesson by the heading carrying most of its text, sentence-cased where the notes write the words so", () => {
    const { step: s, profiles } = step(["o", "Objectives\nBy the end you will know the model."], ["m1", "Model For Improvement\nThe model for improvement asks three questions."], ["m2", "Model For Improvement\nEach change is tested in a cycle."], ["d", "Measures\nOutcome measures."]);
    const o = lessonOutline(s, new Map(), profiles);
    expect(o.title).toBe("Model for improvement");
    expect(o.objective).toBe("Describe model for improvement, including measures.");
  });
  it("never titles a lesson Objectives, keeps acronyms, drops a bracketed citation, and stays within 80 characters", () => {
    expect(lessonOutline(step(["a", "Agenda\nToday."]).step, new Map([["a", ["Quality improvement", "Patient safety"]]]), step(["a", "Agenda\nToday."]).profiles).title).toBe("Quality improvement and patient safety");
    const f = step(["f", "Failure Modes and Effects Analysis (FMEA)\nfailure modes are listed with their effects and analysis."]);
    expect(lessonOutline(f.step, new Map(), f.profiles).title).toBe("Failure modes and effects analysis (FMEA)");
    const c = step(["c", "Just Culture (Leape, 2000)\nA just culture separates error from blame."]);
    expect(lessonOutline(c.step, new Map(), c.profiles)).toMatchObject({ title: "Just culture", objective: "Explain just culture." });
    const long = step(["l", `Interprofessional approaches to recognising and escalating deteriorating adult patients\n${"x".repeat(200)}`]);
    expect(lessonOutline(long.step, new Map(), long.profiles).title.length).toBeLessThanOrEqual(80);
  });
  it("phrases a question heading as an objective, and a sentence is never a heading", () => {
    const q = step(["q", "What is Quality in Healthcare?\nquality in healthcare is safe, timely and effective care."]);
    expect(lessonOutline(q.step, new Map(), q.profiles)).toMatchObject({ title: "What is quality in healthcare?", objective: "Explain what quality in healthcare is." });
    expect(sectionHeading("Every system is perfectly designed to achieve the results it gets.\nMore.")).toBeNull();
    expect(sectionHeading("Speaker notes:\nx")).toBeNull();
  });
  it("sessionView exposes each lesson's title and objective", () => {
    const { step: s, profiles } = step(["m1", "Model For Improvement\nThe model for improvement."]);
    expect(sessionView({ id: null, recorded: false, title: "t", scopeKind: "document", currentStep: 0, status: "active", coverage: null, steps: [s], topics: new Map(), profiles }).steps[0])
      .toMatchObject({ title: "Model for improvement", objective: "Describe model for improvement." });
  });
});

describe("L2 and s7: four kinds of content, kept apart and checked", () => {
  it("splits the notes, the background and the AI flags, in either order", () => {
    const raw = `Oxygen is prescribed to a target range [S1].\n${FLAG_MARKER}\n- Check the escalation rule in [S2].\n${SUPPLEMENTARY_MARKER}\nGeneral principle.`;
    expect(splitLearnAnswer(raw)).toEqual({ main: "Oxygen is prescribed to a target range [S1].", background: "General principle.", flags: "- Check the escalation rule in [S2].", research: null });
    expect(splitLearnAnswer("Just notes [S1].")).toEqual({ main: "Just notes [S1].", background: null, flags: null, research: null });
  });
  it("shows a cited answer that may cite a governed reference, and withholds an invented tag or an added figure", () => {
    expect(checkLearnMain("A Venturi mask delivers a fixed concentration [S1]. This supports your outcome [R1].", "Teach me.", PASSAGES, REFS)).toMatchObject({ ok: true, cited: [1] });
    expect(checkLearnMain("Oxygen is prescribed [S1] and see [R2].", "x", PASSAGES, REFS)).toMatchObject({ ok: false, reason: "bad_citation" });
    expect(checkLearnMain("Oxygen is prescribed [S3].", "x", PASSAGES, REFS)).toMatchObject({ ok: false, reason: "bad_citation" });
    expect(checkLearnMain("Aim for 94 percent [S1].", "x", PASSAGES, REFS)).toMatchObject({ ok: false, reason: "ungrounded" });
    expect(checkLearnMain("A governed reference alone [R1].", "x", PASSAGES, REFS)).toMatchObject({ ok: false, reason: "no_citation" });
    expect(checkLearnMain("NOT_IN_NOTES", "x", PASSAGES, REFS)).toMatchObject({ ok: false, reason: "not_in_notes" });
  });
  it("keeps only flags that cite a given passage and add nothing", () => {
    const r = checkFlags("- The escalation rule in [S2] is unclear: check it with your supervisor.\n- Something uncited.\n- Give 40 percent oxygen [S1].", PASSAGES);
    expect(r.kept.map(f => f.cited)).toEqual([[2]]);
    expect(r.dropped).toBe(2);
    expect(checkFlags(null, PASSAGES)).toEqual({ kept: [], dropped: 0 });
  });
});

describe("L3: the informal check and the clarification", () => {
  it("accepts one grounded open question, and refuses a malformed or ungrounded one", () => {
    expect(checkCheckQuestion("QUESTION: Why is oxygen given to a target saturation range?", PASSAGES)).toEqual({ ok: true, question: "Why is oxygen given to a target saturation range?" });
    expect(checkCheckQuestion("Why oxygen", PASSAGES)).toMatchObject({ ok: false, reason: "malformed" });
    expect(checkCheckQuestion("QUESTION: What does 28 percent mean?", PASSAGES)).toMatchObject({ ok: false, reason: "ungrounded" });
  });
  it("reads the verdict line, and only the three verdicts", () => {
    expect(parseVerdict("VERDICT: partly\nYou named the target range [S1].")).toEqual({ verdict: "partly", rest: "You named the target range [S1]." });
    expect(parseVerdict("**VERDICT: not yet**\nLook again [S2].").verdict).toBe("not_yet");
    expect(parseVerdict("VERDICT: excellent\nWell done [S1].").verdict).toBeNull();
  });
});

describe("AI-FAIR-USE-01 s8 and s7: saved artefacts and continuity", () => {
  const base = { action: "teach", depth: "standard", chunkIds: ["c1", "c2"], promptVersion: "scholar-learn-v1:teach", references: REFS, background: true };
  it("the same request has the same key, whatever the order of its sections; anything that changes the answer changes it", () => {
    expect(artefactKey(base)).toBe(artefactKey({ ...base, chunkIds: ["c2", "c1"] }));
    expect(artefactKey(base)).toMatch(/^[0-9a-f]{64}$/);
    for (const changed of [{ depth: "brief" }, { action: "simplify" }, { chunkIds: ["c1"] }, { promptVersion: "scholar-learn-v2:teach" }, { references: [] }, { background: false }])
      expect(artefactKey({ ...base, ...changed })).not.toBe(artefactKey(base));
  });
  it("only reusable answers are artefacts: conversation (ask, check, clarify) is not", () => {
    expect(["teach", "explain", "simplify", "deeper", "examples", "summary"].every(isArtefactAction)).toBe(true);
    expect(["ask", "check", "clarify"].some(isArtefactAction)).toBe(false);
  });
  it("metering off: what the standing lists counts (25 October 2026: eligibility gates clinical risk with metering off too)", () => {
    // Before: every activity available with metering off, even with no published policy. Now (allowance.ts
    // unmeteredGate): an activity the published policy does not define has no known risk floor, so it is refused, and
    // a clinical one with no eligible model is not available. A listed, available activity is.
    const off: AiStanding = { readable: true, metered: false, level: "full", remaining: { band: "plenty", percent: null }, resetsAt: null, activities: {}, message: null };
    expect(activityState(off, "teach").available).toBe(false);
    const listed: AiStanding = { ...off, activities: { teach: { label: "Teach me", available: true, via: "included", reason: null }, check: { label: "Check", available: false, via: null, reason: "not eligible" } } };
    expect(activityState(listed, "teach")).toEqual({ available: true, message: null, insufficient: false });
    expect(activityState(listed, "check").available).toBe(false);
    expect(typeof getScholarAiStanding).toBe("function");
  });
  it("metering on: a limited standing says so plainly, and never quietly downgrades", () => {
    const on: AiStanding = { readable: true, metered: true, level: "full", remaining: { band: "plenty", percent: null }, resetsAt: null, message: null,
      activities: { teach: { label: "Teach me", available: true, via: "included", reason: null }, deeper: { label: "Go deeper", available: false, via: null, reason: "level_insufficient" } } };
    expect(activityState(on, "teach").available).toBe(true);
    expect(activityState(on, "deeper")).toMatchObject({ available: false, insufficient: true, message: expect.stringMatching(/will not use a weaker one/) });
    const spent: AiStanding = { ...on, level: "continuity", message: "Your AI allowance resets on Monday.", activities: { teach: { label: "Teach me", available: false, via: null, reason: "allowance_exhausted" } } };
    expect(activityState(spent, "teach")).toEqual({ available: false, message: "Your AI allowance resets on Monday.", insufficient: false });
    expect(activityState(on, "examples").available).toBe(false); // an activity the published policy does not list
    expect(activityState({ ...on, readable: false }, "teach").available).toBe(false);
  });
});

describe("L5: what the policy decides", () => {
  it("asks for background only where policy allows it and the action may carry it, and offers references only when there are some", () => {
    expect(learnSystem("teach", { depth: "standard", background: true, references: true })).toContain(SUPPLEMENTARY_MARKER);
    expect(learnSystem("summary", { depth: "standard", background: true, references: false })).not.toContain(SUPPLEMENTARY_MARKER);
    expect(learnSystem("teach", { depth: "standard", background: false, references: false })).not.toContain(SUPPLEMENTARY_MARKER);
    expect(learnSystem("teach", { depth: "brief", background: false, references: true })).toMatch(/under 120 words[\s\S]*GOVERNED REFERENCES/);
    expect(learnSystem("check", { depth: "detailed", background: true, references: true })).not.toMatch(/GOVERNED REFERENCES|CHECK THIS/);
  });
  it("offers the policy's actions, in Scholar's order, starting with the student's choice where it is on", () => {
    const policy = { scholarLearningActions: ["ask", "teach", "summary"] as ("ask" | "teach" | "summary")[], scholarDefaultAction: "teach" as const };
    expect(offeredActions(policy)).toEqual({ actions: ["teach", "summary", "ask"], start: "teach" });
    expect(offeredActions(policy, "summary").start).toBe("summary");
    expect(offeredActions(policy, "deeper").start).toBe("teach");
    expect(offeredActions({ scholarLearningActions: ["summary"], scholarDefaultAction: "teach" }).start).toBe("summary");
  });
  it("pitches to the student's level, words only", () => {
    expect(buildLearnerContext({ programme: "Nursing (Uganda), diploma", level: "Year 2", passageCompetencies: [], progress: null }))
      .toBe("I study: Nursing (Uganda), diploma.\nMy level: Year two. Pitch explanations to it.");
  });
});
