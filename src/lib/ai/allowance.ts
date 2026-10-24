/* eslint-disable @typescript-eslint/no-explicit-any */
import { aiStatus } from "./config";
import { generate, type GenerateArgs, type GenerateResult } from "./client";
import {
  activityAt, allowancePeriod, defaultPolicy, fairUsePath, FAIR_USE_SCOPE, maxInputTokens, remainingBand, resolvePolicy, serviceLevel,
  type AiProduct, type AiServiceLevel, type Balance, type ProductAiPolicy,
} from "./fair-use-policy";

// ── COMPETEN HOLDINGS AI FAIR USE: THE ENGINE ── COMPETEN-AI-FAIR-USE-01, migrations 410 and 411 ───────────
//
// What every product calls. getAiStanding says where a person stands (service level, what each activity may
// do, when the allowance renews) -- the Learning Continuity signal. runMeteredAi runs one AI request through
// the money path: entitlement, policy, model for the level, maximum consumption, an ATOMIC reservation in the
// database (ai_reserve), generate(), then settlement of the actual tokens (ai_settle) or release when nothing
// billable happened (ai_release). The database does the arithmetic under a row lock. This file decides only
// what to ask for.
//
// ⚠ AN UNKNOWN CHARGE IS NEVER GUESSED (approved amendment 4). When the provider may have billed but no usage came
// back -- a timeout, a broken connection or stream -- the request is marked unreconciled (ai_mark_unreconciled):
// the hold stays against the allowance in its original period until real provider usage settles it, or proof of
// no billing releases it. It is never settled on the estimate.
//
// ⚠ DARK UNTIL SWITCHED ON. The platform flag ai_fair_use (practice_platform_flags) is written by no migration,
// so it is OFF: runMeteredAi then calls generate() exactly as before and the caller keeps its existing quota
// check, so production behaviour does not change and nothing reads a 410 table.
//
// ⚠ FAILS CLOSED WHEN ON. An unreadable policy, entitlement or balance is "unreadable", and nothing is sent.
//
// ⚠ A RETRY NEVER BUYS A SECOND ANSWER. A request id the database already holds -- reserved, settled or
// released -- is refused before the provider is called, so replaying an id gets nothing for free and a
// genuine retry cannot charge twice. Ids are namespaced by person.

export const AI_FAIR_USE_FLAG = "ai_fair_use";
export type AiActivityState = { label: string; available: boolean; via: "included" | "reserve" | null; reason: string | null };
export type AiStanding = {
  /** false: the standing could not be established, so NEW chargeable AI calls are held back (Learning Continuity).
   *  It never gates stored material: what a person has saved is always theirs to read (amendment 5). */
  readable: boolean;
  /** false: metering is off on this environment, and the product's existing limits apply. */
  metered: boolean;
  level: AiServiceLevel;
  remaining: { band: "plenty" | "some" | "low" | "none"; percent: number | null };
  resetsAt: string | null;
  activities: Record<string, AiActivityState>;
  message: string | null;
};
export type MeteredError = "allowance_exhausted" | "not_entitled" | "unreadable" | "duplicate_request" | "unknown_activity" | "level_insufficient"
  | "not_eligible" | "pending_reconciliation";
export type MeteredRefusal = { ok: false; error: MeteredError; standing: AiStanding };

export async function aiFairUseEnabled(admin: any): Promise<boolean> {
  try {
    const { data, error } = await admin.from("practice_platform_flags").select("enabled").eq("flag", AI_FAIR_USE_FLAG).maybeSingle();
    return !error && data?.enabled === true;
  } catch { return false; }
}

/** The published policy for a product. Unpublished or unreadable: the default, which allows nothing. */
export async function loadProductPolicy(admin: any, product: AiProduct): Promise<{ policy: ProductAiPolicy; readable: boolean }> {
  try {
    const { data, error } = await admin.from("workspace_config_overrides").select("published, updated_at")
      .eq("scope_type", FAIR_USE_SCOPE.scopeType).eq("scope_ref", FAIR_USE_SCOPE.scopeRef).eq("config_path", fairUsePath(product)).maybeSingle();
    if (error) return { policy: defaultPolicy(product), readable: false };
    if (!data?.published) return { policy: defaultPolicy(product), readable: true };
    return { policy: resolvePolicy(product, data.published, `${fairUsePath(product)}@${data.updated_at}`), readable: true };
  } catch { return { policy: defaultPolicy(product), readable: false }; }
}

const toBalance = (a: any): Balance => ({
  includedCau: Number(a.included_cau), reserveCau: Number(a.reserve_cau), usedCau: Number(a.used_cau), reservedCau: Number(a.reserved_cau),
  reserveUsedCau: Number(a.reserve_used_cau), reserveReservedCau: Number(a.reserve_reserved_cau),
});

/**
 * The person's account for the current allowance period, opened if it does not exist yet (idempotent on
 * person, product and period start). Balances are never set here: an account opens at zero, by 410.
 */
