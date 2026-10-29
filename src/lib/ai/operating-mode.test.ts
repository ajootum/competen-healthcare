/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { classifyRisk, resolveRiskPolicy, type ResolvedRiskSubject } from "./clinical-risk";
import { decideRisk, modeFor, pilotHourlyLimit, resolveModeDoc, rulesFor, STRICT_DOC, MODE_BEHAVIOUR } from "./operating-mode";
import { CLARIFIABLE_RULES, PILOT_MODE_DOC, PRODUCTION_ADDED_RULES, STUDY_AND_CAREER_ADDITIONS } from "../../../scripts/ai-pilot-policy";

// Owner GO A (educational guidance) and GO 2 (Supervised Pilot), 29 Oct 2026: how real learner questions classify.
// The production rules are the published Scholar rules as read from production on 29 Oct (the provisional seed).
const PRODUCTION_RULES = [
  { id: "high.medication", tier: "high_risk_clinical", all: [["medication*", "medicine*", "drug*", "dose", "doses", "dosing", "dosage*", "prescri*", "insulin", "anticoagula*", "warfarin", "heparin", "opioid*", "morphine", "infusion*", "iv fluid*", "titrat*", "mg", "mcg", "milligram*", "microgram*", "controlled drug*", "high-alert"]] },
  { id: "high.paediatric-deterioration", tier: "high_risk_clinical", all: [["paediatric*", "pediatric*", "child*", "infant*", "neonat*", "newborn*", "baby", "babies"], ["deteriorat*", "sepsis", "septic", "pews", "respiratory distress", "seizure*", "unresponsive", "shock", "dehydrat*", "fever*", "febrile"]] },
  { id: "high.emergency", tier: "high_risk_clinical", all: [["emergenc*", "resuscitat*", "cardiac arrest", "cpr", "anaphyla*", "overdose*", "suicid*", "self-harm", "choking", "haemorrhag*", "hemorrhag*", "stroke", "major trauma", "airway obstruction", "sepsis", "septic shock"]] },
  { id: "clinical.topics", tier: "clinical_educational", all: [["patient*", "clinical", "nurs*", "assessment", "vital sign*", "anatomy", "physiolog*", "patholog*", "pharmacolog*", "respirat*", "breath*", "heart", "cardio*", "diabetes", "symptom*", "diagnos*", "treatment*", "care plan*"]] },
  { id: "standard.study-and-career", tier: "standard_educational", all: [["revision", "revise", "study plan*", "study skill*", "exams", "essay*", "time management", "portfolio", "cv", "career*", "interview*", "cpd plan*", "professional development", "motivation", ...STUDY_AND_CAREER_ADDITIONS]] },
];
const production = resolveRiskPolicy({ rules: [...PRODUCTION_RULES, ...PRODUCTION_ADDED_RULES] });
const S = (text: string): ResolvedRiskSubject => ({ text, competencyRisks: [], frameworkCodes: [] });
const ME = "00000000-0000-4000-8000-000000000001";
const doc = resolveModeDoc({ ...PILOT_MODE_DOC, cohorts: [{ code: "cchu-pilot-1", label: "CCHU pilot", mode: "supervised_pilot", userIds: [ME], hourlyLimit: 60 }] });
const pilot = modeFor(doc, { userId: ME, entitlementSources: [], planCodes: [] });
const strict = modeFor(doc, { userId: "00000000-0000-4000-8000-000000000002", entitlementSources: [], planCodes: [] });
const tierIn = (m: any, q: string, purpose: "education" | null = null) => { const v = decideRisk(production, S(q), "standard_educational", m, purpose); return v.kind === "clarify" ? "clarify" : v.risk.tier; };

describe("GO A: planning and development questions are recognised (production, every mode)", () => {
  it("the screenshot question is standard educational now, not 'unrecognised'", () => {
    expect(classifyRisk(production, S("From the profile I have completed, can you guide me on what to do to achieve my targets"), "standard_educational").tier).toBe("standard_educational");
  });
  it("clinical rules keep precedence over a planning word", () => {
    expect(classifyRisk(production, S("What are my goals for insulin dosing on the ward"), "standard_educational").tier).toBe("high_risk_clinical");
    expect(classifyRisk(production, S("Set me a target to learn nursing assessment"), "standard_educational").tier).toBe("clinical_educational");
  });
});

