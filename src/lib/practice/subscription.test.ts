import { describe, it, expect, vi, afterEach } from "vitest";
import { minorToMajor, majorToMinor, verifHashMatches, normaliseChannel, paymentOptionsFor } from "@/lib/practice/subscription-gateway";
import { applyWebhook } from "@/lib/practice/subscription";

// The payment path. Three properties are worth more than the rest of this file put together:
//
//   1. a webhook that cannot be VERIFIED grants nothing
//   2. a verified payment for the WRONG AMOUNT grants nothing
//   3. the same delivery twice grants ONCE
//
// Each is asserted on the GRANT, not on the returned verdict -- a function can return "mismatched" and
// still have written a subscription, and it is the subscription that is the money.

/* eslint-disable @typescript-eslint/no-explicit-any */

const CFG = { secretKey: "sk_test", secretHash: "whsec_correct", siteUrl: "https://example.test" };
const CHECKOUT = {
  id: "co-1", workspace_id: "ws-1", plan_code: "practice_solo_ugx",
  amount_minor: 74000, currency: "UGX", status: "pending",
};

/** Records every write so the tests can assert on what was GRANTED rather than what was returned. */
function stubAdmin(opts: { claimFails?: boolean; checkout?: any | null } = {}) {
  const writes: { table: string; op: string; row: any }[] = [];
  const admin = {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        maybeSingle: async () =>
          table === "practice_checkout"
            ? { data: opts.checkout === undefined ? CHECKOUT : opts.checkout, error: null }
            : { data: null, error: null },
        single: async () =>
          opts.claimFails
            ? { data: null, error: { message: "duplicate key value violates unique constraint" } }
            : { data: { id: "ev-1" }, error: null },
        insert: (row: any) => { writes.push({ table, op: "insert", row }); return chain; },
        update: (row: any) => { writes.push({ table, op: "update", row }); return chain; },
        upsert: (row: any) => { writes.push({ table, op: "upsert", row }); return chain; },
        then: (res: any) => res({ error: null }),
      };
      return chain;
    },
  };
  const granted = () => writes.filter(w =>
    (w.table === "practice_subscription" && w.op === "upsert") ||
    (w.table === "practice_entitlement" && w.op === "update" && w.row.status === "active"));
  return { admin, writes, granted };
}

const flwVerify = (body: unknown, ok = true) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body } as any);

afterEach(() => vi.restoreAllMocks());

describe("units — the conversion that hid the last bug", () => {
  it("UGX has exponent 0, so minor IS major and the conversion is the identity", () => {
    expect(minorToMajor(74000, "UGX")).toBe(74000);
    expect(majorToMinor(74000, "UGX")).toBe(74000);
  });

  it("KES has exponent 2, so the conversion is NOT a no-op — the control the UGX case cannot provide", () => {
    expect(minorToMajor(260000, "KES")).toBe(2600);
    expect(majorToMinor(2600, "KES")).toBe(260000);
  });

  it("REFUSES an unknown currency rather than assuming two decimals", () => {
    expect(minorToMajor(1000, "ZZZ")).toBeNull();
    expect(majorToMinor(10, "")).toBeNull();
  });
});

describe("verif-hash", () => {
  it("rejects a wrong, absent or empty signature", () => {
    expect(verifHashMatches("whsec_wrong", CFG.secretHash)).toBe(false);
    expect(verifHashMatches(null, CFG.secretHash)).toBe(false);
    expect(verifHashMatches("", CFG.secretHash)).toBe(false);
  });

  it("accepts the right one, and does not throw on a length mismatch", () => {
    expect(verifHashMatches("whsec_correct", CFG.secretHash)).toBe(true);
    // A throw here would be a length oracle. The hash-first compare is what prevents it.
    expect(() => verifHashMatches("x", CFG.secretHash)).not.toThrow();
  });
});

describe("mobile money is offered first", () => {
  it("names the local rail per currency, not just card", () => {
    expect(paymentOptionsFor("UGX")).toMatch(/^mobilemoneyuganda/);
    expect(paymentOptionsFor("KES")).toMatch(/^mpesa/);
    expect(normaliseChannel("mobilemoneyuganda")).toBe("mobile_money");
    expect(normaliseChannel("mpesa")).toBe("mobile_money");
  });
});

