/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHostedCheckout, newTxRefWith, type GatewayConfig } from "@/lib/commerce/gateway";
import { settleWebhook, type SettlementAdapter, type WebhookResult } from "@/lib/commerce/settlement";
import { EXPERIENCES, type ExperienceKey } from "./experiences";
import { individualAppEnabled } from "./gate";
import { INDIVIDUAL_AI_HOURLY_DEFAULT } from "./policy";

// ── COMPETEN INDIVIDUAL COMMERCE ── P1 Commercial, migration 399 ── ACTIVATION ON HOLD ─────────────────────
//
// A person pays for a period of Competen Scholar or Competen Professional. The payment code is the Holdings
// gateway and settlement engine (src/lib/commerce), the same three checks Competen Practice settles with.
// This file is only what an Individual payment MEANS: which plan, which experience, and the entitlement
// period it appends.
//
// ⚠ DARK BY DEFAULT, TWICE. Every entry point asks individualCommerceEnabled first: the Individual release
// gate (individual_app) AND its own flag, practice_platform_flags.flag = 'individual_commerce'. Neither row
// is written by any migration, so both are OFF, and an absent row, a failed read or a missing client is OFF.
// While it is off nothing here reads a migration-399 table -- main can carry this code before production
// has 399, which is exactly the state the four-state migration rule allows.
//
// ⚠ A PURCHASE APPENDS. It never edits a pilot grant or an earlier period: Scholar and Professional are
// bought, and lapse, independently, and a renewal starts where the live paid period ends.
//
// ⚠ D8 IS NOT RELAXED. A Scholar period needs an HQ adult-eligibility confirmation (370's CHECK). A purchase
// carries forward the confirmation HQ already recorded for this person, and a Scholar checkout is refused to
// anybody without one. Whether a buyer may attest their own age is an owner decision, not made here.

export const INDIVIDUAL_COMMERCE_FLAG = "individual_commerce";
/** Individual transaction references: `cin-<uuid>`. The shared webhook routes on this prefix. */
export const INDIVIDUAL_TX_PREFIX = "cin";
export const isIndividualTxRef = (ref: string | null | undefined) => typeof ref === "string" && ref.startsWith(`${INDIVIDUAL_TX_PREFIX}-`);

const DAY = 86400000;

/** True only when BOTH flags are on. Every other outcome is false, and it never throws. */
export async function individualCommerceEnabled(admin: any | null): Promise<boolean> {
  if (!admin || !(await individualAppEnabled(admin))) return false;
  try {
    const { data, error } = await admin.from("practice_platform_flags")
      .select("enabled").eq("flag", INDIVIDUAL_COMMERCE_FLAG).maybeSingle();
    if (error) return false;
    return data?.enabled === true;
  } catch {
    return false;
  }
}

/** The HQ adult-eligibility confirmation already recorded for this person, newest first, or null. */
async function adultConfirmation(admin: any, userId: string): Promise<{ at: string; by: string | null } | null | "unreadable"> {
  const { data, error } = await admin.from("individual_entitlement")
    .select("adult_confirmed_at, adult_confirmed_by")
    .eq("user_id", userId).eq("experience_code", "scholar").not("adult_confirmed_at", "is", null)
    .order("adult_confirmed_at", { ascending: false }).limit(1);
  if (error) return "unreadable";
  const row = (data ?? [])[0];
  return row ? { at: row.adult_confirmed_at, by: row.adult_confirmed_by ?? null } : null;
}

export type StartIndividualResult =
  | { ok: true; link: string; txRef: string }
  | { ok: false; status: number; code: "NOT_CONFIGURED" | "NO_SUCH_PLAN" | "MEMBERSHIP_NOT_ACTIVE" | "ADULT_CONFIRMATION_REQUIRED" | "GATEWAY_REFUSED" | "UNAVAILABLE"; message: string };

/**
 * Begin a checkout for one plan. Writes what WE intend to charge -- price and period copied from the plan --
 * BEFORE the payer is handed to the gateway, because that row is what the webhook checks the payment against.
 */
