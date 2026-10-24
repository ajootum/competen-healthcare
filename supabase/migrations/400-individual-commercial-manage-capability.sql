-- ====================================================================================================
-- MIGRATION 400: THE RIGHT TO PRICE COMPETEN INDIVIDUAL, IN THE EXISTING HQ CATALOGUE, HELD BY NOBODY YET
--
-- COMPETEN P1 Commercial, development authorised, commercial activation ON HOLD. Reserved number 400.
-- Depends on nothing but the HQ catalogue (migration 264). Build record:
-- docs/COMPETEN-P1-COMMERCIAL-holdings-foundation.md.
--
-- APPLY ON STAGING FIRST. DATA ONLY. It inserts one capability into the existing HQ catalogue. It grants
-- it to no position, creates, alters and drops nothing, and re-running it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It names the authority behind /api/hq/individual/plans -- creating, pricing, activating and retiring the
-- Competen Individual plans of migration 399 -- so that the route asks for a capability by name instead
-- of an ad hoc owner check.
--
-- ----------------------------------------------------------------------------------------------------
-- WHY IT SHIPS WITH NO GRANT, WHEN 311, 367, 370 AND 376 SHIPPED A GRANT BESIDE EVERY CAPABILITY.
--
-- Their lesson is that a capability nobody holds locks everybody out while every harness stays green. That
-- lesson is about a right MEANT for a position. This one is meant, today, for the platform owners only,
-- and hqApiGate already admits them for every capability. Setting prices is a commercial authority, and
-- handing it to a position -- even the Individual Product Administrator -- is a privileged authority
-- change that needs its own owner GO. Until then nobody but the owners holds it, which is the intent.
--
-- HOUSE RULES (scripts/migration-house-rules.ts), CHECKED BY RUNNING IT, NOT BY EYE.
--
--   ASCII only. No semicolons inside any comment or string literal. No plpgsql, no do-blocks, no
--   functions, so no APPLY-WHOLE banner is required. notify pgrst last.
--
-- ROLLBACK (staging): delete the hq_capability row hq.individual.commercial.manage. Nothing references it.
-- ====================================================================================================

insert into hq_capability (code, space, label, description) values
  ('hq.individual.commercial.manage', 'platform', 'Competen Individual plans and prices',
   'Create, price, activate and retire the purchasable Competen Scholar and Competen Professional plans, with audit')
on conflict (code) do nothing;


-- Verification: the capability, and that no position holds it (expect zero rows in the second result).
select code, space, label
  from hq_capability
 where code = 'hq.individual.commercial.manage';

select position_code, capability_code, effective_to
  from hq_position_capability
 where capability_code = 'hq.individual.commercial.manage';

notify pgrst, 'reload schema';
