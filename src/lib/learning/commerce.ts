/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHostedCheckout, newTxRefWith, type GatewayConfig } from "@/lib/commerce/gateway";
import { settleWebhook, type SettlementAdapter, type WebhookResult } from "@/lib/commerce/settlement";

// ── COURSE ACCESS ON THE HOLDINGS COMMERCIAL ENGINE ── COMPETEN-LEARNING-01 S3, migration 463, owner D2 option E2 ──────
//
// A person buys access to ONE course. The checkout row is individual_checkout (item_kind course), the delivery log is
// individual_checkout_event, and settlement is the Holdings engine's three checks (src/lib/commerce/settlement.ts):
// verif-hash at the route, verifyTransaction with Flutterwave, and the verified money against the row WE wrote. This
// file is only what a course payment MEANS: the approved price it copied, and the course entitlement it appends.
//
// ⚠ ITS OWN REFERENCE PREFIX, `lrn-`, AND ITS OWN ADAPTER. The Individual experience adapter (src/lib/individual/
// commerce.ts) is untouched and never sees a course checkout: the shared webhook routes `lrn-` here only while
// learning_commerce is on. A forged prefix finds no checkout and pays nothing, as for `cin-`.
//
// ⚠ NO SUBSCRIPTION, AND NO NEW MEMBERS. A course needs no Scholar or Professional period. But public purchase
// registration stays OFF (owner D5): a buyer must already be an active Competen Individual member (an HQ
// invitation), at checkout and again at settlement. Settlement never creates a membership.
//
// ⚠ IDEMPOTENT TWICE OVER. The event table's unique (provider, provider_event_id) stops a second delivery, and 463's
// unique checkout_id on individual_course_entitlement stops a second entitlement from the same checkout.
//
// ⚠ NO REAL CHARGING IS AUTHORISED. Staging uses Flutterwave TEST keys only. Both flags are absent in production.

export const LEARNING_TX_PREFIX = "lrn";
export const isLearningTxRef = (ref: string | null | undefined) => typeof ref === "string" && ref.startsWith(`${LEARNING_TX_PREFIX}-`);
const DAY = 86400000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StartCourseResult =
  | { ok: true; link: string; txRef: string }
  | { ok: false; status: number; code: "NOT_CONFIGURED" | "NO_SUCH_PRICE" | "NOT_OFFERED" | "MEMBERSHIP_REQUIRED" | "ALREADY_ENTITLED" | "GATEWAY_REFUSED" | "UNAVAILABLE"; message: string };

/**
 * Begin a checkout for one approved course price. Writes what WE intend to charge -- the price, its access period, its
 * terms and operating entity, copied exactly (463 refuses anything else) -- BEFORE the payer is handed to the gateway.
 */