export async function startIndividualCheckout(admin: any, cfg: GatewayConfig | null, args: {
  userId: string; email: string; name: string | null; planCode: string;
}): Promise<StartIndividualResult> {
  if (!cfg) return { ok: false, status: 503, code: "NOT_CONFIGURED", message: "Payments are not configured on this environment." };

  const { data: plan, error: planErr } = await admin.from("individual_plan")
    .select("plan_code, experience_code, name, amount_minor, currency, interval_days, active")
    .eq("plan_code", args.planCode).eq("active", true).maybeSingle();
  // A plan we could not READ is not a plan that is absent.
  if (planErr) return { ok: false, status: 503, code: "UNAVAILABLE", message: "The plan could not be read." };
  // The schema makes an active plan priced (individual_plan_active_priced), so active is enough here.
  if (!plan) return { ok: false, status: 404, code: "NO_SUCH_PLAN", message: "That plan is not available." };

  const { data: membership, error: mErr } = await admin.from("individual_membership")
    .select("status").eq("user_id", args.userId).maybeSingle();
  if (mErr) return { ok: false, status: 503, code: "UNAVAILABLE", message: "Your Competen Individual membership could not be read." };
  // Paying cannot reinstate a suspended or revoked person -- that is an HQ act. Taking their money first and
  // then refusing the access would be worse than refusing now.
  if (membership && membership.status !== "active")
    return { ok: false, status: 409, code: "MEMBERSHIP_NOT_ACTIVE", message: `Your Competen Individual membership is ${membership.status}.` };

  if (plan.experience_code === "scholar") {
    const adult = await adultConfirmation(admin, args.userId);
    if (adult === "unreadable") return { ok: false, status: 503, code: "UNAVAILABLE", message: "Your eligibility could not be checked." };
    if (!adult) return { ok: false, status: 422, code: "ADULT_CONFIRMATION_REQUIRED", message: "Competen Scholar is for people aged 18 or over, and your eligibility has not been confirmed yet." };
  }

  const txRef = newTxRefWith(INDIVIDUAL_TX_PREFIX);
  const { data: row, error } = await admin.from("individual_checkout").insert({
    user_id: args.userId, plan_code: plan.plan_code, experience_code: plan.experience_code,
    amount_minor: plan.amount_minor, currency: plan.currency, interval_days: plan.interval_days,
    tx_ref: txRef, status: "pending",
  }).select("id").single();
  if (error) return { ok: false, status: 503, code: "UNAVAILABLE", message: "The checkout could not be started." };

  const experience = EXPERIENCES[plan.experience_code as ExperienceKey];
  const link = await createHostedCheckout(cfg, {
    txRef, amountMinor: plan.amount_minor, currency: plan.currency, email: args.email, name: args.name,
    redirectPath: "/individual/billing/return", title: experience?.name ?? "Competen", description: plan.name,
  });
  if (!link.ok) {
    await admin.from("individual_checkout").update({ status: "failed", failure_reason: link.reason.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", row.id);
    return { ok: false, status: 502, code: "GATEWAY_REFUSED", message: "The payment provider did not accept the checkout. Nothing was charged." };
  }

  await audit(admin, args.userId, "individual_checkout_started", row.id, {
    planCode: plan.plan_code, experience: plan.experience_code, amountMinor: plan.amount_minor, currency: plan.currency, txRef,
  });
  return { ok: true, link: link.link, txRef };
}

async function audit(admin: any, actorId: string | null, action: string, entityId: string | null, value: Record<string, unknown>) {
  await admin.from("audit_log").insert({
    actor_id: actorId, action, entity_type: "individual_checkout", entity_id: entityId, new_value: value,
  }).then((r: unknown) => r, () => {});
}

/** Apply one webhook delivery whose reference is an Individual one. The caller has checked verif-hash. */
export function applyIndividualWebhook(admin: any, cfg: GatewayConfig, ev: {
  providerEventId: string; providerTxId: string | null; txRef: string | null;
}): Promise<WebhookResult> {
  return settleWebhook(admin, cfg, ev, INDIVIDUAL_SETTLEMENT);
}

/** Pure: the period a payment buys. A renewal starts where the live paid period ends, never overlapping it. */
export function purchasedPeriod(now: Date, intervalDays: number, livePaidEndsAt: string | null) {
  const start = livePaidEndsAt ? new Date(livePaidEndsAt) : now;
  return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + intervalDays * DAY).toISOString() };
}

