import type { PolicyDef } from "../policy";
import { CONFIDENCE_FACTORS, DEFAULT_EVALUATION_TEMPLATES, RECOMMENDATION_RULES, SCOPES } from "./evaluation-vocabulary";

// ── MY PROFESSIONAL EVALUATION: NO-CODE GOVERNANCE ── COMPETEN-PROFESSIONAL-EVALUATION-01 E6 ─────────────────────────
//
// The Stage 6 policies, held in the EXISTING Individual policy store (WCE, src/lib/individual/policy.ts): versioned on
// publish, audited, clamped on read. Only the definitions are here, so the Stage 6 rules read in one place. They are
// listed in POLICIES and resolved by resolvePolicy like every other Individual policy.
//
// ⚠ WHAT NO SETTING CAN WIDEN (beneath configuration, owner GO s10): evaluations stay private unless the person ticks
// one onto a Passport link, AI never verifies and never reads private reflections, verification decisions are only ever
// read, there is no score, and missing evidence never reads as incompetence. Nothing names a profession, a country, a
// catalogue or a weight.

export const PROFESSIONAL_EVALUATION_POLICIES: readonly PolicyDef[] = [
  {
    key: "professional_evaluation_scopes", kind: "set", product: "Professional",
    label: "Evaluation scopes",
    help: "What a person may evaluate: their development as a whole, a goal, a competency or one of its outcomes, a topic, a CPD activity, a course, or a development need. Each works without a catalogue except competency and outcome.",
    options: SCOPES.map(([value, label]) => ({ value, label })), fallback: SCOPES.map(([v]) => v),
    limitReason: "Only these scopes. \"My development as a whole\" is always offered.",
  },
  {
    key: "professional_evaluation_confidence_factors", kind: "set", product: "Professional",
    label: "What may raise evidence confidence",
    help: "Evidence confidence rule: which kinds of evidence move confidence above Limited. Self-reported records alone never do. Confidence is about the evidence, never about the person.",
    options: CONFIDENCE_FACTORS.map(([value, label]) => ({ value, label })), fallback: CONFIDENCE_FACTORS.map(([v]) => v),
    limitReason: "Only these factors. With none ticked every evaluation says Limited, with the reason.",
  },
  {
    key: "professional_evaluation_sufficiency", kind: "int", product: "Professional", unit: "records",
    label: "Evidence sufficiency",
    help: "How many separate source records a dimension needs before it is described as supported rather than limited.",
    fallback: 2, min: 1, max: 10, limitReason: "From one to ten. Never a pass mark.",
  },
  {
    key: "professional_evaluation_recency_days", kind: "int", product: "Professional", unit: "days",
    label: "Evidence recency",
    help: "Evidence older than this is still shown, with the limitation that it is not recent.",
    fallback: 1095, min: 90, max: 3650, limitReason: "From three months to ten years.",
  },
  {
    key: "professional_evaluation_period_days", kind: "int", product: "Professional", unit: "days",
    label: "Evaluation period",
    help: "How far back an evaluation looks by default. 0 means the whole record. The person can always choose the whole record.",
    fallback: 0, min: 0, max: 3650, limitReason: "From the whole record (0) to ten years.",
  },
  {
    key: "professional_evaluation_recommendation_rules", kind: "set", product: "Professional",
    label: "Recommendation rules",
    help: "Which deterministic recommendations an evaluation may offer. Each says why it is offered and goes to the module that owns the work. The person accepts, edits, defers or dismisses it.",
    options: RECOMMENDATION_RULES.map(([value, label]) => ({ value, label })), fallback: RECOMMENDATION_RULES.map(([v]) => v),
    limitReason: "Only these rules. None is compulsory, and none is an examination.",
  },
  {
    key: "professional_evaluation_templates", kind: "options", product: "Professional", max: 10, noun: "feedback template",
    label: "Evaluation reflection templates",
    help: "Templates a person may use for the optional private note on an evaluation. Write each as \"Name: first prompt | second prompt | ...\".",
    fallback: DEFAULT_EVALUATION_TEMPLATES, emptyMeans: "No templates offered", limitReason: "At most 10, each up to 160 characters. Always optional.",
  },
  {
    key: "professional_evaluation_sharing", kind: "choice", product: "Professional",
    label: "Evaluations on a Passport link",
    help: "Privacy rule: whether a person may tick a recorded evaluation onto a Passport link they make. It is shown as formative, with its sources, method, date and limitations. Nothing is ever shared automatically.",
    options: [{ value: "offer", label: "The person may choose" }, { value: "off", label: "Never shared" }], fallback: "offer",
    limitReason: "Two choices. Private by default either way.",
  },
  {
    key: "professional_evaluation_ai", kind: "choice", product: "Professional",
    label: "AI help with evaluation",
    help: "Whether a person may ask the personal AI to summarise their findings, explain limitations or suggest opportunities. AI fair use and model eligibility apply. AI text is labelled and never becomes a finding.",
    options: [{ value: "on", label: "On, when the person asks" }, { value: "off", label: "Off" }], fallback: "on",
    limitReason: "Two choices. Evaluation works fully without AI.",
  },
  {
    key: "professional_evaluation_ai_reflections", kind: "choice", product: "Professional",
    label: "Reflections in AI evaluation help",
    help: "Privacy rule: evaluation help never sends a person's private reflections or notes, only the counts and labels of the findings. This cannot be widened here.",
    options: [{ value: "off", label: "Never sent" }], fallback: "off",
    limitReason: "One choice.",
  },
  {
    key: "professional_evaluation_corrections", kind: "choice", product: "Professional",
    label: "Correcting an evaluation",
    help: "Correction behaviour: an evaluation is never changed. With corrections allowed, a person may record a corrected evaluation that names the original and says why. Either way the original is kept.",
    options: [{ value: "linked", label: "Allowed, as a linked new evaluation" }, { value: "off", label: "Not offered: record a new evaluation instead" }], fallback: "linked",
    limitReason: "Two choices. Nothing can overwrite or delete an evaluation.",
  },
  {
    key: "professional_evaluation_history_shown", kind: "int", product: "Professional", unit: "evaluations",
    label: "Previous evaluations listed",
    help: "Retention on screen: how many previous evaluations the workspace lists, newest first. Every evaluation is kept until the person erases their account.",
    fallback: 50, min: 10, max: 500, limitReason: "From 10 to 500. Nothing is deleted by this setting.",
  },
];
