-- ROLLBACK 540 (STAGING ONLY). COMPETEN-PROFESSIONAL-PASSPORT-01, Professional Stage 7.
-- Removes what 540 added: the access log, the record-level selections and the link views (and every row in them),
-- their three trigger functions, the (id, user_id) indexes on passport_share_tokens and on the Scholar Passport
-- evaluation table. The indexes 393 and 520 own (CPD, evidence, Scholar Passport item) are left in place.
-- Links themselves (passport_share_tokens) are untouched. Plain statements only.

drop table if exists individual_passport_share_access;
drop table if exists individual_passport_share_record;
drop table if exists individual_passport_share_view;
drop function if exists public.individual_passport_share_access_append_only();
drop function if exists public.individual_passport_share_record_guard();
drop function if exists public.individual_passport_share_view_guard();
drop index if exists ux_passport_share_tokens_id_nurse;
drop index if exists ux_individual_scholar_passport_evaluation_id_user;

notify pgrst, 'reload schema';