export async function startCourseCheckout(admin: any, cfg: GatewayConfig | null, a: { userId: string; email: string; name: string | null; priceId: string }): Promise<StartCourseResult> {
  if (!cfg) return { ok: false, status: 503, code: "NOT_CONFIGURED", message: "Payments are not configured on this environment." };
  if (!UUID.test(a.priceId)) return { ok: false, status: 404, code: "NO_SUCH_PRICE", message: "That price is not available." };
  const { data: p, error: pErr } = await admin.from("learning_offering_price").select("id, offering_id, currency, amount_minor, access_days, terms_version, operating_entity, state").eq("id", a.priceId).maybeSingle();
  if (pErr) return { ok: false, status: 503, code: "UNAVAILABLE", message: "The price could not be read." };
  if (!p || p.state !== "approved") return { ok: false, status: 404, code: "NO_SUCH_PRICE", message: "That price is not available." };
  const { data: vs } = await admin.from("learning_offering_version").select("id, learning_offering!inner(title, status, delivery)").eq("offering_id", p.offering_id).eq("state", "published").limit(1);
  const v = (vs ?? [])[0];
  const { data: deliverable } = v ? await admin.rpc("learning_offering_deliverable", { p_version: v.id }) : { data: false };
  if (!v || deliverable !== true || v.learning_offering.delivery !== "hosted") return { ok: false, status: 409, code: "NOT_OFFERED", message: "That course is not offered just now. Nothing was charged." };

  const { data: m, error: mErr } = await admin.from("individual_membership").select("status").eq("user_id", a.userId).maybeSingle();
  if (mErr) return { ok: false, status: 503, code: "UNAVAILABLE", message: "Your Competen Individual membership could not be read." };
  if (!m || m.status !== "active") return { ok: false, status: 403, code: "MEMBERSHIP_REQUIRED", message: "Competen Learning is open by invitation during the pilot. Your Competen Individual membership is not active." };

  const { data: live, error: lErr } = await admin.from("individual_live_course_entitlement").select("id, ends_at").eq("user_id", a.userId).eq("offering_id", p.offering_id).limit(5);
  if (lErr) return { ok: false, status: 503, code: "UNAVAILABLE", message: "Your access could not be checked." };
  if ((live ?? []).some((e: any) => e.ends_at === null)) return { ok: false, status: 409, code: "ALREADY_ENTITLED", message: "You already have access to this course." };

  const txRef = newTxRefWith(LEARNING_TX_PREFIX);
  const { data: row, error } = await admin.from("individual_checkout").insert({
    user_id: a.userId, item_kind: "course", offering_id: p.offering_id, offering_price_id: p.id,
    amount_minor: p.amount_minor, currency: p.currency, interval_days: p.access_days, terms_version: p.terms_version, operating_entity: p.operating_entity,
    tx_ref: txRef, status: "pending",
  }).select("id").single();
  if (error) return { ok: false, status: 503, code: "UNAVAILABLE", message: "The checkout could not be started." };

  const link = await createHostedCheckout(cfg, {
    txRef, amountMinor: Number(p.amount_minor), currency: p.currency, email: a.email, name: a.name,
    redirectPath: "/individual/learning/return", title: "Competen Learning", description: v.learning_offering.title,
  });
  if (!link.ok) {
    await admin.from("individual_checkout").update({ status: "failed", failure_reason: link.reason.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", row.id);
    return { ok: false, status: 502, code: "GATEWAY_REFUSED", message: "The payment provider did not accept the checkout. Nothing was charged." };
  }
  await audit(admin, a.userId, "learning_checkout_started", row.id, { offeringId: p.offering_id, priceId: p.id, amountMinor: p.amount_minor, currency: p.currency, accessDays: p.access_days, termsVersion: p.terms_version, txRef });
  return { ok: true, link: link.link, txRef };
}

async function audit(admin: any, actorId: string | null, action: string, entityId: string | null, value: Record<string, unknown>) {
  await admin.from("audit_log").insert({ actor_id: actorId, action, entity_type: "individual_checkout", entity_id: entityId, new_value: value }).then((r: unknown) => r, () => {});
}

/** Pure: the access period a paid course checkout buys. It starts where a live paid period of the course ends. */
export function coursePeriod(now: Date, accessDays: number | null, livePaidEndsAt: string | null): { startsAt: string; endsAt: string | null } {
  const start = livePaidEndsAt && Date.parse(livePaidEndsAt) > now.getTime() ? new Date(livePaidEndsAt) : now;
  return { startsAt: start.toISOString(), endsAt: accessDays === null ? null : new Date(start.getTime() + accessDays * DAY).toISOString() };
}

export const LEARNING_SETTLEMENT: SettlementAdapter = {
  eventTable: "individual_checkout_event",
  checkoutTable: "individual_checkout",
  checkoutColumns: "id, user_id, item_kind, offering_id, offering_price_id, amount_minor, currency, interval_days, terms_version, operating_entity, status",

  async onMismatched(admin, checkout, v, ref) {
    await audit(admin, checkout.user_id, "learning_checkout_mismatched", checkout.id, { txRef: ref, expectedMinor: checkout.amount_minor, expectedCurrency: checkout.currency, verifiedMajor: v.amountMajor, verifiedCurrency: v.currency });
  },

  // ⚠ THE MONEY IS ALREADY TAKEN BY THIS POINT. Every failure is recorded loudly as paid-without-access, so HQ can
  // grant what was bought -- never as a failed payment, and never swallowed.
  async onPaid(admin, checkout, v, ref, now) {
    const withoutAccess = async (why: string) => {
      console.error(`[learning] paid checkout ${checkout.id} could not open a course entitlement: ${why}`);
      await audit(admin, checkout.user_id, "learning_purchase_paid_without_access", checkout.id, { txRef: ref, offeringId: checkout.offering_id, detail: why });
    };
    if (checkout.item_kind !== "course") return withoutAccess("not a course checkout");
    const { data: m, error: mErr } = await admin.from("individual_membership").select("status").eq("user_id", checkout.user_id).maybeSingle();
    if (mErr) return withoutAccess(`membership unreadable: ${mErr.message}`);
    if (!m || m.status !== "active") return withoutAccess(`membership is ${m?.status ?? "absent"} (purchase registration is off, D5)`);
    const { data: livePaid, error: lErr } = await admin.from("individual_live_course_entitlement").select("ends_at").eq("user_id", checkout.user_id).eq("offering_id", checkout.offering_id)
      .eq("source", "payment").not("ends_at", "is", null).order("ends_at", { ascending: false }).limit(1);
    if (lErr) return withoutAccess(`live course entitlements unreadable: ${lErr.message}`);
    const period = coursePeriod(now, checkout.interval_days ?? null, (livePaid ?? [])[0]?.ends_at ?? null);
    const ins = await admin.from("individual_course_entitlement").insert({
      user_id: checkout.user_id, offering_id: checkout.offering_id, price_id: checkout.offering_price_id, checkout_id: checkout.id, source: "payment", status: "active",
      starts_at: period.startsAt, ends_at: period.endsAt, terms_version: checkout.terms_version, operating_entity: checkout.operating_entity,
    });
    if (ins.error) {
      if (/duplicate|unique/i.test(ins.error.message)) return; // this checkout already opened its entitlement
      return withoutAccess(`entitlement not written: ${ins.error.message}`);
    }
    await audit(admin, checkout.user_id, "learning_purchase_paid", checkout.id, { txRef: ref, offeringId: checkout.offering_id, priceId: checkout.offering_price_id, channel: v.channel, startsAt: period.startsAt, endsAt: period.endsAt });
  },
};

/** Apply one webhook delivery whose reference is a course one. The caller has checked verif-hash. */
export function applyLearningWebhook(admin: any, cfg: GatewayConfig, ev: { providerEventId: string; providerTxId: string | null; txRef: string | null }): Promise<WebhookResult> {
  return settleWebhook(admin, cfg, ev, LEARNING_SETTLEMENT);
}

/** An HQ course grant (D5 pilot access, or a sponsored learner): an entitlement with no payment, named and audited. */
export async function grantCourseAccess(admin: any, grantedBy: string, a: { userId: string; offeringId: string; days: number | null; note: string }): Promise<{ ok: true; entitlementId: string } | { ok: false; error: string }> {
  if (!UUID.test(a.userId) || !UUID.test(a.offeringId)) return { ok: false, error: "Choose a person and a course." };
  if (a.days !== null && !(Number.isInteger(a.days) && a.days >= 1 && a.days <= 3660)) return { ok: false, error: "Access is 1 to 3660 days, or blank for as long as the terms allow." };
  const note = (a.note ?? "").trim();
  if (note.length < 3 || note.length > 500) return { ok: false, error: "Say why access is granted." };
  const { data: m } = await admin.from("individual_membership").select("status").eq("user_id", a.userId).maybeSingle();
  if (!m || m.status !== "active") return { ok: false, error: "That person is not an active Competen Individual member. Invite them first." };
  const p = coursePeriod(new Date(), a.days, null);
  const { data, error } = await admin.from("individual_course_entitlement").insert({ user_id: a.userId, offering_id: a.offeringId, source: "hq_grant", status: "active", starts_at: p.startsAt, ends_at: p.endsAt, granted_by: grantedBy, note }).select("id").single();
  return error ? { ok: false, error: "Access could not be granted just now." } : { ok: true, entitlementId: data.id };
}