async function currentAccount(admin: any, userId: string, product: AiProduct, policy: ProductAiPolicy)
  : Promise<{ state: "ok"; account: any } | { state: "not_entitled" } | { state: "unreadable" }> {
  const { data: ents, error } = await admin.from("individual_live_entitlement").select("starts_at, ends_at")
    .eq("user_id", userId).eq("experience_code", product).order("starts_at", { ascending: false }).limit(1);
  if (error) return { state: "unreadable" };
  if (!ents?.length) return { state: "not_entitled" };
  const period = allowancePeriod(policy, { startsAt: ents[0].starts_at, endsAt: ents[0].ends_at }, new Date());
  if (!period) return { state: "not_entitled" };
  const key = { user_id: userId, product, period_start: period.start.toISOString() };
  const opened = await admin.from("ai_allowance_account").upsert({
    ...key, period_end: period.end.toISOString(), included_cau: policy.includedCau, reserve_cau: policy.reserveCau, policy_version: policy.version,
  }, { onConflict: "user_id,product,period_start", ignoreDuplicates: true });
  if (opened.error) return { state: "unreadable" };
  const { data: acc, error: aErr } = await admin.from("ai_allowance_account").select("*").match(key).maybeSingle();
  if (aErr || !acc) return { state: "unreadable" };
  return { state: "ok", account: acc };
}

function standingFrom(policy: ProductAiPolicy, acc: any): AiStanding {
  const b = toBalance(acc);
  const level = serviceLevel(policy, b);
  const activities: Record<string, AiActivityState> = {};
  for (const code of Object.keys(policy.activities)) {
    const d = activityAt(policy, level, code, b);
    activities[code] = { label: policy.activities[code].label, available: d.available, via: d.via, reason: d.reason };
  }
  return { readable: true, metered: true, level, remaining: remainingBand(b), resetsAt: acc.period_end, activities, message: policy.messages[level] };
}

const closed = (policy: ProductAiPolicy, readable: boolean, reason: string): AiStanding => ({
  readable, metered: true, level: "continuity", remaining: { band: "none", percent: null }, resetsAt: null,
  activities: Object.fromEntries(Object.entries(policy.activities).map(([c, a]) => [c, { label: a.label, available: false, via: null, reason }])), message: policy.messages.continuity,
});

/** Where a person stands for one product. Never throws. */
export async function getAiStanding(admin: any, args: { userId: string; product: AiProduct }): Promise<AiStanding> {
  const { policy, readable } = await loadProductPolicy(admin, args.product);
  if (!(await aiFairUseEnabled(admin))) {
    return { readable: true, metered: false, level: "full", remaining: { band: "plenty", percent: null }, resetsAt: null,
      activities: Object.fromEntries(Object.entries(policy.activities).map(([c, a]) => [c, { label: a.label, available: true, via: "included", reason: null }])), message: null };
  }
  if (!readable) return closed(policy, false, "AI help could not be checked just now.");
  try {
    const a = await currentAccount(admin, args.userId, args.product, policy);
    if (a.state === "unreadable") return closed(policy, false, "AI help could not be checked just now.");
    if (a.state === "not_entitled") return closed(policy, true, "This needs an active subscription.");
    return standingFrom(policy, a.account);
  } catch { return closed(policy, false, "AI help could not be checked just now."); }
}

const REQ = /^[A-Za-z0-9-]{8,80}$/;
/** A request id for one person's request: theirs if they sent a well-formed one (an idempotent retry), else new. */
export const requestIdFor = (userId: string, clientId: string | null | undefined) =>
  `${userId}:${clientId && REQ.test(clientId) ? clientId : crypto.randomUUID()}`;

/**
 * Run one AI request through the allowance. The caller has already applied its guard and its existing quota.
 * With metering off this is generate() unchanged.
 */
