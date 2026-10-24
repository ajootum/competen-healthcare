/* eslint-disable @typescript-eslint/no-explicit-any */
import { publishScope, setOverride, type WceActor } from "@/lib/config/workspace-config-write";
import { RISK_TIERS } from "./clinical-risk";
import { BUDGET_CODE, ROUTING_PATH, budgetPath, budgetPeriod, resolveBudgetPolicy, resolveRouting, type BudgetPolicy, type Workflow } from "./consumption";
import { ACTIVITY_CODE, AI_PRODUCTS, FAIR_USE_SCOPE, fairUsePath, resolvePolicy, type AiProduct, type ProductAiPolicy } from "./fair-use-policy";

// ── AI FAIR USE: WHAT HQ CONFIGURES ── COMPETEN-AI-FAIR-USE-01 s12, migrations 410 and 411 ───────────────
//
// Two kinds of configuration, both versioned and audited, neither in code:
//   rates     ai_price (USD list or negotiated, with its source and price version, owner D2), ai_fx_rate (the
//             Bank of Uganda reference rate, monthly, owner D3), ai_cau_basis (1 CAU = UGX 1, owner D4), and
//             ai_model_eligibility (whether a model may serve one activity, on evaluation evidence, owner D1).
//             A change never edits a row: it ends the open one (its only permitted update, by the 410 guard)
//             and adds a new row from now. Every settled request keeps the rows it was reserved at, so history
//             cannot move. ai_cau_rate (410) is kept, read only, for requests reserved before 411.
//   policies  one document per product through the CONFIG-002 engine (draft, published version, audit) at
//             scope platform / ai_fair_use. resolvePolicy clamps it, so a saved draft can never hold a value
//             the engine would not accept.
//
// ⚠ PROVIDER CREDENTIALS ARE NOT HERE. Keys stay in the deployment environment (src/lib/ai/config.ts). Nothing
// on this surface reads or writes one.
//
// ⚠ ACTIVATION IS NOT HERE. The ai_fair_use flag that turns metering on is the owner's, set outside this page.

export type RateKind = "price" | "fx" | "basis" | "eligibility";
export const RATE_KINDS: readonly RateKind[] = ["price", "fx", "basis", "eligibility"];
const TABLE: Record<RateKind, string> = { price: "ai_price", fx: "ai_fx_rate", basis: "ai_cau_basis", eligibility: "ai_model_eligibility" };
const ACTOR_COLUMN: Record<RateKind, string> = { price: "created_by", fx: "created_by", basis: "created_by", eligibility: "decided_by" };

const rows = async (p: PromiseLike<any>) => { try { const r = await p; return r?.error ? null : (r?.data ?? []); } catch { return null; } };

export async function loadRates(admin: any) {
  const [price, fx, basis, eligibility] = await Promise.all([
    rows(admin.from("ai_price").select("*").order("provider").order("model_prefix").order("effective_from", { ascending: false }).limit(500)),
    rows(admin.from("ai_fx_rate").select("*").order("currency").order("effective_from", { ascending: false }).limit(200)),
    rows(admin.from("ai_cau_basis").select("*").order("currency").order("effective_from", { ascending: false }).limit(100)),
    rows(admin.from("ai_model_eligibility").select("*").order("product").order("activity").order("provider").order("effective_from", { ascending: false }).limit(1000)),
  ]);
  return price === null || fx === null || basis === null || eligibility === null ? null : { price, fx, basis, eligibility };
}

const positive = (v: unknown, allowZero = true) => { const n = Number(v); return Number.isFinite(n) && (allowZero ? n >= 0 : n > 0) ? n : null; };

