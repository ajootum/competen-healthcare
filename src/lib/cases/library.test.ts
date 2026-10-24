/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { aiEntry, applyAnswer, applyVariation, caseMatches, pickVariation } from "./library";
import { judgeOffer } from "./candidates";
import { resolveCasePolicy, DEFAULT_CASE_POLICY } from "./policy";
import type { Blueprint } from "./blueprint";
import { MINIMAL_S4 } from "./fixtures";

// C4 delivery is deterministic: the blueprint's key, safety criteria and progression, the server's session state.
// C1 offers are judged deterministically: a valid private blueprint, the verbatim check, the identifier screen.

const COMP = "aced295d-5d77-4f67-8fb6-b346d80fb289";
const BRANCHING: Blueprint = {
  ...MINIMAL_S4,
  title: "Septic on the ward",
  facts: [
    { id: "temp", kind: "observation", label: "Temperature", value: "38.9", unit: "C", revealedAt: "start", safetyCritical: false },
    { id: "lact", kind: "result", label: "Lactate", value: "4.2", unit: "mmol/L", revealedAt: "request", safetyCritical: true },
    { id: "bp", kind: "observation", label: "BP", value: "84/50", unit: "mmHg", revealedAt: "request", safetyCritical: true },
  ],
  stages: [
    { id: "s1", title: "Ward", reveals: [], decisionPointIds: ["d1"] },
    { id: "s2", title: "Escalated", reveals: [], decisionPointIds: ["d2"] },
    { id: "s3", title: "Delayed", reveals: [], decisionPointIds: ["d3"] },
  ],
  decisionPoints: [
    { id: "d1", stageId: "s1", kind: "single", prompt: "First?", permittedReveals: ["lact"], options: [{ id: "esc", text: "Escalate", correct: true, rationale: "r" }, { id: "wait", text: "Wait", correct: false, rationale: "r" }] },
    { id: "d2", stageId: "s2", kind: "multiple", prompt: "Bundle?", permittedReveals: [], options: [{ id: "abx", text: "Antibiotics", correct: true, rationale: "r" }, { id: "fl", text: "Fluids", correct: true, rationale: "r" }] },
    { id: "d3", stageId: "s3", kind: "free_text", prompt: "Hand over.", permittedReveals: [], options: [], expectedResponse: "SBAR" },
  ],
  progression: [{ from: "s1", onOptions: ["esc"], to: "s2", consequenceFactIds: [] }, { from: "s1", isDefault: true, to: "s3", consequenceFactIds: ["bp"] }],
  safetyCriteria: [{ id: "sc", text: "Do not wait", decisionPointId: "d1", mustNotSelect: ["wait"] }],
  variation: { rules: [{ factId: "temp", range: { min: 38.5, max: 39.5 } }] },
  learningObjectives: [{ id: "lo", text: "Recognise sepsis", competencyIds: [COMP] }],
};
const fresh = { reached_stage_ids: ["s1"], revealed_fact_ids: [] as string[], answers: [] as any[] };

