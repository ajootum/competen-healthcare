/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import {
  capStructured, checkRevisionDraft, codeMarkParts, effectiveKind, keyOf, learnerItem, markResponse, parseResponse, practiceMarks, structuredParts, withSafety, writtenSafety,
  type PartResult,
} from "./revision";
import { parseEvaluation, revisionPromptVersion, runEvaluate, runCaseReasoning, runRevisionQuestions, type Passage } from "./generation";
import { feedbackView, keptAttemptView } from "./revision-view";
import { applySnapshot, rubricSnapshotOf, snapshotOf } from "./rubric-snapshot";
import { storedPartResults } from "./written-feedback";
import { capScenario, markStageByCode, readProgress, scenarioSpecOf, signProgress, tokenKey } from "./scenario";
import { applyBlindVerification, blindItemOf, calculationAgrees } from "./blind-verify";
import { PROMPT_VERSIONS } from "./config";
import { REVISION_FORMATS, REVISION_FORMATS_OFF_BY_DEFAULT, BLIND_FORMATS, FORMAT_ROW } from "./question-formats";
import { SCORING_RULES_VERSION, storedCalculation, markCalculation, calculationSpecOf, unsafeStatement } from "./scoring-rules";
import { caseCriteria, criteriaMarksLine, recordedFeedbackText } from "./clinical-library-feedback";
import { criteriaMarks } from "./scoring-rules";
import { reasonContextFrom } from "@/lib/cases/library";
import { resolvePolicy, policyDef, policyPath } from "../policy";
import type { QuestionRow } from "./store";

// SQIE-CLOSE-2026-11: WS-B (unsafe responses), WS-C (justification and interpretation), WS-A (calculation), wired through the revision
// rules, the evaluator, the feedback view, the scenario token, the blind check and the case feedback. Old attempts stay interpretable.

const NOTE = [
  "Potassium chloride must never be given as an intravenous bolus.",
  "Concentrated potassium is diluted and given by infusion.",
  "Paracetamol oral suspension contains 250 mg in 5 mL.",
  "A dose of 500 mg is prescribed.",
  "Sepsis needs urgent escalation to the medical team.",
].join("\n");
const passage: Passage = { chunkId: "c1", materialId: "m1", materialTitle: "Safety notes", ordinal: 1, pageFrom: 1, pageTo: 1, content: NOTE };
const row = (over: Partial<QuestionRow> & Record<string, unknown>): QuestionRow => ({
  id: "q1", materialId: "m1", chunkId: "c1", kind: "short", stem: "Stem?", options: [], correctIndex: null, rationale: "r", sourceQuote: "q", model: "m", promptVersion: "v", createdAt: "2026-10-01T00:00:00Z",
  answer: null, difficulty: 2, materialTitle: "M", ordinal: 1, pageFrom: 1, pageTo: 1, unit: "page", latest: null, competencyId: null, caseId: null, caseStep: null, caseTitle: null, ...over,
}) as QuestionRow;
const fakeRun = (replies: string[]) => { const systems: string[] = []; return { systems, run: async (g: any) => { systems.push(g.system); return { ok: true as const, text: replies.shift() ?? "", model: "fake", provider: "fake" } as never; } }; };

// ── WS-B ──

const SHORT_UNSAFE = row({ answer: { accepted: ["by infusion", "diluted infusion"], safetyCritical: true, unsafe: ["as an IV bolus", "IV bolus"] }, stem: "How is concentrated potassium given?" });

