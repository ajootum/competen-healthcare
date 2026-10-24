/* eslint-disable @typescript-eslint/no-explicit-any */

// ── COMPETEN HOLDINGS AI FAIR USE: THE POLICY ── COMPETEN-AI-FAIR-USE-01, migration 410 ─────────────────────
//
// One engine, a policy per product. Scholar and Professional differ only in the policy document each one
// publishes through the CONFIG-002 engine (scope platform / ai_fair_use, path ai.fair_use.<product>). This
// file is pure: the shape, the validation that clamps every value, and the decisions that follow from a
// policy and a balance -- the service level and what each activity may do at it.
//
// ⚠ NO MONEY IN CODE. Allowances are in CAU (Competen AI Allowance Units), priced by versioned rate rows in
// the database (ai_price, ai_cau_rate, ai_fx_rate). The unpublished default allows NOTHING: with no published
// policy every product is in Learning Continuity, so turning metering on before a policy exists fails closed.
//
// ⚠ NEVER A SILENT CLINICAL DOWNGRADE. An activity marked clinically sensitive keeps its tier at every level.
// Where a level would need a cheaper model than such an activity allows, the activity is unavailable at that
// level -- it is never quietly answered by a model that may not meet its standard.

export type AiProduct = "scholar" | "professional";
export const AI_PRODUCTS: readonly AiProduct[] = ["scholar", "professional"];
export type AiTier = "cheap" | "reasoning" | "heavy";
const TIERS: readonly AiTier[] = ["cheap", "reasoning", "heavy"];
export type AiServiceLevel = "full" | "optimised" | "essential" | "continuity";

export type ActivityPolicy = {
  label: string;
  /** essential: may continue at the Essential level and, when eligible, from the reserve. */
  class: "essential" | "standard";
  tier: AiTier;
  /** The cheapest tier this activity may ever run on. A clinically sensitive activity is never below its tier. */
  minTier: AiTier;
  maxOutputTokens: number;
  /** Requests of this activity per allowance period. null = no count cap. */
  capPerPeriod: number | null;
  clinicallySensitive: boolean;
  reserveEligible: boolean;
};

export type ProductAiPolicy = {
  version: string;
  includedCau: number;
  reserveCau: number;
  windowMinutes: number | null;
  windowCapCau: number | null;
  /** Remaining share of the included allowance below which the level drops. */
  levels: { optimisedBelowPct: number; essentialBelowPct: number };
  reset: { rule: "entitlement_cycle" | "calendar_month"; cycleDays: number };
  activities: Record<string, ActivityPolicy>;
  messages: { full: string; optimised: string; essential: string; continuity: string };
};

export const FAIR_USE_SCOPE = { scopeType: "platform", scopeRef: "ai_fair_use" } as const;
export const fairUsePath = (p: AiProduct) => `ai.fair_use.${p}`;
export const CAU_MAX = 1_000_000;

const MESSAGES = {
  full: "Your AI study help is available.",
  optimised: "Your AI help is running in an efficient mode to make your allowance last.",
  essential: "Your AI allowance is nearly used. Essential help, like clarifying an explanation, is still available.",
  continuity: "Your AI allowance for this period is used. Everything you have saved stays available, and new AI help returns when your allowance renews.",
};

// The activity catalogue each product's policy may configure. Structure only: no money.
const act = (label: string, cls: "essential" | "standard", tier: AiTier, minTier: AiTier, maxOutputTokens: number, sensitive: boolean, reserve = false): ActivityPolicy =>
  ({ label, class: cls, tier, minTier, maxOutputTokens, capPerPeriod: null, clinicallySensitive: sensitive, reserveEligible: reserve });
export const ACTIVITY_CATALOGUE: Record<AiProduct, Record<string, ActivityPolicy>> = {
  scholar: {
    explain: act("Explanations", "standard", "reasoning", "cheap", 1500, false),
    questions: act("Practice questions", "standard", "reasoning", "reasoning", 2000, true),
    case_steps: act("Clinical cases", "standard", "reasoning", "reasoning", 2500, true),
    map: act("Competency mapping", "standard", "reasoning", "cheap", 2000, false),
    assistant: act("Personal AI questions", "standard", "reasoning", "cheap", 900, false),
    clarify: act("Clarify an existing explanation", "essential", "cheap", "cheap", 600, false, true),
    tutor_continue: act("Finish an interrupted tutoring session", "essential", "reasoning", "cheap", 900, false, true),
  },
  professional: {
    assistant: act("CPD planning and reflection drafting", "standard", "reasoning", "cheap", 900, false),
    map: act("Competency suggestions", "standard", "reasoning", "cheap", 2000, false),
  },
};

/** The unpublished default: nothing allowed, so metering fails closed until a policy is published. */
export function defaultPolicy(product: AiProduct): ProductAiPolicy {
  return {
    version: "default-nothing-allowed", includedCau: 0, reserveCau: 0, windowMinutes: null, windowCapCau: null,
    levels: { optimisedBelowPct: 30, essentialBelowPct: 10 }, reset: { rule: "entitlement_cycle", cycleDays: 30 },
    activities: ACTIVITY_CATALOGUE[product], messages: { ...MESSAGES },
  };
}

