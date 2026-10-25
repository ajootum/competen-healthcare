-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It replaces two SQL functions of migration 500 between dollar quotes. A runner that
-- splits on the statement separator would cut a function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 511: THE COMPETENCY ASSESSOR IN THE 500 SEPARATION-OF-DUTIES GUARD
--
-- COMPETEN-PROFESSIONAL-COMPETENCY-01, Stage 5, C5 (owner GO). "Clinical Content Reviewer and Competency
-- Assessor are separate authorities. Approval of competency content does not authorise verification of an
-- individual competence." Development and staging authorised. Production needs its own owner GO.
-- Build record: docs/evidence/COMPETEN-PROFESSIONAL-COMPETENCY-01/510-build-record.md
--
-- DEPENDS ON 500 (hq_capability_exclusions, hq_capability_sensitive_class and the hq_position_capability
-- guard that reads them). Independent of 510 at apply time: the pairs name capability codes, not rows. It
-- writes NO position, NO grant and NO appointment.
--
-- WHAT IT CHANGES. Both functions are replaced with the 500 list unchanged plus:
--   exclusions  hq.competency.verification.assess with hq.quality.clinical.approve, hq.quality.clinical.govern,
--               hq.quality.competency.author and hq.competency.verification.manage. No single position may
--               hold an assessor right beside content approval, reviewer governance, competency authoring or
--               the Verification Studio (criteria, scopes and assignment).
--   sensitive   both hq.competency.verification.* capabilities are class clinical: a grant needs the owner, a
--               reason and an explicit acknowledgement, as 500 requires for clinical approval.
-- Mirrored by HQ_CAPABILITY_EXCLUSIONS and HQ_SENSITIVE_CAPABILITIES in src/lib/hq/positions.ts, and the unit
-- test reads THIS file, the latest definition, to prove the two agree.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments or string literals. APPLY WHOLE banner above.
-- notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/COMPETEN-PROFESSIONAL-COMPETENCY-01/ROLLBACK-511.sql (restores the 500 bodies)
-- ====================================================================================================

create or replace function hq_capability_sensitive_class(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_code in ('hq.quality.clinical.approve', 'hq.quality.clinical.govern',
                    'hq.competency.verification.manage', 'hq.competency.verification.assess') then 'clinical'
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
    ('hq.quality.research.propose', 'hq.quality.research.govern', 'a research proposer cannot govern research'),
    ('hq.competency.verification.assess', 'hq.quality.clinical.approve', 'a competency assessor cannot hold clinical content approval'),
    ('hq.competency.verification.assess', 'hq.quality.clinical.govern', 'a competency assessor cannot govern clinical reviewer scopes'),
    ('hq.competency.verification.assess', 'hq.quality.competency.author', 'a competency assessor cannot author competency content'),
    ('hq.competency.verification.assess', 'hq.competency.verification.manage', 'a competency assessor cannot set assessment criteria, scopes or assignments')
  ) as t(capability_a, capability_b, reason)
$$;

-- Verification: no live position already holds an excluded pair (expect zero rows).
select g1.position_code, g1.capability_code, g2.capability_code
  from hq_position_capability g1
  join hq_position_capability g2 on g2.position_code = g1.position_code
  join hq_capability_exclusions() e on e.capability_a = g1.capability_code and e.capability_b = g2.capability_code
 where g1.effective_to is null and g2.effective_to is null;

notify pgrst, 'reload schema';