describe("WS-B short answers: an unsafe answer is recognised, capped and named", () => {
  it("code recognises an authored unsafe answer: no marks, not correct, the statement kept (rules v2)", () => {
    const m = markResponse(SHORT_UNSAFE, { kind: "text", text: "IV bolus" }) as any;
    expect(m).toMatchObject({ correct: false, score: 0, marking: "deterministic", safety: { outcome: "unsafe", statement: "IV bolus", by: "code" } });
    expect(markResponse(SHORT_UNSAFE, { kind: "text", text: "by infusion" })).toEqual({ correct: true, score: 1, marking: "deterministic" });
    expect(markResponse(SHORT_UNSAFE, { kind: "text", text: "slowly, diluted, over time" })).toEqual({ needsJudgement: true });
  });
  it("the evaluator's UNSAFE line is a flag; the v3 item cap (at most half) applies only while the caps are active", () => {
    const e = parseEvaluation("VERDICT: correct\nUNSAFE: push it as an IV bolus\nRIGHT: none\nMISSING: diluted infusion\nMISCONCEPTIONS: none\nWHY: Potassium chloride must never be given as an intravenous bolus.\nNEXT: none", [NOTE], { safety: { answer: "I would push it as an IV bolus" } });
    expect(e).toMatchObject({ ok: true, verdict: "correct", score: 1, unsafe: ["push it as an IV bolus"] });
    const s = writtenSafety(SHORT_UNSAFE, { correct: true, unsafe: unsafeStatement((e as any).unsafe), matched: null });
    expect(withSafety({ correct: true, score: 1 }, s, "ai", { capsActive: true })).toEqual({ mark: { correct: false, score: 0.5 }, safety: { outcome: "unsafe", statement: "push it as an IV bolus", by: "ai", capped: true } });
    expect(withSafety({ correct: true, score: 1 }, s, "ai")).toEqual({ mark: { correct: true, score: 1 }, safety: { outcome: "unsafe", statement: "push it as an IV bolus", by: "ai", capped: false } });
    // A safety-critical item answered partly: a safety-critical failure, 0 of the item when active.
    expect(withSafety({ correct: false, score: 0.5 }, writtenSafety(SHORT_UNSAFE, { correct: false, unsafe: null, matched: null }), "ai", { capsActive: true }).mark).toEqual({ correct: false, score: 0 });
    expect(writtenSafety(SHORT_UNSAFE, { correct: false, unsafe: null, matched: null }).outcome).toBe("critical_missed");
    expect(writtenSafety(row({ answer: { accepted: ["x"] } }), { correct: false, unsafe: null, matched: null }).outcome).toBe("safe");
  });
  it("the evaluator's own prompt carries the UNSAFE line (WS-B evaluate v3); this branch adds no suffix to it", async () => {
    const ai = fakeRun(["VERDICT: correct\nUNSAFE: none\nRIGHT: by infusion"]);
    const e = await runEvaluate("u", { question: "How?", accepted: ["by infusion"], answer: "by infusion", passage }, ai.run) as any;
    expect(ai.systems[0]).toMatch(/UNSAFE/);
    expect(e.promptVersion).toBe(PROMPT_VERSIONS.evaluate);
    expect(unsafeStatement(["a", "b"])).toBe("a; b"); expect(unsafeStatement([])).toBeNull();
  });
  it("an extended answer that misses a safety-critical key point is a critical miss naming it", () => {
    const ext = row({ answer: { format: "extended", accepted: ["m"], modelAnswer: "Dilute it and infuse it; never as a bolus; check the prescription.", marks: 3, partialCredit: { rule: "per_key_point", marksPerPoint: 1 },
      safetyCriticalPoints: [1], rubric: { level: "understanding", keyPoints: ["Dilute it", "Never as an IV bolus", "Check the prescription"] } } });
    expect(writtenSafety(ext, { correct: false, unsafe: null, matched: [0, 2] })).toEqual({ outcome: "critical_missed", statement: null, missed: ["Never as an IV bolus"] });
    expect(writtenSafety(ext, { correct: true, unsafe: null, matched: [0, 1, 2] }).outcome).toBe("safe");
  });
});

const PARTS = [
  { prompt: "(a) How is concentrated potassium given?", marks: 2, accepted: ["by infusion"], safetyCritical: true, unsafe: ["IV bolus"] },
  { prompt: "(b) What does sepsis need?", marks: 2, accepted: ["urgent escalation"] },
];
const STRUCT = row({ kind: "structured", answer: { parts: PARTS } });