const num = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const nullableNum = (v: unknown, lo: number, hi: number) => (v === null || v === undefined || v === "" ? null : num(v, lo, hi, lo));
const tier = (v: unknown, fallback: AiTier): AiTier => (TIERS as readonly string[]).includes(v as string) ? v as AiTier : fallback;
const text = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : fallback);

/**
 * Pure: a published settings document as a policy. Every value is clamped. Activities are only those the
 * product catalogue defines -- a policy can tune an activity, never invent one -- and a clinically sensitive
 * activity can never be configured below its catalogue tier.
 */
export function resolvePolicy(product: AiProduct, settings: any, version: string): ProductAiPolicy {
  const d = defaultPolicy(product);
  if (!settings || typeof settings !== "object") return d;
  const activities: Record<string, ActivityPolicy> = {};
  for (const [code, base] of Object.entries(ACTIVITY_CATALOGUE[product])) {
    const s = settings.activities?.[code] ?? {};
    const t = tier(s.tier, base.tier);
    const min = base.clinicallySensitive ? base.tier : tier(s.minTier, base.minTier);
    activities[code] = {
      ...base,
      tier: TIERS.indexOf(t) < TIERS.indexOf(min) ? min : t,
      minTier: min,
      maxOutputTokens: num(s.maxOutputTokens, 50, base.maxOutputTokens, base.maxOutputTokens),
      capPerPeriod: nullableNum(s.capPerPeriod, 0, 100000),
      reserveEligible: base.class === "essential" && s.reserveEligible !== false,
    };
  }
  const opt = num(settings.levels?.optimisedBelowPct, 0, 100, d.levels.optimisedBelowPct);
  return {
    version: text(version, d.version),
    includedCau: num(settings.includedCau, 0, CAU_MAX, 0),
    reserveCau: num(settings.reserveCau, 0, CAU_MAX, 0),
    windowMinutes: nullableNum(settings.windowMinutes, 5, 44640),
    windowCapCau: nullableNum(settings.windowCapCau, 0, CAU_MAX),
    levels: { optimisedBelowPct: opt, essentialBelowPct: num(settings.levels?.essentialBelowPct, 0, opt, d.levels.essentialBelowPct) },
    reset: { rule: settings.reset?.rule === "calendar_month" ? "calendar_month" : "entitlement_cycle", cycleDays: Math.round(num(settings.reset?.cycleDays, 7, 366, 30)) },
    activities,
    messages: {
      full: text(settings.messages?.full, MESSAGES.full), optimised: text(settings.messages?.optimised, MESSAGES.optimised),
      essential: text(settings.messages?.essential, MESSAGES.essential), continuity: text(settings.messages?.continuity, MESSAGES.continuity),
    },
  };
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
  } else {
    const cycle = policy.reset.cycleDays * 86400000;
    const n = Math.floor((now.getTime() - starts.getTime()) / cycle);
    start = new Date(starts.getTime() + n * cycle);
    end = new Date(start.getTime() + cycle);
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

export type ActivityDecision = { available: boolean; pool: "included" | "reserve" | null; tier: AiTier | null; reason: string | null };

/** Pure: whether an activity may run at a level, from which pool, on which tier. */
export function activityAt(policy: ProductAiPolicy, level: AiServiceLevel, code: string, b: Balance): ActivityDecision {
  const a = policy.activities[code];
  if (!a) return { available: false, pool: null, tier: null, reason: "This activity is not offered." };
  const reserveLeft = b.reserveCau - b.reserveUsedCau - b.reserveReservedCau;
  if (level === "full") return { available: true, pool: "included", tier: a.tier, reason: null };
  if (level === "optimised") {
    // Efficient models where safe. A clinically sensitive activity keeps its tier.
    return { available: true, pool: "included", tier: a.clinicallySensitive ? a.tier : a.minTier, reason: null };
  }
  if (level === "essential") {
    if (a.class !== "essential") return { available: false, pool: null, tier: null, reason: "Saved for when your allowance renews: only essential help is available now." };
    return { available: true, pool: "included", tier: a.clinicallySensitive ? a.tier : a.minTier, reason: null };
  }
  if (a.class === "essential" && a.reserveEligible && reserveLeft > 0) return { available: true, pool: "reserve", tier: a.clinicallySensitive ? a.tier : a.minTier, reason: null };
  return { available: false, pool: null, tier: null, reason: "Available again when your AI allowance renews." };
}

/** Pure: the band a person sees. Never a token count unless they ask for detail. */
export function remainingBand(b: Balance): { band: "plenty" | "some" | "low" | "none"; percent: number | null } {
  if (b.includedCau <= 0) return { band: "none", percent: null };
  const pct = Math.max(0, Math.round(((b.includedCau - b.usedCau - b.reservedCau) / b.includedCau) * 100));
  return { band: pct <= 0 ? "none" : pct < 15 ? "low" : pct < 50 ? "some" : "plenty", percent: pct };
}

/** Pure: a conservative upper bound on input tokens from text (about 2.5 characters per token). */
export const maxInputTokens = (system: string, user: string) => Math.ceil((system.length + user.length) / 2.5) + 64;
