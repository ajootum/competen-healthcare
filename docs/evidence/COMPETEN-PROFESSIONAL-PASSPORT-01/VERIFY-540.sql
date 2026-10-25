-- VERIFY 540 (read-only). COMPETEN-PROFESSIONAL-PASSPORT-01, Professional Stage 7. Every query only reads.

-- 1. the three new tables: RLS on, exactly one policy, a SELECT one (expect 3 rows, each true, 1, 1)
select c.relname, c.relrowsecurity,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
       (select count(*) from pg_policy p where p.polrelid = c.oid and p.polcmd = 'r') as select_policies
  from pg_class c
 where c.relkind = 'r' and c.relname in ('individual_passport_share_view', 'individual_passport_share_record', 'individual_passport_share_access')
 order by c.relname;

-- 2. the three triggers (expect 3)
select tgname from pg_trigger
 where tgname in ('trg_individual_passport_share_view_guard', 'trg_individual_passport_share_record_guard', 'trg_individual_passport_share_access_append_only')
 order by tgname;

-- 3. the keys the composite references need (expect 5)
select indexname from pg_indexes
 where schemaname = 'public' and indexname in ('ux_passport_share_tokens_id_nurse', 'ux_individual_professional_cpd_id_user', 'ux_individual_professional_evidence_id_user',
   'ux_individual_scholar_passport_item_id_user', 'ux_individual_scholar_passport_evaluation_id_user')
 order by indexname;

-- 4. no column that could identify a recipient or claim verification (expect 0)
select count(*) as forbidden_columns from information_schema.columns
 where table_schema = 'public' and table_name like 'individual_passport_share%'
   and (column_name like '%ip%addr%' or column_name like '%user_agent%' or column_name like '%recipient_email%' or column_name like '%verif%');

-- 5. links carrying a selection, and selections on links with no view (expect the second to be 0)
select (select count(*) from individual_passport_share_view) as views,
       (select count(*) from individual_passport_share_record r where not exists (select 1 from individual_passport_share_view v where v.share_token_id = r.share_token_id)) as orphan_records;
