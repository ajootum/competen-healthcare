/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  INDIVIDUAL_SETTLEMENT, applyIndividualWebhook, individualCommerceEnabled, individualPlanAiLimit, isIndividualTxRef,
  planLimitFrom, purchasedPeriod, startIndividualCheckout,
} from "@/lib/individual/commerce";
import { INDIVIDUAL_AI_HOURLY_DEFAULT, individualAiQuota, DEFAULT_POLICY } from "@/lib/individual/policy";

// P1 Commercial: what an Individual payment MEANS. The three checks themselves are the Holdings engine's,
// proven by the Practice suite (src/lib/practice/subscription.test.ts) through the same code.

type Q = { table: string; op: "select" | "insert" | "update" | "upsert" | "delete"; row?: any; filters: [string, string, unknown][] };

/** A query-builder fake: every chain resolves through `answer`, and every write is recorded. */
function fakeAdmin(answer: (q: Q) => { data?: any; error?: any }) {
  const writes: Q[] = [];
  const from = (table: string) => {
    const q: Q = { table, op: "select", filters: [] };
    const run = () => { if (q.op !== "select") writes.push(q); const r = answer(q); return { data: r.data ?? null, error: r.error ?? null }; };
    const b: any = {
      select: () => b, order: () => b, limit: () => b,
      eq: (c: string, v: unknown) => { q.filters.push(["eq", c, v]); return b; },
      not: (c: string, o: string, v: unknown) => { q.filters.push(["not", c, v]); return b; },
      in: (c: string, v: unknown) => { q.filters.push(["in", c, v]); return b; },
      insert: (row: any) => { q.op = "insert"; q.row = row; return b; },
      update: (row: any) => { q.op = "update"; q.row = row; return b; },
      maybeSingle: async () => run(), single: async () => run(),
      then: (ok: any, ko: any) => Promise.resolve(run()).then(ok, ko),
    };
    return b;
  };
  return { admin: { from }, writes };
}
const has = (q: Q, col: string, v: unknown) => q.filters.some(([, c, x]) => c === col && x === v);

const flags = (app: boolean, commerce: boolean) => (q: Q) =>
  q.table === "practice_platform_flags" ? { data: { enabled: has(q, "flag", "individual_app") ? app : commerce } } : null;

const CFG = { secretKey: "sk", secretHash: "whsec_correct", siteUrl: "https://example.test" };
afterEach(() => vi.restoreAllMocks());

describe("the gate -- dark unless BOTH flags are on", () => {
  it("is off with no client, with either flag off, or when the flag read fails", async () => {
    expect(await individualCommerceEnabled(null)).toBe(false);
    expect(await individualCommerceEnabled(fakeAdmin(q => flags(true, false)(q) ?? {}).admin)).toBe(false);
    expect(await individualCommerceEnabled(fakeAdmin(q => flags(false, true)(q) ?? {}).admin)).toBe(false);
    expect(await individualCommerceEnabled(fakeAdmin(() => ({ error: { message: "boom" } })).admin)).toBe(false);
  });
  it("is on only when both rows are enabled", async () => {
    expect(await individualCommerceEnabled(fakeAdmin(q => flags(true, true)(q) ?? {}).admin)).toBe(true);
  });
});

