/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AiTier } from "./fair-use-policy";

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
 */
export type RiskRule = {
  id: string;
  label: string;
  tier: RiskTier;
  all?: string[][];
  competencyRisk?: string[];
  frameworks?: string[];
};
export type RiskPolicy = {
  /** The cheapest model tier each risk tier may run on, at any service level. */
  minTier: Record<RiskTier, AiTier>;
  rules: RiskRule[];
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
    rules.push({ id: r.id, label: typeof r.label === "string" && r.label.trim() ? r.label.trim().slice(0, 120) : r.id, tier: r.tier, all, competencyRisk, frameworks });
  }
  return { minTier: { standard_educational: std, clinical_educational: clin, high_risk_clinical: high }, rules };
}

/** What the product tells the engine about a request's subject. */
export type RiskContext = {
  /** The request text, after the product's identifier screen. Read in memory only. */
  text?: string | null;
  topicTerms?: readonly string[];
  /** Competencies the request is about (its sources, its mapping subjects). The engine reads their risk. */
  competencyIds?: readonly string[];
  frameworkCodes?: readonly string[];
  /** AI operating modes (operating-mode.ts): who is asking, for their mode and cohort, and "education" once the learner
   *  confirmed a clarify question was for study. Never part of the subject text. */
  actorId?: string | null;
  purpose?: "education" | null;
};
/** The subject as the classifier sees it, after the engine has read competency risk and framework codes. */
export type ResolvedRiskSubject = { text: string; competencyRisks: readonly string[]; frameworkCodes: readonly string[] };
export type RiskDecision = { tier: RiskTier; rule: string; reason: string };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const termPattern = (t: string) => t.endsWith("*") ? new RegExp(`(^|[^a-z0-9])${escape(t.slice(0, -1))}`) : new RegExp(`(^|[^a-z0-9])${escape(t)}($|[^a-z0-9])`);
/** Pure: whether a term appears in normalised text, as a whole word or phrase (or a word start, for a term ending in *). */
export const termIn = (text: string, term: string) => termPattern(term).test(text);
const norm = (s: string) => ` ${s.toLowerCase().replace(/\s+/g, " ")} `;

/** Pure: whether one rule matches the subject. */
export function ruleMatches(r: RiskRule, s: ResolvedRiskSubject): boolean {
  const text = norm(s.text);
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
  if (!has) d = { tier: "high_risk_clinical", rule: "unknown:no_subject", reason: "No subject was given, so it is treated as high-risk clinical." };
  else {
    const hits = policy.rules.filter(r => ruleMatches(r, subject));
    if (!hits.length) d = { tier: "high_risk_clinical", rule: "unknown:no_rule", reason: "No rule recognised the subject, so it is treated as high-risk clinical." };
    else {
      const top = hits.reduce((a, b) => (riskRank(b.tier) > riskRank(a.tier) ? b : a));
      d = { tier: top.tier, rule: top.id, reason: top.label };
    }
  }
  if (riskRank(activityFloor) > riskRank(d.tier)) d = { tier: activityFloor, rule: `activity_floor:${d.rule}`.slice(0, 120), reason: "This activity is always at least this clinical risk." };
  return d;
}

/** Pure: the subject text to classify from the parts a product sends. */
export const subjectText = (ctx: RiskContext | undefined) => [ctx?.text ?? "", ...(ctx?.topicTerms ?? [])].filter(Boolean).join(" \n ").slice(0, 8000);
