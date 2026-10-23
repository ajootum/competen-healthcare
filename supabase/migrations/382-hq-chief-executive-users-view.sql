-- ====================================================================================================
-- MIGRATION 382: THE CHIEF EXECUTIVE MAY SEE THE HQ USER DIRECTORY
--
-- HQ-USERS-B (owner GO 2026-10-23, Chief Executive directory access). Reserved number 382.
--
-- APPLY ON STAGING FIRST. DATA ONLY. It inserts one grant into the existing HQ catalogue. It creates,
-- alters and drops nothing, and re-running it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS FOR, IN ONE SENTENCE.
--
-- Migration 379 gave the Chief Executive position hq.platform.users.reset, but not the view right that
-- opens /super-admin/users, so a Chief Executive held a right with no page to use it from. This grants
-- hq.platform.users.view to the same position.
--
-- ----------------------------------------------------------------------------------------------------
-- WHAT IT DOES NOT DO.
--
--   It grants no account write. Creating, changing, suspending and deleting accounts stay owner-only in
--   the routes (hqOwnerApiGate), which no position grant can open. It does not grant Platform Owner. It
--   does not touch hq.platform.users.reset, which the position keeps. It appoints nobody.
--
-- HOUSE RULES (scripts/migration-house-rules.ts), CHECKED BY RUNNING IT, NOT BY EYE.
--
--   ASCII only. No semicolons inside any comment or string literal. No plpgsql, no do-blocks, no
--   functions, so no APPLY-WHOLE banner is required. notify pgrst last.
--
-- ROLLBACK (staging): delete the one hq_position_capability row (position chief_executive, capability
--   hq.platform.users.view). The SQL is in the build record.
-- ====================================================================================================

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('chief_executive')) as p(code)
cross join (values ('hq.platform.users.view')) as c(code)
where exists (select 1 from hq_position x where x.code = p.code)
  and exists (select 1 from hq_capability y where y.code = c.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
  );


-- Verification: the open grants of the position (expect hq.platform.users.reset and
-- hq.platform.users.view among its executive grants, and no account-write capability).
select position_code, capability_code, effective_to
  from hq_position_capability
 where position_code = 'chief_executive'
 order by capability_code;

notify pgrst, 'reload schema';