describe("WS-B structured (v3): a cap applies AT THE PART, never to the other parts", () => {
  it("an authored unsafe answer is a wrong answer (0 for that part); the OTHER part keeps its marks", () => {
    const coded = codeMarkParts(structuredParts(STRUCT), ["IV bolus", "urgent escalation"]);
    expect(coded[0]).toEqual({ awarded: 0, by: "code", unsafe: "IV bolus" });
    const m = markResponse(STRUCT, { kind: "parts", texts: ["IV bolus", "urgent escalation"] }, { caps: { capsActive: true } }) as any;
    expect(m).toMatchObject({ correct: false, score: 0.5, safety: { outcome: "unsafe", statement: "IV bolus", by: "code", capped: true } });
  });
  it("an AI-flagged unsafe part keeps at most half ITS marks (active); the rest of the attempt is untouched", () => {
    const parts = structuredParts(STRUCT);
    const results: PartResult[] = [{ awarded: 2, by: "ai", unsafe: "push it fast" }, { awarded: 2, by: "code" }];
    const on = capStructured(parts, results, { capsActive: true });
    expect(on.results.map(r => r.awarded)).toEqual([1, 2]);
    expect(practiceMarks(parts, on.results)).toMatchObject({ awarded: 3, total: 4, correct: false });
    expect(on.safety).toMatchObject({ outcome: "unsafe", statement: "push it fast", by: "ai", capped: true });
    const off = capStructured(parts, results);
    expect(off.results.map(r => r.awarded)).toEqual([2, 2]);
    expect(off.safety).toMatchObject({ outcome: "unsafe", capped: false });
  });
  it("a safety-critical part not earned in full gets 0 for THAT part (active); a part the learner marked is their own", () => {
    const parts = structuredParts(STRUCT);
    const results: PartResult[] = [{ awarded: 1, by: "ai" }, { awarded: 2, by: "code" }];
    const c = capStructured(parts, results, { capsActive: true });
    expect(c.results.map(r => r.awarded)).toEqual([0, 2]);
    expect(c.safety).toMatchObject({ outcome: "critical_missed", missed: ["(a) How is concentrated potassium given?"] });
    expect(practiceMarks(parts, c.results)).toMatchObject({ awarded: 2, total: 4, correct: false });
    expect(capStructured(parts, [{ awarded: 0, by: "self" }, { awarded: 2, by: "code" }], { capsActive: true }).safety).toBeNull();
  });
  it("a plain structured question is marked exactly as before (no safety record)", () => {
    const plain = row({ kind: "structured", answer: { parts: [{ prompt: "(a) a?", marks: 1, accepted: ["x"] }, { prompt: "(b) b?", marks: 1, accepted: ["y"] }] } });
    expect(markResponse(plain, { kind: "parts", texts: ["x", "y"] })).toEqual({ correct: true, score: 1, marking: "deterministic" });
  });
});

describe("WS-B scenario: stages carry the markers, the token carries the unsafe statement", () => {
  const sc = row({ answer: { format: "scenario", accepted: ["infusion", "escalate"], stages: [
    { reveal: "", prompt: "How is the potassium given now?", kind: "mcq", options: ["As an IV bolus", "By diluted infusion", "Orally", "Withheld"], correct: [1], weight: 2, keyPoint: "Never as a bolus", unsafe: ["As an IV bolus"], safetyCritical: true },
    { reveal: "A new fever is found.", prompt: "What does the team do now?", kind: "short", accepted: ["escalate"], weight: 1, keyPoint: "Escalate sepsis" },
  ] } });
  const spec = scenarioSpecOf(sc.answer)!;
  it("choosing an unsafe option is a wrong answer at THAT stage and is recorded; the other stages keep their scores", () => {
    expect(markStageByCode(spec.stages[0], { kind: "choice", index: 0 })).toEqual({ score: 0, unsafe: "As an IV bolus" });
    expect(markStageByCode(spec.stages[0], { kind: "choice", index: 1 })).toEqual({ score: 1 });
    const u = capScenario(spec, [{ score: 0, by: "code", answer: "As an IV bolus", unsafe: "As an IV bolus" }, { score: 1, by: "code", answer: "escalate" }], { capsActive: true });
    expect(u.safety).toMatchObject({ outcome: "unsafe", capped: true });
    expect(u.results.map(r => r.score)).toEqual([0, 1]);
    // An AI-flagged unsafe stage keeps at most half its score; a safety-critical stage partly right gets 0 for that stage only.
    expect(capScenario(spec, [{ score: 1, by: "ai", answer: "x", unsafe: "x" }, { score: 1, by: "code", answer: "escalate" }], { capsActive: true }).results.map(r => r.score)).toEqual([0.5, 1]);
    const cm = capScenario(spec, [{ score: 0.5, by: "ai", answer: "Orally" }, { score: 1, by: "code", answer: "escalate" }], { capsActive: true });
    expect(cm.results.map(r => r.score)).toEqual([0, 1]);
    expect(cm.safety).toMatchObject({ outcome: "critical_missed", missed: ["Never as a bolus"] });
    expect(capScenario(spec, [{ score: 0.5, by: "ai", answer: "Orally" }, { score: 1, by: "code", answer: "escalate" }]).results.map(r => r.score)).toEqual([0.5, 1]);
  });
  it("the progress token keeps a stage's unsafe statement (and an old token without one still reads)", () => {
    const key = tokenKey("secret"), who = { userId: "u", questionId: sc.id, answer: sc.answer };
    const t = signProgress(key, who, { next: 1, results: [{ score: 0, by: "code", answer: "As an IV bolus", unsafe: "As an IV bolus" }], evaluator: null }, 1000);
    expect(readProgress(key, t, who, 2000)!.results[0].unsafe).toBe("As an IV bolus");
    const old = signProgress(key, who, { next: 1, results: [{ score: 1, by: "code", answer: "x" }], evaluator: null }, 1000);
    expect(readProgress(key, old, who, 2000)!.results[0].unsafe).toBeUndefined();
  });
});

