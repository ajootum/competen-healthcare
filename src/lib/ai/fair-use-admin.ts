/* eslint-disable @typescript-eslint/no-explicit-any */
import { publishScope, setOverride, type WceActor } from "@/lib/config/workspace-config-write";
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
    return { ok: true, row: { currency, per_usd: r, note }, match: { currency } };
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
  return { ok: true, row: { product: b.product, activity, provider: b.provider, model_prefix: prefix, eligible, evidence_ref: evidence || null, note },
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
      clinicallySensitive: a.clinicallySensitive, reserveEligible: a.reserveEligible,
    }])),
  };
}

export const savePolicyDraft = (admin: any, actor: WceActor, product: AiProduct, input: any) =>
  setOverride(admin, actor, FAIR_USE_SCOPE, fairUsePath(product), settingsFor(product, input));

export const publishPolicies = (admin: any, actor: WceActor, note: string | null) =>
  publishScope(admin, actor, FAIR_USE_SCOPE, { label: "AI fair-use policies", note });
