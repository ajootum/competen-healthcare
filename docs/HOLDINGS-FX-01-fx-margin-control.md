# HOLDINGS-FX-01: FX exposure and margin control (Scholar first)

Owner direction, 26 Oct 2026: a configurable foreign-exchange and subscription unit-economics capability for Competen Holdings, initially covering Scholar. Reuse the existing finance, billing, governance and reporting capabilities. Build only what is missing. Never change prices, buy currency or restrict legitimate users automatically.

## What was reused

| Need | Existing capability |
|---|---|
| Official (reference) rate, with history | `ai_fx_rate` (410/412), append-only, edited on `/super-admin/ai/fair-use` |
| Provider cost per person | `ai_usage_ledger` (settled, metered) or `plat_ai_requests` (list-price estimate) |
| Plan price, paid collections | `individual_plan`, `individual_checkout` (399) |
| Who has access, who pays | `individual_live_entitlement` |
| Versioned, audited configuration | CONFIG-002 / WCE (`workspace_config_*`, 076), scope `{platform, holdings_finance}` |
| Owner-only financial right | `hq.individual.commercial.manage` (400) |
| Audit | `audit_log` |

## What was built

- **Migration 560:**
  - nullable `gateway_fee_minor`, `net_settled_minor`, `settlement_currency` and `settlement_recorded_at` on `individual_checkout`;
  - `holdings_fx_event`, an append-only reserve ledger with four entry kinds: opening balance, conversion, provider payment and void. Service role only.
- **Fee capture:** the Individual settlement adapter stores Flutterwave's `app_fee` and `amount_settled` on a paid checkout. This never fails a payment; it is skipped where 560 is absent.
- **Policy:** `finance.unit_economics.scholar`, covering the planning rate, shocks (default 10/15/25%), margin floor, pricing-review FX move, reserve target, provider budget, stale-rate age, windows, outlier test, other variable cost and labelled assumptions.
- **Pure engine:** `src/lib/holdings/unit-economics.ts`.
  - It keeps three rates apart: actual (weighted from conversions), reference and planning.
  - Per subscriber per 30 days: price, gateway fee, net, AI cost, and gross and contribution margin.
  - Depreciation scenarios and the break-even rate.
  - Reserve cover and shortfall.
  - Consumption outliers, as counts only and never identities.
  - Exceptions: a finding plus a recommendation, never an action.
- **HQ page:** `/super-admin/individual/economics` ("Unit Economics & FX", under Competen Individual), backed by the API route `/api/hq/holdings/economics`.

## Application order and dependencies

560 depends on 399 only. Applied on staging twice with a rollback rehearsal (record in `docs/evidence/HOLDINGS-FX-01/560-staging-record.md`). **Not applied in production.** That needs a separate owner GO.

Before 560 is applied in production:
- the page shows "ledger not available";
- fee capture is skipped;
- everything else works.

## Data honesty

Every figure is marked **Measured**, **Assumption** or **Not available**:
- A missing gateway fee is "not recorded", never zero.
- AI cost from the request log is labelled an estimate while metering is off.
- No margin is shown without a price and a cost.

## Tests

- `unit-economics.test.ts` (16), `fx-ledger.test.ts` (3), `commerce.test.ts` (+4 settlement), all hand-worked.
- `practice/subscription.test.ts` is unchanged and green (shared settlement engine).
- Harnesses: hq-nav-registry 32/0, plane-boundary 35/0, hq-guard 51/0.
- The loader was exercised read-only against staging data.