describe("WS-B case criteria: weight and safetyCritical are scored", () => {
  const rubric = [{ criterion: "Recognises sepsis", weight: 2, safetyCritical: false }, { criterion: "Escalates now", weight: 3, safetyCritical: true }];
  it("the stored weights and flags become criteria; the recorded text carries the weighted marks and what was missed", () => {
    const C = caseCriteria(rubric)!;
    expect(C).toEqual([{ text: "Recognises sepsis", weight: 2, safetyCritical: false }, { text: "Escalates now", weight: 3, safetyCritical: true }]);
    const m = criteriaMarks(C, [0]);
    expect(m).toMatchObject({ outcome: "critical_missed", awarded: 2, total: 5 });
    expect(criteriaMarksLine(C, m, null)).toMatch(/2 of 5[\s\S]*Safety-critical point missed: Escalates now/);
    expect(recordedFeedbackText("Good start.", null, null, "wait and see")).toMatch(/Clinically unsafe answer: "wait and see"/);
  });
  it("case reasoning numbers the criteria and asks for MATCHED and UNSAFE; code weighs them", async () => {
    const ai = fakeRun(["VERDICT: partly\nMATCHED: 1\nUNSAFE: none\nRIGHT: recognises sepsis\nMISSING: escalation\nMISCONCEPTIONS: none\nWHY: Sepsis needs urgent escalation to the medical team.\nNEXT: none"]);
    const e = await runCaseReasoning("u", { prompt: "What now?", expected: "Escalate", facts: [], answer: "this is sepsis", passages: [passage], criteria: caseCriteria(rubric) }, ai.run) as any;
    expect(ai.systems[0]).toMatch(/CRITERIA are numbered/); expect(ai.systems[0]).toMatch(/UNSAFE/);
    expect(e.evaluation).toMatchObject({ ok: true, matched: [0] });
    expect(e.promptVersion).toBe(`${PROMPT_VERSIONS.caseReasoning}+scholar-evaluate-criteria-v1`);
  });
});

// ── WS-C ──

const JUSTIFY = row({ kind: "structured", answer: { variant: "answer_justify", parts: [
  { prompt: "(a) What should the nurse do first?", marks: 1, accepted: ["Escalate to the medical team"], options: ["Escalate to the medical team", "Recheck in four hours", "Give a bolus"], correct: 0, unsafe: ["Give a bolus"] },
  { prompt: "(b) Justify your choice.", marks: 3, accepted: ["sepsis needs urgent escalation"], role: "justify", criteria: [{ text: "Names sepsis", weight: 1 }, { text: "Says it is urgent", weight: 2, safetyCritical: true }] },
] } });
const INTERP = row({ kind: "structured", answer: { variant: "interpretation", findings: [{ label: "Temperature", value: "39.1", unit: "C" }, { label: "Heart rate", value: "128", unit: "/min" }], parts: [
  { prompt: "(a) What do these findings suggest?", marks: 2, accepted: ["sepsis"], role: "interpret", criteria: [{ text: "Fever", weight: 1 }, { text: "Tachycardia", weight: 1 }] },
  { prompt: "(b) What is the next step?", marks: 1, accepted: ["escalate"] },
] } });

