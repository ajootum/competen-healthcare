/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR-RISK-01 (owner GO "education-first, risk-sensitive classification", 31 Oct 2026) -- the Scholar risk section
 * CONTENT, as data. No side effects: apply-scholar-risk01.ts writes it (staging draft + publish, or a JSON file for the
 * owner to publish on the HQ page), and scholar-risk01.test.ts measures it against the validation set.
 *
 * Starting point: the Scholar risk section as published on 31 Oct (SCHOLAR-EDU-AI-01 applied). What changes:
 *   - clinical.topics       widened to conditions and body systems the learner names (renal, nephr*, syndrome*, disease*...)
 *   - clinical.study-request widened to the study verbs it lacked (differentiate, distinguish, classify, calculate ...)
 *   - high.real-patient     "in bed " / "patient in bed" (positioning a patient in bed is a study topic) replaced by bed
 *                           and bay NUMBERS; first-person care phrases added. Still high risk, still request-scoped.
 *   - high.urgent-direction the adjectives "urgent*" and "immediately" (the "immediate management of anaphylaxis") are
 *                           replaced by present-time phrases; an urgent first-person "what do I do" is caught by the
 *                           intent layer (request-intent.ts). Still high risk, still request-scoped.
 *   - every high-risk rule names its refusal words (refusal).
 *   - unknownHandling "educational_if_study_intent", clarifyAmbiguous, ambiguousRules ["high.administration-now"],
 *     educationalSafeguards: the intent layer (clinical-risk.ts IntentPolicy).
 * What does NOT change: every high-risk rule id and tier, scopes, minTier, high.identifiable (still reads the notes too).
 */

const TOPICS_ADD = [
  "renal", "kidney*", "nephr*", "glomerul*", "urinary", "bladder", "urin*", "electrolyte*", "fluid balance", "acid-base", "acid base",
  "syndrome*", "disease*", "disorder*", "condition*", "illness*", "pathophysiolog*", "aetiolog*", "etiolog*", "epidemiolog*", "prognos*",
  "pharmacokinetic*", "pharmacodynamic*", "antibiotic*", "antimicrobial*", "analgesi*", "vaccin*", "immunis*", "immuniz*",
  "liver", "hepat*", "gastro*", "bowel", "digestive", "endocrin*", "thyroid*", "adrenal*", "pituitar*", "hormone*", "neuro*", "brain",
  "spinal", "nervous system", "musculoskeletal", "bone*", "fracture*", "skin", "dermat*", "integumentary", "haemat*", "hemat*",
  "anaemi*", "anemi*", "blood", "immun*", "lymph*", "reproductive", "obstetric*", "pregnan*", "midwif*", "antenatal", "postnatal",
  "neonat*", "paediatric*", "pediatric*", "gerontolog*", "older adult*", "frailty", "oedema", "edema", "hypertension", "hypotension",
  "shock", "infarct*", "angina", "arrhythmi*", "ecg", "cancer*", "oncolog*", "tumour*", "tumor*", "mental health", "psychiatr*",
  "depression", "anxiety", "dementia", "delirium", "epilep*", "surgery", "surgical", "post-operative", "postoperative", "pre-operative",
  "preoperative", "anaesthe*", "anesthe*", "palliative", "end of life", "differential*", "investigation*", "blood test*", "laborator*",
  "ethic*", "professional practice", "accountability", "duty of care", "confidentiality", "code of conduct", "scope of practice",
  "documentation", "record keeping", "risk assessment", "deteriorat*", "osce", "simulation*", "clinical reasoning", "case stud*",
  "metabolic", "metabolism", "organ failure", "body system*", "cardiovascular", "respiratory system", "joints", "musculoskeletal system",
];
const STUDY_ADD = [
  "differentiat*", "distinguish*", "classif*", "categoris*", "categoriz*", "identify", "evaluat*", "analys*", "analyz*", "interpret*",
  "calculat*", "work out", "worked example*", "vignette*", "hypothetical*", "in a patient with", "a patient with", "a patient who",
  "difference between", "differences between", "distinction between", "versus", "vs", "overview", "key points", "mnemonic*", "rationale",
  "teach me", "quiz me", "test me", "tell me about", "help me understand", "give me examples", "osce", "simulation*",
  "critically", "justify", "illustrate", "theoretical*", "textbook", "pathophysiolog*",
];
const BED_NUMBERS = ["bed 0*", "bed 1*", "bed 2*", "bed 3*", "bed 4*", "bed 5*", "bed 6*", "bed 7*", "bed 8*", "bed 9*",
  "bay 0*", "bay 1*", "bay 2*", "bay 3*", "bay 4*", "bay 5*", "bay 6*", "bay 7*", "bay 8*", "bay 9*"];