describe("references and periods", () => {
  it("routes only cin- references to Individual", () => {
    expect(isIndividualTxRef("cin-abc")).toBe(true);
    expect(isIndividualTxRef("cpr-abc")).toBe(false);
    expect(isIndividualTxRef(null)).toBe(false);
  });
  it("a first purchase starts now; a renewal starts where the live paid period ends", () => {
    const now = new Date("2026-10-24T10:00:00.000Z");
    expect(purchasedPeriod(now, 30, null)).toEqual({ startsAt: "2026-10-24T10:00:00.000Z", endsAt: "2026-11-23T10:00:00.000Z" });
    expect(purchasedPeriod(now, 30, "2026-11-01T00:00:00.000Z"))
      .toEqual({ startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-12-01T00:00:00.000Z" });
  });
});

describe("AI fair use per plan", () => {
  it("takes the most generous live plan, clamped to the Individual hard limit", () => {
    expect(planLimitFrom([])).toEqual({ state: "none" });
    expect(planLimitFrom([null, null])).toEqual({ state: "none" });
    expect(planLimitFrom([5, 12, null])).toEqual({ state: "limit", limit: 12 });
    expect(planLimitFrom([10_000])).toEqual({ state: "limit", limit: INDIVIDUAL_AI_HOURLY_DEFAULT });
  });
  it("off and none leave the policy limit exactly as before", () => {
    const estate = { ok: true, used: 3, limit: 100 };
    const base = individualAiQuota(estate, DEFAULT_POLICY);
    expect(individualAiQuota(estate, DEFAULT_POLICY, { state: "off" })).toEqual(base);
    expect(individualAiQuota(estate, DEFAULT_POLICY, { state: "none" })).toEqual(base);
  });
  it("a plan limit replaces the policy base, and the estate limit still wins when tighter", () => {
    const policy = { ...DEFAULT_POLICY, aiHourlyLimit: 10 };
    expect(individualAiQuota({ ok: true, used: 12, limit: 100 }, policy, { state: "limit", limit: 20 })).toMatchObject({ ok: true, limit: 20 });
    expect(individualAiQuota({ ok: true, used: 3, limit: 4 }, policy, { state: "limit", limit: 20 })).toMatchObject({ limit: 4 });
  });
  it("FAILS CLOSED when the plan could not be read", () => {
    expect(individualAiQuota({ ok: true, used: 0, limit: 100 }, DEFAULT_POLICY, { state: "unreadable" })).toMatchObject({ ok: false, unreadable: true });
  });
  it("reads nothing past the flags while commerce is off", async () => {
    const seen: string[] = [];
    const { admin } = fakeAdmin(q => { seen.push(q.table); return flags(true, false)(q) ?? {}; });
    expect(await individualPlanAiLimit(admin, "u1")).toEqual({ state: "off" });
    expect(seen.every(t => t === "practice_platform_flags")).toBe(true);
  });
  it("is unreadable, not none, when the live read fails with commerce on", async () => {
    const { admin } = fakeAdmin(q => flags(true, true)(q) ?? (q.table === "individual_live_entitlement" ? { error: { message: "x" } } : {}));
    expect(await individualPlanAiLimit(admin, "u1")).toEqual({ state: "unreadable" });
  });
});

describe("startIndividualCheckout", () => {
  const plan = { plan_code: "scholar_month_ugx", experience_code: "scholar", name: "Scholar monthly", amount_minor: 20000, currency: "UGX", interval_days: 30, active: true };
  const base = (over: Partial<Record<string, any>> = {}) => (q: Q) => {
    if (q.table === "individual_plan") return { data: "plan" in over ? over.plan : plan };
    if (q.table === "individual_membership") return { data: over.membership ?? null };
    if (q.table === "individual_entitlement") return { data: over.adult ?? [{ adult_confirmed_at: "2026-09-01T00:00:00Z", adult_confirmed_by: "hq1" }] };
    if (q.table === "individual_checkout" && q.op === "insert") return { data: { id: "co1" } };
    return {};
  };
  const args = { userId: "u1", email: "a@example.test", name: null, planCode: "scholar_month_ugx" };

  it("refuses without gateway configuration, and for an unknown plan", async () => {
    expect(await startIndividualCheckout(fakeAdmin(base()).admin, null, args)).toMatchObject({ ok: false, code: "NOT_CONFIGURED" });
    expect(await startIndividualCheckout(fakeAdmin(base({ plan: null })).admin, CFG, args)).toMatchObject({ ok: false, code: "NO_SUCH_PLAN" });
  });
  it("refuses a suspended member -- paying is not reinstatement", async () => {
    const r = await startIndividualCheckout(fakeAdmin(base({ membership: { status: "suspended" } })).admin, CFG, args);
    expect(r).toMatchObject({ ok: false, code: "MEMBERSHIP_NOT_ACTIVE" });
  });
  it("D8: refuses Scholar to anybody without an HQ adult confirmation, and writes no checkout", async () => {
    const { admin, writes } = fakeAdmin(base({ adult: [] }));
    expect(await startIndividualCheckout(admin, CFG, args)).toMatchObject({ ok: false, code: "ADULT_CONFIRMATION_REQUIRED" });
    expect(writes.some(w => w.table === "individual_checkout")).toBe(false);
  });
  it("writes OUR price and period, with a cin- reference, before the payer leaves", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: "success", data: { link: "https://pay.example/x" } }) } as any);
    const { admin, writes } = fakeAdmin(base());
    const r = await startIndividualCheckout(admin, CFG, args);
    expect(r).toMatchObject({ ok: true, link: "https://pay.example/x" });
    const row = writes.find(w => w.table === "individual_checkout" && w.op === "insert")!.row;
    expect(row).toMatchObject({ user_id: "u1", plan_code: "scholar_month_ugx", experience_code: "scholar", amount_minor: 20000, currency: "UGX", interval_days: 30, status: "pending" });
    expect(row.tx_ref).toMatch(/^cin-/);
  });
});