/** Pure: a requested rate change, validated before it reaches the database (which checks again). */
export function checkRate(kind: RateKind, b: any): { ok: true; row: Record<string, unknown>; match: Record<string, unknown> } | { ok: false; error: string } {
  const note = typeof b?.note === "string" && b.note.trim() ? b.note.trim().slice(0, 500) : null;
  if (kind === "price") {
    if (!["anthropic", "openai", "gemini"].includes(b?.provider)) return { ok: false, error: "Choose a provider." };
    const prefix = typeof b?.modelPrefix === "string" ? b.modelPrefix.trim() : "";
    if (!/^[a-z0-9][a-z0-9._-]{1,79}$/i.test(prefix)) return { ok: false, error: "Give the model id or its prefix." };
    const i = positive(b.inputPerMtokUsd), o = positive(b.outputPerMtokUsd), x = positive(b.extraPerRequestUsd ?? 0);
    if (i === null || o === null || x === null) return { ok: false, error: "Prices are USD per million tokens, zero or more." };
    const sourceKind = b.sourceKind === "negotiated" ? "negotiated" : "list";
    const sourceRef = typeof b.sourceRef === "string" ? b.sourceRef.trim().slice(0, 500) : "";
    if (sourceRef.length < 5) return { ok: false, error: sourceKind === "list" ? "Give where the list price is published (its URL)." : "Give the agreement the negotiated rate comes from." };
    const priceVersion = typeof b.priceVersion === "string" && b.priceVersion.trim() ? b.priceVersion.trim().slice(0, 80) : null;
    return { ok: true, row: { provider: b.provider, model_prefix: prefix, input_per_mtok_usd: i, output_per_mtok_usd: o, extra_per_request_usd: x, source_kind: sourceKind, source_ref: sourceRef, price_version: priceVersion, note },
      match: { provider: b.provider, model_prefix: prefix } };
  }
  if (kind === "fx") {
    const currency = typeof b?.currency === "string" ? b.currency.trim().toUpperCase() : "";
    const r = positive(b?.perUsd, false);
    if (!/^[A-Z]{3}$/.test(currency) || r === null) return { ok: false, error: "Give a three-letter currency and its units per USD." };
    // Owner D4: the official rate with its actual publication date and source, monthly or as an exceptional update.
    // Never an estimate: a rate with no publication and no source is not accepted (412 checks it too).
    const updateKind = b?.updateKind === "exceptional" ? "exceptional" : "monthly";
    const publishedOn = typeof b?.publishedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.publishedOn) ? b.publishedOn : null;
    const sourceRef = typeof b?.sourceRef === "string" ? b.sourceRef.trim().slice(0, 500) : "";
    if (!publishedOn || publishedOn > new Date().toISOString().slice(0, 10)) return { ok: false, error: "Give the date the official rate was published (not in the future)." };
    if (sourceRef.length < 10) return { ok: false, error: "Give where the official rate was published (its URL)." };
    return { ok: true, row: { currency, per_usd: r, published_on: publishedOn, source_ref: sourceRef, update_kind: updateKind, note }, match: { currency } };
  }
  if (kind === "basis") {
    const currency = typeof b?.currency === "string" ? b.currency.trim().toUpperCase() : "";
    const u = positive(b?.currencyPerCau, false);
    if (!/^[A-Z]{3}$/.test(currency) || u === null) return { ok: false, error: "Give a three-letter currency and what one allowance unit is worth in it." };
    return { ok: true, row: { currency, currency_per_cau: u, note }, match: { currency } };
  }
  if (!(AI_PRODUCTS as readonly string[]).includes(b?.product)) return { ok: false, error: "Choose a product." };
  const activity = typeof b?.activity === "string" ? b.activity.trim() : "";
  if (!ACTIVITY_CODE.test(activity)) return { ok: false, error: "Give the activity code." };
  if (!["anthropic", "openai", "gemini"].includes(b?.provider)) return { ok: false, error: "Choose a provider." };
  const prefix = typeof b?.modelPrefix === "string" ? b.modelPrefix.trim() : "";
  if (!/^[a-z0-9][a-z0-9._-]{1,79}$/i.test(prefix)) return { ok: false, error: "Give the model id or its prefix." };
  const eligible = b?.eligible === true || b?.eligible === "true";
  const evidence = typeof b?.evidenceRef === "string" ? b.evidenceRef.trim().slice(0, 500) : "";
  // Eligibility rests on evaluation evidence, never on a price or a tier (owner D1).
  if (eligible && evidence.length < 5) return { ok: false, error: "A model is made eligible only with the evaluation evidence it rests on." };
  // An eligible decision names the highest clinical risk tier it covers (owner D1, migration 412).
  const maxRiskTier = (RISK_TIERS as readonly string[]).includes(b?.maxRiskTier) ? b.maxRiskTier : null;
  if (eligible && !maxRiskTier) return { ok: false, error: "Say the highest clinical risk tier the evaluation supports." };
  return { ok: true, row: { product: b.product, activity, provider: b.provider, model_prefix: prefix, eligible, evidence_ref: evidence || null, max_risk_tier: eligible ? maxRiskTier : null, note },
    match: { product: b.product, activity, provider: b.provider, model_prefix: prefix } };
}

