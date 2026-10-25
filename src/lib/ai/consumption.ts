/* eslint-disable @typescript-eslint/no-explicit-any */
import { FAIR_USE_SCOPE, ACTIVITY_CODE, CAU_MAX, type AiProduct } from "./fair-use-policy";

// ── HOLDINGS AI: WHO PAYS ── COMPETEN-HOLDINGS-AI-CONSUMPTION-01, migration 421 ──────────────────────────────
//
// One Holdings AI ledger, three kinds of budget owner:
//   individual   a person's own learning: their tutoring, revision, private cases and feedback (their allowance)
//   platform     Competen Holdings or a product entity developing SHARED content: screening, refinement, shared
//                cases, governance assistance (a platform budget)
//   institution  learning or content development an AUTHORISED institution funds (an institution budget, which
//                cannot exist without an institution and a funding arrangement -- 421)
//
// ⚠ THE SERVER DECIDES WHO PAYS, FROM THE WORKFLOW. A route names the workflow it is running (a constant in its own
// code). The owner type comes from ATTRIBUTION below, and the budget from the no-code routing policy. Nothing a
// browser sends -- an owner, a budget, a cost, a policy -- ever reaches this decision.
//
// ⚠ PROMOTION NEVER RE-CHARGES A STUDENT. Generating and using a private case is the student's. Screening it,
// de-duplicating it, refining it into a shared case is the platform's, from the moment that separate platform
// activity starts, and the student's original generation stays where it was charged.
//
// ⚠ A BUDGET ONLY REFUSES ITS OWN WORK. A platform budget running out stops platform content development. A student's
// learning runs on the student's own allowance, so it is never interrupted by a platform budget.

export type OwnerType = "individual" | "platform" | "institution";
export type OwnerRule = OwnerType | "platform_or_institution" | "none";

/** Owner GO s4: the default owner of each AI workflow. A new AI workflow must be named here before it can run. */
export const ATTRIBUTION = {
  "case.private_generate": "individual",     // a student generates a private case
  "case.private_interact": "individual",     // a student interacts with a private case
  "case.feedback": "individual",             // a student asks for AI feedback
  "case.live_with_stored": "individual",     // a student uses live AI with a stored case
  "case.replay_stored": "none",              // a student replays a stored deterministic case: no AI at all
  "case.candidate_screen": "platform",       // the platform identifies or screens eligible candidates
  "case.dedupe": "platform",                 // the platform de-duplicates candidate cases with AI
  "case.promote": "platform",                // the platform processes a promoted candidate
  "case.shared_variation": "platform",       // the platform generates governed shared variations
  "case.educator_develop": "platform_or_institution", // an educator develops shared cases with AI
  "case.reviewer_assist": "platform_or_institution",  // a clinical reviewer asks for AI assistance
  "case.institution_commission": "institution",       // an institution commissions cases
  // COMPETEN-KNOWLEDGE-RESEARCH-01 s9 (CKRI): "Platform-funded research and educational-content development must consume
  // authorised Platform budgets. Institution-funded research activities must use appropriately authorised Institutional
  // budgets. Do not charge individual students." Neither can ever resolve to a person's allowance.
  "knowledge.educator_develop": "platform_or_institution", // an educator develops knowledge or educational content with AI
  "research.analysis_assist": "platform_or_institution",   // research analysis assisted by AI
} as const satisfies Record<string, OwnerRule>;
export type Workflow = keyof typeof ATTRIBUTION;

export type ResolvedOwner =
  | { type: "individual"; userId: string }
  | { type: "platform" | "institution"; budget: { id: string; code: string; product: AiProduct; ownerType: "platform" | "institution" }; actorUserId: string | null; service: string | null };
export type OwnerRefusal = { refused: "no_ai" | "no_budget" | "budget_inactive" | "institution_not_funded" | "no_initiator" | "wrong_product"; message: string };

