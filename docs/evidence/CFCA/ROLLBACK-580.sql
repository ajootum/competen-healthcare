-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It restores one SQL function of migration 511 between dollar quotes.
-- ====================================================================================================
-- ROLLBACK 580 (STAGING). Removes the competency framework publication capability and its grant, and restores
-- hq_capability_exclusions() exactly as 511 defined it. Versions already published stay: framework_versions is
-- append-only history, and the audit trail stays.
-- Production: not to be run without the owner. Fix forward instead.

delete from hq_position_capability where capability_code = 'hq.quality.competency.publish';
delete from hq_capability where code = 'hq.quality.competency.publish';

create or replace function hq_capability_exclusions()
returns table (capability_a text, capability_b text, reason text)
language sql
immutable
set search_path = public
as $$
  select * from (values
    ('hq.quality.clinical.approve', 'hq.quality.competency.author', 'a competency author cannot hold clinical approval'),
    ('hq.quality.clinical.approve', 'hq.quality.case.author', 'a case author cannot hold clinical approval'),
    ('hq.quality.clinical.approve', 'hq.learning.course.author', 'a course author cannot hold clinical approval'),
    ('hq.quality.clinical.approve', 'hq.learning.ckri.educator', 'a knowledge educator cannot hold clinical approval'),
    ('hq.quality.clinical.approve', 'hq.quality.clinical.govern', 'a clinical reviewer cannot set reviewer scopes'),
    ('hq.quality.case.author', 'hq.quality.case.publish', 'a case author cannot publish cases'),
    ('hq.learning.course.author', 'hq.learning.course.publish', 'a course author cannot publish courses'),
    ('hq.learning.ckri.educator', 'hq.quality.knowledge.publish', 'a knowledge educator cannot publish knowledge resources'),
    ('hq.quality.research.propose', 'hq.quality.research.review', 'a research proposer cannot review research'),
    ('hq.quality.research.propose', 'hq.quality.research.govern', 'a research proposer cannot govern research'),
    ('hq.competency.verification.assess', 'hq.quality.clinical.approve', 'a competency assessor cannot hold clinical content approval'),
    ('hq.competency.verification.assess', 'hq.quality.clinical.govern', 'a competency assessor cannot govern clinical reviewer scopes'),
    ('hq.competency.verification.assess', 'hq.quality.competency.author', 'a competency assessor cannot author competency content'),
    ('hq.competency.verification.assess', 'hq.competency.verification.manage', 'a competency assessor cannot set assessment criteria, scopes or assignments')
  ) as t(capability_a, capability_b, reason)
$$;

notify pgrst, 'reload schema';
