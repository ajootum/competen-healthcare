import { describe, expect, it } from "vitest";
import { summariseLedger, validateFxEvent, type FxEventRow } from "./fx-ledger";

const NOW = new Date("2026-10-26T12:00:00Z");
const row = (o: Partial<FxEventRow>): FxEventRow => ({
  id: crypto.randomUUID(), occurred_at: "2026-10-20T00:00:00Z", kind: "conversion", cost_pool: "scholar",
  from_currency: null, from_amount_minor: null, to_currency: null, to_amount_minor: null,
  counterparty: null, source_ref: "REF-1", note: null, voids_id: null, recorded_by: "u", created_at: "2026-10-20T00:00:00Z", ...o,
});

describe("FX reserve ledger", () => {
  it("validates each kind and stores minor units", () => {
    const c = validateFxEvent({ kind: "conversion", occurredAt: "2026-10-20", sourceRef: "STAN-123", fromCurrency: "ugx", fromAmount: 3_750_000, toCurrency: "USD", toAmount: 1000 }, NOW);
    expect(c.ok && c.row).toMatchObject({ from_currency: "UGX", from_amount_minor: 3_750_000, to_currency: "USD", to_amount_minor: 100000 });
    const p = validateFxEvent({ kind: "provider_payment", occurredAt: "2026-10-21", sourceRef: "INV-9", fromCurrency: "USD", fromAmount: 12.5 }, NOW);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.errors).toHaveProperty("counterparty");
    const same = validateFxEvent({ kind: "conversion", occurredAt: "2026-10-20", sourceRef: "X-12", fromCurrency: "USD", fromAmount: 1, toCurrency: "USD", toAmount: 1 }, NOW);
    expect(same.ok).toBe(false);
    const future = validateFxEvent({ kind: "opening_balance", occurredAt: "2027-01-01", sourceRef: "OPEN", toCurrency: "USD", toAmount: 5 }, NOW);
    expect(future.ok).toBe(false);
  });

  it("computes the reserve and the weighted actual rate, excluding voided entries", () => {
    const bad = row({ from_currency: "UGX", from_amount_minor: 9_999_999, to_currency: "USD", to_amount_minor: 100 });
    const rows = [
      row({ kind: "opening_balance", to_currency: "USD", to_amount_minor: 50_000 }),                                   // +500
      row({ from_currency: "UGX", from_amount_minor: 3_700_000, to_currency: "USD", to_amount_minor: 100_000 }),        // +1000 at 3700
      row({ from_currency: "UGX", from_amount_minor: 3_900_000, to_currency: "USD", to_amount_minor: 100_000 }),        // +1000 at 3900
      row({ kind: "provider_payment", from_currency: "USD", from_amount_minor: 25_050, counterparty: "Anthropic" }),     // -250.50
      bad, row({ kind: "void", voids_id: bad.id }),
    ];
    const s = summariseLedger(rows, NOW, 90);
    expect(s.reserveUsd).toBe(2249.5);
    expect(s.actual).toEqual({ ugxPerUsd: 3800, conversions: 2 });
    expect(s.voided).toBe(1);
  });

  it("has no actual rate without a conversion in the window", () => {
    const old = row({ occurred_at: "2026-01-01T00:00:00Z", from_currency: "UGX", from_amount_minor: 3_700_000, to_currency: "USD", to_amount_minor: 100_000 });
    expect(summariseLedger([old], NOW, 90).actual).toBeNull();
    expect(summariseLedger([old], NOW, 90).reserveUsd).toBe(1000);
  });
});
