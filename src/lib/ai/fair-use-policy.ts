/* eslint-disable @typescript-eslint/no-explicit-any */

// ── COMPETEN HOLDINGS AI FAIR USE: THE POLICY ── COMPETEN-AI-FAIR-USE-01, migrations 410 and 411 ───────────
//
// One engine, a policy per product. Scholar and Professional differ only in the policy document each one
// publishes through the CONFIG-002 engine (scope platform / ai_fair_use, path ai.fair_use.<product>). This
// file is pure: the shape, the validation that clamps every value, and the decisions that follow from a
// policy and a balance -- the service level and what each activity may do at it.
//
// ⚠ NO MONEY IN CODE. Allowances are in CAU (1 CAU = UGX 1, owner D4), priced by versioned rate rows in the
// database (ai_price, ai_fx_rate, ai_cau_basis). Every figure a person is allowed comes from the published
// policy. The unpublished default allows NOTHING: with no published policy every product is in Learning
// Continuity, so turning metering on before a policy exists fails closed.
//
// ⚠ ACTIVITIES ARE POLICY DATA (approved amendment 1). There is no fixed list in code: an activity exists only
// if the published policy defines it, and a request for any other code is refused as unknown.
//
// ⚠ NEVER A SILENT DOWNGRADE (amendment 2, owner D1). Each activity names the cheapest tier it may run on
// (minTier), and each clinical risk tier names one too (risk.minTier). A request's floor is the higher of the two.
// At the Optimised and Essential levels the engine moves to a cheaper model only where that tier meets the floor.
// Where it does not, the request is refused as level_insufficient and the reason says so. The risk tier itself is
// classified from the request's subject (clinical-risk.ts), and whether a model may serve that tier at all is an
// evidence-based record in the database (ai_model_eligibility, enforced by ai_reserve, migration 412).

import { resolveRiskPolicy, RISK_TIERS, type RiskPolicy, type RiskTier } from "./clinical-risk";

export type AiProduct = "scholar" | "professional";
export const AI_PRODUCTS: readonly AiProduct[] = ["scholar", "professional"];
export type AiTier = "cheap" | "reasoning" | "heavy";
export const AI_TIERS: readonly AiTier[] = ["cheap", "reasoning", "heavy"];
export type AiServiceLevel = "full" | "optimised" | "essential" | "continuity";

export type ActivityPolicy = {
  label: string;
  /** essential: may continue at the Essential level and, when eligible, from the reserve. */
  class: "essential" | "standard";
  tier: AiTier;
  /** The cheapest tier this activity may ever run on. Never above its tier. */
  minTier: AiTier;
  maxOutputTokens: number;
  /** Requests of this activity per allowance period. null = no count cap. */
  capPerPeriod: number | null;
  /** The lowest clinical risk tier a request of this activity can be classified at. It only raises the subject's tier. */
  riskFloor: RiskTier;
  /** May draw on the essential reserve. Only an essential activity, and only when the policy says so. */
  reserveEligible: boolean;
};

export type ResetRule = "subscription_anniversary" | "calendar_month" | "entitlement_cycle";

export type ProductAiPolicy = {
  version: string;
  includedCau: number;
  reserveCau: number;
  windowMinutes: number | null;
  windowCapCau: number | null;
  /** Remaining share of the included allowance below which the level drops. */
  levels: { optimisedBelowPct: number; essentialBelowPct: number };
  reset: { rule: ResetRule; cycleDays: number };
  /** The currency the CAU basis and the reference rate are read in (owner D3, D4). */
  currency: string;
  /** Widens the reservation hold only. Settlement uses the reference rate itself (owner D3). */
  fxBufferPct: number;
  /** Outstanding unreconciled holds a person may have, including a new hold, before new requests wait. */
  maxUnreconciledCau: number;
  activities: Record<string, ActivityPolicy>;
  /** The clinical risk rules and the per-tier model floor (owner D1). */
  risk: RiskPolicy;
  messages: { full: string; optimised: string; essential: string; continuity: string; levelInsufficient: string };
};

