-- VERIFY 520 (read-only). COMPETEN-PROFESSIONAL-COMPETENCY-01, Professional Stage 5. Every query only reads.

-- 1. the three evidence type columns on the 373 evidence record (expect 3)
select count(*) as evidence_columns from information_schema.columns
 where table_schema = 'public' and table_name = 'individual_professional_evidence'
   and column_name in ('evidence_type_code', 'evidence_type_label', 'author_name');

-- 2. the five new tables: RLS on, exactly one policy, a SELECT one (expect 5 rows, each true, 1, 1)
select c.relname, c.relrowsecurity,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies,
       (select count(*) from pg_policy p where p.polrelid = c.oid and p.polcmd = 'r') as select_policies
  from pg_class c
 where c.relkind = 'r' and c.relname in ('individual_professional_my_competency', 'individual_professional_my_competency_history',
   'individual_professional_self_assessment', 'individual_professional_competency_evidence', 'individual_professional_share_competency')
 order by c.relname;

-- 3. the four triggers (expect 4)
select tgname from pg_trigger
 where tgname in ('trg_individual_professional_my_competency_history', 'trg_individual_professional_my_competency_history_append_only',
   'trg_individual_professional_self_assessment_append_only', 'trg_individual_professional_competency_evidence_guard')
 order by tgname;

-- 4. the three functions (expect 3)
select proname from pg_proc
 where proname in ('individual_professional_stage5_append_only', 'individual_professional_my_competency_history_write',
   'individual_professional_competency_evidence_guard')
 order by proname;

-- 5. no scope, verified, score or deficiency column on the new tables (expect 0)
select count(*) as forbidden_columns from information_schema.columns
 where table_schema = 'public' and table_name in ('individual_professional_my_competency', 'individual_professional_my_competency_history',
   'individual_professional_self_assessment', 'individual_professional_competency_evidence', 'individual_professional_share_competency')
   and (column_name in ('hospital_id', 'organisation_id', 'tenant_id', 'workspace_id') or column_name like '%verif%'
     or column_name like '%defici%' or column_name like '%competent%');

-- 6. a self-assessment can only be self-reported (expect 1 row containing basis = 'self_reported')
select pg_get_constraintdef(oid) like '%basis = ''self_reported''%' as self_reported_only
  from pg_constraint where conname = 'individual_professional_self_assessment_shape';

-- 7. the key the Scholar Passport link needs (expect 1)
select indexname from pg_indexes where schemaname = 'public' and indexname = 'ux_individual_scholar_passport_item_id_user';
