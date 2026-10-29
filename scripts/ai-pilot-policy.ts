/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * COMPETEN SCHOLAR PERSONAL AI EDUCATIONAL GUIDANCE (owner GO A) and COMPETEN AI SUPERVISED PILOT MODE (owner GO 2),
 * 29 Oct 2026 -- the rule CONTENT, as data. No side effects: apply-ai-pilot-drafts.ts writes it as DRAFTS, a governed
 * publisher publishes it on the HQ page, and src/lib/ai/operating-mode.test.ts proves how real questions classify.
 *
 * ⚠ CLINICAL RULES KEEP PRECEDENCE. The engine takes the HIGHEST tier any rule gives, so a rule added here can recognise
 * an educational request but never lower what a clinical or high-risk rule found.
 */

/** GO A (production, every mode): planning, goals, profile and development requests are recognised as standard
 *  educational instead of falling to "unrecognised", which is treated as high-risk clinical. Appended to the existing
 *  standard.study-and-career rule of the published scholar and professional policies. */
export const STUDY_AND_CAREER_ADDITIONS = [
  "target*", "goal*", "aim*", "achieve*", "aspiration*", "profile", "learning plan*", "development plan*", "personal development",
  "competency development", "develop my", "learning objective*", "study goal*", "study timetable", "timetable", "study schedule",
  "academic", "grade*", "dissertation", "thesis", "presentation skill*", "cpd", "continuing professional development", "mentor*",
  "mentorship", "promotion", "job application*", "personal statement", "next steps", "progress",
];

const rule = (id: string, label: string, tier: string, all: string[][]) => ({ id, label, tier, all, competencyRisk: [], frameworks: [] });

/**
 * GO A and GO 2 (production, every mode): patient-specific requests, giving a medicine or acting now, and personal
 * safety are HIGH RISK and never clarifiable. Today a question such as "my patient in bed 4 is septic, what should I do
 * now" reaches only clinical.topics (clinical educational) and would be answered: these rules only tighten.
 */
export const PRODUCTION_ADDED_RULES = [
  rule("high.real-patient", "A real patient, now", "high_risk_clinical", [[
    "my patient*", "this patient", "our patient*", "a patient i am", "a patient i'm", "patient in bed", "in bed ", "on my ward", "on the ward now",
    "currently caring", "at the bedside", "my client", "my resident",
  ]]),
  rule("high.administration-now", "Giving a medicine to someone", "high_risk_clinical", [[
    "should i give", "can i give", "how much should i give", "should i administer", "can i administer", "what dose should", "how much to give",
  ]]),
  rule("high.urgent-direction", "What to do now, in a clinical situation", "high_risk_clinical", [
    ["right now", "urgent*", "immediately", "what should i do now", "what do i do now"],
    ["patient*", "bed", "ward", "bleed*", "breath*", "unconscious", "collaps*", "chest pain", "not breathing", "seizure*", "fitting"],
  ]),
  rule("high.personal-safety", "Personal safety", "high_risk_clinical", [[
    "suicid*", "self-harm", "self harm", "kill myself", "hurt myself", "end my life",
  ]]),
];

/** GO 2: the Supervised Pilot overlay for Scholar, for NAMED cohorts only. */
export const PILOT_RULES = [
  // Educational explanations of the body and disease, hypothetical and simulated cases, procedural education: clinical
  // educational, so they run on a model eligible for clinical educational content, never on the cheap standard model.
  rule("clinical.pilot-body-and-disease", "Body systems and disease, explained for study", "clinical_educational", [[
    "kidney*", "renal", "liver", "hepat*", "neuro*", "brain", "nerve*", "muscle*", "bone*", "skeletal", "skin", "immun*", "endocrin*",
    "hormone*", "thyroid", "gastro*", "digest*", "bowel", "bladder", "urinary", "reproduct*", "pregnan*", "blood cell*", "haemoglobin",
    "hemoglobin", "cell*", "tissue*", "organ*", "disease*", "disorder*", "condition*", "mechanism*", "pathophysiolog*", "aetiolog*", "etiolog*",
  ]]),
  rule("clinical.pilot-cases-and-procedures", "Hypothetical cases, simulation and procedural education", "clinical_educational", [[
    "hypothetical", "case study", "case studies", "case scenario*", "scenario*", "simulated", "simulation", "osce", "practice case*",
    "procedure*", "nursing skill*", "clinical skill*", "clinical reasoning", "differential*", "care planning", "nursing process",
  ]]),
];

/** Topic rules a study question may name without being about a real patient. "unknown" is the unrecognised subject. */
export const CLARIFIABLE_RULES = ["high.medication", "high.paediatric-deterioration", "high.emergency", "unknown"];

/** The Scholar mode document: Strict Production by default, Supervised Pilot only for the cohorts listed. The owner adds
 *  the authorised test cohort's people on the HQ page before publishing. */
export const PILOT_MODE_DOC = {
  defaultMode: "strict_production",
  cohorts: [] as { code: string; label: string; mode: string; userIds: string[]; entitlementSources: string[]; planCodes: string[]; hourlyLimit: number | null }[],
  pilotRisk: { rules: PILOT_RULES },
  clarifiableRules: CLARIFIABLE_RULES,
};

/** Pure: a published risk section with the GO A additions: the planning terms on standard.study-and-career and the
 *  production rules added (each only once). Every existing rule is kept exactly. */
export function withProductionAdditions(risk: any): any {
  const rules: any[] = Array.isArray(risk?.rules) ? risk.rules.map((r: any) => ({ ...r })) : [];
  const study = rules.find(r => r.id === "standard.study-and-career");
  if (study) {
    const terms: string[] = Array.isArray(study.all?.[0]) ? study.all[0] : [];
    study.all = [[...terms, ...STUDY_AND_CAREER_ADDITIONS.filter(t => !terms.includes(t))], ...(study.all ?? []).slice(1)];
  } else rules.push(rule("standard.study-and-career", "Study skills, planning and career", "standard_educational", [STUDY_AND_CAREER_ADDITIONS]));
  for (const r of PRODUCTION_ADDED_RULES) if (!rules.some(x => x.id === r.id)) rules.push(r);
  return { ...risk, rules };
}