export const FAIR_USE_SCOPE = { scopeType: "platform", scopeRef: "ai_fair_use" } as const;
export const fairUsePath = (p: AiProduct) => `ai.fair_use.${p}`;
export const CAU_MAX = 1_000_000;
export const ACTIVITY_CODE = /^[a-z][a-z0-9_]{1,40}$/;
export const MAX_ACTIVITIES = 40;
export const MAX_OUTPUT_TOKENS = 8000;
// An activity that does not state its output size gets this. Tokens, not allowance: no money is in code.
export const DEFAULT_OUTPUT_TOKENS = 800;

const MESSAGES = {
  full: "Your AI help is available.",
  optimised: "Your AI help is running in an efficient mode to make your allowance last.",
  essential: "Your AI allowance is nearly used. Essential help, like clarifying an explanation, is still available.",
  continuity: "Your AI allowance for this period is used. Everything you have saved stays available, and new AI help returns when your allowance renews.",
  levelInsufficient: "This needs a fuller level of AI help than your allowance has left, so it was not answered by a lighter model. It returns when your allowance renews.",
};

/** The unpublished default: nothing allowed and no activities, so metering fails closed until a policy is published. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the product stays in the signature: every product has its own default
export function defaultPolicy(_product: AiProduct): ProductAiPolicy {
  return {
    version: "default-nothing-allowed", includedCau: 0, reserveCau: 0, windowMinutes: null, windowCapCau: null,
    levels: { optimisedBelowPct: 30, essentialBelowPct: 10 }, reset: { rule: "subscription_anniversary", cycleDays: 30 },
    currency: "UGX", fxBufferPct: 0, maxUnreconciledCau: 0, activities: {}, risk: resolveRiskPolicy(null), messages: { ...MESSAGES },
  };
}

const num = (v: unknown, lo: number, hi: number, fallback: number) => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const nullableNum = (v: unknown, lo: number, hi: number) => (v === null || v === undefined || v === "" ? null : num(v, lo, hi, lo));
const tier = (v: unknown, fallback: AiTier): AiTier => (AI_TIERS as readonly string[]).includes(v as string) ? v as AiTier : fallback;
const text = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : fallback);
const tierAtLeast = (t: AiTier, min: AiTier) => AI_TIERS.indexOf(t) >= AI_TIERS.indexOf(min);

/** Pure: one activity from a policy document, or null when its code is not a valid activity code. */
export function resolveActivity(code: string, s: any): ActivityPolicy | null {
  if (!ACTIVITY_CODE.test(code) || !s || typeof s !== "object") return null;
  const t = tier(s.tier, "reasoning");
  const min = tier(s.minTier, t);
  const cls = s.class === "essential" ? "essential" : "standard";
  return {
    label: text(s.label, code),
    class: cls,
    tier: t,
    minTier: tierAtLeast(t, min) ? min : t,
    maxOutputTokens: Math.round(num(s.maxOutputTokens, 50, MAX_OUTPUT_TOKENS, DEFAULT_OUTPUT_TOKENS)),
    capPerPeriod: nullableNum(s.capPerPeriod, 0, 100000),
    // A 411-era document said clinicallySensitive. Read as clinical educational, never as standard.
    riskFloor: (RISK_TIERS as readonly string[]).includes(s.riskFloor) ? s.riskFloor : s.clinicallySensitive === false ? "standard_educational" : "clinical_educational",
    reserveEligible: cls === "essential" && s.reserveEligible === true,
  };
}

/**
 * Pure: a published settings document as a policy. Every value is clamped. The activities are exactly those the
 * document defines (up to MAX_ACTIVITIES, valid codes only).
 */