// ── Budget policy: no-code, per budget (CONFIG-002, scope platform / ai_fair_use, path ai.budget.<code>) ──────
export type BudgetPolicy = {
  /** The monthly ceiling, in CAU. Zero: nothing can be charged (the unpublished default). */
  ceilingCau: number;
  /** Activities this budget may fund, each with an optional count cap per period. Unlisted: refused. */
  activities: Record<string, { capPerPeriod: number | null }>;
  /** Requests a SERVICE (no person) may initiate per period. Null: no automated processing at all. */
  automatedLimit: number | null;
  /** Show an alert on the HQ page from this share of the ceiling used. */
  alertAtPct: number;
  /** none: each month starts from the ceiling. unused: unused allowance carries forward, up to carryCapCau. */
  carryForward: "none" | "unused";
  carryCapCau: number;
  /** Outstanding unreconciled holds the budget may carry before new requests wait. */
  unreconciledCapCau: number;
};
export const budgetPath = (code: string) => `ai.budget.${code}`;
export const ROUTING_PATH = "ai.consumption.routing";
export const BUDGET_CODE = /^[a-z][a-z0-9_.-]{2,60}$/;
export const SERVICE_NAME = /^[a-z][a-z0-9_.:-]{2,80}$/;

const n = (v: unknown, lo: number, hi: number, fb: number) => { if (v === null || v === undefined || v === "") return fb; const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fb; };

/** Pure: a published budget policy, clamped. The default funds nothing. */
export function resolveBudgetPolicy(s: any): BudgetPolicy {
  const activities: BudgetPolicy["activities"] = {};
  for (const [code, a] of Object.entries(s?.activities && typeof s.activities === "object" ? s.activities : {}).slice(0, 40)) {
    if (!ACTIVITY_CODE.test(code)) continue;
    const cap = (a as any)?.capPerPeriod;
    activities[code] = { capPerPeriod: cap === null || cap === undefined || cap === "" ? null : Math.round(n(cap, 0, 1_000_000, 0)) };
  }
  return {
    ceilingCau: n(s?.ceilingCau, 0, CAU_MAX, 0),
    activities,
    automatedLimit: s?.automatedLimit === null || s?.automatedLimit === undefined || s?.automatedLimit === "" ? null : Math.round(n(s.automatedLimit, 0, 1_000_000, 0)),
    alertAtPct: n(s?.alertAtPct, 1, 100, 80),
    carryForward: s?.carryForward === "unused" ? "unused" : "none",
    carryCapCau: n(s?.carryCapCau, 0, CAU_MAX, 0),
    unreconciledCapCau: n(s?.unreconciledCapCau, 0, CAU_MAX, 0),
  };
}

/** Pure: the no-code routing of workflows to budget codes. Only workflows ATTRIBUTION knows, only valid codes. */
export function resolveRouting(s: any): Partial<Record<Workflow, string>> {
  const out: Partial<Record<Workflow, string>> = {};
  for (const [w, code] of Object.entries(s?.workflows && typeof s.workflows === "object" ? s.workflows : {})) {
    if (Object.prototype.hasOwnProperty.call(ATTRIBUTION, w) && typeof code === "string" && BUDGET_CODE.test(code)) out[w as Workflow] = code;
  }
  return out;
}

async function published(admin: any, path: string): Promise<any | null> {
  try {
    const { data, error } = await admin.from("workspace_config_overrides").select("published")
      .eq("scope_type", FAIR_USE_SCOPE.scopeType).eq("scope_ref", FAIR_USE_SCOPE.scopeRef).eq("config_path", path).maybeSingle();
    return error ? null : data?.published ?? null;
  } catch { return null; }
}
export const loadBudgetPolicy = async (admin: any, code: string) => resolveBudgetPolicy(await published(admin, budgetPath(code)));
export const loadRouting = async (admin: any) => resolveRouting(await published(admin, ROUTING_PATH));

/**
 * Who pays for one request, decided on the server from the workflow. `who` is the authenticated person (from the
 * session, never the body) or a named service; `institutionBudgetCode` is only ever an institution budget the
 * caller's own authority check has already tied to this person's appointment. Never throws.
 */
