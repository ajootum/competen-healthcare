/* eslint-disable @typescript-eslint/no-explicit-any */
import { currencyExponent, majorToMinor } from "@/lib/commerce/gateway";
import { isExperienceKey, type ExperienceKey } from "./experiences";
import { INDIVIDUAL_AI_HOURLY_DEFAULT } from "./policy";

// ── COMPETEN INDIVIDUAL PLANS, AS DATA ── P1 Commercial, migrations 399 and 400 ──────────────────────────────
//
// A plan buys ONE experience for a number of days, at a price HQ sets. It is edited through
// /api/hq/individual/plans behind hq.individual.commercial.manage (held by the platform owners only until a
// separate owner GO grants it to a position), and every change is audited with what it was before.
//
// ⚠ PRICES ARE ENTERED IN MAJOR UNITS AND STORED IN MINOR ONES, through the gateway's own currency table, so a
// UGX plan (no minor unit) and a USD plan (cents) cannot be confused. A currency the table does not know is
// refused rather than guessed.
//
// ⚠ A CHANGE NEVER REACHES A CHECKOUT ALREADY STARTED: individual_checkout copies the price and the period.
// ⚠ NOTHING IS DELETED. A plan is retired by deactivating it, and its experience never changes (the composite
// keys in 399 refuse it), so every paid period keeps naming what was bought.

export type PlanInput = {
  planCode: string;
  experience: ExperienceKey;
  name: string;
  active: boolean;
  /** null: not priced (and so not purchasable). */
  price: { amountMinor: number; currency: string; intervalDays: number } | null;
  /** null: the plan sets no AI limit of its own, and the HQ policy base applies. */
  aiHourlyLimit: number | null;
};

type Refusal = { ok: false; status: number; code: string; message: string };
const refuse = (message: string, code = "VALIDATION_ERROR", status = 400): Refusal => ({ ok: false, status, code, message });

/** Pure: validate an HQ plan body. Mirrors every CHECK in migration 399, so HQ is told why before the database refuses. */
export function validatePlan(body: any): PlanInput | Refusal {
  const planCode = typeof body?.planCode === "string" ? body.planCode.trim() : "";
  if (!/^[a-z0-9_]{3,64}$/.test(planCode)) return refuse("The plan code is 3 to 64 lower-case letters, digits or underscores.");
  if (!isExperienceKey(body?.experience)) return refuse("A plan buys scholar or professional.");
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > 120) return refuse("The plan name is 1 to 120 characters.");
  const active = body?.active === true;

  let price: PlanInput["price"] = null;
  const hasPrice = body?.amount !== undefined && body?.amount !== null && body?.amount !== "";
  if (hasPrice) {
    const currency = typeof body?.currency === "string" ? body.currency.trim().toUpperCase() : "";
    if (!/^[A-Z]{3}$/.test(currency) || currencyExponent(currency) === null) return refuse("The currency is not one Competen can take payment in.");
    const amount = typeof body.amount === "number" ? body.amount : Number(body.amount);
    const amountMinor = Number.isFinite(amount) ? majorToMinor(amount, currency) : null;
    if (amountMinor === null || amountMinor <= 0) return refuse("The price must be more than zero, in the currency's own units.");
    // A price finer than the currency's smallest unit is refused, never silently rounded into another price.
    if (Math.abs(amount * 10 ** (currencyExponent(currency) ?? 0) - amountMinor) > 1e-6)
      return refuse(`A ${currency} price cannot be divided that finely.`);
    const intervalDays = Number(body?.intervalDays);
    if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 366) return refuse("The period is 1 to 366 days.");
    price = { amountMinor, currency, intervalDays };
  }
  if (active && !price) return refuse("A plan must be priced before it can be offered.", "PLAN_NOT_PRICED", 422);

  let aiHourlyLimit: number | null = null;
  if (body?.aiHourlyLimit !== undefined && body?.aiHourlyLimit !== null && body?.aiHourlyLimit !== "") {
    const n = Number(body.aiHourlyLimit);
    if (!Number.isInteger(n) || n < 1 || n > INDIVIDUAL_AI_HOURLY_DEFAULT)
      return refuse(`The AI limit is 1 to ${INDIVIDUAL_AI_HOURLY_DEFAULT} requests an hour -- the Individual hard limit.`);
    aiHourlyLimit = n;
  }
  return { planCode, experience: body.experience, name, active, price, aiHourlyLimit };
}

export const isPlanRefusal = (x: PlanInput | Refusal): x is Refusal => (x as any).ok === false;

export const PLAN_COLUMNS = "plan_code, experience_code, name, active, amount_minor, currency, interval_days, ai_hourly_limit, updated_at";

export async function listPlans(admin: any): Promise<{ ok: true; plans: any[] } | { ok: false }> {
  const { data, error } = await admin.from("individual_plan").select(PLAN_COLUMNS).order("experience_code").order("plan_code");
  return error ? { ok: false } : { ok: true, plans: data ?? [] };
}

/** Create or change one plan. Returns the row before (null when new) and after, for the audit trail. */
export async function savePlan(admin: any, p: PlanInput, actorId: string): Promise<{ ok: true; before: any | null; after: any } | Refusal> {
  const { data: before, error: rErr } = await admin.from("individual_plan").select(PLAN_COLUMNS).eq("plan_code", p.planCode).maybeSingle();
  if (rErr) return refuse("The plan could not be read.", "UNAVAILABLE", 503);
  if (before && before.experience_code !== p.experience)
    return refuse("A plan's experience cannot change -- paid periods name it. Retire this plan and create another.", "EXPERIENCE_FIXED", 409);

  const row = {
    plan_code: p.planCode, experience_code: p.experience, name: p.name, active: p.active,
    amount_minor: p.price?.amountMinor ?? null, currency: p.price?.currency ?? null, interval_days: p.price?.intervalDays ?? null,
    ai_hourly_limit: p.aiHourlyLimit, updated_at: new Date().toISOString(), updated_by: actorId,
  };
  const w = before
    ? await admin.from("individual_plan").update(row).eq("plan_code", p.planCode).select(PLAN_COLUMNS).single()
    : await admin.from("individual_plan").insert(row).select(PLAN_COLUMNS).single();
  if (w.error) {
    if (String(w.error.code) === "23505") return refuse("A plan with that code was created meanwhile. Look again.", "CHANGED", 409);
    if (String(w.error.code) === "23514") return refuse("The database refused the plan as inconsistent.", "VALIDATION_ERROR", 422);
    return refuse("The plan could not be saved.", "WRITE_FAILED", 503);
  }
  return { ok: true, before: before ?? null, after: w.data };
}
