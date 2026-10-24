import { describe, expect, it } from "vitest";
import {
  answeredView, learnerView, nextStage, resolveOptions, resolveToken, safetyEvents, validateBlueprint, variationWithinBounds, visibleFacts,
  type Blueprint,
} from "./blueprint";

// One blueprint for private, educator and library cases (Stage 5 case interface approval s2), checked against
// IND-004's reviews: governed facts apart from narrative, reveals per decision point, machine-checkable safety
// criteria, a sound progression graph, and a browser boundary that shows only the path walked (B1-B11).

/** Scholar's existing private case (S4): 2 to 5 single-choice steps, a deterministic key, a rationale, no reveals. */
export const MINIMAL_S4: Blueprint = {
  schema: "case-blueprint/1",
  title: "Breathless after surgery",
  facts: [], progression: [], learningObjectives: [], safetyCriteria: [], references: [],
  stages: [{ id: "s1", title: "Step 1", reveals: [], decisionPointIds: ["d1"] }, { id: "s2", title: "Step 2", reveals: [], decisionPointIds: ["d2"] }],
  decisionPoints: [
    { id: "d1", stageId: "s1", kind: "single", prompt: "A patient is breathless two days after surgery. What do you assess first?", permittedReveals: [],
      options: [{ id: "a", text: "Airway and breathing", correct: true, rationale: "Assess A then B first." }, { id: "b", text: "Wound dressing", correct: false, rationale: "Not the priority." }] },
    { id: "d2", stageId: "s2", kind: "single", prompt: "Respiratory rate is 30. What next?", permittedReveals: [],
      options: [{ id: "a", text: "Escalate using SBAR", correct: true, rationale: "A rate of 30 needs urgent review." }, { id: "b", text: "Recheck in an hour", correct: false, rationale: "Delays care." }] },
  ],
  variation: { rules: [] }, aiBoundary: { patientVoice: false, phraseReveals: false, explain: true },
  metadata: { level: "foundation", complexity: 1, risk: "standard", professionTermId: null, specialtyTermIds: [], cfcaDomainIds: [], cpuIds: [],
    provenance: { kind: "private", rights: "student_private" } },
};

/** S4 as Scholar stores it: ONE rationale per step, not per option (B6). */
const S4_STEP_RATIONALE: Blueprint = {
  ...MINIMAL_S4,
  decisionPoints: MINIMAL_S4.decisionPoints.map(d => ({ ...d, rationale: `Why: ${d.prompt}`, options: d.options.map(o => ({ id: o.id, text: o.text, correct: o.correct })) })),
};

const COMP = "aced295d-5d77-4f67-8fb6-b346d80fb289";
const LIBRARY: Blueprint = {
  ...MINIMAL_S4,
  title: "Deteriorating patient on the ward",
  summary: "Recognise and escalate respiratory deterioration.",
  learnerIntro: "You are on a surgical ward. A patient calls you over.",
  patient: { ageBand: "60-69", sex: "unspecified", setting: "Surgical ward", presentingComplaint: "Breathlessness", background: ["Day 2 after abdominal surgery"] },
  facts: [
    { id: "rr", kind: "observation", label: "Respiratory rate", value: "30", unit: "breaths/min", revealedAt: "s2", safetyCritical: true, aliases: ["RR", "resp rate"] },
    { id: "spo2", kind: "observation", label: "SpO2", value: "91", unit: "%", revealedAt: "s2", safetyCritical: false },
    { id: "temp", kind: "observation", label: "Temperature", value: "37.9", unit: "C", revealedAt: "s1", safetyCritical: false },
  ],
  decisionPoints: MINIMAL_S4.decisionPoints.map(d => ({ ...d, dimension: d.id === "d1" ? "prioritisation" : "escalation", permittedReveals: d.id === "d1" ? ["spo2"] : [] })),
  progression: [{ from: "s1", onOptions: ["a"], to: "s2", consequenceFactIds: [] }, { from: "s1", isDefault: true, to: "s2", consequenceFactIds: ["spo2"] }],
  learningObjectives: [{ id: "lo1", text: "Recognise and escalate deterioration", competencyIds: [COMP], outcomes: ["Escalates a rate of 30 using SBAR"] }],
  safetyCriteria: [{ id: "sc1", text: "Escalate a rate of 30", decisionPointId: "d2", mustSelect: ["a"], mustNotSelect: ["b"] }],
  feedback: { debrief: "A rising respiratory rate is an early sign.", onSafetyEvent: "Delaying escalation risks harm." },
  variation: { rules: [{ factId: "temp", range: { min: 37.5, max: 38.5 } }] },
  metadata: { ...MINIMAL_S4.metadata, level: "intermediate", complexity: 2, provenance: { kind: "educator", rights: "educator_original" } },
};

