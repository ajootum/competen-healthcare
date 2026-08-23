import { createHash, timingSafeEqual, randomUUID } from "node:crypto";

// Competen billing the PRACTITIONER (Flutterwave, mobile money first).
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE ONE RULE THIS FILE EXISTS TO ENFORCE: NOTHING THE GATEWAY SENDS US IS EVIDENCE OF PAYMENT.
//
// A webhook body is an unauthenticated HTTP request from the open internet. Anyone who learns the URL can
// POST {status: "successful"} at it. So payment is established by THREE independent checks, and a failure
// of any one of them means no subscription:
//
//   1. the verif-hash header matches our shared secret  (is this plausibly Flutterwave at all)
//   2. we ask Flutterwave's verify endpoint ourselves   (is the transaction real and successful)
//   3. the verified amount and currency match the row WE wrote before the practitioner left  (is it OURS,
//      for the right money -- a real, successful 500-shilling payment must not unlock a 74,000 plan)
//
// Check 3 is the one people skip. It is why practice_checkout is written up-front, and why `mismatched` is
// a status rather than an error: a verified payment for the wrong amount is not a failure to retry, it is
// a discrepancy a human has to look at.
//
// AND IDEMPOTENCY IS A DATABASE CONSTRAINT, NOT A CODE PATH. Gateways retry; retries are normal rather
// than exceptional. practice_checkout_event's unique (provider, provider_event_id) is what makes a second
// delivery a no-op. Deciding "have I seen this one?" in application code loses that race under concurrency,
// and the prize for losing it is a subscription extended twice.
//
// ⚠ MINOR UNITS. Flutterwave is paid in MAJOR units; we store MINOR. UGX has ISO exponent 0, so for the
// launch currency the conversion is the IDENTITY -- which is exactly how this repository's last units bug
// stayed invisible. MINOR_EXPONENT is therefore explicit per currency, an unknown currency is refused
// rather than assumed to be 2, and the tests exercise a two-decimal currency so the conversion is never a
// no-op in the one place it is checked.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const FLW_BASE = "https://api.flutterwave.com/v3";

/** ISO 4217 minor-unit exponents for the currencies this market settles in. */
const MINOR_EXPONENT: Record<string, number> = {
  UGX: 0, RWF: 0, XAF: 0, XOF: 0,          // no minor unit at all
  KES: 2, TZS: 2, NGN: 2, GHS: 2, ZAR: 2, ZMW: 2, USD: 2, EUR: 2, GBP: 2,
};

export function minorToMajor(amountMinor: number, currency: string): number | null {
  const exp = MINOR_EXPONENT[(currency ?? "").toUpperCase()];
  if (exp === undefined) return null;        // an unknown currency is refused, never guessed at 2
  return amountMinor / 10 ** exp;
}

export function majorToMinor(amountMajor: number, currency: string): number | null {
  const exp = MINOR_EXPONENT[(currency ?? "").toUpperCase()];
  if (exp === undefined) return null;
  return Math.round(amountMajor * 10 ** exp);
}

export type GatewayConfig = { secretKey: string; secretHash: string; siteUrl: string };

/** Configuration is ABSENT, not broken, when the keys are unset -- the app must still run without them. */
export function gatewayConfig(): GatewayConfig | null {
  const secretKey = process.env.FLW_SECRET_KEY;
  const secretHash = process.env.FLW_SECRET_HASH;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!secretKey || !secretHash || !siteUrl) return null;
  return { secretKey, secretHash, siteUrl };
}

/**
 * Constant-time comparison of the webhook's verif-hash against our secret.
 *
 * ⚠ BOTH SIDES ARE HASHED FIRST SO THE COMPARE IS LENGTH-SAFE. timingSafeEqual THROWS on unequal lengths,
 * and a throw is itself an oracle: an attacker learns the secret's length from which requests error rather
 * than deny. Hashing to a fixed 32 bytes removes that signal. `===` appears nowhere here, because string
 * comparison short-circuits on the first differing byte.
 */
export function verifHashMatches(header: string | null | undefined, secretHash: string): boolean {
  if (!header) return false;
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(secretHash).digest();
  return timingSafeEqual(a, b);
}

export const newTxRef = () => `cpr-${randomUUID()}`;

export type VerifiedTx =
  | { ok: true; providerTxId: string; txRef: string; amountMajor: number; currency: string; channel: string }
  | { ok: false; reason: string };

/**
 * Ask Flutterwave what actually happened. This is the only source of truth about a payment.
 * A network failure returns ok:false -- an UNVERIFIABLE transaction is never treated as paid.
 */
