-- MIGRATION 464: COMPETEN LEARNING -- FOUR SEPARATE AUTHORITIES, AS POSITIONS NOBODY HOLDS YET
--
-- COMPETEN-LEARNING-01 Phase 2 (owner GO 2026-10-25, D8): "Separate authoring, clinical approval, publication, pricing
-- approval and certificate issuance permissions. Do not automatically grant these capabilities to existing positions
-- or invent personnel. Prepare the necessary capability assignments for authorised staging testing. Production
-- appointments remain separately governed."
--
-- APPLY ON STAGING FIRST. ADDITIVE. Four capabilities and four NEW positions in the HQ Learning space, each position
-- granting exactly its one capability and the HQ home. No existing position gains anything, and nobody is appointed:
-- an appointment is the existing HQ appointment workflow (owner-run). Clinical approval stays the existing
-- hq.quality.clinical.approve with its 395 scopes. Re-running it is a no-op. OPS-001 s8: proposed Low.
--
--   hq.learning.course.author      Learning Course Author: providers, offerings, drafts, outcome mapping, submission,
--                                  external listings, price proposals.
--   hq.learning.course.publish     Learning Publisher: publishes an approved version, approves an external listing
--                                  (listing approval, never clinical endorsement), retires offerings, the Learning policy.
--   hq.learning.price.approve      Learning Price Approver: approves or rejects a price someone else proposed. The
--                                  database checks the capability and the independence (463).
--   hq.learning.certificate.issue  Learning Certificate Issuer: authorises which outcomes a version may be certified
--                                  for, under its named issuer. The database checks both (462).
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No partial unique index. notify pgrst last.
--
-- ROLLBACK (staging): ROLLBACK-464.sql removes the grants, positions and capabilities. It refuses once anyone is
--   appointed to one of the four positions.


insert into hq_capability (code, space, label, description) values
  ('hq.learning.course.author', 'learning', 'Learning course authoring',
   'Create and edit Competen Learning offerings, external listings and their drafts, map them to CFCA outcomes, submit them for review, and propose prices'),
  ('hq.learning.course.publish', 'learning', 'Learning publication',
   'Publish an approved learning version, approve external listings as listings only and never as clinical endorsement, retire offerings, and set the Learning policy'),
  ('hq.learning.price.approve', 'learning', 'Learning price approval',
   'Approve or reject a course price proposed by someone else'),
  ('hq.learning.certificate.issue', 'learning', 'Learning certificate issuance',
   'Authorise which outcomes a learning version may be certified for, under its named issuer, and revoke certificates')
on conflict (code) do nothing;

insert into hq_position (code, space, name, description) values
  ('learning_course_author', 'learning', 'Learning Course Author',
   'Develops Competen Learning courses and external listings in the Learning studio. Cannot approve, publish, price or certify them'),
  ('learning_publisher', 'learning', 'Learning Publisher',
   'Publishes approved learning versions and approves external listings. Cannot author, clinically approve, price or certify them'),
  ('learning_price_approver', 'learning', 'Learning Price Approver',
   'Approves or rejects course prices proposed by others. Cannot propose them'),
  ('learning_certificate_issuer', 'learning', 'Learning Certificate Issuer',
   'Authorises the certificate outcomes of learning versions on behalf of the named issuer, and revokes certificates')
on conflict (code) do nothing;

-- Each new position: its one capability and the HQ landing page every position reaches.
insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('learning_course_author')) as p(code)
cross join (values ('hq.learning.course.author'), ('hq.platform.home.view')) as c(code)
where exists (select 1 from hq_position x where x.code = p.code)
  and exists (select 1 from hq_capability y where y.code = c.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
  );

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('learning_publisher')) as p(code)
cross join (values ('hq.learning.course.publish'), ('hq.platform.home.view')) as c(code)
where exists (select 1 from hq_position x where x.code = p.code)
  and exists (select 1 from hq_capability y where y.code = c.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
  );

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('learning_price_approver')) as p(code)
cross join (values ('hq.learning.price.approve'), ('hq.platform.home.view')) as c(code)
where exists (select 1 from hq_position x where x.code = p.code)
  and exists (select 1 from hq_capability y where y.code = c.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
  );

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('learning_certificate_issuer')) as p(code)
cross join (values ('hq.learning.certificate.issue'), ('hq.platform.home.view')) as c(code)
where exists (select 1 from hq_position x where x.code = p.code)
  and exists (select 1 from hq_capability y where y.code = c.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code and x.effective_to is null
  );


-- Verification: four capabilities, four positions, eight grants, every grant to one of the four new positions, and
-- nobody appointed.
select code, space from hq_capability where code like 'hq.learning.course.%' or code in ('hq.learning.price.approve', 'hq.learning.certificate.issue') order by code;

select position_code, capability_code from hq_position_capability
 where effective_to is null
   and (capability_code in ('hq.learning.course.author', 'hq.learning.course.publish', 'hq.learning.price.approve', 'hq.learning.certificate.issue')
        or position_code in ('learning_course_author', 'learning_publisher', 'learning_price_approver', 'learning_certificate_issuer'))
 order by position_code, capability_code;

select count(*) as appointed from ogs_office_appointments
 where role in ('learning_course_author', 'learning_publisher', 'learning_price_approver', 'learning_certificate_issuer') and status = 'active';

notify pgrst, 'reload schema';
