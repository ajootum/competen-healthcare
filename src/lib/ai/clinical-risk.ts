/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AiTier } from "./fair-use-policy";
import { firstKind, REFUSAL_KINDS, type IntentContext, type RefusalKind } from "./request-intent";

// ── HOLDINGS AI: CLINICAL RISK OF A REQUEST ── COMPETEN IND-007 owner decision D1, migration 412 ─────────────
//
// Every AI request is one of three tiers: standard educational, clinical educational or high-risk clinical. The
// tier decides two things -- the cheapest model capability it may ever run on (a per-tier floor, held as policy)
// and whether a model needs a recorded evaluation decision covering that tier (ai_model_eligibility, enforced by
// ai_reserve). This file is pure: the rule shape, its validation, and the classification.
//
// ⚠ THE SUBJECT DECIDES, NOT THE ACTIVITY NAME. "Teach me" about hand hygiene and "teach me" about insulin dosing
// are different requests. The product passes the subject -- the request text after its identifier screen, topic
// terms, the competencies and frameworks its sources belong to -- and configured rules classify it. An activity
// may only RAISE the result (its riskFloor), never lower it.
//
// ⚠ UNKNOWN IS HIGH RISK. No subject at all, or a subject no rule recognises, is high_risk_clinical. Standard
// educational is reachable only by a rule that names it, and any matching higher rule wins over it. A rule set
// that fails to load is the empty set, so everything is high risk.
//
// ⚠ NOTHING IS KEPT. The text is read here, in memory, to match rules. Only the tier and the id of the deciding
// rule are recorded (ai_usage_ledger.risk_tier, risk_rule).

export type RiskTier = "standard_educational" | "clinical_educational" | "high_risk_clinical";
export const RISK_TIERS: readonly RiskTier[] = ["standard_educational", "clinical_educational", "high_risk_clinical"];
export const RISK_TIER_LABEL: Record<RiskTier, string> = {
  standard_educational: "Standard educational",
  clinical_educational: "Clinical educational",
  high_risk_clinical: "High-risk clinical",
};
export const riskRank = (t: RiskTier) => RISK_TIERS.indexOf(t);
export const higherRisk = (a: RiskTier, b: RiskTier): RiskTier => (riskRank(a) >= riskRank(b) ? a : b);

/**
 * One classification rule. It matches when EVERY group in `all` has at least one term present in the subject
 * (a term ending in * matches any word starting with it), OR when a competency of the given risk category is
 * in the subject, OR when a framework of the given code is. A rule with several kinds matches on any of them.
 *
 * SQIE D-1: `scope` says WHICH text the term groups are matched in. "subject" (the default, and the behaviour before
 * scopes) is the whole subject: the request and the study material passed with it. "request" is the learner's own
 * request words only, for a rule that describes the learner's USE (a real patient now, giving now, acting now, their
 * own safety): a lecture note that says "escalate urgently if the patient is unwell" is study material, not an urgent
 * request about a patient. Competency and framework kinds are unaffected. A caller that does not separate the request
 * from the material leaves the request as the whole text, so it is exactly as strict as before.
 */
export type RiskRuleScope = "request" | "subject";
export const RISK_RULE_SCOPES: readonly RiskRuleScope[] = ["subject", "request"];
export const RISK_RULE_SCOPE_LABEL: Record<RiskRuleScope, string> = {
  subject: "Matches the request and the study material",
  request: "Matches the learner's request only",
};
export type RiskRule = {
  id: string;
  label: string;
  tier: RiskTier;
  /** Where the term groups match. Absent or unknown: "subject". */
  scope?: RiskRuleScope;
  all?: string[][];
  competencyRisk?: string[];
  frameworks?: string[];
  /** SCHOLAR-RISK-01: what a refusal by this rule tells the learner (operating-mode.ts REFUSAL). Absent: by known id, else
   *  the general high-risk words. */
  refusal?: RefusalKind;
};

