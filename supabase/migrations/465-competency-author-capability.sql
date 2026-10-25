-- ====================================================================================================
-- MIGRATION 465: CFCA COMPETENCY AUTHORING AS AN HQ CAPABILITY
--
-- Owner, COMPETEN CFCA -- PRODUCTION AUTHORING AND GOVERNANCE DIRECTION (25 Oct 2026): production is the
-- authoritative environment for CFCA content. "Allow authorised curators to edit and refine CF-FOUND
-- directly in production." "Implement any genuine missing interface or permission capability directly
-- under existing development authority." Staging first. Production needs its own owner GO.
-- Build record: docs/evidence/CFCA/465-build-record.md.
--
-- DEPENDS ON 264 (hq_capability, hq_position, hq_position_capability). Independent of every other file.
-- Additive. Re-running it is a no-op.
--
-- ----------------------------------------------------------------------------------------------------
-- WHY. Shared competency content (CFCA) is the one clinical content type with no HQ author right. Cases
-- (422, hq.quality.case.author), knowledge (442) and hosted learning (464) each have one. Competencies are
-- still written only by the estate super_admin role through /api/content/*, which cannot set the fields
-- the 395 clinical content hash covers (learning outcomes, expected level, framework layer and code).
--
-- WHAT IT ADDS.
--   hq.quality.competency.author   author, edit and put forward shared CFCA competencies for independent
--                                  clinical review. It approves nothing and publishes nothing.
--   competency_author             a new position holding it (and the HQ landing page every position
--                                  reaches). Appointing a person stays the existing HQ appointment workflow.
-- What it does NOT change: clinical approval (395, hq.quality.clinical.approve, the reviewer and their
-- scopes), framework publication, and every existing grant. A curator is an author, so the 395 trigger
-- refuses any decision they make on content they wrote, edited or put forward.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No plpgsql. No partial unique index.
-- notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/CFCA/ROLLBACK-465.sql
-- ====================================================================================================

insert into hq_capability (code, space, label, description) values
  ('hq.quality.competency.author', 'quality', 'Competency authoring',
   'Author, edit and put forward shared CFCA competencies for independent clinical review. Approves and publishes nothing')
on conflict (code) do nothing;

insert into hq_position (code, space, name, description) values
  ('competency_author', 'quality', 'Competency Author',
   'Authors and refines shared CFCA frameworks and competencies, and puts them forward for clinical review. Cannot approve or publish them')
on conflict (code) do nothing;

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('competency_author')) as p(code)
cross join (values ('hq.quality.competency.author'), ('hq.platform.home.view')) as c(code)
where exists (select 1 from hq_position x where x.code = p.code)
  and exists (select 1 from hq_capability y where y.code = c.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
  );

-- Verification: the capability, the position and its two live grants.
select position_code, capability_code from hq_position_capability
 where position_code = 'competency_author' and effective_to is null
 order by capability_code;

notify pgrst, 'reload schema';
