-- ====================================================================================================
-- MIGRATION 376: THE RIGHT TO SET COMPETEN INDIVIDUAL POLICY, THROUGH THE EXISTING HQ CATALOGUE
--
-- COMPETEN-CONFIG-002 item 5 (owner GO 2026-10-23). Reserved number 376.
--
-- APPLY ON STAGING FIRST. DATA ONLY. It inserts one capability and one grant into the existing HQ
-- catalogue. It creates, alters and drops nothing, and re-running it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It lets whoever holds an active appointment to the Individual Product Administrator position (migration
-- 370) set the Competen Individual policy values on /super-admin/individual/configuration, and nobody
-- else apart from the platform owners hqApiGate already admits.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT DOES NOT DO.
--
--   It grants no super-admin or landlord authority. The capability opens one page and one route, both
--   guarded by name (requireHqCapability and hqApiGate), and the route writes only config paths named in
--   the Individual policy catalogue (src/lib/individual/policy.ts), at the platform scope partition
--   scope_ref = individual of workspace_config_overrides (migration 076). It cannot touch a workspace
--   setting, another scope, the individual_app release gate or any immutable hard limit, which lives in
--   code and clamps every value on read.
--
--   It appoints nobody. Until the owner appoints a person to the position, nobody new holds the right.
--
-- ----------------------------------------------------------------------------------------------------
-- WHY THE CAPABILITY AND THE GRANT SHIP TOGETHER.
--
-- The reason migrations 311, 367 and 370 record: a capability inserted without the grant that makes it
-- reachable locks everybody out while every harness stays green.
--
-- ----------------------------------------------------------------------------------------------------
-- HOUSE RULES (scripts/migration-house-rules.ts), CHECKED BY RUNNING IT, NOT BY EYE.
--
--   ASCII only. No semicolons inside any comment or string literal. No plpgsql, no do-blocks, no
--   functions, so no APPLY-WHOLE banner is required. notify pgrst last.
--
-- ROLLBACK (staging): delete the one hq_position_capability row (position individual_product_administrator,
--   capability hq.individual.config.manage), then the hq_capability row. The SQL is in the build record.
-- ====================================================================================================

insert into hq_capability (code, space, label, description) values
  ('hq.individual.config.manage', 'platform', 'Competen Individual policy',
   'Set the Competen Individual policy values within their fixed hard limits, with version history and audit')
on conflict (code) do nothing;

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('individual_product_administrator')) as p(code)
cross join (values ('hq.individual.config.manage')) as c(code)
where exists (select 1 from hq_position x where x.code = p.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
  );


-- Verification: the capability, and the open grants of the position (expect hq.individual.config.manage,
-- hq.individual.pilot.grant and hq.platform.home.view).
select code, space, label
  from hq_capability
 where code = 'hq.individual.config.manage';

select position_code, capability_code, effective_to
  from hq_position_capability
 where position_code = 'individual_product_administrator'
 order by capability_code;

notify pgrst, 'reload schema';
