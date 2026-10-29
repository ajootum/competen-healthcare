-- ====================================================================================================
-- MIGRATION 700: INDIVIDUAL CROSS-EXPERIENCE PERSONAL AI CONSENT
--
-- COMPETEN INDIVIDUAL CROSS-EXPERIENCE PERSONAL AI CONTEXT (owner decision, APPROVED subject to explicit individual
-- consent, 29 Oct 2026). Personal AI in Scholar may read the person's OWN Professional development needs, goals and
-- plans only after the person has granted this consent, which they can revoke at any time.
--
-- APPLY ON STAGING FIRST. ADDITIVE: one CHECK widened on individual_scholar_consent (372), the per-person, per-feature,
-- versioned and revocable consent that already governs AI use of Scholar uploads. A new feature code,
-- ai_cross_experience_context. No row is written or changed: nobody has consented, so nothing crosses. Re-running it is
-- a no-op. OPS-001 s8: proposed Low (one widened constraint, no function, no data).
-- DEPENDS ON 372.
--
-- RLS unchanged: the person still reads only their own consent rows.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No partial unique index. notify pgrst last.
--
-- ROLLBACK (staging): docs/evidence/AI-PILOT/ROLLBACK-700.sql (refuses once a cross-experience consent row exists).
-- ====================================================================================================

alter table individual_scholar_consent drop constraint if exists individual_scholar_consent_feature_check;
alter table individual_scholar_consent add constraint individual_scholar_consent_feature_check
  check (feature in ('ai_processing_uploads', 'ai_cross_experience_context'));

comment on column individual_scholar_consent.feature is
  'ai_processing_uploads (372): AI may read the person own Scholar uploads. ai_cross_experience_context (700): Personal AI in Scholar may read the person own Professional development needs, goals and plans. Each is granted and revoked separately.';

select 'consent_features' as item, pg_get_constraintdef(c.oid) as value from pg_constraint c where c.conname = 'individual_scholar_consent_feature_check'
union all select 'cross_experience_consents', count(*)::text from individual_scholar_consent where feature = 'ai_cross_experience_context';

notify pgrst, 'reload schema';