export async function runMeteredAi(admin: any, args: { userId: string; product: AiProduct; activity: string; requestId: string; generate: GenerateArgs })
  : Promise<GenerateResult | MeteredRefusal> {
  if (!(await aiFairUseEnabled(admin))) return generate(args.generate);
  const { policy, readable } = await loadProductPolicy(admin, args.product);
  if (!readable) return { ok: false, error: "unreadable", standing: closed(policy, false, "AI help could not be checked just now.") };
  const a = await currentAccount(admin, args.userId, args.product, policy);
  if (a.state === "unreadable") return { ok: false, error: "unreadable", standing: closed(policy, false, "AI help could not be checked just now.") };
  if (a.state === "not_entitled") return { ok: false, error: "not_entitled", standing: closed(policy, true, "This needs an active subscription.") };
  const standing = standingFrom(policy, a.account);
  const b = toBalance(a.account);
  const decision = activityAt(policy, standing.level, args.activity, b);
  if (!decision.available || !decision.via || !decision.tier) {
    const error: MeteredError = decision.refusal === "unknown_activity" ? "unknown_activity" : decision.refusal === "level_insufficient" ? "level_insufficient" : "allowance_exhausted";
    return { ok: false, error, standing: decision.reason ? { ...standing, message: decision.reason } : standing };
  }

  const status = aiStatus();
  const model = status.models?.[decision.tier];
  if (!status.provider || !status.canGenerate || !model) return { ok: false, error: "not_configured" };
  const activity = policy.activities[args.activity];
  const maxOut = Math.min(activity.maxOutputTokens, args.generate.maxTokens ?? activity.maxOutputTokens);
  // Everything the reservation is priced and limited by comes from the published policy and the database. The
  // client supplied only the retry key inside requestId (amendment 3).
  const { data: held, error: rErr } = await admin.rpc("ai_reserve", {
    p_request_id: args.requestId, p_account: a.account.id, p_activity: args.activity, p_pool: decision.via, p_provider: status.provider, p_model: model,
    p_max_input_tokens: maxInputTokens(args.generate.system, args.generate.user), p_max_output_tokens: maxOut, p_policy_version: policy.version,
    p_currency: policy.currency, p_buffer_pct: policy.fxBufferPct, p_clinically_sensitive: activity.clinicallySensitive,
    p_unreconciled_cap_cau: policy.maxUnreconciledCau,
    p_window_minutes: policy.windowMinutes, p_window_cap_cau: policy.windowCapCau, p_activity_cap: activity.capPerPeriod,
  });
  if (rErr) return { ok: false, error: "unreadable", standing: closed(policy, false, "AI help could not be checked just now.") };
  const r = Array.isArray(held) ? held[0] : held;
  if (typeof r?.reason === "string" && r.reason.startsWith("retry")) return { ok: false, error: "duplicate_request", standing };
  if (!r?.granted) {
    if (r?.reason === "not_eligible") return { ok: false, error: "not_eligible", standing: { ...standing, message: NOT_ELIGIBLE } };
    if (r?.reason === "unreconciled_ceiling") return { ok: false, error: "pending_reconciliation", standing: { ...standing, message: PENDING } };
    return { ok: false, error: "allowance_exhausted", standing: { ...standing, message: policy.messages[standing.level === "full" ? "optimised" : standing.level] } };
  }

  const out = await generate({ ...args.generate, tier: decision.tier, maxTokens: maxOut });
  if (out.usage) {
    const s = await settle(admin, args.requestId, out.ok ? out.model : model, out.usage.input, out.usage.output, out.ok ? "ok" : out.error === "refusal" ? "refusal" : "error");
    if (!s) console.error(`[ai-fair-use] settlement of ${args.requestId} failed: left reserved for reconciliation`);
  } else if (!out.ok && (out.error === "not_configured" || out.billing === "none")) {
    // The provider declined before generating, or was never called: nothing was billed.
    const { error } = await admin.rpc("ai_release", { p_request_id: args.requestId, p_outcome: out.error === "not_configured" ? "not_configured" : "error" });
    if (error) console.error(`[ai-fair-use] release of ${args.requestId} failed: left reserved for reconciliation`);
  } else {
    // The charge is unknown. Keep the hold and wait for the provider's usage (amendment 4).
    const { error } = await admin.rpc("ai_mark_unreconciled", { p_request_id: args.requestId, p_outcome: "timeout" });
    if (error) console.error(`[ai-fair-use] ${args.requestId} could not be marked unreconciled: left reserved, the stale sweep marks it`);
  }
  return out;
}

const NOT_ELIGIBLE = "This activity needs an AI model approved for clinical content, and none is available for it right now. Nothing was sent.";
const PENDING = "Some earlier AI requests are still being confirmed with the provider. New AI help resumes once they are settled.";

async function settle(admin: any, requestId: string, model: string, input: number, output: number, outcome: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await admin.rpc("ai_settle", { p_request_id: requestId, p_model: model, p_input_tokens: input, p_output_tokens: output, p_extra_usd: 0, p_outcome: outcome });
    if (!error) return true;
    if (/already/i.test(error.message ?? "")) return true;
  }
  return false;
}

/** Pure: the narrowing a caller needs. */
export const isMeteredRefusal = (r: GenerateResult | MeteredRefusal): r is MeteredRefusal => !r.ok && "standing" in r;

/**
 * Pure: what a route answers for a metered refusal. Never a bare error: the body carries the standing, so the
 * page can show Learning Continuity (what stays available, when the allowance renews) instead of a failure.
 */
export function meteredRefusalBody(r: MeteredRefusal): { status: number; body: { error: string; continuity: boolean; standing: AiStanding } } {
  const error = r.error === "duplicate_request" ? "That request was already received."
    : r.error === "unknown_activity" ? "This AI activity is not offered."
    : r.error === "unreadable" ? "AI help could not be checked just now, so nothing was sent. Try again shortly."
    : r.error === "not_entitled" ? "This needs an active subscription."
    : r.standing.message ?? "This AI activity is not available right now.";
  const status = r.error === "unreadable" || r.error === "not_eligible" ? 503 : r.error === "duplicate_request" ? 409 : r.error === "unknown_activity" ? 400 : r.error === "not_entitled" ? 403 : 429;
  return { status, body: { error, continuity: r.error === "allowance_exhausted" || r.error === "level_insufficient", standing: r.standing } };
}