/** End the open rate it replaces and add the new one from now. The old row keeps every request priced at it. */
export async function changeRate(admin: any, kind: RateKind, b: any, actorId: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const v = checkRate(kind, b);
  if (!v.ok) return v;
  const now = new Date().toISOString();
  let open = admin.from(TABLE[kind]).update({ effective_to: now }).is("effective_to", null);
  for (const [k, val] of Object.entries(v.match)) open = open.eq(k, val);
  const ended = await open;
  if (ended.error) return { ok: false, error: "The current rate could not be ended, so nothing changed." };
  const { data, error } = await admin.from(TABLE[kind]).insert({ ...v.row, effective_from: now, [ACTOR_COLUMN[kind]]: actorId }).select("id").single();
  return error ? { ok: false, error: "The new rate could not be saved. The previous one has been ended: add the rate again." } : { ok: true, id: data.id };
}

// ── Model evaluations (owner D5, migration 419): evidence for the reviewer, never a decision ─────────────────
export type EvalModelView = {
  provider: string; model: string; returned: string[]; passed: number; of: number; costUsd: number;
  proposed: string | null; rationale: string | null;
  items: { code: string; task: string; tier: string; status: string; score: number | null; passed: boolean; output: string | null; rubric: any }[];
};
export type EvalRunView = { id: string; label: string | null; version: string; createdAt: string; note: string | null; models: EvalModelView[] };

/** The latest evaluation runs with their results and proposals. Null: unreadable (or 419 not applied here). */
export async function loadEvaluations(admin: any, limit = 3): Promise<EvalRunView[] | null> {
  const runs = await rows(admin.from("ai_model_evaluation_run").select("id, label, eval_set_version, created_at, note").order("created_at", { ascending: false }).limit(limit));
  if (runs === null) return null;
  if (!runs.length) return [];
  const ids = runs.map((r: any) => r.id);
  const [results, proposals] = await Promise.all([
    rows(admin.from("ai_model_evaluation_result").select("run_id, item_code, task, risk_tier, provider, model_requested, model_returned, cost_usd, status, output, rubric, score, passed").in("run_id", ids).order("item_code")),
    rows(admin.from("ai_model_evaluation_proposal").select("run_id, provider, model_prefix, proposed_max_risk_tier, rationale").in("run_id", ids)),
  ]);
  if (results === null || proposals === null) return null;
  return runs.map((run: any) => {
    const rs = results.filter((r: any) => r.run_id === run.id);
    const models = [...new Set(rs.map((r: any) => `${r.provider}|${r.model_requested}`))] as string[];
    return { id: run.id, label: run.label, version: run.eval_set_version, createdAt: run.created_at, note: run.note, models: models.map(k => {
      const [provider, model] = k.split("|");
      const mine = rs.filter((r: any) => r.provider === provider && r.model_requested === model);
      const p = proposals.find((x: any) => x.run_id === run.id && x.provider === provider && x.model_prefix === model);
      return { provider, model, returned: [...new Set(mine.map((r: any) => r.model_returned).filter(Boolean))] as string[],
        passed: mine.filter((r: any) => r.passed).length, of: mine.length, costUsd: +mine.reduce((s: number, r: any) => s + Number(r.cost_usd ?? 0), 0).toFixed(6),
        proposed: p?.proposed_max_risk_tier ?? null, rationale: p?.rationale ?? null,
        items: mine.map((r: any) => ({ code: r.item_code, task: r.task, tier: r.risk_tier, status: r.status, score: r.score === null ? null : Number(r.score), passed: r.passed, output: r.output, rubric: r.rubric })) };
    }) };
  });
}

export type PolicyRow = { product: AiProduct; draft: ProductAiPolicy | null; published: ProductAiPolicy; publishedAt: string | null; pending: boolean };

/** Every product's published policy (what runs) and its draft, if one is saved. */
export async function loadPolicies(admin: any): Promise<PolicyRow[] | null> {
  const data = await rows(admin.from("workspace_config_overrides").select("config_path, draft, published, updated_at")
    .eq("scope_type", FAIR_USE_SCOPE.scopeType).eq("scope_ref", FAIR_USE_SCOPE.scopeRef));
  if (data === null) return null;
  return AI_PRODUCTS.map(product => {
    const r = data.find((x: any) => x.config_path === fairUsePath(product));
    return {
      product,
      published: resolvePolicy(product, r?.published ?? null, r?.published ? `${fairUsePath(product)}@${r.updated_at}` : "default-nothing-allowed"),
      draft: r?.draft ? resolvePolicy(product, r.draft, "draft") : null,
      publishedAt: r?.published ? r.updated_at : null,
      pending: !!r && JSON.stringify(r.draft ?? null) !== JSON.stringify(r.published ?? null),
    };
  });
}

