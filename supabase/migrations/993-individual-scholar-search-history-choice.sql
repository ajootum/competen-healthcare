-- ====================================================================================================
-- MIGRATION 993: COMPETEN SCHOLAR -- MY SEARCH HISTORY, THE LEARNER CHOICE AND MATERIAL DELETION
--
-- Owner decision "COMPETEN SCHOLAR -- SEARCH HISTORY PRIVACY DECISION" (5 Nov 2026, conditional approval), items 1, 2
-- and 4. Two changes to objects that already exist, and nothing else. No row is written or changed.
--
-- 1. A SEPARATE, RECORDED CHOICE. individual_scholar_consent (372, widened by 700) is the per-person, per-feature,
--    versioned and revocable record. It gains one feature code, scholar_search_history. No row means OFF. Each feature
--    is granted and revoked apart, so AI help (ai_processing_uploads) is untouched: nobody who agreed to the AI notice is
--    asked again, and the AI notice version does not change.
--
-- 2. DELETING A MATERIAL REMOVES THE HISTORY THAT RELIED ON IT. 992 kept the words and only cleared the link. The owner
--    decision changes that. Two foreign keys on individual_scholar_search_history become ON DELETE CASCADE:
--      material_id   an entry linked to a deleted material goes with it
--      session_id    an entry asked in a lesson goes when that lesson goes. A lesson goes only when no material it
--                    relies on is left (store.ts pruneEmptySessions), the Privacy Notice 4.2 "relied only on it" rule.
--    artefact_id stays ON DELETE SET NULL. No search or question is stored with one, and a pin or removal mark holds no
--    words. A search or question with no link stays until the learner removes it. No other table changes, so what a
--    material deletion does to questions, attempts and evidence stays governed by the foreign keys that already exist.
--
-- DEPENDS ON 372, 700, 992. Apply after 992, and before the application that writes the new feature code is used. The
-- application fails closed without it: a grant is refused by the CHECK and the choice stays OFF.
-- RE-RUNNING IT IS A NO-OP. OPS-001 s8: proposed MEDIUM (constraints and relationships on existing objects). Production
-- has key scholar_search_history OFF, so the history table holds no captured rows when this is applied.
-- RLS unchanged. No function, grant or policy changes.
--
-- HOUSE RULES. ASCII only. No semicolons inside comments. No partial unique index. notify pgrst last.
-- ROLLBACK: docs/evidence/SEARCH-HISTORY/consent/ROLLBACK-993.sql (refuses once a learner has made this choice).
-- ====================================================================================================

alter table individual_scholar_consent drop constraint if exists individual_scholar_consent_feature_check;
alter table individual_scholar_consent add constraint individual_scholar_consent_feature_check
  check (feature in ('ai_processing_uploads', 'ai_cross_experience_context', 'scholar_search_history'));

comment on column individual_scholar_consent.feature is
  'ai_processing_uploads (372): AI may read the person own Scholar uploads. ai_cross_experience_context (700): Personal AI in Scholar may read the person own Professional development needs, goals and plans. scholar_search_history (993): new searches and Ask Scholar questions are kept in the person own My Search History. Each is granted and revoked separately.';

alter table individual_scholar_search_history drop constraint if exists individual_scholar_search_history_material_fk;
alter table individual_scholar_search_history add constraint individual_scholar_search_history_material_fk
  foreign key (material_id, user_id) references individual_scholar_material(id, user_id) on delete cascade;

alter table individual_scholar_search_history drop constraint if exists individual_scholar_search_history_session_fk;
alter table individual_scholar_search_history add constraint individual_scholar_search_history_session_fk
  foreign key (session_id, user_id) references individual_scholar_learning_session(id, user_id) on delete cascade;

select 'consent_features' as item, pg_get_constraintdef(c.oid) as value from pg_constraint c where c.conname = 'individual_scholar_consent_feature_check'
union all select 'material_fk', pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'individual_scholar_search_history_material_fk'
union all select 'session_fk', pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'individual_scholar_search_history_session_fk'
union all select 'search_history_choices', count(*)::text from individual_scholar_consent where feature = 'scholar_search_history';

notify pgrst, 'reload schema';