/**
 * A branching case with distinctive ids and secrets, for the leak tests: stage_ward then, by the answer, stage_escalated
 * (key) or stage_delayed (off the key path), both ending at stage_outcome.
 */
const BRANCH: Blueprint = {
  ...LIBRARY,
  summary: "SECRET_SUMMARY sepsis is the hidden diagnosis",
  learnerIntro: "A patient on your ward looks unwell.",
  facts: [
    { id: "fact_temp", kind: "observation", label: "Temperature", value: "38.9", unit: "C", revealedAt: "start", safetyCritical: false },
    { id: "fact_lactate", kind: "result", label: "Lactate", value: "SECRET_LACTATE_4_2", unit: "mmol/L", revealedAt: "stage_escalated", safetyCritical: true },
    { id: "fact_bp", kind: "observation", label: "Blood pressure", value: "SECRET_BP_84_50", unit: "mmHg", revealedAt: "stage_delayed", safetyCritical: true },
    { id: "fact_hr", kind: "observation", label: "Heart rate", value: "118", unit: "/min", revealedAt: "stage_outcome", safetyCritical: false },
    { id: "fact_urine", kind: "observation", label: "Urine output", value: "SECRET_URINE_LOW", unit: null, revealedAt: "request", safetyCritical: false },
  ],
  stages: [
    { id: "stage_ward", title: "On the ward", reveals: [], decisionPointIds: ["dp_first"] },
    { id: "stage_escalated", title: "SECRET_TITLE_escalated", reveals: [], decisionPointIds: ["dp_escalated"] },
    { id: "stage_delayed", title: "SECRET_TITLE_delayed", reveals: [], decisionPointIds: ["dp_delayed"] },
    { id: "stage_outcome", title: "SECRET_TITLE_outcome", reveals: [], decisionPointIds: ["dp_outcome"] },
  ],
  decisionPoints: [
    { id: "dp_first", stageId: "stage_ward", kind: "single", dimension: "recognition", prompt: "What do you do first?", permittedReveals: ["fact_urine"],
      hint: "Think about the observations.", rationale: "SECRET_RATIONALE_first", expectedResponse: null,
      options: [{ id: "opt_escalate", text: "Escalate now", correct: true, rationale: "SECRET_OPTION_RATIONALE_escalate" }, { id: "opt_wait", text: "Wait an hour", correct: false, rationale: "SECRET_OPTION_RATIONALE_wait" }] },
    { id: "dp_escalated", stageId: "stage_escalated", kind: "single", dimension: "interpretation", prompt: "SECRET_PROMPT_escalated", permittedReveals: [],
      options: [{ id: "opt_x", text: "SECRET_OPTION_TEXT_x", correct: true, rationale: "r" }, { id: "opt_y", text: "y", correct: false, rationale: "r" }] },
    { id: "dp_delayed", stageId: "stage_delayed", kind: "single", dimension: "reassessment", prompt: "SECRET_PROMPT_delayed", permittedReveals: [],
      options: [{ id: "opt_p", text: "SECRET_OPTION_TEXT_p", correct: true, rationale: "r" }, { id: "opt_q", text: "q", correct: false, rationale: "r" }] },
    { id: "dp_outcome", stageId: "stage_outcome", kind: "free_text", dimension: "decision", prompt: "SECRET_PROMPT_outcome", permittedReveals: [], options: [],
      expectedResponse: "SECRET_EXPECTED", rubric: [{ id: "rb1", criterion: "SECRET_RUBRIC", weight: 1, safetyCritical: true, dimension: "decision" }] },
  ],
  progression: [
    { from: "stage_ward", onOptions: ["opt_escalate"], to: "stage_escalated", consequenceFactIds: [] },
    { from: "stage_ward", isDefault: true, to: "stage_delayed", consequenceFactIds: ["fact_bp"] },
    { from: "stage_escalated", isDefault: true, to: "stage_outcome", consequenceFactIds: [] },
    { from: "stage_delayed", isDefault: true, to: "stage_outcome", consequenceFactIds: [] },
  ],
  safetyCriteria: [{ id: "sc_wait", text: "SECRET_SAFETY waiting with sepsis risks harm", decisionPointId: "dp_first", mustNotSelect: ["opt_wait"] }],
  variation: { rules: [] },
};