export const INDIVIDUAL_SETTLEMENT: SettlementAdapter = {
  eventTable: "individual_checkout_event",
  checkoutTable: "individual_checkout",
  checkoutColumns: "id, user_id, plan_code, experience_code, amount_minor, currency, interval_days, status",

  async onMismatched(admin, checkout, v, ref) {
    await audit(admin, checkout.user_id, "individual_checkout_mismatched", checkout.id, {
      txRef: ref, expectedMinor: checkout.amount_minor, expectedCurrency: checkout.currency, verifiedMajor: v.amountMajor, verifiedCurrency: v.currency,
    });
  },

  // ⚠ THE MONEY IS ALREADY TAKEN BY THIS POINT. Every failure below is recorded as paid-without-access, loudly
  // and by name, so HQ can grant what was bought -- never as a failed payment, and never swallowed.
  async onPaid(admin, checkout, v, ref, now) {
    const experience = checkout.experience_code as ExperienceKey;
    const withoutAccess = async (why: string) => {
      console.error(`[individual] paid checkout ${checkout.id} could not open an entitlement: ${why}`);
      await audit(admin, checkout.user_id, "individual_purchase_paid_without_access", checkout.id, { txRef: ref, planCode: checkout.plan_code, detail: why });
    };

    const { data: membership, error: mErr } = await admin.from("individual_membership")
      .select("status").eq("user_id", checkout.user_id).maybeSingle();
    if (mErr) return withoutAccess(`membership unreadable: ${mErr.message}`);
    if (membership && membership.status !== "active") return withoutAccess(`membership is ${membership.status}`);
    if (!membership) {
      const ins = await admin.from("individual_membership").insert({ user_id: checkout.user_id, status: "active", source: "purchase" });
      // A concurrent first purchase may have written it a moment ago -- that is the same membership.
      if (ins.error && !/duplicate|unique/i.test(ins.error.message)) return withoutAccess(`membership not written: ${ins.error.message}`);
    }

    let adult: { at: string; by: string | null } | null = null;
    if (experience === "scholar") {
      const a = await adultConfirmation(admin, checkout.user_id);
      if (a === "unreadable") return withoutAccess("adult confirmation unreadable");
      if (!a) return withoutAccess("no HQ adult confirmation on record (D8)");
      adult = a;
    }

    // Where the live PAID period of this experience ends, if one does -- the database clock decided it is live.
    const { data: livePaid, error: lErr } = await admin.from("individual_live_entitlement")
      .select("ends_at").eq("user_id", checkout.user_id).eq("experience_code", experience).eq("source", "payment")
      .not("ends_at", "is", null).order("ends_at", { ascending: false }).limit(1);
    if (lErr) return withoutAccess(`live entitlements unreadable: ${lErr.message}`);
    const period = purchasedPeriod(now, checkout.interval_days, (livePaid ?? [])[0]?.ends_at ?? null);

    const ins = await admin.from("individual_entitlement").insert({
      user_id: checkout.user_id, experience_code: experience, status: "active",
      starts_at: period.startsAt, ends_at: period.endsAt,
      // ADR-015 reasoning, 370's comment: the only source that carries billing authority.
      source: "payment", plan_code: checkout.plan_code, checkout_id: checkout.id,
      operating_entity: EXPERIENCES[experience].operatingEntity,
      ...(adult ? { adult_confirmed_at: adult.at, adult_confirmed_by: adult.by } : {}),
    });
    if (ins.error) return withoutAccess(`entitlement not written: ${ins.error.message}`);

    await audit(admin, checkout.user_id, "individual_purchase_paid", checkout.id, {
      txRef: ref, planCode: checkout.plan_code, experience, channel: v.channel, startsAt: period.startsAt, endsAt: period.endsAt,
    });
  },
};

// ── AI FAIR USE PER PLAN ── CONFIG-002 ai_hourly_limit, extended ───────────────────────────────────────────
//
// A paid plan may set its own hourly AI limit. While the person holds a live PAID period of a plan that sets
// one, that limit replaces the HQ policy base -- the most generous of their live plans, because the AI count
// is one per person -- clamped to the Individual hard limit, and the estate limit still applies on top.
// Nobody else is affected: pilot holders keep the policy limit.
//
// ⚠ FAILS CLOSED WHEN ON, AND IS INVISIBLE WHEN OFF. With commerce off this reads nothing and says "off", so
// AI behaves exactly as before and does not depend on migration 399. With commerce on, a plan that could not
// be read is `unreadable`, which individualAiQuota refuses like an unreadable count.

export type PlanAiLimit = { state: "off" } | { state: "none" } | { state: "limit"; limit: number } | { state: "unreadable" };

/** Pure: the limit live paid plans give, from their ai_hourly_limit values (null = the plan sets none). */
export function planLimitFrom(limits: readonly (number | null)[]): PlanAiLimit {
  const set = limits.filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x > 0);
  if (!set.length) return { state: "none" };
  return { state: "limit", limit: Math.min(INDIVIDUAL_AI_HOURLY_DEFAULT, Math.max(1, Math.floor(Math.max(...set)))) };
}

export async function individualPlanAiLimit(admin: any, userId: string): Promise<PlanAiLimit> {
  if (!(await individualCommerceEnabled(admin))) return { state: "off" };
  try {
    const { data: live, error } = await admin.from("individual_live_entitlement")
      .select("plan_code").eq("user_id", userId).eq("source", "payment").limit(20);
    if (error) return { state: "unreadable" };
    const codes = [...new Set(((live ?? []) as any[]).map(r => r.plan_code).filter(Boolean))];
    if (!codes.length) return { state: "none" };
    const { data: plans, error: pErr } = await admin.from("individual_plan").select("ai_hourly_limit").in("plan_code", codes);
    if (pErr) return { state: "unreadable" };
    return planLimitFrom(((plans ?? []) as any[]).map(p => p.ai_hourly_limit ?? null));
  } catch {
    return { state: "unreadable" };
  }
}