export function resolvePolicy(product: AiProduct, settings: any, version: string): ProductAiPolicy {
  const d = defaultPolicy(product);
  if (!settings || typeof settings !== "object") return d;
  const activities: Record<string, ActivityPolicy> = {};
  const given = settings.activities && typeof settings.activities === "object" ? Object.entries(settings.activities) : [];
  for (const [code, s] of given.slice(0, MAX_ACTIVITIES)) {
    const a = resolveActivity(code, s);
    if (a) activities[code] = a;
  }
  const opt = num(settings.levels?.optimisedBelowPct, 0, 100, d.levels.optimisedBelowPct);
  const rule: ResetRule = settings.reset?.rule === "calendar_month" ? "calendar_month" : settings.reset?.rule === "entitlement_cycle" ? "entitlement_cycle" : "subscription_anniversary";
  return {
    version: text(version, d.version),
    includedCau: num(settings.includedCau, 0, CAU_MAX, 0),
    reserveCau: num(settings.reserveCau, 0, CAU_MAX, 0),
    windowMinutes: nullableNum(settings.windowMinutes, 5, 44640),
    windowCapCau: nullableNum(settings.windowCapCau, 0, CAU_MAX),
    levels: { optimisedBelowPct: opt, essentialBelowPct: num(settings.levels?.essentialBelowPct, 0, opt, Math.min(opt, d.levels.essentialBelowPct)) },
    reset: { rule, cycleDays: Math.round(num(settings.reset?.cycleDays, 7, 366, 30)) },
    currency: typeof settings.currency === "string" && /^[A-Z]{3}$/.test(settings.currency) ? settings.currency : d.currency,
    fxBufferPct: num(settings.fxBufferPct, 0, 100, d.fxBufferPct),
    maxUnreconciledCau: num(settings.maxUnreconciledCau, 0, CAU_MAX, d.maxUnreconciledCau),
    activities,
    risk: resolveRiskPolicy(settings.risk),
    messages: {
      full: text(settings.messages?.full, MESSAGES.full), optimised: text(settings.messages?.optimised, MESSAGES.optimised),
      essential: text(settings.messages?.essential, MESSAGES.essential), continuity: text(settings.messages?.continuity, MESSAGES.continuity),
      levelInsufficient: text(settings.messages?.levelInsufficient, MESSAGES.levelInsufficient),
    },
  };
}

/** Pure: `d` moved by k months, on the same day of the month (the last day where the month is shorter). */
export function addMonthsClamped(d: Date, k: number): Date {
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d.getUTCDate(), last));
  return first;
}

/** Pure: the allowance period containing `now`, from the entitlement and the reset rule. */
export function allowancePeriod(policy: ProductAiPolicy, entitlement: { startsAt: string; endsAt: string | null }, now: Date): { start: Date; end: Date } | null {
  const starts = new Date(entitlement.startsAt), ends = entitlement.endsAt ? new Date(entitlement.endsAt) : null;
  if (now < starts || (ends && now >= ends)) return null;
  let start: Date, end: Date;
  if (policy.reset.rule === "calendar_month") {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    if (start < starts) start = starts;
  } else if (policy.reset.rule === "entitlement_cycle") {
    const cycle = policy.reset.cycleDays * 86400000;
    const n = Math.floor((now.getTime() - starts.getTime()) / cycle);
    start = new Date(starts.getTime() + n * cycle);
    end = new Date(start.getTime() + cycle);
  } else {
    // Monthly on the subscription anniversary (owner D5): the start's day of the month, at the start's time.
    let k = (now.getUTCFullYear() - starts.getUTCFullYear()) * 12 + (now.getUTCMonth() - starts.getUTCMonth());
    if (addMonthsClamped(starts, k) > now) k--;
    start = addMonthsClamped(starts, k);
    end = addMonthsClamped(starts, k + 1);
  }
  if (ends && end > ends) end = ends;
  return { start, end };
}

export type Balance = { includedCau: number; reserveCau: number; usedCau: number; reservedCau: number; reserveUsedCau: number; reserveReservedCau: number };