/** Pure: the settings document to store, clamped exactly as the engine reads it. */
export function settingsFor(product: AiProduct, input: any): Record<string, unknown> {
  const p = resolvePolicy(product, input, "draft");
  return {
    includedCau: p.includedCau, reserveCau: p.reserveCau, windowMinutes: p.windowMinutes, windowCapCau: p.windowCapCau,
    levels: p.levels, reset: p.reset, messages: p.messages,
    currency: p.currency, fxBufferPct: p.fxBufferPct, maxUnreconciledCau: p.maxUnreconciledCau,
    activities: Object.fromEntries(Object.entries(p.activities).map(([k, a]) => [k, {
      label: a.label, class: a.class, tier: a.tier, minTier: a.minTier, maxOutputTokens: a.maxOutputTokens, capPerPeriod: a.capPerPeriod,
      riskFloor: a.riskFloor, reserveEligible: a.reserveEligible,
    }])),
    risk: { minTier: p.risk.minTier, rules: p.risk.rules },
  };
}

export const savePolicyDraft = (admin: any, actor: WceActor, product: AiProduct, input: any) =>
  setOverride(admin, actor, FAIR_USE_SCOPE, fairUsePath(product), settingsFor(product, input));

export const publishPolicies = (admin: any, actor: WceActor, note: string | null) =>
  publishScope(admin, actor, FAIR_USE_SCOPE, { label: "AI fair-use policies", note });

/** Every draft in the AI governance scope that differs from what is published: policies, profiles, budgets, routing. */
export async function pendingDrafts(admin: any): Promise<number | null> {
  const data = await rows(admin.from("workspace_config_overrides").select("draft, published").eq("scope_type", FAIR_USE_SCOPE.scopeType).eq("scope_ref", FAIR_USE_SCOPE.scopeRef));
  return data === null ? null : data.filter((r: any) => JSON.stringify(r.draft ?? null) !== JSON.stringify(r.published ?? null)).length;
}

// ── Budgets (COMPETEN-HOLDINGS-AI-CONSUMPTION-01 s6, migration 421) ──────────────────────────────────────────
//
// A budget's IDENTITY is an ai_budget row (owner type, product, and for an institution its institution and funding
// arrangement, which 421 requires). Its POLICY -- ceiling, funded activities, automated limit, alerts, carry-forward --
// is a CONFIG-002 document at ai.budget.<code>, drafted and published with the rest of the AI governance scope.

export type BudgetView = {
  id: string; code: string; label: string; ownerType: "platform" | "institution"; product: string; status: string;
  institutionRef: string | null; fundingRef: string | null; policy: BudgetPolicy; draft: BudgetPolicy | null;
  month: { included: number; used: number; reserved: number; pct: number | null } | null;
};
export type SpendReport = { byOwner: { ownerType: string; requests: number; costUsd: number; cau: number; unreconciled: number }[]; since: string };

