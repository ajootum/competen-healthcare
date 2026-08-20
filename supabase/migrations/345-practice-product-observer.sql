-- ============================================================
-- MIGRATION 345: A READ-ONLY POSITION FOR THE PRACTICE PRODUCT WORKSPACE (CPR-PD-013 s9, CPR-PD-014 s6.1)
--
-- THE FINDING THIS CLOSES. practice_product_director is the ONLY position holding
-- hq.practice.operations.view, and it also holds every write capability in the practice space. So there
-- is no way to let somebody WATCH provisioning without also letting them EXECUTE it, and no way to let
-- somebody read the launch gate without also letting them flip the flags underneath it. That is not a
-- separation of duties, it is a matrix with one row.
--
-- ============================================================ WHY A POSITION AND NOT A FLAG
--
-- The estate already answers this question once, and this migration copies that answer rather than
-- inventing a second mechanism. Migration 264 seeds chief_financial_officer as, in its own words,
-- "Executive space, reporting and performance only. Same space as the CEO, different grants" -- two
-- positions in one space, differing only by what they are granted. Nothing else was needed then and
-- nothing else is needed now.
--
-- ============================================================ WHAT IT HOLDS, AND WHAT IT DOES NOT
--
-- Every one of the thirteen VIEW capabilities the Product Director holds, and none of the eight writes.
-- Read from the live grant table rather than transcribed, so this is the actual split.
--
-- The eight it does NOT hold: configuration.manage, export.execute, flags.manage, launch.attest,
-- licence.verify, provision.execute, release.activate, release.rollback.
--
-- !! EXPORT IS DELIBERATELY WITHHELD EVEN THOUGH IT SOUNDS LIKE READING. hq.practice.export.execute
-- moves data OUT of the estate. An observer who may look at a screen has not thereby been permitted to
-- take a copy of what is on it, and the CPR-PD-013 s9 pass recorded export.execute as enforced by
-- nothing today -- so granting it here would hand out authority that is both unearned and unmeasured.
--
-- ============================================================ WHAT THIS CHANGES FOR THE EXISTING ROLE
--
-- Nothing. practice_product_director keeps all twenty-one capabilities. This migration adds a position
-- and grants to it, and touches no existing row. Nobody is demoted by it and no screen changes for
-- anybody already appointed.
--
-- ============================================================ THE HALF THIS DOES NOT DO
--
-- CPR-PD-014 s6.2: the provisioning and launch-flag controls are enforced at the API but not conditioned
-- in the UI, so they render for anybody holding operations.view. That was invisible while one position
-- held both, because everybody who could see the screen could also use the control. This migration makes
-- it visible for the first time: an observer will now be OFFERED a control the API will refuse.
--
-- Conditioning those controls is application code and belongs in the same change set as this migration.
-- The order matters and it is this way round on purpose: building the conditioning first would ship a
-- branch that no identity in the estate could reach, and therefore no test could exercise.
-- ============================================================

insert into hq_position (code, space, name, description) values
  ('practice_product_observer', 'practice', 'Practice Product Observer',
   'Read-only access to the Competen Practice product workspace. Same space as the Product Director, view grants only. Cannot provision, flip a launch flag, attest a control, change configuration or export.')
on conflict (code) do nothing;

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('practice_product_observer')) as p(code)
cross join (values
  ('hq.platform.home.view'),
  ('hq.practice.mission.view'),
  ('hq.practice.practices.view'),
  ('hq.practice.practitioners.view'),
  ('hq.practice.intelligence.view'),
  ('hq.practice.adoption.view'),
  ('hq.practice.commercial.view'),
  ('hq.practice.health.view'),
  ('hq.practice.support.view'),
  ('hq.practice.governance.view'),
  ('hq.practice.configuration.view'),
  ('hq.practice.releases.view'),
  ('hq.practice.operations.view')
) as c(code)
on conflict (position_code, capability_code) do nothing;

notify pgrst, 'reload schema';
