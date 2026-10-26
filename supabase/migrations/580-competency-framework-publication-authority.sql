-- ====================================================================================================
-- APPLY THIS FILE WHOLE. It replaces one SQL function of migration 511 between dollar quotes. A runner that
-- splits on the statement separator would cut the function in half, so paste and run the entire file at once.
-- ====================================================================================================
-- MIGRATION 580: COMPETENCY FRAMEWORK PUBLICATION AS A HOLDINGS AUTHORITY
--
-- Owner, COMPETEN COMPETENCY FRAMEWORKS -- CENTRAL GOVERNANCE AND IMPLEMENTATION (26 Oct 2026): competency
-- frameworks are centrally governed, versioned platform resources administered in Holdings, with governed
-- publication and review and approval authority preserved. Staging first. Production needs its own owner GO.
-- Assessment and build notes: docs/evidence/CFCA/FRAMEWORK-STUDIO-ASSESSMENT.md.
--
-- DEPENDS ON 264 (hq_capability, hq_position_capability), the quality_council_member position (granted
-- hq.quality.case.publish by 422) and 500 + 511 (hq_capability_exclusions and the guard trigger that reads it).
-- APPLY AFTER 511. Additive. Re-running it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- WHY. Shared CFCA frameworks and controlled catalogues still reach approved and published through the
-- legacy estate routes (an educator role approves, the estate super_admin role publishes). No HQ position
-- governs it, and an author of the content could publish it. Cases (422), knowledge (442) and hosted
-- learning (464) each have a publication capability that no author position may hold. Frameworks do not.
--
-- WHAT IT ADDS.
--   hq.quality.competency.publish   publish, return or archive a shared competency framework or controlled
--                                   catalogue put forward for publication. Never one the holder authored,
--                                   curated or put forward (checked by the server against the audit trail).
--                                   Clinical approval of every owned competency stays required by 466.
--   quality_council_member          the existing position holds it, as it holds case publication (422).
--                                   Nobody is appointed.
--   hq_capability_exclusions()      511's fourteen pairs unchanged and in order, plus competency author and
--                                   competency publish, so no single position may hold both live. The 500
--                                   trigger enforces it for every writer.
-- What it does NOT change: authoring (465), clinical approval (395), the 466 guard, the sensitive classes,
-- hospital frameworks, and every existing grant.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. APPLY WHOLE banner above. No partial unique
-- index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/CFCA/ROLLBACK-580.sql
-- ====================================================================================================

insert into hq_capability (code, space, label, description) values
  ('hq.quality.competency.publish', 'quality', 'Competency framework publication',
   'Publish, return or archive a shared competency framework or controlled catalogue put forward for publication. Never content the holder authored or put forward')
on conflict (code) do nothing;

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
    ('hq.competency.verification.assess', 'hq.competency.verification.manage', 'a competency assessor cannot set assessment criteria, scopes or assignments'),
    ('hq.quality.competency.author', 'hq.quality.competency.publish', 'a competency author cannot publish competency frameworks')
  ) as t(capability_a, capability_b, reason)
$$;

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('quality_council_member')) as p(code)
cross join (values ('hq.quality.competency.publish')) as c(code)
where exists (select 1 from hq_position x where x.code = p.code)
  and exists (select 1 from hq_capability y where y.code = c.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
  );

-- Verification: the one live grant, and no position holding an excluded pair (expect zero rows).
select position_code, capability_code from hq_position_capability
 where capability_code = 'hq.quality.competency.publish' and effective_to is null
 order by position_code;

select g1.position_code, g1.capability_code, g2.capability_code
  from hq_position_capability g1
  join hq_position_capability g2 on g2.position_code = g1.position_code
  join hq_capability_exclusions() e on e.capability_a = g1.capability_code and e.capability_b = g2.capability_code
 where g1.effective_to is null and g2.effective_to is null;

notify pgrst, 'reload schema';