describe("GO 2: Supervised Pilot, for the named cohort only", () => {
  it("is never the default, and a person outside the cohort stays in Strict Production", () => {
    expect(resolveModeDoc({ defaultMode: "supervised_pilot" }).defaultMode).toBe("strict_production");
    expect(strict.mode).toBe("strict_production");
    expect(pilot.mode).toBe("supervised_pilot");
    expect(modeFor(STRICT_DOC, { userId: ME, entitlementSources: [], planCodes: [] }).mode).toBe("strict_production");
  });
  it("Strict Production is exactly the production rules: an unrecognised or medicines study question is refused", () => {
    expect(tierIn(strict, "Explain how the kidneys filter blood")).toBe("high_risk_clinical");
    expect(tierIn(strict, "Explain how insulin works in the body")).toBe("high_risk_clinical");
    expect(rulesFor(production, strict)).toBe(production);
  });
  it("in the pilot, body-system explanations are clinical educational (an eligible clinical model, not the cheap one)", () => {
    expect(tierIn(pilot, "Explain how the kidneys filter blood")).toBe("clinical_educational");
    expect(tierIn(pilot, "Walk me through a hypothetical case scenario of heart failure")).toBe("clinical_educational");
  });
  it("a medicines or sepsis study question is clarified, then runs at clinical educational once confirmed as study", () => {
    expect(tierIn(pilot, "Explain how insulin works in the body")).toBe("clarify");
    expect(tierIn(pilot, "Explain how insulin works in the body", "education")).toBe("clinical_educational");
    expect(decideRisk(production, S("Explain the stages of sepsis"), "standard_educational", pilot, "education")).toMatchObject({ kind: "classified", risk: { rule: "education_confirmed:high.emergency" } });
  });
  it("a real patient, giving a medicine now, or personal safety is refused in every mode, even 'for study'", () => {
    for (const q of ["How much insulin should I give my patient", "My patient in bed 4 is septic, what should I do now", "Should I give morphine right now", "I want to hurt myself"]) {
      expect(tierIn(pilot, q, "education")).toBe("high_risk_clinical");
      expect(tierIn(strict, q, "education")).toBe("high_risk_clinical");
    }
  });
  it("study urgency is not clinical urgency", () => {
    expect(tierIn(strict, "How do I revise immediately for my exam tomorrow")).toBe("standard_educational");
    expect(tierIn(strict, "The patient is not breathing, what should I do now", "education")).toBe("high_risk_clinical");
  });
  it("an unrecognised question is clarified in the pilot and refused outside it, and never becomes standard", () => {
    expect(tierIn(pilot, "Tell me about xylophones")).toBe("clarify");
    expect(tierIn(pilot, "Tell me about xylophones", "education")).toBe("clinical_educational");
    expect(tierIn(strict, "Tell me about xylophones", "education")).toBe("high_risk_clinical");
  });
  it("an activity whose own floor is high risk is never clarified down", () => {
    expect(decideRisk(production, S("Explain insulin"), "high_risk_clinical", pilot, "education")).toMatchObject({ kind: "classified", risk: { tier: "high_risk_clinical" } });
  });
  it("the clarifiable list holds only topic rules and 'unknown', never a patient-specific rule", () => {
    expect(CLARIFIABLE_RULES.every(r => r === "unknown" || ["high.medication", "high.paediatric-deterioration", "high.emergency"].includes(r))).toBe(true);
    expect(PRODUCTION_ADDED_RULES.every(r => r.tier === "high_risk_clinical" && !CLARIFIABLE_RULES.includes(r.id))).toBe(true);
  });
  it("behaviour by mode, and the pilot hourly limit only ever raises the plan's", () => {
    expect(MODE_BEHAVIOUR.strict_production).toEqual({ pilotRules: false, clarify: false, educationalBoundary: false, logAll: false });
    expect(MODE_BEHAVIOUR.clinical_production.pilotRules).toBe(false);
    expect(pilotHourlyLimit(pilot, 20)).toBe(60);
    expect(pilotHourlyLimit(pilot, 100)).toBe(100);
    expect(pilotHourlyLimit(strict, 20)).toBe(20);
  });
  it("drops malformed cohorts and limits", () => {
    const d = resolveModeDoc({ cohorts: [{ code: "x", mode: "supervised_pilot", userIds: [] }, { code: "ok-1", mode: "supervised_pilot", userIds: [ME], hourlyLimit: 9999 }, { code: "ok-1", mode: "strict_production", userIds: [ME] }] });
    expect(d.cohorts.map(c => [c.code, c.hourlyLimit])).toEqual([["ok-1", null]]);
  });
});
