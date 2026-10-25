-- VERIFY 450 (read-only). COMPETEN-PROFESSIONAL-PROFILE-01 Stage 1. Every query only reads.

-- 1. the 16 pointer columns (expect 16)
select count(*) as pointer_columns from information_schema.columns
 where table_schema = 'public' and table_name = 'individual_professional_profile'
   and column_name in ('profession_code', 'practice_jurisdiction_code', 'self_declared_practice_jurisdiction', 'professional_status_code',
     'self_declared_professional_status', 'professional_title_code', 'self_declared_professional_title', 'primary_specialty_code',
     'self_declared_primary_specialty', 'practice_setting_code', 'self_declared_practice_setting', 'self_declared_current_role',
     'self_declared_years_experience', 'self_declared_summary', 'registration_step', 'registration_completed_at');

-- 2. the two tables, RLS on, one own-row SELECT policy each and no other policy (expect 2 rows, true, 1, 1)
select c.relname, c.relrowsecurity,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
       (select count(*) from pg_policy p where p.polrelid = c.oid and p.polcmd = 'r') as select_policies
  from pg_class c
 where c.relname in ('individual_professional_profile_context', 'individual_professional_profile_item') and c.relkind = 'r'
 order by c.relname;

-- 3. the four triggers (expect 4)
select tgname from pg_trigger
 where tgname in ('trg_individual_professional_profile_history', 'trg_individual_professional_profile_context_append_only',
                  'trg_individual_professional_profile_item_supersede', 'trg_individual_professional_profile_item_append_only')
 order by tgname;

-- 4. the CHECKs 450 added (expect 3 on the pointer, 6 on the items)
select conrelid::regclass as on_table, conname from pg_constraint
 where conname in ('individual_professional_profile_context_shape', 'individual_professional_profile_registration_step',
   'individual_professional_profile_registration_complete', 'individual_professional_profile_item_experience_check',
   'individual_professional_profile_item_section_check', 'individual_professional_profile_item_section_shape',
   'individual_professional_profile_item_lengths', 'individual_professional_profile_item_type_shape',
   'individual_professional_profile_item_lifecycle')
 order by 1, 2;

-- 5. no verified or scope column on either new table (expect 0)
select count(*) as forbidden_columns from information_schema.columns
 where table_schema = 'public' and table_name in ('individual_professional_profile_context', 'individual_professional_profile_item')
   and (column_name like '%verif%' or column_name in ('hospital_id', 'organisation_id', 'tenant_id', 'workspace_id'));

-- 6. one open history period per profile (expect the two counts equal)
select (select count(*) from individual_professional_profile) as profiles,
       (select count(*) from individual_professional_profile_context where effective_to is null) as open_periods;

-- 7. pre-existing 373 rows unchanged in count (compare with the pre-application record)
select count(*) as profile_rows from individual_professional_profile;