const SALT = "view-salt-1";
const errors = (b: unknown, profile: "private" | "library" = "library") => validateBlueprint(b, profile).join(" | ");

describe("the clinical case blueprint: one structure, two profiles", () => {
  it("Scholar's existing private case is a valid private blueprint, as it is, and so is its one-rationale-per-step form (B6)", () => {
    expect(validateBlueprint(MINIMAL_S4, "private")).toEqual([]);
    expect(validateBlueprint(S4_STEP_RATIONALE, "private")).toEqual([]);
  });

  it("without a step rationale every option needs its own, and a library case always explains each option (B6)", () => {
    const bare = { ...S4_STEP_RATIONALE, decisionPoints: S4_STEP_RATIONALE.decisionPoints.map(d => ({ ...d, rationale: null })) };
    expect(errors(bare, "private")).toMatch(/option a needs its rationale \(or the decision needs one\)/);
    const lib = { ...LIBRARY, decisionPoints: LIBRARY.decisionPoints.map(d => ({ ...d, rationale: "Step", options: d.options.map(o => ({ ...o, rationale: null })) })) };
    expect(errors(lib)).toMatch(/option a needs its rationale/);
  });

  it("a private case is not a library case until it is offered, screened and promoted", () => {
    expect(errors(MINIMAL_S4)).toMatch(/private case cannot be a library case/);
  });

  it("a governed library case validates, and the same structure is a valid private case", () => {
    expect(validateBlueprint(LIBRARY, "library")).toEqual([]);
    expect(validateBlueprint(LIBRARY, "private")).toEqual([]);
    expect(validateBlueprint(BRANCH, "library")).toEqual([]);
  });

  it("a library decision names its reasoning dimension from the configured set (B7)", () => {
    const none = { ...LIBRARY, decisionPoints: LIBRARY.decisionPoints.map(d => ({ ...d, dimension: undefined })) };
    expect(errors(none)).toMatch(/decision d1: a reasoning dimension/);
    const wrong = { ...LIBRARY, decisionPoints: LIBRARY.decisionPoints.map(d => ({ ...d, dimension: "vibes" })) };
    expect(errors(wrong, "private")).toMatch(/a reasoning dimension/);                              // validated when present
    expect(validateBlueprint(wrong, "library", ["vibes"])).toEqual([]);                            // the set is policy
    const rubric = { ...BRANCH, decisionPoints: BRANCH.decisionPoints.map(d => (d.rubric ? { ...d, rubric: d.rubric.map(c => ({ ...c, dimension: undefined })) } : d)) };
    expect(errors(rubric)).toMatch(/rubric criterion rb1 needs a reasoning dimension/);
  });

  it("source references to the student's own sections belong to a private case only (B8)", () => {
    const refs = { ...LIBRARY, decisionPoints: LIBRARY.decisionPoints.map(d => ({ ...d, sourceRefs: ["section:abc"] })) };
    expect(validateBlueprint(refs, "private")).toEqual([]);
    expect(errors(refs)).toMatch(/sourceRefs belong to a private case only/);
  });

  it("a decision point belongs to exactly the stage that lists it (B9)", () => {
    const disagree = { ...MINIMAL_S4, decisionPoints: MINIMAL_S4.decisionPoints.map(d => (d.id === "d2" ? { ...d, stageId: "s1" } : d)) };
    expect(errors(disagree, "private")).toMatch(/decision d2: its stage must list it, and only that stage/);
    const twice = { ...MINIMAL_S4, stages: MINIMAL_S4.stages.map(s => ({ ...s, decisionPointIds: ["d1", "d2"] })) };
    expect(errors(twice, "private")).toMatch(/decision d1: its stage must list it, and only that stage/);
  });

  it("every stage is reachable, the case ends, and there is no cycle (B10)", () => {
    const three = { ...MINIMAL_S4, stages: [...MINIMAL_S4.stages, { id: "s3", title: "Step 3", reveals: [], decisionPointIds: ["d3"] }],
      decisionPoints: [...MINIMAL_S4.decisionPoints, { ...MINIMAL_S4.decisionPoints[1], id: "d3", stageId: "s3" }] };
    expect(validateBlueprint(three, "private")).toEqual([]);                                        // linear: always sound
    const unreachable = { ...three, progression: [{ from: "s1", isDefault: true, to: "s2", consequenceFactIds: [] }] };
    expect(errors(unreachable, "private")).toMatch(/stage s3 cannot be reached/);
    const loop = { ...three, progression: [{ from: "s1", isDefault: true, to: "s2", consequenceFactIds: [] }, { from: "s2", isDefault: true, to: "s3", consequenceFactIds: [] }, { from: "s3", isDefault: true, to: "s1", consequenceFactIds: [] }] };
    expect(errors(loop, "private")).toMatch(/no stage ends the case/);
    expect(errors(loop, "private")).toMatch(/a cycle/);
    const backEdge = { ...three, progression: [{ from: "s1", isDefault: true, to: "s2", consequenceFactIds: [] }, { from: "s2", onOptions: ["a"], to: "s3", consequenceFactIds: [] }, { from: "s2", isDefault: true, to: "s1", consequenceFactIds: [] }] };
    expect(errors(backEdge, "private")).toMatch(/a cycle/);
  });

  it("a stage with option transitions has a default or covers every option (B10)", () => {
    const partial = { ...MINIMAL_S4, progression: [{ from: "s1", onOptions: ["a"], to: "s2", consequenceFactIds: [] }] };
    expect(errors(partial, "private")).toMatch(/progression from s1: a stage with option transitions needs a default/);
    const full = { ...MINIMAL_S4, progression: [{ from: "s1", onOptions: ["a"], to: "s2", consequenceFactIds: [] }, { from: "s1", onOptions: ["b"], to: "s2", consequenceFactIds: [] }] };
    expect(validateBlueprint(full, "private")).toEqual([]);
  });

  it("one option never leads to two stages, and option ids are unambiguous within a stage (B11)", () => {
    const overlap = { ...LIBRARY, stages: [...LIBRARY.stages, { id: "s3", title: "Step 3", reveals: [], decisionPointIds: ["d3"] }],
      decisionPoints: [...LIBRARY.decisionPoints, { ...LIBRARY.decisionPoints[1], id: "d3", stageId: "s3" }],
      progression: [{ from: "s1", onOptions: ["a"], to: "s2", consequenceFactIds: [] }, { from: "s1", onOptions: ["a", "b"], to: "s3", consequenceFactIds: [] }, { from: "s2", isDefault: true, to: "s3", consequenceFactIds: [] }],
      safetyCriteria: [] };
    expect(errors(overlap)).toMatch(/option a leads to two stages \(overlapping transitions\)/);
    const shared = { ...MINIMAL_S4, stages: [{ ...MINIMAL_S4.stages[0], decisionPointIds: ["d1", "d2"] }], decisionPoints: MINIMAL_S4.decisionPoints.map(d => ({ ...d, stageId: "s1" })) };
    expect(errors(shared, "private")).toMatch(/stage s1: option ids repeat between its decision points/);
  });

  it("a single choice has exactly one key, every id resolves, and a stage has one default", () => {
    const twoKeys = { ...MINIMAL_S4, decisionPoints: [{ ...MINIMAL_S4.decisionPoints[0], options: MINIMAL_S4.decisionPoints[0].options.map(o => ({ ...o, correct: true })) }, MINIMAL_S4.decisionPoints[1]] };
    expect(errors(twoKeys, "private")).toMatch(/exactly one correct/);
    const twoDefaults = { ...LIBRARY, progression: [...LIBRARY.progression, { from: "s1", isDefault: true, to: "s2", consequenceFactIds: [] }] };
    expect(errors(twoDefaults)).toMatch(/only one default/);
    const ghost = { ...LIBRARY, decisionPoints: LIBRARY.decisionPoints.map(d => ({ ...d, permittedReveals: ["nope"] })) };
    expect(errors(ghost)).toMatch(/unknown fact nope/);
  });

  it("a safety-critical fact never varies, and a variation inside the rules is still the approved version", () => {
    expect(errors({ ...LIBRARY, variation: { rules: [{ factId: "rr", values: ["24", "30"] }] } })).toMatch(/safety-critical fact rr cannot vary/);
    expect(variationWithinBounds(LIBRARY, { temp: "38.1" })).toBe(true);
    expect(variationWithinBounds(LIBRARY, { temp: "39.5" })).toBe(false);
    expect(variationWithinBounds(LIBRARY, { rr: "24" })).toBe(false);
  });

  it("progression is the blueprint's: by option, by default, or the stages in order", () => {
    expect(nextStage(LIBRARY, "s1", ["a"])).toEqual({ stageId: "s2", consequenceFactIds: [] });
    expect(nextStage(LIBRARY, "s1", ["b"])).toEqual({ stageId: "s2", consequenceFactIds: ["spo2"] });
    expect(nextStage(MINIMAL_S4, "s1", ["b"]).stageId).toBe("s2");
    expect(nextStage(MINIMAL_S4, "s2", ["a"]).stageId).toBeNull();
    expect(nextStage(BRANCH, "stage_ward", ["opt_wait"])).toEqual({ stageId: "stage_delayed", consequenceFactIds: ["fact_bp"] });
  });

  it("safety events are machine-checked from the answer", () => {
    expect(safetyEvents(LIBRARY, "d2", ["a"])).toEqual([]);
    expect(safetyEvents(LIBRARY, "d2", ["b"]).map(c => c.id)).toEqual(["sc1"]);
  });
});

