-- ============================================================
-- MIGRATION 369: ACTIVATE THE PRICED PLAN (CPR-PD-PROV-001 AC-10 / AC-16, ADR-015)
--
-- The AC-16 test matrix has two rows nothing can currently exercise -- "paid billing-controlled plan"
-- and "change plan" -- because no plan in practice_plans is both ACTIVE and PRICED. practice_solo_ugx
-- carries a real price (74000 minor units, UGX, monthly) and sits inactive, so startCheckout refuses
-- every request with NO_SUCH_PLAN before it reaches the gateway. This flips that one row.
--
-- ---- WHAT THIS ALONE CHANGES, AND WHAT IT DOES NOT -----------------------------------------------
--
-- !! NO PRACTITIONER SEES A PRICE BECAUSE OF THIS MIGRATION. The billing card checks whether the
-- payment gateway is configured BEFORE rendering the offers list, and this deployment has no
-- FLW_SECRET_KEY, no FLW_SECRET_HASH and no NEXT_PUBLIC_SITE_URL -- checked in the Vercel production
-- environment, by name. Until those exist the card reads "Payments are not switched on for this
-- deployment yet", and the offers list is unreachable. So this migration cannot begin a charge and
-- cannot show a price to a patient or a clinician.
--
-- !! WHAT IT DOES CHANGE, VISIBLY: the provisioning wizard Access step lists ACTIVE plans, so a
-- Product Director will now see "Practice solo practitioner (UGX)" beside the trial and the standard
-- plan, and can provision a practice onto it. That is the intended effect -- it is how a period with
-- a commercial basis comes to exist at all -- but it is a real change to a live screen and is named
-- here rather than discovered.
--
-- !! AND IT IS ONE UPDATE ON ONE ROW, REVERSIBLE BY THE SAME. Setting active back to false restores
-- the posture of today, exactly. No other column is touched and no history is written.
--
-- ---- WHAT IS STILL REQUIRED BEFORE MONEY CAN MOVE ------------------------------------------------
--
-- Three environment variables in Vercel production, set by the owner and never by an agent:
--   FLW_SECRET_KEY        Flutterwave secret. TEST-mode keys exercise the whole path with test cards
--                         and no real money, which is the recommended way to satisfy AC-16.
--   FLW_SECRET_HASH       the webhook verif-hash secret, matching what is registered at Flutterwave.
--   NEXT_PUBLIC_SITE_URL  where the gateway returns the payer to.
-- and the webhook registered at Flutterwave pointing to
--   /api/v1/practice/billing/webhook/flutterwave
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

update practice_plans
   set active = true
 where plan_code = 'practice_solo_ugx';

-- Verification: the plan is active AND priced, which is the pair startCheckout requires. A row that is
-- active with a null amount is the state that produces PLAN_NOT_PRICED at the moment somebody clicks.
select plan_code, name, active, amount_minor, currency, interval_unit
  from practice_plans
 order by active desc, plan_code;

notify pgrst, 'reload schema';