const REAL_PATIENT_DROP = ["in bed", "in bed ", "patient in bed"];
const REAL_PATIENT_ADD = ["under my care", "in my care", "i am caring for", "i'm caring for", "i am looking after", "i'm looking after",
  "on my shift", "my service user*", ...BED_NUMBERS];
const URGENT_NOW = ["right now", "at the moment", "just now", "as we speak", "what should i do now", "what do i do now", "what shall i do now",
  "what do we do now", "happening now"];

export const SCHOLAR_RISK01_REFUSAL: Record<string, string> = {
  "high.real-patient": "real_patient", "high.administration-now": "administration", "high.urgent-direction": "emergency",
  "high.personal-safety": "personal_safety", "high.identifiable": "identifiable",
};
export const SCHOLAR_RISK01_INTENT = {
  unknownHandling: "educational_if_study_intent", clarifyAmbiguous: true, ambiguousRules: ["high.administration-now"], educationalSafeguards: true,
} as const;
/** The high-risk rules that must survive, high risk, with their scope. */
export const SCHOLAR_RISK01_HIGH = ["high.real-patient", "high.administration-now", "high.urgent-direction", "high.personal-safety", "high.identifiable"];

const uniq = (xs: string[]) => [...new Set(xs.map(x => x.toLowerCase()))];
const widen = (r: any, add: string[]) => ({ ...r, all: [uniq([...(r.all?.[0] ?? []), ...add]), ...(r.all?.slice(1) ?? [])] });

/** Pure: the published Scholar risk section with SCHOLAR-RISK-01 applied. Idempotent. Refuses a section it does not expect. */
export function withScholarRisk01(risk: any): any {
  const rules: any[] = Array.isArray(risk?.rules) ? risk.rules : [];
  const missing = [...SCHOLAR_RISK01_HIGH, "clinical.topics", "clinical.study-request"].filter(id => !rules.some(r => r?.id === id));
  if (missing.length) throw new Error(`Refusing: the Scholar risk section lacks ${missing.join(", ")}. Apply SCHOLAR-EDU-AI-01 first.`);
  const next = rules.map(r => {
    if (!r) return r;
    let n = r;
    if (r.id === "clinical.topics") n = widen(r, TOPICS_ADD);
    if (r.id === "clinical.study-request") n = widen(r, STUDY_ADD);
    if (r.id === "high.real-patient") n = { ...r, all: [uniq([...(r.all?.[0] ?? []).filter((t: string) => !REAL_PATIENT_DROP.includes(t.trim().toLowerCase()) && t !== "in bed "), ...REAL_PATIENT_ADD])] };
    if (r.id === "high.urgent-direction") n = { ...r, all: [URGENT_NOW, ...(r.all?.slice(1) ?? [])] };
    if (SCHOLAR_RISK01_REFUSAL[r.id]) n = { ...n, refusal: SCHOLAR_RISK01_REFUSAL[r.id] };
    return n;
  });
  for (const id of SCHOLAR_RISK01_HIGH) {
    const before = rules.find(r => r.id === id), after = next.find(r => r.id === id);
    if (after.tier !== "high_risk_clinical" || (after.scope ?? "subject") !== (before.scope ?? "subject")) throw new Error(`Refusing: ${id} must stay high risk with its scope.`);
  }
  for (const r of next) for (const g of r.all ?? []) if (g.length > 200) throw new Error(`Refusing: ${r.id} has more than 200 terms in a group.`);
  return { ...risk, rules: next, ...SCHOLAR_RISK01_INTENT, ambiguousRules: [...SCHOLAR_RISK01_INTENT.ambiguousRules] };
}
