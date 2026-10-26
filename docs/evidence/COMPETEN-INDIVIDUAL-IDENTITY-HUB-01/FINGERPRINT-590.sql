-- FINGERPRINT 590 (read-only). Run BEFORE and AFTER each application, and after the SQL rollback rehearsal.
-- One md5 and an item count over the DATABASE schema 590 can touch: the columns, constraints, policies and RLS of
-- individual_identity_profile, the section check of individual_professional_profile_item, and the columns of
-- individual_passport_share_view.
-- The individual-photos BUCKET is deliberately NOT included: Supabase does not let SQL delete a bucket, so the
-- rollback removes it separately through the Storage API (rollback-590-storage.ts). VERIFY-590 section 3 checks the
-- bucket itself.
-- Expected: PRE = after the SQL rollback, and after apply #1 = after apply #2 = after re-apply.

with items as (
  select 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') as item
    from information_schema.columns where table_schema = 'public' and table_name in ('individual_identity_profile', 'individual_passport_share_view')
  union all
  select 'con:' || conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid)
    from pg_constraint where conrelid::regclass::text = 'individual_identity_profile'
       or conname = 'individual_professional_profile_item_section_check'
  union all
  select 'pol:' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '')
    from pg_policies where schemaname = 'public' and tablename = 'individual_identity_profile'
  union all
  select 'rls:' || relname || ':' || relrowsecurity::text from pg_class where relkind = 'r' and relname = 'individual_identity_profile'
)
select md5(string_agg(item, '|' order by item)) as fingerprint, count(*) as items from items;
