-- ============================================================
-- MIGRATION 367: hq.practice.commercial.manage -- THE RIGHT TO SET A PRACTICE'S PLAN WINDOW
--
-- WHAT THIS FIXES, AND IT IS A DEAD END RATHER THAN AN INCONVENIENCE.
--
-- The owner's own practice reached the end of its 30-day trial and was locked out. The screen a member
-- lands on says "reactivating the plan restores access" -- and NOTHING IN THIS PRODUCT CAN REACTIVATE A
-- PLAN. provisioning.ts is the only code that has ever written practice_entitlement, and it writes one
-- at creation. The Product Director workspace cannot even READ the table: the plane boundary refuses it
-- by name, deliberately.
--
-- So a practice whose trial ends is told a remedy exists and given no way to reach it, by anybody. That
-- is not a billing gap -- billing is a known, accepted zero -- it is a governance gap: no position in
-- this estate holds the right to say how long a practice may keep working.
--
-- THE OWNER'S DECISION, RECORDED: "allow the Product Director to determine the duration." This
-- migration creates that right and grants it, and the surface it unlocks is read-and-write over four
-- commercial columns and nothing else.
--
-- !! CAPABILITY AND GRANT SHIP TOGETHER, for the reason migration 311 states at length: this estate has
-- twice inserted a capability catalogue without the grant that makes it reachable and locked existing
-- holders out while every harness stayed green (303 and 305, healed by 307). On the HQ plane the grant
-- IS the backfill -- resolveHqPositions reads hq_position_capability by POSITION code, so a grant
-- reaches every live appointment immediately with no per-appointment write.
--
-- !! IT IS A SEPARATE CAPABILITY FROM commercial.view, AND FROM configuration.manage.
-- Seeing which practices are on which plan is a reporting right. Deciding how long somebody keeps
-- access to their own patient records is not the same act, and folding it into the viewer's right would
-- hand it to every analyst. It is equally not "configuration" -- a wrongly-set flag is corrected, a
-- wrongly-expired plan locks a clinician out of a live diary.
--
-- !! AND IT IS NOT GRANTED TO THE APPROVER POSITIONS. 311 records the maker-checker rule -- the Director
-- proposes, somebody else disposes -- so change.approve and risk.accept stay where they are. This right
-- is the Director's own act, audited, and the audit is what a checker reads afterwards.
--
-- Plain idempotent statements, ASCII only, no do-blocks, no plpgsql -- survives any splitter.
-- ============================================================

-- ---- 1. The capability ---------------------------------------------------------------------------

insert into hq_capability (code, space, label, description) values
  ('hq.practice.commercial.manage', 'practice', 'Commercial administration',
   'Set a practice plan window: extend a trial, reactivate a lapsed plan, or end one')
on conflict (code) do nothing;

-- ---- 2. The grant, which is what makes it reachable ----------------------------------------------
--
-- insert..select against existing rows rather than on-conflict: hq_position_capability is temporal
-- (effective_from/effective_to) and carries no unique constraint on the pair, because a UNIQUE index
-- there would forbid the regrant-after-revoke the temporal columns exist to allow.

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('practice_product_director')) as p(code)
cross join (values ('hq.practice.commercial.manage')) as c(code)
where not exists (
  select 1 from hq_position_capability x
  where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
);

-- Verification: the capability exists, and the Director holds it with no end date.
select code, space, label
  from hq_capability
 where code = 'hq.practice.commercial.manage';

select position_code, capability_code, source, effective_to
  from hq_position_capability
 where capability_code = 'hq.practice.commercial.manage'
   and effective_to is null
 order by position_code;

notify pgrst, 'reload schema';