describe("case delivery (C4)", () => {
  it("an answer moves along the blueprint's own path and records safety events", () => {
    const wait = applyAnswer(BRANCHING, fresh, "d1", ["wait"], null, "t");
    expect(wait).toMatchObject({ reached: ["s1", "s3"], revealed: ["bp"], completed: false, safety: 1 });
    const esc = applyAnswer(BRANCHING, fresh, "d1", ["esc"], null, "t");
    expect(esc).toMatchObject({ reached: ["s1", "s2"], revealed: [], completed: false, safety: 0 });
  });

  it("a terminal stage completes the session (R1), whatever its place in the array", () => {
    const at2 = { reached_stage_ids: ["s1", "s2"], revealed_fact_ids: [], answers: [{ decisionPointId: "d1", chosen: ["esc"], at: "t", safety: 0 }] };
    expect(applyAnswer(BRANCHING, at2, "d2", ["abx", "fl"], null, "t")).toMatchObject({ reached: ["s1", "s2"], completed: true });
    const at3 = { reached_stage_ids: ["s1", "s3"], revealed_fact_ids: ["bp"], answers: [{ decisionPointId: "d1", chosen: ["wait"], at: "t", safety: 1 }] };
    expect(applyAnswer(BRANCHING, at3, "d3", [], "S: septic. B: ... A: ... R: review now", "t")).toMatchObject({ completed: true });
  });

  it("only the current stage's unanswered decisions can be answered, in their own form", () => {
    expect(applyAnswer(BRANCHING, fresh, "d2", ["abx"], null, "t")).toEqual({ error: "That decision is not on the current stage." });
    expect(applyAnswer(BRANCHING, fresh, "d1", ["esc", "wait"], null, "t")).toEqual({ error: "Choose one option." });
    const done = { ...fresh, answers: [{ decisionPointId: "d1", chosen: ["esc"], at: "t", safety: 0 }] };
    expect(applyAnswer(BRANCHING, done, "d1", ["esc"], null, "t")).toEqual({ error: "That decision is already answered." });
    expect(applyAnswer(BRANCHING, { ...fresh, reached_stage_ids: ["s1", "s3"] }, "d3", [], "  ", "t")).toEqual({ error: "Write your answer." });
  });

  it("a variation stays inside the approved rules, and an out-of-bounds one is never applied", () => {
    const v = pickVariation(BRANCHING, "seed-1", true);
    expect(Number(v.temp)).toBeGreaterThanOrEqual(38.5);
    expect(Number(v.temp)).toBeLessThanOrEqual(39.5);
    expect(pickVariation(BRANCHING, "seed-1", false)).toEqual({});
    expect(applyVariation(BRANCHING, { temp: "41.0" }).facts[0].value).toBe("38.9");
    expect(applyVariation(BRANCHING, { lact: "1.0" }).facts[1].value).toBe("4.2");          // safety-critical never varies
  });

  it("a search matches competency, topic, level and context from stored metadata, with no AI", () => {
    const v = { content: BRANCHING, level: "foundation", competencyIds: [COMP] };
    expect(caseMatches(v, { competencyIds: [COMP] })).toBe(true);
    expect(caseMatches(v, { competencyIds: ["00000000-0000-0000-0000-000000000000"] })).toBe(false);
    expect(caseMatches(v, { topic: "sepsis recognition" })).toBe(true);
    expect(caseMatches(v, { topic: "fracture" })).toBe(false);
    expect(caseMatches(v, { level: "advanced" })).toBe(false);
  });
});

describe("AI feedback on a library session (424)", () => {
  it("is always an AI evaluation naming its provider, model and request, or nothing", () => {
    const e = aiEntry({ provider: "anthropic", model: "claude-sonnet-4-6", requestId: "case.fb:00000001", text: " Good escalation. " }, "2026-10-25T10:00:00Z");
    expect(e).toEqual({ kind: "ai_evaluation", provider: "anthropic", model: "claude-sonnet-4-6", modelVersion: null, policyVersion: null, requestId: "case.fb:00000001", text: "Good escalation.", at: "2026-10-25T10:00:00Z" });
    expect(aiEntry({ provider: "anthropic", model: "", requestId: "case.fb:00000001", text: "x" }, "t")).toBeNull();
    expect(aiEntry({ provider: "anthropic", model: "m", requestId: "short", text: "x" }, "t")).toBeNull();
    expect(aiEntry({ provider: "anthropic", model: "m", requestId: "case.fb:00000001", text: "  " }, "t")).toBeNull();
  });
});

describe("candidate offers (C1)", () => {
  it("eligible only when valid, verbatim-checked and screened clean", () => {
    expect(judgeOffer(MINIMAL_S4, { passed: true, version: "verbatim/1" })).toEqual({ valid: true, reasons: [] });
    expect(judgeOffer(MINIMAL_S4, { passed: false, version: "verbatim/1" })).toEqual({ valid: true, reasons: ["verbatim_overlap"] });
    expect(judgeOffer(MINIMAL_S4, null)).toEqual({ valid: true, reasons: ["verbatim_unchecked"] });
    const leaky = { ...MINIMAL_S4, title: "Mrs Okello, MRN 1234567" };
    expect(judgeOffer(leaky, { passed: true, version: "verbatim/1" })).toEqual({ valid: true, reasons: ["hospital_number", "titled_name"] });
    expect(judgeOffer({ title: "not a blueprint" }, { passed: true, version: "v" }).valid).toBe(false);
  });

  it("the case policy is clamped, and an unknown attestation version falls back to a known one", () => {
    expect(resolveCasePolicy({ candidateRetentionDays: 9999, offerLimit: 0, attestationVersion: "case-attest/99" }))
      .toEqual({ ...DEFAULT_CASE_POLICY, candidateRetentionDays: 730, offerLimit: 1 });
  });
});