export async function resolveOwner(admin: any, workflow: Workflow, product: AiProduct,
  who: { userId: string | null; service?: string | null; institutionBudgetCode?: string | null }): Promise<ResolvedOwner | OwnerRefusal> {
  const rule: OwnerRule = ATTRIBUTION[workflow];
  if (rule === "none") return { refused: "no_ai", message: "This replays stored material and needs no AI." };
  if (rule === "individual") {
    if (!who.userId) return { refused: "no_initiator", message: "A person's own learning needs that person." };
    return { type: "individual", userId: who.userId };
  }
  const service = who.service && SERVICE_NAME.test(who.service) ? who.service : null;
  if (!who.userId && !service) return { refused: "no_initiator", message: "Shared content work needs an authorised person or service." };
  const routing = await loadRouting(admin);
  const code = rule === "institution" || (rule === "platform_or_institution" && who.institutionBudgetCode) ? who.institutionBudgetCode ?? null : routing[workflow] ?? null;
  if (!code) return rule === "institution"
    ? { refused: "institution_not_funded", message: "No authorised institution budget funds this." }
    : { refused: "no_budget", message: "No budget is assigned to this work yet." };
  const { data: b } = await admin.from("ai_budget").select("id, code, owner_type, product, status").eq("code", code).maybeSingle();
  if (!b) return { refused: "no_budget", message: "The assigned budget does not exist." };
  if (b.status !== "active") return { refused: "budget_inactive", message: "The budget for this work is suspended or closed." };
  if (b.product !== product) return { refused: "wrong_product", message: "That budget funds another product." };
  const wanted: "platform" | "institution" = rule === "platform" ? "platform" : rule === "institution" ? "institution" : who.institutionBudgetCode ? "institution" : "platform";
  if (b.owner_type !== wanted) return { refused: "no_budget", message: "The assigned budget is of the wrong kind." };
  return { type: wanted, budget: { id: b.id, code: b.code, product: b.product, ownerType: b.owner_type }, actorUserId: who.userId, service: who.userId ? null : service };
}
export const isOwnerRefusal = (x: ResolvedOwner | OwnerRefusal): x is OwnerRefusal => "refused" in x;

/** Pure: the calendar month containing `now`, the period every budget account is kept in. */
export function budgetPeriod(now: Date): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
}

/** Pure: the ceiling a new period opens with, carrying forward what the policy allows from the last one. */
export function openingCeiling(p: BudgetPolicy, previous: { included: number; used: number; reserved: number } | null): number {
  if (p.carryForward !== "unused" || !previous) return p.ceilingCau;
  const unused = Math.max(0, previous.included - previous.used - previous.reserved);
  return Math.min(CAU_MAX, p.ceilingCau + Math.min(unused, p.carryCapCau));
}

/** The budget's account for the current month, opened at zero use if new (idempotent on budget and period). */
export async function budgetAccount(admin: any, budget: { id: string; product: AiProduct; ownerType: "platform" | "institution" }, policy: BudgetPolicy, version: string)
  : Promise<{ ok: true; account: any } | { ok: false }> {
  try {
    const { start, end } = budgetPeriod(new Date());
    const prev = (await admin.from("ai_allowance_account").select("included_cau, used_cau, reserved_cau").eq("budget_id", budget.id).lt("period_start", start.toISOString())
      .order("period_start", { ascending: false }).limit(1)).data?.[0] ?? null;
    const opened = await admin.from("ai_allowance_account").upsert({
      owner_type: budget.ownerType, budget_id: budget.id, product: budget.product, period_start: start.toISOString(), period_end: end.toISOString(),
      included_cau: openingCeiling(policy, prev ? { included: +prev.included_cau, used: +prev.used_cau, reserved: +prev.reserved_cau } : null), reserve_cau: 0, policy_version: version,
    }, { onConflict: "budget_id,period_start", ignoreDuplicates: true });
    if (opened.error) return { ok: false };
    const { data, error } = await admin.from("ai_allowance_account").select("*").eq("budget_id", budget.id).eq("period_start", start.toISOString()).maybeSingle();
    return error || !data ? { ok: false } : { ok: true, account: data };
  } catch { return { ok: false }; }
}