/** Pure: the service level from what remains of the included allowance. */
export function serviceLevel(policy: ProductAiPolicy, b: Balance): AiServiceLevel {
  if (b.includedCau <= 0) return "continuity";
  const left = b.includedCau - b.usedCau - b.reservedCau;
  if (left <= 0) return "continuity";
  const pct = (left / b.includedCau) * 100;
  if (pct < policy.levels.essentialBelowPct) return "essential";
  if (pct < policy.levels.optimisedBelowPct) return "optimised";
  return "full";
}

export type ActivityRefusal = "unknown_activity" | "level_insufficient" | "allowance_exhausted";
export type ActivityDecision = { available: boolean; via: "included" | "reserve" | null; tier: AiTier | null; refusal: ActivityRefusal | null; reason: string | null };

const maxTier = (a: AiTier, b: AiTier): AiTier => (AI_TIERS.indexOf(a) >= AI_TIERS.indexOf(b) ? a : b);
/** Pure: the cheapest tier a request may run on -- the activity's floor or the risk tier's, whichever is higher. */
export const floorTier = (policy: ProductAiPolicy, a: ActivityPolicy, risk?: RiskTier) => (risk ? maxTier(a.minTier, policy.risk.minTier[risk]) : a.minTier);

/** Pure: the tier a level asks for, from the request's base tier. Full keeps it, Optimised one step cheaper, below that the cheapest. */
export function levelTier(level: AiServiceLevel, base: AiTier): AiTier {
  if (level === "full") return base;
  if (level === "optimised") return AI_TIERS[Math.max(0, AI_TIERS.indexOf(base) - 1)];
  return "cheap";
}

const refuse = (refusal: ActivityRefusal, reason: string): ActivityDecision => ({ available: false, via: null, tier: null, refusal, reason });

/**
 * Pure: whether an activity may run at a level, from which pool, on which tier. With a risk tier (a classified
 * request), the floor is the higher of the activity's and the tier's, and the full level runs at least on that floor.
 */
export function activityAt(policy: ProductAiPolicy, level: AiServiceLevel, code: string, b: Balance, risk?: RiskTier): ActivityDecision {
  const a = Object.prototype.hasOwnProperty.call(policy.activities, code) ? policy.activities[code] : undefined;
  if (!a) return refuse("unknown_activity", "This activity is not offered.");
  const reserveLeft = b.reserveCau - b.reserveUsedCau - b.reserveReservedCau;
  let via: "included" | "reserve";
  if (level === "full" || level === "optimised") via = "included";
  else if (level === "essential") {
    if (a.class !== "essential") return refuse("allowance_exhausted", "Saved for when your allowance renews: only essential help is available now.");
    via = "included";
  } else {
    if (!(a.class === "essential" && a.reserveEligible && reserveLeft > 0)) return refuse("allowance_exhausted", "Available again when your AI allowance renews.");
    via = "reserve";
  }
  const floor = floorTier(policy, a, risk);
  const t = levelTier(level, maxTier(a.tier, floor));
  if (!tierAtLeast(t, floor)) return refuse("level_insufficient", policy.messages.levelInsufficient);
  return { available: true, via, tier: t, refusal: null, reason: null };
}

/** Pure: the band a person sees. Never a unit count (owner D4). */
export function remainingBand(b: Balance): { band: "plenty" | "some" | "low" | "none"; percent: number | null } {
  if (b.includedCau <= 0) return { band: "none", percent: null };
  const pct = Math.max(0, Math.round(((b.includedCau - b.usedCau - b.reservedCau) / b.includedCau) * 100));
  return { band: pct <= 0 ? "none" : pct < 15 ? "low" : pct < 50 ? "some" : "plenty", percent: pct };
}

/** Pure: a conservative upper bound on input tokens from text (about 2.5 characters per token). */
export const maxInputTokens = (system: string, user: string) => Math.ceil((system.length + user.length) / 2.5) + 64;
