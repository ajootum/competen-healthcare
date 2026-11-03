-- ====================================================================================================
-- MIGRATION 910: SCHOLAR LEARNER ENGAGEMENT AND USAGE ANALYTICS (capabilities and the pseudonym salt)
--
-- Owner instruction 3 Nov 2026, "Competen Scholar: Learner Engagement and Usage Analytics" (pilot). The HQ page
-- /super-admin/individual/scholar/analytics shows adoption, activity, engagement and AI expenditure of genuine Scholar
-- learners, Anonymous View by default and Named View only for an authorised person, with the identity protection done
-- on the server (the API never sends identifying fields to a browser that may not see them).
-- Build record: docs/evidence/SCHOLAR-ENGAGEMENT-ANALYTICS-01/910-build-record.md
--
-- APPLY ON STAGING FIRST. NOT AUTHORISED FOR PRODUCTION without a separate owner GO. Plain SQL, no function, no
-- trigger, no policy. Additive. Re-running it is a no-op. Depends on 264 (hq_capability, hq_position,
-- hq_position_capability, hq_config), 370 (individual_product_administrator) and 860 (individual_product_reviewer).
--
-- WHAT IT ADDS
--   hq.scholar.analytics.view              open the dashboard in Anonymous View (pseudonymous rankings, no identity).
--                                          Granted to the Individual Product Administrator and the Individual Product
--                                          Reviewer positions (position_default).
--   hq.scholar.analytics.identifiable.read  Named View, the learner detail with a name, and the testing filter that
--                                          includes demo and test accounts. Granted to NO position: the owner holds it as
--                                          owner and grants it to a position through HQ Positions when decided. Every
--                                          identifiable read writes one audit_log row (the API does that).
--   hq_config.analytics_pseudonym_salt     a random secret, generated here once, that keys the stable pseudonyms
--                                          (Learner XXXX) so a pseudonym cannot be recomputed from a user id alone.
--
-- WHAT IT DOES NOT DO. No table of learner data is created or changed, nothing is tracked that was not tracked
-- before, no appointment is made, no grant to a person.
-- Rollback: docs/evidence/SCHOLAR-ENGAGEMENT-ANALYTICS-01/ROLLBACK-910.sql. Verify: VERIFY-910.sql.
-- HOUSE RULES. ASCII only. No semicolons inside comments or literals. No partial unique index. notify pgrst last.
-- ====================================================================================================

insert into hq_capability (code, space, label, description) values
  ('hq.scholar.analytics.view', 'platform', 'Scholar engagement analytics',
   'Open the Scholar learner engagement and usage dashboard in Anonymous View: pseudonymous rankings, activity, AI expenditure, no learner identity')
on conflict (code) do nothing;

insert into hq_capability (code, space, label, description) values
  ('hq.scholar.analytics.identifiable.read', 'platform', 'Scholar engagement analytics, identifiable',
   'See learner names on the Scholar engagement dashboard, the Named View, and open an identified learner detail. Every use is audited')
on conflict (code) do nothing;

insert into hq_position_capability (position_code, capability_code, source)
select p.code, c.code, 'position_default'
from (values ('individual_product_administrator'), ('individual_product_reviewer')) as p(code)
cross join (values ('hq.scholar.analytics.view')) as c(code)
where exists (select 1 from hq_position x where x.code = p.code)
  and exists (select 1 from hq_capability y where y.code = c.code)
  and not exists (
    select 1 from hq_position_capability x
    where x.position_code = p.code and x.capability_code = c.code
  );

alter table hq_config add column if not exists analytics_pseudonym_salt text not null default md5(gen_random_uuid()::text);

notify pgrst, 'reload schema';