export async function loadBudgets(admin: any): Promise<{ budgets: BudgetView[]; routing: Partial<Record<Workflow, string>>; routingDraft: Partial<Record<Workflow, string>> | null; report: SpendReport } | null> {
  const budgets = await rows(admin.from("ai_budget").select("*").order("code"));
  if (budgets === null) return null;
  const { start } = budgetPeriod(new Date());
  const [accounts, cfg, ledger] = await Promise.all([
    rows(admin.from("ai_allowance_account").select("budget_id, included_cau, used_cau, reserved_cau").not("budget_id", "is", null).eq("period_start", start.toISOString())),
    rows(admin.from("workspace_config_overrides").select("config_path, draft, published").eq("scope_type", FAIR_USE_SCOPE.scopeType).eq("scope_ref", FAIR_USE_SCOPE.scopeRef)),
    rows(admin.from("ai_usage_ledger").select("owner_type, status, cost_usd, settled_cau").gte("created_at", start.toISOString()).limit(20000)),
  ]);
  if (accounts === null || cfg === null || ledger === null) return null;
  const doc = (path: string) => cfg.find((r: any) => r.config_path === path);
  const byOwner = ["individual", "platform", "institution"].map(t => {
    const mine = ledger.filter((l: any) => l.owner_type === t);
    return { ownerType: t, requests: mine.length, costUsd: +mine.reduce((s: number, l: any) => s + Number(l.cost_usd ?? 0), 0).toFixed(6),
      cau: +mine.reduce((s: number, l: any) => s + Number(l.settled_cau ?? 0), 0).toFixed(6), unreconciled: mine.filter((l: any) => l.status === "unreconciled").length };
  });
  const routingRow = doc(ROUTING_PATH);
  return {
    budgets: budgets.map((b: any) => {
      const a = accounts.find((x: any) => x.budget_id === b.id);
      const row = doc(budgetPath(b.code));
      const included = a ? Number(a.included_cau) : 0;
      return { id: b.id, code: b.code, label: b.label, ownerType: b.owner_type, product: b.product, status: b.status, institutionRef: b.institution_ref, fundingRef: b.funding_ref,
        policy: resolveBudgetPolicy(row?.published ?? null), draft: row?.draft && JSON.stringify(row.draft) !== JSON.stringify(row.published) ? resolveBudgetPolicy(row.draft) : null,
        month: a ? { included, used: Number(a.used_cau), reserved: Number(a.reserved_cau), pct: included > 0 ? Math.round(((Number(a.used_cau) + Number(a.reserved_cau)) / included) * 100) : null } : null };
    }),
    routing: resolveRouting(routingRow?.published ?? null),
    routingDraft: routingRow?.draft ? resolveRouting(routingRow.draft) : null,
    report: { byOwner, since: start.toISOString() },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Create a budget. An institution budget needs its institution and the funding arrangement it rests on (421 too). */
export async function createBudget(admin: any, b: any, actorId: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const code = typeof b?.code === "string" ? b.code.trim() : "";
  if (!BUDGET_CODE.test(code)) return { ok: false, error: "Give a budget code: lower case, starting with a letter, 3 to 61 characters." };
  const ownerType = b?.ownerType === "institution" ? "institution" : b?.ownerType === "platform" ? "platform" : null;
  if (!ownerType) return { ok: false, error: "Choose platform or institution." };
  if (!(AI_PRODUCTS as readonly string[]).includes(b?.product)) return { ok: false, error: "Choose the product it funds." };
  const label = typeof b?.label === "string" ? b.label.trim().slice(0, 200) : "";
  if (label.length < 2) return { ok: false, error: "Name the budget." };
  const institutionRef = ownerType === "institution" && typeof b?.institutionRef === "string" && UUID.test(b.institutionRef) ? b.institutionRef : null;
  const fundingRef = ownerType === "institution" && typeof b?.fundingRef === "string" ? b.fundingRef.trim().slice(0, 300) : null;
  if (ownerType === "institution" && (!institutionRef || !fundingRef || fundingRef.length < 5))
    return { ok: false, error: "An institution budget needs the authorised institution and the funding arrangement it rests on." };
  const { data, error } = await admin.from("ai_budget").insert({ code, owner_type: ownerType, label, product: b.product, institution_ref: institutionRef, funding_ref: fundingRef,
    note: typeof b?.note === "string" ? b.note.trim().slice(0, 1000) || null : null, created_by: actorId }).select("id").single();
  return error ? { ok: false, error: /duplicate|unique/i.test(error.message) ? "That budget code is taken." : "The budget could not be created." } : { ok: true, id: data.id };
}

/** Suspend, resume or close a budget. Closing is final (421). Suspending stops its new charges, nothing else. */
export async function setBudgetStatus(admin: any, id: string, status: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!UUID.test(id) || !["active", "suspended", "closed"].includes(status as string)) return { ok: false, error: "Choose a budget and a status." };
  const { data, error } = await admin.from("ai_budget").update({ status }).eq("id", id).select("id");
  if (error) return { ok: false, error: /stays closed/i.test(error.message) ? "A closed budget stays closed." : "The budget could not be changed." };
  return data?.length ? { ok: true } : { ok: false, error: "No such budget." };
}

export const saveBudgetPolicyDraft = (admin: any, actor: WceActor, code: string, input: any) =>
  setOverride(admin, actor, FAIR_USE_SCOPE, budgetPath(code), resolveBudgetPolicy(input));
export const saveRoutingDraft = (admin: any, actor: WceActor, input: any) =>
  setOverride(admin, actor, FAIR_USE_SCOPE, ROUTING_PATH, { workflows: resolveRouting(input) });
