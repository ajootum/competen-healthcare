-- VERIFY 590 (read-only). COMPETEN-INDIVIDUAL-IDENTITY-HUB-01. Every query only reads.

-- 1. the identity table: RLS on, exactly one policy, a SELECT one (expect 1 row: t, 1, 1)
select c.relname, c.relrowsecurity,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
       (select count(*) from pg_policy p where p.polrelid = c.oid and p.polcmd = 'r') as select_policies
  from pg_class c where c.relkind = 'r' and c.relname = 'individual_identity_profile';

-- 2. its two checks (expect 2)
select conname from pg_constraint
 where conrelid = 'individual_identity_profile'::regclass and conname in ('individual_identity_profile_lengths', 'individual_identity_profile_photo')
 order by conname;

-- 3. the photo bucket is private, 5 MB, three image types (expect 1 row: f, 5242880, 3)
select public, file_size_limit, array_length(allowed_mime_types, 1) as types from storage.buckets where id = 'individual-photos';

-- 4. the profile records accept a skill (expect 1)
select count(*) as skill_allowed from pg_constraint
 where conname = 'individual_professional_profile_item_section_check' and pg_get_constraintdef(oid) like '%skill%';

-- 5. the per-link photo choice exists, not null, default false (expect 1 row: boolean, NO, false)
select data_type, is_nullable, column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'individual_passport_share_view' and column_name = 'include_photo';

-- 6. no column that could scope, publish or verify the identity (expect 0)
select count(*) as forbidden_columns from information_schema.columns
 where table_schema = 'public' and table_name = 'individual_identity_profile'
   and (column_name like '%hospital%' or column_name like '%org%' or column_name like '%tenant%' or column_name like '%public%' or column_name like '%verif%');
