# COMPETEN P1 Commercial: the Holdings payment foundation (build record)

**Status:** development authorised. **Commercial activation ON HOLD.** Nothing customer-facing is on: every
new surface is behind `individual_commerce` (default OFF, no row written by any migration) *and* the
Individual release gate `individual_app`.

**Migrations:** 399 and 400. Both were authored here. Staging application (twice each) is done by the main
session. Production needs a separate owner GO for each migration.

## 1. What was built

### 1.1 The Holdings payment code, lifted from Practice unchanged

- **`src/lib/commerce/gateway.ts`** is the Flutterwave gateway, moved from `src/lib/practice/subscription-gateway.ts`. It holds:
  - the minor-unit table;
  - the constant-time `verif-hash` compare;
  - `verifyTransaction`;
  - the hosted checkout;
  - the channel vocabulary.
- **What a product now passes in:**
  - its transaction prefix (`newTxRefWith`);
  - its return path;
  - its checkout copy.
- **`src/lib/commerce/settlement.ts`** is the three-check settlement, moved from Practice's `applyWebhook`:
  1. claim the delivery under its unique constraint;
  2. verify with Flutterwave;
  3. match the verified amount and currency against the checkout row *we* wrote.

  A product supplies a `SettlementAdapter`, which provides its table names and its `onPaid` and `onMismatched` handlers.
- **Practice is a client of that code:**
  - `subscription-gateway.ts` re-exports the gateway and keeps the `cpr-` prefix, `/practice/settings/billing/return` and its copy;
  - `applyWebhook` is the Practice adapter (subscription row, append-only access period, audit), line for line what it did before.
- **Proof:** the Practice suite passes 206/206 with no test edited, and `subscription.test.ts` mocks at `fetch`, so it runs through the lifted engine. Planting an amount-check bypass in the engine turns Practice red.

### 1.2 Competen Individual commerce (dark)

- **`src/lib/individual/commerce.ts`:**
  - **Gate.** `individualCommerceEnabled` returns true only when *both* flags are true. An absent row, a failed read or no client all count as OFF.
  - **Checkout.** `startIndividualCheckout` writes our price and period, copied from the plan, before the payer leaves. Its refusals are:
    - a suspended or revoked member (paying is not reinstatement);
    - a Scholar plan for someone with no recorded HQ adult confirmation (D8).
  - **Settlement.** `INDIVIDUAL_SETTLEMENT` handles a proven payment:
    - it writes a membership with source `purchase` if none exists;
    - it **appends** an `individual_entitlement` row (source `payment`, `plan_code`, `checkout_id`). A renewal starts where the live paid period ends;
    - a Scholar period carries forward the recorded HQ confirmation;
    - every failure after the money is taken is recorded as `individual_purchase_paid_without_access`, never as a failed payment.
- **Routes:**
  - `POST /api/individual/billing/checkout`: Individual session, then the commerce gate, then the body. It requires a confirmed email.
  - `/individual/billing/return`: reads the checkout row of the signed-in person only. It **decides nothing** from the query string.
- **Shared webhook.** Flutterwave allows one URL per account, so `cin-` references are dispatched to the Individual adapter **only while commerce is on**:
  - every other reference, and every reference while commerce is off, takes the unchanged Practice path;
  - a forged prefix finds no Individual checkout and pays nothing.
- **Scholar and Professional are independent.** Each plan buys one experience, and the composite keys in 399 make a cross-experience checkout or paid period unrepresentable.

### 1.3 Plans as data, governed by HQ

- **`src/lib/individual/plans.ts`** validates against every 399 CHECK before the database does:
  - a major-unit price is converted through the gateway's currency table;
  - a price finer than the currency allows is refused, not rounded;
  - an active plan must be priced;
  - the AI limit must be between 1 and the hard limit.

  A plan's experience cannot change. Plans are retired, never deleted.
