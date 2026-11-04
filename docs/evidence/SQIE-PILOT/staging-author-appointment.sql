-- STAGING ONLY (ezhvpgtcqcdsgylrxgdb). SQIE pilot batch: the author of the 60 drafts.
-- Staging had no holder of hq.learning.ckri.educator (position knowledge_educator, 0 active appointments on 4 Nov 2026),
-- so the 442 guard would refuse every draft. This appoints the owner's STAGING fixture account (Person A,
-- 391ce3d7-cd4d-46f1-bce5-fa413d40fb61), who does NOT hold hq.quality.knowledge.publish, to knowledge_educator in the
-- HQ Learning Space, authorised by the synthetic Estate Owner A (as the UNIFIED-GOVERNANCE-V1 walk did). Author and
-- publisher therefore stay different people (640). Idempotent. Never run against production.
-- Rollback: update ogs_office_appointments set status = 'ended', term_end = now()
--   where person_id = '391ce3d7-cd4d-46f1-bce5-fa413d40fb61' and role = 'knowledge_educator' and appointed_by = 'SQIE pilot batch staging load';
insert into ogs_office_appointments (office_id, person_id, person_name, role, status, term_start, appointed_by, authorised_by, authorised_at)
select o.id, '391ce3d7-cd4d-46f1-bce5-fa413d40fb61', 'Gabriel Ajootum (OWNER, STAGING)', 'knowledge_educator', 'active', current_date,
       'SQIE pilot batch staging load', '981d5cb1-166e-4b90-afc8-192219f298e7', now()
  from ogs_offices o
 where o.code = 'learning'
   and not exists (select 1 from ogs_office_appointments a
                    where a.person_id = '391ce3d7-cd4d-46f1-bce5-fa413d40fb61' and a.role = 'knowledge_educator' and a.status = 'active');
