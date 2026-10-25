/* eslint-disable @typescript-eslint/no-explicit-any */
import { aiStatus } from "./config";
import { generate, type GenerateArgs, type GenerateResult } from "./client";
import { classifyRisk, riskRank, subjectText, type ResolvedRiskSubject, type RiskContext, type RiskDecision, type RiskTier } from "./clinical-risk";
import {
  activityAt, allowancePeriod, defaultPolicy, fairUsePath, FAIR_USE_SCOPE, maxInputTokens, remainingBand, resolvePolicy, serviceLevel,
  type AiProduct, type AiServiceLevel, type AiTier, type Balance, type ProductAiPolicy,
} from "./fair-use-policy";
import { budgetAccount, budgetPath, loadBudgetPolicy, type ResolvedOwner } from "./consumption";

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
/** `risk` is the request's classified clinical risk where it was decided, so the page can say why. Never the text. */
export type MeteredRefusal = { ok: false; error: MeteredError; standing: AiStanding; risk?: RiskDecision };

/**
 * The subject as the classifier sees it: the request text and topic terms as given, and the risk category and
 * framework of each competency named, read from the shared library. A competency read that fails counts as a
 * high-risk competency, so an unreadable subject is never classified lower than it might be.
 */
export async function resolveRiskSubject(admin: any, ctx: RiskContext | undefined): Promise<ResolvedRiskSubject> {
  const text = subjectText(ctx);
  const frameworkCodes = [...(ctx?.frameworkCodes ?? [])];
  const ids = [...new Set(ctx?.competencyIds ?? [])].slice(0, 200);
  if (!ids.length) return { text, competencyRisks: [], frameworkCodes };
  try {
    const { data: comps, error } = await admin.from("framework_competencies").select("id, risk_category, cpu_id, domain_id").in("id", ids);
    if (error || !comps) return { text, competencyRisks: ["high"], frameworkCodes };
    const cpuIds = [...new Set(comps.map((c: any) => c.cpu_id).filter(Boolean))];
    const domIds = [...new Set(comps.map((c: any) => c.domain_id).filter(Boolean))];
    const [cpus, doms] = await Promise.all([
      cpuIds.length ? admin.from("clinical_practice_units").select("risk_category").in("id", cpuIds) : Promise.resolve({ data: [] }),
      domIds.length ? admin.from("framework_domains").select("framework_id").in("id", domIds) : Promise.resolve({ data: [] }),
    ]);
    const fwIds = [...new Set((doms.data ?? []).map((d: any) => d.framework_id))];
    const fws = fwIds.length ? await admin.from("frameworks").select("code").in("id", fwIds) : { data: [] };
    if (cpus.error || doms.error || fws.error) return { text, competencyRisks: ["high"], frameworkCodes };
    const risks = [...comps.map((c: any) => c.risk_category), ...(cpus.data ?? []).map((c: any) => c.risk_category)].filter(Boolean).map((r: string) => r.toLowerCase());
    return { text, competencyRisks: risks, frameworkCodes: [...frameworkCodes, ...(fws.data ?? []).map((f: any) => f.code).filter(Boolean)] };
  } catch { return { text, competencyRisks: ["high"], frameworkCodes }; }
}

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

/** An eligibility decision as ai_reserve reads it (411, 412): only the effective rows. */
export type EligibilityRow = { activity: string; provider: string; model_prefix: string; eligible: boolean; max_risk_tier: string | null };
export const NOT_ELIGIBLE_REASON = "This needs an AI model approved for clinical content, and none is approved for it yet.";
const ELIGIBILITY_UNREADABLE = "Whether a model is approved for this could not be checked just now.";

/**
 * Pure: standing that says what ai_reserve will do. An activity whose risk floor is above standard educational runs
 * only on a model an evaluation decision made eligible for that activity at that tier (411, 412) -- the model its
 * tier resolves to, at the activity's floor. Without one it is NOT available, with the reason, instead of being
 * offered and then refused on every call. Unreadable eligibility closes those activities (fail closed). A request's
 * own subject may still raise its risk above the floor: the reservation remains the control.
 */