describe("the browser boundary (B1-B5)", () => {
  const ID_LEAKS = ["stage_ward", "stage_escalated", "stage_delayed", "stage_outcome", "dp_first", "dp_escalated", "dp_delayed", "dp_outcome",
    "opt_escalate", "opt_wait", "fact_temp", "fact_lactate", "fact_bp", "fact_hr", "fact_urine"];
  const SERVER_ONLY = ["SECRET_SUMMARY", "SECRET_RATIONALE", "SECRET_OPTION_RATIONALE", "SECRET_EXPECTED", "SECRET_RUBRIC", "SECRET_SAFETY",
    "correct", "rationale", "expectedResponse", "rubric", "consequence", "safetyCritical", "summary", "dimension", "revealedAt", "aliases", "sourceRefs"];
  const leaks = (v: unknown, extra: string[]) => { const json = JSON.stringify(v); return [...ID_LEAKS, ...SERVER_ONLY, ...extra].filter(s => json.includes(s)); };

  it("at the start: the first stage only, no future stage, no summary, no ids, no unreached fact (B1, B2, B3)", () => {
    const v = learnerView(BRANCH, { reachedStageIds: ["stage_ward"], revealedFactIds: [] }, SALT);
    expect(leaks(v, ["SECRET_TITLE", "SECRET_PROMPT", "SECRET_OPTION_TEXT", "SECRET_LACTATE", "SECRET_BP", "SECRET_URINE"])).toEqual([]);
    expect(v.intro).toBe("A patient on your ward looks unwell.");
    expect(v.stages.map(s => s.title)).toEqual(["On the ward"]);
    expect(v.facts.map(f => f.label)).toEqual(["Temperature"]);
  });

  it("a reached stage reveals its facts without the caller listing them (B4)", () => {
    const blueprint = { ...BRANCH, facts: BRANCH.facts.map(f => (f.id === "fact_urine" ? { ...f, revealedAt: "stage_escalated" } : f)),
      stages: BRANCH.stages.map(s => (s.id === "stage_escalated" ? { ...s, reveals: ["fact_urine"] } : s)) };
    expect([...visibleFacts(blueprint, { reachedStageIds: ["stage_ward", "stage_escalated"], revealedFactIds: [] })].sort()).toEqual(["fact_lactate", "fact_temp", "fact_urine"]);
  });

  it("on the key path: what was walked, never the stage off the path (B1)", () => {
    const v = learnerView(BRANCH, { reachedStageIds: ["stage_ward", "stage_escalated"], revealedFactIds: [] }, SALT);
    expect(v.stages.map(s => s.title)).toEqual(["On the ward", "SECRET_TITLE_escalated"]);
    expect(v.facts.map(f => f.value)).toContain("SECRET_LACTATE_4_2");
    expect(leaks(v, ["SECRET_TITLE_delayed", "SECRET_PROMPT_delayed", "SECRET_OPTION_TEXT_p", "SECRET_BP", "SECRET_TITLE_outcome", "SECRET_PROMPT_outcome"])).toEqual([]);
  });

  it("off the key path: the delayed branch and its consequence, never the escalated branch (B1)", () => {
    const v = learnerView(BRANCH, { reachedStageIds: ["stage_ward", "stage_delayed"], revealedFactIds: ["fact_bp"] }, SALT);
    expect(v.stages.map(s => s.title)).toEqual(["On the ward", "SECRET_TITLE_delayed"]);
    expect(leaks(v, ["SECRET_TITLE_escalated", "SECRET_PROMPT_escalated", "SECRET_OPTION_TEXT_x", "SECRET_LACTATE"])).toEqual([]);
  });

  it("a requested reveal shows only a permitted, named fact, and nothing names an unknown one", () => {
    const before = learnerView(BRANCH, { reachedStageIds: ["stage_ward"], revealedFactIds: [] }, SALT);
    expect(before.stages[0].decisionPoints[0].canReveal.map(r => r.label)).toEqual(["Urine output"]);
    const token = before.stages[0].decisionPoints[0].canReveal[0].token;
    const fact = resolveToken(BRANCH, SALT, "fact", token)!;
    const after = learnerView(BRANCH, { reachedStageIds: ["stage_ward"], revealedFactIds: [fact, "made_up"] }, SALT);
    expect(after.facts.map(f => f.value)).toContain("SECRET_URINE_LOW");
    expect(after.stages[0].decisionPoints[0].canReveal).toEqual([]);
  });

  it("tokens are opaque per view, distinct per option, and resolve only on the server with the salt (B3)", () => {
    const a = learnerView(BRANCH, { reachedStageIds: ["stage_ward"], revealedFactIds: [] }, SALT);
    const b = learnerView(BRANCH, { reachedStageIds: ["stage_ward"], revealedFactIds: [] }, "another-view");
    const dp = a.stages[0].decisionPoints[0];
    expect(dp.token).not.toBe(b.stages[0].decisionPoints[0].token);
    expect(resolveToken(BRANCH, SALT, "decision", dp.token)).toBe("dp_first");
    expect(resolveToken(BRANCH, "another-view", "decision", dp.token)).toBeNull();
    expect(resolveOptions(BRANCH, SALT, "dp_first", [dp.options[1].token])).toEqual(["opt_wait"]);
    expect(resolveOptions(BRANCH, SALT, "dp_first", ["forged"])).toBeNull();
    const s4 = learnerView(MINIMAL_S4, { reachedStageIds: ["s1", "s2"], revealedFactIds: [] }, SALT);
    const [d1, d2] = s4.stages.map(s => s.decisionPoints[0]);
    expect(d1.options[0].token).not.toBe(d2.options[0].token);                                       // both are option "a"
    expect(resolveOptions(MINIMAL_S4, SALT, "d2", [d1.options[0].token])).toBeNull();                 // not one of d2's options
  });

  it("hints appear only in guided mode", () => {
    expect(learnerView(BRANCH, { reachedStageIds: ["stage_ward"], revealedFactIds: [] }, SALT).stages[0].decisionPoints[0].hint).toBeNull();
    expect(learnerView(BRANCH, { reachedStageIds: ["stage_ward"], revealedFactIds: [] }, SALT, { hints: true }).stages[0].decisionPoints[0].hint).toBe("Think about the observations.");
  });

  it("after an answer: that decision's explanation, key and safety texts, and nothing about any other decision (B5)", () => {
    const a = answeredView(BRANCH, "dp_first", ["opt_wait"], SALT)!;
    expect(a.rationale).toBe("SECRET_RATIONALE_first");
    expect(a.options.map(o => [o.correct, o.chosen, o.rationale])).toEqual([[true, false, "SECRET_OPTION_RATIONALE_escalate"], [false, true, "SECRET_OPTION_RATIONALE_wait"]]);
    expect(a.safetyEvents).toEqual(["SECRET_SAFETY waiting with sepsis risks harm"]);
    const json = JSON.stringify(a);
    for (const s of [...ID_LEAKS, "SECRET_SUMMARY", "SECRET_PROMPT", "SECRET_TITLE", "SECRET_EXPECTED", "SECRET_LACTATE", "SECRET_BP"]) expect(json).not.toContain(s);
    expect(answeredView(BRANCH, "dp_first", ["opt_escalate"], SALT)!.safetyEvents).toEqual([]);
    expect(answeredView(BRANCH, "nope", [], SALT)).toBeNull();
  });
});