describe("settlement -- what a proven Individual payment opens", () => {
  const checkout = { id: "co1", user_id: "u1", plan_code: "pro_month_usd", experience_code: "professional", amount_minor: 900, currency: "USD", interval_days: 30, status: "pending" };
  const v: any = { ok: true, providerTxId: "tx1", txRef: "cin-1", amountMajor: 9, currency: "USD", channel: "card" };
  const now = new Date("2026-10-24T10:00:00.000Z");
  const entitlementWrites = (w: Q[]) => w.filter(x => x.table === "individual_entitlement" && x.op === "insert");
  const audits = (w: Q[]) => w.filter(x => x.table === "audit_log").map(x => x.row.action);

  it("opens the membership as a purchase and APPENDS a paid period naming the plan and checkout", async () => {
    const { admin, writes } = fakeAdmin(q => q.table === "individual_live_entitlement" ? { data: [] } : {});
    await INDIVIDUAL_SETTLEMENT.onPaid(admin, checkout, v, "cin-1", now);
    expect(writes.find(w => w.table === "individual_membership")!.row).toMatchObject({ user_id: "u1", status: "active", source: "purchase" });
    const [e] = entitlementWrites(writes);
    expect(e.row).toMatchObject({ source: "payment", plan_code: "pro_month_usd", checkout_id: "co1", experience_code: "professional",
      operating_entity: "competen_holdings", starts_at: "2026-10-24T10:00:00.000Z", ends_at: "2026-11-23T10:00:00.000Z" });
    expect(writes.some(w => w.op === "update" && w.table === "individual_entitlement")).toBe(false);
    expect(audits(writes)).toEqual(["individual_purchase_paid"]);
  });

  it("a renewal starts where the live paid period ends", async () => {
    const { admin, writes } = fakeAdmin(q =>
      q.table === "individual_membership" ? { data: { status: "active" } }
      : q.table === "individual_live_entitlement" ? { data: [{ ends_at: "2026-11-01T00:00:00.000Z" }] } : {});
    await INDIVIDUAL_SETTLEMENT.onPaid(admin, checkout, v, "cin-1", now);
    expect(writes.some(w => w.table === "individual_membership")).toBe(false);
    expect(entitlementWrites(writes)[0].row).toMatchObject({ starts_at: "2026-11-01T00:00:00.000Z", ends_at: "2026-12-01T00:00:00.000Z" });
  });

  it("Scholar carries forward the HQ adult confirmation -- and without one records paid-without-access, granting nothing", async () => {
    const sc = { ...checkout, experience_code: "scholar", plan_code: "sch_month" };
    const confirmed = fakeAdmin(q =>
      q.table === "individual_membership" ? { data: { status: "active" } }
      : q.table === "individual_entitlement" && q.op === "select" ? { data: [{ adult_confirmed_at: "2026-09-01T00:00:00Z", adult_confirmed_by: "hq1" }] }
      : q.table === "individual_live_entitlement" ? { data: [] } : {});
    await INDIVIDUAL_SETTLEMENT.onPaid(confirmed.admin, sc, v, "cin-1", now);
    expect(entitlementWrites(confirmed.writes)[0].row).toMatchObject({ adult_confirmed_at: "2026-09-01T00:00:00Z", adult_confirmed_by: "hq1", operating_entity: "scholar_operator" });

    vi.spyOn(console, "error").mockImplementation(() => {});
    const none = fakeAdmin(q => q.table === "individual_membership" ? { data: { status: "active" } } : q.table === "individual_entitlement" ? { data: [] } : {});
    await INDIVIDUAL_SETTLEMENT.onPaid(none.admin, sc, v, "cin-1", now);
    expect(entitlementWrites(none.writes)).toHaveLength(0);
    expect(audits(none.writes)).toEqual(["individual_purchase_paid_without_access"]);
  });

  it("a revoked member's payment opens nothing and is recorded loudly", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin, writes } = fakeAdmin(q => q.table === "individual_membership" ? { data: { status: "revoked" } } : {});
    await INDIVIDUAL_SETTLEMENT.onPaid(admin, checkout, v, "cin-1", now);
    expect(entitlementWrites(writes)).toHaveLength(0);
    expect(audits(writes)).toEqual(["individual_purchase_paid_without_access"]);
  });

  it("end to end through the Holdings engine: a wrong amount opens nothing, the right one opens a period", async () => {
    const store = (paidAmount: number) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: "success",
        data: { id: "tx1", status: "successful", amount: paidAmount, currency: "USD", tx_ref: "cin-1" } }) } as any);
      return fakeAdmin(q =>
        q.table === "individual_checkout_event" && q.op === "insert" ? { data: { id: "ev1" } }
        : q.table === "individual_checkout" && q.op === "select" ? { data: checkout }
        : q.table === "individual_live_entitlement" ? { data: [] } : {});
    };
    const short = store(1);
    expect((await applyIndividualWebhook(short.admin, CFG, { providerEventId: "tx1", providerTxId: "tx1", txRef: "cin-1" })).verdict).toBe("mismatched");
    expect(entitlementWrites(short.writes)).toHaveLength(0);
    vi.restoreAllMocks();

    const right = store(9);
    expect((await applyIndividualWebhook(right.admin, CFG, { providerEventId: "tx1", providerTxId: "tx1", txRef: "cin-1" })).verdict).toBe("applied");
    expect(entitlementWrites(right.writes)).toHaveLength(1);
    expect(right.writes.some(w => w.table === "individual_checkout" && w.row?.status === "paid")).toBe(true);
  });
});