describe("WS-C answer + justify, and interpretation of findings", () => {
  it("the learner sees the choice part's options and the roles, never which is right or the criteria", () => {
    const v = learnerItem(JUSTIFY);
    expect(v.parts![0]).toEqual({ prompt: "(a) What should the nurse do first?", marks: 1, options: ["Escalate to the medical team", "Recheck in four hours", "Give a bolus"] });
    expect(v.parts![1]).toEqual({ prompt: "(b) Justify your choice.", marks: 3, role: "justify" });
    expect(v.structured).toEqual({ variant: "answer_justify", findings: [] });
    const json = JSON.stringify(v);
    for (const leak of ["correct", "criteria", "Names sepsis", "unsafe", "sepsis needs urgent"]) expect(json).not.toContain(leak);
    expect(learnerItem(INTERP).structured!.findings).toHaveLength(2);
  });
  it("a choice part is marked by code either way; its answer must be one of its options", () => {
    const ps = structuredParts(JUSTIFY);
    expect(codeMarkParts(ps, ["Recheck in four hours", "because"])[0]).toEqual({ awarded: 0, by: "code" });
    expect(codeMarkParts(ps, ["Escalate to the medical team", ""])).toEqual([{ awarded: 1, by: "code" }, { awarded: 0, by: "blank" }]);
    expect(codeMarkParts(ps, ["Give a bolus", "x"])[0]).toMatchObject({ unsafe: "Give a bolus" });
    expect(parseResponse(JUSTIFY, { texts: ["Something else", "why"] })).toBeNull();
    expect(parseResponse(JUSTIFY, { texts: ["Escalate to the medical team", "why"] })).toEqual({ kind: "parts", texts: ["Escalate to the medical team", "why"] });
  });
  it("a justify part is marked against its weighted criteria by the same evaluator (MATCHED), five-part feedback kept", async () => {
    const ai = fakeRun(["VERDICT: partly\nMATCHED: 1\nUNSAFE: none\nRIGHT: names sepsis\nMISSING: urgency\nMISCONCEPTIONS: none\nWHY: Sepsis needs urgent escalation to the medical team.\nNEXT: escalation"]);
    const part = structuredParts(JUSTIFY)[1];
    const e = await runEvaluate("u", { question: part.prompt, accepted: part.accepted, answer: "it is sepsis", passage, numberedCriteria: part.contract.criteria! }, ai.run) as any;
    expect(ai.systems[0]).toMatch(/CRITERIA are numbered/);
    expect(e.evaluation).toMatchObject({ ok: true, matched: [0], parts: { right: ["names sepsis"], missing: ["urgency"] } });
    const cm = criteriaMarks(part.contract.criteria!, e.evaluation.matched);
    expect(cm).toMatchObject({ awarded: 1, total: 3, outcome: "critical_missed" });
  });
  it("the feedback shows the variant, the findings, each criterion met or not, and the roles; stored criteria read back", () => {
    const final: PartResult[] = [{ awarded: 1, by: "code" }, { awarded: 1, by: "ai", feedback: "f", matched: [0] }];
    const f = feedbackView(JUSTIFY, { correct: false, score: 0.5, marking: "ai_evaluation", structured: final, justMarked: true, safety: { outcome: "critical_missed", missed: ["(b) Justify your choice."], by: "ai" } });
    expect(f.structured!.variantLabel).toBe("Answer and justify");
    expect(f.structured!.parts[1]).toMatchObject({ role: "justify", roleLabel: "Your justification", criteria: [{ text: "Names sepsis", met: true }, { text: "Says it is urgent", met: false, safetyCritical: true }] });
    expect(f.structured!.parts[0].options).toHaveLength(3);
    expect(f.structured!.practiceMarks).toMatchObject({ awarded: 2, total: 4 });
    expect(f.safety).toMatchObject({ outcome: "critical_missed", label: "Safety-critical point missed" });
    expect(feedbackView(INTERP, { correct: true, score: 1, marking: "deterministic" }).structured!.findings).toHaveLength(2);
    const back = storedPartResults({ awarded: [1, 1], by: ["code", "ai"], criteria: [null, [0]] }, "ai_evaluation", 2)!;
    expect(back[1].matched).toEqual([0]);
  });
});

// ── WS-A ──

const CALC = row({ stem: "A dose of 500 mg is prescribed. The suspension contains 250 mg in 5 mL. What volume is given, in mL?",
  answer: { format: "calculation", accepted: ["10 mL"], value: 10, unit: "mL", working: "500 / 250 x 5 = 10" } });

