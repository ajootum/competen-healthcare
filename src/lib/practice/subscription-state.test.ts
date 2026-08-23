import { describe, it, expect } from "vitest";
import { subscriptionState, formatMoney } from "@/lib/practice/subscription-state";
import { currencyExponent } from "@/lib/practice/subscription-gateway";

// The billing card draws whatever this returns, so the only property worth asserting hard is that an
// UNREAD status never renders as a reassuring one. Telling somebody they are on a free trial because the
// entitlement row errored is how a practitioner discovers on a Monday that the workspace lapsed a week
// ago -- and unlike most of this codebase's silent-empty bugs, this one has money attached.

/* eslint-disable @typescript-eslint/no-explicit-any */

const FAIL = { message: "canceling statement due to statement timeout" };

/** Per-table results; the chain is thenable because the plan list is awaited without maybeSingle. */
function stubAdmin(byTable: Record<string, { data: unknown; error: unknown }>) {
  return {
    from(table: string) {
      const r = byTable[table] ?? { data: null, error: null };
      const chain: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === "then") return (res: any) => res(r.data === null && !r.error ? { data: [], error: null } : r);
          if (prop === "maybeSingle") return async () => r;
          return () => chain;
        },
      });
      return chain;
    },
  };
}

const ENT = { data: { plan_code: "practice_trial", status: "trial", ends_at: "2026-09-01" }, error: null };
const PLANS = { data: [{ plan_code: "practice_solo_ugx", name: "Solo", amount_minor: 74000, currency: "UGX", interval_unit: "month" }], error: null };

describe("subscriptionState", () => {
  it("NAMES an entitlement it could not read, rather than reporting no plan", async () => {
    const s = await subscriptionState(stubAdmin({ practice_entitlement: { data: null, error: FAIL } }), "ws-1", true);

    expect(s.unavailable).toContain("your entitlement");
    // The card short-circuits on `unavailable`, which is the only thing standing between a failed read
    // and the words "No plan on file".
    expect(s.entitlement).toBeNull();
  });

  it("names an unreadable plan list — otherwise the price looks like it does not exist", async () => {
    const s = await subscriptionState(stubAdmin({ practice_entitlement: ENT, practice_plans: { data: null, error: FAIL } }), "ws-1", true);

    expect(s.unavailable).toContain("the available plans");
    expect(s.offers).toEqual([]);
  });

  it("reports nothing unavailable when every table answers, and a real trial is a real trial", async () => {
    const s = await subscriptionState(stubAdmin({ practice_entitlement: ENT, practice_plans: PLANS }), "ws-1", true);

    expect(s.unavailable).toEqual([]);
    expect(s.entitlement).toMatchObject({ status: "trial", planCode: "practice_trial" });
    expect(s.offers).toHaveLength(1);
    // Without this control the assertions above could pass for the wrong reason.
  });

  it("an ABSENT entitlement is not an unreadable one", async () => {
    const s = await subscriptionState(stubAdmin({ practice_entitlement: { data: null, error: null }, practice_plans: PLANS }), "ws-1", true);

    expect(s.unavailable).toEqual([]);   // nothing failed
    expect(s.entitlement).toBeNull();    // there is simply no row, and the card says "No plan on file"
  });

  it("carries the gateway readiness through, so a missing key reads as 'not switched on'", async () => {
    const off = await subscriptionState(stubAdmin({ practice_entitlement: ENT, practice_plans: PLANS }), "ws-1", false);
    expect(off.gatewayReady).toBe(false);
  });
});

describe("formatMoney", () => {
  it("formats UGX with no decimals, because its ISO exponent is 0", () => {
    expect(formatMoney(74000, "UGX", currencyExponent)).toBe("UGX 74,000");
  });

  it("formats KES with two, so the shared exponent table is exercised where it is NOT the identity", () => {
    expect(formatMoney(260000, "KES", currencyExponent)).toBe("KES 2,600.00");
  });

  it("shows NO price for a currency it cannot format, rather than a wrong one", () => {
    expect(formatMoney(1000, "ZZZ", currencyExponent)).toBeNull();
    // The card disables the pay button on null, so an unformattable price cannot be charged either.
  });
});
