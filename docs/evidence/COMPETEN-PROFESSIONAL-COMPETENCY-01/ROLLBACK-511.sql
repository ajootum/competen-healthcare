-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It restores the two SQL functions of migration 500 between dollar quotes. A runner that
-- splits on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- ROLLBACK 511 (staging). Restores hq_capability_sensitive_class and hq_capability_exclusions exactly as migration 500
-- defined them. The two function bodies below are copied from 500 unchanged.
-- ====================================================================================================

create or replace function hq_capability_sensitive_class(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_code in ('hq.quality.clinical.approve', 'hq.quality.clinical.govern') then 'clinical'
    when p_code in ('hq.practice.commercial.manage', 'hq.individual.commercial.manage', 'hq.learning.price.approve',
                    'hq.platform.ai.manage') then 'financial'
    when p_code in ('hq.platform.users.view', 'hq.platform.users.reset', 'hq.platform.system.view',
                    'hq.platform.settings.view', 'hq.platform.operations.view', 'hq.platform.tenants.view',
                    'hq.platform.audit.view', 'hq.individual.pilot.grant', 'hq.individual.config.manage',
                    'hq.individual.professional.verify', 'hq.practice.licence.verify',
                    'hq.practice.provision.execute', 'hq.practice.flags.manage', 'hq.practice.release.activate',
                    'hq.practice.release.rollback', 'hq.practice.export.execute', 'hq.practice.change.approve',
                    'hq.practice.risk.accept', 'hq.practice.configuration.manage',
                    'hq.learning.certificate.issue') then 'platform'
    else null
  end
$$;

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
    ('hq.quality.research.propose', 'hq.quality.research.govern', 'a research proposer cannot govern research')
  ) as t(capability_a, capability_b, reason)
$$;

notify pgrst, 'reload schema';
