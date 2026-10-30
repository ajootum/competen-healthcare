/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * COMPETEN SCHOLAR EDUCATIONAL AI GOVERNANCE ALIGNMENT (owner instruction SCHOLAR-EDU-AI-01, 30 Oct 2026, sections 1
 * and 8) -- the Scholar rule CONTENT, as data. No side effects: apply-scholar-edu-drafts.ts writes it as a DRAFT of the
 * scholar fair-use policy only, a governed publisher publishes it on the HQ page, and scholar-edu-policy.test.ts proves
 * how real questions classify.
 *
 * Scholar is education. Studying medicines, emergencies and resuscitation, paediatric deterioration or a high-risk
 * competency, or asking a study question in ordinary words, is clinical EDUCATIONAL: it still needs a model approved
 * for clinical educational content, with its grounding and accuracy checks, but it is no longer refused as if it were
 * patient care. What stays HIGH RISK in every
 * mode: a real patient now, giving a medicine to someone, what to do now in a clinical situation, personal safety, and
 * (new) identifiable patient information. Professional is unchanged.
 */

/** The topic rules that described a SUBJECT, not a use. In Scholar they become clinical educational, ids kept. */
export const STUDY_TOPIC_RULES: Record<string, string> = {
  "high.medication": "Medicines and pharmacology (study)",
  "high.emergency": "Emergencies and resuscitation (study)",
  "high.paediatric-deterioration": "Paediatric deterioration (study)",
  "high.competency": "A high-risk competency or practice unit (study)",
};

/** Identifiable patient information is never study material: high risk in every mode. */
export const IDENTIFIABLE_RULE = {
  id: "high.identifiable", label: "Identifiable patient information", tier: "high_risk_clinical", competencyRisk: [], frameworks: [],
  all: [["nhs number", "hospital number", "patient number", "medical record number", "mrn", "date of birth", "dob", "patient id", "inpatient number", "ip number", "chi number"]],
};

/**
 * A study request in Scholar's own words is clinical EDUCATIONAL (section 1: educational by default), so a question
 * such as "explain how furosemide works" no longer falls to "unrecognised" (treated as high risk). It still needs a
 * model approved for clinical educational content. Text no rule recognises at all stays high risk (fail closed).
 */
export const STUDY_REQUEST_RULE = {
  id: "clinical.study-request", label: "A study request (Scholar)", tier: "clinical_educational", competencyRisk: [], frameworks: [],
  all: [["explain*", "describe*", "define*", "definition*", "what is", "what are", "what does", "how does", "how do", "how is", "how are", "why does", "why do",
    "why is", "compare*", "contrast*", "list", "outline*", "discuss*", "summar*", "mechanism*", "side effect*", "adverse effect*", "indication*",
    "contraindication*", "monitor*", "sign*", "cause*", "complication*", "management", "principle*", "question*", "answer*", "my notes", "lecture*",
    "revis*", "quiz*", "practice", "study", "learn*", "understand*", "case study", "scenario*", "exam*", "course"]],
};

/** The rules that must stay high risk in Scholar (checked, not assumed, by the test and by the emitter). */
export const SCHOLAR_HIGH_KEPT = ["high.real-patient", "high.administration-now", "high.urgent-direction", "high.personal-safety", "high.identifiable"];

/** Pure: the published Scholar risk section with the topic rules made educational and the two rules added. */
export function withScholarEducational(risk: any): any {
  const rules: any[] = Array.isArray(risk?.rules) ? risk.rules : [];
  const next = rules.map(r => (r && STUDY_TOPIC_RULES[r.id] ? { ...r, tier: "clinical_educational", label: STUDY_TOPIC_RULES[r.id] } : r));
  for (const add of [STUDY_REQUEST_RULE, IDENTIFIABLE_RULE]) if (!next.some(r => r?.id === add.id)) next.push(structuredClone(add));
  const missing = SCHOLAR_HIGH_KEPT.filter(id => !next.some(r => r?.id === id && r.tier === "high_risk_clinical"));
  if (missing.length) throw new Error(`Refusing: the Scholar policy lacks the high-risk rules ${missing.join(", ")}. Apply the 29 Oct production rules first.`);
  return { ...risk, rules: next };
}
