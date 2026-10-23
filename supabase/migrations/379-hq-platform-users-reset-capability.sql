-- ====================================================================================================
-- MIGRATION 379: THE RIGHT TO SEND A PASSWORD-RESET EMAIL, THROUGH THE EXISTING HQ CATALOGUE
--
-- HQ-USERS-B (owner GO 2026-10-23, Secure password-reset administration). Reserved number 379.
--
-- APPLY ON STAGING FIRST. DATA ONLY. It inserts one capability and two grants into the existing HQ
-- catalogue. It creates, alters and drops nothing, and re-running it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- It lets whoever holds an active appointment as Chief Executive or Platform Director ask Competen to
-- email a password-reset link to another person, through POST /api/super-admin/users/reset, and nobody
-- else apart from the platform owners hqApiGate already admits.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT DOES NOT DO.
--
--   It grants no owner authority. Owner and super-admin ACCOUNTS stay resettable only by an owner, which
--   the route decides, not this file. It grants nothing to the Individual Product Administrator or to
--   any other position. It appoints nobody.
--
--   It shows nobody a link. The email is Supabase Auth recovery, sent to the account verified address,
--   and the route never returns or records a token.
--
-- ----------------------------------------------------------------------------------------------------
-- WHY THE CAPABILITY AND THE GRANTS SHIP TOGETHER.
--
-- The reason migrations 311, 367, 370 and 376 record: a capability inserted without the grant that makes
-- it reachable locks everybody out while every harness stays green.
--
-- HOUSE RULES (scripts/migration-house-rules.ts), CHECKED BY RUNNING IT, NOT BY EYE.
--
--   ASCII only. No semicolons inside any comment or string literal. No plpgsql, no do-blocks, no
--   functions, so no APPLY-WHOLE banner is required. notify pgrst last.
--
-- ROLLBACK (staging): delete the two hq_position_capability rows for hq.platform.users.reset, then the
--   hq_capability row. The SQL is in the build record.
-- ====================================================================================================

insert into hq_capability (code, space, label, description) values
  ('hq.platform.users.reset', 'platform', 'Send password-reset emails',
   'Ask Competen to email a password-reset link to another person, at their verified address. Never shows the link.')
on conflict (code) do nothing;

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('chief_executive'), ('platform_director')) as p(code)
cross join (values ('hq.platform.users.reset')) as c(code)
where exists (select 1 from hq_position x where x.code = p.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
  );


-- Verification: the capability, and which positions now hold it (expect chief_executive and
-- platform_director, nothing else).
select code, space, label
  from hq_capability
 where code = 'hq.platform.users.reset';

select position_code, capability_code, effective_to
  from hq_position_capability
 where capability_code = 'hq.platform.users.reset'
 order by position_code;

notify pgrst, 'reload schema';