- **`GET/POST /api/hq/individual/plans`:**
  - guarded by `hqApiGate(["hq.individual.commercial.manage"])`, then the commerce gate;
  - every change is audited with the row as it was before and after.
- **Migration 400 grants the capability to no position,** so only the platform owners hold it. Granting it to a position is a privileged authority change and needs an owner GO.

### 1.4 AI fair use per plan

- **`individualPlanAiLimit`:**
  - with commerce off, it reads nothing past the flags and returns `off`, so AI behaves exactly as before and does not depend on 399;
  - with commerce on, the most generous `ai_hourly_limit` among the person's live **paid** plans replaces the CONFIG-002 policy base for that person, clamped to the Individual hard limit (`INDIVIDUAL_AI_HOURLY_DEFAULT`). The estate limit still applies on top;
  - pilot holders keep the policy base.
- **`individualAiQuota` fails closed:** a plan that cannot be read is refused, like an unreadable count. All three Individual quota sites pass the plan limit.

## 2. Migrations

| File | sha256 (CRLF, as committed) | sha256 (LF) | Depends on |
|---|---|---|---|
| `399-individual-plans-and-checkout.sql` | `219ac81cfe0ba9650511c0e12e58a97a2fda009fc5e9c78e5c2c6ffd9ee603c0` | `bbbe9e21f896fdaa42ae9172bfa13db9af6fcaa21b1669e3ed212908877bcc73` | 370 (`individual_membership`, `individual_entitlement`, the live view) |
| `400-individual-commercial-manage-capability.sql` | `c4fbfbb6beb25a1f9eb3396c89688db349be0213b4ee73060cded707e673d388` | `12bb67395273b904de360b5d88b03b1e8a6d5714ffe927e9ff6d0e528ae9c1c5` | 264 (the HQ catalogue) |

**Application order:** 399, then 400. They are independent of each other. Both pass `scripts/migration-house-rules.ts` with ALL CLEAR and zero warnings. Neither contains plpgsql, so neither needs an APPLY WHOLE banner.

**Staging state before application** (read-only probe, 2026-10-24):
- `individual_plan`, `individual_checkout` and `individual_checkout_event` are absent (PGRST205);
- `individual_entitlement.plan_code` is absent (42703);
- 0 entitlement rows have source `payment`, so the new CHECK can be added;
- the only membership source in use is `hq_pilot_grant`;
- `hq.individual.commercial.manage` is absent.

**Staging application and verification:**
- **Applied:** each file was applied twice on staging (`ezhvpgtcqcdsgylrxgdb`) on 2026-10-24 by the main session, under the owner authorisation for staging 396–401. The production guard passed and all four runs reported ok. The applied files are the checksums above (CRLF).
- **Post-state:** verified read-only by `scripts/individual-commerce-staging-harness.ts`, checks C1–C3:
  - the three tables, both entitlement columns and `plan_code` on the view are present, with a control column that is refused;
  - the capability is present and no position holds it;
  - `individual_commerce` has no row.

**Production:** not applied. `main` may hold these files before production has them. That is safe because:
- every reader is behind `individual_commerce`, which defaults OFF;
- with the flag off, no code path reads a 399 table: AI quota, webhook, checkout, return page and HQ plans all check the gate first (foundation harness 13b).

## 3. Rollback (staging)

Roll back 400, then 399. Run each statement on its own; none contains a semicolon inside a body.

`create or replace view` cannot drop a column, so the view is dropped and created again in the shape migration 370 gave it.

