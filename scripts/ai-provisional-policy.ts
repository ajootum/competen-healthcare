/**
 * AI-FAIR-USE-01 and IND-007 owner decisions D1, D3, D5 -- the PROVISIONAL pilot policy, as data. No side effects:
 * the staging seed (seed-staging-ai-fair-use.ts) publishes it, and the static harness (ai-fair-use-harness.ts)
 * proves the engine classifies with it the way the owner decided.
 *
 * ⚠ PROVISIONAL, FOR THE OWNER TO CONFIRM ON THE HQ PAGE. The activity tiers, the risk rules and the per-tier model
 * floors are a starting classification for the internal pilot. They are policy, edited at /super-admin/ai/fair-use,
 * never code. Owner D1: unknown or uncertain subjects are high-risk clinical, and the subject decides, not the
 * activity name.
 */

type Tier = "cheap" | "reasoning" | "heavy";
type Risk = "standard_educational" | "clinical_educational" | "high_risk_clinical";
type Activity = { label: string; class?: "essential"; tier: Tier; minTier: Tier; maxOutputTokens: number; riskFloor: Risk; reserveEligible?: boolean };
const a = (label: string, tier: Tier, minTier: Tier, maxOutputTokens: number, riskFloor: Risk, essential = false): Activity =>
  ({ label, tier, minTier, maxOutputTokens, riskFloor, ...(essential ? { class: "essential" as const, reserveEligible: true } : {}) });

/** Owner D5 for Scholar, and Professional separately with the same values. */
export const PROVISIONAL_ALLOWANCE = {
  includedCau: 4000, reserveCau: 500, windowMinutes: 300, windowCapCau: 1000, maxUnreconciledCau: 400, fxBufferPct: 10,
  levels: { optimisedBelowPct: 30, essentialBelowPct: 10 },
};

export const PROVISIONAL_ACTIVITIES: Record<"scholar" | "professional", Record<string, Activity>> = {
  scholar: {
    teach: a("Teach me", "reasoning", "cheap", 1500, "standard_educational"),
    explain: a("Explanations", "reasoning", "cheap", 1500, "standard_educational"),
    simplify: a("Simpler explanations", "cheap", "cheap", 800, "standard_educational"),
    deeper: a("Going deeper", "reasoning", "reasoning", 1800, "standard_educational"),
    examples: a("Worked examples", "reasoning", "cheap", 1200, "standard_educational"),
    summary: a("Summaries", "cheap", "cheap", 900, "standard_educational"),
    ask: a("Ask Scholar", "reasoning", "cheap", 900, "standard_educational"),
    check: a("Checking your answers", "reasoning", "reasoning", 1000, "clinical_educational"),
    clarify: a("Clarify an existing explanation", "cheap", "cheap", 600, "standard_educational", true),
    tutor_continue: a("Finish an interrupted tutoring session", "reasoning", "cheap", 900, "standard_educational", true),
    map: a("Competency mapping", "reasoning", "cheap", 2000, "standard_educational"),
    questions: a("Practice questions", "reasoning", "reasoning", 2000, "clinical_educational"),
    case_steps: a("Clinical cases", "reasoning", "reasoning", 2500, "high_risk_clinical"),
    // COMPETEN-SCHOLAR-REVISION-01 (Stage 4): AI marking of short answers. Its output is an AI evaluation, labelled as
    // such -- not deterministic marking, never competence. Never below clinical educational, never on the cheapest tier.
    evaluate: a("AI evaluation of short answers", "reasoning", "reasoning", 800, "clinical_educational"),
  },
  professional: {
    assistant: a("Professional development assistance", "reasoning", "cheap", 900, "standard_educational"),
    map: a("Competency suggestions", "reasoning", "cheap", 2000, "standard_educational"),
  },
};

/** Owner D1. The highest matching tier wins; a subject no rule recognises is high-risk clinical. */
export const PROVISIONAL_RISK = {
  // The cheapest model each tier may ever run on. Which models may serve a tier at all is the evaluation decision
  // recorded in ai_model_eligibility (owner D5), never this floor.
  minTier: { standard_educational: "cheap", clinical_educational: "reasoning", high_risk_clinical: "reasoning" },
  rules: [
    { id: "high.medication", label: "Medicines, dosing and administration", tier: "high_risk_clinical",
      all: [["medication*", "medicine*", "drug*", "dose", "doses", "dosing", "dosage*", "prescri*", "insulin", "anticoagula*", "warfarin", "heparin", "opioid*",
        "morphine", "infusion*", "iv fluid*", "titrat*", "mg", "mcg", "milligram*", "microgram*", "controlled drug*", "high-alert"]] },
    { id: "high.paediatric-deterioration", label: "Paediatric deterioration", tier: "high_risk_clinical",
      all: [["paediatric*", "pediatric*", "child*", "infant*", "neonat*", "newborn*", "baby", "babies"],
        ["deteriorat*", "sepsis", "septic", "pews", "respiratory distress", "seizure*", "unresponsive", "shock", "dehydrat*", "fever*", "febrile"]] },
    { id: "high.emergency", label: "Emergencies and resuscitation", tier: "high_risk_clinical",
      all: [["emergenc*", "resuscitat*", "cardiac arrest", "cpr", "anaphyla*", "overdose*", "suicid*", "self-harm", "choking", "haemorrhag*", "hemorrhag*",
        "stroke", "major trauma", "airway obstruction", "sepsis", "septic shock"]] },
    { id: "high.competency", label: "A high-risk competency or practice unit", tier: "high_risk_clinical", competencyRisk: ["high"] },
    { id: "clinical.topics", label: "Clinical education", tier: "clinical_educational",
      all: [["patient*", "clinical", "nurs*", "assessment", "vital sign*", "observation*", "oxygen", "respirat*", "breath*", "airway", "cardio*", "heart",
        "blood pressure", "pulse", "wound*", "infection*", "hand hygiene", "ppe", "pain", "nutrition", "hydration", "mobility", "pressure ulcer*", "pressure injur*",
        "falls", "diabetes", "asthma", "copd", "pneumonia", "anatomy", "physiolog*", "patholog*", "pharmacolog*", "handover", "sbar", "escalat*", "consent",
        "safeguard*", "early warning", "news2", "spo2", "saturation*", "symptom*", "diagnos*", "treatment*", "care plan*"]] },
    { id: "clinical.frameworks", label: "Competencies of the clinical catalogues", tier: "clinical_educational",
      frameworks: ["CF-FOUND", "NUR-RESP", "SCH-RESPCARD"], competencyRisk: ["standard"] },
    { id: "standard.study-and-career", label: "Study skills, planning and career", tier: "standard_educational",
      all: [["revision", "revise", "study plan*", "study skill*", "exam technique*", "exams", "referencing", "citation*", "essay*", "assignment structure",
        "time management", "note-taking", "note taking", "flashcard*", "reflective writing", "portfolio", "cv", "career*", "interview*", "cpd plan*",
        "professional development", "motivation"]] },
  ],
};

/** Owner D3: one personal AI, configured per product. */
export const PROVISIONAL_ASSISTANT = {
  scholar: { defaultMode: "teach", modes: ["teach", "ask"], scopes: ["passport", "study_context"] },
  professional: { defaultMode: "development", modes: ["development", "cpd_plan", "reflection"], scopes: ["passport", "professional_record"] },
};