/**
 * SCHOLAR-RISK-01 (owner GO 31 Oct 2026): how a product treats what the keyword rules alone cannot settle. Every field
 * defaults to the behaviour before it (unknown is high risk, no clarify outside a mode that has one, nothing ambiguous),
 * so a product whose policy does not set it is unchanged.
 *
 *   unknownHandling       "high_risk": unrecognised is high-risk clinical (fail closed, the default).
 *                         "clarify": unrecognised asks the learner once whether it is for study.
 *                         "educational_if_study_intent": unrecognised WITH study framing (a study verb or a question)
 *                         is clinical educational; without it, clarify.
 *   clarifyAmbiguous      the clarify question may be asked in ANY operating mode, Strict Production included, for an
 *                         ambiguous request (category 3): an ambiguous rule or a giving decision with no study framing.
 *   ambiguousRules        high-risk rules that show a request MIGHT be about a real person (e.g. "should I give"), not
 *                         that it is: inside study framing they are clinical education, without it the learner is asked.
 *                         Never a real-patient, emergency, identifiable or personal-safety rule (dropped if named).
 *   educationalSafeguards every request above standard educational carries the educational boundary in its instructions,
 *                         whatever the mode (prompt only).
 *
 * With any of the first three set, the INTENT LAYER is on (request-intent.ts): real-patient evidence in the learner's own
 * words is category 4 and is refused outright, before routing, whatever model would be eligible.
 */
export type UnknownHandling = "high_risk" | "clarify" | "educational_if_study_intent";
export const UNKNOWN_HANDLING: readonly UnknownHandling[] = ["high_risk", "clarify", "educational_if_study_intent"];
export type IntentPolicy = { unknownHandling: UnknownHandling; clarifyAmbiguous: boolean; ambiguousRules: string[]; educationalSafeguards: boolean };
export const NO_INTENT: IntentPolicy = { unknownHandling: "high_risk", clarifyAmbiguous: false, ambiguousRules: [], educationalSafeguards: false };
/** Pure: the intent settings as stored (flat on the risk section), or nothing when they are the defaults. */
export const storedIntent = (i: IntentPolicy | undefined): Partial<IntentPolicy> =>
  !i || JSON.stringify(i) === JSON.stringify(NO_INTENT) ? {} : { unknownHandling: i.unknownHandling, clarifyAmbiguous: i.clarifyAmbiguous, ambiguousRules: [...i.ambiguousRules], educationalSafeguards: i.educationalSafeguards };
/** Pure: whether the intent layer runs for a policy. */
export const intentActive = (i: IntentPolicy | undefined) => !!i && (i.unknownHandling !== "high_risk" || i.clarifyAmbiguous || i.ambiguousRules.length > 0);

/** The refusal words for the high-risk rules every product has used since 29 Oct, by id (a rule's own `refusal` wins). */
export const KNOWN_RULE_REFUSAL: Record<string, RefusalKind> = {
  "high.real-patient": "real_patient", "high.administration-now": "administration", "high.urgent-direction": "emergency",
  "high.personal-safety": "personal_safety", "high.identifiable": "identifiable",
};
/** Never ambiguous: evidence of a real person, now. */
const NEVER_AMBIGUOUS: readonly RefusalKind[] = ["real_patient", "emergency", "identifiable", "personal_safety"];
export const ruleRefusal = (r: Pick<RiskRule, "id" | "refusal">): RefusalKind => r.refusal ?? KNOWN_RULE_REFUSAL[r.id] ?? "clinical_high";

export type RiskPolicy = {
  /** The cheapest model tier each risk tier may run on, at any service level. */
  minTier: Record<RiskTier, AiTier>;
  rules: RiskRule[];
  /** SCHOLAR-RISK-01. Absent (older callers building a policy by hand): NO_INTENT. */
  intent?: IntentPolicy;
};

export const RULE_ID = /^[a-z][a-z0-9_.-]{1,60}$/;
export const MAX_RULES = 60;
const MAX_TERMS = 200;
const AI_TIERS: readonly AiTier[] = ["cheap", "reasoning", "heavy"];

/** When a policy states no floors: conservative, with high risk on the strongest tier. */
export const DEFAULT_MIN_TIER: Record<RiskTier, AiTier> = { standard_educational: "cheap", clinical_educational: "reasoning", high_risk_clinical: "heavy" };

const cleanTerm = (t: unknown) => (typeof t === "string" ? t.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60) : "");
const cleanTerms = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(cleanTerm).filter(t => t.replace(/\*$/, "").length >= 2))].slice(0, MAX_TERMS) : []);