describe("WS-A calculation: a short item with answer.format calculation, marked by code", () => {
  it("is its own format to a session and the registry; off by default; blind-solved; no library form yet", () => {
    expect(effectiveKind(CALC)).toBe("calculation");
    expect(REVISION_FORMATS).toContain("calculation");
    expect(REVISION_FORMATS_OFF_BY_DEFAULT).toContain("calculation");
    expect(resolvePolicy([]).scholarRevisionFormats).not.toContain("calculation");
    expect(BLIND_FORMATS).toContain("calculation");
    expect(FORMAT_ROW.calculation.library).toBeNull();
    expect(revisionPromptVersion("calculation")).toBe(PROMPT_VERSIONS.calculation);
  });
  it("the learner sees the unit select, never the value", () => {
    const v = learnerItem(CALC);
    expect(v.kind).toBe("calculation");
    expect(v.calculation!.units).toContain("mL"); expect(v.calculation!.units).toContain("L");
    expect(JSON.stringify(v)).not.toMatch(/"10|working|accepted/);
  });
  it("parses and marks a number and a unit; tolerance from the policy; a wrong unit is wrong with feedback", () => {
    const r = parseResponse(CALC, { value: "10", unit: "mL" })!;
    expect(r).toEqual({ kind: "calc", value: "10", unit: "mL" });
    expect(markResponse(CALC, r)).toMatchObject({ correct: true, score: 1, marking: "deterministic", calc: { reason: "correct" } });
    expect(markResponse(CALC, { kind: "calc", value: "0.01", unit: "L" })).toMatchObject({ correct: false, calc: { reason: "wrong_unit" } });
    // A validated equivalent unit counts; a question's tolerance only once tolerances are active (owner decision 4 Nov 2026).
    const eqL = row({ ...CALC, answer: { ...(CALC.answer as object), equivalentUnits: ["L"] } });
    expect(markResponse(eqL, { kind: "calc", value: "0.01", unit: "L" })).toMatchObject({ correct: true });
    const tol = row({ ...CALC, answer: { ...(CALC.answer as object), tolerance: { kind: "percent", amount: 5 } } });
    expect(markResponse(tol, { kind: "calc", value: "10.4", unit: "mL" })).toMatchObject({ correct: false, calc: { reason: "wrong_value", toleranceInactive: true } });
    expect(markResponse(tol, { kind: "calc", value: "10.4", unit: "mL" }, { calculation: { tolerancesActive: true } })).toMatchObject({ correct: true });
    expect(markResponse(tol, { kind: "calc", value: "10.6", unit: "mL" }, { calculation: { tolerancesActive: true } })).toMatchObject({ correct: false, calc: { reason: "wrong_value" } });
    // A tenfold slip is unsafe, independently of tolerance, and recorded as any unsafe answer is.
    expect(markResponse(tol, { kind: "calc", value: "100", unit: "mL" }, { calculation: { tolerancesActive: true } })).toMatchObject({ correct: false, score: 0, safety: { outcome: "unsafe", by: "code" } });
    expect(parseResponse(CALC, { text: "10 mL" })).toBeNull();
  });
  it("an unsound key is not offered", () => {
    expect(keyOf(row({ answer: { format: "calculation", accepted: ["x"], value: "ten", unit: "mL" } }))).toBeNull();
    expect(keyOf(CALC)).toEqual({ kind: "accepted", answers: ["10 mL"] });
  });
  it("a generated item copies every figure from the passage, uses a known unit, and never keeps a model-written tolerance", () => {
    const good = { stem: "A dose of 500 mg is prescribed and the suspension contains 250 mg in 5 mL. What volume should be given, in mL?", value: 10, unit: "mL", working: "500 divided by 250, times 5", tolerance: { kind: "percent", amount: 10 },
      rationale: "The prescribed dose is divided by the strength and multiplied by the volume.", sourceQuote: "Paracetamol oral suspension contains 250 mg in 5 mL.", difficulty: 2, level: "application", objective: "Calculate a volume from a strength.", keyPoints: ["Divide the dose by the strength"], misconceptions: [] };
    const c = checkRevisionDraft("calculation", good, passage);
    expect(c.ok).toBe(true);
    const a = (c as any).draft.answer;
    expect(a).toMatchObject({ format: "calculation", accepted: ["10 mL"], value: 10, unit: "mL" });
    expect(a.tolerance).toBeUndefined();
    expect(checkRevisionDraft("calculation", { ...good, stem: "A dose of 750 mg is prescribed and the suspension contains 250 mg in 5 mL. What volume, in mL?" }, passage)).toEqual({ ok: false, reason: "ungrounded_number" });
    expect(checkRevisionDraft("calculation", { ...good, unit: "spoonfuls" }, passage)).toEqual({ ok: false, reason: "malformed" });
  });
  it("the blind second solve must agree with the key (units converted, within 1%), and it always runs on a calculation", async () => {
    expect(calculationAgrees("10", "mL", 10, "mL")).toBe(true);
    expect(calculationAgrees(0.01, "L", 10, "mL")).toBe(true);
    expect(calculationAgrees("20", "mL", 10, "mL")).toBe(false);
    expect(calculationAgrees("10", "mg", 10, "mL")).toBe(false);
    const item = blindItemOf("calculation", { stem: "s?", options: [], answer: { value: 10, unit: "mL" }, rationale: "", sourceQuote: "", difficulty: 2 });
    expect(applyBlindVerification([item], '[{"q":1,"answerable":true,"stemAddsFacts":false,"ambiguous":false,"value":"20","unit":"mL"}]').rejected).toHaveLength(1);
    expect(applyBlindVerification([item], '[{"q":1,"answerable":true,"stemAddsFacts":false,"ambiguous":false,"value":10,"unit":"mL"}]').kept).toEqual([0]);
    const draft = JSON.stringify([{ stem: "A dose of 500 mg is prescribed and the suspension contains 250 mg in 5 mL. What volume should be given, in mL?", value: 10, unit: "mL", working: "divide and multiply",
      rationale: "The prescribed dose is divided by the strength and multiplied by the volume.", sourceQuote: "Paracetamol oral suspension contains 250 mg in 5 mL.", difficulty: 2, level: "application", objective: "Calculate a volume.", keyPoints: [], misconceptions: [] }]);
    const ai = fakeRun([draft, '[{"q":1,"answerable":true,"stemAddsFacts":false,"ambiguous":false,"value":10,"unit":"mL"}]']);
    const out = await runRevisionQuestions("u", "calculation", passage, 2, ai.run, { verifyFormats: [] }) as any;
    expect(ai.systems).toHaveLength(2);            // written, then blind-solved although the verify policy names no format
    expect(out.kept).toHaveLength(1);
    expect(out.promptVersion).toBe(`${PROMPT_VERSIONS.calculation}+${PROMPT_VERSIONS.verifyBlind}`);
  });
  it("the attempt keeps the key it was marked against; shown later it is re-derived from what was kept", () => {
    const snap = rubricSnapshotOf(CALC)!;
    expect(snap.calc).toEqual({ value: 10, unit: "mL" });
    expect(snapshotOf({ rubric: snap })!.calc).toEqual({ value: 10, unit: "mL" });
    const cm = markCalculation(calculationSpecOf(CALC.answer)!, { value: "0.01", unit: "L" });
    const response = { kind: "calc", value: "0.01", unit: "L", rules: SCORING_RULES_VERSION, calc: storedCalculation(cm), rubric: snap };
    // The question is edited later (a new value): the attempt is still read against 10 mL.
    const edited = row({ ...CALC, answer: { ...(CALC.answer as object), value: 12, accepted: ["12 mL"] } });
    expect((applySnapshot(edited, snap).answer as any).value).toBe(10);
    const kept = keptAttemptView(edited, { response, marking: "deterministic" }) as any;
    expect(kept.calc).toMatchObject({ reason: "wrong_unit", expected: { value: 10, unit: "mL" } });
    const f = feedbackView(edited, { correct: false, score: 0, marking: "deterministic", ...kept });
    expect(f.calculation).toMatchObject({ reason: "wrong_unit", tolerance: "exact answer", given: { value: 0.01, unit: "L" } });
  });
  it("the tolerance gate defaults OFF (until the clinical calculation policy is approved) and clamps nonsense", () => {
    expect(resolvePolicy([]).scholarCalculationTolerances).toBe("off");
    expect((policyDef("scholar_calculation_tolerances") as any).fallback).toBe("off");
    const set = (key: string, value: unknown) => resolvePolicy([{ config_path: policyPath(key as never), published: { value } }]);
    expect(set("scholar_calculation_tolerances", "on").scholarCalculationTolerances).toBe("on");
    expect(set("scholar_calculation_tolerances", "yes").scholarCalculationTolerances).toBe("off");
  });
});

// ── OLD ATTEMPTS STAY INTERPRETABLE ──

describe("an attempt marked before the v2 rules renders exactly as before", () => {
  it("a legacy structured attempt (no rules, no safety) shows no safety block and its marks from what it kept", () => {
    // A question that LATER gained safety markers: the old attempt is not re-judged by them.
    const legacy = { texts: ["by infusion", "urgent escalation"], kind: "parts", awarded: [2, 1], by: ["code", "ai"] };
    const kept = keptAttemptView(STRUCT, { response: legacy, marking: "ai_evaluation" }) as any;
    expect(kept.safety).toBeUndefined();
    const f = feedbackView(STRUCT, { correct: false, score: 0.75, marking: "ai_evaluation", ...kept });
    expect(f.safety).toBeUndefined();
    expect(f.structured!.practiceMarks).toMatchObject({ awarded: 3, total: 4 });
  });
  it("a legacy short attempt with an old snapshot renders without safety or calculation", () => {
    const q = row({ answer: { accepted: ["by infusion"], rubric: { level: "recall", keyPoints: ["Infuse it"] } } });
    const snap = rubricSnapshotOf(q)!;
    const kept = keptAttemptView(q, { response: { kind: "text", text: "drip", rubric: snap }, marking: "self_graded" }) as any;
    const f = feedbackView(q, { correct: true, score: 1, marking: "self_graded", ...kept });
    expect(f.safety).toBeUndefined(); expect(f.calculation).toBeUndefined();
    expect(f.answer).toBe("by infusion");
  });
  it("a v2 attempt (whole-attempt cap, never released) renders exactly as stored: its score, its capped marks, its flag", () => {
    // v2 kept the parts' own marks and a whole-attempt score of 0 (unsafe = 0 then).
    const v2 = { texts: ["push it fast", "urgent escalation"], kind: "parts", awarded: [2, 2], by: ["ai", "code"], rules: "sqie-scoring-v2", safety: { outcome: "unsafe", statement: "push it fast", by: "ai" } };
    const kept = keptAttemptView(STRUCT, { response: v2, marking: "ai_evaluation" }) as any;
    const f = feedbackView(STRUCT, { correct: false, score: 0, marking: "ai_evaluation", ...kept });
    expect(f.score).toBe(0);
    expect(f.structured!.practiceMarks).toMatchObject({ awarded: 0, total: 4 });
    expect(f.safety).toMatchObject({ outcome: "unsafe", label: "Clinically unsafe answer" });
  });
  it("the clinical scoring caps key defaults OFF (until clinical approval) and clamps nonsense", () => {
    expect(resolvePolicy([]).scholarClinicalScoringCaps).toBe("off");
    const set = (value: unknown) => resolvePolicy([{ config_path: policyPath("scholar_clinical_scoring_caps" as never), published: { value } }]);
    expect(set("on").scholarClinicalScoringCaps).toBe("on");
    expect(set("maybe").scholarClinicalScoringCaps).toBe("off");
  });
  it("a v2 attempt that kept a safety record shows it again", () => {
    const kept = keptAttemptView(SHORT_UNSAFE, { response: { kind: "text", text: "IV bolus", rules: SCORING_RULES_VERSION, safety: { outcome: "unsafe", statement: "IV bolus", by: "code" } }, marking: "deterministic" }) as any;
    const f = feedbackView(SHORT_UNSAFE, { correct: false, score: 0, marking: "deterministic", ...kept });
    expect(f.safety).toMatchObject({ outcome: "unsafe", statement: "IV bolus", label: "Clinically unsafe answer" });
  });
});

describe("WS-C case reason context (library.ts, pure): only an asked-for reason, on a decision with a rubric", () => {
  const b: any = {
    facts: [{ id: "f1", kind: "observation", label: "Temperature", value: "39.1", revealedAt: "start", safetyCritical: false }],
    stages: [{ id: "s1", title: "S", reveals: [], decisionPointIds: ["d1", "d2"] }], learningObjectives: [], metadata: { cfcaDomainIds: [], cpuIds: [] },
    decisionPoints: [
      { id: "d1", stageId: "s1", prompt: "First?", kind: "single", askReason: true, rationale: "Sepsis needs urgent escalation.", permittedReveals: [],
        options: [{ id: "a", text: "Escalate", correct: true }, { id: "b", text: "Wait", correct: false }], rubric: [{ id: "r1", criterion: "Names sepsis", weight: 2, safetyCritical: true }] },
      { id: "d2", stageId: "s1", prompt: "Second?", kind: "single", askReason: true, permittedReveals: [], options: [{ id: "a", text: "A", correct: true }] },
    ],
  };
  const s = { reached_stage_ids: ["s1"], revealed_fact_ids: [], feedback: [] as any[], answers: [{ decisionPointId: "d1", chosen: ["b"], reason: "it can wait", at: "t", safety: 0 }, { decisionPointId: "d2", chosen: ["a"], reason: "x", at: "t", safety: 0 }] };
  it("gives the prompt, the option chosen, the reason, the weighted criteria and the seen facts -- never the key", () => {
    const c = reasonContextFrom(b, s, "d1") as any;
    expect(c).toMatchObject({ prompt: "First?", chosen: ["Wait"], answer: "it can wait", rubric: [{ criterion: "Names sepsis", weight: 2, safetyCritical: true }] });
    expect(JSON.stringify(c)).not.toMatch(/"correct"|Escalate/);
    expect(reasonContextFrom(b, s, "d2")).toEqual({ error: "no_rubric" });
    expect(reasonContextFrom(b, { ...s, answers: [{ ...s.answers[0], reason: "" }] }, "d1")).toEqual({ error: "no_reason" });
    expect(reasonContextFrom(b, { ...s, feedback: [{ decisionPointId: "d1" } as any] }, "d1")).toEqual({ error: "already_has_feedback" });
  });
});