export function withEligibility(standing: AiStanding, policy: ProductAiPolicy, b: Balance, provider: string | null, models: Record<string, string> | null | undefined,
  rows: readonly EligibilityRow[] | null): AiStanding {
  const activities = { ...standing.activities };
  for (const [code, a] of Object.entries(policy.activities)) {
    const st = activities[code];
    if (!st?.available) continue;
    const floor = a.riskFloor as RiskTier;
    if (riskRank(floor) <= 0) continue;
    if (rows === null) { activities[code] = { ...st, available: false, via: null, reason: ELIGIBILITY_UNREADABLE }; continue; }
    const d = activityAt(policy, standing.level, code, b, floor);
    const model = d.tier ? models?.[d.tier] : undefined;
    const covered = !!provider && !!model && rows.some(r => r.activity === code && r.provider === provider && r.eligible && model.startsWith(r.model_prefix)
      && riskRank((r.max_risk_tier ?? "clinical_educational") as RiskTier) >= riskRank(floor));
    if (!covered) activities[code] = { ...st, available: false, via: null, reason: NOT_ELIGIBLE_REASON };
  }
  return { ...standing, activities };
}

/** The eligibility decisions in force for one product. null = could not be read. */
async function loadEligibility(admin: any, product: AiProduct): Promise<EligibilityRow[] | null> {
  try {
    const now = new Date().toISOString();
    const { data, error } = await admin.from("ai_model_eligibility").select("activity, provider, model_prefix, eligible, max_risk_tier")
      .eq("product", product).lte("effective_from", now).or(`effective_to.is.null,effective_to.gt.${now}`);
    return error ? null : (data ?? []);
  } catch { return null; }
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
    const status = aiStatus();
    return withEligibility(standingFrom(policy, a.account), policy, toBalance(a.account), status.provider ?? null, status.models as Record<string, string> | undefined, await loadEligibility(admin, args.product));
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
export async function runMeteredAi(admin: any, args: { userId: string; product: AiProduct; activity: string; requestId: string; generate: GenerateArgs; risk?: RiskContext; record?: { type: string; ref: string } | null })
  : Promise<GenerateResult | MeteredRefusal> {
  if (!(await aiFairUseEnabled(admin))) return generate(args.generate);
  const { policy, readable } = await loadProductPolicy(admin, args.product);
  if (!readable) return { ok: false, error: "unreadable", standing: closed(policy, false, "AI help could not be checked just now.") };
  const a = await currentAccount(admin, args.userId, args.product, policy);
  if (a.state === "unreadable") return { ok: false, error: "unreadable", standing: closed(policy, false, "AI help could not be checked just now.") };
  if (a.state === "not_entitled") return { ok: false, error: "not_entitled", standing: closed(policy, true, "This needs an active subscription.") };
  const standing = standingFrom(policy, a.account);
  const b = toBalance(a.account);
  const known = Object.prototype.hasOwnProperty.call(policy.activities, args.activity);
  // Owner D1: the request's clinical risk, from its subject. It sets the model floor and the eligibility needed.
  const risk = known ? classifyRisk(policy.risk, await resolveRiskSubject(admin, args.risk), policy.activities[args.activity].riskFloor) : undefined;
  const decision = activityAt(policy, standing.level, args.activity, b, risk?.tier);
  if (!decision.available || !decision.via || !decision.tier) {
    const error: MeteredError = decision.refusal === "unknown_activity" ? "unknown_activity" : decision.refusal === "level_insufficient" ? "level_insufficient" : "allowance_exhausted";
    return { ok: false, error, standing: decision.reason ? { ...standing, message: decision.reason } : standing, risk };
  }

  const m = await meter(admin, {
    accountId: a.account.id, policy, activity: args.activity, tier: decision.tier, pool: decision.via, risk: risk!,
    capPerPeriod: policy.activities[args.activity].capPerPeriod, unreconciledCap: policy.maxUnreconciledCau,
    windowMinutes: policy.windowMinutes, windowCapCau: policy.windowCapCau,
    actor: args.userId, service: null, record: args.record ?? null, requestId: args.requestId, generate: args.generate,
  });
  if ("result" in m) return m.result;
  if (m.refused === "unreadable") return { ok: false, error: "unreadable", standing: closed(policy, false, "AI help could not be checked just now.") };
  if (m.refused === "not_configured") return { ok: false, error: "not_configured" };
  if (m.refused === "duplicate") return { ok: false, error: "duplicate_request", standing };
  if (m.refused === "not_eligible") return { ok: false, error: "not_eligible", standing: { ...standing, message: NOT_ELIGIBLE }, risk };
  if (m.refused === "unreconciled_ceiling") return { ok: false, error: "pending_reconciliation", standing: { ...standing, message: PENDING } };
  return { ok: false, error: "allowance_exhausted", standing: { ...standing, message: policy.messages[standing.level === "full" ? "optimised" : standing.level] } };
}

type MeterArgs = {
  accountId: string; policy: ProductAiPolicy; activity: string; tier: AiTier; pool: "included" | "reserve"; risk: RiskDecision;
  capPerPeriod: number | null; unreconciledCap: number; windowMinutes: number | null; windowCapCau: number | null;
  actor: string | null; service: string | null; record: { type: string; ref: string } | null; requestId: string; generate: GenerateArgs;
};
type MeterOutcome = { result: GenerateResult } | { refused: "unreadable" | "not_configured" | "duplicate" | "not_eligible" | "unreconciled_ceiling" | "exhausted" | "owner_mismatch" | "budget_suspended" | string };

/**
 * The one money path, for every budget owner: model for the tier, maximum consumption, an ATOMIC reservation in the
 * database (ai_reserve, which also decides who may charge the account), generate(), then settlement of the actual
 * usage, release when nothing was billed, or unreconciled when the charge is unknown.
 */
async function meter(admin: any, m: MeterArgs): Promise<MeterOutcome> {
  const status = aiStatus();
  const model = status.models?.[m.tier];
  if (!status.provider || !status.canGenerate || !model) return { refused: "not_configured" };
  const activity = m.policy.activities[m.activity];
  const maxOut = Math.min(activity.maxOutputTokens, m.generate.maxTokens ?? activity.maxOutputTokens);
  // Everything the reservation is priced and limited by comes from the published policy and the database. The
  // client supplied only the retry key inside requestId (amendment 3). Who pays was decided on the server.
  const { data: held, error: rErr } = await admin.rpc("ai_reserve", {
    p_request_id: m.requestId, p_account: m.accountId, p_activity: m.activity, p_pool: m.pool, p_provider: status.provider, p_model: model,
    p_max_input_tokens: maxInputTokens(m.generate.system, m.generate.user), p_max_output_tokens: maxOut, p_policy_version: m.policy.version,
    p_currency: m.policy.currency, p_buffer_pct: m.policy.fxBufferPct, p_risk_tier: m.risk.tier, p_risk_rule: m.risk.rule,
    p_unreconciled_cap_cau: m.unreconciledCap,
    p_actor: m.actor, p_service: m.service, p_record_type: m.record?.type ?? null, p_record_ref: m.record?.ref ?? null,
    p_window_minutes: m.windowMinutes, p_window_cap_cau: m.windowCapCau, p_activity_cap: m.capPerPeriod,
  });
  if (rErr) return { refused: "unreadable" };
  const r = Array.isArray(held) ? held[0] : held;
  if (typeof r?.reason === "string" && r.reason.startsWith("retry")) return { refused: "duplicate" };
  if (!r?.granted) return { refused: r?.reason === "not_eligible" || r?.reason === "unreconciled_ceiling" || r?.reason === "owner_mismatch" || r?.reason === "budget_suspended" ? r.reason : "exhausted" };

  const out = await generate({ ...m.generate, tier: m.tier, maxTokens: maxOut });
  if (out.usage) {
    const s = await settle(admin, m.requestId, out.ok ? out.model : model, out.usage.input, out.usage.output, out.ok ? "ok" : out.error === "refusal" ? "refusal" : "error");
    if (!s) console.error(`[ai-fair-use] settlement of ${m.requestId} failed: left reserved for reconciliation`);
  } else if (!out.ok && (out.error === "not_configured" || out.billing === "none")) {
    // The provider declined before generating, or was never called: nothing was billed.
    const { error } = await admin.rpc("ai_release", { p_request_id: m.requestId, p_outcome: out.error === "not_configured" ? "not_configured" : "error" });
    if (error) console.error(`[ai-fair-use] release of ${m.requestId} failed: left reserved for reconciliation`);
  } else {
    // The charge is unknown. Keep the hold and wait for the provider's usage (amendment 4).
    const { error } = await admin.rpc("ai_mark_unreconciled", { p_request_id: m.requestId, p_outcome: "timeout" });
    if (error) console.error(`[ai-fair-use] ${m.requestId} could not be marked unreconciled: left reserved, the stale sweep marks it`);
  }
  return { result: out };
}

// ── Platform and institution budgets (COMPETEN-HOLDINGS-AI-CONSUMPTION-01) ──────────────────────────────────

export type BudgetError = "no_ai" | "no_budget" | "budget_inactive" | "institution_not_funded" | "no_initiator" | "wrong_product"
  | "budget_exhausted" | "activity_not_funded" | "automated_limit" | "duplicate_request" | "not_eligible" | "pending_reconciliation" | "unreadable" | "unknown_activity";
export type BudgetRefusal = { ok: false; error: BudgetError; budget: string | null; message: string; risk?: RiskDecision };
export const isBudgetRefusal = (r: unknown): r is BudgetRefusal => !!r && typeof r === "object" && (r as any).ok === false && "budget" in (r as any);

/**
 * Run one AI request on behalf of a server-resolved owner (consumption.ts resolveOwner). An individual owner goes
 * through the person's allowance exactly as runMeteredAi. A platform or institution owner goes through its budget:
 * the budget policy decides what it funds and its ceiling, the product policy decides the model, the risk floor and
 * the eligibility. With metering off this is generate() unchanged.
 */
export async function runOwnedAi(admin: any, args: {
  owner: ResolvedOwner; product: AiProduct; activity: string; requestId: string; generate: GenerateArgs; risk?: RiskContext; record?: { type: string; ref: string } | null;
}): Promise<GenerateResult | MeteredRefusal | BudgetRefusal> {
  const o = args.owner;
  if (o.type === "individual") return runMeteredAi(admin, { userId: o.userId, product: args.product, activity: args.activity, requestId: args.requestId, generate: args.generate, risk: args.risk, record: args.record ?? null });
  if (!(await aiFairUseEnabled(admin))) return generate(args.generate);
  const refuse = (error: BudgetError, message: string, risk?: RiskDecision): BudgetRefusal => ({ ok: false, error, budget: o.budget.code, message, risk });
  const [{ policy, readable }, bp] = await Promise.all([loadProductPolicy(admin, args.product), loadBudgetPolicy(admin, o.budget.code)]);
  if (!readable) return refuse("unreadable", "The AI policy could not be read just now, so nothing was sent.");
  if (!Object.prototype.hasOwnProperty.call(policy.activities, args.activity)) return refuse("unknown_activity", "This AI activity is not offered.");
  if (!Object.prototype.hasOwnProperty.call(bp.activities, args.activity)) return refuse("activity_not_funded", "This budget does not fund this kind of AI work.");
  const acc = await budgetAccount(admin, o.budget, bp, `${budgetPath(o.budget.code)}`);
  if (!acc.ok) return refuse("unreadable", "The budget could not be read just now, so nothing was sent.");
  if (o.service && bp.automatedLimit !== null) {
    // An operational limit on unattended processing, counted here. The money ceiling itself is atomic in ai_reserve.
    const { count, error } = await admin.from("ai_usage_ledger").select("id", { count: "exact", head: true }).eq("account_id", acc.account.id).not("initiated_by_service", "is", null).neq("status", "released");
    if (error) return refuse("unreadable", "The budget could not be read just now, so nothing was sent.");
    if ((count ?? 0) >= bp.automatedLimit) return refuse("automated_limit", "This budget's automated-processing limit for the month is reached.");
  } else if (o.service) return refuse("automated_limit", "This budget allows no automated processing.");
  const risk = classifyRisk(policy.risk, await resolveRiskSubject(admin, args.risk), policy.activities[args.activity].riskFloor);
  const big = { includedCau: 1, reserveCau: 0, usedCau: 0, reservedCau: 0, reserveUsedCau: 0, reserveReservedCau: 0 };
  const decision = activityAt(policy, "full", args.activity, big, risk.tier);
  if (!decision.available || !decision.tier) return refuse("unknown_activity", decision.reason ?? "This AI activity is not offered.", risk);
  const m = await meter(admin, {
    accountId: acc.account.id, policy, activity: args.activity, tier: decision.tier, pool: "included", risk,
    capPerPeriod: bp.activities[args.activity].capPerPeriod, unreconciledCap: bp.unreconciledCapCau, windowMinutes: null, windowCapCau: null,
    actor: o.actorUserId, service: o.service, record: args.record ?? null, requestId: args.requestId, generate: args.generate,
  });
  if ("result" in m) return m.result;
  if (m.refused === "duplicate") return refuse("duplicate_request", "That request was already received.");
  if (m.refused === "not_eligible") return refuse("not_eligible", NOT_ELIGIBLE, risk);
  if (m.refused === "unreconciled_ceiling") return refuse("pending_reconciliation", PENDING);
  if (m.refused === "budget_suspended") return refuse("budget_inactive", "The budget for this work is suspended or closed.");
  if (m.refused === "not_configured" || m.refused === "unreadable") return refuse("unreadable", "AI could not be reached just now, so nothing was sent.");
  return refuse("budget_exhausted", "This budget's ceiling for the month is reached. Shared content work waits until it renews; students' learning is unaffected.");
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