/** Pure: a published risk section as a policy. Invalid rules are dropped. Floors never fall from tier to tier. */
export function resolveRiskPolicy(s: any): RiskPolicy {
  const tierOf = (v: unknown, fb: AiTier): AiTier => ((AI_TIERS as readonly string[]).includes(v as string) ? (v as AiTier) : fb);
  const std = tierOf(s?.minTier?.standard_educational, DEFAULT_MIN_TIER.standard_educational);
  const clin0 = tierOf(s?.minTier?.clinical_educational, DEFAULT_MIN_TIER.clinical_educational);
  const clin = AI_TIERS.indexOf(clin0) < AI_TIERS.indexOf(std) ? std : clin0;
  const high0 = tierOf(s?.minTier?.high_risk_clinical, DEFAULT_MIN_TIER.high_risk_clinical);
  const high = AI_TIERS.indexOf(high0) < AI_TIERS.indexOf(clin) ? clin : high0;
  const rules: RiskRule[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(s?.rules) ? s.rules.slice(0, MAX_RULES) : []) {
    if (!r || typeof r !== "object" || typeof r.id !== "string" || !RULE_ID.test(r.id) || seen.has(r.id)) continue;
    if (!(RISK_TIERS as readonly string[]).includes(r.tier)) continue;
    const all = Array.isArray(r.all) ? r.all.map(cleanTerms).filter((g: string[]) => g.length) : [];
    const competencyRisk = cleanTerms(r.competencyRisk);
    const frameworks = Array.isArray(r.frameworks) ? r.frameworks.filter((f: unknown) => typeof f === "string" && /^[A-Za-z0-9-]{2,40}$/.test(f)).map((f: string) => f.toUpperCase()) : [];
    if (!all.length && !competencyRisk.length && !frameworks.length) continue;
    seen.add(r.id);
    const scope: RiskRuleScope = r.scope === "request" ? "request" : "subject";
    const refusal = (REFUSAL_KINDS as readonly string[]).includes(r.refusal) && r.refusal !== "unrecognised" ? { refusal: r.refusal as RefusalKind } : {};
    rules.push({ id: r.id, label: typeof r.label === "string" && r.label.trim() ? r.label.trim().slice(0, 120) : r.id, tier: r.tier, scope, all, competencyRisk, frameworks, ...refusal });
  }
  return { minTier: { standard_educational: std, clinical_educational: clin, high_risk_clinical: high }, rules, intent: resolveIntent(s, rules) };
}

/** Pure: the intent settings of a risk section. Anything malformed is the default; an ambiguous rule must exist, be high
 *  risk, and not be evidence of a real person now. */
export function resolveIntent(raw: any, rules: readonly RiskRule[]): IntentPolicy {
  // Stored flat on the risk section; a resolved policy sent back from the HQ editor carries them under `intent`.
  const s = raw?.intent && typeof raw.intent === "object" ? { ...raw, ...raw.intent } : raw;
  const unknownHandling: UnknownHandling = (UNKNOWN_HANDLING as readonly string[]).includes(s?.unknownHandling) ? s.unknownHandling : "high_risk";
  const ambiguousRules = (Array.isArray(s?.ambiguousRules) ? s.ambiguousRules : []).filter((id: unknown) => {
    const r = typeof id === "string" ? rules.find(x => x.id === id) : undefined;
    return !!r && r.tier === "high_risk_clinical" && !NEVER_AMBIGUOUS.includes(ruleRefusal(r));
  }).slice(0, 20);
  return { unknownHandling, clarifyAmbiguous: s?.clarifyAmbiguous === true, ambiguousRules: [...new Set<string>(ambiguousRules)], educationalSafeguards: s?.educationalSafeguards === true };
}

/** What the product tells the engine about a request's subject. */
export type RiskContext = {
  /** The request text, after the product's identifier screen. Read in memory only. */
  text?: string | null;
  /** SQIE D-1: the learner's OWN request words, without the study material in `text` (rules of scope "request").
   *  Absent: the whole subject text, so a caller that does not separate them is as strict as before. */
  requestText?: string | null;
  topicTerms?: readonly string[];
  /** Competencies the request is about (its sources, its mapping subjects). The engine reads their risk. */
  competencyIds?: readonly string[];
  frameworkCodes?: readonly string[];
  /** AI operating modes (operating-mode.ts): who is asking, for their mode and cohort, and "education" once the learner
   *  confirmed a clarify question was for study. Never part of the subject text. */
  actorId?: string | null;
  purpose?: "education" | null;
  /** Owner item 5 (1 Nov 2026): where the request was asked (request-intent.ts IntentContext). Read in memory by the intent
   *  layer only, never part of the subject text and never recorded. It can only frame an unrecognised request as study. */
  intentContext?: IntentContext | null;
};
/** The subject as the classifier sees it, after the engine has read competency risk and framework codes. */
export type ResolvedRiskSubject = {
  text: string; competencyRisks: readonly string[]; frameworkCodes: readonly string[];
  /** What rules of scope "request" match. Absent: `text` (the whole subject). */
  requestText?: string;
  /** Owner item 5: where the request was asked (RiskContext.intentContext). */
  intentContext?: IntentContext | null;
};
/** `refusal`: SCHOLAR-RISK-01, why a high-risk decision is refused, for honest words. `boundary`: the educational
 *  boundary goes into the instructions (policy educationalSafeguards). Neither is recorded beyond tier and rule. */