```sql
delete from hq_capability where code = 'hq.individual.commercial.manage';
drop view if exists individual_live_entitlement;
create view individual_live_entitlement with (security_invoker = true) as
  select e.id, e.user_id, e.experience_code, e.status, e.starts_at, e.ends_at, e.source, e.operating_entity,
         e.terms_version, e.privacy_version
    from individual_entitlement e
   where e.status in ('active', 'trial') and e.starts_at <= now() and (e.ends_at is null or e.ends_at > now());
alter table individual_entitlement drop constraint if exists individual_entitlement_payment_plan;
alter table individual_entitlement drop constraint if exists individual_entitlement_plan_fk;
alter table individual_entitlement drop column if exists checkout_id;
alter table individual_entitlement drop column if exists plan_code;
alter table individual_membership drop constraint if exists individual_membership_source_check;
alter table individual_membership add constraint individual_membership_source_check
  check (source in ('hq_pilot_grant', 'signup', 'hq_grant'));
drop table if exists individual_checkout_event;
drop table if exists individual_checkout;
drop table if exists individual_plan;
notify pgrst, 'reload schema';
```

The rollback refuses to run in two cases, and both refusals are correct:
- a membership with source `purchase` exists (the restored CHECK refuses it);
- a paid entitlement period still names a plan.

Paid periods are records of money taken, so they are not deleted to make a rollback pass.

## 4. Verification

- **Unit tests:**
  - `src/lib/individual/commerce.test.ts`, 19 tests: the gate, references and periods, AI fair use, checkout refusals and writes, settlement (purchase membership, the appended period, renewal start, D8 carried forward and refused, a revoked member, a wrong amount and the right amount run end to end through the Holdings engine);
  - `src/lib/individual/plans.test.ts`, 5 tests;
  - the Practice suite, 206/206, unchanged.
- **Controls proven red, then restored:**
  - with the D8 refusal removed, the Scholar settlement test fails;
  - with the amount check removed from the engine, both the Practice wrong-amount test and the Individual end-to-end test fail;
  - with the webhook dispatch ungated, foundation harness 13b fails;
  - with a position grant planted in 400, 13c fails.

  The 400 checksum was re-verified after the restore.
- **`scripts/individual-foundation-harness.ts`: 67/67.** The changes:
  - 2a names the commerce and plan writers and why;
  - 4c names commerce's one non-liveness ledger read (the adult confirmation columns only);
  - 5a names the checkout route;
  - group 13 is new:
    - 13a: dark by default;
    - 13b: every entry point checks the gate first;
    - 13c: pricing is owner-held;
    - 13d: D8 is intact;
    - 13e: Practice is a client, not a copy;
    - 13f: every quota site passes the plan limit.
- **`scripts/individual-commerce-staging-harness.ts` on staging: 17/17.** It is registered in `privileged-harnesses.ts`. It covers:
  - the post-state;
  - every plan CHECK, with a control;
  - both composite keys, including that a plan named by a checkout cannot change experience;
  - the payment-without-plan CHECK;
  - delivery uniqueness;
  - the settlement adapter against the real schema (purchase membership, a live paid period, renewal appended at the live end, D8 refused and then carried forward);
  - AI fair use `off` while commerce is off;
  - cleanup.

  It never writes either flag, and it deletes its own `harness-p1c-*` identities and `zz_p1c_*` plans.

## 5. Owner decisions this build does not take

These are needed before activation, not before merge.

1. **Commercial activation:** writing `individual_commerce = true`, which also requires `individual_app`.
2. **Scholar self-attestation.** Today a person may buy Scholar only if HQ has already recorded their adult confirmation (D8). Letting a buyer attest their own age needs an owner ruling, and possibly a schema change to `individual_entitlement_scholar_adult`.
3. **Purchase as a way in.** With commerce on, a signed-in Competen account with no Individual membership can buy, and the settlement writes a membership with source `purchase`. That is a new route into the product alongside the pilot grant. It is dark today, and opening it is part of decision 1.
4. **Granting `hq.individual.commercial.manage` to a position.** Today only the platform owners hold it.
5. **Scholar's operating entity** (`scholar_operator`) and the experience terms that apply to paid periods. These are covered by the LEGAL-001/002 material and are still pending.
6. **Plans and prices themselves.** None are seeded. HQ creates them through the plans API once commerce is on.
