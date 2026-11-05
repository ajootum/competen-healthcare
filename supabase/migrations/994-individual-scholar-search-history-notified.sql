-- ====================================================================================================
-- MIGRATION 994: COMPETEN SCHOLAR -- MY SEARCH HISTORY, SEEING THE NOTICE IS NOT A GRANT
--
-- Owner decision 5 Nov 2026: My Search History on by default, after a one-time notice. Nothing is kept for a learner until
-- the notice has been shown and that has been recorded. Showing a notice is not an agreement, so individual_scholar_consent
-- must be able to say so. Before this, a row had to be granted or revoked and had to carry a grant time.
--
-- 1. status gains notified: the learner was shown this notice version, and did nothing else. updated_at says when.
-- 2. granted_at may be empty, only for scholar_search_history: a notified row, and a learner who turned it off without ever
--    having granted it. A false grant time would be worse than none.
-- 3. A new CHECK keeps the meaning of the column, for every feature. A granted row always carries a grant time. A notified
--    row never does, and only this feature can be notified. No other feature can lose its grant time.
--
-- No row is written or changed. AI help (ai_processing_uploads) is not touched: its rows all hold a grant time, the CHECK
-- passes for them as they stand, and its readers look only at status = granted, which still means the learner acted.
--
-- DEPENDS ON 372, 700, 993. Apply BEFORE the application that writes notified is deployed. Without this the application fails
-- closed: recording the notice is refused, so nothing is kept for a learner with no choice. RE-RUNNING IT IS A NO-OP.
-- OPS-001 s8: proposed MEDIUM (constraints on an existing table). RLS unchanged. No function, grant or policy changes.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No partial unique index. notify pgrst last.
-- ROLLBACK: docs/evidence/SEARCH-HISTORY/default-on/ROLLBACK-994.sql (refuses once a notified or never-granted row exists).
-- ====================================================================================================

alter table individual_scholar_consent drop constraint if exists individual_scholar_consent_status_check;
alter table individual_scholar_consent add constraint individual_scholar_consent_status_check
  check (status in ('granted', 'revoked', 'notified'));

alter table individual_scholar_consent alter column granted_at drop not null;

alter table individual_scholar_consent drop constraint if exists individual_scholar_consent_grant_meaning;
alter table individual_scholar_consent add constraint individual_scholar_consent_grant_meaning
  check ((status <> 'granted' or granted_at is not null)
     and (status <> 'notified' or (feature = 'scholar_search_history' and granted_at is null))
     and (granted_at is not null or feature = 'scholar_search_history'));

comment on column individual_scholar_consent.status is
  'granted: the person acted to agree, and granted_at says when. revoked: the person acted to turn it off, and revoked_at says when. notified (994, scholar_search_history only): the person was shown notice_version at updated_at and did nothing else. That is not an agreement.';

select 'consent_status' as item, pg_get_constraintdef(c.oid) as value from pg_constraint c where c.conname = 'individual_scholar_consent_status_check'
union all select 'grant_meaning', pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'individual_scholar_consent_grant_meaning'
union all select 'ai_consents_without_grant_time', count(*)::text from individual_scholar_consent where feature = 'ai_processing_uploads' and granted_at is null;

notify pgrst, 'reload schema';