/** `recovery`: owner item 5, an unrecognised request asked in Learn, whose words offer the notes and research options. */
export type RiskDecision = { tier: RiskTier; rule: string; reason: string; refusal?: RefusalKind; boundary?: boolean; recovery?: "learn" };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const termPattern = (t: string) => t.endsWith("*") ? new RegExp(`(^|[^a-z0-9])${escape(t.slice(0, -1))}`) : new RegExp(`(^|[^a-z0-9])${escape(t)}($|[^a-z0-9])`);
/** Pure: whether a term appears in normalised text, as a whole word or phrase (or a word start, for a term ending in *). */
export const termIn = (text: string, term: string) => termPattern(term).test(text);
const norm = (s: string) => ` ${s.toLowerCase().replace(/\s+/g, " ")} `;

/** Pure: whether one rule matches the subject. */
export function ruleMatches(r: RiskRule, s: ResolvedRiskSubject): boolean {
  const text = norm(r.scope === "request" ? (s.requestText ?? s.text) : s.text);
  if (r.all?.length && r.all.every(group => group.some(t => termIn(text, t)))) return true;
  if (r.competencyRisk?.length && s.competencyRisks.some(k => r.competencyRisk!.includes(k.toLowerCase()))) return true;
  if (r.frameworks?.length && s.frameworkCodes.some(c => r.frameworks!.includes(c.toUpperCase()))) return true;
  return false;
}

/**
 * Pure: the tier of one request. The highest tier any rule gives wins. No subject, or no rule at all, is high risk.
 * The activity's riskFloor can only raise the result.
 */
export function classifyRisk(policy: RiskPolicy, subject: ResolvedRiskSubject, activityFloor: RiskTier = "standard_educational"): RiskDecision {
  const has = subject.text.trim().length > 0 || subject.competencyRisks.length > 0 || subject.frameworkCodes.length > 0;
  let d: RiskDecision;
  if (!has) d = { tier: "high_risk_clinical", rule: "unknown:no_subject", reason: "No subject was given, so it is treated as high-risk clinical.", refusal: "unrecognised" };
  else {
    const hits = policy.rules.filter(r => ruleMatches(r, subject));
    if (!hits.length) d = { tier: "high_risk_clinical", rule: "unknown:no_rule", reason: "No rule recognised the subject, so it is treated as high-risk clinical.", refusal: "unrecognised" };
    else {
      const top = hits.reduce((a, b) => (riskRank(b.tier) > riskRank(a.tier) ? b : a));
      d = { tier: top.tier, rule: top.id, reason: top.label };
      // SCHOLAR-RISK-01: the most serious reason among every high-risk rule that matched, for the learner's words.
      if (top.tier === "high_risk_clinical") d.refusal = firstKind(hits.filter(r => r.tier === "high_risk_clinical").map(ruleRefusal)) ?? "clinical_high";
    }
  }
  if (riskRank(activityFloor) > riskRank(d.tier)) d = { tier: activityFloor, rule: `activity_floor:${d.rule}`.slice(0, 120), reason: "This activity is always at least this clinical risk.",
    ...(activityFloor === "high_risk_clinical" ? { refusal: "clinical_high" as const } : {}) };
  return d;
}

/** Pure: the subject text to classify from the parts a product sends. */
export const subjectText = (ctx: RiskContext | undefined) => [ctx?.text ?? "", ...(ctx?.topicTerms ?? [])].filter(Boolean).join(" \n ").slice(0, 8000);
/** Pure: the request text for rules of scope "request". Undefined (the whole subject) where the caller sent none. */
export const requestTextOf = (ctx: RiskContext | undefined): string | undefined =>
  typeof ctx?.requestText === "string" ? ctx.requestText.slice(0, 8000) : undefined;