describe("applyWebhook — what actually grants access", () => {
  it("GRANTS NOTHING when the gateway cannot verify the transaction", async () => {
    const { admin, granted } = stubAdmin();
    flwVerify(null, false);

    const r = await applyWebhook(admin, CFG, { providerEventId: "e1", providerTxId: "tx1", txRef: "cpr-1" });

    expect(r.verdict).toBe("unverified");
    expect(granted()).toHaveLength(0);          // <- the assertion that matters
  });

  it("GRANTS NOTHING when the transaction verifies but is not successful", async () => {
    const { admin, granted } = stubAdmin();
    flwVerify({ status: "success", data: { id: "tx1", status: "pending", amount: 74000, currency: "UGX", tx_ref: "cpr-1" } });

    const r = await applyWebhook(admin, CFG, { providerEventId: "e1", providerTxId: "tx1", txRef: "cpr-1" });

    expect(r.verdict).toBe("not_successful");
    expect(granted()).toHaveLength(0);
  });

  it("GRANTS NOTHING for a real, successful payment of the WRONG AMOUNT", async () => {
    const { admin, granted, writes } = stubAdmin();
    // 500 shillings, genuinely paid, against a 74,000 plan.
    flwVerify({ status: "success", data: { id: "tx1", status: "successful", amount: 500, currency: "UGX", tx_ref: "cpr-1" } });

    const r = await applyWebhook(admin, CFG, { providerEventId: "e1", providerTxId: "tx1", txRef: "cpr-1" });

    expect(r.verdict).toBe("mismatched");
    expect(granted()).toHaveLength(0);
    // and it is recorded as a discrepancy rather than a retryable failure
    expect(writes.some(w => w.table === "practice_checkout" && w.row.status === "mismatched")).toBe(true);
  });

  it("GRANTS NOTHING for the right amount in the WRONG CURRENCY", async () => {
    const { admin, granted } = stubAdmin();
    flwVerify({ status: "success", data: { id: "tx1", status: "successful", amount: 74000, currency: "KES", tx_ref: "cpr-1" } });

    const r = await applyWebhook(admin, CFG, { providerEventId: "e1", providerTxId: "tx1", txRef: "cpr-1" });

    expect(r.verdict).toBe("mismatched");
    expect(granted()).toHaveLength(0);
  });

  it("GRANTS NOTHING when no checkout of ours matches the reference", async () => {
    const { admin, granted } = stubAdmin({ checkout: null });
    flwVerify({ status: "success", data: { id: "tx1", status: "successful", amount: 74000, currency: "UGX", tx_ref: "cpr-unknown" } });

    const r = await applyWebhook(admin, CFG, { providerEventId: "e1", providerTxId: "tx1", txRef: "cpr-unknown" });

    expect(r.verdict).toBe("unknown_ref");
    expect(granted()).toHaveLength(0);
  });

  it("GRANTS NOTHING on a repeat delivery — the unique constraint refuses the claim", async () => {
    const { admin, granted } = stubAdmin({ claimFails: true });
    const fetchSpy = flwVerify({ status: "success", data: { id: "tx1", status: "successful", amount: 74000, currency: "UGX", tx_ref: "cpr-1" } });

    const r = await applyWebhook(admin, CFG, { providerEventId: "e1", providerTxId: "tx1", txRef: "cpr-1" });

    expect(r.verdict).toBe("duplicate");
    expect(granted()).toHaveLength(0);
    // It never even ASKED the gateway: claiming first is what makes the retry cheap and race-safe.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("GRANTS on a verified payment of the right amount, and extends both stores", async () => {
    const { admin, granted, writes } = stubAdmin();
    flwVerify({ status: "success", data: { id: "tx1", status: "successful", amount: 74000, currency: "UGX", tx_ref: "cpr-1", payment_type: "mobilemoneyuganda" } });

    const r = await applyWebhook(admin, CFG, { providerEventId: "e1", providerTxId: "tx1", txRef: "cpr-1" });

    expect(r.verdict).toBe("applied");
    expect(granted()).toHaveLength(2);   // subscription upsert + entitlement activation
    const sub = writes.find(w => w.table === "practice_subscription")!;
    expect(sub.row).toMatchObject({ workspace_id: "ws-1", plan_code: "practice_solo_ugx", status: "active" });
    expect(writes.some(w => w.table === "practice_checkout" && w.row.status === "paid" && w.row.channel === "mobile_money")).toBe(true);
    // Without this control every "grants nothing" above could pass for the wrong reason.
  });

  it("does not pay a checkout twice even under a different event id", async () => {
    const { admin, granted } = stubAdmin({ checkout: { ...CHECKOUT, status: "paid" } });
    flwVerify({ status: "success", data: { id: "tx1", status: "successful", amount: 74000, currency: "UGX", tx_ref: "cpr-1" } });

    const r = await applyWebhook(admin, CFG, { providerEventId: "e2-different", providerTxId: "tx1", txRef: "cpr-1" });

    expect(r.verdict).toBe("duplicate");
    expect(granted()).toHaveLength(0);
  });
});