export async function verifyTransaction(cfg: GatewayConfig, providerTxId: string): Promise<VerifiedTx> {
  let res: Response;
  try {
    res = await fetch(`${FLW_BASE}/transactions/${encodeURIComponent(providerTxId)}/verify`, {
      headers: { Authorization: `Bearer ${cfg.secretKey}` },
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, reason: `verify unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok) return { ok: false, reason: `verify returned HTTP ${res.status}` };

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const body = (await res.json().catch(() => null)) as any;
  const d = body?.data;
  if (body?.status !== "success" || !d) return { ok: false, reason: "verify payload not successful" };
  // Flutterwave's own word for a completed charge. Anything else -- pending, failed -- is not payment.
  if (String(d.status).toLowerCase() !== "successful") return { ok: false, reason: `transaction status ${d.status}` };

  return {
    ok: true,
    providerTxId: String(d.id),
    txRef: String(d.tx_ref ?? ""),
    amountMajor: Number(d.amount),
    currency: String(d.currency ?? "").toUpperCase(),
    channel: normaliseChannel(String(d.payment_type ?? "")),
  };
}

/** Flutterwave's payment_type vocabulary mapped onto the practice_checkout.channel CHECK. */
export function normaliseChannel(paymentType: string): string {
  const p = (paymentType ?? "").toLowerCase();
  if (p.includes("mobilemoney") || p.includes("mpesa") || p.includes("mobile_money")) return "mobile_money";
  if (p.includes("card")) return "card";
  if (p.includes("bank") || p.includes("transfer") || p.includes("account")) return "bank_transfer";
  if (p.includes("ussd")) return "ussd";
  return "unknown";
}

/**
 * The payment options offered at checkout, by currency. MOBILE MONEY FIRST AND BY NAME: in these markets
 * card penetration among professionals is far from universal, and a card-only checkout silently halves
 * conversion -- a commercial failure that presents as a product failure.
 */
export function paymentOptionsFor(currency: string): string {
  switch ((currency ?? "").toUpperCase()) {
    case "UGX": return "mobilemoneyuganda,card,banktransfer";
    case "KES": return "mpesa,card,banktransfer";
    case "GHS": return "mobilemoneyghana,card,banktransfer";
    case "RWF": return "mobilemoneyrwanda,card";
    case "TZS": return "mobilemoneytanzania,card";
    case "ZMW": return "mobilemoneyzambia,card";
    default: return "card,banktransfer";
  }
}

export type CheckoutLink = { ok: true; link: string } | { ok: false; reason: string };

/** Hand Flutterwave the charge WE decided on, and get back a hosted checkout link. */
export async function createHostedCheckout(cfg: GatewayConfig, args: {
  txRef: string; amountMinor: number; currency: string; email: string; name: string | null;
}): Promise<CheckoutLink> {
  const amountMajor = minorToMajor(args.amountMinor, args.currency);
  if (amountMajor === null) return { ok: false, reason: `unsupported currency ${args.currency}` };

  let res: Response;
  try {
    res = await fetch(`${FLW_BASE}/payments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.secretKey}`, "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        tx_ref: args.txRef,
        amount: amountMajor,
        currency: args.currency.toUpperCase(),
        redirect_url: `${cfg.siteUrl.replace(/\/$/, "")}/practice/settings/billing/return`,
        payment_options: paymentOptionsFor(args.currency),
        customer: { email: args.email, name: args.name ?? undefined },
        customizations: { title: "Competen Practice", description: "Practice subscription" },
      }),
    });
  } catch (e) {
    return { ok: false, reason: `gateway unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const body = (await res.json().catch(() => null)) as any;
  if (!res.ok || body?.status !== "success" || !body?.data?.link) {
    // The gateway's message goes back to the CALLER for logging, never to the practitioner: it can echo
    // request detail, and a payment error is not a place to leak our own request shape.
    return { ok: false, reason: `gateway refused: ${body?.message ?? `HTTP ${res.status}`}` };
  }
  return { ok: true, link: String(body.data.link) };
}

/**
 * The exponent, exposed so the SCREEN formats money against the same table the CHARGE uses. Two money
 * formatters disagreeing major-vs-minor is the bug this repository has already paid for once; sharing the
 * table is what stops the button and the invoice drifting apart.
 */
export function currencyExponent(currency: string): number | null {
  const exp = MINOR_EXPONENT[(currency ?? "").toUpperCase()];
  return exp === undefined ? null : exp;
}
